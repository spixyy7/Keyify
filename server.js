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
const { createClient } = require('@supabase/supabase-js');

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
    // Allow: no origin, file://, any localhost/127.0.0.1 port, or matching FRONTEND_URL
    if (!origin || origin === 'null') return callback(null, true);
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);
    const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
    if (frontendUrl && origin === frontendUrl) return callback(null, true);
    if (!process.env.FRONTEND_URL) return callback(null, true);
    console.log('[CORS blocked] origin:', origin);
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
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
  max: 100,
  message: { error: 'Previše zahtjeva.' },
});

app.use('/api', apiLimiter);

/* ─────────────────────────────────────────
   SMTP TRANSPORT (Gmail App Password)
   Env: EMAIL_USER + EMAIL_PASS (16-char App Password from Google Account)
   Preferred when EMAIL_PASS is set; falls back to Gmail REST API.
───────────────────────────────────────── */
const nodemailer = require('nodemailer');
const { google } = require('googleapis');

// 1. Inicijalizacija Google API Klijenta
const oAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'https://developers.google.com/oauthplayground' // Zvanični Google redirect
);

// Postavljamo Refresh Token koji ne ističe
oAuth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

// 2. Funkcija koja striktno koristi Google API
let _smtpTransport = null;
async function _getSmtpTransport() {
  try {
    // Svaki put kada šalješ mejl, Google API generiše nov, svež token
    const accessToken = await oAuth2Client.getAccessToken();

    _smtpTransport = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: process.env.EMAIL_USER,
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
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
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
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
 * Universal mail sender.
 * • If EMAIL_PASS is set → Gmail SMTP (App Password, port 465)
 * • Otherwise → Gmail REST API (OAuth2 – requires GOOGLE_* env vars)
 */
async function sendMailSafe({ from, to, subject, html }) {
  if (process.env.EMAIL_PASS) {
    await _getSmtpTransport().sendMail({ from, to, subject, html });
  } else {
    await _sendViaGmailApi({ from, to, subject, html });
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

    // Load permissions fresh from DB (enables real-time permission changes)
    const { data: userRow } = await supabase
      .from('users')
      .select('permissions')
      .eq('id', decoded.id)
      .maybeSingle();
    req.user = { ...decoded, permissions: userRow?.permissions || {} };
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
    const perms = req.user.permissions;
    // Super admin: empty permissions = unrestricted
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
  const { name, email, password } = req.body;

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
    .select('id')
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

  const { data: trusted } = await supabase
    .from('trusted_devices')
    .select('id')
    .eq('user_id', user.id)
    .eq('ip', ip)
    .eq('ua_hash', ua)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

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
      from:    `"Keyify" <${process.env.EMAIL_USER}>`,
      to:      user.email,
      subject: `Keyify – Vaš verifikacijski kod: ${otp}`,
      html:    otpHTML,
    });
  } catch (emailErr) {
    console.error('Email send failed:', emailErr.message);
    // Don't block login if email fails – log and continue
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
    .select('id, name, email, role, otp_code, otp_expires')
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
    await supabase
      .from('trusted_devices')
      .upsert(
        { user_id: user.id, ip, ua_hash: ua, expires_at: expiresAt },
        { onConflict: 'user_id,ip,ua_hash' }
      );
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
      .select('id, name, email, role, registered_ip, created_at, is_verified')
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
  return res.json(data || {});
});

/**
 * POST /api/admin/settings
 * Body: { primary_color, panel_bg, paypal_email, btc_wallet, eth_wallet, usdt_wallet, bank_iban, bank_name }
 */
app.post('/api/admin/settings', authenticateToken, requireAdmin, async (req, res) => {
  const {
    primary_color, panel_bg,
    paypal_email,
    btc_wallet, eth_wallet, usdt_wallet,
    bank_iban, bank_name,
  } = req.body;

  const { error } = await supabase
    .from('site_settings')
    .upsert({
      id: 1,
      primary_color,
      panel_bg,
      paypal_email,
      btc_wallet,
      eth_wallet,
      usdt_wallet,
      bank_iban,
      bank_name,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    console.error('Settings error:', error);
    return res.status(500).json({ error: 'Greška pri čuvanju podešavanja' });
  }

  return res.json({ message: 'Podešavanja su uspješno sačuvana' });
});

/* ─────────────────────────────────────────
   PRODUCTS ROUTES
───────────────────────────────────────── */

/* Multer: memory storage, 5 MB limit, images only */
const productUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },
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
  const { category } = req.query;
  let query = supabase.from('products').select('*');
  if (category) {
    query = query.eq('category', category).order('grid_order', { ascending: true });
  } else {
    query = query.order('category').order('grid_order', { ascending: true });
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'Greška pri dohvaćanju proizvoda' });
  return res.json(data || []);
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
    category, image_url, badge, stars,
  } = req.body;

  if (!name_sr || !price || !category)
    return res.status(400).json({ error: 'Naziv, cijena i kategorija su obavezni' });

  // File upload takes priority over URL
  let finalImageUrl = image_url || null;
  if (req.file) {
    try { finalImageUrl = await uploadProductImage(req.file); }
    catch (e) { return res.status(500).json({ error: e.message }); }
  }

  const starsVal = stars !== undefined ? Math.min(5, Math.max(1, parseInt(stars) || 5)) : 5;

  const { data, error } = await supabase
    .from('products')
    .insert({
      name_sr, name_en,
      description_sr, description_en,
      price:          parseFloat(price),
      original_price: original_price ? parseFloat(original_price) : null,
      category,
      image_url:      finalImageUrl,
      badge:          badge || null,
      stars:          starsVal,
      created_at:     new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error('Product create error:', error);
    return res.status(500).json({ error: 'Greška pri kreiranju proizvoda' });
  }
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
    price, original_price, category, image_url,
    badge, stars, card_size, grid_order,
  } = req.body;

  const updates = {};
  if (name_sr          !== undefined) updates.name_sr          = name_sr;
  if (name_en          !== undefined) updates.name_en          = name_en;
  if (description_sr   !== undefined) updates.description_sr   = description_sr;
  if (description_en   !== undefined) updates.description_en   = description_en;
  if (price            !== undefined) updates.price            = parseFloat(price);
  if (original_price   !== undefined) updates.original_price   = original_price ? parseFloat(original_price) : null;
  if (category         !== undefined) updates.category         = category;
  if (badge            !== undefined) updates.badge            = badge || null;
  if (stars            !== undefined) updates.stars            = Math.min(5, Math.max(1, parseInt(stars) || 5));
  if (card_size        !== undefined) updates.card_size        = card_size;
  if (grid_order       !== undefined) updates.grid_order       = Number(grid_order);

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

  const { data, error } = await supabase
    .from('products')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Product update error:', error);
    return res.status(500).json({ error: 'Greška pri ažuriranju' });
  }
  return res.json(data);
});

/** DELETE /api/products/:id – admin only */
app.delete('/api/products/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) return res.status(500).json({ error: 'Greška pri brisanju' });
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

/* ─────────────────────────────────────────
   PUBLIC: Checkout settings
   Returns only the fields the checkout page needs (no sensitive admin data).
   Used by checkout.html to show PayPal/crypto/bank payment details.
───────────────────────────────────────── */
app.get('/api/checkout-settings', async (req, res) => {
  const { data, error } = await supabase
    .from('site_settings')
    .select('paypal_email, btc_wallet, eth_wallet, usdt_wallet, bank_iban, bank_name')
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

/** POST /api/admin/users/create */
app.post('/api/admin/users/create', authenticateToken, checkPermission('manage_users'), async (req, res) => {
  const { name, email, password, permissions = {} } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Ime, email i lozinka su obavezni' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Lozinka mora imati min. 8 karaktera' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Nevažeći email' });

  const { data: existing } = await supabase
    .from('users').select('id').eq('email', email.toLowerCase()).maybeSingle();
  if (existing) return res.status(409).json({ error: 'Email već postoji' });

  const hasAnyPerm = Object.values(permissions).some(v => v === true);
  const role = hasAnyPerm ? 'admin' : 'user';

  const password_hash = await bcrypt.hash(password, 12);
  const { data, error } = await supabase
    .from('users')
    .insert({
      name:          name.trim(),
      email:         email.toLowerCase().trim(),
      password_hash,
      role,
      permissions,
      is_verified:   true,
      registered_ip: getClientIP(req),
      created_at:    new Date().toISOString(),
    })
    .select('id, name, email, role, permissions, created_at')
    .single();

  if (error) return res.status(500).json({ error: 'Greška pri kreiranju korisnika' });
  return res.status(201).json(data);
});

/** PATCH /api/admin/users/:id/permissions */
app.patch('/api/admin/users/:id/permissions', authenticateToken, checkPermission('manage_users'), async (req, res) => {
  const { id }          = req.params;
  const { permissions } = req.body;
  if (typeof permissions !== 'object' || permissions === null)
    return res.status(400).json({ error: 'permissions object required' });

  // Determine role: if any permission is true → 'admin', else keep existing role
  const { data: user } = await supabase
    .from('users').select('role').eq('id', id).maybeSingle();
  if (!user) return res.status(404).json({ error: 'Korisnik nije pronađen' });

  const hasAnyPerm = Object.values(permissions).some(v => v === true);
  const newRole = hasAnyPerm ? 'admin' : (user.role === 'admin' ? 'user' : user.role);

  const { error } = await supabase
    .from('users')
    .update({ permissions, role: newRole })
    .eq('id', id);

  if (error) return res.status(500).json({ error: 'Greška pri ažuriranju dozvola' });
  return res.json({ message: 'Dozvole ažurirane', role: newRole });
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
      from:    `"Keyify" <${process.env.EMAIL_USER}>`,
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

  if (!userId && !guest_email?.trim())
    return res.status(400).json({ error: 'Email adresa je obavezna' });

  const email = guest_email?.trim().toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Unesite ispravnu email adresu' });

  const { data, error } = await supabase
    .from('chat_sessions')
    .insert({ user_id: userId, guest_email: email, status: 'new' })
    .select('id')
    .single();

  if (error) {
    console.error('[chat/start] Supabase insert error:', JSON.stringify(error));
    return res.status(500).json({
      error: 'Greška pri pokretanju chata',
      detail: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
  return res.status(201).json({ session_id: data.id });
});

/** GET /api/chat/messages/:sessionId – fetch messages for a session (public – UUID is unguessable) */
app.get('/api/chat/messages/:sessionId', async (req, res) => {
  const { data: session } = await supabase
    .from('chat_sessions')
    .select('id, status')
    .eq('id', req.params.sessionId)
    .maybeSingle();

  if (!session) return res.status(404).json({ error: 'Sesija nije pronađena' });

  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, sender, message, created_at')
    .eq('session_id', req.params.sessionId)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: 'Greška' });
  return res.json({ messages: data || [], session_status: session.status });
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

  // Reset session status to 'new' so agents see the unread indicator
  await supabase.from('chat_sessions').update({
    status:               'new',
    last_message_at:      data.created_at,
    last_message_preview: message.trim().substring(0, 120),
  }).eq('id', session_id).neq('status', 'closed');

  return res.status(201).json(data);
});

/** GET /api/admin/chat/sessions/new-count – count of sessions with status 'new' */
app.get('/api/admin/chat/sessions/new-count', authenticateToken, checkPermission('can_manage_support'), async (req, res) => {
  const { count, error } = await supabase
    .from('chat_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'new');
  if (error) return res.status(500).json({ error: 'Greška' });
  return res.json({ count: count || 0 });
});

/** GET /api/admin/chat/sessions – list chat sessions sorted by latest activity */
app.get('/api/admin/chat/sessions', authenticateToken, checkPermission('can_manage_support'), async (req, res) => {
  const showClosed = req.query.closed === '1';
  let query = supabase
    .from('chat_sessions')
    .select('id, user_id, guest_email, status, created_at, last_message_at, last_message_preview, users(name, email)');

  if (!showClosed) query = query.neq('status', 'closed');

  const { data, error } = await query
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at',      { ascending: false });

  if (error) return res.status(500).json({ error: 'Greška' });
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

/** PATCH /api/admin/chat/sessions/:id/read – mark session as 'seen' (only if currently 'new') */
app.patch('/api/admin/chat/sessions/:id/read', authenticateToken, checkPermission('can_manage_support'), async (req, res) => {
  await supabase
    .from('chat_sessions')
    .update({ status: 'seen' })
    .eq('id', req.params.id)
    .eq('status', 'new');
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

  // Mark session as answered + update preview
  await supabase.from('chat_sessions').update({
    status:               'answered',
    last_message_at:      data.created_at,
    last_message_preview: `Agent: ${message.trim().substring(0, 100)}`,
  }).eq('id', session_id);

  return res.json(data);
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

/* ─────────────────────────────────────────
   PROMO CODES
───────────────────────────────────────── */

/** POST /api/checkout/apply-promo – public endpoint, validates a code */
app.post('/api/checkout/apply-promo', async (req, res) => {
  const { code, subtotal } = req.body;
  if (!code) return res.status(400).json({ error: 'Unesite promo kod' });
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
  const { code, discount_type, discount_value, usage_limit, expires_at, is_active } = req.body;
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
  const { discount_type, discount_value, usage_limit, expires_at, is_active } = req.body;
  const updates = {};
  if (discount_type)  updates.discount_type  = discount_type;
  if (discount_value) updates.discount_value = parseFloat(discount_value);
  if (usage_limit !== undefined) updates.usage_limit = usage_limit ? parseInt(usage_limit) : null;
  if (expires_at !== undefined)  updates.expires_at  = expires_at || null;
  if (is_active  !== undefined)  updates.is_active   = Boolean(is_active);

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
      from:    `"Keyify" <${process.env.EMAIL_USER}>`,
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
const GMAIL_SETUP_REDIRECT = (process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`) + '/api/auth/gmail-setup/callback';

app.get('/api/auth/gmail-setup', (req, res) => {
  const url = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  GMAIL_SETUP_REDIRECT,
    response_type: 'code',
    scope:         'https://www.googleapis.com/auth/gmail.send',
    access_type:   'offline',
    prompt:        'consent',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${url.toString()}`);
});

app.get('/api/auth/gmail-setup/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No code');
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  GMAIL_SETUP_REDIRECT,
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

  if (error) return res.status(500).json({ error: 'Greška' });

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
app.post('/api/checkout/confirm', async (req, res) => {
  const { buyer_email, product_id, product_name, amount, payment_method, tx_reference } = req.body;

  // Identify buyer
  let userId = null;
  let email  = buyer_email?.trim().toLowerCase() || null;
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

  // 1. Generate license key first (needed for insert + email)
  const licenseKey = 'KFY-' + [
    crypto.randomBytes(4).toString('hex').toUpperCase(),
    crypto.randomBytes(4).toString('hex').toUpperCase(),
    crypto.randomBytes(4).toString('hex').toUpperCase(),
  ].join('-');

  const orderDate = new Date().toLocaleDateString('bs-BA', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  // Fetch product image if product_id is known
  let productImageUrl = null;
  if (product_id) {
    const { data: prod } = await supabase
      .from('products').select('image_url').eq('id', product_id).maybeSingle();
    productImageUrl = prod?.image_url || null;
  }

  // 2. Save transaction record (includes license_key + buyer_email for guest retrieval)
  const { data: tx, error: txErr } = await supabase
    .from('transactions')
    .insert({
      user_id:        userId,
      product_id:     product_id || null,
      product_name:   product_name || null,
      amount:         parsedAmount,
      payment_method: payment_method || 'manual',
      status:         'completed',
      tx_reference:   tx_reference || null,
      license_key:    licenseKey,
      buyer_email:    email,
    })
    .select('id')
    .single();

  if (txErr) {
    console.error('[checkout/confirm] tx insert error:', txErr.message);
    return res.status(500).json({ error: 'Greška pri snimanju transakcije' });
  }

  // 3. Write AES-256-CBC encrypted audit log (non-blocking)
  supabase.from('transaction_logs').insert({
    buyer_email_enc: encryptField(email),
    amount_enc:      encryptField(String(parsedAmount)),
    product_name:    product_name || null,
    payment_method:  payment_method || null,
    tx_reference:    tx_reference || tx.id,
    status:          'completed',
    logged_by:       null,
  }).then(({ error: le }) => { if (le) console.error('[tx-log]', le.message); });

  // 4. Build premium receipt email
  const imgBlock = productImageUrl
    ? `<div style="text-align:center;padding:20px 32px 0">
         <img src="${escServerHtml(productImageUrl)}" alt="${escServerHtml(product_name || '')}"
              style="max-height:120px;max-width:220px;object-fit:contain;border-radius:12px;
                     border:1px solid rgba(255,255,255,0.08);"/>
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

  let emailSent = false;
  try {
    await sendMailSafe({
      from:    `"Keyify" <${process.env.EMAIL_USER}>`,
      to:      email,
      subject: `🔑 Keyify – Vaš ključ za ${escServerHtml(product_name || 'narudžbu')} · ${licenseKey}`,
      html:    receiptHTML,
    });
    emailSent = true;
  } catch (emailErr) {
    console.error('[checkout/confirm] email error:', emailErr.message);
  }

  return res.json({
    ok:             true,
    transaction_id: tx.id,
    license_key:    licenseKey,
    product_name:   product_name || null,
    product_image:  productImageUrl,
    amount:         parsedAmount,
    order_date:     new Date().toISOString(),
    email_sent_to:  email,
    email_sent:     emailSent,
  });
});

/* ─────────────────────────────────────────
   COUPONS (alias for promo_codes with usage analytics)
───────────────────────────────────────── */

/** GET /api/admin/coupons – list all coupons with usage stats */
app.get('/api/admin/coupons', authenticateToken, checkPermission('can_manage_promos'), async (req, res) => {
  const { data, error } = await supabase
    .from('promo_codes')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Greška' });
  return res.json(data || []);
});

/** POST /api/admin/coupons – create a coupon */
app.post('/api/admin/coupons', authenticateToken, checkPermission('can_manage_promos'), async (req, res) => {
  const { code, discount_percent, expiry_date, is_active, usage_limit } = req.body;
  if (!code || !discount_percent)
    return res.status(400).json({ error: 'code i discount_percent su obavezni' });
  if (parseFloat(discount_percent) <= 0 || parseFloat(discount_percent) > 100)
    return res.status(400).json({ error: 'Popust mora biti između 1 i 100%' });

  const { data, error } = await supabase.from('promo_codes').insert({
    code:           code.trim().toUpperCase(),
    discount_type:  'percent',
    discount_value: parseFloat(discount_percent),
    usage_limit:    usage_limit ? parseInt(usage_limit) : null,
    used_count:     0,
    expires_at:     expiry_date || null,
    is_active:      is_active !== false,
    created_by:     req.user.id,
  }).select().single();

  if (error) {
    if (error.code === '23505') return res.status(400).json({ error: 'Kupon s tim kodom već postoji' });
    return res.status(500).json({ error: 'Greška pri kreiranju kupona' });
  }
  return res.status(201).json(data);
});

/** PATCH /api/admin/coupons/:id – toggle active/update coupon */
app.patch('/api/admin/coupons/:id', authenticateToken, checkPermission('can_manage_promos'), async (req, res) => {
  const updates = {};
  if (req.body.is_active  !== undefined) updates.is_active  = Boolean(req.body.is_active);
  if (req.body.expires_at !== undefined) updates.expires_at = req.body.expires_at || null;
  if (req.body.usage_limit !== undefined) updates.usage_limit = req.body.usage_limit ? parseInt(req.body.usage_limit) : null;

  const { error } = await supabase.from('promo_codes').update(updates).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Greška pri ažuriranju' });
  return res.json({ message: 'Kupon ažuriran' });
});

/** DELETE /api/admin/coupons/:id */
app.delete('/api/admin/coupons/:id', authenticateToken, checkPermission('can_manage_promos'), async (req, res) => {
  const { error } = await supabase.from('promo_codes').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Greška pri brisanju' });
  return res.json({ message: 'Kupon obrisan' });
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
   Start server
───────────────────────────────────────── */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🔑 Keyify API running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health\n`);
});
