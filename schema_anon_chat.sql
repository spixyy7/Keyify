-- ============================================================
-- Keyify – Anonymous Chat + Ask-Email Command Migration
-- Run once in Supabase SQL Editor.
-- ============================================================

-- 1. Anon identifier on chat sessions (e.g. "#A3F7B2")
ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS anon_id TEXT;

CREATE INDEX IF NOT EXISTS idx_chat_anon_id
  ON chat_sessions(anon_id);

-- 2. Message type for special system messages
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS msg_type TEXT NOT NULL DEFAULT 'text';

-- Possible values: 'text' | 'ask_email' | 'email_received'
