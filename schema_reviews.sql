-- ================================================================
-- Keyify – Reviews & Feedback Migration
-- Run in Supabase SQL Editor
-- ================================================================

CREATE TABLE IF NOT EXISTS reviews (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
  transaction_id      UUID REFERENCES transactions(id) ON DELETE SET NULL,
  reviewer_name       TEXT NOT NULL,
  reviewer_avatar     TEXT,
  rating              INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  text                TEXT,
  image_url           TEXT,
  is_admin_created    BOOLEAN DEFAULT FALSE,
  is_verified_purchase BOOLEAN DEFAULT FALSE,
  is_visible          BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_visible ON reviews(product_id, is_visible) WHERE is_visible = TRUE;
