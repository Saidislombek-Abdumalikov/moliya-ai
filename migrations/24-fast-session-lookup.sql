-- Run before (or after) deploying the matching code; the code falls back to the
-- old two-query lookup while this function is missing.
--
-- Why: every app request looked up the caller with onboarding->>session_token,
-- which had no index (full table scan), then made a second round trip for the
-- restricted_tg_ block row. This adds the index and does both in one call.
BEGIN;
CREATE INDEX IF NOT EXISTS idx_users_session_token
  ON public.users ((onboarding->>'session_token'))
  WHERE id LIKE 'moliya_user_tg_%';

CREATE OR REPLACE FUNCTION public.moliya_session_lookup(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE u public.users%ROWTYPE; r jsonb;
BEGIN
  IF p_session_token IS NULL OR p_session_token !~ '^sess_[a-zA-Z0-9_-]{16,128}$' THEN RETURN NULL; END IF;
  SELECT * INTO u FROM public.users
   WHERE onboarding->>'session_token' = p_session_token AND id LIKE 'moliya_user_tg_%'
   LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('user', NULL); END IF;
  SELECT onboarding INTO r FROM public.users WHERE id = 'restricted_tg_' || u.telegram_id;
  RETURN jsonb_build_object(
    'user', to_jsonb(u),
    -- Same rule as the old JS check: a block row counts unless is_blocked === false.
    'restricted', FOUND AND (r->'is_blocked') IS DISTINCT FROM 'false'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.moliya_session_lookup(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.moliya_session_lookup(text) TO service_role;
COMMIT;
