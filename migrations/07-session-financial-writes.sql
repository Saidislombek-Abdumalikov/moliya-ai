-- Run after migrations 01–06, before deploying this backend.
-- Browser requests use this entry point. Bot calls retain the service-only
-- moliya_financial_write function; request data must never select that path.
BEGIN;
CREATE OR REPLACE FUNCTION public.moliya_session_financial_write(
 p_user_id text, p_session_token text, p_action text,
 p_payload jsonb, p_expected jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 ob jsonb; expiry timestamptz;
 invalid jsonb := '{"success":false,"statusCode":401,"code":"INVALID_SESSION"}';
 expired jsonb := '{"success":false,"statusCode":401,"code":"SESSION_EXPIRED"}';
BEGIN
 IF p_session_token IS NULL OR p_session_token !~ '^sess_[a-zA-Z0-9_-]{16,128}$' THEN RETURN invalid; END IF;
 -- Logout/new login update this same row. Keep the lock through mutation.
 SELECT onboarding INTO ob FROM public.users WHERE id=p_user_id FOR UPDATE;
 IF NOT FOUND OR (ob->>'session_token'=p_session_token) IS NOT TRUE THEN RETURN invalid; END IF;
 BEGIN
   expiry := nullif(ob->>'session_expires_at','')::timestamptz;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN expired;
 END;
 -- clock_timestamp is evaluated AFTER obtaining the lock, not at transaction start.
 IF expiry IS NULL OR NOT isfinite(expiry) OR expiry <= clock_timestamp() THEN RETURN expired; END IF;
 RETURN public.moliya_financial_write(p_user_id,p_action,p_payload,p_expected);
END;
$$;
REVOKE ALL ON FUNCTION public.moliya_session_financial_write(text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.moliya_session_financial_write(text,text,text,jsonb,jsonb) TO service_role;
COMMIT;
