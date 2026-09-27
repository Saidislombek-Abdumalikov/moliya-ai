-- Apply as database owner during deployment maintenance, BEFORE deploying this code.
-- Take a database backup first. No financial rows are deleted.
-- Re-running this script signs everybody out again.
BEGIN;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS bot_verification jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public.users.bot_verification IS 'Server-only Telegram consent and own-contact evidence. Never backfill from client onboarding JSON.';

-- This release uses authenticated backend endpoints, not browser users-table access.
-- Revoke column grants too: revoking a table grant alone does not remove these.
DO $$
DECLARE table_name text; column_names text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['users','ai_keys','ai_logs'] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated',table_name);
      SELECT string_agg(quote_ident(attname), ', ') INTO column_names
      FROM pg_attribute WHERE attrelid=to_regclass('public.' || table_name) AND attnum>0 AND NOT attisdropped;
      EXECUTE format('REVOKE SELECT (%s), INSERT (%s), UPDATE (%s), REFERENCES (%s) ON public.%I FROM PUBLIC, anon, authenticated',column_names,column_names,column_names,column_names,table_name);
      EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role',table_name);
    END IF;
  END LOOP;
END $$;

-- Invalidate tokens that used to live in client-writable JSON.
UPDATE public.users SET
 onboarding=coalesce(onboarding,'{}'::jsonb)-'session_token'-'session_expires_at',
 device_info=coalesce(device_info,'{}'::jsonb)-'session_token'-'sessionToken'-'session_expires_at'-'sessionExpiresAt'
WHERE id LIKE 'moliya_user_tg_%';
DELETE FROM public.users WHERE id LIKE 'exchange_%' OR id LIKE 'req_%';
COMMIT;

-- Expected: all six columns below are false.
SELECT role_name,
 has_table_privilege(role_name,'public.users','SELECT') AS users_read,
 has_any_column_privilege(role_name,'public.users','UPDATE') AS users_write,
 has_any_column_privilege(role_name,'public.users','SELECT') AS users_column_read
FROM (VALUES ('anon'),('authenticated')) AS roles(role_name);
