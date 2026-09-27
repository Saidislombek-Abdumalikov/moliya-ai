-- Run after 01-04 before deploying. No financial/user data is modified.
BEGIN;
CREATE TABLE IF NOT EXISTS public.moliya_rate_limits (
 bucket text PRIMARY KEY,
 hits timestamptz[] NOT NULL DEFAULT '{}',
 expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS moliya_rate_limits_expiry ON public.moliya_rate_limits(expires_at);
ALTER TABLE public.moliya_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.moliya_rate_limits FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.moliya_rate_limit(p_bucket text,p_limit integer,p_window_ms integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE stamps timestamptz[]; moment timestamptz; duration interval; n integer; retry integer;
BEGIN
 IF p_bucket IS NULL OR p_bucket !~ '^[a-f0-9]{64}$' OR p_limit IS NULL OR p_limit<1 OR p_limit>1200
    OR p_window_ms IS NULL OR p_window_ms<1000 OR p_window_ms>3600000 THEN RAISE EXCEPTION 'Invalid rate limit arguments'; END IF;
 duration:=p_window_ms*interval '1 millisecond';
 INSERT INTO public.moliya_rate_limits(bucket,expires_at) VALUES(p_bucket,clock_timestamp()+duration)
 ON CONFLICT (bucket) DO UPDATE SET bucket=excluded.bucket RETURNING hits INTO stamps;
 moment:=clock_timestamp();
 SELECT coalesce(array_agg(t ORDER BY t),'{}') INTO stamps FROM unnest(stamps) t WHERE t>moment-duration;
 n:=cardinality(stamps);
 IF n>=p_limit THEN
   retry:=greatest(1,ceil(extract(epoch FROM (stamps[1]+duration-moment)))::integer);
   RETURN jsonb_build_object('allowed',false,'remaining',0,'retryAfterSeconds',retry,'limit',p_limit);
 END IF;
 UPDATE public.moliya_rate_limits SET hits=array_append(stamps,moment),expires_at=moment+duration WHERE bucket=p_bucket;
 -- Bounded opportunistic cleanup; skip rows another limiter request is using.
 DELETE FROM public.moliya_rate_limits WHERE bucket IN
   (SELECT bucket FROM public.moliya_rate_limits WHERE expires_at<moment ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED);
 RETURN jsonb_build_object('allowed',true,'remaining',p_limit-n-1,'retryAfterSeconds',0,'limit',p_limit);
END;
$$;
REVOKE ALL ON FUNCTION public.moliya_rate_limit(text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.moliya_rate_limit(text,integer,integer) TO service_role;
COMMIT;
