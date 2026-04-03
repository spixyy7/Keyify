-- ================================================================
-- Keyify – Payment Verification Migration
-- Adds: payment_verifications table + verification_status on transactions
-- Run in Supabase SQL Editor
-- ================================================================

-- 1. Payment verification submissions
CREATE TABLE IF NOT EXISTS payment_verifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  buyer_email     TEXT NOT NULL,
  payment_type    TEXT NOT NULL CHECK (payment_type IN ('paypal','crypto')),
  screenshot_url  TEXT,
  paypal_email    TEXT,
  tx_hash         TEXT,
  network         TEXT CHECK (network IN ('BTC','ETH','USDT') OR network IS NULL),
  amount          NUMERIC(10,2),
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  admin_notes     TEXT,
  reviewed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pv_status ON payment_verifications(status);
CREATE INDEX IF NOT EXISTS idx_pv_tx ON payment_verifications(transaction_id);

-- 2. Add verification_status column to transactions
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT NULL;
-- Values: NULL (no verification needed), 'pending', 'approved', 'rejected'

-- 3. Conditional discounts: min product count for promo codes
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS min_products INTEGER DEFAULT NULL;

-- 4. Bonus coupon system + custom delivery message
ALTER TABLE products ADD COLUMN IF NOT EXISTS bonus_coupon_id UUID REFERENCES promo_codes(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_message TEXT DEFAULT NULL;
-- delivery_message: custom HTML/text admin sends to buyer instead of/alongside license key
-- e.g., a download link, account credentials, or special instructions

CREATE TABLE IF NOT EXISTS user_coupons (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  buyer_email     TEXT NOT NULL,
  promo_code_id   UUID REFERENCES promo_codes(id) ON DELETE SET NULL,
  code            TEXT NOT NULL,
  source          TEXT DEFAULT 'purchase_bonus' CHECK (source IN ('purchase_bonus','referral_reward','manual')),
  is_used         BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_coupons_user ON user_coupons(user_id);
CREATE INDEX IF NOT EXISTS idx_user_coupons_email ON user_coupons(buyer_email);
