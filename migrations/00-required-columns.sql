-- ============================================================
-- MOLIYA AI — DATABASE MIGRATION SCRIPT
-- Run this in the Supabase SQL Editor
-- ============================================================

-- ── 1. Add new columns to users table ────────────────────────
-- These new fields are required for the effectiveAccess() function

-- unlimited_ai: Admin-granted unlimited AI access (independent of VIP)
ALTER TABLE users ADD COLUMN IF NOT EXISTS unlimited_ai BOOLEAN DEFAULT FALSE;

-- ai_blocked: Admin-granted AI block
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_blocked BOOLEAN DEFAULT FALSE;

-- is_restricted: Account restriction status
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_restricted BOOLEAN DEFAULT FALSE;

-- is_deleted: Soft delete flag
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;

-- account_status: Explicit account status field
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status TEXT DEFAULT 'active';

-- trial_ends_at: Explicit trial end timestamp (separate from premium_expires_at)
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

-- privacy_consent: Privacy policy consent record (JSONB)
-- Stores: { version, accepted, accepted_at, consent_source, telegram_id }
ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_consent JSONB;

-- ── 2. Add source column to ai_logs ──────────────────────────
-- Tracks whether AI request came from telegram_bot or mini_app
ALTER TABLE ai_logs ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'unknown';

-- ── 3. Create admin_audit_log table ──────────────────────────
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action TEXT NOT NULL,
  target_user_id TEXT,
  target_user_name TEXT,
  details JSONB,
  admin_id TEXT DEFAULT 'admin',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for fast lookups by target user
CREATE INDEX IF NOT EXISTS idx_audit_log_target_user ON admin_audit_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON admin_audit_log(created_at DESC);

-- ── 4. Create indexes for search performance ─────────────────
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram);
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_is_blocked ON users(is_blocked);
CREATE INDEX IF NOT EXISTS idx_users_unlimited_ai ON users(unlimited_ai);

-- ── 5. Add source index to ai_logs ──────────────────────────
CREATE INDEX IF NOT EXISTS idx_ai_logs_source ON ai_logs(source);
CREATE INDEX IF NOT EXISTS idx_ai_logs_user_id ON ai_logs(user_id);

-- ── Done! ────────────────────────────────────────────────────
-- Verify by running: SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users' ORDER BY ordinal_position;
