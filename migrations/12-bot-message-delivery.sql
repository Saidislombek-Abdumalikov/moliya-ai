-- Run before the matching webhook deploy. Browser roles have no access.
BEGIN;
CREATE TABLE IF NOT EXISTS public.moliya_bot_inbound (
  message_key text PRIMARY KEY CHECK (message_key ~ '^msg:-?[0-9]+:[0-9]+$'),
  state text NOT NULL CHECK (state IN ('processing','done')),
  owner text NOT NULL CHECK (owner ~ '^[a-f0-9]{32}$'),
  lease_until timestamptz NOT NULL,
  completed_at timestamptz,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS moliya_bot_inbound_expiry ON public.moliya_bot_inbound(expires_at);
ALTER TABLE public.moliya_bot_inbound ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.moliya_bot_inbound FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.moliya_bot_message_delivery(p_key text,p_owner text,p_action text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_row public.moliya_bot_inbound%ROWTYPE;
BEGIN
 IF p_key IS NULL OR p_key !~ '^msg:-?[0-9]+:[0-9]+$' OR length(p_key)>90
    OR p_owner IS NULL OR p_owner !~ '^[a-f0-9]{32}$'
    OR p_action NOT IN ('claim','complete') THEN RETURN 'invalid'; END IF;
 IF p_action='complete' THEN
   UPDATE public.moliya_bot_inbound SET state='done',completed_at=clock_timestamp(),
     expires_at=clock_timestamp()+interval '30 days'
   WHERE message_key=p_key AND owner=p_owner AND state='processing';
   IF FOUND THEN RETURN 'done'; END IF;
   RETURN 'lost';
 END IF;
 -- Expired completed rows are disposable; bounded occasional cleanup.
 IF random()<0.01 THEN
   DELETE FROM public.moliya_bot_inbound WHERE message_key IN (
     SELECT message_key FROM public.moliya_bot_inbound
     WHERE expires_at<clock_timestamp() ORDER BY expires_at LIMIT 200
   );
 END IF;
 INSERT INTO public.moliya_bot_inbound(message_key,state,owner,lease_until,expires_at)
 VALUES(p_key,'processing',p_owner,clock_timestamp()+interval '3 minutes',clock_timestamp()+interval '30 days')
 ON CONFLICT DO NOTHING;
 IF FOUND THEN RETURN 'claimed'; END IF;
 SELECT * INTO current_row FROM public.moliya_bot_inbound WHERE message_key=p_key FOR UPDATE;
 IF current_row.state='done' AND current_row.expires_at>clock_timestamp() THEN RETURN 'done'; END IF;
 IF current_row.state='processing' AND current_row.lease_until>clock_timestamp() THEN RETURN 'busy'; END IF;
 UPDATE public.moliya_bot_inbound SET state='processing',owner=p_owner,
   lease_until=clock_timestamp()+interval '3 minutes',completed_at=NULL,
   expires_at=clock_timestamp()+interval '30 days' WHERE message_key=p_key;
 RETURN 'claimed';
END;
$$;
REVOKE ALL ON FUNCTION public.moliya_bot_message_delivery(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.moliya_bot_message_delivery(text,text,text) TO service_role;
COMMIT;
