-- ═══════════════════════════════════════════════════════════
--  Keyify – Schema Update: RBAC + Visual Editor Layout
--  Run in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════

-- 1. Add permissions JSONB column to users
--    {} = super admin (no restrictions)
--    {"manage_products":true,"edit_theme":false,...} = limited staff
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 2. Add layout columns to products
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS grid_order  INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS card_size   VARCHAR(10)  NOT NULL DEFAULT 'sm';

-- 3. Enforce valid card_size values
ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_card_size_check;
ALTER TABLE products
  ADD CONSTRAINT products_card_size_check
    CHECK (card_size IN ('sm', 'lg'));

-- 4. Initialize grid_order per category (ordered by created_at)
WITH ranked AS (
  SELECT id,
         (ROW_NUMBER() OVER (PARTITION BY category ORDER BY created_at ASC) - 1) AS rn
  FROM products
)
UPDATE products
SET    grid_order = ranked.rn
FROM   ranked
WHERE  products.id = ranked.id;

-- 5. Index for fast category + order queries
CREATE INDEX IF NOT EXISTS idx_products_cat_order
  ON products (category, grid_order);

-- Verify
SELECT column_name, data_type
FROM   information_schema.columns
WHERE  table_name IN ('users','products')
  AND  column_name IN ('permissions','grid_order','card_size')
ORDER  BY table_name, column_name;
