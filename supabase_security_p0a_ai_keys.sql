-- ============================================================
-- MOLIYA AI — STAGE P0-A: LOCK DOWN GEMINI ai_keys
-- Run this in the Supabase SQL Editor (Dashboard -> SQL Editor)
-- ============================================================

-- 1. Ensure Row Level Security (RLS) is enabled on public.ai_keys
ALTER TABLE public.ai_keys ENABLE ROW LEVEL SECURITY;

-- 2. Drop any permissive policies that allow anonymous or public access
DROP POLICY IF EXISTS "Allow all on ai_keys" ON public.ai_keys;
DROP POLICY IF EXISTS "Public read ai_keys" ON public.ai_keys;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.ai_keys;
DROP POLICY IF EXISTS "Enable all access for all users" ON public.ai_keys;

-- 3. Revoke all table permissions from anon and authenticated public roles
REVOKE ALL ON TABLE public.ai_keys FROM anon;
REVOKE ALL ON TABLE public.ai_keys FROM authenticated;

-- 4. Explicitly grant full permissions ONLY to service_role and postgres
GRANT ALL ON TABLE public.ai_keys TO service_role;
GRANT ALL ON TABLE public.ai_keys TO postgres;

-- 5. Remove ai_keys from Supabase Realtime publication to prevent realtime websocket leakage
DO  BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE public.ai_keys;
EXCEPTION WHEN OTHERS THEN NULL;
END ;

-- 6. Verification: Check that NO permissive policies exist for anon
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename = 'ai_keys';
