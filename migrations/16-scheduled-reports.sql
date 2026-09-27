-- Server-owned switches for weekly and monthly scheduled financial reports.
-- Run after 14-automation-controls.sql.
BEGIN;
ALTER TABLE public.moliya_automation_rules DROP CONSTRAINT IF EXISTS moliya_automation_rules_rule_id_check;
ALTER TABLE public.moliya_automation_rules ADD CONSTRAINT moliya_automation_rules_rule_id_check
  CHECK (rule_id IN ('daily_reminder','quota_exhausted','trial_expiry','weekly_digest',
                    'scheduled_weekly_report','scheduled_monthly_report'));
INSERT INTO public.moliya_automation_rules(rule_id, enabled)
VALUES ('scheduled_weekly_report', false), ('scheduled_monthly_report', false)
ON CONFLICT (rule_id) DO NOTHING;
COMMIT;
