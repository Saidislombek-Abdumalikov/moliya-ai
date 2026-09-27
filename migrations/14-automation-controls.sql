-- Server-owned switch for automatic daily reminders. Admin UI cannot alter cron
-- by writing to browser storage; only the service role may read or write it.
BEGIN;
CREATE TABLE IF NOT EXISTS public.moliya_automation_rules (
  rule_id text PRIMARY KEY CHECK (rule_id IN ('daily_reminder','quota_exhausted','trial_expiry','weekly_digest')),
  enabled boolean NOT NULL DEFAULT true,
  enabled_slots text[] NOT NULL DEFAULT ARRAY['morning','afternoon','evening']::text[]
    CHECK (enabled_slots <@ ARRAY['morning','afternoon','evening']::text[] AND cardinality(enabled_slots) <= 3),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.moliya_automation_rules ADD COLUMN IF NOT EXISTS enabled_slots text[]
  NOT NULL DEFAULT ARRAY['morning','afternoon','evening']::text[];
ALTER TABLE public.moliya_automation_rules DROP CONSTRAINT IF EXISTS moliya_automation_rules_rule_id_check;
ALTER TABLE public.moliya_automation_rules ADD CONSTRAINT moliya_automation_rules_rule_id_check
  CHECK (rule_id IN ('daily_reminder','quota_exhausted','trial_expiry','weekly_digest'));
INSERT INTO public.moliya_automation_rules(rule_id, enabled)
VALUES ('daily_reminder', true), ('quota_exhausted', true),
       ('trial_expiry', true), ('weekly_digest', false)
ON CONFLICT (rule_id) DO NOTHING;
CREATE TABLE IF NOT EXISTS public.moliya_automation_delivery (
  user_id text NOT NULL CHECK (user_id ~ '^moliya_user_tg_[0-9]+$'),
  rule_id text NOT NULL CHECK (rule_id IN ('quota_exhausted','trial_expiry','weekly_digest')),
  occurrence text NOT NULL CHECK (length(occurrence) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, rule_id, occurrence)
);
ALTER TABLE public.moliya_automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moliya_automation_delivery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.moliya_automation_rules FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.moliya_automation_delivery FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON public.moliya_automation_rules TO service_role;
GRANT SELECT, INSERT, DELETE ON public.moliya_automation_delivery TO service_role;
COMMIT;
