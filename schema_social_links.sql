-- ================================================================
-- Keyify – Add social link columns to site_settings
-- Run in Supabase SQL Editor
-- ================================================================

ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS facebook_url  TEXT DEFAULT NULL;
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS twitter_url   TEXT DEFAULT NULL;
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS instagram_url TEXT DEFAULT NULL;
