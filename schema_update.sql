-- ═══════════════════════════════════════════════════════════════
-- Keyify – Database Schema Update  (run in Supabase SQL Editor)
-- ═══════════════════════════════════════════════════════════════

-- ── 1. PROMO CODES ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS promo_codes (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  code           TEXT          NOT NULL,
  discount_type  TEXT          NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value NUMERIC(10,2) NOT NULL CHECK (discount_value > 0),
  usage_limit    INTEGER       DEFAULT NULL,      -- NULL = unlimited
  used_count     INTEGER       NOT NULL DEFAULT 0,
  expires_at     TIMESTAMPTZ   DEFAULT NULL,      -- NULL = never expires
  is_active      BOOLEAN       NOT NULL DEFAULT TRUE,
  created_by     UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT promo_codes_code_unique UNIQUE (UPPER(code))
);

-- ── 2. SUPPORT TICKETS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_tickets (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  email       TEXT        NOT NULL,
  subject     TEXT        NOT NULL,
  message     TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'replied', 'closed')),
  reply_text  TEXT        DEFAULT NULL,
  replied_at  TIMESTAMPTZ DEFAULT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3. SQL AUDIT LOGS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sql_audit_logs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        REFERENCES users(id) ON DELETE SET NULL,
  ip_address   TEXT        NOT NULL,
  query        TEXT        NOT NULL,
  success      BOOLEAN     NOT NULL,
  error_msg    TEXT        DEFAULT NULL,
  row_count    INTEGER     DEFAULT NULL,
  executed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 4. SQL EXECUTOR RPC FUNCTION ──────────────────────────────
-- Called by the backend via supabase.rpc('keyify_execute_sql', { p_sql })
-- SELECT-only for safety; non-SELECT raises an exception.
CREATE OR REPLACE FUNCTION keyify_execute_sql(p_sql TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  IF UPPER(TRIM(p_sql)) !~ '^SELECT\s' THEN
    RAISE EXCEPTION 'Only SELECT queries are permitted in the SQL Editor.';
  END IF;
  EXECUTE format('SELECT json_agg(t) FROM (%s) t', p_sql) INTO v_result;
  RETURN COALESCE(v_result, '[]'::JSON);
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION '%', SQLERRM;
END;
$$;

REVOKE ALL   ON FUNCTION keyify_execute_sql(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keyify_execute_sql(TEXT) TO service_role;

-- ── 5. PERFORMANCE INDEXES ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_support_tickets_status  ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created ON support_tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_promo_codes_active       ON promo_codes(UPPER(code)) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_sql_audit_executed       ON sql_audit_logs(executed_at DESC);

-- ── 6. GOOGLE OAUTH COLUMNS ──────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS provider  TEXT NOT NULL DEFAULT 'email';
-- provider values: 'email' | 'google'
-- password_hash can be NULL for pure Google users

-- ── 7. RBAC DOCUMENTATION ────────────────────────────────────
-- permissions column is JSONB on the users table (no schema change needed).
-- New keys added in this release:
--   can_manage_promos   → Promo Codes tab
--   can_manage_support  → Support Hub tab
--   can_execute_sql     → SQL Editor tab  (super-admin only recommended)
-- Empty object {} = super-admin (unrestricted access).
COMMENT ON COLUMN users.permissions IS
  'JSONB map. Keys: manage_products | edit_theme | manage_users | view_financials | can_manage_promos | can_manage_support | can_execute_sql. Empty = super-admin.';
