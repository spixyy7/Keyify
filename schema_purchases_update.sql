-- ============================================================
-- Keyify – Purchases Update Migration
-- Run once in Supabase SQL Editor.
-- Adds license_key + buyer_email columns to transactions,
-- and an orders_view for joined queries.
-- ============================================================

-- 1. Add license_key column (stores generated KFY-XXXX-XXXX-XXXX key)
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS license_key TEXT,
  ADD COLUMN IF NOT EXISTS buyer_email TEXT;

-- 2. Index for guest purchase lookup by email
CREATE INDEX IF NOT EXISTS idx_tx_buyer_email
  ON transactions(buyer_email);

-- 3. Index for user purchase history
CREATE INDEX IF NOT EXISTS idx_tx_user_created
  ON transactions(user_id, created_at DESC);

-- 4. RLS policy: users can read their own transactions
--    (existing policies may already cover this — adjust as needed)
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Allow users to SELECT their own rows
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'transactions' AND policyname = 'tx_owner_select'
  ) THEN
    CREATE POLICY tx_owner_select ON transactions
      FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END$$;

-- ============================================================
-- page_templates already created in schema_transaction_logs.sql
-- No duplicate CREATE needed.
-- ============================================================

-- Quick sanity check (optional — comment out before running):
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'transactions'
-- ORDER BY ordinal_position;
