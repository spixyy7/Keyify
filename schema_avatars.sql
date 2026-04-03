-- ================================================================
-- Keyify – Avatar System Migration
-- Adds: avatar_url column on users + avatars storage bucket
-- Run in Supabase SQL Editor
-- ================================================================

-- 1. Add avatar_url column to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT NULL;

-- 2. Create avatars storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Storage policies
CREATE POLICY "Public read avatars"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

CREATE POLICY "Authenticated upload avatars"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'avatars');

CREATE POLICY "Owner update avatars"
ON storage.objects FOR UPDATE
USING (bucket_id = 'avatars');
