-- Hero Image System: add hero customization columns to products table
ALTER TABLE products ADD COLUMN IF NOT EXISTS hero_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS hero_bg_type TEXT DEFAULT 'auto';
ALTER TABLE products ADD COLUMN IF NOT EXISTS hero_bg_image TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS hero_bg_colors TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS hero_title TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS hero_subtitle TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS hero_icon TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS hero_glow_intensity NUMERIC(3,2) DEFAULT 0.5;
ALTER TABLE products ADD COLUMN IF NOT EXISTS hero_blur NUMERIC(4,1) DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS hero_style TEXT DEFAULT 'default';
