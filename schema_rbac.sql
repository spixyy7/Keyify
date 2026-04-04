-- ================================================================
-- Keyify – Dynamic RBAC (Role Builder)
-- Adds: roles table with permission templates
-- Run in Supabase SQL Editor
-- ================================================================

CREATE TABLE IF NOT EXISTS roles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL UNIQUE,
  power_level  INTEGER NOT NULL DEFAULT 10,
  permissions  JSONB DEFAULT '{}',
  is_default   BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default roles
INSERT INTO roles (name, power_level, permissions, is_default) VALUES
  ('User', 10, '{}', true),
  ('Moderator', 50, '{"can_manage_reviews":true,"can_verify_payments":true}', false),
  ('Admin', 90, '{"can_manage_promos":true,"can_view_invoices":true,"can_manage_support":true,"can_manage_reviews":true,"can_verify_payments":true}', false),
  ('Super Admin', 100, '{}', false)
ON CONFLICT (name) DO NOTHING;
