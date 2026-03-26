-- ═══════════════════════════════════════════════════════════════
-- KEYIFY — Supabase SQL Schema
-- Paste this entire file into the Supabase SQL Editor and run it.
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- USERS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT        NOT NULL,
  email           TEXT        NOT NULL UNIQUE,
  password_hash   TEXT        NOT NULL,
  role            TEXT        NOT NULL DEFAULT 'user'
                              CHECK (role IN ('user', 'admin')),
  is_verified     BOOLEAN     DEFAULT FALSE,
  otp_code        TEXT,
  otp_expires     TIMESTAMPTZ,
  registered_ip   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- ─────────────────────────────────────────────────────────────
-- DEFAULT ADMIN ACCOUNT
-- Password = "Admin1234!" (bcrypt, cost 12)
-- ⚠  Change this password immediately after first login!
-- ─────────────────────────────────────────────────────────────
INSERT INTO users (name, email, password_hash, role, is_verified)
VALUES (
  'Admin',
  'admin@keyify.com',
  '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj4oGqU3Xp1C',
  'admin',
  TRUE
)
ON CONFLICT (email) DO NOTHING;


-- ─────────────────────────────────────────────────────────────
-- PRODUCTS  (bilingual: Serbian + English)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id               UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  name_sr          TEXT          NOT NULL,
  name_en          TEXT,
  description_sr   TEXT,
  description_en   TEXT,
  price            NUMERIC(10,2) NOT NULL,
  original_price   NUMERIC(10,2),
  category         TEXT          NOT NULL
                   CHECK (category IN ('ai','design','business','windows','music','streaming')),
  image_url        TEXT,
  badge            TEXT,
  created_at       TIMESTAMPTZ   DEFAULT NOW(),
  updated_at       TIMESTAMPTZ
);

-- Sample products
INSERT INTO products
  (name_sr, name_en, description_sr, description_en, price, original_price, category, badge)
VALUES
  ('ChatGPT Plus',          'ChatGPT Plus',
   'GPT-4o pristup, DALL·E, pluginovi',         'GPT-4o access, DALL·E, plugins',
   18.99, 24.99, 'ai',         'Bestseller'),

  ('Claude Pro',             'Claude Pro',
   'Anthropic Claude Pro plan',                  'Anthropic Claude Pro plan',
   16.99, 22.99, 'ai',         'Novo'),

  ('Gemini Advanced',        'Gemini Advanced',
   'Google Gemini Ultra model',                  'Google Gemini Ultra model',
   17.99, 23.99, 'ai',         NULL),

  ('Adobe Creative Cloud',   'Adobe Creative Cloud',
   'Photoshop, Illustrator, Premiere i još',     'Photoshop, Illustrator, Premiere & more',
   34.99, 59.99, 'design',     'SALE'),

  ('Figma Professional',     'Figma Professional',
   'Neograničeni projekti i verzije',             'Unlimited projects and versions',
   14.99, 19.99, 'design',     NULL),

  ('Microsoft 365 Personal', 'Microsoft 365 Personal',
   'Word, Excel, PowerPoint + 1TB OneDrive',     'Word, Excel, PowerPoint + 1TB OneDrive',
   22.99, 29.99, 'windows',    'Bestseller'),

  ('Windows 11 Pro',         'Windows 11 Pro',
   'Originalni digitalni ključ',                  'Original digital key',
   19.99, 39.99, 'windows',    'SALE'),

  ('Kaspersky Total Security','Kaspersky Total Security',
   'Zaštita za 3 uređaja, 1 godina',             '3-device protection, 1 year',
   12.99, 24.99, 'business',   NULL),

  ('NordVPN 1 Year',         'NordVPN 1 Year',
   '6 uređaja, 60+ zemalja',                     '6 devices, 60+ countries',
   29.99, 59.99, 'business',   'Popular'),

  ('Spotify Premium',        'Spotify Premium',
   'Neograničena muzika bez reklama',             'Unlimited music without ads',
    7.99,  9.99, 'music',      NULL),

  ('Apple Music Individual', 'Apple Music Individual',
   '100M pjesama, lossless audio',               '100M songs, lossless audio',
    8.99, 10.99, 'music',      NULL),

  ('Netflix Standard',       'Netflix Standard',
   'HD streaming na 2 ekrana',                   'HD streaming on 2 screens',
   11.99, 15.99, 'streaming',  NULL),

  ('Disney+ Annual',         'Disney+ Annual',
   'Disney, Marvel, Star Wars, Pixar',           'Disney, Marvel, Star Wars, Pixar',
   49.99, 79.99, 'streaming',  'SALE')
ON CONFLICT DO NOTHING;


-- ─────────────────────────────────────────────────────────────
-- TRANSACTIONS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id              UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID          REFERENCES users(id)    ON DELETE SET NULL,
  product_id      UUID          REFERENCES products(id) ON DELETE SET NULL,
  product_name    TEXT,
  amount          NUMERIC(10,2) NOT NULL,
  currency        TEXT          DEFAULT 'EUR',
  payment_method  TEXT,
    -- 'paypal' | 'crypto_btc' | 'crypto_eth' | 'crypto_usdt' | 'bank'
  status          TEXT          DEFAULT 'pending'
                  CHECK (status IN ('pending','completed','failed','refunded')),
  tx_reference    TEXT,
  created_at      TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user   ON transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions (status);


-- ─────────────────────────────────────────────────────────────
-- SITE SETTINGS  (single row, id = 1 always)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS site_settings (
  id              INT  PRIMARY KEY DEFAULT 1,
  primary_color   TEXT DEFAULT '#1D6AFF',
  panel_bg        TEXT DEFAULT '#1a1a2e',
  paypal_email    TEXT,
  btc_wallet      TEXT,
  eth_wallet      TEXT,
  usdt_wallet     TEXT,
  bank_iban       TEXT,
  bank_name       TEXT,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO site_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────
-- AUDIT LOGS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT        NOT NULL,
    -- 'register' | 'login_attempt' | 'login_success'
  ip          TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs (created_at DESC);


-- ─────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- All writes are done via the service_role key in server.js,
-- which bypasses RLS. Policies below cover public reads only.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE products      ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs    ENABLE ROW LEVEL SECURITY;

-- Anyone can read products (shop frontend)
DROP POLICY IF EXISTS "products_public_read" ON products;
CREATE POLICY "products_public_read"
  ON products FOR SELECT USING (true);

-- Anyone can read site_settings (checkout page fetches payment info)
DROP POLICY IF EXISTS "settings_public_read" ON site_settings;
CREATE POLICY "settings_public_read"
  ON site_settings FOR SELECT USING (true);

-- ═══════════════════════════════════════════════════════════════
-- Done! Your schema is ready.
-- Next: copy your Supabase project URL + service_role key
--       into the Railway environment variables.
-- ═══════════════════════════════════════════════════════════════
