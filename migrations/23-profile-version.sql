-- Run BEFORE deploying the matching code. Safe for the currently deployed code:
-- it only adds a column and a trigger that old code never reads.
--
-- Why: optimistic profile writes compared the whole onboarding JSON inside the
-- request URL. As onboarding grows, that URL exceeds gateway limits and every
-- save/login for that user fails. A small counter replaces the JSON comparison.
BEGIN;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS profile_version bigint NOT NULL DEFAULT 0;

-- Bumps only when one of the JSON columns that writes used to compare changes,
-- so conflict detection stays exactly as strict as before (no new conflicts
-- from unrelated columns such as transactions or cards).
CREATE OR REPLACE FUNCTION public.moliya_bump_profile_version()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  NEW.profile_version := OLD.profile_version + 1;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.moliya_bump_profile_version() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS trg_users_profile_version ON public.users;
CREATE TRIGGER trg_users_profile_version
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  WHEN (OLD.onboarding IS DISTINCT FROM NEW.onboarding
     OR OLD.device_info IS DISTINCT FROM NEW.device_info
     OR OLD.bot_verification IS DISTINCT FROM NEW.bot_verification)
  EXECUTE FUNCTION public.moliya_bump_profile_version();
COMMIT;

-- Check: SELECT id, profile_version FROM public.users LIMIT 5;
