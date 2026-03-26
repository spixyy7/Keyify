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
 *  POST   /api/products          – Admin: create product
 *  PUT    /api/products/:id      – Admin: update product
 *  DELETE /api/products/:id      – Admin: delete product
 */

require('dotenv').config();

const express     = require('express');
const cors        = require('cors');
const bcrypt      = require('bcryptjs');
const jwt         = require('jsonwebtoken');
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
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/* ─────────────────────────────────────────
   Helpers
───────────────────────────────────────── */
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function getClientIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
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
    await transporter.sendMail({
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

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  const ip = getClientIP(req);
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
    users:              usersRes.data || [],
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
    category, image_url, badge,
  } = req.body;

  if (!name_sr || !price || !category)
    return res.status(400).json({ error: 'Naziv, cijena i kategorija su obavezni' });

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
      created_at:     new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'Greška pri kreiranju proizvoda' });
  return res.status(201).json(data);
});

/** PUT /api/products/:id – admin only */
app.put('/api/products/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const updates = { ...req.body };

  // Sanitize numeric fields
  if (updates.price)          updates.price          = parseFloat(updates.price);
  if (updates.original_price) updates.original_price = parseFloat(updates.original_price);
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('products')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'Greška pri ažuriranju' });
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
