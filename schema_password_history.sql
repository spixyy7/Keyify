-- ═══════════════════════════════════════════════════════════════
-- Keyify – Password History  (run in Supabase SQL Editor)
-- Prevents reuse of the last 5 passwords.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS password_history (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_history_user
  ON password_history(user_id, created_at DESC);
