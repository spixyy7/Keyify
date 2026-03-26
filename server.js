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
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
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
   Nodemailer transporter (Gmail)
   Use an App Password: https://myaccount.google.com/apppasswords
───────────────────────────────────────── */
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // STARTTLS
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  connectionTimeout: 8000,  // 8s – fail fast instead of hanging
  greetingTimeout:   8000,
  socketTimeout:     10000,
});

async function sendMailSafe(mailOptions) {
  return transporter.sendMail(mailOptions);
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

  const ip = getClientIP(req);
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
  const { user_id, otp } = req.body;
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

  await supabase.from('audit_logs').insert({
    user_id:    user.id,
    action:     'login_success',
    ip,
    created_at: new Date().toISOString(),
  });

  return res.json({
    token,
    role:  user.role,
    name:  user.name,
    email: user.email,
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
app.post('/api/products', authenticateToken, requireAdmin, async (req, res) => {
  const {
    name_sr, name_en,
    description_sr, description_en,
    price, original_price,
    category, image_url, badge, stars,
  } = req.body;

  if (!name_sr || !price || !category)
    return res.status(400).json({ error: 'Naziv, cijena i kategorija su obavezni' });

  const starsVal = stars !== undefined ? Math.min(5, Math.max(1, parseInt(stars) || 5)) : 5;

  const { data, error } = await supabase
    .from('products')
    .insert({
      name_sr, name_en,
      description_sr, description_en,
      price:          parseFloat(price),
      original_price: original_price ? parseFloat(original_price) : null,
      category,
      image_url:      image_url || null,
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
app.put('/api/products/:id', authenticateToken, requireAdmin, async (req, res) => {
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
  if (image_url        !== undefined) updates.image_url        = image_url || null;
  if (badge            !== undefined) updates.badge            = badge || null;
  if (stars            !== undefined) updates.stars            = Math.min(5, Math.max(1, parseInt(stars) || 5));
  if (card_size        !== undefined) updates.card_size        = card_size;
  if (grid_order       !== undefined) updates.grid_order       = Number(grid_order);

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

/** GET /api/user/purchases */
app.get('/api/user/purchases', authenticateToken, async (req, res) => {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });
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
 * Logs a reset request in audit_logs for admin to handle.
 */
app.post('/api/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Unesite email adresu' });

  const { data: user } = await supabase
    .from('users')
    .select('id, name, email')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();

  if (user) {
    await supabase.from('audit_logs').insert({
      user_id:    user.id,
      action:     'password_reset_request',
      ip:         getClientIP(req),
      created_at: new Date().toISOString(),
    });
  }

  // Always return same message
  return res.json({ message: 'Vaš zahtjev je primljen. Admin će vas kontaktirati uskoro.' });
});

/**
 * GET /api/admin/reset-requests
 * Returns recent password reset requests with user info.
 */
app.get('/api/admin/reset-requests', authenticateToken, requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('id, user_id, created_at, users(name, email)')
    .eq('action', 'password_reset_request')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: 'Greška' });

  const result = (data || []).map(r => ({
    id:         r.id,
    user_id:    r.user_id,
    created_at: r.created_at,
    name:       r.users?.name  || '–',
    email:      r.users?.email || '–',
  }));

  return res.json(result);
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
   Health check
───────────────────────────────────────── */
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

/* ─────────────────────────────────────────
   Start server
───────────────────────────────────────── */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🔑 Keyify API running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health\n`);
});
