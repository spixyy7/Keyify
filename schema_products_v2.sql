-- ================================================================
-- Keyify – Product Variants & Features
-- Adds: product_variants + product_features tables
-- Run in Supabase SQL Editor
-- ================================================================

-- Product variants (packages/plans)
CREATE TABLE IF NOT EXISTS product_variants (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label          TEXT NOT NULL,
  variant_type   TEXT DEFAULT 'duration',
  price          NUMERIC(10,2) NOT NULL,
  original_price NUMERIC(10,2),
  sort_order     INTEGER DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pv_product ON product_variants(product_id);

-- Product features (green checkmark list)
CREATE TABLE IF NOT EXISTS product_features (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  text_sr     TEXT NOT NULL,
  text_en     TEXT,
  sort_order  INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pf_product ON product_features(product_id);
