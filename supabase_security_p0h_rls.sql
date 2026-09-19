-- ============================================================
-- MOLIYA AI — STAGE P0-H: ROW LEVEL SECURITY & HARDENING
-- Run this in the Supabase SQL Editor (Dashboard -> SQL Editor)
-- Locks down public.users, public.ai_logs, and public.app_notifications
-- ============================================================

-- ------------------------------------------------------------
-- 1. LOCK DOWN public.ai_logs (Private Internal Logs Only)
-- ------------------------------------------------------------
ALTER TABLE public.ai_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all on ai_logs" ON public.ai_logs;
DROP POLICY IF EXISTS "Allow all operations on ai_logs" ON public.ai_logs;
DROP POLICY IF EXISTS "Public read ai_logs" ON public.ai_logs;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.ai_logs;
DROP POLICY IF EXISTS "Enable all access for all users" ON public.ai_logs;

REVOKE ALL ON TABLE public.ai_logs FROM anon;
REVOKE ALL ON TABLE public.ai_logs FROM authenticated;

GRANT ALL ON TABLE public.ai_logs TO service_role;
GRANT ALL ON TABLE public.ai_logs TO postgres;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'ai_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.ai_logs;
  END IF;
END $$;


-- ------------------------------------------------------------
-- 2. LOCK DOWN public.app_notifications (Audience & Target Isolated)
-- ------------------------------------------------------------
ALTER TABLE public.app_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all on app_notifications" ON public.app_notifications;
DROP POLICY IF EXISTS "Public read app_notifications" ON public.app_notifications;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.app_notifications;
DROP POLICY IF EXISTS "Enable all access for all users" ON public.app_notifications;
DROP POLICY IF EXISTS "allow_read_notifications" ON public.app_notifications;
DROP POLICY IF EXISTS "allow_public_read_notifications" ON public.app_notifications;
DROP POLICY IF EXISTS "anon_read_public_broadcasts" ON public.app_notifications;
DROP POLICY IF EXISTS "authenticated_read_notifications" ON public.app_notifications;

-- Revoke all permissions from anon and authenticated
REVOKE ALL ON TABLE public.app_notifications FROM anon;
REVOKE ALL ON TABLE public.app_notifications FROM authenticated;

-- Allow SELECT to anon (for public broadcasts only) and authenticated (for public + targeted)
GRANT SELECT ON TABLE public.app_notifications TO anon;
GRANT SELECT ON TABLE public.app_notifications TO authenticated;

-- Policy 1: Anon can ONLY read general public broadcasts (cannot read targeted/private notifications)
CREATE POLICY "anon_read_public_broadcasts" ON public.app_notifications
  FOR SELECT
  TO anon
  USING (
    target IS NULL OR target IN ('all', 'telegram', 'web', 'free')
  );

-- Policy 2: Authenticated users can read public broadcasts AND notifications targeted to them
CREATE POLICY "authenticated_read_notifications" ON public.app_notifications
  FOR SELECT
  TO authenticated
  USING (
    target IS NULL 
    OR target IN ('all', 'telegram', 'web', 'vip', 'free')
    OR (
      (auth.jwt() -> 'user_metadata' ->> 'telegram_id') IS NOT NULL
      AND (
        target = (auth.jwt() -> 'user_metadata' ->> 'telegram_id')
        OR target = ('moliya_user_tg_' || (auth.jwt() -> 'user_metadata' ->> 'telegram_id'))
      )
    )
    OR (
      auth.uid() IS NOT NULL
      AND target = auth.uid()::text
    )
  );

-- Grant full permissions to service_role and postgres (all writes must go through backend)
GRANT ALL ON TABLE public.app_notifications TO service_role;
GRANT ALL ON TABLE public.app_notifications TO postgres;


-- ------------------------------------------------------------
-- 3. LOCK DOWN public.users (Own-Profile Only & Column Privileges)
-- ------------------------------------------------------------
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all on users" ON public.users;
DROP POLICY IF EXISTS "Allow all operations on users" ON public.users;
DROP POLICY IF EXISTS "Users can read and update own profile" ON public.users;
DROP POLICY IF EXISTS "Public read users" ON public.users;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.users;
DROP POLICY IF EXISTS "Enable all access for all users" ON public.users;
DROP POLICY IF EXISTS "Enable update for all users" ON public.users;
DROP POLICY IF EXISTS "Enable insert for all users" ON public.users;
DROP POLICY IF EXISTS "Enable delete for all users" ON public.users;
DROP POLICY IF EXISTS "Users can read own data" ON public.users;
DROP POLICY IF EXISTS "Users can update own data" ON public.users;
DROP POLICY IF EXISTS "authenticated_select_own_profile" ON public.users;
DROP POLICY IF EXISTS "authenticated_update_own_profile" ON public.users;

-- Revoke all table-level permissions from anon and authenticated
REVOKE ALL PRIVILEGES ON TABLE public.users FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.users FROM authenticated;

-- Authenticated role: Read own row via RLS
GRANT SELECT ON TABLE public.users TO authenticated;

-- Authenticated role: Column-level UPDATE privilege on non-privileged fields ONLY
-- Excludes: is_premium, premium_expires_at, ai_limit, is_blocked, is_restricted,
--           ai_blocked, unlimited_ai, ai_query_count, last_ai_query_at,
--           telegram_id, auth_user_id, id, created_at
GRANT UPDATE (cards, transactions, onboarding, name, language, platform, updated_at) 
  ON TABLE public.users TO authenticated;

-- Policy 1: Authenticated SELECT own profile only
CREATE POLICY "authenticated_select_own_profile" ON public.users
  FOR SELECT
  TO authenticated
  USING (
    (auth.uid() IS NOT NULL AND auth_user_id IS NOT NULL AND auth.uid() = auth_user_id)
    OR
    (telegram_id IS NOT NULL 
     AND (auth.jwt() -> 'user_metadata' ->> 'telegram_id') IS NOT NULL 
     AND (auth.jwt() -> 'user_metadata' ->> 'telegram_id') = telegram_id::text)
  );

-- Policy 2: Authenticated UPDATE own profile only (on permitted non-privileged columns)
CREATE POLICY "authenticated_update_own_profile" ON public.users
  FOR UPDATE
  TO authenticated
  USING (
    (auth.uid() IS NOT NULL AND auth_user_id IS NOT NULL AND auth.uid() = auth_user_id)
    OR
    (telegram_id IS NOT NULL 
     AND (auth.jwt() -> 'user_metadata' ->> 'telegram_id') IS NOT NULL 
     AND (auth.jwt() -> 'user_metadata' ->> 'telegram_id') = telegram_id::text)
  )
  WITH CHECK (
    (auth.uid() IS NOT NULL AND auth_user_id IS NOT NULL AND auth.uid() = auth_user_id)
    OR
    (telegram_id IS NOT NULL 
     AND (auth.jwt() -> 'user_metadata' ->> 'telegram_id') IS NOT NULL 
     AND (auth.jwt() -> 'user_metadata' ->> 'telegram_id') = telegram_id::text)
  );

-- Grant full permissions to service_role and postgres
GRANT ALL ON TABLE public.users TO service_role;
GRANT ALL ON TABLE public.users TO postgres;

-- Remove users from realtime publication if present to prevent websocket eavesdropping
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'users'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.users;
  END IF;
END $$;


-- ------------------------------------------------------------
-- 4. VERIFICATION QUERY (Inspect Active Policies & Permissions)
-- ------------------------------------------------------------
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename IN ('users', 'ai_logs', 'app_notifications', 'ai_keys')
ORDER BY tablename, policyname;
