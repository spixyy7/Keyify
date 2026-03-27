-- ============================================================
-- Keyify – Encrypted Transaction Logs
-- AES-256-CBC encrypted buyer_email + amount stored in DB.
-- Decryption happens server-side via AES_KEY env variable.
-- Run this script once in Supabase SQL Editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS transaction_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_email_enc TEXT NOT NULL,          -- AES-256-CBC encrypted buyer email
  amount_enc      TEXT NOT NULL,          -- AES-256-CBC encrypted transaction amount (string)
  product_name    TEXT,
  payment_method  TEXT,
  tx_reference    TEXT,                   -- FK to transactions.id or external reference
  status          TEXT DEFAULT 'completed'
                  CHECK (status IN ('pending','completed','failed','refunded')),
  logged_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Indexes for admin dashboard queries
CREATE INDEX IF NOT EXISTS idx_txlogs_created_at ON transaction_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_txlogs_status     ON transaction_logs(status);

-- Enable RLS (access controlled at application layer via service-role key)
ALTER TABLE transaction_logs ENABLE ROW LEVEL SECURITY;

-- Policy: only service-role key (used by backend) can read/write
-- No direct frontend access – all decryption goes through /api/admin/transaction-logs
CREATE POLICY txlogs_service_only ON transaction_logs
  USING (false);   -- blocks all authenticated/anon access; service-role bypasses RLS


-- ============================================================
-- Coupons table (maps to existing promo_codes – no migration needed
-- if promo_codes already exists. This is an alternative clean schema.)
-- ============================================================

-- If you want a dedicated coupons table separate from promo_codes:
-- (Skip if promo_codes is already in use)
/*
CREATE TABLE IF NOT EXISTS coupons (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT UNIQUE NOT NULL,
  discount_percent NUMERIC(5,2) NOT NULL CHECK (discount_percent > 0 AND discount_percent <= 100),
  expiry_date     TIMESTAMPTZ,
  is_active       BOOLEAN DEFAULT true,
  usage_limit     INT,
  used_count      INT DEFAULT 0,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
*/


-- ============================================================
-- Page Templates (for Visual Editor save – may already exist)
-- ============================================================

CREATE TABLE IF NOT EXISTS page_templates (
  slug        TEXT PRIMARY KEY,
  html        TEXT NOT NULL,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Add AES_KEY to your .env:
--   AES_KEY=<64 hex chars>
-- Generate with:
--   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
-- ============================================================
