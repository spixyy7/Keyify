-- ================================================================
-- Keyify – Add warranty_text column to products
-- Run in Supabase SQL Editor
-- ================================================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS warranty_text TEXT DEFAULT NULL;
