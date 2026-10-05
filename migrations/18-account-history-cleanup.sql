-- Run after migrations 01–17, before deploying this package.
-- Deletes ONLY history owned by the account. Shared announcements and admin audit remain.
BEGIN;
CREATE OR REPLACE FUNCTION public.moliya_cleanup_deleted_account()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tbl text;
BEGIN
 IF OLD.id !~ '^moliya_user_tg_[0-9]+$' THEN RETURN OLD; END IF;
 IF to_regclass('public.app_notifications') IS NOT NULL THEN
  DELETE FROM public.app_notifications WHERE target=OLD.id;
 END IF;
 FOREACH tbl IN ARRAY ARRAY['moliya_reminder_delivery','moliya_automation_delivery'] LOOP
  IF to_regclass('public.'||tbl) IS NOT NULL THEN
   EXECUTE format('DELETE FROM public.%I WHERE user_id=$1',tbl) USING OLD.id;
  END IF;
 END LOOP;
 -- Drafts and debt deliveries already have ON DELETE CASCADE.
 -- Login/exchange rows have the verified Telegram identity; never match cachedUserId.
 DELETE FROM public.users WHERE telegram_id=OLD.telegram_id
   AND (id LIKE 'req\_%' ESCAPE '\' OR id LIKE 'exchange\_%' ESCAPE '\');
 -- Keep inbound replay guards until their normal expiry: deleting them could replay an old expense.
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.moliya_cleanup_deleted_account() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS moliya_deleted_account_history ON public.users;
CREATE TRIGGER moliya_deleted_account_history AFTER DELETE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.moliya_cleanup_deleted_account();
COMMIT;
