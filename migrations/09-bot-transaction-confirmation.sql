-- After 00–08, before deploying the matching backend. No browser access.
BEGIN;
CREATE TABLE IF NOT EXISTS public.moliya_bot_drafts (
 user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 id text NOT NULL CHECK (id ~ '^[a-f0-9]{32}$'),
 status text NOT NULL CHECK (status IN ('pending','confirmed','cancelled','expired')),
 transactions jsonb NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT (clock_timestamp()+interval '15 minutes'),
 PRIMARY KEY(user_id,id)
);
ALTER TABLE public.moliya_bot_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.moliya_bot_drafts FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.moliya_bot_draft(p_user_id text,p_id text,p_action text,p_payload jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.moliya_bot_drafts%ROWTYPE; result jsonb; item jsonb; idx integer:=0;
BEGIN
 IF p_user_id IS NULL OR p_user_id !~ '^moliya_user_tg_[0-9]+$' OR p_id IS NULL OR p_id !~ '^[a-f0-9]{32}$'
    OR p_action IS NULL OR p_action NOT IN ('stage','confirm','cancel') THEN RETURN '{"status":"invalid"}'; END IF;
 -- Same lock order as all financial writes. It serializes stage/confirm/cancel per user.
 PERFORM 1 FROM public.users WHERE id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RETURN '{"status":"missing"}'; END IF;
 SELECT * INTO d FROM public.moliya_bot_drafts WHERE user_id=p_user_id AND id=p_id FOR UPDATE;
 IF FOUND THEN
   IF d.status='pending' AND d.expires_at<=clock_timestamp() THEN
     UPDATE public.moliya_bot_drafts SET status='expired',transactions='[]' WHERE user_id=p_user_id AND id=p_id;
     RETURN '{"status":"expired"}';
   END IF;
   IF d.status<>'pending' THEN RETURN jsonb_build_object('status',d.status,'replayed',true); END IF;
   IF p_action='stage' THEN RETURN jsonb_build_object('status','pending','transactions',d.transactions); END IF;
   IF p_action='cancel' THEN
     UPDATE public.moliya_bot_drafts SET status='cancelled',transactions='[]' WHERE user_id=p_user_id AND id=p_id;
     RETURN '{"status":"cancelled"}';
   END IF;
   -- Eligibility, append, and consumption all occur under the same transaction/row lock.
   result:=public.moliya_financial_write(p_user_id,'append_transactions',d.transactions,NULL);
   IF (result->>'success') IS DISTINCT FROM 'true' THEN RETURN jsonb_build_object('status','denied'); END IF;
   UPDATE public.moliya_bot_drafts SET status='confirmed',transactions='[]' WHERE user_id=p_user_id AND id=p_id;
   RETURN jsonb_build_object('status','confirmed','transactions',d.transactions);
 END IF;
 IF p_action<>'stage' THEN RETURN '{"status":"missing"}'; END IF;
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'array' THEN RETURN '{"status":"invalid"}'; END IF;
 IF jsonb_array_length(p_payload)<1 OR jsonb_array_length(p_payload)>10 THEN RETURN '{"status":"invalid"}'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_payload) LOOP
   IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR (item->>'id') IS DISTINCT FROM ('tg_'||p_id||'_'||idx)
      OR jsonb_typeof(item->'amount') IS DISTINCT FROM 'number'
      OR coalesce(item->>'type','') NOT IN ('expense','income','debt','lending') THEN RETURN '{"status":"invalid"}'; END IF;
   IF abs((item->>'amount')::numeric)<=0 OR abs((item->>'amount')::numeric)>1000000000000 THEN RETURN '{"status":"invalid"}'; END IF;
   idx:=idx+1;
 END LOOP;
 -- Reuse the current eligibility rules; an empty append changes no financial records.
 result:=public.moliya_financial_write(p_user_id,'append_transactions','[]',NULL);
 IF (result->>'success') IS DISTINCT FROM 'true' THEN RETURN '{"status":"denied"}'; END IF;
 UPDATE public.moliya_bot_drafts SET status='expired',transactions='[]'
 WHERE user_id=p_user_id AND status='pending' AND expires_at<=clock_timestamp();
 IF (SELECT count(*) FROM public.moliya_bot_drafts WHERE user_id=p_user_id AND status='pending')>=20 THEN RETURN '{"status":"limit"}'; END IF;
 INSERT INTO public.moliya_bot_drafts(user_id,id,status,transactions) VALUES(p_user_id,p_id,'pending',p_payload);
 RETURN jsonb_build_object('status','pending','transactions',p_payload);
END;
$$;
REVOKE ALL ON FUNCTION public.moliya_bot_draft(text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.moliya_bot_draft(text,text,text,jsonb) TO service_role;
COMMIT;
