-- ═══════════════════════════════════════════════════════════════
-- Keyify – Chat Status Migration  (run in Supabase SQL Editor)
-- Adds: new/seen/answered statuses + message preview columns
-- ═══════════════════════════════════════════════════════════════

-- 1. Drop old constraint
ALTER TABLE chat_sessions DROP CONSTRAINT IF EXISTS chat_sessions_status_check;

-- 2. Rename existing 'open' sessions → 'new'
UPDATE chat_sessions SET status = 'new' WHERE status = 'open';

-- 3. Add new constraint with all valid statuses
ALTER TABLE chat_sessions
  ADD CONSTRAINT chat_sessions_status_check
  CHECK (status IN ('new', 'seen', 'answered', 'closed'));

-- 4. Update default
ALTER TABLE chat_sessions ALTER COLUMN status SET DEFAULT 'new';

-- 5. Add message preview columns
ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS last_message_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_message_preview TEXT;

-- 6. Index for queue sorting
CREATE INDEX IF NOT EXISTS idx_chat_sessions_last_msg
  ON chat_sessions(last_message_at DESC NULLS LAST);
