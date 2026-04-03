-- ================================================================
-- Keyify – Referral System Migration
-- Run in Supabase SQL Editor
-- ================================================================

CREATE TABLE IF NOT EXISTS referral_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_code ON referral_codes(UPPER(code));

CREATE TABLE IF NOT EXISTS referrals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT DEFAULT 'registered' CHECK (status IN ('registered','purchased','rewarded')),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(referrer_id, referred_id)
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);

CREATE TABLE IF NOT EXISTS referral_tiers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_level          INTEGER NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  required_referrals  INTEGER NOT NULL,
  reward_type         TEXT NOT NULL CHECK (reward_type IN ('percent','fixed')),
  reward_value        NUMERIC(10,2) NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Default tiers
INSERT INTO referral_tiers (tier_level, name, required_referrals, reward_type, reward_value) VALUES
  (1, 'Starter',   3,  'percent', 5),
  (2, 'Bronze',    7,  'percent', 10),
  (3, 'Silver',   15,  'percent', 15),
  (4, 'Gold',     30,  'percent', 20),
  (5, 'Diamond',  50,  'fixed',   10)
ON CONFLICT (tier_level) DO NOTHING;
