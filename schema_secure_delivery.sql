-- Keyify secure delivery / purchases UI migration
-- Runtime uses transactions + payment_verifications.
-- If public.orders exists, compatible columns are added there too.

ALTER TABLE IF EXISTS public.transactions
  ADD COLUMN IF NOT EXISTS delivery_payload TEXT,
  ADD COLUMN IF NOT EXISTS proof_uploaded BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS customer_inputs_enc TEXT,
  ADD COLUMN IF NOT EXISTS product_image TEXT;

ALTER TABLE IF EXISTS public.products
  ADD COLUMN IF NOT EXISTS required_user_inputs TEXT;

UPDATE public.products
SET required_user_inputs = 'none'
WHERE required_user_inputs IS NULL
   OR btrim(required_user_inputs) = '';

ALTER TABLE public.products
  ALTER COLUMN required_user_inputs SET DEFAULT 'none';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'products'
      AND constraint_name = 'products_required_user_inputs_check'
  ) THEN
    ALTER TABLE public.products
      DROP CONSTRAINT products_required_user_inputs_check;
  END IF;
END $$;

ALTER TABLE public.products
  ADD CONSTRAINT products_required_user_inputs_check
  CHECK (required_user_inputs IN ('none', 'email', 'email_password', 'pin_code', 'redirect_to_chat'));

UPDATE public.transactions t
SET delivery_payload = COALESCE(t.delivery_payload, t.license_key)
WHERE t.status = 'completed'
  AND COALESCE(t.delivery_payload, '') = ''
  AND COALESCE(t.license_key, '') <> '';

UPDATE public.transactions t
SET proof_uploaded = true
WHERE EXISTS (
  SELECT 1
  FROM public.payment_verifications pv
  WHERE pv.transaction_id = t.id
);

DO $$
BEGIN
  IF to_regclass('public.orders') IS NOT NULL THEN
    ALTER TABLE public.orders
      ADD COLUMN IF NOT EXISTS delivery_payload TEXT,
      ADD COLUMN IF NOT EXISTS proof_uploaded BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transactions_status_created_at
  ON public.transactions(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_buyer_email_created_at
  ON public.transactions(buyer_email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_verifications_transaction_id
  ON public.payment_verifications(transaction_id);
