-- Daily unresolved payment reminders; one advance reminder per occurrence.
BEGIN;
CREATE TABLE IF NOT EXISTS public.moliya_planned_delivery (
 user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE CHECK(user_id ~ '^moliya_user_tg_[0-9]+$'),
 plan_id text NOT NULL,
 due_date date NOT NULL,
 delivery_day date NOT NULL,
 kind text NOT NULL CHECK(kind IN ('early','due')),
 status text NOT NULL DEFAULT 'claimed',
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,plan_id,due_date,delivery_day,kind)
);
ALTER TABLE public.moliya_planned_delivery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.moliya_planned_delivery FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.moliya_planned_delivery TO service_role;
COMMIT;
