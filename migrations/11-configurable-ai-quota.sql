-- Run AFTER 10 and BEFORE deploying the matching backend/admin.
-- One shared default for the SQL reservation and admin display. Service-role only.
BEGIN;
CREATE OR REPLACE FUNCTION public.moliya_ai_quota(p_user_id text, p_consume boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 j jsonb; ob jsonb; dev jsonb; proof jsonb;
 v_now timestamptz; v_used integer := 0; v_limit integer := 20; v_default integer := 20;
 v_premium boolean := false; v_trial boolean := false; v_vip_flag boolean;
 v_allowed boolean; v_expiry timestamptz;
 denied jsonb := '{"allowed":false,"isPremium":false,"isTrial":false,"limit":0,"usedCount":0,"remaining":0,"statusCode":403,"code":"ACCOUNT_NOT_ELIGIBLE"}'::jsonb;
BEGIN
 SELECT CASE
   WHEN (u.onboarding->>'default_ai_quota') ~ '^[0-9]{1,3}$'
     AND (u.onboarding->>'default_ai_quota')::integer BETWEEN 1 AND 500
   THEN (u.onboarding->>'default_ai_quota')::integer ELSE 20 END
 INTO v_default FROM public.users u WHERE u.id='system_app_settings';
 v_default := coalesce(v_default,20);
 -- The lock is held through both the check and increment. Other requests wait.
 SELECT to_jsonb(u) INTO j FROM public.users AS u WHERE u.id=p_user_id FOR UPDATE;
 v_now := clock_timestamp();
 IF j IS NULL OR coalesce(j->>'telegram_id','') !~ '^[0-9]+$'
    OR p_user_id <> 'moliya_user_tg_' || (j->>'telegram_id') THEN RETURN denied; END IF;
 ob:=coalesce(j->'onboarding','{}'); dev:=coalesce(j->'device_info','{}'); proof:=coalesce(j->'bot_verification','{}');
 IF EXISTS (SELECT 1 FROM public.users u WHERE u.id='restricted_tg_' || (j->>'telegram_id')
            AND coalesce(u.onboarding->>'is_blocked','true') <> 'false') THEN RETURN denied; END IF;
 IF 'true' = ANY(ARRAY[j->>'is_blocked',j->>'is_restricted',j->>'is_deleted',
      ob->>'is_blocked',ob->>'is_restricted',ob->>'is_deleted',dev->>'is_blocked',dev->>'restricted'])
      OR j->>'account_status'='deleted' THEN RETURN denied; END IF;
 IF (proof->>'telegram_id' = j->>'telegram_id') IS NOT TRUE
    OR (proof->>'phone'=j->>'phone') IS NOT TRUE
    OR (proof->>'phone' ~ '^\+[1-9][0-9]{7,14}$') IS NOT TRUE
    OR (proof->>'phone_source'='telegram_own_contact') IS NOT TRUE
    OR (proof->>'consent_source'='telegram_button') IS NOT TRUE
    OR coalesce(proof->>'consent_version','')=''
    OR coalesce(proof->>'phone_verified_at','')=''
    OR coalesce(proof->>'consent_accepted_at','')='' THEN RETURN denied; END IF;
 BEGIN
   IF NOT isfinite((proof->>'phone_verified_at')::timestamptz)
      OR NOT isfinite((proof->>'consent_accepted_at')::timestamptz) THEN RETURN denied; END IF;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN denied;
 END;
 IF j->>'ai_blocked'='true' OR ob->>'ai_blocked'='true' THEN
   RETURN denied || '{"code":"AI_BLOCKED"}'::jsonb;
 END IF;

 -- Match _accessHelper.ts: unlimited > active VIP > active trial > custom/default.
 v_vip_flag := coalesce(j->>'is_premium'='true',false) OR coalesce(j->>'is_vip'='true',false);
 IF j->>'unlimited_ai'='true' THEN v_premium:=true; v_limit:=NULL;
 ELSIF v_vip_flag THEN
   IF nullif(j->>'premium_expires_at','') IS NULL THEN v_premium:=true; v_limit:=NULL;
   ELSE
     v_expiry:=(j->>'premium_expires_at')::timestamptz;
     IF v_expiry>v_now THEN v_premium:=true; v_limit:=NULL; END IF;
   END IF;
 ELSIF coalesce(j->>'is_trial','true') <> 'false' AND coalesce(ob->>'is_trial','true') <> 'false'
       AND nullif(j->>'trial_ends_at','') IS NOT NULL THEN
   IF (j->>'trial_ends_at')::timestamptz>v_now THEN v_premium:=true; v_trial:=true; v_limit:=NULL; END IF;
 END IF;
 IF NOT v_premium THEN
   IF (j->>'ai_limit')::integer IN (0,-1) THEN v_limit:=NULL;
   ELSIF (j->>'ai_limit')::integer>0 THEN v_limit:=(j->>'ai_limit')::integer;
   ELSE v_limit:=v_default; END IF;
 END IF;
 IF nullif(j->>'last_ai_query_at','') IS NOT NULL
    AND ((j->>'last_ai_query_at')::timestamptz AT TIME ZONE 'UTC')::date = (v_now AT TIME ZONE 'UTC')::date THEN
   v_used:=greatest(0,coalesce((j->>'ai_query_count')::integer,0));
 END IF;
 v_allowed:=v_limit IS NULL OR v_used<v_limit;
 IF v_allowed AND coalesce(p_consume,false) THEN
   v_used:=v_used+1;
   UPDATE public.users SET ai_query_count=v_used,last_ai_query_at=v_now,updated_at=v_now WHERE id=p_user_id;
 END IF;
 RETURN jsonb_build_object('allowed',v_allowed,'isPremium',v_premium,'isTrial',v_trial,
   'limit',v_limit,'usedCount',v_used,'remaining',CASE WHEN v_limit IS NULL THEN 999 ELSE greatest(0,v_limit-v_used) END,
   'statusCode',CASE WHEN v_allowed THEN 200 ELSE 429 END,'code',CASE WHEN v_allowed THEN 'OK' ELSE 'QUOTA_EXCEEDED' END);
END;
$$;
REVOKE ALL ON FUNCTION public.moliya_ai_quota(text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.moliya_ai_quota(text,boolean) TO service_role;

-- Explicitly reset only positive per-user free overrides. Active VIP/trial and
-- admin unlimited overrides (0/-1) are never changed. Default users already
-- receive the setting immediately and need no row update.
CREATE OR REPLACE FUNCTION public.moliya_reset_free_ai_overrides()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE changed integer;
BEGIN
 UPDATE public.users u SET ai_limit=NULL, updated_at=clock_timestamp()
 WHERE u.id ~ '^moliya_user_tg_[0-9]+$'
   AND u.telegram_id ~ '^[0-9]+$'
   AND u.id='moliya_user_tg_' || u.telegram_id
   AND u.bot_verification->>'telegram_id'=u.telegram_id
   AND u.bot_verification->>'phone'=u.phone
   AND u.bot_verification->>'phone_source'='telegram_own_contact'
   AND u.bot_verification->>'consent_source'='telegram_button'
   AND coalesce(u.is_blocked,false)=false
   AND coalesce(u.is_restricted,false)=false
   AND coalesce(u.is_deleted,false)=false
   AND u.ai_limit > 0
   AND coalesce(u.unlimited_ai,false)=false
   AND NOT (
     (coalesce(u.is_premium,false) OR coalesce(u.is_vip,false))
       AND (u.premium_expires_at IS NULL OR u.premium_expires_at>clock_timestamp())
   )
   AND NOT (
     NOT (coalesce(u.is_premium,false) OR coalesce(u.is_vip,false))
       AND coalesce(u.is_trial,true) AND coalesce(u.onboarding->>'is_trial','true') <> 'false'
       AND coalesce(u.trial_ends_at>clock_timestamp(),false)
   );
 GET DIAGNOSTICS changed = ROW_COUNT;
 RETURN changed;
END;
$$;
REVOKE ALL ON FUNCTION public.moliya_reset_free_ai_overrides() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.moliya_reset_free_ai_overrides() TO service_role;
COMMIT;
