-- Notification reads/writes use authenticated backend routes, never browser Supabase.
BEGIN;
CREATE TABLE IF NOT EXISTS public.app_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 title text NOT NULL, message text NOT NULL, target text NOT NULL DEFAULT 'all',
 image_url text, action_url text, is_pinned boolean NOT NULL DEFAULT false,
 priority text NOT NULL DEFAULT 'normal',is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_notifications ADD COLUMN IF NOT EXISTS target text;
ALTER TABLE public.app_notifications ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.app_notifications ADD COLUMN IF NOT EXISTS action_url text;
ALTER TABLE public.app_notifications ADD COLUMN IF NOT EXISTS is_pinned boolean DEFAULT false;
ALTER TABLE public.app_notifications ADD COLUMN IF NOT EXISTS priority text DEFAULT 'normal';
ALTER TABLE public.app_notifications ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
-- Preserve legacy audiences when upgrading an older notification schema.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_notifications' AND column_name='target_audience') THEN
   EXECUTE $sql$UPDATE public.app_notifications SET target=coalesce(nullif(target_audience,''),'all') WHERE target IS NULL$sql$;
 END IF;
END $$;
UPDATE public.app_notifications SET target='all' WHERE target IS NULL;
ALTER TABLE public.app_notifications ALTER COLUMN target SET DEFAULT 'all';
ALTER TABLE public.app_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_notifications FROM PUBLIC,anon,authenticated;
-- Table revocation alone does not remove legacy column-level grants.
DO $$ DECLARE cols text; BEGIN
 SELECT string_agg(quote_ident(attname),',') INTO cols FROM pg_attribute
 WHERE attrelid='public.app_notifications'::regclass AND attnum>0 AND NOT attisdropped;
 EXECUTE 'REVOKE SELECT ('||cols||'), INSERT ('||cols||'), UPDATE ('||cols||'), REFERENCES ('||cols||') ON public.app_notifications FROM PUBLIC, anon, authenticated';
END $$;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.app_notifications TO service_role;
CREATE INDEX IF NOT EXISTS app_notifications_target_created_idx ON public.app_notifications(target,created_at DESC) WHERE is_active=true;
COMMIT;
