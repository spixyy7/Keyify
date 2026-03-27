-- ═══════════════════════════════════════════════════════════════
-- Keyify – Live Chat Schema  (run in Supabase SQL Editor)
-- ═══════════════════════════════════════════════════════════════

-- ── 1. CHAT SESSIONS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_sessions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        REFERENCES users(id) ON DELETE SET NULL,
  guest_email   TEXT,
  status        TEXT        NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'closed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. CHAT MESSAGES ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID        NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  sender        TEXT        NOT NULL CHECK (sender IN ('user', 'admin')),
  message       TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3. PERFORMANCE INDEXES ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_chat_sessions_status  ON chat_sessions(status);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_created ON chat_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);
