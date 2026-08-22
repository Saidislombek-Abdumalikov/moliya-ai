-- ====================================================================
-- MOLIYA V2 - PHASE 4: ROW LEVEL SECURITY & IDENTITY POLICIES
-- ====================================================================

-- 1. Enable Row Level Security across all public tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_otps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_exchange_codes ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing policies if already defined to allow idempotent re-runs
DROP POLICY IF EXISTS "Users can read and update own profile" ON public.users;
DROP POLICY IF EXISTS "Users can manage own cards" ON public.cards;
DROP POLICY IF EXISTS "Users can manage own transactions" ON public.transactions;

-- 3. Public Users Table Policy
-- Authenticated users can read and update their own user row via auth_user_id
CREATE POLICY "Users can read and update own profile" ON public.users
FOR ALL
USING (auth_user_id = auth.uid())
WITH CHECK (auth_user_id = auth.uid());

-- 4. Cards Table Policy
-- Authenticated users can manage cards belonging to their user account
CREATE POLICY "Users can manage own cards" ON public.cards
FOR ALL
USING (
    user_id IN (
        SELECT id FROM public.users WHERE auth_user_id = auth.uid()
    )
)
WITH CHECK (
    user_id IN (
        SELECT id FROM public.users WHERE auth_user_id = auth.uid()
    )
);

-- 5. Transactions Table Policy
-- Authenticated users can manage transactions belonging to their user account
CREATE POLICY "Users can manage own transactions" ON public.transactions
FOR ALL
USING (
    user_id IN (
        SELECT id FROM public.users WHERE auth_user_id = auth.uid()
    )
)
WITH CHECK (
    user_id IN (
        SELECT id FROM public.users WHERE auth_user_id = auth.uid()
    )
);

-- 6. Auth Tables Policy: Only service_role (which bypasses RLS) can manage OTPs and exchange codes.
-- Anon and authenticated clients have 0 direct access.
