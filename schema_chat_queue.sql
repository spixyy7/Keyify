-- ═══════════════════════════════════════════════════════════════
-- Keyify – Chat Queue & Admin Assignment Migration
-- Adds: pending/active statuses, admin_id tracking, queue support
-- Run in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 1. Drop old constraint
ALTER TABLE chat_sessions DROP CONSTRAINT IF EXISTS chat_sessions_status_check;

-- 2. Migrate existing statuses → pending (was 'new') and active (was 'seen'/'answered')
UPDATE chat_sessions SET status = 'pending' WHERE status = 'new';
UPDATE chat_sessions SET status = 'active'  WHERE status IN ('seen', 'answered');

-- 3. Add new constraint with queue-aware statuses
ALTER TABLE chat_sessions
  ADD CONSTRAINT chat_sessions_status_check
  CHECK (status IN ('pending', 'active', 'closed'));

-- 4. Update default for new sessions
ALTER TABLE chat_sessions ALTER COLUMN status SET DEFAULT 'pending';

-- 5. Add admin_id to track which admin accepted the chat
ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS admin_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- 6. Add accepted_at timestamp
ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;

-- 7. Index for queue ordering (pending sessions by creation time)
CREATE INDEX IF NOT EXISTS idx_chat_sessions_pending_queue
  ON chat_sessions(created_at ASC) WHERE status = 'pending';

-- 8. Index for admin's active sessions
CREATE INDEX IF NOT EXISTS idx_chat_sessions_admin
  ON chat_sessions(admin_id) WHERE admin_id IS NOT NULL;

-- 9. Add avatar_url to users table if not exists (for admin avatars in chat)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;
