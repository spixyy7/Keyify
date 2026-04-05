-- Keyify verified-package reviews migration
-- Run in Supabase SQL Editor before deploying the updated review flow.

ALTER TABLE IF EXISTS public.transactions
  ADD COLUMN IF NOT EXISTS package_purchased TEXT;

ALTER TABLE IF EXISTS public.reviews
  ADD COLUMN IF NOT EXISTS package_purchased TEXT;

CREATE INDEX IF NOT EXISTS idx_transactions_product_user_created
  ON public.transactions(product_id, user_id, created_at DESC);
