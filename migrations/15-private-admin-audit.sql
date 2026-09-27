-- Admin audit entries contain user identifiers and action details.
-- Only authenticated server endpoints may read or append them.
BEGIN;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_audit_log FROM PUBLIC, anon, authenticated;

-- Existing projects may have separate column grants that survive table REVOKE.
DO $$
DECLARE cols text; seq text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ') INTO cols
  FROM pg_attribute
  WHERE attrelid='public.admin_audit_log'::regclass AND attnum>0 AND NOT attisdropped;
  EXECUTE 'REVOKE SELECT ('||cols||'), INSERT ('||cols||'), UPDATE ('||cols||'), REFERENCES ('||cols||') ON public.admin_audit_log FROM PUBLIC, anon, authenticated';

  seq := pg_get_serial_sequence('public.admin_audit_log', 'id');
  IF seq IS NOT NULL THEN
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', seq);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO service_role', seq);
  END IF;
END $$;

GRANT SELECT, INSERT ON public.admin_audit_log TO service_role;
COMMIT;
