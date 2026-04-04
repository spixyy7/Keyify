/**
 * Keyify Platform – Backend API
 * Node.js + Express + Supabase (PostgreSQL) + JWT + bcryptjs
 *
 * Routes:
 *  POST   /api/register          – Register new user
 *  POST   /api/login             – Authenticate + trigger OTP
 *  POST   /api/verify            – Validate OTP, issue JWT
 *  GET    /api/admin/stats       – Admin: revenue, users, logs
 *  POST   /api/admin/settings    – Admin: save theme/payment config
 *  GET    /api/admin/settings    – Admin: read current settings
 *  GET    /api/products          – Public: list all products
 *  POST   /api/products          – Admin: create product (fields: name_sr/en, desc_sr/en, price, original_price, category, image_url, badge, stars)
 *  PUT    /api/products/:id      – Admin: update product (same fields + card_size, grid_order)
 *  PATCH  /api/products/layout   – Admin: bulk update grid_order + card_size
 *  DELETE /api/products/:id      – Admin: delete product
 */

require('dotenv').config();

const express     = require('express');
const cors        = require('cors');
const bcrypt      = require('bcryptjs');
const jwt         = require('jsonwebtoken');
const crypto      = require('crypto');
const rateLimit   = require('express-rate-limit');
const multer      = require('multer');
const nodemailer  = require('nodemailer');
const { google }  = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const Stripe           = require('stripe');

function normalizeOrigin(origin) {
  try {
    return new URL(origin).origin.replace(/\/$/, '');
  } catch {
    return String(origin || '').trim().replace(/\/$/, '');
  }
}

function parseOriginList(...values) {
  return [...new Set(
    values
      .filter(Boolean)
      .flatMap((value) => String(value).split(/[,\r\n]+/))
      .map((value) => normalizeOrigin(value))
      .filter(Boolean)
  )];
}

const configuredCorsOrigins = parseOriginList(
  process.env.FRONTEND_URL,
  process.env.FRONTEND_URLS,
  process.env.CORS_ALLOWED_ORIGINS
);

const isRailwayRuntime = Boolean(
  process.env.RAILWAY_ENVIRONMENT ||
  process.env.RAILWAY_PROJECT_ID ||
  process.env.RAILWAY_SERVICE_ID ||
  process.env.RAILWAY_DEPLOYMENT_ID
);

function isAllowedCorsOrigin(origin) {
  if (!origin || origin === 'null') return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;

  const normalizedOrigin = normalizeOrigin(origin);
  if (configuredCorsOrigins.includes(normalizedOrigin)) return true;

  try {
    const { hostname, protocol } = new URL(normalizedOrigin);
    if (protocol !== 'https:') return false;

    if (/\.vercel\.app$/i.test(hostname)) {
      const allowVercelPreviews = (process.env.ALLOW_VERCEL_PREVIEWS || 'true').toLowerCase();
      if (allowVercelPreviews !== 'false') return true;
    }
  } catch {}

  return false;
}

/* ─────────────────────────────────────────
   Supabase client (service-role key – never expose to frontend)
───────────────────────────────────────── */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/* ─────────────────────────────────────────
   Express app
───────────────────────────────────────── */
const app = express();

app.use(cors({
  origin: function(origin, callback) {
    if (isAllowedCorsOrigin(origin)) return callback(null, true);
    if (!configuredCorsOrigins.length) return callback(null, true);
    console.log('[CORS blocked] origin:', origin);
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
}));

/* ─────────────────────────────────────────
   STRIPE – init (graceful if key missing)
   Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
───────────────────────────────────────── */
const stripe = process.env.STRIPE_SECRET_KEY
  ? Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

/* ─────────────────────────────────────────
   STRIPE WEBHOOK  –  MUST be registered BEFORE express.json()
   so we receive the raw body that Stripe needs for signature verification.

   Supabase table – run once in SQL editor:
   ┌──────────────────────────────────────────────────────────────────────┐
   │ CREATE TABLE IF NOT EXISTS invoices (                                │
   │   id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),│
   │   stripe_invoice_id        TEXT UNIQUE NOT NULL,                    │
   │   stripe_payment_intent_id TEXT,                                    │
   │   stripe_customer_id       TEXT,                                    │
   │   user_id    UUID REFERENCES users(id) ON DELETE SET NULL,          │
   │   customer_name            TEXT,                                    │
   │   customer_email_enc       TEXT NOT NULL,   -- AES-256-CBC           │
   │   product_id UUID REFERENCES products(id) ON DELETE SET NULL,       │
   │   product_name             TEXT,                                    │
   │   amount_cents             INTEGER NOT NULL,                        │
   │   currency                 TEXT DEFAULT 'eur',                      │
   │   status      TEXT DEFAULT 'draft',                                 │
   │   payment_method_type      TEXT,                                    │
   │   stripe_invoice_url       TEXT,                                    │
   │   stripe_invoice_pdf       TEXT,                                    │
   │   ip_address_enc           TEXT,            -- AES-256-CBC           │
   │   created_at               TIMESTAMPTZ DEFAULT now(),               │
   │   paid_at                  TIMESTAMPTZ                              │
   │ );                                                                  │
   │ CREATE INDEX ON invoices (status);                                  │
   │ CREATE INDEX ON invoices (created_at DESC);                         │
   └──────────────────────────────────────────────────────────────────────┘
───────────────────────────────────────── */
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe nije konfigurisan' });

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe/webhook] Signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'invoice.paid') {
      const inv = event.data.object;
      const piId = typeof inv.payment_intent === 'string'
        ? inv.payment_intent : inv.payment_intent?.id;

      await supabase.from('invoices').update({
        status:              'paid',
        paid_at:             new Date().toISOString(),
        stripe_invoice_pdf:  inv.invoice_pdf  || null,
        stripe_invoice_url:  inv.hosted_invoice_url || null,
      }).eq('stripe_invoice_id', inv.id);

      if (piId) {
        await supabase.from('invoices').update({ stripe_payment_intent_id: piId })
          .eq('stripe_invoice_id', inv.id);
      }
    }

    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object;
      const pmType = pi.payment_method_types?.[0] || 'card';
      await supabase.from('invoices')
        .update({ payment_method_type: pmType })
        .eq('stripe_payment_intent_id', pi.id);
    }

    if (event.type === 'invoice.payment_failed') {
      const inv = event.data.object;
      await supabase.from('invoices').update({ status: 'failed' })
        .eq('stripe_invoice_id', inv.id);
    }

    if (event.type === 'invoice.voided') {
      const inv = event.data.object;
      await supabase.from('invoices').update({ status: 'void' })
        .eq('stripe_invoice_id', inv.id);
    }
  } catch (dbErr) {
    console.error('[stripe/webhook] DB error:', dbErr.message);
  }

  return res.json({ received: true });
});

app.use(express.json());

// Trust proxy for correct IP behind Render/Railway/Nginx
app.set('trust proxy', 1);

/* ─────────────────────────────────────────
   Rate limiters
───────────────────────────────────────── */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15,
  message: { error: 'Previše pokušaja. Pokušajte ponovo za 15 minuta.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Previše zahtjeva.' },
});

app.use('/api', apiLimiter);

/* ─────────────────────────────────────────
   SMTP TRANSPORT (Gmail App Password)
   Env: EMAIL_USER + EMAIL_PASS (16-char App Password from Google Account)
   Preferred when EMAIL_PASS is set; falls back to Gmail REST API.
───────────────────────────────────────── */
// 1. Inicijalizacija Google API Klijenta
const oAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'https://developers.google.com/oauthplayground' // Zvanični Google redirect
);

// Postavljamo Refresh Token koji ne ističe
oAuth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN });

// 2. Funkcija koja striktno koristi Google API
let _smtpTransport = null;
async function _getSmtpTransport() {
  if (_smtpTransport) return _smtpTransport;

  try {
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      _smtpTransport = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      });
      return _smtpTransport;
    }

    const refreshToken = process.env.GMAIL_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN;
    if (!refreshToken) {
      throw new Error('Gmail refresh token nije konfigurisan');
    }

    // Svaki put kada šalješ mejl, Google API generiše nov, svež token
    const accessToken = await oAuth2Client.getAccessToken();
    _smtpTransport = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: process.env.EMAIL_USER,
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        refreshToken,
        accessToken: accessToken.token
      }
    });
    return _smtpTransport;
  } catch (error) {
    console.error("Greška pri povezivanju sa Google API:", error);
    throw error;
  }
}

// 3. Primer kako sada pozivaš slanje (ako već nemaš svoju sendMail funkciju):
// const transport = await _getSmtpTransport();
// await transport.sendMail({ from: ..., to: ..., subject: ... });

/* ─────────────────────────────────────────
   Gmail REST API (HTTPS – no SMTP ports needed)
   Requires: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, EMAIL_USER
   Run GET /api/auth/gmail-setup once to obtain the refresh token.
───────────────────────────────────────── */

/** Exchange refresh token → short-lived access token */
async function getGmailAccessToken() {
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error('Missing Gmail refresh token');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }).toString(),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Gmail token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

/** Encode an RFC-2822 message to base64url for the Gmail API */
function buildRawEmail({ from, to, subject, html }) {
  const msg = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?utf-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(html).toString('base64'),
  ].join('\r\n');
  return Buffer.from(msg).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Send email via Gmail REST API (port 443, works everywhere) */
async function _sendViaGmailApi({ from, to, subject, html }) {
  const accessToken = await getGmailAccessToken();
  const raw = buildRawEmail({ from, to, subject, html });
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Gmail API send failed');
}

/**
 * Mail sender via Gmail REST API (HTTPS port 443 – SMTP blocked on Railway).
 * Requires: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, EMAIL_USER
 */
async function sendMailSafe({ from, to, subject, html }) {
  try {
    await _sendViaGmailApi({ from, to, subject, html });
    return;
  } catch (gmailErr) {
    const message = gmailErr?.message || '';
    const tokenExpired = /invalid_grant|expired|revoked/i.test(message);
    const smtpFallbackEnabled = (process.env.ENABLE_SMTP_FALLBACK || '').toLowerCase() === 'true';
    const shouldTrySmtpFallback = !!(process.env.EMAIL_USER && process.env.EMAIL_PASS && (!isRailwayRuntime || smtpFallbackEnabled));

    console.error('Email send failed:', message, gmailErr);

    if (shouldTrySmtpFallback) {
      try {
        const transport = await _getSmtpTransport();
        await transport.sendMail({ from, to, subject, html });
        console.warn('[mail] Gmail API failed, SMTP fallback used successfully.');
        return;
      } catch (smtpErr) {
        console.error('[mail] SMTP fallback failed:', smtpErr.message);
        throw new Error(`Mail delivery failed. Gmail API error: ${message}. SMTP fallback error: ${smtpErr.message}`);
      }
    }

    if (process.env.EMAIL_USER && process.env.EMAIL_PASS && isRailwayRuntime && !smtpFallbackEnabled) {
      console.warn('[mail] SMTP fallback skipped on Railway. Set ENABLE_SMTP_FALLBACK=true only if you know outbound SMTP is reachable.');
    }

    if (tokenExpired) {
      throw new Error('Gmail refresh token je istekao ili opozvan. Obnovite GMAIL_REFRESH_TOKEN preko /api/auth/gmail-setup ili podesite EMAIL_PASS za SMTP fallback.');
    }

    throw gmailErr;
  }
}

/* ─────────────────────────────────────────
   Helpers
───────────────────────────────────────── */
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateTempPassword() {
  // Avoids confusable chars: 0/O, 1/l/I
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let pass = '';
  for (let i = 0; i < 10; i++) pass += chars[Math.floor(Math.random() * chars.length)];
  return pass;
}

function getClientIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

/** Short, stable fingerprint of a User-Agent string */
function hashUA(ua) {
  return crypto.createHash('sha256').update(ua || '').digest('hex').slice(0, 16);
}

/** Strip sensitive DB columns before returning user data to clients */
function sanitizeUser(user) {
  if (!user) return user;
  const { password_hash, otp_code, otp_expires, ...safe } = user;
  return safe;
}

/** Server-side HTML escape for email templates */
function escServerHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ─────────────────────────────────────────
   AES-256-CBC ENCRYPTION HELPERS
   Encrypts sensitive fields (email, amount) before storing in transaction_logs.
   Env: AES_KEY = 64 hex chars (32 bytes). Generate with:
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ⚠️  If AES_KEY is missing, a random key is used per process restart (logs unreadable after restart).
───────────────────────────────────────── */
const _aesKeyHex = (process.env.AES_KEY || '').replace(/[^0-9a-fA-F]/g, '').padEnd(64, '0').slice(0, 64);
const AES_KEY    = Buffer.from(_aesKeyHex, 'hex');

function encryptField(text) {
  const iv     = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', AES_KEY, iv);
  const enc    = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + enc.toString('hex');
}

function decryptField(ciphertext) {
  try {
    const [ivHex, encHex] = (ciphertext || '').split(':');
    if (!ivHex || !encHex) return '[encrypted]';
    const iv       = Buffer.from(ivHex, 'hex');
    const enc      = Buffer.from(encHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', AES_KEY, iv);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return '[decrypt error]';
  }
}

const REQUIRED_USER_INPUT_TYPES = new Set([
  'none',
  'email',
  'email_password',
  'pin_code',
  'redirect_to_chat',
]);

function normalizeRequiredUserInputs(value) {
  const normalized = String(value || 'none')
    .trim()
    .toLowerCase()
    .replace(/[^a-z_]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return REQUIRED_USER_INPUT_TYPES.has(normalized) ? normalized : 'none';
}

function safeParseJSON(text, fallback = null) {
  try { return text ? JSON.parse(text) : fallback; }
  catch { return fallback; }
}

function buildOptionalColumnAttempts(payload, removableKeys) {
  const attempts = [];
  const current = { ...payload };
  attempts.push({ ...current });

  removableKeys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(current, key)) {
      delete current[key];
      attempts.push({ ...current });
    }
  });

  return attempts;
}

function validateRequiredInputs(requiredType, payload, fallbackEmail) {
  const type = normalizeRequiredUserInputs(requiredType);
  const source = payload && typeof payload === 'object' ? payload : {};

  if (type === 'none' || type === 'redirect_to_chat') return null;

  if (type === 'email') {
    const email = String(source.email || fallbackEmail || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { error: 'Unesite validan email za isporuku proizvoda.' };
    }
    return { value: { email } };
  }

  if (type === 'email_password') {
    const email = String(source.email || '').trim().toLowerCase();
    const password = String(source.password || '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { error: 'Unesite validan email za nalog koji želite da koristite.' };
    }
    if (!password) {
      return { error: 'Unesite lozinku za nalog koji želite da koristite.' };
    }
    return { value: { email, password } };
  }

  if (type === 'pin_code') {
    const pin_code = String(source.pin_code || source.pinCode || '').trim();
    if (!pin_code) {
      return { error: 'Unesite PIN kod ili verifikacioni kod koji proizvod zahtijeva.' };
    }
    return { value: { pin_code } };
  }

  return null;
}

function buildDeliveryPayload({ adminDelivery, productDelivery, licenseKey }) {
  const adminText = String(adminDelivery || '').trim();
  if (adminText) return adminText;

  const productText = String(productDelivery || '').trim();
  if (productText) return productText;

  return licenseKey ? String(licenseKey).trim() : null;
}

function deliveryPayloadToEmailHtml(payload) {
  const safe = escServerHtml(payload || '').replace(/\n/g, '<br/>');
  return safe.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#1D6AFF;text-decoration:none">$1</a>');
}

function getFrontendBaseUrl(req) {
  const preferred = String(process.env.FRONTEND_URL || configuredCorsOrigins[0] || '').trim().replace(/\/$/, '');
  if (preferred) return preferred;

  const origin = String(req?.headers?.origin || '').trim().replace(/\/$/, '');
  if (origin) return origin;

  return 'http://localhost:63342/Keyify';
}

function buildFrontendPageUrl(req, page, params = {}) {
  const base = getFrontendBaseUrl(req);
  const url = new URL(page, base.endsWith('/') ? base : `${base}/`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

async function insertOrderRecord(orderPayload) {
  const attempts = buildOptionalColumnAttempts(
    orderPayload,
    ['transaction_id', 'user_id', 'guest_token', 'product_id', 'product_image', 'delivery_payload', 'proof_uploaded', 'updated_at']
  );

  let data = null;
  let error = null;
  for (const attempt of attempts) {
    const result = await supabase
      .from('orders')
      .insert(attempt)
      .select('id, guest_token')
      .single();
    data = result.data;
    error = result.error;
    if (!error) return data;
    if (!isMissingSchemaError(error)) break;
  }

  if (error) {
    console.warn('[orders] insert skipped:', error.message);
  }

  return null;
}

async function updateOrderByTransactionId(transactionId, updates) {
  if (!transactionId) return;
  const attempts = buildOptionalColumnAttempts(
    { ...updates, updated_at: new Date().toISOString() },
    ['delivery_payload', 'proof_uploaded', 'updated_at']
  );

  for (const attempt of attempts) {
    const { error } = await supabase
      .from('orders')
      .update(attempt)
      .eq('transaction_id', transactionId);
    if (!error) return;
    if (!isMissingSchemaError(error)) {
      console.warn('[orders] update skipped:', error.message);
      return;
    }
  }
}

async function getOrderByTransactionId(transactionId) {
  if (!transactionId) return null;

  const selectAttempts = [
    'id, guest_token, buyer_email, user_id, status, delivery_payload, proof_uploaded, transaction_id',
    'id, guest_token, buyer_email, user_id, status, delivery_payload, transaction_id',
    'id, guest_token, buyer_email, user_id, status, transaction_id',
  ];

  for (const select of selectAttempts) {
    const { data, error } = await supabase
      .from('orders')
      .select(select)
      .eq('transaction_id', transactionId)
      .maybeSingle();
    if (!error) return data || null;
    if (!isMissingSchemaError(error)) {
      console.warn('[orders] lookup skipped:', error.message);
      return null;
    }
  }

  return null;
}

async function relinkGuestPurchasesToUser(email, userId) {
  if (!email || !userId) return;

  const normalizedEmail = String(email).trim().toLowerCase();
  const orderUpdateAttempts = buildOptionalColumnAttempts(
    { user_id: userId, updated_at: new Date().toISOString() },
    ['updated_at']
  );

  for (const attempt of orderUpdateAttempts) {
    const { error } = await supabase
      .from('orders')
      .update(attempt)
      .eq('buyer_email', normalizedEmail)
      .is('user_id', null);
    if (!error) break;
    if (!isMissingSchemaError(error)) {
      console.warn('[guest/relink] orders warning:', error.message);
      break;
    }
  }

  const { error: txRelinkError } = await supabase
    .from('transactions')
    .update({ user_id: userId })
    .eq('buyer_email', normalizedEmail)
    .is('user_id', null);
  if (txRelinkError && !isMissingSchemaError(txRelinkError)) {
    console.warn('[guest/relink] transactions warning:', txRelinkError.message);
  }
}

function buildGuestAuthPayload(user, req, extra = {}) {
  const authToken = issueJWT(user, req);
  return {
    ok: true,
    token: authToken,
    user: sanitizeUser({
      ...user,
      role: user.role || 'user',
      permissions: user.permissions || {},
    }),
    ...extra,
  };
}

function renderOrderCreatedEmail({
  buyerEmail,
  productName,
  orderId,
  amount,
  productImageUrl,
  isGuest,
  ctaUrl,
  isPendingOrder,
}) {
  const title = isPendingOrder ? 'Narudžba je evidentirana' : 'Narudžba je uspješno kreirana';
  const ctaLabel = isGuest ? 'Prati status porudžbine' : 'Prati svoju porudžbinu';
  const safeProductName = escServerHtml(productName || 'Digitalni proizvod');
  const imgBlock = productImageUrl
    ? `<div style="text-align:center;padding:12px 0 4px"><img src="${escServerHtml(productImageUrl)}" alt="${safeProductName}" style="max-width:220px;max-height:120px;object-fit:contain;border-radius:14px"/></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="bs"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:24px 12px;background:#f8fafc;font-family:Inter,Arial,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto">
    <div style="background:linear-gradient(135deg,#1D6AFF,#A259FF);border-radius:24px 24px 0 0;padding:28px 32px;color:#fff">
      <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;opacity:.8">Keyify Checkout</div>
      <h1 style="margin:10px 0 6px;font-size:28px;line-height:1.1">${title}</h1>
      <p style="margin:0;font-size:14px;opacity:.86">Narudžba za ${safeProductName} je sačuvana pod ID ${escServerHtml(orderId)}.</p>
    </div>
    <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 24px 24px;padding:28px 32px">
      ${imgBlock}
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:18px;padding:18px 20px;margin:18px 0 22px">
        <div style="display:flex;justify-content:space-between;gap:16px;font-size:14px;margin-bottom:10px">
          <span style="color:#64748b">Proizvod</span>
          <strong style="text-align:right">${safeProductName}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;gap:16px;font-size:14px;margin-bottom:10px">
          <span style="color:#64748b">Kupac</span>
          <strong style="text-align:right">${escServerHtml(buyerEmail)}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;gap:16px;font-size:14px">
          <span style="color:#64748b">Iznos</span>
          <strong style="text-align:right">€ ${Number(amount || 0).toFixed(2)}</strong>
        </div>
      </div>
      <p style="margin:0 0 22px;font-size:14px;line-height:1.7;color:#475569">${isGuest ? 'Vaš gost link je jedinstven i dovoljan za praćenje statusa ove kupovine.' : 'Sve promjene statusa i isporuke biće vidljive na vašoj Keyify stranici za narudžbine.'}</p>
      <div style="text-align:center">
        <a href="${escServerHtml(ctaUrl)}" style="display:inline-block;padding:14px 28px;border-radius:14px;background:linear-gradient(135deg,#1D6AFF,#A259FF);color:#fff;text-decoration:none;font-weight:700">${ctaLabel}</a>
      </div>
    </div>
  </div>
</body></html>`;
}

function renderOrderReadyEmail({
  buyerEmail,
  productName,
  orderId,
  amount,
  productImageUrl,
  deliveryPayload,
  ctaUrl,
}) {
  const safeProductName = escServerHtml(productName || 'Digitalni proizvod');
  const imgBlock = productImageUrl
    ? `<div style="text-align:center;padding:12px 0 4px"><img src="${escServerHtml(productImageUrl)}" alt="${safeProductName}" style="max-width:220px;max-height:120px;object-fit:contain;border-radius:14px"/></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="bs"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:24px 12px;background:#0f172a;font-family:Inter,Arial,sans-serif;color:#e2e8f0">
  <div style="max-width:560px;margin:0 auto">
    <div style="background:linear-gradient(135deg,#1D6AFF,#22c55e);border-radius:24px 24px 0 0;padding:28px 32px;color:#fff">
      <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;opacity:.8">Keyify Delivery</div>
      <h1 style="margin:10px 0 6px;font-size:28px;line-height:1.1">Vaš proizvod je spreman</h1>
      <p style="margin:0;font-size:14px;opacity:.86">Isporuka za ${safeProductName} je sada dostupna.</p>
    </div>
    <div style="background:#111827;border:1px solid rgba(255,255,255,0.08);border-top:none;border-radius:0 0 24px 24px;padding:28px 32px">
      ${imgBlock}
      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:18px;padding:18px 20px;margin:18px 0 22px">
        <div style="display:flex;justify-content:space-between;gap:16px;font-size:14px;margin-bottom:10px">
          <span style="color:#94a3b8">Proizvod</span>
          <strong style="text-align:right;color:#fff">${safeProductName}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;gap:16px;font-size:14px;margin-bottom:10px">
          <span style="color:#94a3b8">Kupac</span>
          <strong style="text-align:right;color:#fff">${escServerHtml(buyerEmail)}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;gap:16px;font-size:14px;margin-bottom:10px">
          <span style="color:#94a3b8">Iznos</span>
          <strong style="text-align:right;color:#22c55e">€ ${Number(amount || 0).toFixed(2)}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;gap:16px;font-size:14px">
          <span style="color:#94a3b8">ID</span>
          <strong style="text-align:right;color:#cbd5e1;font-family:monospace;font-size:12px">${escServerHtml(orderId || '—')}</strong>
        </div>
      </div>
      ${deliveryPayload ? `<div style="background:linear-gradient(135deg,#f0fdf4,#ecfeff);border:1px solid rgba(34,197,94,0.22);border-radius:18px;padding:18px 20px;margin:0 0 22px;color:#0f172a">
        <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#16a34a;margin-bottom:10px">Vaša isporuka</div>
        <div style="font-size:14px;line-height:1.7;color:#334155">${deliveryPayloadToEmailHtml(deliveryPayload)}</div>
      </div>` : ''}
      <div style="text-align:center">
        <a href="${escServerHtml(ctaUrl)}" style="display:inline-block;padding:14px 28px;border-radius:14px;background:linear-gradient(135deg,#1D6AFF,#A259FF);color:#fff;text-decoration:none;font-weight:700">Preuzmi pristup / ključ</a>
      </div>
    </div>
  </div>
</body></html>`;
}

/* ─────────────────────────────────────────
   Password history helpers
   Prevents reuse of the last 5 passwords.
───────────────────────────────────────── */
const PASSWORD_HISTORY_COUNT = 5;

/**
 * Returns an error string if newPassword matches the current password or
 * any of the last PASSWORD_HISTORY_COUNT archived passwords, else null.
 */
async function checkPasswordNotReused(userId, newPassword) {
  const [{ data: user }, { data: history }] = await Promise.all([
    supabase.from('users').select('password_hash').eq('id', userId).maybeSingle(),
    supabase.from('password_history')
      .select('password_hash')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(PASSWORD_HISTORY_COUNT),
  ]);

  const hashes = [
    user?.password_hash,
    ...(history || []).map(h => h.password_hash),
  ].filter(Boolean);

  for (const hash of hashes) {
    if (await bcrypt.compare(newPassword, hash)) {
      return `Ne možete koristiti jednu od zadnjih ${PASSWORD_HISTORY_COUNT} lozinki. Odaberite novu lozinku.`;
    }
  }
  return null;
}

/**
 * Archives the user's current password_hash before it gets replaced.
 */
async function archiveCurrentPassword(userId) {
  const { data: user } = await supabase
    .from('users').select('password_hash').eq('id', userId).maybeSingle();
  if (user?.password_hash) {
    await supabase.from('password_history').insert({
      user_id:       userId,
      password_hash: user.password_hash,
    });
  }
}

/* ─────────────────────────────────────────
   JWT Middleware
───────────────────────────────────────── */
async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Pristup odbijen – nema tokena' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Session binding: validate IP + UA fingerprint if token carries them
    if (decoded.ip || decoded.ua) {
      const currentIP = getClientIP(req);
      const currentUA = hashUA(req.headers['user-agent']);
      if (decoded.ip && decoded.ip !== currentIP) {
        return res.status(401).json({ error: 'Sesija nije važeća – IP adresa se promijenila' });
      }
      if (decoded.ua && decoded.ua !== currentUA) {
        return res.status(401).json({ error: 'Sesija nije važeća – uređaj se promijenio' });
      }
    }

    // Load permissions + rank fresh from DB (enables real-time permission changes)
    const { data: userRow } = await supabase
      .from('users')
      .select('permissions, rank')
      .eq('id', decoded.id)
      .maybeSingle();
    req.user = {
      ...decoded,
      permissions: userRow?.permissions || {},
      rank: userRow?.rank || 'user',
    };
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Token je nevažeći ili je istekao' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Pristup odbijen – admin only' });
  }
  next();
}

/**
 * RBAC middleware factory.
 * Passes if:
 *   - role === 'admin' AND permissions is empty {} (super admin – no restrictions)
 *   - role === 'admin' AND permissions[permName] === true (limited admin with specific perm)
 */
function checkPermission(permName) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Pristup odbijen' });
    // Super admin: rank or empty permissions = unrestricted
    if (req.user.rank === 'super_admin') return next();
    const perms = req.user.permissions;
    if (!perms || Object.keys(perms).length === 0) return next();
    // Limited admin: must have specific permission set to true
    if (perms[permName] === true) return next();
    return res.status(403).json({ error: `Nedovoljne dozvole: ${permName}` });
  };
}

/* ─────────────────────────────────────────
   AUTH ROUTES
───────────────────────────────────────── */

/**
 * POST /api/register
 * Body: { name, email, password }
 */
app.post('/api/register', authLimiter, async (req, res) => {
  const { name, email, password, referral_code } = req.body;

  // Validation
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Sva polja su obavezna' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Nevažeća email adresa' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Lozinka mora biti min. 8 karaktera' });

  // Check duplicate
  const { data: existing } = await supabase
    .from('users')
    .select('id, name, email, role, permissions, avatar_url')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (existing)
    return res.status(409).json({ error: 'Email adresa je već registrovana' });

  const password_hash = await bcrypt.hash(password, 12);
  const ip = getClientIP(req);

  const { data: user, error } = await supabase
    .from('users')
    .insert({
      name:            name.trim(),
      email:           email.toLowerCase().trim(),
      password_hash,
      role:            'user',
      is_verified:     false,
      registered_ip:   ip,
      created_at:      new Date().toISOString(),
    })
    .select('id, name, email, role')
    .single();

  if (error) {
    console.error('Register error:', error);
    return res.status(500).json({ error: 'Greška pri registraciji. Pokušajte ponovo.' });
  }

  // Audit log
  await supabase.from('audit_logs').insert({
    user_id:    user.id,
    action:     'register',
    ip,
    created_at: new Date().toISOString(),
  });

  // Track referral if code provided
  if (referral_code?.trim()) {
    try {
      const { data: refCode } = await supabase
        .from('referral_codes')
        .select('user_id')
        .ilike('code', referral_code.trim())
        .maybeSingle();
      if (refCode && refCode.user_id !== user.id) {
        await supabase.from('referrals').insert({
          referrer_id: refCode.user_id,
          referred_id: user.id,
          status: 'registered',
        });
      }
    } catch (e) { console.error('[referral-track]', e.message); }
  }

  return res.status(201).json({
    message: 'Registracija uspješna! Možete se prijaviti.',
  });
});

/**
 * POST /api/login
 * Body: { email, password }
 * Returns: { user_id, message } – OTP sent to email
 */
app.post('/api/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Unesite email i lozinku' });

  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();

  // Constant-time check (prevent timing attacks)
  const dummyHash = '$2a$12$invalidhashforunknownuserXXXXXXXXXXXXXXXXXXXXXX';
  const valid = await bcrypt.compare(password, user?.password_hash || dummyHash);

  if (!user || !valid)
    return res.status(401).json({ error: 'Pogrešan email ili lozinka' });

  const ip = getClientIP(req);
  const ua = hashUA(req.headers['user-agent']);

  // ── Trusted device check (skip OTP if recognised) ──────────────
  // Clean up expired records first (best-effort, don't block login)
  supabase.from('trusted_devices').delete().lt('expires_at', new Date().toISOString()).then(() => {});

  const { data: trustedRows } = await supabase
    .from('trusted_devices')
    .select('id, name, email, role, permissions, avatar_url')
    .eq('user_id', user.id)
    .eq('ip', ip)
    .eq('ua_hash', ua)
    .gt('expires_at', new Date().toISOString())
    .limit(1);

  const trusted = trustedRows?.[0];

  if (trusted) {
    // Roll the 30-day window forward on each trusted login
    await supabase
      .from('trusted_devices')
      .update({ expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() })
      .eq('id', trusted.id);

    const jwtToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name, ip, ua },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );

    await supabase.from('audit_logs').insert({
      user_id:    user.id,
      action:     'login_trusted_device',
      ip,
      created_at: new Date().toISOString(),
    });

    return res.json({
      token:       jwtToken,
      role:        user.role,
      name:        user.name,
      email:       user.email,
      avatar_url:  user.avatar_url || null,
      permissions: user.permissions || {},
      trusted:     true,
    });
  }
  // ───────────────────────────────────────────────────────────────

  // Generate 6-digit OTP valid for 10 minutes
  const otp      = generateOTP();
  const otp_exp  = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await supabase
    .from('users')
    .update({ otp_code: otp, otp_expires: otp_exp })
    .eq('id', user.id);

  // Send OTP email
  const otpHTML = `
    <div style="font-family:'Inter',Arial,sans-serif;max-width:440px;margin:0 auto;background:#0f0f1a;border-radius:16px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#1D6AFF,#A259FF);padding:24px 32px">
        <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">🔐 Keyify Verifikacija</h1>
      </div>
      <div style="padding:32px">
        <p style="color:#aaa;margin:0 0 8px">Zdravo, <strong style="color:#fff">${user.name}</strong>!</p>
        <p style="color:#aaa;margin:0 0 24px">Vaš jednokratni kod za prijavu:</p>
        <div style="background:#1a1a2e;border:2px solid #1D6AFF;border-radius:12px;padding:24px;text-align:center;font-size:40px;font-weight:800;letter-spacing:14px;color:#1D6AFF;font-family:monospace">${otp}</div>
        <p style="color:#666;font-size:12px;margin:20px 0 0;text-align:center">Kod je važeći <strong style="color:#aaa">10 minuta</strong>. Nemojte ga dijeliti ni sa kim.</p>
        <p style="color:#444;font-size:11px;text-align:center;margin:8px 0 0">Ako niste vi iniciirali prijavu, zanemarite ovaj email.</p>
      </div>
    </div>`;

  try {
    await sendMailSafe({
      from:    process.env.EMAIL_FROM || `"Keyify" <${process.env.EMAIL_USER}>`,
      to:      user.email,
      subject: `Keyify – Vaš verifikacijski kod: ${otp}`,
      html:    otpHTML,
    });
  } catch (emailErr) {
    console.error('Email send failed:', emailErr.message, emailErr.stack);
    return res.status(500).json({ error: 'Greška pri slanju verifikacijskog koda. Pokušajte ponovo.' });
  }

  await supabase.from('audit_logs').insert({
    user_id:    user.id,
    action:     'login_attempt',
    ip,
    created_at: new Date().toISOString(),
  });

  return res.json({
    message: `Verifikacijski kod je poslan na ${user.email}`,
    user_id: user.id,
  });
});

/**
 * POST /api/verify
 * Body: { user_id, otp }
 * Returns: { token, role, name, email }
 */
app.post('/api/verify', authLimiter, async (req, res) => {
  const { user_id, otp, remember_device } = req.body;
  if (!user_id || !otp)
    return res.status(400).json({ error: 'Nedostaju podaci' });

  const { data: user } = await supabase
    .from('users')
    .select('id, name, email, role, permissions, otp_code, otp_expires, avatar_url')
    .eq('id', user_id)
    .maybeSingle();

  if (!user)
    return res.status(404).json({ error: 'Korisnik nije pronađen' });
  if (user.otp_code !== otp.trim())
    return res.status(401).json({ error: 'Pogrešan verifikacijski kod' });
  if (!user.otp_expires || new Date() > new Date(user.otp_expires))
    return res.status(401).json({ error: 'Verifikacijski kod je istekao. Prijavite se ponovo.' });

  // Clear OTP + mark verified
  await supabase
    .from('users')
    .update({ otp_code: null, otp_expires: null, is_verified: true })
    .eq('id', user.id);

  const ip = getClientIP(req);
  const ua = hashUA(req.headers['user-agent']);

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name, ip, ua },
    process.env.JWT_SECRET,
    { expiresIn: '2h' }
  );

  // ── Save trusted device if requested ───────────────────────────
  if (remember_device) {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    // Remove any existing records for this device, then insert fresh
    await supabase
      .from('trusted_devices')
      .delete()
      .eq('user_id', user.id)
      .eq('ip', ip)
      .eq('ua_hash', ua);
    await supabase
      .from('trusted_devices')
      .insert({ user_id: user.id, ip, ua_hash: ua, expires_at: expiresAt });
  }
  // ───────────────────────────────────────────────────────────────

  await supabase.from('audit_logs').insert({
    user_id:    user.id,
    action:     'login_success',
    ip,
    created_at: new Date().toISOString(),
  });

  return res.json({
    token,
    role:        user.role,
    name:        user.name,
    email:       user.email,
    avatar_url:  user.avatar_url || null,
    permissions: user.permissions || {},
  });
});

/* ─────────────────────────────────────────
   ADMIN ROUTES
───────────────────────────────────────── */

/**
 * GET /api/admin/stats
 * Returns: { users[], total_users, revenue, total_transactions, logs[] }
 */
app.get('/api/admin/stats', authenticateToken, requireAdmin, async (req, res) => {
  const [usersRes, txRes, logsRes] = await Promise.all([
    supabase
      .from('users')
      .select('id, name, email, role, rank, permissions, registered_ip, created_at, is_verified, avatar_url')
      .order('created_at', { ascending: false }),

    supabase
      .from('transactions')
      .select('id, amount, status, product_name, created_at'),

    supabase
      .from('audit_logs')
      .select('id, action, ip, created_at, users(name, email)')
      .order('created_at', { ascending: false })
      .limit(100),
  ]);

  const transactions = txRes.data || [];
  const revenue = transactions
    .filter(t => t.status === 'completed')
    .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);

  return res.json({
    users:              (usersRes.data || []).map(sanitizeUser),
    total_users:        (usersRes.data || []).length,
    revenue:            revenue.toFixed(2),
    total_transactions: transactions.length,
    transactions,
    logs:               logsRes.data || [],
  });
});

/**
 * GET /api/admin/settings
 */
app.get('/api/admin/settings', authenticateToken, requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('site_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  if (error) return res.status(500).json({ error: 'Greška pri čitanju podešavanja' });
  const settings = data || {};
  // Mask the encrypted secret — admin sees if it's set, but never the actual value
  if (settings.paypal_secret_enc) {
    settings.paypal_secret_set = true;
    delete settings.paypal_secret_enc;
  }
  return res.json(settings);
});

/**
 * POST /api/admin/settings
 * Body: { primary_color, panel_bg, paypal_email, paypal_client_id, paypal_secret,
 *         btc_wallet, eth_wallet, usdt_wallet, bank_iban, bank_name }
 */
app.post('/api/admin/settings', authenticateToken, requireAdmin, async (req, res) => {
  const {
    primary_color, panel_bg,
    paypal_email, paypal_client_id, paypal_secret,
    btc_wallet, eth_wallet, usdt_wallet,
    bank_iban, bank_name,
    facebook_url, twitter_url, instagram_url,
  } = req.body;

  const { data: existingSettings, error: existingError } = await supabase
    .from('site_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  if (existingError) {
    console.error('Settings read error:', existingError);
    return res.status(500).json({ error: 'Greška pri čitanju postojećih podešavanja' });
  }

  const row = {
    ...(existingSettings || {}),
    id: 1,
    updated_at: new Date().toISOString(),
  };

  const assignIfProvided = (key, value, fallback = value) => {
    if (value !== undefined) row[key] = fallback;
  };

  assignIfProvided('primary_color', primary_color);
  assignIfProvided('panel_bg', panel_bg);
  assignIfProvided('paypal_email', paypal_email);
  assignIfProvided('paypal_client_id', paypal_client_id, paypal_client_id || null);
  assignIfProvided('btc_wallet', btc_wallet);
  assignIfProvided('eth_wallet', eth_wallet);
  assignIfProvided('usdt_wallet', usdt_wallet);
  assignIfProvided('bank_iban', bank_iban);
  assignIfProvided('bank_name', bank_name);
  assignIfProvided('facebook_url', facebook_url, facebook_url || null);
  assignIfProvided('twitter_url', twitter_url, twitter_url || null);
  assignIfProvided('instagram_url', instagram_url, instagram_url || null);

  // Encrypt PayPal secret if provided (never store in plaintext)
  if (paypal_secret && paypal_secret.trim()) {
    row.paypal_secret_enc = encryptField(paypal_secret.trim());
  }

  const { error } = await supabase
    .from('site_settings')
    .upsert(row);

  if (error) {
    console.error('Settings error:', error);
    return res.status(500).json({ error: 'Greška pri čuvanju podešavanja' });
  }

  return res.json({ message: 'Podešavanja su uspješno sačuvana' });
});

/**
 * GET /api/public/social-links – no auth, returns only social URLs
 */
app.get('/api/public/social-links', async (req, res) => {
  const { data } = await supabase
    .from('site_settings')
    .select('facebook_url, twitter_url, instagram_url')
    .eq('id', 1)
    .maybeSingle();
  return res.json({
    facebook_url:  (data && data.facebook_url)  || '',
    twitter_url:   (data && data.twitter_url)   || '',
    instagram_url: (data && data.instagram_url) || '',
  });
});

const FALLBACK_CATEGORIES = [
  { id: null, slug: 'ai',        name: 'AI Alati',               page_slug: 'ai',        aliases: ['ai-tools', 'ai-alati'] },
  { id: null, slug: 'design',    name: 'Design & Creativity',    page_slug: 'design',    aliases: ['design-creativity', 'design-and-creativity'] },
  { id: null, slug: 'business',  name: 'Business Software',      page_slug: 'business',  aliases: ['business-software'] },
  { id: null, slug: 'windows',   name: 'Windows & Office',       page_slug: 'windows',   aliases: ['windows-office', 'office'] },
  { id: null, slug: 'music',     name: 'Music Streaming',        page_slug: 'music',     aliases: ['music-streaming', 'streaming-music'] },
  { id: null, slug: 'streaming', name: 'TV/Video Streaming',     page_slug: 'streaming', aliases: ['video-streaming', 'tv-streaming', 'streaming-tv-video'] },
];

function normalizeCategoryValue(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[()]/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isMissingSchemaError(error) {
  const message = error?.message || '';
  return /relation .* does not exist|column .* does not exist|schema cache/i.test(message);
}

function findFallbackCategory(value) {
  const normalized = normalizeCategoryValue(value);
  if (!normalized) return null;

  return FALLBACK_CATEGORIES.find((category) => {
    const aliases = [category.slug, category.page_slug, ...(category.aliases || [])];
    return aliases.some((alias) => normalizeCategoryValue(alias) === normalized);
  }) || null;
}

async function listCategories() {
  const columnAttempts = [
    'id, slug, name, label, page_slug, sort_order, is_active',
    'id, slug, name, page_slug, sort_order, is_active',
    'id, slug, name, sort_order, is_active',
    'id, slug, name',
  ];

  let data = null;
  let error = null;

  for (const columns of columnAttempts) {
    let query = supabase
      .from('categories')
      .select(columns);

    query = columns.includes('sort_order')
      ? query.order('sort_order', { ascending: true })
      : query.order('name', { ascending: true });

    const result = await query;

    data = result.data;
    error = result.error;

    if (!error) break;
    if (!isMissingSchemaError(error)) {
      console.error('[categories] load error:', error.message);
      break;
    }
  }

  if (error || !data?.length) {
    return FALLBACK_CATEGORIES.map((category, index) => ({
      ...category,
      sort_order: index,
      is_active: true,
    }));
  }

  return data
    .filter((row) => row.is_active !== false)
    .map((row, index) => ({
      id: row.id || null,
      slug: normalizeCategoryValue(row.slug || row.page_slug || row.name || row.label),
      name: row.name || row.label || row.slug || row.page_slug || 'Kategorija',
      page_slug: normalizeCategoryValue(row.page_slug || row.slug || row.name || row.label),
      sort_order: row.sort_order ?? index,
      is_active: row.is_active !== false,
    }))
    .filter((category) => category.slug);
}

async function resolveCategoryInput({ category, category_slug, category_id } = {}) {
  const categories = await listCategories();

  if (category_id) {
    const byId = categories.find((item) => item.id && String(item.id) === String(category_id));
    if (byId) return byId;
  }

  const fallback = findFallbackCategory(category_slug || category);
  const normalized = fallback?.slug || normalizeCategoryValue(category_slug || category);
  if (!normalized) return null;

  return categories.find((item) => item.slug === normalized || item.page_slug === normalized) || fallback || null;
}

function buildCategoryFilters(category) {
  const filters = [];
  if (category?.id) filters.push(`category_id.eq.${category.id}`);
  if (category?.slug) filters.push(`category.eq.${category.slug}`);
  return filters;
}

async function queryProducts({ resolvedCategory, orderColumn, ascending }) {
  const filters = buildCategoryFilters(resolvedCategory);

  const run = async (useCategoryId) => {
    let query = supabase.from('products').select('*');

    if (resolvedCategory?.slug) {
      if (useCategoryId && filters.length > 1) {
        query = query.or(filters.join(','));
      } else {
        query = query.eq('category', resolvedCategory.slug);
      }
    }

    return query.order(orderColumn, { ascending });
  };

  let result = await run(true);
  if (result.error && /category_id/i.test(result.error.message || '')) {
    result = await run(false);
  }
  return result;
}

async function persistProductRecord(mode, id, payload) {
  const apply = async (body) => {
    const query = mode === 'insert'
      ? supabase.from('products').insert(body)
      : supabase.from('products').update(body).eq('id', id);

    return query.select().single();
  };

  let result = await apply(payload);
  if (result.error && payload.category_id && /category_id/i.test(result.error.message || '')) {
    const legacyPayload = { ...payload };
    delete legacyPayload.category_id;
    result = await apply(legacyPayload);
  }
  if (result.error && payload.required_user_inputs && /required_user_inputs/i.test(result.error.message || '')) {
    const legacyPayload = { ...payload };
    delete legacyPayload.required_user_inputs;
    result = await apply(legacyPayload);
  }

  return result;
}

app.get('/api/categories', async (req, res) => {
  try {
    const categories = await listCategories();
    return res.json(categories);
  } catch (error) {
    console.error('[categories] response error:', error.message);
    return res.status(500).json({ error: 'Greška pri dohvaćanju kategorija' });
  }
});

/* ─────────────────────────────────────────
   PRODUCTS ROUTES
───────────────────────────────────────── */

/* Multer: memory storage, 10 MB limit, images only */
const productUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Dozvoljene su samo slike (image/*)'));
  },
}).single('image');

/* Upload a file buffer to Supabase Storage → returns public URL */
async function uploadProductImage(file) {
  const ext      = (file.originalname.split('.').pop() || 'jpg').toLowerCase();
  const filePath = `products/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  const { error } = await supabase.storage
    .from('product-images')
    .upload(filePath, file.buffer, { contentType: file.mimetype, upsert: false });
  if (error) throw new Error(`Storage: ${error.message}`);
  const { data: { publicUrl } } = supabase.storage.from('product-images').getPublicUrl(filePath);
  return publicUrl;
}

/** GET /api/products – public */
app.get('/api/products', async (req, res) => {
  const resolvedCategory = await resolveCategoryInput(req.query);
  const categories = await listCategories();
  const categoryById = new Map(categories.filter((item) => item.id).map((item) => [String(item.id), item]));

  // Try ordering by grid_order; fall back to created_at if column doesn't exist
  let { data, error } = await queryProducts({
    resolvedCategory,
    orderColumn: 'grid_order',
    ascending: true,
  });

  if (error) {
    console.error('[products] grid_order query failed:', error.message);
    const res2 = await queryProducts({
      resolvedCategory,
      orderColumn: 'created_at',
      ascending: false,
    });
    data  = res2.data;
    error = res2.error;
  }

  if (error) {
    console.error('[products] Supabase error:', error.message);
    return res.status(500).json({ error: 'Greška pri dohvaćanju proizvoda' });
  }

  data = (data || []).map((product) => {
    const categoryMeta =
      (product.category_id && categoryById.get(String(product.category_id))) ||
      findFallbackCategory(product.category || product.category_slug);
    const categorySlug = categoryMeta?.slug || normalizeCategoryValue(product.category || product.category_slug);

    return {
      ...product,
      category: categorySlug || product.category || null,
      category_slug: categorySlug || null,
      category_label: categoryMeta?.name || categorySlug || 'Kategorija',
      category_id: product.category_id || categoryMeta?.id || null,
    };
  });

  // Attach min/max variant prices for price-range display
  if (data && data.length) {
    const productIds = data.map(p => p.id);
    const { data: variantPrices, error: variantError } = await supabase
      .from('product_variants')
      .select('product_id, price')
      .in('product_id', productIds);

    if (variantError && !isMissingSchemaError(variantError)) {
      console.error('[products] variant lookup failed:', variantError.message);
    }

    if (variantPrices && variantPrices.length) {
      const priceMap = {};
      variantPrices.forEach(v => {
        if (!priceMap[v.product_id]) priceMap[v.product_id] = [];
        priceMap[v.product_id].push(parseFloat(v.price));
      });
      data.forEach(p => {
        const prices = priceMap[p.id];
        if (prices && prices.length) {
          p.min_variant_price = Math.min(...prices);
          p.max_variant_price = Math.max(...prices);
          p.package_count = prices.length;
        }
      });
    }
  }

  return res.json(data || []);
});

/** GET /api/products/:id – single product by ID (with variants + features) */
app.get('/api/products/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: 'Greška' });
  if (!data) return res.status(404).json({ error: 'Proizvod nije pronađen' });

  // Fetch variants and features (non-blocking, graceful fallback)
  const [varRes, featRes] = await Promise.all([
    supabase.from('product_variants').select('*').eq('product_id', data.id).order('sort_order'),
    supabase.from('product_features').select('*').eq('product_id', data.id).order('sort_order'),
  ]);
  data.variants = varRes.data || [];
  data.features = featRes.data || [];
  const categoryMeta = await resolveCategoryInput({
    category: data.category,
    category_id: data.category_id,
  });
  data.category = categoryMeta?.slug || data.category || null;
  data.category_slug = categoryMeta?.slug || null;
  data.category_label = categoryMeta?.name || data.category || 'Kategorija';
  data.category_id = data.category_id || categoryMeta?.id || null;

  return res.json(data);
});

/** POST /api/products – admin only */
app.post('/api/products', authenticateToken, requireAdmin, (req, res, next) => {
  productUpload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  const {
    name_sr, name_en,
    description_sr, description_en,
    price, original_price,
    category, category_slug, category_id,
    image_url, badge, stars, required_user_inputs,
  } = req.body;

  let variants = [];
  let features = [];
  try { variants = JSON.parse(req.body.variants || '[]'); } catch { return res.status(400).json({ error: 'Neispravan format paketa' }); }
  try { features = JSON.parse(req.body.features || '[]'); } catch { return res.status(400).json({ error: 'Neispravan format karakteristika' }); }

  const resolvedCategory = await resolveCategoryInput({ category, category_slug, category_id });
  const requiredUserInputs = normalizeRequiredUserInputs(required_user_inputs);
  const productNameSr = name_sr || name_en;
  const productNameEn = name_en || name_sr || name_en;
  const variantPrices = variants
    .map((variant) => parseFloat(variant.price))
    .filter((variantPrice) => Number.isFinite(variantPrice) && variantPrice > 0);
  const basePrice = Number.isFinite(parseFloat(price)) && parseFloat(price) > 0
    ? parseFloat(price)
    : (variantPrices.length ? Math.min(...variantPrices) : NaN);

  if (!productNameSr || !Number.isFinite(basePrice) || !resolvedCategory?.slug) {
    return res.status(400).json({ error: 'Naziv, cijena i validna kategorija su obavezni' });
  }

  // File upload takes priority over URL
  let finalImageUrl = image_url || null;
  if (req.file) {
    try { finalImageUrl = await uploadProductImage(req.file); }
    catch (e) { return res.status(500).json({ error: e.message }); }
  }

  const starsVal = stars !== undefined ? Math.min(5, Math.max(1, parseInt(stars) || 5)) : 5;

  const { data, error } = await persistProductRecord('insert', null, {
      name_sr:        productNameSr,
      name_en:        productNameEn,
      description_sr,
      description_en,
      price:          basePrice,
      original_price: original_price ? parseFloat(original_price) : null,
      category:       resolvedCategory.slug,
      category_id:    resolvedCategory.id || undefined,
      image_url:      finalImageUrl,
      badge:          badge || null,
      stars:          starsVal,
      bonus_coupon_id:  req.body.bonus_coupon_id || null,
      delivery_message: req.body.delivery_message || null,
      required_user_inputs: requiredUserInputs,
      warranty_text:    req.body.warranty_text || null,
      created_at:     new Date().toISOString(),
    });

  if (error) {
    console.error('Product create error:', error);
    return res.status(500).json({ error: 'Greška pri kreiranju proizvoda' });
  }

  // Save variants and features if provided
  try {
    if (variants.length) {
      await supabase.from('product_variants').insert(
        variants.map((v, i) => ({ product_id: data.id, label: v.label, variant_type: v.variant_type || 'duration', price: parseFloat(v.price), original_price: v.original_price ? parseFloat(v.original_price) : null, sort_order: i }))
      );
    }
    if (features.length) {
      await supabase.from('product_features').insert(
        features.map((f, i) => ({ product_id: data.id, text_sr: f.text_sr, text_en: f.text_en || null, sort_order: i }))
      );
    }
  } catch (e) { console.error('Variants/features save error:', e.message); }

  return res.status(201).json(data);
});

/** PUT /api/products/:id – admin only */
app.put('/api/products/:id', authenticateToken, requireAdmin, (req, res, next) => {
  productUpload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  const { id } = req.params;
  const {
    name_sr, name_en, description_sr, description_en,
    price, original_price, category, category_slug, category_id, image_url,
    badge, stars, card_size, grid_order,
  } = req.body;

  let variants;
  let features;
  if (req.body.variants !== undefined) {
    try { variants = JSON.parse(req.body.variants || '[]'); }
    catch { return res.status(400).json({ error: 'Neispravan format paketa' }); }
  }
  if (req.body.features !== undefined) {
    try { features = JSON.parse(req.body.features || '[]'); }
    catch { return res.status(400).json({ error: 'Neispravan format karakteristika' }); }
  }

  const updates = {};
  if (name_sr          !== undefined) updates.name_sr          = name_sr;
  if (name_en          !== undefined) updates.name_en          = name_en;
  if (description_sr   !== undefined) updates.description_sr   = description_sr;
  if (description_en   !== undefined) updates.description_en   = description_en;
  if (price            !== undefined && price !== '') updates.price = parseFloat(price);
  if (original_price   !== undefined) updates.original_price   = original_price ? parseFloat(original_price) : null;
  if (badge            !== undefined) updates.badge            = badge || null;
  if (stars            !== undefined) updates.stars            = Math.min(5, Math.max(1, parseInt(stars) || 5));
  if (card_size        !== undefined) updates.card_size        = card_size;
  if (grid_order       !== undefined) updates.grid_order       = Number(grid_order);
  if (req.body.bonus_coupon_id !== undefined)  updates.bonus_coupon_id  = req.body.bonus_coupon_id || null;
  if (req.body.delivery_message !== undefined) updates.delivery_message = req.body.delivery_message || null;
  if (req.body.required_user_inputs !== undefined) updates.required_user_inputs = normalizeRequiredUserInputs(req.body.required_user_inputs);
  if (req.body.warranty_text !== undefined) updates.warranty_text = req.body.warranty_text || null;

  if (category !== undefined || category_slug !== undefined || category_id !== undefined) {
    const resolvedCategory = await resolveCategoryInput({ category, category_slug, category_id });
    if (!resolvedCategory?.slug) {
      return res.status(400).json({ error: 'Odabrana kategorija ne postoji' });
    }
    updates.category = resolvedCategory.slug;
    updates.category_id = resolvedCategory.id || undefined;
  }

  if (variants) {
    const variantPrices = variants
      .map((variant) => parseFloat(variant.price))
      .filter((variantPrice) => Number.isFinite(variantPrice) && variantPrice > 0);
    if (variantPrices.length && updates.price === undefined) {
      updates.price = Math.min(...variantPrices);
    }
  }

  // File upload takes priority; fall back to URL field; undefined = keep existing
  if (req.file) {
    try { updates.image_url = await uploadProductImage(req.file); }
    catch (e) { return res.status(500).json({ error: e.message }); }
  } else if (image_url !== undefined) {
    updates.image_url = image_url || null;
  }

  if (!Object.keys(updates).length)
    return res.status(400).json({ error: 'Nema podataka za ažuriranje' });

  updates.updated_at = new Date().toISOString();

  const persisted = await persistProductRecord('update', id, updates);
  const data = persisted.data;
  const error = persisted.error;

  if (error) {
    console.error('Product update error:', error);
    return res.status(500).json({ error: 'Greška pri ažuriranju' });
  }

  // Update variants and features if provided
  try {
    if (variants !== undefined) {
      await supabase.from('product_variants').delete().eq('product_id', id);
      if (variants.length) {
        await supabase.from('product_variants').insert(
          variants.map((v, i) => ({ product_id: id, label: v.label, variant_type: v.variant_type || 'duration', price: parseFloat(v.price), original_price: v.original_price ? parseFloat(v.original_price) : null, sort_order: i }))
        );
      }
    }
    if (features !== undefined) {
      await supabase.from('product_features').delete().eq('product_id', id);
      if (features.length) {
        await supabase.from('product_features').insert(
          features.map((f, i) => ({ product_id: id, text_sr: f.text_sr, text_en: f.text_en || null, sort_order: i }))
        );
      }
    }
  } catch (e) { console.error('Variants/features update error:', e.message); }

  return res.json(data);
});

/** DELETE /api/products/:id – admin only */
app.delete('/api/products/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const variantDelete = await supabase.from('product_variants').delete().eq('product_id', id);
    if (variantDelete.error && !isMissingSchemaError(variantDelete.error)) {
      console.error('[products/delete] variants:', variantDelete.error.message);
    }

    const featureDelete = await supabase.from('product_features').delete().eq('product_id', id);
    if (featureDelete.error && !isMissingSchemaError(featureDelete.error)) {
      console.error('[products/delete] features:', featureDelete.error.message);
    }
  } catch (cleanupError) {
    console.error('[products/delete] cleanup failed:', cleanupError.message);
  }

  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) {
    console.error('[products/delete] product:', error.message);
    return res.status(500).json({ error: 'Greška pri brisanju' });
  }

  return res.json({ message: 'Proizvod je obrisan' });
});

/* ─────────────────────────────────────────
   ADMIN: User management
───────────────────────────────────────── */

/** GET /api/admin/users/:id/logs */
app.get('/api/admin/users/:id/logs', authenticateToken, requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('id, action, ip, created_at')
    .eq('user_id', req.params.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: 'Greška' });
  return res.json(data || []);
});

/** GET /api/admin/users/:id/purchases */
app.get('/api/admin/users/:id/purchases', authenticateToken, requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', req.params.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Greška' });
  return res.json(data || []);
});

/** PUT /api/admin/users/:id */
app.put('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { email, password } = req.body;
  const updates = {};

  if (email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'Nevažeći email' });
    const { data: existing } = await supabase
      .from('users').select('id').eq('email', email.toLowerCase()).maybeSingle();
    if (existing && existing.id !== id)
      return res.status(409).json({ error: 'Email već postoji' });
    updates.email = email.toLowerCase().trim();
  }

  if (password) {
    if (password.length < 8)
      return res.status(400).json({ error: 'Lozinka mora biti min. 8 karaktera' });
    const reuseError = await checkPasswordNotReused(id, password);
    if (reuseError) return res.status(400).json({ error: reuseError });
    await archiveCurrentPassword(id);
    updates.password_hash = await bcrypt.hash(password, 12);
  }

  if (!Object.keys(updates).length)
    return res.status(400).json({ error: 'Nema podataka za ažuriranje' });

  const { error } = await supabase.from('users').update(updates).eq('id', id);
  if (error) return res.status(500).json({ error: 'Greška pri ažuriranju' });
  return res.json({ message: 'Korisnik ažuriran' });
});

/** DELETE /api/admin/users/:id */
app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (id === req.user.id)
    return res.status(400).json({ error: 'Ne možeš obrisati sopstveni nalog' });
  const { error } = await supabase.from('users').delete().eq('id', id);
  if (error) return res.status(500).json({ error: 'Greška pri brisanju' });
  return res.json({ message: 'Korisnik obrisan' });
});

/* ─────────────────────────────────────────
   USER: Self-service settings
───────────────────────────────────────── */

/**
 * GET /api/user/purchases
 * Logged-in:  Bearer token  → filters by user_id
 * Guest:      ?email=x@y.z  → filters by buyer_email (no token needed)
 */
app.get('/api/user/purchases', async (req, res) => {
  // Try to resolve logged-in user from JWT
  let userId    = null;
  let guestEmail = null;
  const authHeader = req.headers['authorization'];
  const jwtToken   = authHeader && authHeader.split(' ')[1];
  if (jwtToken) {
    try { const d = jwt.verify(jwtToken, process.env.JWT_SECRET); userId = d.id; } catch {}
  }

  if (!userId) {
    guestEmail = (req.query.email || '').trim().toLowerCase();
    if (!guestEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail))
      return res.status(401).json({ error: 'Prijavite se ili proslijedite ?email= parametar' });
  }

  const purchaseQueryAttempts = userId
    ? [
        'id, product_id, product_name, product_image, amount, payment_method, status, verification_status, license_key, buyer_email, delivery_payload, proof_uploaded, created_at',
        'id, product_id, product_name, product_image, amount, payment_method, status, verification_status, license_key, buyer_email, delivery_payload, created_at',
        'id, product_id, product_name, amount, payment_method, status, verification_status, license_key, buyer_email, created_at',
        'id, product_id, product_name, amount, payment_method, status, license_key, buyer_email, created_at',
        'id, product_id, product_name, amount, payment_method, status, license_key, created_at',
        'id, product_id, product_name, amount, payment_method, status, created_at',
      ].map((select) => ({ select, filterColumn: 'user_id', filterValue: userId }))
    : [
        'id, product_id, product_name, product_image, amount, payment_method, status, verification_status, license_key, buyer_email, delivery_payload, proof_uploaded, created_at',
        'id, product_id, product_name, product_image, amount, payment_method, status, verification_status, license_key, buyer_email, delivery_payload, created_at',
        'id, product_id, product_name, amount, payment_method, status, verification_status, license_key, buyer_email, created_at',
        'id, product_id, product_name, amount, payment_method, status, buyer_email, created_at',
      ].map((select) => ({ select, filterColumn: 'buyer_email', filterValue: guestEmail }));

  let purchaseData = null;
  let purchaseError = null;
  for (const attempt of purchaseQueryAttempts) {
    const result = await supabase
      .from('transactions')
      .select(attempt.select)
      .order('created_at', { ascending: false })
      .limit(100)
      .eq(attempt.filterColumn, attempt.filterValue);

    purchaseData = result.data;
    purchaseError = result.error;
    if (!purchaseError) {
      const txIds = (purchaseData || []).map((row) => row.id).filter(Boolean);
      const productIds = [...new Set(
        (purchaseData || [])
          .filter((row) => !row.product_image && row.product_id)
          .map((row) => row.product_id)
      )];
      let proofMap = {};
      let productImageMap = {};

      if (txIds.length) {
        const { data: verifications } = await supabase
          .from('payment_verifications')
          .select('transaction_id')
          .in('transaction_id', txIds);
        if (verifications) {
          verifications.forEach((row) => { proofMap[row.transaction_id] = true; });
        }
      }

      if (productIds.length) {
        const { data: products, error: productError } = await supabase
          .from('products')
          .select('id, image_url')
          .in('id', productIds);

        if (!productError && products) {
          products.forEach((product) => {
            if (product?.id && product?.image_url) {
              productImageMap[product.id] = product.image_url;
            }
          });
        } else if (productError) {
          console.warn('[user/purchases] product image fallback failed:', productError.message);
        }
      }

      return res.json((purchaseData || []).map((row) => ({
        ...row,
        product_image: row.product_image || productImageMap[row.product_id] || null,
        delivery_payload: row.delivery_payload || row.license_key || null,
        proof_uploaded: row.proof_uploaded === true || proofMap[row.id] === true,
      })));
    }
    if (!isMissingSchemaError(purchaseError)) break;
    console.warn('[user/purchases] retrying with reduced schema:', purchaseError.message);
  }

  console.error('[user/purchases] query error:', purchaseError?.message || 'Unknown error');
  if (!userId && isMissingSchemaError(purchaseError)) {
    return res.status(500).json({ error: 'Historija gost kupovina nije dostupna dok buyer_email kolona ne bude migrirana.' });
  }
  return res.status(500).json({ error: 'Greska pri ucitavanju narudzbi' });
  return res.status(500).json({ error: 'GreÅ¡ka pri uÄitavanju narudÅ¾bi' });

  let q = supabase
    .from('transactions')
    .select('id, product_id, product_name, amount, payment_method, status, license_key, buyer_email, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (userId)     q = q.eq('user_id', userId);
  else            q = q.eq('buyer_email', guestEmail);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: 'Greška' });
  return res.json(data || []);
});

/** PUT /api/user/settings */
app.put('/api/user/settings', authenticateToken, async (req, res) => {
  const { email, new_email, password, new_password, current_password } = req.body;
  const resolvedEmail = new_email || email;
  const resolvedPassword = new_password || password;

  const { data: user } = await supabase
    .from('users').select('*').eq('id', req.user.id).maybeSingle();
  if (!user) return res.status(404).json({ error: 'Korisnik nije pronađen' });

  if (!current_password)
    return res.status(400).json({ error: 'Unesite trenutnu lozinku za potvrdu' });

  const valid = await bcrypt.compare(current_password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Trenutna lozinka nije ispravna' });

  const updates = {};

  if (resolvedEmail && resolvedEmail !== user.email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resolvedEmail))
      return res.status(400).json({ error: 'Nevažeći email' });
    const { data: existing } = await supabase
      .from('users').select('id').eq('email', resolvedEmail.toLowerCase()).maybeSingle();
    if (existing) return res.status(409).json({ error: 'Email već postoji' });
    updates.email = resolvedEmail.toLowerCase().trim();
  }

  if (resolvedPassword) {
    if (resolvedPassword.length < 8)
      return res.status(400).json({ error: 'Nova lozinka mora biti min. 8 karaktera' });
    const reuseError = await checkPasswordNotReused(req.user.id, resolvedPassword);
    if (reuseError) return res.status(400).json({ error: reuseError });
    await archiveCurrentPassword(req.user.id);
    updates.password_hash = await bcrypt.hash(resolvedPassword, 12);
  }

  if (!Object.keys(updates).length)
    return res.json({ message: 'Nema izmjena' });

  const { error } = await supabase.from('users').update(updates).eq('id', req.user.id);
  if (error) return res.status(500).json({ error: 'Greška pri čuvanju' });
  return res.json({ message: 'Podešavanja sačuvana' });
});

/** PUT /api/user/avatar – upload profile picture */
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Dozvoljene su samo slike'));
  },
}).single('avatar');

app.put('/api/user/avatar', authenticateToken, (req, res, next) => {
  avatarUpload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Slika nije poslana' });

  const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
  const filePath = `avatars/${req.user.id}-${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from('avatars')
    .upload(filePath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
  if (upErr) return res.status(500).json({ error: 'Greška pri uploadu slike' });

  const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(filePath);
  const avatar_url = urlData?.publicUrl || null;

  await supabase.from('users').update({ avatar_url }).eq('id', req.user.id);

  return res.json({ avatar_url });
});

/* ─────────────────────────────────────────
   PUBLIC: Checkout settings
   Returns only the fields the checkout page needs (no sensitive admin data).
   Used by checkout.html to show PayPal/crypto/bank payment details.
───────────────────────────────────────── */
app.get('/api/checkout-settings', async (req, res) => {
  const { data, error } = await supabase
    .from('site_settings')
    .select('paypal_email, paypal_client_id, btc_wallet, eth_wallet, usdt_wallet, bank_iban, bank_name')
    .eq('id', 1)
    .maybeSingle();

  if (error) return res.status(500).json({ error: 'Settings unavailable' });
  return res.json(data || {});
});

/* ─────────────────────────────────────────
   VISUAL EDITOR: Bulk layout update
───────────────────────────────────────── */

/** PATCH /api/products/layout – update grid_order + card_size for multiple products */
app.patch('/api/products/layout', authenticateToken, checkPermission('manage_products'), async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || !items.length)
    return res.status(400).json({ error: 'items array required' });

  const errors = [];
  await Promise.all(items.map(async (item) => {
    if (!item.id) return;
    const upd = {};
    if (item.grid_order !== undefined) upd.grid_order = Number(item.grid_order);
    if (item.card_size  !== undefined) upd.card_size  = item.card_size;
    if (!Object.keys(upd).length) return;
    const { error } = await supabase.from('products').update(upd).eq('id', item.id);
    if (error) errors.push(item.id);
  }));

  if (errors.length) return res.status(207).json({ message: 'Djelimično sačuvano', failed: errors });
  return res.json({ message: 'Raspored sačuvan' });
});

/* ─────────────────────────────────────────
   ADMIN: Create user + manage permissions
───────────────────────────────────────── */

// Valid ranks (hierarchy order)
const VALID_RANKS = ['user', 'support', 'moderator', 'admin', 'super_admin'];

/** POST /api/admin/users/create */
app.post('/api/admin/users/create', authenticateToken, checkPermission('manage_users'), async (req, res) => {
  const { name, email, password, permissions = {}, rank = 'user' } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Ime, email i lozinka su obavezni' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Lozinka mora imati min. 8 karaktera' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Nevažeći email' });
  if (!VALID_RANKS.includes(rank))
    return res.status(400).json({ error: 'Nevažeći rank' });

  const { data: existing } = await supabase
    .from('users').select('id').eq('email', email.toLowerCase()).maybeSingle();
  if (existing) return res.status(409).json({ error: 'Email već postoji' });

  // role: admin if rank is admin/super_admin or has any permission, else user
  const hasAnyPerm = Object.values(permissions).some(v => v === true);
  const role = (rank === 'admin' || rank === 'super_admin' || hasAnyPerm) ? 'admin' : 'user';

  const password_hash = await bcrypt.hash(password, 12);
  const { data, error } = await supabase
    .from('users')
    .insert({
      name:          name.trim(),
      email:         email.toLowerCase().trim(),
      password_hash,
      role,
      rank,
      permissions,
      is_verified:   true,
      registered_ip: getClientIP(req),
      created_at:    new Date().toISOString(),
    })
    .select('id, name, email, role, rank, permissions, created_at')
    .single();

  if (error) return res.status(500).json({ error: 'Greška pri kreiranju korisnika' });
  return res.status(201).json(data);
});

/** PATCH /api/admin/users/:id/permissions */
app.patch('/api/admin/users/:id/permissions', authenticateToken, checkPermission('manage_users'), async (req, res) => {
  const { id } = req.params;
  const { permissions, rank } = req.body;

  if (typeof permissions !== 'object' || permissions === null)
    return res.status(400).json({ error: 'permissions object required' });
  if (rank !== undefined && !VALID_RANKS.includes(rank))
    return res.status(400).json({ error: 'Nevažeći rank' });

  const { data: user } = await supabase
    .from('users').select('role, rank').eq('id', id).maybeSingle();
  if (!user) return res.status(404).json({ error: 'Korisnik nije pronađen' });

  const resolvedRank = rank !== undefined ? rank : (user.rank || 'user');
  const hasAnyPerm   = Object.values(permissions).some(v => v === true);
  const newRole      = (resolvedRank === 'admin' || resolvedRank === 'super_admin' || hasAnyPerm)
    ? 'admin' : 'user';

  const updates = { permissions, role: newRole, rank: resolvedRank };

  const { error } = await supabase.from('users').update(updates).eq('id', id);
  if (error) return res.status(500).json({ error: 'Greška pri ažuriranju dozvola' });
  return res.json({ message: 'Dozvole i rank ažurirani', role: newRole, rank: resolvedRank });
});

/* ─────────────────────────────────────────
   CONTACT / SUPPORT TICKETS
───────────────────────────────────────── */

/** POST /api/contact – public, saves ticket to support_tickets */
app.post('/api/contact', async (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !subject || !message)
    return res.status(400).json({ error: 'Sva polja su obavezna' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Nevažeći email' });

  const { error } = await supabase.from('support_tickets').insert({
    name:       name.trim(),
    email:      email.toLowerCase().trim(),
    subject:    subject.trim(),
    message:    message.trim(),
    status:     'open',
    created_at: new Date().toISOString(),
  });
  if (error) {
    console.error('Contact insert error:', error);
    return res.status(500).json({ error: 'Greška pri slanju poruke' });
  }
  return res.status(201).json({ message: 'Poruka uspješno poslana!' });
});

/** GET /api/admin/tickets/unread-count – returns count of 'open' tickets */
app.get('/api/admin/tickets/unread-count', authenticateToken, checkPermission('can_manage_support'), async (req, res) => {
  const { count, error } = await supabase
    .from('support_tickets')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open');
  if (error) return res.status(500).json({ error: 'Greška' });
  return res.json({ count: count || 0 });
});

/** GET /api/admin/tickets – list all tickets */
app.get('/api/admin/tickets', authenticateToken, checkPermission('can_manage_support'), async (req, res) => {
  const { data, error } = await supabase
    .from('support_tickets')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Greška' });
  return res.json(data || []);
});

/** PUT /api/admin/tickets/:id/reply – reply by email + mark as replied */
app.put('/api/admin/tickets/:id/reply', authenticateToken, checkPermission('can_manage_support'), async (req, res) => {
  const { id } = req.params;
  const { reply_text } = req.body;
  if (!reply_text?.trim())
    return res.status(400).json({ error: 'Odgovor ne može biti prazan' });

  const { data: ticket } = await supabase
    .from('support_tickets')
    .select('name, email, subject')
    .eq('id', id)
    .maybeSingle();
  if (!ticket) return res.status(404).json({ error: 'Tiket nije pronađen' });

  // Send email reply
  const replyHTML = `
    <div style="font-family:'Inter',Arial,sans-serif;max-width:520px;margin:0 auto;background:#f8f9fb;border-radius:16px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#1D6AFF,#A259FF);padding:24px 32px">
        <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700">Keyify Podrška</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px">Re: ${escHTML(ticket.subject)}</p>
      </div>
      <div style="padding:28px 32px;background:#fff">
        <p style="color:#555;margin:0 0 6px">Zdravo, <strong style="color:#111">${escHTML(ticket.name)}</strong>!</p>
        <p style="color:#555;margin:0 0 20px;font-size:14px">Odgovor na vaš upit:</p>
        <div style="background:#f0f4ff;border-left:4px solid #1D6AFF;border-radius:8px;padding:16px 20px;color:#1a1a2e;font-size:14px;line-height:1.6;white-space:pre-wrap">${escHTML(reply_text.trim())}</div>
        <p style="color:#999;font-size:12px;margin:20px 0 0">Ako imate dodatnih pitanja, slobodno nas kontaktirajte ponovo.</p>
      </div>
    </div>`;

  try {
    await sendMailSafe({
      from:    process.env.EMAIL_FROM || `"Keyify" <${process.env.EMAIL_USER}>`,
      to:      ticket.email,
      subject: `Re: ${ticket.subject}`,
      html:    replyHTML,
    });
  } catch (emailErr) {
    console.error('Ticket reply email failed:', emailErr.message);
    return res.status(500).json({ error: 'Greška pri slanju emaila: ' + emailErr.message });
  }

  const { error } = await supabase
    .from('support_tickets')
    .update({ status: 'replied', reply_text: reply_text.trim(), replied_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return res.status(500).json({ error: 'Email poslan, ali greška pri ažuriranju tiketa' });

  return res.json({ message: 'Odgovor poslan i tiket ažuriran' });
});

/** PUT /api/admin/tickets/:id/status – change ticket status */
app.put('/api/admin/tickets/:id/status', authenticateToken, checkPermission('can_manage_support'), async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!['open', 'replied', 'closed'].includes(status))
    return res.status(400).json({ error: 'Nevažeći status' });
  const { error } = await supabase.from('support_tickets').update({ status }).eq('id', id);
  if (error) return res.status(500).json({ error: 'Greška' });
  return res.json({ message: 'Status ažuriran' });
});

/* ─────────────────────────────────────────
   LIVE CHAT
───────────────────────────────────────── */

/** POST /api/chat/start – start a new chat session (public, guest or logged-in) */
app.post('/api/chat/start', async (req, res) => {
  const { guest_email } = req.body;

  let userId = null;
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    try { const d = jwt.verify(token, process.env.JWT_SECRET); userId = d.id; } catch {}
  }

  const email = guest_email?.trim().toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Unesite ispravnu email adresu' });

  // Anonymous guests get a random #XXXXXX code stored as guest_email
  const finalEmail = email || (!userId ? '#' + crypto.randomBytes(3).toString('hex').toUpperCase() : null);

  const { data, error } = await supabase
    .from('chat_sessions')
    .insert({ user_id: userId, guest_email: finalEmail, status: 'pending' })
    .select('id, guest_email')
    .single();

  if (error) {
    console.error('[chat/start] Supabase insert error:', JSON.stringify(error));
    return res.status(500).json({
      error: 'Greška pri pokretanju chata',
      detail: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
  const isAnon = data.guest_email?.startsWith('#');
  return res.status(201).json({ session_id: data.id, anon_id: isAnon ? data.guest_email : null });
});

/** GET /api/chat/messages/:sessionId – fetch messages for a session (public – UUID is unguessable) */
app.get('/api/chat/messages/:sessionId', async (req, res) => {
  const { data: session } = await supabase
    .from('chat_sessions')
    .select('id, status, admin_id')
    .eq('id', req.params.sessionId)
    .maybeSingle();

  if (!session) return res.status(404).json({ error: 'Sesija nije pronađena' });

  // Fetch assigned admin info (avatar + name) if session is active
  let admin_info = null;
  if (session.admin_id) {
    const { data: adminUser } = await supabase
      .from('users')
      .select('name, avatar_url')
      .eq('id', session.admin_id)
      .maybeSingle();
    if (adminUser) admin_info = adminUser;
  }

  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, sender, message, created_at')
    .eq('session_id', req.params.sessionId)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: 'Greška' });
  return res.json({ messages: data || [], session_status: session.status, admin_info });
});

/** POST /api/chat/message – user sends a message (resets session status to 'new') */
app.post('/api/chat/message', async (req, res) => {
  const { session_id, message } = req.body;
  if (!session_id || !message?.trim())
    return res.status(400).json({ error: 'session_id i message su obavezni' });

  const { data: session } = await supabase
    .from('chat_sessions')
    .select('id, status')
    .eq('id', session_id)
    .maybeSingle();

  if (!session) return res.status(404).json({ error: 'Sesija nije pronađena' });
  if (session.status === 'closed')
    return res.status(400).json({ error: 'Ova chat sesija je zatvorena' });

  const { data, error } = await supabase
    .from('chat_messages')
    .insert({ session_id, sender: 'user', message: message.trim() })
    .select('id, sender, message, created_at')
    .single();

  if (error) return res.status(500).json({ error: 'Greška pri slanju poruke' });

  // If session is active (admin assigned), keep it active but update preview.
  // If pending, keep pending. Never revert closed sessions.
  const newStatus = session.status === 'active' ? 'active' : 'pending';
  await supabase.from('chat_sessions').update({
    status:               newStatus,
    last_message_at:      data.created_at,
    last_message_preview: message.trim().substring(0, 120),
  }).eq('id', session_id).neq('status', 'closed');

  return res.status(201).json(data);
});

/** GET /api/admin/chat/sessions/new-count – count of pending sessions in queue */
app.get('/api/admin/chat/sessions/new-count', authenticateToken, checkPermission('can_manage_support'), async (req, res) => {
  const { count, error } = await supabase
    .from('chat_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  if (error) return res.status(500).json({ error: 'Greška' });
  return res.json({ count: count || 0 });
});

/** GET /api/admin/chat/sessions – list chat sessions sorted by latest activity */
app.get('/api/admin/chat/sessions', authenticateToken, checkPermission('can_manage_support'), async (req, res) => {
  const showClosed = req.query.closed === '1';
  const showAll    = req.query.all === '1';

  // Try full select with join; progressively strip missing columns on failure
  const attempts = [
    { cols: 'id, user_id, guest_email, status, created_at, last_message_at, last_message_preview, users!chat_sessions_user_id_fkey(name, email, avatar_url)', orderCol: 'last_message_at' },
    { cols: 'id, user_id, guest_email, status, created_at, last_message_at, last_message_preview', orderCol: 'last_message_at' },
    { cols: 'id, user_id, guest_email, status, created_at', orderCol: 'created_at' },
  ];

  let data = null, error = null;
  for (const att of attempts) {
    let q = supabase.from('chat_sessions').select(att.cols);
    if (!showAll) {
      if (showClosed) q = q.eq('status', 'closed');
      else q = q.neq('status', 'closed');
    }
    const res2 = await q
      .order(att.orderCol, { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    data = res2.data;
    error = res2.error;
    if (!error) break;
    console.error('[chat/sessions] Query attempt failed:', error.message);
  }

  if (error) {
    console.error('[chat/sessions] Supabase error:', JSON.stringify(error));
    return res.status(500).json({ error: 'Greška', detail: error.message });
  }
  return res.json(data || []);
});

/** GET /api/admin/chat/sessions/:id/messages – messages in a session (admin) */
app.get('/api/admin/chat/sessions/:id/messages', authenticateToken, checkPermission('can_manage_support'), async (req, res) => {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, sender, message, created_at')
    .eq('session_id', req.params.id)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: 'Greška' });
  return res.json(data || []);
});

/** PATCH /api/admin/chat/sessions/:id/read – mark session as seen (no-op in queue model, kept for compat) */
app.patch('/api/admin/chat/sessions/:id/read', authenticateToken, checkPermission('can_manage_support'), async (req, res) => {
  return res.json({ ok: true });
});

/** POST /api/admin/chat/reply – admin sends a message, sets session to 'answered' */
app.post('/api/admin/chat/reply', authenticateToken, checkPermission('can_manage_support'), async (req, res) => {
  const { session_id, message } = req.body;
  if (!session_id || !message?.trim())
    return res.status(400).json({ error: 'session_id i message su obavezni' });

  const { data: session } = await supabase
    .from('chat_sessions')
    .select('id, status')
    .eq('id', session_id)
    .maybeSingle();

  if (!session) return res.status(404).json({ error: 'Sesija nije pronađena' });
  if (session.status === 'closed') return res.status(400).json({ error: 'Sesija je zatvorena' });

  const { data, error } = await supabase
    .from('chat_messages')
    .insert({ session_id, sender: 'admin', message: message.trim() })
    .select('id, sender, message, created_at')
    .single();

  if (error) return res.status(500).json({ error: 'Greška pri slanju odgovora' });

  // Keep session active + update preview
  await supabase.from('chat_sessions').update({
    status:               'active',
    last_message_at:      data.created_at,
    last_message_preview: `Agent: ${message.trim().substring(0, 100)}`,
  }).eq('id', session_id);

  return res.json(data);
});

/** POST /api/chat/sessions/:id/leave – user leaves session (admin still sees it) */
app.post('/api/chat/sessions/:id/leave', async (req, res) => {
  const sid = req.params.id;
  // Insert system message so admin knows the user left
  await supabase.from('chat_messages').insert({
    session_id: sid, sender: 'system', message: '__user_left__',
  });
  // Mark session as closed
  await supabase.from('chat_sessions')
    .update({ status: 'closed' })
    .eq('id', sid);
  return res.json({ ok: true });
});

/** PUT /api/admin/chat/sessions/:id/close – close a session */
app.put('/api/admin/chat/sessions/:id/close', authenticateToken, checkPermission('can_manage_support'), async (req, res) => {
  const { error } = await supabase
    .from('chat_sessions')
    .update({ status: 'closed' })
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: 'Greška' });
  return res.json({ message: 'Sesija zatvorena' });
});

/** POST /api/admin/chat/sessions/:id/accept – admin accepts a pending chat */
app.post('/api/admin/chat/sessions/:id/accept', authenticateToken, checkPermission('can_manage_support'), async (req, res) => {
  const sid = req.params.id;
  const adminId = req.user.id;

  const { data: session } = await supabase
    .from('chat_sessions')
    .select('id, status')
    .eq('id', sid)
    .maybeSingle();

  if (!session) return res.status(404).json({ error: 'Sesija nije pronađena' });
  if (session.status !== 'pending') return res.status(400).json({ error: 'Sesija više nije u redu čekanja' });

  // Fetch admin info for the response
  const { data: adminUser } = await supabase
    .from('users')
    .select('name, avatar_url')
    .eq('id', adminId)
    .maybeSingle();

  const { error } = await supabase
    .from('chat_sessions')
    .update({
      status: 'active',
      admin_id: adminId,
      accepted_at: new Date().toISOString(),
    })
    .eq('id', sid);

  if (error) return res.status(500).json({ error: 'Greška pri preuzimanju chata' });

  // Insert system message so user knows an agent joined
  const agentName = adminUser?.name || 'Agent';
  await supabase.from('chat_messages').insert({
    session_id: sid,
    sender: 'system',
    message: `__agent_joined__${agentName}`,
  });

  return res.json({
    ok: true,
    admin_info: { name: agentName, avatar_url: adminUser?.avatar_url || null },
  });
});

/** POST /api/admin/chat/sessions/:id/decline – admin declines a pending chat */
app.post('/api/admin/chat/sessions/:id/decline', authenticateToken, checkPermission('can_manage_support'), async (req, res) => {
  const sid = req.params.id;

  const { data: session } = await supabase
    .from('chat_sessions')
    .select('id, status')
    .eq('id', sid)
    .maybeSingle();

  if (!session) return res.status(404).json({ error: 'Sesija nije pronađena' });
  if (session.status !== 'pending') return res.status(400).json({ error: 'Sesija više nije u redu čekanja' });

  const { error } = await supabase
    .from('chat_sessions')
    .update({ status: 'closed' })
    .eq('id', sid);

  if (error) return res.status(500).json({ error: 'Greška' });

  // Notify user the session was declined
  await supabase.from('chat_messages').insert({
    session_id: sid,
    sender: 'system',
    message: '__chat_declined__',
  });

  return res.json({ ok: true });
});

/** GET /api/chat/queue-position/:sessionId – get user's position in queue */
app.get('/api/chat/queue-position/:sessionId', async (req, res) => {
  const sid = req.params.sessionId;

  const { data: session } = await supabase
    .from('chat_sessions')
    .select('id, status, created_at')
    .eq('id', sid)
    .maybeSingle();

  if (!session) return res.status(404).json({ error: 'Sesija nije pronađena' });
  if (session.status !== 'pending') return res.json({ position: 0, status: session.status });

  // Count how many pending sessions were created before this one
  const { count, error } = await supabase
    .from('chat_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .lte('created_at', session.created_at);

  if (error) return res.status(500).json({ error: 'Greška' });
  return res.json({ position: count || 1, status: 'pending' });
});

/** POST /api/admin/chat/sessions/:id/request-email – admin asks guest for email (system message) */
app.post('/api/admin/chat/sessions/:id/request-email', authenticateToken, checkPermission('can_manage_support'), async (req, res) => {
  const sid = req.params.id;
  const { data: session } = await supabase
    .from('chat_sessions').select('id, status').eq('id', sid).maybeSingle();
  if (!session) return res.status(404).json({ error: 'Sesija nije pronađena' });
  if (session.status === 'closed') return res.status(400).json({ error: 'Sesija je zatvorena' });

  const { data, error } = await supabase
    .from('chat_messages')
    .insert({ session_id: sid, sender: 'system', message: '__ask_email__' })
    .select('id, sender, message, created_at')
    .single();

  if (error) return res.status(500).json({ error: 'Greška' });

  await supabase.from('chat_sessions').update({
    last_message_at: data.created_at,
    last_message_preview: 'Agent: Zatražen email od korisnika',
  }).eq('id', sid);

  return res.json(data);
});

/** PATCH /api/chat/sessions/:id/guest-email – guest submits email (from chat prompt) */
app.patch('/api/chat/sessions/:id/guest-email', async (req, res) => {
  const { email } = req.body;
  if (!email?.trim()) return res.status(400).json({ error: 'Email je obavezan' });
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed))
    return res.status(400).json({ error: 'Unesite ispravnu email adresu' });

  const sid = req.params.id;
  const { data: session } = await supabase
    .from('chat_sessions').select('id').eq('id', sid).maybeSingle();
  if (!session) return res.status(404).json({ error: 'Sesija nije pronađena' });

  // Update guest_email on the session
  await supabase.from('chat_sessions').update({ guest_email: trimmed }).eq('id', sid);

  // Insert confirmation message visible to both sides
  await supabase.from('chat_messages').insert({
    session_id: sid, sender: 'system',
    message: '__email_received__' + trimmed,
  });

  // Check if this email matches a registered user
  const { data: user } = await supabase
    .from('users').select('id, name, email, role, created_at').eq('email', trimmed).maybeSingle();

  return res.json({ ok: true, email: trimmed, user: user || null });
});

/** GET /api/admin/chat/sessions/:id/guest-info – lookup guest info by session */
app.get('/api/admin/chat/sessions/:id/guest-info', authenticateToken, checkPermission('can_manage_support'), async (req, res) => {
  // Try with join first, fall back without
  let session;
  const { data: s1 } = await supabase
    .from('chat_sessions')
    .select('id, guest_email, user_id, users!chat_sessions_user_id_fkey(id, name, email, role, created_at)')
    .eq('id', req.params.id)
    .maybeSingle();
  if (s1) {
    session = s1;
  } else {
    const { data: s2 } = await supabase
      .from('chat_sessions')
      .select('id, guest_email, user_id')
      .eq('id', req.params.id)
      .maybeSingle();
    session = s2;
  }
  if (!session) return res.status(404).json({ error: 'Sesija nije pronađena' });

  let guestUser = null;
  const realEmail = session.guest_email && !session.guest_email.startsWith('#') ? session.guest_email : null;
  if (realEmail && !session.users) {
    const { data } = await supabase
      .from('users').select('id, name, email, role, created_at')
      .eq('email', realEmail).maybeSingle();
    guestUser = data;
  }

  return res.json({
    anon_id: session.guest_email?.startsWith('#') ? session.guest_email : null,
    guest_email: realEmail,
    registered_user: session.users || guestUser || null,
  });
});

/* ─────────────────────────────────────────
   PROMO CODES
───────────────────────────────────────── */

/** POST /api/checkout/apply-promo – public endpoint, validates a code */
app.post('/api/checkout/apply-promo', async (req, res) => {
  const { code, subtotal, cart_item_count, has_referral_discount } = req.body;
  if (!code) return res.status(400).json({ error: 'Unesite promo kod' });

  // Prevent stacking referral + promo code
  if (has_referral_discount) return res.status(400).json({ error: 'Ne možete koristiti promo kod zajedno sa referral popustom. Uklonite jedan od njih.' });
  if (!subtotal || subtotal <= 0) return res.status(400).json({ error: 'Nevažeći iznos narudžbe' });

  const { data: promoRow } = await supabase
    .from('promo_codes')
    .select('*')
    .ilike('code', code.trim())
    .eq('is_active', true)
    .maybeSingle();

  if (!promoRow)
    return res.status(404).json({ error: 'Promo kod nije validan ili je neaktivan' });
  if (promoRow.expires_at && new Date() > new Date(promoRow.expires_at))
    return res.status(400).json({ error: 'Promo kod je istekao' });
  if (promoRow.usage_limit !== null && promoRow.used_count >= promoRow.usage_limit)
    return res.status(400).json({ error: 'Promo kod je dostigao limit korišćenja' });
  if (promoRow.min_products != null && (parseInt(cart_item_count) || 0) < promoRow.min_products)
    return res.status(400).json({ error: `Ovaj kod zahtijeva minimalno ${promoRow.min_products} proizvoda u korpi. Trenutno imate ${parseInt(cart_item_count) || 0}.` });

  const discount = promoRow.discount_type === 'percent'
    ? parseFloat((subtotal * promoRow.discount_value / 100).toFixed(2))
    : Math.min(parseFloat(promoRow.discount_value), subtotal);

  const newTotal = Math.max(0, parseFloat((subtotal - discount).toFixed(2)));

  return res.json({
    valid:          true,
    code:           promoRow.code,
    discount_type:  promoRow.discount_type,
    discount_value: promoRow.discount_value,
    discount_amount: discount,
    new_total:      newTotal,
    message:        promoRow.discount_type === 'percent'
      ? `Kod "${promoRow.code}" – popust ${promoRow.discount_value}% (−€${discount.toFixed(2)})`
      : `Kod "${promoRow.code}" – popust −€${discount.toFixed(2)}`,
  });
});

/* ─────────────────────────────────────────
   ADMIN – ROLE BUILDER (Dynamic RBAC)
───────────────────────────────────────── */

/** GET /api/admin/roles – list all roles */
app.get('/api/admin/roles', authenticateToken, requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('roles')
    .select('*')
    .order('power_level', { ascending: true });
  if (error) return res.status(500).json({ error: 'Greška pri učitavanju rola' });
  return res.json(data || []);
});

/** POST /api/admin/roles – create role (super_admin only) */
app.post('/api/admin/roles', authenticateToken, checkPermission('can_manage_roles'), async (req, res) => {
  const { name, power_level, permissions } = req.body;
  if (!name) return res.status(400).json({ error: 'Naziv role je obavezan' });
  if (power_level >= 100) return res.status(400).json({ error: 'Power level ne može biti 100 (rezervisano za Super Admin)' });

  const { data, error } = await supabase.from('roles').insert({
    name: name.trim(),
    power_level: parseInt(power_level) || 10,
    permissions: permissions || {},
  }).select().single();

  if (error) return res.status(500).json({ error: error.message.includes('unique') ? 'Rola sa tim imenom već postoji' : 'Greška pri kreiranju' });
  return res.status(201).json(data);
});

/** PUT /api/admin/roles/:id – update role (super_admin only) */
app.put('/api/admin/roles/:id', authenticateToken, checkPermission('can_manage_roles'), async (req, res) => {
  const { name, power_level, permissions } = req.body;
  const updates = {};
  if (name) updates.name = name.trim();
  if (power_level !== undefined) {
    if (power_level >= 100) return res.status(400).json({ error: 'Power level ne može biti 100' });
    updates.power_level = parseInt(power_level);
  }
  if (permissions !== undefined) updates.permissions = permissions;

  const { data, error } = await supabase.from('roles').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: 'Greška pri ažuriranju role' });
  return res.json(data);
});

/** DELETE /api/admin/roles/:id – delete role (super_admin only, cannot delete default) */
app.delete('/api/admin/roles/:id', authenticateToken, checkPermission('can_manage_roles'), async (req, res) => {
  const { data: role } = await supabase.from('roles').select('is_default').eq('id', req.params.id).maybeSingle();
  if (!role) return res.status(404).json({ error: 'Rola nije pronađena' });
  if (role.is_default) return res.status(400).json({ error: 'Default rola se ne može obrisati' });

  await supabase.from('roles').delete().eq('id', req.params.id);
  return res.json({ ok: true });
});

/** PUT /api/admin/users/:id/role – assign role to user (copies permissions) */
app.put('/api/admin/users/:id/role', authenticateToken, checkPermission('can_manage_roles'), async (req, res) => {
  const { role_id } = req.body;
  const { data: role } = await supabase.from('roles').select('*').eq('id', role_id).maybeSingle();
  if (!role) return res.status(404).json({ error: 'Rola nije pronađena' });

  const rankMap = { 100: 'super_admin', 90: 'admin' };
  const rank = rankMap[role.power_level] || (role.power_level >= 50 ? 'admin' : 'user');
  const userRole = role.power_level >= 50 ? 'admin' : 'user';

  await supabase.from('users').update({
    role: userRole,
    rank: rank,
    permissions: role.permissions || {},
  }).eq('id', req.params.id);

  return res.json({ ok: true, assigned_role: role.name });
});

/** GET /api/admin/promos */
app.get('/api/admin/promos', authenticateToken, checkPermission('can_manage_promos'), async (req, res) => {
  const { data, error } = await supabase
    .from('promo_codes')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Greška' });
  return res.json(data || []);
});

/** POST /api/admin/promos */
app.post('/api/admin/promos', authenticateToken, checkPermission('can_manage_promos'), async (req, res) => {
  const { code, discount_type, discount_value, usage_limit, expires_at, is_active, min_products } = req.body;
  if (!code?.trim()) return res.status(400).json({ error: 'Kod je obavezan' });
  if (!['percent', 'fixed'].includes(discount_type))
    return res.status(400).json({ error: 'Tip popusta mora biti percent ili fixed' });
  if (!discount_value || parseFloat(discount_value) <= 0)
    return res.status(400).json({ error: 'Vrijednost popusta mora biti > 0' });
  if (discount_type === 'percent' && parseFloat(discount_value) > 100)
    return res.status(400).json({ error: 'Procenat ne može biti veći od 100' });

  const { data, error } = await supabase.from('promo_codes').insert({
    code:           code.trim().toUpperCase(),
    discount_type,
    discount_value: parseFloat(discount_value),
    usage_limit:    usage_limit ? parseInt(usage_limit) : null,
    min_products:   min_products ? parseInt(min_products) : null,
    expires_at:     expires_at || null,
    is_active:      is_active !== false,
    created_by:     req.user.id,
    created_at:     new Date().toISOString(),
  }).select().single();

  if (error) {
    console.error('Promo create error:', error);
    if (error.code === '23505') return res.status(409).json({ error: 'Promo kod već postoji' });
    return res.status(500).json({ error: error.message || 'Greška pri kreiranju koda' });
  }
  return res.status(201).json(data);
});

/** PUT /api/admin/promos/:id */
app.put('/api/admin/promos/:id', authenticateToken, checkPermission('can_manage_promos'), async (req, res) => {
  const { id } = req.params;
  const { discount_type, discount_value, usage_limit, expires_at, is_active, min_products } = req.body;
  const updates = {};
  if (discount_type)  updates.discount_type  = discount_type;
  if (discount_value) updates.discount_value = parseFloat(discount_value);
  if (usage_limit !== undefined)  updates.usage_limit  = usage_limit ? parseInt(usage_limit) : null;
  if (min_products !== undefined) updates.min_products = min_products ? parseInt(min_products) : null;
  if (expires_at !== undefined)   updates.expires_at   = expires_at || null;
  if (is_active  !== undefined)   updates.is_active    = Boolean(is_active);

  const { error } = await supabase.from('promo_codes').update(updates).eq('id', id);
  if (error) return res.status(500).json({ error: 'Greška pri ažuriranju' });
  return res.json({ message: 'Promo kod ažuriran' });
});

/** DELETE /api/admin/promos/:id */
app.delete('/api/admin/promos/:id', authenticateToken, checkPermission('can_manage_promos'), async (req, res) => {
  const { error } = await supabase.from('promo_codes').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Greška pri brisanju' });
  return res.json({ message: 'Promo kod obrisan' });
});

/* ─────────────────────────────────────────
   SQL EDITOR (super-admin, PIN-gated)
───────────────────────────────────────── */

/** POST /api/admin/sql/execute */
app.post('/api/admin/sql/execute', authenticateToken, checkPermission('can_execute_sql'), async (req, res) => {
  const { query, pin } = req.body;
  const ip = getClientIP(req);

  if (!query?.trim())
    return res.status(400).json({ error: 'Query ne može biti prazan' });

  // Verify master PIN
  const masterPin = process.env.SQL_MASTER_PIN;
  if (!masterPin || pin !== masterPin) {
    // Log failed attempt
    await supabase.from('sql_audit_logs').insert({
      user_id:     req.user.id,
      ip_address:  ip,
      query:       query.trim(),
      success:     false,
      error_msg:   'Pogrešan SQL Master PIN',
      executed_at: new Date().toISOString(),
    });
    return res.status(401).json({ error: 'Pogrešan SQL Master PIN' });
  }

  let success = false;
  let result  = null;
  let errMsg  = null;
  let rowCount = 0;

  try {
    const { data, error } = await supabase.rpc('keyify_execute_sql', { p_sql: query.trim() });
    if (error) throw new Error(error.message);
    result   = Array.isArray(data) ? data : (data ? [data] : []);
    rowCount = result.length;
    success  = true;
  } catch (err) {
    errMsg = err.message;
  }

  // Audit log every execution (success or failure)
  await supabase.from('sql_audit_logs').insert({
    user_id:     req.user.id,
    ip_address:  ip,
    query:       query.trim(),
    success,
    error_msg:   errMsg || null,
    row_count:   rowCount,
    executed_at: new Date().toISOString(),
  });

  if (!success)
    return res.status(400).json({ error: errMsg || 'SQL Greška' });

  return res.json({ rows: result, row_count: rowCount });
});

/** GET /api/admin/sql/logs – view recent SQL audit logs */
app.get('/api/admin/sql/logs', authenticateToken, checkPermission('can_execute_sql'), async (req, res) => {
  const { data, error } = await supabase
    .from('sql_audit_logs')
    .select('id, query, success, error_msg, row_count, ip_address, executed_at, users(name, email)')
    .order('executed_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: 'Greška' });
  return res.json(data || []);
});

/* ─────────────────────────────────────────
   Helper: HTML escape for email templates
───────────────────────────────────────── */
function escHTML(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ─────────────────────────────────────────
   PASSWORD RESET
───────────────────────────────────────── */

/**
 * POST /api/forgot-password
 * Body: { email }
 * Sends a password-reset link valid for 30 minutes.
 */
app.post('/api/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Unesite email adresu' });

  const genericMsg = { message: 'Ako je email registrovan, link za reset je poslan.' };

  const { data: user } = await supabase
    .from('users')
    .select('id, name, email')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();

  if (!user) return res.json(genericMsg);

  // Generate 6-digit code + JWT link — both valid 30 min
  const resetCode  = generateOTP();
  const resetExp   = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const resetToken = jwt.sign({ id: user.id, purpose: 'reset' }, process.env.JWT_SECRET, { expiresIn: '30m' });
  const FRONTEND   = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  const resetLink  = `${FRONTEND}/reset-password.html?token=${resetToken}`;

  await supabase.from('users').update({ otp_code: resetCode, otp_expires: resetExp }).eq('id', user.id);
  await supabase.from('audit_logs').insert({
    user_id:    user.id,
    action:     'password_reset_request',
    ip:         getClientIP(req),
    created_at: new Date().toISOString(),
  });

  const html = `
    <div style="font-family:'Inter',Arial,sans-serif;max-width:460px;margin:0 auto;background:#0f0f1a;border-radius:16px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#1D6AFF,#A259FF);padding:24px 32px">
        <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700">🔑 Keyify – Reset lozinke</h1>
      </div>
      <div style="padding:28px 32px;background:#fff">
        <p style="color:#555;margin:0 0 6px">Zdravo, <strong style="color:#111">${escHTML(user.name)}</strong>!</p>
        <p style="color:#555;margin:0 0 20px;font-size:14px">Koristite <strong>link</strong> ili unesite <strong>kod</strong> ručno. Oba su važeća <strong>30 minuta</strong>.</p>

        <a href="${resetLink}" style="display:block;background:linear-gradient(135deg,#1D6AFF,#A259FF);color:#fff;text-decoration:none;text-align:center;padding:14px 24px;border-radius:12px;font-weight:700;font-size:15px;margin-bottom:24px">Postavi novu lozinku →</a>

        <div style="background:#f8f9fb;border-radius:12px;padding:16px 20px;text-align:center;margin-bottom:16px">
          <p style="color:#888;font-size:12px;margin:0 0 10px">Ili unesite ovaj kod ručno:</p>
          <div style="font-size:36px;font-weight:800;letter-spacing:12px;color:#1D6AFF;font-family:monospace">${resetCode}</div>
        </div>

        <p style="color:#bbb;font-size:11px;text-align:center;margin:0">Ako niste vi zatražili reset, zanemarite ovaj email.</p>
      </div>
    </div>`;

  try {
    await sendMailSafe({
      from:    process.env.EMAIL_FROM || `"Keyify" <${process.env.EMAIL_USER}>`,
      to:      user.email,
      subject: `Keyify – Reset lozinke (kod: ${resetCode})`,
      html,
    });
  } catch (err) {
    console.error('Reset email failed:', err.message);
  }

  return res.json(genericMsg);
});

/**
 * POST /api/verify-reset-code
 * Body: { email, code }
 * Returns: { token } – JWT to use on reset-password.html
 */
app.post('/api/verify-reset-code', authLimiter, async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Nedostaju podaci' });

  const { data: user } = await supabase
    .from('users')
    .select('id, otp_code, otp_expires')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();

  if (!user || user.otp_code !== code.trim())
    return res.status(401).json({ error: 'Pogrešan kod' });

  if (new Date(user.otp_expires) < new Date())
    return res.status(401).json({ error: 'Kod je istekao. Zatražite novi.' });

  // Clear the code so it can't be reused
  await supabase.from('users').update({ otp_code: null, otp_expires: null }).eq('id', user.id);

  const token = jwt.sign({ id: user.id, purpose: 'reset' }, process.env.JWT_SECRET, { expiresIn: '15m' });
  return res.json({ token });
});

/**
 * POST /api/reset-password
 * Body: { token, password }
 * Validates JWT reset token, updates password.
 */
app.post('/api/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Nedostaju podaci' });
  if (password.length < 8)  return res.status(400).json({ error: 'Lozinka mora biti min. 8 karaktera' });

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(400).json({ error: 'Link je istekao ili nije važeći. Zatražite novi.' });
  }

  if (decoded.purpose !== 'reset') return res.status(400).json({ error: 'Nevažeći token' });

  const reuseError = await checkPasswordNotReused(decoded.id, password);
  if (reuseError) return res.status(400).json({ error: reuseError });

  await archiveCurrentPassword(decoded.id);
  const hash = await bcrypt.hash(password, 12);
  const { error } = await supabase.from('users').update({ password_hash: hash }).eq('id', decoded.id);
  if (error) return res.status(500).json({ error: 'Greška pri čuvanju lozinke' });

  await supabase.from('audit_logs').insert({
    user_id:    decoded.id,
    action:     'password_reset_done',
    ip:         getClientIP(req),
    created_at: new Date().toISOString(),
  });

  return res.json({ message: 'Lozinka je uspješno promijenjena. Možete se prijaviti.' });
});

/* POST /api/admin/reset-requests/:id/reject — removed; password reset is self-service only. */

/* ─────────────────────────────────────────
   GMAIL SETUP (one-time refresh token)
   Visit GET /api/auth/gmail-setup once, complete Google consent,
   then copy the printed GMAIL_REFRESH_TOKEN into your .env / Railway vars.
   Requires GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET already set.
───────────────────────────────────────── */
function getRequestBaseUrl(req) {
  const configured = (process.env.BACKEND_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;

  const forwardedProto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${protocol}://${host}`.replace(/\/$/, '');
}

function getGmailSetupRedirect(req) {
  return `${getRequestBaseUrl(req)}/api/auth/gmail-setup/callback`;
}

app.get('/api/auth/gmail-setup/debug', (req, res) => {
  const redirectUri = getGmailSetupRedirect(req);
  res.json({
    backend_url_env: process.env.BACKEND_URL || null,
    request_base_url: getRequestBaseUrl(req),
    gmail_setup_redirect: redirectUri,
    google_client_id_present: Boolean(process.env.GOOGLE_CLIENT_ID),
    google_client_secret_present: Boolean(process.env.GOOGLE_CLIENT_SECRET),
  });
});

app.get('/api/auth/gmail-setup', (req, res) => {
  const redirectUri = getGmailSetupRedirect(req);
  const url = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'https://www.googleapis.com/auth/gmail.send',
    access_type:   'offline',
    prompt:        'consent',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${url.toString()}`);
});

app.get('/api/auth/gmail-setup/callback', async (req, res) => {
  const { code } = req.query;
  const redirectUri = getGmailSetupRedirect(req);
  if (!code) return res.status(400).send('No code');
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  redirectUri,
      grant_type:    'authorization_code',
    }).toString(),
  });
  const data = await tokenRes.json();
  if (!data.refresh_token) {
    return res.send(`<pre>Error or no refresh_token:\n${JSON.stringify(data, null, 2)}</pre>`);
  }
  console.log('\n✅ GMAIL_REFRESH_TOKEN =', data.refresh_token, '\n');
  res.send(`
    <h2>✅ Gmail setup complete!</h2>
    <p>Copy this into your <code>.env</code> and Railway Variables:</p>
    <pre style="background:#f0f0f0;padding:12px;border-radius:8px">GMAIL_REFRESH_TOKEN=${data.refresh_token}</pre>
    <p>Restart the server after adding it.</p>
  `);
});

/* ─────────────────────────────────────────
   GOOGLE OAUTH
───────────────────────────────────────── */

/** Build the Google authorization URL */
function buildGoogleAuthUrl(state) {
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope:         'openid email profile',
    access_type:   'online',
    prompt:        'select_account',
    state:         JSON.stringify(state),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/** Exchange code for tokens, fetch userinfo */
async function exchangeGoogleCode(code) {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  process.env.GOOGLE_REDIRECT_URI,
      grant_type:    'authorization_code',
    }).toString(),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Google token exchange failed');

  const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  return infoRes.json(); // { sub, email, name, picture, ... }
}

/** Issue a Keyify JWT for a user row */
function issueJWT(user, req) {
  return jwt.sign(
    {
      id:   user.id,
      role: user.role,
      ip:   getClientIP(req),
      ua:   hashUA(req.headers['user-agent']),
    },
    process.env.JWT_SECRET,
    { expiresIn: '2h' }
  );
}

/** GET /api/auth/google – start login/register flow */
app.get('/api/auth/google', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REDIRECT_URI) {
    return res.status(503).json({ error: 'Google OAuth nije konfigurisan' });
  }
  res.redirect(buildGoogleAuthUrl({ type: 'login' }));
});

/** GET /api/auth/google/link – start account-linking flow (requires JWT) */
app.get('/api/auth/google/link', authenticateToken, (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REDIRECT_URI) {
    return res.status(503).json({ error: 'Google OAuth nije konfigurisan' });
  }
  res.redirect(buildGoogleAuthUrl({ type: 'link', user_id: req.user.id }));
});

/** GET /api/auth/google/callback – handle both login and link */
app.get('/api/auth/google/callback', async (req, res) => {
  const FRONTEND = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    return res.redirect(`${FRONTEND}/login.html?google_error=${encodeURIComponent(oauthError)}`);
  }
  if (!code) {
    return res.redirect(`${FRONTEND}/login.html?google_error=no_code`);
  }

  let parsedState = { type: 'login' };
  try { parsedState = JSON.parse(state || '{}'); } catch (_) {}

  try {
    const gUser = await exchangeGoogleCode(code);
    if (!gUser.email || !gUser.sub) throw new Error('Google did not return email');

    // ── LINK flow ──────────────────────────────────────────────
    if (parsedState.type === 'link' && parsedState.user_id) {
      // Check if google_id already used by another account
      const { data: existing } = await supabase
        .from('users')
        .select('id')
        .eq('google_id', gUser.sub)
        .maybeSingle();

      if (existing && existing.id !== parsedState.user_id) {
        return res.redirect(`${FRONTEND}/profile.html?google_error=already_linked`);
      }

      await supabase
        .from('users')
        .update({ google_id: gUser.sub, provider: 'google' })
        .eq('id', parsedState.user_id);

      return res.redirect(`${FRONTEND}/profile.html?google_linked=1`);
    }

    // ── LOGIN / REGISTER flow ──────────────────────────────────
    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('google_id', gUser.sub)
      .maybeSingle();

    if (!user) {
      // Try matching by email (existing email/password account)
      const { data: byEmail } = await supabase
        .from('users')
        .select('*')
        .eq('email', gUser.email.toLowerCase())
        .maybeSingle();

      if (byEmail) {
        // Link google_id to existing account
        await supabase
          .from('users')
          .update({ google_id: gUser.sub, provider: byEmail.provider || 'email' })
          .eq('id', byEmail.id);
        user = { ...byEmail, google_id: gUser.sub };
      } else {
        // Create new user (google users have no password – store unusable hash)
        const { data: created, error: createErr } = await supabase
          .from('users')
          .insert({
            name:          gUser.name || gUser.email.split('@')[0],
            email:         gUser.email.toLowerCase(),
            password_hash: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10),
            google_id:     gUser.sub,
            provider:      'google',
            role:          'user',
            permissions:   {},
          })
          .select('*')
          .single();

        if (createErr) throw new Error(createErr.message);
        user = created;
      }
    }

    const token = issueJWT(user, req);
    const params = new URLSearchParams({
      token,
      name:  user.name,
      role:  user.role,
      email: user.email,
      id:    user.id,
    });
    return res.redirect(`${FRONTEND}/login.html?${params.toString()}`);

  } catch (err) {
    console.error('[Google OAuth] callback error:', err.message);
    return res.redirect(`${FRONTEND}/login.html?google_error=${encodeURIComponent(err.message)}`);
  }
});

/** GET /api/user/google-status – is google linked? */
app.get('/api/user/google-status', authenticateToken, async (req, res) => {
  const { data: user } = await supabase
    .from('users')
    .select('google_id, provider')
    .eq('id', req.user.id)
    .maybeSingle();
  res.json({ linked: !!user?.google_id });
});

/* ─────────────────────────────────────────
   SITE CONTENT (CMS)
   SQL (run once in Supabase):
   CREATE TABLE site_content (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL,
     updated_at TIMESTAMPTZ DEFAULT now()
   );
───────────────────────────────────────── */

/** GET /api/content – public, returns {key: value, ...} map */
app.get('/api/content', async (req, res) => {
  const { data, error } = await supabase
    .from('site_content')
    .select('key, value');
  if (error) return res.status(500).json({ error: 'Greška' });
  const map = {};
  (data || []).forEach(row => { map[row.key] = row.value; });
  return res.json(map);
});

/** PUT /api/content/:key – admin only, upserts single entry */
app.put('/api/content/:key', authenticateToken, requireAdmin, async (req, res) => {
  const { key } = req.params;
  const { value } = req.body;
  if (!key || value === undefined || value === null)
    return res.status(400).json({ error: 'key i value su obavezni' });

  const { error } = await supabase
    .from('site_content')
    .upsert({ key, value: String(value), updated_at: new Date().toISOString() });

  if (error) {
    console.error('Content update error:', error);
    return res.status(500).json({ error: 'Greška pri čuvanju sadržaja' });
  }
  return res.json({ message: 'Sačuvano', key, value });
});

/** DELETE /api/content/:key – admin only, resets entry to HTML default */
app.delete('/api/content/:key', authenticateToken, requireAdmin, async (req, res) => {
  const { error } = await supabase
    .from('site_content')
    .delete()
    .eq('key', req.params.key);
  if (error) return res.status(500).json({ error: 'Greška' });
  return res.json({ message: 'Sadržaj resetovan na default' });
});

/* ─────────────────────────────────────────
   ENCRYPTED TRANSACTION LOGS
   Buyer email + amount stored AES-256-CBC encrypted in Supabase.
   SQL (run once):
   ┌──────────────────────────────────────────────────────────────┐
   │ CREATE TABLE IF NOT EXISTS transaction_logs (                │
   │   id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),│
   │   buyer_email_enc TEXT NOT NULL,                            │
   │   amount_enc      TEXT NOT NULL,                            │
   │   product_name    TEXT,                                     │
   │   payment_method  TEXT,                                     │
   │   tx_reference    TEXT,                                     │
   │   status          TEXT DEFAULT 'completed',                 │
   │   logged_by       UUID REFERENCES users(id) ON DELETE SET NULL,│
   │   created_at      TIMESTAMPTZ DEFAULT now()                 │
   │ );                                                          │
   └──────────────────────────────────────────────────────────────┘
───────────────────────────────────────── */

/** POST /api/admin/transaction-logs – record an encrypted log entry */
app.post('/api/admin/transaction-logs', authenticateToken, requireAdmin, async (req, res) => {
  const { buyer_email, amount, product_name, payment_method, tx_reference, status } = req.body;
  if (!buyer_email || !amount)
    return res.status(400).json({ error: 'buyer_email i amount su obavezni' });

  const { data, error } = await supabase
    .from('transaction_logs')
    .insert({
      buyer_email_enc: encryptField(buyer_email),
      amount_enc:      encryptField(String(amount)),
      product_name:    product_name || null,
      payment_method:  payment_method || null,
      tx_reference:    tx_reference || null,
      status:          status || 'completed',
      logged_by:       req.user.id,
    })
    .select('id')
    .single();

  if (error) return res.status(500).json({ error: 'Greška pri zapisivanju loga' });
  return res.status(201).json({ id: data.id });
});

/** GET /api/admin/transaction-logs – decrypt and paginate log entries */
app.get('/api/admin/transaction-logs', authenticateToken, requireAdmin, async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;

  const { data, error, count } = await supabase
    .from('transaction_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('[transaction-logs] Supabase error:', error);
    return res.status(500).json({ error: error.message || 'Greška pri čitanju logova' });
  }

  const decrypted = (data || []).map(row => ({
    id:             row.id,
    buyer_email:    decryptField(row.buyer_email_enc),
    amount:         decryptField(row.amount_enc),
    product_name:   row.product_name,
    payment_method: row.payment_method,
    tx_reference:   row.tx_reference,
    status:         row.status,
    created_at:     row.created_at,
  }));

  return res.json({ logs: decrypted, total: count, page, limit });
});

/* ─────────────────────────────────────────
   GUEST CHECKOUT CONFIRM
   Validates purchase, records encrypted audit log, and sends
   a license key / receipt email to the buyer (guest or logged-in).
───────────────────────────────────────── */

/** POST /api/checkout/confirm – confirm payment, send receipt, log encrypted entry */
const confirmCheckoutHandler = async (req, res) => {
  const { buyer_email, buyer_name, guest_email, buyer_inputs, product_id, product_name, amount, payment_method, tx_reference } = req.body;

  // Identify buyer
  let userId = null;
  let email  = buyer_email?.trim().toLowerCase() || guest_email?.trim().toLowerCase() || null;
  const authHeader = req.headers['authorization'];
  const jwtToken   = authHeader && authHeader.split(' ')[1];
  if (jwtToken) {
    try {
      const d = jwt.verify(jwtToken, process.env.JWT_SECRET);
      userId  = d.id;
      if (!email) email = d.email;
    } catch {}
  }

  if (!email)
    return res.status(400).json({ error: 'Email adresa kupca je obavezna (gost mora unijeti email)' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Unesite ispravnu email adresu' });
  if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)
    return res.status(400).json({ error: 'Nevažeći iznos' });

  const parsedAmount = parseFloat(amount);
  const resolvedBuyerName = String(buyer_name || '').trim() || email.split('@')[0];
  const isGuestOrder = !userId;
  const guestToken = isGuestOrder ? crypto.randomUUID() : null;
  const purchasesUrl = buildFrontendPageUrl(req, 'purchases.html');
  const guestOrderUrl = guestToken ? buildFrontendPageUrl(req, 'guest-order.html', { token: guestToken }) : null;

  // 1. Generate license key first (needed for insert + email)
  const licenseKey = 'KFY-' + [
    crypto.randomBytes(4).toString('hex').toUpperCase(),
    crypto.randomBytes(4).toString('hex').toUpperCase(),
    crypto.randomBytes(4).toString('hex').toUpperCase(),
  ].join('-');

  const orderDate = new Date().toLocaleDateString('bs-BA', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  // Fetch product metadata if product_id is known
  let productMeta = null;
  if (product_id) {
    const productSelectAttempts = [
      'image_url, delivery_message, required_user_inputs',
      'image_url, delivery_message',
      'image_url',
    ];

    for (const columns of productSelectAttempts) {
      const { data: prod, error: prodError } = await supabase
        .from('products')
        .select(columns)
        .eq('id', product_id)
        .maybeSingle();

      if (!prodError) {
        productMeta = prod || null;
        break;
      }
      if (!isMissingSchemaError(prodError)) {
        console.error('[checkout/confirm] product meta error:', prodError.message);
        break;
      }
    }
  }

  const productImageUrl = productMeta?.image_url || null;
  const requiredUserInputs = normalizeRequiredUserInputs(productMeta?.required_user_inputs);
  const buyerInputPayload = typeof buyer_inputs === 'string'
    ? safeParseJSON(buyer_inputs, {})
    : (buyer_inputs && typeof buyer_inputs === 'object' ? buyer_inputs : {});
  const validatedInputs = validateRequiredInputs(requiredUserInputs, buyerInputPayload, email);
  if (validatedInputs?.error) {
    return res.status(400).json({ error: validatedInputs.error });
  }

  // Payment proof and manual delivery are separate concerns:
  // - paypal/crypto => user must upload proof
  // - products with required inputs => admin completes delivery after review
  const needsVerification = /^(paypal|crypto)/i.test(payment_method || '');
  const requiresManualDelivery = requiredUserInputs !== 'none';
  const isPendingOrder = needsVerification || requiresManualDelivery;
  const deliveryPayload = isPendingOrder
    ? null
    : buildDeliveryPayload({
        productDelivery: productMeta?.delivery_message,
        licenseKey,
      });
  const encryptedBuyerInputs = validatedInputs?.value
    ? encryptField(JSON.stringify(validatedInputs.value))
    : null;

  // Save transaction record (includes license_key + buyer_email for guest retrieval)
  const ip = getClientIP(req);
  const txInsertWithVerification = {
    user_id: userId,
    product_id: product_id || null,
    product_name: product_name || null,
    product_image: productImageUrl,
    amount: parsedAmount,
    payment_method: payment_method || 'manual',
    status: isPendingOrder ? 'pending' : 'completed',
    verification_status: needsVerification ? 'pending' : null,
    tx_reference: tx_reference || null,
    license_key: licenseKey,
    buyer_email: email,
    delivery_payload: deliveryPayload,
    proof_uploaded: false,
    customer_inputs_enc: encryptedBuyerInputs,
    ip_address_enc: encryptField(ip),
  };
  const txInsertAttempts = buildOptionalColumnAttempts(
    txInsertWithVerification,
    ['verification_status', 'product_image', 'delivery_payload', 'proof_uploaded', 'customer_inputs_enc', 'ip_address_enc', 'buyer_email']
  );

  let tx = null;
  let txErr = null;
  for (const attempt of txInsertAttempts) {
    const result = await supabase
      .from('transactions')
      .insert(attempt)
      .select('id')
      .single();
    tx = result.data;
    txErr = result.error;
    if (!txErr) break;
    if (!isMissingSchemaError(txErr)) break;
    console.warn('[checkout/confirm] retrying tx insert without optional columns:', txErr.message);
  }

  if (txErr) {
    console.error('[checkout/confirm] tx insert error:', txErr.message);
    return res.status(500).json({ error: 'Greška pri snimanju transakcije' });
  }

  if (requiresManualDelivery && !needsVerification) {
    const { error: queueErr } = await supabase
      .from('payment_verifications')
      .insert({
        transaction_id: tx.id,
        user_id: userId,
        buyer_email: email,
        payment_type: 'manual_delivery',
        amount: parsedAmount,
      });

    if (queueErr && !/duplicate/i.test(queueErr.message || '')) {
      console.error('[checkout/confirm] manual delivery queue error:', queueErr.message);
    }
  }

  // 3. Write AES-256-CBC encrypted audit log (non-blocking)
  const txStatus = isPendingOrder ? 'pending' : 'completed';
  supabase.from('transaction_logs').insert({
    buyer_email_enc: encryptField(email),
    amount_enc:      encryptField(String(parsedAmount)),
    product_name:    product_name || null,
    payment_method:  payment_method || null,
    tx_reference:    tx_reference || tx.id,
    status:          txStatus,
    logged_by:       null,
  }).then(({ error: le }) => { if (le) console.error('[tx-log]', le.message); });

  const orderRecord = await insertOrderRecord({
    transaction_id: tx.id,
    user_id: userId,
    buyer_email: email,
    guest_token: guestToken,
    product_id: product_id || null,
    product_name: product_name || null,
    product_image: productImageUrl,
    amount: parsedAmount,
    payment_method: payment_method || 'manual',
    status: txStatus,
    delivery_payload: deliveryPayload,
    proof_uploaded: false,
  });

  // 4. Build premium receipt email
  const imgBlock = productImageUrl
    ? `<div style="text-align:center;padding:20px 32px 0">
         <img src="${escServerHtml(productImageUrl)}" alt="${escServerHtml(product_name || '')}"
              style="max-height:120px;max-width:220px;object-fit:contain;border-radius:12px;
                     border:1px solid rgba(255,255,255,0.08);"/>
       </div>`
    : '';
  const deliveryBoxHtml = deliveryPayload && String(deliveryPayload).trim() !== String(licenseKey).trim()
    ? `<div style="background:linear-gradient(135deg,#f0f4ff 0%,#faf5ff 100%);border:2px solid #A259FF;border-radius:14px;padding:22px;margin-bottom:24px">
         <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#7c3aed;margin-bottom:10px;text-align:center">Vaša isporuka</div>
         <div style="font-size:14px;line-height:1.7;color:#334155;text-align:center">${deliveryPayloadToEmailHtml(deliveryPayload)}</div>
       </div>`
    : '';

  const receiptHTML = `<!DOCTYPE html>
<html lang="bs"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:20px 0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif">
<div style="max-width:520px;margin:0 auto">

  <!-- Header gradient -->
  <div style="background:linear-gradient(135deg,#1D6AFF 0%,#A259FF 100%);border-radius:18px 18px 0 0;padding:32px 36px 28px;text-align:center">
    <div style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:50%;width:56px;height:56px;line-height:56px;font-size:28px;margin-bottom:12px">🔑</div>
    <h1 style="color:#fff;margin:0;font-size:24px;font-weight:800;letter-spacing:-.02em">Narudžba potvrđena!</h1>
    <p style="color:rgba(255,255,255,0.80);margin:6px 0 0;font-size:14px;font-weight:400">Keyify · Digitalna tržnica</p>
  </div>

  <!-- Body card -->
  <div style="background:#fff;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;padding:0 0 28px">

    ${imgBlock}

    <div style="padding:28px 36px 0">
      <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#111827">Hvala na kupovini, ${escServerHtml(email.split('@')[0])}!</p>
      <p style="margin:0 0 24px;font-size:14px;color:#6b7280">Vaša narudžba je obrađena. Licencni ključ i detalji nalaze se ispod.</p>

      ${deliveryBoxHtml}

      <!-- License key box -->
      <div style="background:linear-gradient(135deg,#f0f4ff 0%,#faf5ff 100%);border:2px solid #A259FF;border-radius:14px;padding:22px;text-align:center;margin-bottom:24px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#7c3aed;margin-bottom:10px">Licencni ključ</div>
        <div style="font-size:22px;font-weight:800;letter-spacing:5px;color:#1D6AFF;font-family:'Courier New',monospace;word-break:break-all">${escServerHtml(licenseKey)}</div>
        <div style="font-size:11px;color:#9ca3af;margin-top:8px">Čuvajte ovaj ključ na sigurnom · nije ponovljiv</div>
      </div>

      <!-- Order details table -->
      <table style="width:100%;border-collapse:collapse;font-size:13px;color:#374151">
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;color:#6b7280">Proizvod</td>
          <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600;color:#111827">${escServerHtml(product_name || 'Digitalni proizvod')}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;color:#6b7280">Iznos</td>
          <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:700;color:#1D6AFF;font-size:15px">€ ${parsedAmount.toFixed(2)}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;color:#6b7280">Metoda plaćanja</td>
          <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600">${escServerHtml(payment_method || 'Manual')}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;color:#6b7280">Datum</td>
          <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;text-align:right">${orderDate}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;color:#6b7280">ID narudžbe</td>
          <td style="padding:10px 0;text-align:right;font-family:'Courier New',monospace;font-size:11px;color:#9ca3af">${escServerHtml(tx.id)}</td>
        </tr>
      </table>
    </div>
  </div>

  <!-- Footer -->
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 18px 18px;padding:20px 36px;text-align:center">
    <p style="margin:0 0 6px;font-size:12px;color:#9ca3af">Pitanja? Kontaktirajte nas na <a href="mailto:${escServerHtml(process.env.EMAIL_USER || 'support@keyify.app')}" style="color:#1D6AFF;text-decoration:none">${escServerHtml(process.env.EMAIL_USER || 'support@keyify.app')}</a></p>
    <p style="margin:0;font-size:11px;color:#d1d5db">© ${new Date().getFullYear()} Keyify · Automatski generirani račun · Ne odgovarajte na ovaj email</p>
  </div>

</div>
</body></html>`;

  // Only send receipt email once the order is fully completed
  let emailSent = false;
  const trackingUrl = guestOrderUrl || purchasesUrl;
  try {
    await sendMailSafe({
      from: process.env.EMAIL_FROM || `"Keyify" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: isGuestOrder
        ? `Keyify - Pracenje gost porudzbine #${tx.id}`
        : `Keyify - Pracenje porudzbine #${tx.id}`,
      html: renderOrderCreatedEmail({
        buyerEmail: email,
        productName: product_name,
        orderId: tx.id,
        amount: parsedAmount,
        productImageUrl,
        isGuest: isGuestOrder,
        ctaUrl: trackingUrl,
        isPendingOrder,
      }),
    });
    emailSent = true;
  } catch (emailErr) {
    console.error('[checkout/confirm] email error:', emailErr.message);
  }

  return res.json({
    ok:                  true,
    order_id:            tx.id,
    transaction_id:      tx.id,
    buyer_name:          resolvedBuyerName,
    license_key:         isPendingOrder ? null : licenseKey,
    needs_verification:  needsVerification,
    requires_manual_delivery: requiresManualDelivery,
    redirect_to_chat:    requiredUserInputs === 'redirect_to_chat',
    required_user_inputs: requiredUserInputs,
    delivery_payload:    deliveryPayload,
    product_name:        product_name || null,
    product_image:       productImageUrl,
    amount:              parsedAmount,
    order_date:          new Date().toISOString(),
    email_sent_to:       email,
    email_sent:          emailSent,
    guest_token:         guestToken || orderRecord?.guest_token || null,
    guest_order_url:     guestOrderUrl,
    tracking_url:        trackingUrl,
  });
};

app.post('/api/checkout/confirm', confirmCheckoutHandler);
app.post('/api/orders', confirmCheckoutHandler);

app.get('/api/orders/guest/:token', async (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!/^[0-9a-fA-F-]{32,40}$/.test(token)) {
    return res.status(400).json({ error: 'Neispravan guest token.' });
  }

  const orderSelectAttempts = [
    'id, transaction_id, user_id, buyer_email, guest_token, product_id, product_name, product_image, amount, payment_method, status, delivery_payload, proof_uploaded, created_at, updated_at',
    'id, transaction_id, user_id, buyer_email, guest_token, product_id, product_name, product_image, amount, payment_method, status, delivery_payload, created_at',
    'id, transaction_id, user_id, buyer_email, guest_token, product_id, product_name, amount, payment_method, status, created_at',
  ];

  let order = null;
  let orderError = null;
  for (const select of orderSelectAttempts) {
    const result = await supabase
      .from('orders')
      .select(select)
      .eq('guest_token', token)
      .maybeSingle();
    order = result.data;
    orderError = result.error;
    if (!orderError) break;
    if (!isMissingSchemaError(orderError)) break;
  }

  if (orderError) {
    console.error('[orders/guest] query error:', orderError.message);
    if (isMissingSchemaError(orderError)) {
      return res.status(500).json({ error: 'Guest tracking nije dostupan dok orders guest migracija ne bude puštena.' });
    }
    return res.status(500).json({ error: 'Greška pri učitavanju porudžbine.' });
  }

  if (!order) {
    return res.status(404).json({ error: 'Porudžbina nije pronađena.' });
  }

  let tx = null;
  if (order.transaction_id) {
    const txSelectAttempts = [
      'id, product_id, product_name, product_image, amount, payment_method, status, verification_status, license_key, buyer_email, delivery_payload, proof_uploaded, created_at',
      'id, product_id, product_name, product_image, amount, payment_method, status, verification_status, license_key, buyer_email, delivery_payload, created_at',
      'id, product_id, product_name, amount, payment_method, status, license_key, buyer_email, created_at',
    ];

    for (const select of txSelectAttempts) {
      const result = await supabase
        .from('transactions')
        .select(select)
        .eq('id', order.transaction_id)
        .maybeSingle();
      tx = result.data;
      if (!result.error) break;
      if (!isMissingSchemaError(result.error)) {
        console.warn('[orders/guest] tx lookup failed:', result.error.message);
        tx = null;
        break;
      }
    }
  }

  const normalizedBuyerEmail = String(order.buyer_email || tx?.buyer_email || '').trim().toLowerCase();
  let existingUser = null;
  if (normalizedBuyerEmail) {
    const { data } = await supabase
      .from('users')
      .select('id, name, email, role, permissions, avatar_url')
      .eq('email', normalizedBuyerEmail)
      .maybeSingle();
    existingUser = data || null;
  }

  return res.json({
    id: order.id,
    transaction_id: order.transaction_id || tx?.id || null,
    guest_token: order.guest_token || token,
    user_id: order.user_id || tx?.user_id || null,
    buyer_email: order.buyer_email || tx?.buyer_email || null,
    product_id: order.product_id || tx?.product_id || null,
    product_name: tx?.product_name || order.product_name || 'Digitalni proizvod',
    product_image: tx?.product_image || order.product_image || null,
    amount: Number(tx?.amount ?? order.amount ?? 0),
    payment_method: tx?.payment_method || order.payment_method || 'manual',
    status: tx?.status || order.status || 'pending',
    verification_status: tx?.verification_status || null,
    proof_uploaded: order.proof_uploaded === true || tx?.proof_uploaded === true,
    delivery_payload: tx?.delivery_payload || order.delivery_payload || tx?.license_key || null,
    created_at: order.created_at || tx?.created_at || null,
    updated_at: order.updated_at || null,
    is_guest: true,
    account_exists: !!existingUser,
    account_linked: !!(existingUser && (order.user_id || tx?.user_id)),
  });
});

app.post('/api/auth/guest-resume', authLimiter, async (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Guest token je obavezan.' });

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, buyer_email, guest_token')
    .eq('guest_token', token)
    .maybeSingle();

  if (orderError) {
    console.error('[guest-resume] order lookup error:', orderError.message);
    return res.status(500).json({ error: 'Greška pri obradi gost porudžbine.' });
  }

  if (!order?.buyer_email) {
    return res.status(404).json({ error: 'Gost porudžbina nije pronađena.' });
  }

  const normalizedEmail = String(order.buyer_email).trim().toLowerCase();
  const { data: existingUser, error: userError } = await supabase
    .from('users')
    .select('id, name, email, role, permissions, avatar_url')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (userError) {
    console.error('[guest-resume] user lookup error:', userError.message);
    return res.status(500).json({ error: 'Greška pri prijavi korisnika.' });
  }

  if (!existingUser) {
    return res.status(404).json({ error: 'Za ovu porudžbinu još ne postoji nalog.' });
  }

  await relinkGuestPurchasesToUser(normalizedEmail, existingUser.id);

  await supabase.from('audit_logs').insert({
    user_id: existingUser.id,
    action: 'resume_guest_account',
    ip: getClientIP(req),
    created_at: new Date().toISOString(),
  }).then(() => {}).catch(() => {});

  return res.json(buildGuestAuthPayload(existingUser, req, {
    auto_logged_in: true,
    existing_account: true,
  }));
});

app.post('/api/auth/convert-guest', authLimiter, async (req, res) => {
  const token = String(req.body?.token || '').trim();
  const password = String(req.body?.password || '');

  if (!token) return res.status(400).json({ error: 'Guest token je obavezan.' });
  if (password.length < 8) return res.status(400).json({ error: 'Lozinka mora imati najmanje 8 karaktera.' });

  const orderSelectAttempts = [
    'id, buyer_email, guest_token',
    'id, buyer_email',
  ];

  let order = null;
  let orderError = null;
  for (const select of orderSelectAttempts) {
    const result = await supabase
      .from('orders')
      .select(select)
      .eq('guest_token', token)
      .maybeSingle();
    order = result.data;
    orderError = result.error;
    if (!orderError) break;
    if (!isMissingSchemaError(orderError)) break;
  }

  if (orderError) {
    console.error('[convert-guest] order lookup error:', orderError.message);
    if (isMissingSchemaError(orderError)) {
      return res.status(500).json({ error: 'Guest konverzija nije dostupna dok orders guest migracija ne bude puštena.' });
    }
    return res.status(500).json({ error: 'Greška pri obradi gost porudžbine.' });
  }

  if (!order?.buyer_email) {
    return res.status(404).json({ error: 'Gost porudžbina nije pronađena.' });
  }

  const normalizedEmail = String(order.buyer_email).trim().toLowerCase();
  const { data: existingUser } = await supabase
    .from('users')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (existingUser) {
    await relinkGuestPurchasesToUser(normalizedEmail, existingUser.id);
    await supabase.from('audit_logs').insert({
      user_id: existingUser.id,
      action: 'convert_guest_account_existing',
      ip: getClientIP(req),
      created_at: new Date().toISOString(),
    }).then(() => {}).catch(() => {});
    return res.json(buildGuestAuthPayload(existingUser, req, {
      auto_logged_in: true,
      existing_account: true,
    }));
    return res.status(409).json({ error: 'Nalog sa ovim emailom već postoji. Molimo prijavite se.' });
  }

  const password_hash = await bcrypt.hash(password, 12);
  const ip = getClientIP(req);
  const { data: createdUser, error: createError } = await supabase
    .from('users')
    .insert({
      name: normalizedEmail.split('@')[0],
      email: normalizedEmail,
      password_hash,
      role: 'user',
      permissions: {},
      is_verified: true,
      registered_ip: ip,
      created_at: new Date().toISOString(),
    })
    .select('id, name, email, role, permissions')
    .single();

  if (createError) {
    console.error('[convert-guest] create user error:', createError.message);
    return res.status(500).json({ error: 'Greška pri kreiranju naloga.' });
  }

  const updateOrdersAttempts = buildOptionalColumnAttempts(
    { user_id: createdUser.id, updated_at: new Date().toISOString() },
    ['updated_at']
  );
  for (const attempt of updateOrdersAttempts) {
    const { error } = await supabase
      .from('orders')
      .update(attempt)
      .eq('buyer_email', normalizedEmail)
      .is('user_id', null);
    if (!error) break;
    if (!isMissingSchemaError(error)) {
      console.warn('[convert-guest] orders relink warning:', error.message);
      break;
    }
  }

  const { error: txRelinkError } = await supabase
    .from('transactions')
    .update({ user_id: createdUser.id })
    .eq('buyer_email', normalizedEmail)
    .is('user_id', null);
  if (txRelinkError && !isMissingSchemaError(txRelinkError)) {
    console.warn('[convert-guest] transactions relink warning:', txRelinkError.message);
  }

  await supabase.from('audit_logs').insert({
    user_id: createdUser.id,
    action: 'convert_guest_account',
    ip,
    created_at: new Date().toISOString(),
  }).then(() => {}).catch(() => {});

  const authToken = issueJWT(createdUser, req);
  return res.json({
    ok: true,
    token: authToken,
    user: sanitizeUser({
      ...createdUser,
      role: createdUser.role || 'user',
      permissions: createdUser.permissions || {},
    }),
  });
});

/* ─────────────────────────────────────────
   Health check
───────────────────────────────────────── */
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

/* ─────────────────────────────────────────
   SITE ASSET UPLOAD
   POST /api/admin/upload-asset
   Accepts PNG/JPG/SVG (≤5 MB), stores in Supabase Storage bucket "site-assets",
   returns the public URL for immediate use in the Live Editor.
───────────────────────────────────────── */
const assetUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ok = file.mimetype.startsWith('image/') || file.mimetype === 'image/svg+xml';
    if (ok) cb(null, true);
    else cb(new Error('Dozvoljeni tipovi: PNG, JPG, SVG'));
  },
}).single('file');

app.post('/api/admin/upload-asset', authenticateToken, requireAdmin, (req, res) => {
  assetUpload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Nije priložen fajl' });

    const ext      = (req.file.originalname.split('.').pop() || 'bin').toLowerCase();
    const filePath = `assets/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('site-assets')
      .upload(filePath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
    if (upErr) return res.status(500).json({ error: `Storage: ${upErr.message}` });

    const { data: { publicUrl } } = supabase.storage.from('site-assets').getPublicUrl(filePath);
    return res.json({ url: publicUrl });
  });
});

/* ─────────────────────────────────────────
   Page Builder Routes
   POST /api/pages/:slug  – save serialised HTML for a static page (admin)
   GET  /api/pages/:slug  – retrieve saved HTML for a static page (public)

   Supabase table (run once):
   ┌─────────────────────────────────────────────────────────────────┐
   │ CREATE TABLE IF NOT EXISTS page_templates (                     │
   │   slug        TEXT PRIMARY KEY,                                 │
   │   html        TEXT NOT NULL,                                    │
   │   updated_by  UUID REFERENCES users(id),                       │
   │   updated_at  TIMESTAMPTZ DEFAULT now()                         │
   │ );                                                              │
   └─────────────────────────────────────────────────────────────────┘
───────────────────────────────────────── */

/** POST /api/pages/:slug  – admin only, upsert page HTML */
app.post('/api/pages/:slug', authenticateToken, requireAdmin, async (req, res) => {
  const { slug } = req.params;
  const { html  } = req.body;

  if (!slug || typeof html !== 'string') {
    return res.status(400).json({ error: 'slug i html su obavezni' });
  }

  // Basic sanity: slug must be safe filename characters only
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(slug)) {
    return res.status(400).json({ error: 'Nevalidan slug' });
  }

  const { error } = await supabase
    .from('page_templates')
    .upsert(
      { slug, html, updated_by: req.user.id, updated_at: new Date().toISOString() },
      { onConflict: 'slug' }
    );

  if (error) {
    console.error('[pages] upsert error:', error);
    return res.status(500).json({ error: 'Greška pri čuvanju stranice' });
  }

  return res.json({ message: 'Stranica sačuvana', slug });
});

/** GET /api/pages/:slug  – public, returns saved HTML or 404 */
app.get('/api/pages/:slug', async (req, res) => {
  const { slug } = req.params;

  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(slug)) {
    return res.status(400).json({ error: 'Nevalidan slug' });
  }

  const { data, error } = await supabase
    .from('page_templates')
    .select('html, updated_at')
    .eq('slug', slug)
    .maybeSingle();

  if (error) {
    console.error('[pages] select error:', error);
    return res.status(500).json({ error: 'Greška' });
  }

  if (!data) return res.status(404).json({ error: 'Stranica nije pronađena' });

  return res.json({ slug, html: data.html, updated_at: data.updated_at });
});

/* ─────────────────────────────────────────
   ADMIN – ALL TRANSACTIONS (sve metode plaćanja)
   Supabase migration (run once):
   ALTER TABLE transactions ADD COLUMN IF NOT EXISTS ip_address_enc TEXT;
───────────────────────────────────────── */

/** GET /api/admin/transactions/count – total transaction count for badge */
app.get('/api/admin/transactions/count', authenticateToken, checkPermission('can_view_invoices'), async (req, res) => {
  const { count, error } = await supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ count: count || 0 });
});

/** GET /api/admin/transactions – paginated, all payment methods */
app.get('/api/admin/transactions', authenticateToken, checkPermission('can_view_invoices'), async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 25);
  const offset = (page - 1) * limit;
  const status = req.query.status || null;
  const method = req.query.method || null;

  const columnAttempts = [
    'id, user_id, product_name, amount, payment_method, status, tx_reference, license_key, buyer_email, ip_address_enc, created_at',
    'id, user_id, product_name, amount, payment_method, status, tx_reference, license_key, buyer_email, created_at',
    'id, user_id, product_name, amount, payment_method, status, tx_reference, license_key, created_at',
  ];

  let data = null;
  let error = null;
  let count = 0;

  for (const columns of columnAttempts) {
    let query = supabase
      .from('transactions')
      .select(columns, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (method) query = query.eq('payment_method', method);

    const result = await query;
    data = result.data;
    error = result.error;
    count = result.count || 0;

    if (!error) break;
    if (!isMissingSchemaError(error)) break;
  }

  if (error) {
    console.error('[admin/transactions]', error.message);
    return res.status(500).json({ error: 'Greška pri dohvatanju transakcija' });
  }

  // Fetch user info (avatar, name, email) separately
  const userIds = [...new Set((data || []).map(r => r.user_id).filter(Boolean))];
  let userMap = {};
  if (userIds.length) {
    const { data: users } = await supabase.from('users').select('id, name, email, avatar_url').in('id', userIds);
    if (users) users.forEach(u => { userMap[u.id] = u; });
  }

  // Fetch payment verification details (payer account) separately
  const txIds = (data || []).map(r => r.id);
  let pvMap = {};
  if (txIds.length) {
    const { data: pvs, error: pvError } = await supabase
      .from('payment_verifications')
      .select('transaction_id, paypal_email, tx_hash, network')
      .in('transaction_id', txIds);
    if (pvError && !isMissingSchemaError(pvError)) {
      console.error('[admin/transactions] payment_verifications lookup failed:', pvError.message);
    }
    if (pvs) pvs.forEach(pv => { pvMap[pv.transaction_id] = pv; });
  }

  const transactions = (data || []).map(row => {
    const u = row.user_id ? userMap[row.user_id] : null;
    const pv = pvMap[row.id];
    let payer_account = null;
    if (pv?.paypal_email) payer_account = pv.paypal_email;
    else if (pv?.tx_hash) payer_account = (pv.network ? pv.network + ': ' : '') + pv.tx_hash;

    return {
      id:             row.id,
      customer_name:  u?.name || null,
      customer_email: row.buyer_email || u?.email || null,
      avatar_url:     u?.avatar_url || null,
      product_name:   row.product_name,
      amount:         row.amount,
      payment_method: row.payment_method,
      status:         row.status,
      tx_reference:   row.tx_reference,
      license_key:    row.license_key,
      ip_address:     row.ip_address_enc ? decryptField(row.ip_address_enc) : null,
      payer_account,
      created_at:     row.created_at,
    };
  });

  return res.json({ transactions, total: count, page, limit });
});

/** GET /api/admin/receipt/:id – printable HTML receipt, admin only */
app.get('/api/admin/receipt/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { data: row, error } = await supabase
    .from('transactions')
    .select('*, users(name, email)')
    .eq('id', req.params.id)
    .maybeSingle();

  if (error || !row) return res.status(404).send('<h2>Transakcija nije pronađena</h2>');

  const buyerEmail = row.buyer_email || row.users?.email || '—';
  const buyerName  = row.users?.name || buyerEmail.split('@')[0];
  const amount     = parseFloat(row.amount || 0).toFixed(2);
  const date       = new Date(row.created_at).toLocaleString('sr-RS', { dateStyle:'long', timeStyle:'short' });
  const pm         = escServerHtml(row.payment_method || '—');
  const esc        = escServerHtml;
  const returnToRaw = typeof req.query.return_to === 'string' ? req.query.return_to.trim() : '';
  const returnTo = returnToRaw && !/^javascript:/i.test(returnToRaw) ? returnToRaw : '/admin.html';
  const returnHref = esc(returnTo || '/admin.html?section=invoices&receipt_return=1');

  const html = `<!DOCTYPE html>
<html lang="bs">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Račun – ${esc(row.product_name || 'Narudžba')}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Poppins:wght@600;700;800&display=swap');
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:'Inter',sans-serif; background:#f4f6f9; color:#1f2937; padding:32px 16px; }
    .card { max-width:560px; margin:0 auto; background:#fff; border-radius:20px; overflow:hidden;
            border:1px solid #e5e7eb; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    .header { background:linear-gradient(135deg,#1D6AFF 0%,#A259FF 100%); padding:30px 36px; text-align:center; }
    .header h1 { color:#fff; font-family:'Poppins',sans-serif; font-size:22px; font-weight:800; margin-bottom:4px; }
    .header p  { color:rgba(255,255,255,0.75); font-size:13px; }
    .body { padding:28px 36px; }
    .key-box { background:linear-gradient(135deg,#f0f4ff,#faf5ff); border:2px solid #A259FF;
               border-radius:14px; padding:20px; text-align:center; margin-bottom:24px; }
    .key-box .lbl { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.1em; color:#7c3aed; margin-bottom:8px; }
    .key-box .key { font-size:20px; font-weight:800; letter-spacing:4px; color:#1D6AFF;
                    font-family:'Courier New',monospace; word-break:break-all; }
    table { width:100%; border-collapse:collapse; font-size:13px; }
    td { padding:10px 0; border-bottom:1px solid #f3f4f6; }
    td:first-child { color:#6b7280; width:160px; }
    td:last-child { font-weight:600; text-align:right; }
    .amount { color:#1D6AFF; font-size:16px; font-weight:800; }
    .footer { background:#f9fafb; border-top:1px solid #e5e7eb; padding:16px 36px; text-align:center;
              font-size:11px; color:#9ca3af; }
    .badge { display:inline-block; padding:3px 12px; border-radius:20px; font-size:11px; font-weight:700;
             background:rgba(74,222,128,0.15); color:#16a34a; }
    @media print {
      body { background:#fff; padding:0; }
      .card { box-shadow:none; border:none; }
      .no-print { display:none; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="max-width:560px;margin:0 auto 16px;display:flex;gap:10px;justify-content:flex-end">
    <button onclick="window.print()" style="background:#1D6AFF;color:#fff;border:none;border-radius:10px;
            padding:10px 22px;font-size:14px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif">
      🖨️ Štampaj / Spremi PDF
    </button>
    <a href="${returnHref}" style="display:inline-flex;align-items:center;justify-content:center;text-decoration:none;background:#f3f4f6;color:#374151;border:none;border-radius:10px;
            padding:10px 22px;font-size:14px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif">
      Nazad na transakcije
    </a>
  </div>

  <div class="card">
    <div class="header">
      <div style="font-size:40px;margin-bottom:10px">🔑</div>
      <h1>Račun / Potvrda narudžbe</h1>
      <p>Keyify · Digitalna tržnica</p>
    </div>

    <div class="body">
      <div class="key-box">
        <div class="lbl">Licencni ključ</div>
        <div class="key">${esc(row.license_key || '—')}</div>
      </div>

      <table>
        <tr>
          <td>Kupac</td>
          <td>${esc(buyerName)} &lt;${esc(buyerEmail)}&gt;</td>
        </tr>
        <tr>
          <td>Proizvod</td>
          <td>${esc(row.product_name || '—')}</td>
        </tr>
        <tr>
          <td>Iznos</td>
          <td class="amount">€ ${amount}</td>
        </tr>
        <tr>
          <td>Metoda plaćanja</td>
          <td>${pm}</td>
        </tr>
        <tr>
          <td>Datum</td>
          <td>${date}</td>
        </tr>
        <tr>
          <td>Status</td>
          <td><span class="badge">${esc(row.status || 'completed')}</span></td>
        </tr>
        <tr>
          <td>ID transakcije</td>
          <td style="font-family:'Courier New',monospace;font-size:11px;color:#9ca3af">${esc(row.id)}</td>
        </tr>
        ${row.tx_reference ? `<tr>
          <td>Referenca</td>
          <td style="font-family:'Courier New',monospace;font-size:11px;color:#9ca3af">${esc(row.tx_reference)}</td>
        </tr>` : ''}
      </table>
    </div>

    <div class="footer">
      © ${new Date().getFullYear()} Keyify · Račun generiran ${new Date().toLocaleString('sr-RS')}
    </div>
  </div>
</body>
</html>`;

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(html);
});

/* ─────────────────────────────────────────
   STRIPE INVOICE ROUTES
───────────────────────────────────────── */

/**
 * POST /api/stripe/create-invoice
 * Body: { email, name?, product_id?, product_name, amount_cents, currency? }
 * Optional Bearer JWT (identifies logged-in user).
 * Creates a Stripe Customer → Invoice → finalizes → returns client_secret.
 */
const stripeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Previše zahtjeva za plaćanje. Pokušajte za 15 minuta.' },
});

app.post('/api/stripe/create-invoice', stripeLimiter, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe nije konfigurisan na ovom serveru.' });

  const {
    email, name,
    product_id, product_name,
    amount_cents,
    currency = 'eur',
  } = req.body;

  // Validation
  if (!email || !product_name || !amount_cents)
    return res.status(400).json({ error: 'email, product_name i amount_cents su obavezni' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Nevažeća email adresa' });
  if (!Number.isInteger(amount_cents) || amount_cents < 50)
    return res.status(400).json({ error: 'Iznos mora biti cijeli broj (centi) i minimum 50' });

  const ip = getClientIP(req);

  // Identify logged-in user if token present
  let userId = null;
  const jwtToken = req.headers['authorization']?.split(' ')[1];
  if (jwtToken) {
    try { userId = jwt.verify(jwtToken, process.env.JWT_SECRET).id; } catch {}
  }

  try {
    // 1. Find or create Stripe Customer
    const existing = await stripe.customers.list({ email: email.toLowerCase(), limit: 1 });
    const customer = existing.data.length > 0
      ? existing.data[0]
      : await stripe.customers.create({
          email: email.toLowerCase(),
          name:  name || undefined,
          metadata: { keyify_user_id: userId || '' },
        });

    // 2. Create draft Invoice
    const draftInvoice = await stripe.invoices.create({
      customer:            customer.id,
      collection_method:   'charge_automatically',
      currency,
      description:         `Keyify – ${product_name}`,
      metadata: {
        product_id:   product_id || '',
        product_name,
        user_id:      userId || '',
        ip:           ip,
      },
    });

    // 3. Attach line item
    await stripe.invoiceItems.create({
      customer:    customer.id,
      invoice:     draftInvoice.id,
      description: product_name,
      amount:      amount_cents,
      currency,
    });

    // 4. Finalize → creates PaymentIntent automatically
    const inv = await stripe.invoices.finalizeInvoice(draftInvoice.id);
    const piId = typeof inv.payment_intent === 'string'
      ? inv.payment_intent
      : inv.payment_intent?.id;

    // 5. Persist to DB (email + IP encrypted)
    await supabase.from('invoices').insert({
      stripe_invoice_id:        inv.id,
      stripe_payment_intent_id: piId || null,
      stripe_customer_id:       customer.id,
      user_id:                  userId,
      customer_name:            name || null,
      customer_email_enc:       encryptField(email.toLowerCase()),
      product_id:               product_id || null,
      product_name,
      amount_cents,
      currency,
      status:                   inv.status || 'open',
      stripe_invoice_url:       inv.hosted_invoice_url || null,
      stripe_invoice_pdf:       inv.invoice_pdf || null,
      ip_address_enc:           encryptField(ip),
    });

    // 6. Fetch client_secret from the PaymentIntent
    const pi = await stripe.paymentIntents.retrieve(piId);

    return res.json({
      client_secret: pi.client_secret,
      invoice_id:    inv.id,
      invoice_url:   inv.hosted_invoice_url,
    });
  } catch (err) {
    console.error('[stripe/create-invoice] Error:', err.message);
    return res.status(500).json({ error: 'Greška pri kreiranju računa: ' + err.message });
  }
});

/* ─────────────────────────────────────────
   ADMIN – All Invoices (Stripe)
   Strictly requires admin role + permission.
   Decrypts email + IP before sending to client.
───────────────────────────────────────── */

/** GET /api/admin/invoices  – paginated, optional ?status= filter */
app.get('/api/admin/invoices', authenticateToken, checkPermission('can_view_invoices'), async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 25);
  const offset = (page - 1) * limit;
  const status = req.query.status || null;

  let query = supabase
    .from('invoices')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq('status', status);

  const { data, error, count } = await query;
  if (error) {
    console.error('[admin/invoices]', error.message);
    return res.status(500).json({ error: 'Greška pri dohvatanju računa' });
  }

  const invoices = (data || []).map(row => ({
    id:                      row.id,
    stripe_invoice_id:       row.stripe_invoice_id,
    customer_name:           row.customer_name,
    customer_email:          decryptField(row.customer_email_enc),
    product_name:            row.product_name,
    amount_cents:            row.amount_cents,
    currency:                row.currency,
    status:                  row.status,
    payment_method_type:     row.payment_method_type,
    stripe_invoice_url:      row.stripe_invoice_url,
    stripe_invoice_pdf:      row.stripe_invoice_pdf,
    ip_address:              decryptField(row.ip_address_enc),
    created_at:              row.created_at,
    paid_at:                 row.paid_at,
  }));

  return res.json({ invoices, total: count, page, limit });
});

/* ─────────────────────────────────────────
   REFERRAL SYSTEM
───────────────────────────────────────── */

/** GET /api/user/referral – get user's referral info */
app.get('/api/user/referral', authenticateToken, async (req, res) => {
  const userId = req.user.id;

  // Get or create referral code
  let { data: refCode } = await supabase
    .from('referral_codes')
    .select('code')
    .eq('user_id', userId)
    .maybeSingle();

  if (!refCode) {
    const code = 'REF-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const { data: newCode } = await supabase
      .from('referral_codes')
      .insert({ user_id: userId, code })
      .select('code')
      .single();
    refCode = newCode;
  }

  // Count referrals
  const { count: refCount } = await supabase
    .from('referrals')
    .select('id', { count: 'exact', head: true })
    .eq('referrer_id', userId);

  // Get tiers
  const { data: tiers } = await supabase
    .from('referral_tiers')
    .select('*')
    .order('tier_level', { ascending: true });

  const count = refCount || 0;
  let currentTier = null;
  let nextTier = null;
  for (const tier of (tiers || [])) {
    if (count >= tier.required_referrals) currentTier = tier;
    else { nextTier = tier; break; }
  }

  const progress = nextTier
    ? Math.round((count / nextTier.required_referrals) * 100)
    : 100;

  return res.json({
    code:          refCode?.code || null,
    referral_count: count,
    current_tier:  currentTier,
    next_tier:     nextTier,
    progress,
    tiers:         tiers || [],
  });
});

/** Check and award referral tier rewards */
async function checkReferralRewards(referrerId) {
  const { count } = await supabase
    .from('referrals')
    .select('id', { count: 'exact', head: true })
    .eq('referrer_id', referrerId);

  const { data: tiers } = await supabase
    .from('referral_tiers')
    .select('*')
    .order('tier_level', { ascending: true });

  // Check which tiers the referrer qualifies for
  for (const tier of (tiers || [])) {
    if ((count || 0) >= tier.required_referrals) {
      // Check if reward already given for this tier
      const { data: existing } = await supabase
        .from('user_coupons')
        .select('id')
        .eq('user_id', referrerId)
        .eq('source', 'referral_reward')
        .ilike('code', `%TIER${tier.tier_level}%`)
        .maybeSingle();

      if (!existing) {
        // Generate reward coupon
        const code = `REF-TIER${tier.tier_level}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const { data: promo } = await supabase.from('promo_codes').insert({
          code,
          discount_type:  tier.reward_type,
          discount_value: tier.reward_value,
          usage_limit:    1,
          is_active:      true,
          created_at:     new Date().toISOString(),
        }).select('id').single();

        if (promo) {
          const { data: referrer } = await supabase.from('users').select('email').eq('id', referrerId).maybeSingle();
          await supabase.from('user_coupons').insert({
            user_id:       referrerId,
            buyer_email:   referrer?.email || '',
            promo_code_id: promo.id,
            code,
            source:        'referral_reward',
          });

          // Email the reward
          if (referrer?.email) {
            const discountLabel = tier.reward_type === 'percent' ? `${tier.reward_value}%` : `€${tier.reward_value}`;
            sendMailSafe({
              from:    process.env.EMAIL_FROM || `"Keyify" <${process.env.EMAIL_USER}>`,
              to:      referrer.email,
              subject: `🎉 Keyify – Čestitamo! Otključali ste nivo "${tier.name}" · ${discountLabel} popust`,
              html: `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:20px 0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif">
<div style="max-width:520px;margin:0 auto">
  <div style="background:linear-gradient(135deg,#f59e0b,#ef4444);border-radius:18px 18px 0 0;padding:32px;text-align:center">
    <div style="font-size:40px;margin-bottom:8px">🏆</div>
    <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800">Nivo "${tier.name}" otključan!</h1>
  </div>
  <div style="background:#fff;border:1px solid #e5e7eb;padding:28px 36px;text-align:center">
    <p style="font-size:14px;color:#374151;margin:0 0 20px">Pozvali ste ${count} prijatelja i otključali nagradu:</p>
    <div style="background:linear-gradient(135deg,#f0f4ff,#faf5ff);border:2px solid #f59e0b;border-radius:14px;padding:20px;margin-bottom:16px">
      <div style="font-size:24px;font-weight:800;color:#f59e0b;font-family:'Courier New',monospace">${code}</div>
      <div style="font-size:14px;color:#22c55e;font-weight:700;margin-top:6px">${discountLabel} popust</div>
    </div>
  </div>
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 18px 18px;padding:16px;text-align:center">
    <p style="margin:0;font-size:11px;color:#d1d5db">© ${new Date().getFullYear()} Keyify</p>
  </div>
</div></body></html>`,
            }).catch(() => {});
          }
        }
      }
    }
  }
}

/** GET /api/admin/referral/tiers */
app.get('/api/admin/referral/tiers', authenticateToken, checkPermission('can_manage_referrals'), async (req, res) => {
  const { data } = await supabase.from('referral_tiers').select('*').order('tier_level', { ascending: true });
  return res.json(data || []);
});

/** POST /api/admin/referral/tiers */
app.post('/api/admin/referral/tiers', authenticateToken, checkPermission('can_manage_referrals'), async (req, res) => {
  const { tier_level, name, required_referrals, reward_type, reward_value } = req.body;
  if (!name || !tier_level || !required_referrals || !reward_type || !reward_value)
    return res.status(400).json({ error: 'Sva polja su obavezna' });
  const { data, error } = await supabase.from('referral_tiers').insert({
    tier_level: parseInt(tier_level), name, required_referrals: parseInt(required_referrals),
    reward_type, reward_value: parseFloat(reward_value),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

/** PUT /api/admin/referral/tiers/:id */
app.put('/api/admin/referral/tiers/:id', authenticateToken, checkPermission('can_manage_referrals'), async (req, res) => {
  const updates = {};
  if (req.body.name !== undefined)               updates.name = req.body.name;
  if (req.body.required_referrals !== undefined)  updates.required_referrals = parseInt(req.body.required_referrals);
  if (req.body.reward_type !== undefined)         updates.reward_type = req.body.reward_type;
  if (req.body.reward_value !== undefined)        updates.reward_value = parseFloat(req.body.reward_value);
  const { error } = await supabase.from('referral_tiers').update(updates).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Greška' });
  return res.json({ ok: true });
});

/** DELETE /api/admin/referral/tiers/:id */
app.delete('/api/admin/referral/tiers/:id', authenticateToken, checkPermission('can_manage_referrals'), async (req, res) => {
  const { error } = await supabase.from('referral_tiers').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Greška' });
  return res.json({ ok: true });
});

/** GET /api/admin/referral/stats */
app.get('/api/admin/referral/stats', authenticateToken, checkPermission('can_manage_referrals'), async (req, res) => {
  const { count: totalReferrals } = await supabase.from('referrals').select('id', { count: 'exact', head: true });
  const { count: totalReferrers } = await supabase.from('referral_codes').select('id', { count: 'exact', head: true });
  const { count: rewardsIssued } = await supabase.from('user_coupons').select('id', { count: 'exact', head: true }).eq('source', 'referral_reward');
  return res.json({ total_referrals: totalReferrals || 0, total_referrers: totalReferrers || 0, rewards_issued: rewardsIssued || 0 });
});

/* ─────────────────────────────────────────
   REVIEWS & FEEDBACK
───────────────────────────────────────── */

const reviewAvatarUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 2 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Dozvoljeni tipovi: PNG, JPG'));
  },
}).single('avatar');

/** GET /api/products/:id/reviews – public, visible reviews */
app.get('/api/products/:id/reviews', async (req, res) => {
  const { data, error } = await supabase
    .from('reviews')
    .select('id, product_id, reviewer_name, reviewer_avatar, rating, text, image_url, is_verified_purchase, created_at')
    .eq('product_id', req.params.id)
    .eq('is_visible', true)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Greška' });

  // Calculate average + distribution
  const ratings = (data || []).map(r => r.rating);
  const avg = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length) : 0;
  const dist = [0, 0, 0, 0, 0];
  ratings.forEach(r => dist[r - 1]++);

  return res.json({ reviews: data || [], average: Math.round(avg * 10) / 10, count: ratings.length, distribution: dist });
});

/** GET /api/products/:id/can-review – check if user can leave a review */
app.get('/api/products/:id/can-review', authenticateToken, async (req, res) => {
  const productId = req.params.id;

  // Check completed transaction exists
  const { data: tx } = await supabase
    .from('transactions')
    .select('id')
    .eq('product_id', productId)
    .eq('user_id', req.user.id)
    .eq('status', 'completed')
    .limit(1)
    .maybeSingle();

  if (!tx) return res.json({ can_review: false, reason: 'Niste kupili ovaj proizvod ili uplata još nije potvrđena.' });

  // Check if already reviewed
  const { data: existing } = await supabase
    .from('reviews')
    .select('id')
    .eq('product_id', productId)
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (existing) return res.json({ can_review: false, reason: 'Već ste ostavili recenziju.' });

  return res.json({ can_review: true });
});

/** POST /api/products/:id/reviews – user submits review */
app.post('/api/products/:id/reviews', authenticateToken, async (req, res) => {
  const { rating, text } = req.body;
  const productId = req.params.id;

  if (!rating || rating < 1 || rating > 5)
    return res.status(400).json({ error: 'Ocjena mora biti između 1 i 5' });

  // Check if user already reviewed this product
  const { data: existing } = await supabase
    .from('reviews')
    .select('id')
    .eq('product_id', productId)
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (existing) return res.status(400).json({ error: 'Već ste ostavili recenziju za ovaj proizvod' });

  // Require completed (admin-verified) purchase to leave a review
  const { data: txMatch } = await supabase
    .from('transactions')
    .select('id')
    .eq('product_id', productId)
    .eq('user_id', req.user.id)
    .eq('status', 'completed')
    .limit(1)
    .maybeSingle();

  if (!txMatch)
    return res.status(403).json({ error: 'Možete ostaviti recenziju samo nakon što admin potvrdi vašu kupovinu ovog proizvoda.' });

  const { data: user } = await supabase.from('users').select('name, avatar_url').eq('id', req.user.id).maybeSingle();

  const { data: review, error } = await supabase.from('reviews').insert({
    product_id:          productId,
    user_id:             req.user.id,
    transaction_id:      txMatch?.id || null,
    reviewer_name:       user?.name || req.user.email?.split('@')[0] || 'Korisnik',
    reviewer_avatar:     user?.avatar_url || null,
    rating:              parseInt(rating),
    text:                text || null,
    is_verified_purchase: !!txMatch,
  }).select('id').single();

  if (error) return res.status(500).json({ error: 'Greška pri slanju recenzije' });

  // Generate review reward promo code (5% discount, 3-day expiry, single use)
  try {
    const rewardCode = 'RVW-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

    const { data: promo } = await supabase.from('promo_codes').insert({
      code: rewardCode,
      discount_type: 'percent',
      discount_value: 5,
      usage_limit: 1,
      used_count: 0,
      expires_at: expiresAt,
    }).select('id').single();

    if (promo) {
      await supabase.from('user_coupons').insert({
        user_id: req.user.id,
        buyer_email: req.user.email || '',
        promo_code_id: promo.id,
        code: rewardCode,
        source: 'purchase_bonus',
      });

      // Email the reward
      const userEmail = req.user.email;
      if (userEmail) {
        sendMailSafe({
          from: process.env.EMAIL_FROM || `"Keyify" <${process.env.EMAIL_USER}>`,
          to: userEmail,
          subject: '🎁 Keyify – Hvala na recenziji! Evo vašeg popusta',
          html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#f9fafb;border-radius:16px">
            <h2 style="color:#111;margin:0 0 12px">Hvala na recenziji!</h2>
            <p style="color:#6b7280;font-size:14px">Kao zahvalnost, evo vašeg ekskluzivnog promo koda sa <strong>5% popusta</strong>:</p>
            <div style="background:#fff;border:2px solid #1D6AFF;border-radius:12px;padding:16px;text-align:center;margin:16px 0">
              <div style="font-size:24px;font-weight:800;letter-spacing:3px;color:#1D6AFF">${rewardCode}</div>
              <div style="font-size:11px;color:#9ca3af;margin-top:6px">Važi 3 dana · jednokratna upotreba</div>
            </div>
            <p style="color:#9ca3af;font-size:12px;text-align:center">Keyify tim</p>
          </div>`,
        }).catch(() => {});
      }
    }
  } catch (e) { console.error('[review-reward]', e.message); }

  return res.status(201).json({ ok: true, review_id: review.id });
});

/** GET /api/admin/reviews – all reviews (admin) */
app.get('/api/admin/reviews', authenticateToken, checkPermission('can_manage_reviews'), async (req, res) => {
  const { data, error } = await supabase
    .from('reviews')
    .select('*, products:product_id(name_sr, name_en)')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Greška' });
  return res.json(data || []);
});

/** POST /api/admin/reviews – admin creates review (social proof) */
app.post('/api/admin/reviews', authenticateToken, checkPermission('can_manage_reviews'), (req, res) => {
  reviewAvatarUpload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });

    const { product_id, reviewer_name, rating, text, is_verified_purchase } = req.body;
    if (!product_id || !reviewer_name || !rating)
      return res.status(400).json({ error: 'Proizvod, ime i ocjena su obavezni' });

    let avatarUrl = null;
    if (req.file) {
      const ext = (req.file.originalname.split('.').pop() || 'png').toLowerCase();
      const filePath = `review-avatars/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('review-avatars')
        .upload(filePath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
      if (!uploadErr) {
        const { data: urlData } = supabase.storage.from('review-avatars').getPublicUrl(filePath);
        avatarUrl = urlData?.publicUrl || null;
      }
    }

    const { data, error: dbErr } = await supabase.from('reviews').insert({
      product_id,
      reviewer_name,
      reviewer_avatar:     avatarUrl,
      rating:              parseInt(rating),
      text:                text || null,
      is_admin_created:    true,
      is_verified_purchase: is_verified_purchase === 'true' || is_verified_purchase === true,
    }).select('id').single();

    if (dbErr) return res.status(500).json({ error: 'Greška pri kreiranju recenzije' });
    return res.status(201).json({ ok: true, review_id: data.id });
  });
});

/** PUT /api/admin/reviews/:id – edit review */
app.put('/api/admin/reviews/:id', authenticateToken, checkPermission('can_manage_reviews'), async (req, res) => {
  const { reviewer_name, rating, text, is_visible } = req.body;
  const updates = {};
  if (reviewer_name !== undefined) updates.reviewer_name = reviewer_name;
  if (rating !== undefined)        updates.rating = parseInt(rating);
  if (text !== undefined)          updates.text = text;
  if (is_visible !== undefined)    updates.is_visible = Boolean(is_visible);

  const { error } = await supabase.from('reviews').update(updates).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Greška' });
  return res.json({ ok: true });
});

/** DELETE /api/admin/reviews/:id */
app.delete('/api/admin/reviews/:id', authenticateToken, checkPermission('can_manage_reviews'), async (req, res) => {
  const { error } = await supabase.from('reviews').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Greška' });
  return res.json({ ok: true });
});

/** PATCH /api/admin/reviews/:id/visibility */
app.patch('/api/admin/reviews/:id/visibility', authenticateToken, checkPermission('can_manage_reviews'), async (req, res) => {
  const { is_visible } = req.body;
  const { error } = await supabase.from('reviews').update({ is_visible: Boolean(is_visible) }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Greška' });
  return res.json({ ok: true });
});

/* ─────────────────────────────────────────
   BONUS COUPON AUTOMATION
───────────────────────────────────────── */

async function generateBonusCoupon(productId, buyerEmail, userId) {
  if (!productId) return null;
  const { data: prod } = await supabase
    .from('products')
    .select('bonus_coupon_id, name_sr')
    .eq('id', productId)
    .maybeSingle();
  if (!prod || !prod.bonus_coupon_id) return null;

  // Fetch template promo code
  const { data: template } = await supabase
    .from('promo_codes')
    .select('*')
    .eq('id', prod.bonus_coupon_id)
    .maybeSingle();
  if (!template) return null;

  // Generate unique code
  const bonusCode = 'BONUS-' + crypto.randomBytes(4).toString('hex').toUpperCase();

  // Create single-use promo code
  const { data: newPromo } = await supabase.from('promo_codes').insert({
    code:           bonusCode,
    discount_type:  template.discount_type,
    discount_value: template.discount_value,
    usage_limit:    1,
    is_active:      true,
    created_by:     null,
    created_at:     new Date().toISOString(),
  }).select('id').single();

  if (!newPromo) return null;

  // Record in user_coupons
  await supabase.from('user_coupons').insert({
    user_id:       userId || null,
    buyer_email:   buyerEmail,
    promo_code_id: newPromo.id,
    code:          bonusCode,
    source:        'purchase_bonus',
  });

  // Send bonus coupon email
  const discountLabel = template.discount_type === 'percent'
    ? `${template.discount_value}%`
    : `€${parseFloat(template.discount_value).toFixed(2)}`;
  try {
    await sendMailSafe({
      from:    process.env.EMAIL_FROM || `"Keyify" <${process.env.EMAIL_USER}>`,
      to:      buyerEmail,
      subject: `🎁 Keyify – Bonus kupon za vašu kupovinu! ${discountLabel} popust`,
      html: `<!DOCTYPE html>
<html lang="bs"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:20px 0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif">
<div style="max-width:520px;margin:0 auto">
  <div style="background:linear-gradient(135deg,#22c55e,#16a34a);border-radius:18px 18px 0 0;padding:32px 36px 28px;text-align:center">
    <div style="font-size:40px;margin-bottom:8px">🎁</div>
    <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800">Bonus kupon!</h1>
    <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:14px">Hvala na kupovini ${escServerHtml(prod.name_sr || '')}</p>
  </div>
  <div style="background:#fff;border:1px solid #e5e7eb;padding:28px 36px;text-align:center">
    <p style="font-size:14px;color:#374151;margin:0 0 20px">Evo vašeg ekskluzivnog bonus kupona:</p>
    <div style="background:linear-gradient(135deg,#f0f4ff,#faf5ff);border:2px solid #A259FF;border-radius:14px;padding:20px;margin-bottom:20px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#7c3aed;margin-bottom:8px">Promo kod</div>
      <div style="font-size:24px;font-weight:800;letter-spacing:4px;color:#1D6AFF;font-family:'Courier New',monospace">${escServerHtml(bonusCode)}</div>
      <div style="font-size:13px;color:#22c55e;font-weight:700;margin-top:8px">${discountLabel} popust</div>
    </div>
    <p style="font-size:12px;color:#9ca3af;margin:0">Koristite ovaj kod na blagajni za vašu sljedeću kupovinu!</p>
  </div>
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 18px 18px;padding:16px 36px;text-align:center">
    <p style="margin:0;font-size:11px;color:#d1d5db">© ${new Date().getFullYear()} Keyify</p>
  </div>
</div></body></html>`,
    });
  } catch (e) { console.error('[bonus-coupon] email error:', e.message); }

  return bonusCode;
}

/** GET /api/user/coupons – returns user's earned bonus coupons */
app.get('/api/user/coupons', authenticateToken, async (req, res) => {
  const { data, error } = await supabase
    .from('user_coupons')
    .select('*, promo_codes:promo_code_id(code, discount_type, discount_value, is_active, used_count, usage_limit)')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Greška' });
  return res.json(data || []);
});

/** GET /api/guest/coupons – returns coupons by email (rate-limited) */
app.get('/api/guest/coupons', async (req, res) => {
  const email = (req.query.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email je obavezan' });
  const { data } = await supabase
    .from('user_coupons')
    .select('code, source, is_used, created_at, promo_codes:promo_code_id(discount_type, discount_value)')
    .eq('buyer_email', email)
    .order('created_at', { ascending: false });
  return res.json(data || []);
});

/* ─────────────────────────────────────────
   PAYMENT VERIFICATION
───────────────────────────────────────── */

const verifyUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Dozvoljeni tipovi: PNG, JPG, WEBP'));
  },
}).single('screenshot');

/** POST /api/verification/submit – user submits payment proof */
app.post('/api/verification/submit', (req, res) => {
  verifyUpload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });

    const { transaction_id, payment_type, paypal_email, tx_hash, network, amount } = req.body;
    if (!transaction_id) return res.status(400).json({ error: 'ID transakcije je obavezan' });
    if (!['paypal', 'crypto'].includes(payment_type))
      return res.status(400).json({ error: 'Tip plaćanja mora biti paypal ili crypto' });

    // Verify transaction exists and is pending
    const { data: txRow } = await supabase
      .from('transactions')
      .select('id, buyer_email, user_id, verification_status')
      .eq('id', transaction_id)
      .maybeSingle();

    if (!txRow) return res.status(404).json({ error: 'Transakcija nije pronađena' });
    if (txRow.verification_status === 'approved')
      return res.status(400).json({ error: 'Ova transakcija je već odobrena' });

    // Upload screenshot to Supabase Storage if provided
    let screenshotUrl = null;
    if (req.file) {
      const ext = (req.file.originalname.split('.').pop() || 'png').toLowerCase();
      const filePath = `verifications/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('verification-screenshots')
        .upload(filePath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
      if (!uploadErr) {
        const { data: urlData } = supabase.storage.from('verification-screenshots').getPublicUrl(filePath);
        screenshotUrl = urlData?.publicUrl || null;
      }
    }

    // Identify user
    let userId = null;
    const authHeader = req.headers['authorization'];
    const jwtToken = authHeader && authHeader.split(' ')[1];
    if (jwtToken) {
      try { userId = jwt.verify(jwtToken, process.env.JWT_SECRET).id; } catch {}
    }

    const { data: pv, error: pvErr } = await supabase
      .from('payment_verifications')
      .insert({
        transaction_id,
        user_id:        userId || txRow.user_id || null,
        buyer_email:    txRow.buyer_email,
        payment_type,
        screenshot_url: screenshotUrl,
        paypal_email:   paypal_email || null,
        tx_hash:        tx_hash || null,
        network:        network || null,
        amount:         amount ? parseFloat(amount) : null,
      })
      .select('id')
      .single();

    if (pvErr) {
      console.error('[verification/submit]', pvErr.message);
      return res.status(500).json({ error: 'Greška pri slanju verifikacije' });
    }

    const { error: txUpdateErr } = await supabase
      .from('transactions')
      .update({
        proof_uploaded: true,
        verification_status: 'pending',
      })
      .eq('id', transaction_id);

    if (txUpdateErr && !isMissingSchemaError(txUpdateErr)) {
      console.error('[verification/submit] transaction update error:', txUpdateErr.message);
    }

    await updateOrderByTransactionId(transaction_id, {
      status: 'pending',
      proof_uploaded: true,
    });

    return res.json({ ok: true, verification_id: pv.id, message: 'Dokaz uplate je poslan na provjeru' });
  });
});

/** GET /api/admin/verifications – list all payment verifications */
app.get('/api/admin/verifications', authenticateToken, checkPermission('can_verify_payments'), async (req, res) => {
  const status = req.query.status || null;
  const selectAttempts = [
    '*, transactions(id, product_id, product_name, amount, payment_method, license_key, buyer_email, delivery_payload, proof_uploaded, customer_inputs_enc)',
    '*, transactions(id, product_id, product_name, amount, payment_method, license_key, buyer_email, delivery_payload, customer_inputs_enc)',
    '*, transactions(id, product_id, product_name, amount, payment_method, license_key, buyer_email, customer_inputs_enc)',
    '*, transactions(id, product_id, product_name, amount, payment_method, license_key, buyer_email)',
  ];

  let data = null;
  let error = null;
  for (const columns of selectAttempts) {
    let query = supabase
      .from('payment_verifications')
      .select(columns)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const result = await query;
    data = result.data;
    error = result.error;
    if (!error) break;
    if (!isMissingSchemaError(error)) break;
    console.warn('[admin/verifications] retrying with reduced schema:', error.message);
  }
  if (error) return res.status(500).json({ error: 'Greška pri učitavanju verifikacija' });

  // Fetch user avatars separately (ambiguous FK prevents join)
  const userIds = [...new Set((data || []).map(v => v.user_id).filter(Boolean))];
  let avatarMap = {};
  if (userIds.length) {
    const { data: users } = await supabase.from('users').select('id, name, avatar_url').in('id', userIds);
    if (users) users.forEach(u => { avatarMap[u.id] = { name: u.name, avatar_url: u.avatar_url }; });
  }

  const productIds = [...new Set((data || []).map((entry) => entry.transactions?.product_id).filter(Boolean))];
  let productMap = {};
  if (productIds.length) {
    let products = null;
    let productError = null;
    for (const columns of ['id, required_user_inputs, image_url', 'id, image_url']) {
      const result = await supabase
        .from('products')
        .select(columns)
        .in('id', productIds);
      products = result.data;
      productError = result.error;
      if (!productError) break;
      if (!isMissingSchemaError(productError)) break;
    }
    if (productError && !isMissingSchemaError(productError)) {
      console.error('[admin/verifications] product lookup failed:', productError.message);
    }
    if (products) {
      products.forEach((product) => { productMap[product.id] = product; });
    }
  }

  const result = (data || []).map((v) => {
    const tx = v.transactions || {};
    const product = tx.product_id ? productMap[tx.product_id] || null : null;
    const decryptedInputs = tx.customer_inputs_enc
      ? safeParseJSON(decryptField(tx.customer_inputs_enc), null)
      : null;

    return {
      ...v,
      users: v.user_id ? avatarMap[v.user_id] || null : null,
      transactions: {
        ...tx,
        delivery_payload: tx.delivery_payload || tx.license_key || null,
        proof_uploaded: tx.proof_uploaded === true,
        required_user_inputs: normalizeRequiredUserInputs(product?.required_user_inputs),
        product_image: product?.image_url || null,
      },
      customer_inputs: decryptedInputs,
    };
  });

  return res.json(result);
});

/** GET /api/admin/verifications/pending-count */
app.get('/api/admin/verifications/pending-count', authenticateToken, requireAdmin, async (req, res) => {
  const { count } = await supabase
    .from('payment_verifications')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  return res.json({ count: count || 0 });
});

/** PUT /api/admin/verifications/:id/approve – approve payment */
app.put('/api/admin/verifications/:id/approve', authenticateToken, checkPermission('can_verify_payments'), async (req, res) => {
  const { id } = req.params;
  const { admin_notes, delivery_payload } = req.body;

  // Get verification + transaction
  const { data: pv } = await supabase
    .from('payment_verifications')
    .select('*, transactions(id, buyer_email, product_name, license_key, amount, user_id, product_id, delivery_payload)')
    .eq('id', id)
    .maybeSingle();

  if (!pv) return res.status(404).json({ error: 'Verifikacija nije pronađena' });
  if (pv.status !== 'pending') return res.status(400).json({ error: 'Verifikacija je već obrađena' });

  // Update verification
  await supabase.from('payment_verifications').update({
    status:      'approved',
    admin_notes: admin_notes || null,
    reviewed_by: req.user.id,
    reviewed_at: new Date().toISOString(),
  }).eq('id', id);

  const tx = pv.transactions;
  let productMeta = null;
  if (tx?.product_id) {
    const { data: prod } = await supabase
      .from('products')
      .select('delivery_message, image_url')
      .eq('id', tx.product_id)
      .maybeSingle();
    productMeta = prod || null;
  }

  const finalDeliveryPayload = buildDeliveryPayload({
    adminDelivery: delivery_payload,
    productDelivery: productMeta?.delivery_message || tx?.delivery_payload,
    licenseKey: tx?.license_key,
  });

  if (!finalDeliveryPayload) {
    return res.status(400).json({ error: 'Unesite poruku isporuke ili ključ prije potvrde porudžbine.' });
  }

  // Update transaction
  const txUpdateAttempts = buildOptionalColumnAttempts({
    status: 'completed',
    verification_status: 'approved',
    delivery_payload: finalDeliveryPayload,
    paid_at: new Date().toISOString(),
  }, ['delivery_payload', 'paid_at', 'verification_status']);

  for (const attempt of txUpdateAttempts) {
    const { error: updateError } = await supabase.from('transactions').update(attempt).eq('id', pv.transaction_id);
    if (!updateError) break;
    if (!isMissingSchemaError(updateError)) {
      console.error('[verify/approve] transaction update error:', updateError.message);
      return res.status(500).json({ error: 'Greška pri potvrdi porudžbine' });
    }
  }

  await updateOrderByTransactionId(pv.transaction_id, {
    status: 'completed',
    delivery_payload: finalDeliveryPayload,
    proof_uploaded: true,
  });

  // Send premium delivery email
  if (tx && tx.buyer_email) {
    const orderMeta = await getOrderByTransactionId(pv.transaction_id);
    const isGuest = !tx.user_id && !!orderMeta?.guest_token;
    const ctaUrl = isGuest
      ? buildFrontendPageUrl(req, 'guest-order.html', { token: orderMeta.guest_token })
      : buildFrontendPageUrl(req, 'purchases.html');

    const orderDate = new Date().toLocaleDateString('bs-BA', { year: 'numeric', month: 'long', day: 'numeric' });
    const buyerName = tx.buyer_email.split('@')[0];

    // Build the delivery content block
    const deliveryBlock = finalDeliveryPayload
      ? `<!-- Custom admin message -->
        <div style="background:linear-gradient(135deg,#f0fdf4 0%,#ecfdf5 100%);border:2px solid #22c55e;border-radius:16px;padding:24px;text-align:center;margin-bottom:24px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#16a34a;margin-bottom:12px">Vaš proizvod</div>
          <div style="font-size:14px;color:#374151;line-height:1.6">${deliveryPayloadToEmailHtml(finalDeliveryPayload)}</div>
        </div>`
      : '';

    const licenseBlock = tx.license_key
      ? `<!-- License key -->
        <div style="background:linear-gradient(135deg,rgba(29,106,255,0.06) 0%,rgba(162,89,255,0.06) 100%);border:2px solid rgba(162,89,255,0.4);border-radius:16px;padding:24px;text-align:center;margin-bottom:24px">
          <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.15em;color:#7c3aed;margin-bottom:12px">🔑 Licencni ključ</div>
          <div style="font-size:20px;font-weight:800;letter-spacing:4px;color:#1D6AFF;font-family:'Courier New','Fira Mono',monospace;word-break:break-all;padding:8px 0">${escServerHtml(tx.license_key)}</div>
          <div style="font-size:11px;color:#9ca3af;margin-top:8px">Čuvajte ovaj ključ na sigurnom · nije ponovljiv</div>
        </div>`
      : '';
    const readyEmailHtml = renderOrderReadyEmail({
      buyerEmail: tx.buyer_email,
      productName: tx.product_name,
      orderId: tx.id,
      amount: tx.amount,
      productImageUrl: productMeta?.image_url || null,
      deliveryPayload: finalDeliveryPayload,
      ctaUrl,
    });
    let deliveryEmailSent = false;

    try {
      await sendMailSafe({
        from: process.env.EMAIL_FROM || `"Keyify" <${process.env.EMAIL_USER}>`,
        to: tx.buyer_email,
        subject: `Keyify - Vas proizvod je spreman: ${escServerHtml(tx.product_name || 'narudzba')}`,
        html: readyEmailHtml,
      });
      deliveryEmailSent = true;
    } catch (e) {
      console.error('[verify/approve] primary ready email error:', e.message);
    }

    if (!deliveryEmailSent) try {
      await sendMailSafe({
        from:    process.env.EMAIL_FROM || `"Keyify" <${process.env.EMAIL_USER}>`,
        to:      tx.buyer_email,
        subject: `🔑 Keyify – Uplata potvrđena · ${escServerHtml(tx.product_name || 'Vaša narudžba')}`,
        html: `<!DOCTYPE html>
<html lang="bs"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#0f0f1a;font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif">

<!-- Dark wrapper -->
<div style="max-width:560px;margin:0 auto;padding:24px 16px">

  <!-- Logo bar -->
  <div style="text-align:center;padding:20px 0 24px">
    <span style="font-size:22px;font-weight:800;letter-spacing:-.01em;color:#fff">Key<span style="color:#1D6AFF">ify</span></span>
  </div>

  <!-- Main card -->
  <div style="background:linear-gradient(180deg,#1a1a2e 0%,#16162a 100%);border:1px solid rgba(255,255,255,0.06);border-radius:24px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.4)">

    <!-- Header gradient -->
    <div style="background:linear-gradient(135deg,#1D6AFF 0%,#A259FF 50%,#22c55e 100%);padding:40px 36px 36px;text-align:center;position:relative">
      <div style="position:absolute;top:0;left:0;right:0;bottom:0;background:url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><circle cx=%2220%22 cy=%2230%22 r=%2240%22 fill=%22rgba(255,255,255,0.03)%22/><circle cx=%2280%22 cy=%2270%22 r=%2250%22 fill=%22rgba(255,255,255,0.02)%22/></svg>');background-size:cover"></div>
      <div style="position:relative;z-index:1">
        <div style="display:inline-block;background:rgba(255,255,255,0.15);backdrop-filter:blur(10px);border-radius:50%;width:64px;height:64px;line-height:64px;font-size:30px;margin-bottom:14px;border:2px solid rgba(255,255,255,0.2)">✅</div>
        <h1 style="color:#fff;margin:0;font-size:26px;font-weight:800;letter-spacing:-.02em">Uplata potvrđena!</h1>
        <p style="color:rgba(255,255,255,0.75);margin:8px 0 0;font-size:14px;font-weight:400">Hvala na kupovini, ${escServerHtml(buyerName)}!</p>
      </div>
    </div>

    <!-- Body -->
    <div style="padding:32px 36px 28px">

      ${deliveryBlock}
      ${licenseBlock}

      <!-- Order details -->
      <div style="border:1px solid rgba(255,255,255,0.06);border-radius:14px;overflow:hidden;margin-bottom:24px">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <tr style="border-bottom:1px solid rgba(255,255,255,0.06)">
            <td style="padding:14px 16px;color:#94a3b8">Proizvod</td>
            <td style="padding:14px 16px;text-align:right;font-weight:700;color:#f1f5f9">${escServerHtml(tx.product_name || 'Digitalni proizvod')}</td>
          </tr>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.06)">
            <td style="padding:14px 16px;color:#94a3b8">Iznos</td>
            <td style="padding:14px 16px;text-align:right;font-weight:800;color:#22c55e;font-size:16px">€ ${parseFloat(tx.amount).toFixed(2)}</td>
          </tr>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.06)">
            <td style="padding:14px 16px;color:#94a3b8">Datum</td>
            <td style="padding:14px 16px;text-align:right;color:#cbd5e1">${orderDate}</td>
          </tr>
          <tr>
            <td style="padding:14px 16px;color:#94a3b8">ID narudžbe</td>
            <td style="padding:14px 16px;text-align:right;font-family:'Courier New',monospace;font-size:11px;color:#64748b">${escServerHtml(tx.id)}</td>
          </tr>
        </table>
      </div>

      <!-- CTA -->
      <div style="text-align:center;margin-bottom:8px">
        <a href="https://www.instagram.com/keyifyshop/" target="_blank" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#E1306C,#C13584);color:#fff;font-weight:700;font-size:14px;text-decoration:none;border-radius:12px;letter-spacing:.02em">Zapratite @keyifyshop</a>
        <p style="font-size:12px;color:#64748b;margin:10px 0 0">Za ekskluzivne promo kodove i popuste</p>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:rgba(255,255,255,0.02);border-top:1px solid rgba(255,255,255,0.04);padding:20px 36px;text-align:center">
      <p style="margin:0 0 4px;font-size:11px;color:#475569">Pitanja? <a href="mailto:${escServerHtml(process.env.EMAIL_USER || 'support@keyify.app')}" style="color:#1D6AFF;text-decoration:none">${escServerHtml(process.env.EMAIL_USER || 'support@keyify.app')}</a></p>
      <p style="margin:0;font-size:10px;color:#334155">© ${new Date().getFullYear()} Keyify · Sva prava zadržana</p>
    </div>
  </div>

  <!-- Unsubscribe-style footer -->
  <div style="text-align:center;padding:16px 0">
    <p style="margin:0;font-size:10px;color:#334155">Ovaj email je automatski generiran nakon potvrde vaše uplate.</p>
  </div>
</div>
</body></html>`,
      });
    } catch (e) { console.error('[verify/approve] email error:', e.message); }
  }

  // Generate bonus coupon if product has one configured
  if (tx.product_id) {
    generateBonusCoupon(tx.product_id, tx.buyer_email, tx.user_id).catch(e => console.error('[bonus-coupon]', e.message));
  }

  return res.json({ ok: true, message: 'Uplata odobrena, ključ poslan na email' });
});

/** PUT /api/admin/verifications/:id/reject – reject payment */
app.put('/api/admin/verifications/:id/reject', authenticateToken, checkPermission('can_verify_payments'), async (req, res) => {
  const { id } = req.params;
  const rejectionReason = String(req.body?.admin_notes || '').trim();

  if (!rejectionReason) {
    return res.status(400).json({ error: 'Unesite razlog odbijanja uplate.' });
  }

  const { data: pv } = await supabase
    .from('payment_verifications')
    .select('*, transactions(id, buyer_email, product_name, amount)')
    .eq('id', id)
    .maybeSingle();

  if (!pv) return res.status(404).json({ error: 'Verifikacija nije pronađena' });
  if (pv.status !== 'pending') return res.status(400).json({ error: 'Verifikacija je već obrađena' });

  await supabase.from('payment_verifications').update({
    status:      'rejected',
    admin_notes: rejectionReason,
    reviewed_by: req.user.id,
    reviewed_at: new Date().toISOString(),
  }).eq('id', id);

  await supabase.from('transactions').update({
    status:              'failed',
    verification_status: 'rejected',
  }).eq('id', pv.transaction_id);

  await updateOrderByTransactionId(pv.transaction_id, {
    status: 'failed',
  });

  // Send rejection email
  const tx = pv.transactions;
  if (tx && tx.buyer_email) {
    try {
      await sendMailSafe({
        from:    process.env.EMAIL_FROM || `"Keyify" <${process.env.EMAIL_USER}>`,
        to:      tx.buyer_email,
        subject: `Keyify – Uplata nije potvrđena za ${escServerHtml(tx.product_name || 'narudžbu')}`,
        html: `<!DOCTYPE html>
<html lang="bs"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:20px 0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif">
<div style="max-width:520px;margin:0 auto">
  <div style="background:linear-gradient(135deg,#ef4444,#dc2626);border-radius:18px 18px 0 0;padding:32px 36px 28px;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800">Uplata nije potvrđena</h1>
    <p style="color:rgba(255,255,255,0.80);margin:8px 0 0;font-size:14px">Nismo uspjeli potvrditi vašu uplatu.</p>
  </div>
  <div style="background:#fff;border:1px solid #e5e7eb;padding:28px 36px">
    <p style="font-size:14px;color:#374151;margin:0 0 16px">Nažalost, vaša uplata za <strong>${escServerHtml(tx.product_name || 'narudžbu')}</strong> nije mogla biti potvrđena.</p>
    ${rejectionReason ? `<p style="font-size:13px;color:#6b7280;margin:0 0 16px"><strong>Razlog:</strong> ${escServerHtml(rejectionReason)}</p>` : ''}
    <p style="font-size:13px;color:#6b7280;margin:0">Kontaktirajte nas putem Instagrama <a href="https://www.instagram.com/keyifyshop/" style="color:#1D6AFF">@keyifyshop</a> ili putem emaila za pomoć.</p>
  </div>
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 18px 18px;padding:16px 36px;text-align:center">
    <p style="margin:0;font-size:11px;color:#d1d5db">© ${new Date().getFullYear()} Keyify</p>
  </div>
</div></body></html>`,
      });
    } catch (e) { console.error('[verify/reject] email error:', e.message); }
  }

  return res.json({ ok: true, message: 'Uplata odbijena, korisnik obaviješten' });
});

/* ─────────────────────────────────────────
   Start server
───────────────────────────────────────── */
const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`\n🔑 Keyify API running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health\n`);

  // Ensure spasojep3@gmail.com is super_admin
  try {
    await supabase
      .from('users')
      .update({ role: 'admin', rank: 'super_admin' })
      .eq('email', 'spasojep3@gmail.com');
    console.log('   ✓ spasojep3@gmail.com → super_admin');
  } catch (e) { console.error('[bootstrap]', e.message); }
});
