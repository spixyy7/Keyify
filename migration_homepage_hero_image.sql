-- Add homepage_hero_image column to products table
-- This field stores a separate hero-quality image URL for the index page featured product
ALTER TABLE products ADD COLUMN IF NOT EXISTS homepage_hero_image TEXT;
