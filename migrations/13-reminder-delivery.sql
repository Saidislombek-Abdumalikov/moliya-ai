-- At most one automatic reminder per verified user per Tashkent day.
BEGIN;
CREATE TABLE IF NOT EXISTS public.moliya_reminder_delivery (
 user_id text NOT NULL CHECK (user_id ~ '^moliya_user_tg_[0-9]+$'),
 local_day date NOT NULL,
 claimed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id, local_day)
);
ALTER TABLE public.moliya_reminder_delivery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.moliya_reminder_delivery FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.moliya_reminder_delivery TO service_role;
COMMIT;
