-- ============================================================
-- Keyify - CMS Remont / Categories / Products / Transactions
-- Safe to run in Supabase SQL Editor more than once.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- Categories
-- ============================================================
CREATE TABLE IF NOT EXISTS categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  label       TEXT,
  page_slug   TEXT UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO categories (slug, name, label, page_slug, sort_order, is_active)
VALUES
  ('ai',        'AI Alati',            'AI Alati',            'ai',        10, true),
  ('design',    'Design & Creativity', 'Design & Creativity', 'design',    20, true),
  ('business',  'Business Software',   'Business Software',   'business',  30, true),
  ('windows',   'Windows & Office',    'Windows & Office',    'windows',   40, true),
  ('music',     'Music Streaming',     'Music Streaming',     'music',     50, true),
  ('streaming', 'TV/Video Streaming',  'TV/Video Streaming',  'streaming', 60, true)
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  label = EXCLUDED.label,
  page_slug = EXCLUDED.page_slug,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  updated_at = now();

-- ============================================================
-- Products
-- ============================================================
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS grid_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS card_size TEXT DEFAULT 'md',
  ADD COLUMN IF NOT EXISTS stars INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS bonus_coupon_id UUID,
  ADD COLUMN IF NOT EXISTS delivery_message TEXT,
  ADD COLUMN IF NOT EXISTS warranty_text TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'products'::regclass
      AND conname = 'products_category_check'
  ) THEN
    ALTER TABLE products DROP CONSTRAINT products_category_check;
  END IF;
END $$;

UPDATE products AS p
SET
  category = c.slug,
  category_id = c.id,
  updated_at = COALESCE(p.updated_at, now())
FROM categories AS c
WHERE p.category_id IS NULL
  AND (
    lower(trim(COALESCE(p.category, ''))) = c.slug
    OR regexp_replace(lower(COALESCE(p.category, '')), '[^a-z0-9]+', '-', 'g') = c.slug
    OR regexp_replace(lower(COALESCE(p.category, '')), '[^a-z0-9]+', '-', 'g') = COALESCE(c.page_slug, c.slug)
  );

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_grid_order ON products(grid_order);

-- ============================================================
-- Product packages / features
-- ============================================================
CREATE TABLE IF NOT EXISTS product_variants (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label          TEXT NOT NULL,
  variant_type   TEXT NOT NULL DEFAULT 'duration',
  price          NUMERIC(10,2) NOT NULL,
  original_price NUMERIC(10,2),
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_variants_product_id
  ON product_variants(product_id);

CREATE TABLE IF NOT EXISTS product_features (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  text_sr     TEXT NOT NULL,
  text_en     TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_product_features_product_id
  ON product_features(product_id);

UPDATE products AS p
SET price = v.min_price
FROM (
  SELECT product_id, MIN(price) AS min_price
  FROM product_variants
  GROUP BY product_id
) AS v
WHERE p.id = v.product_id
  AND (p.price IS NULL OR p.price = 0 OR p.price > v.min_price);

-- ============================================================
-- Transactions
-- ============================================================
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS license_key TEXT,
  ADD COLUMN IF NOT EXISTS buyer_email TEXT,
  ADD COLUMN IF NOT EXISTS verification_status TEXT,
  ADD COLUMN IF NOT EXISTS ip_address_enc TEXT,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_transactions_buyer_email
  ON transactions(buyer_email);

CREATE INDEX IF NOT EXISTS idx_transactions_created_at
  ON transactions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_user_created
  ON transactions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_verifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  buyer_email    TEXT,
  payment_type   TEXT,
  screenshot_url TEXT,
  paypal_email   TEXT,
  tx_hash        TEXT,
  network        TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  admin_notes    TEXT,
  reviewed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_verifications_transaction
  ON payment_verifications(transaction_id);

CREATE INDEX IF NOT EXISTS idx_payment_verifications_status
  ON payment_verifications(status);

-- ============================================================
-- Footer / live editor content
-- ============================================================
CREATE TABLE IF NOT EXISTS site_content (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS facebook_url TEXT,
  ADD COLUMN IF NOT EXISTS twitter_url TEXT,
  ADD COLUMN IF NOT EXISTS instagram_url TEXT;

INSERT INTO site_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO site_content (key, value)
VALUES
  ('footer_tagline', 'Vaš pouzdani izvor originalnih digitalnih ključeva i pretplata po najboljim cijenama na tržištu.'),
  ('footer_copyright', '© 2025 Keyify. Sva prava zadržana.')
ON CONFLICT (key) DO NOTHING;
