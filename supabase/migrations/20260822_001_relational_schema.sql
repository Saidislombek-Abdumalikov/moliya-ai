-- ====================================================================
-- MOLIYA V2 — RELATIONAL SCHEMA MIGRATION (PHASE 3 / PHASE 5)
-- Description: Provision normalized relational tables, foreign keys,
-- indexes, and hardened atomic backfill function with strict permissions.
-- ====================================================================

-- 1. Add auth_user_id column to public.users for Supabase Auth UUID linkage
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_auth_user_id ON public.users(auth_user_id);

-- 2. Provision normalized public.cards table
CREATE TABLE IF NOT EXISTS public.cards (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    bank TEXT NOT NULL,
    number_masked TEXT NOT NULL,
    brand VARCHAR(20) NOT NULL,
    color TEXT NOT NULL,
    initial_balance NUMERIC(15, 2) NOT NULL DEFAULT 0,
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cards_user_id ON public.cards(user_id);

-- 3. Provision normalized public.transactions table
CREATE TABLE IF NOT EXISTS public.transactions (
    id TEXT PRIMARY KEY,
    legacy_id TEXT,
    user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    card_id TEXT REFERENCES public.cards(id) ON DELETE SET NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('expense', 'income', 'debt', 'lending')),
    amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
    category TEXT NOT NULL,
    title TEXT,
    note TEXT,
    debt_who TEXT,
    date TIMESTAMPTZ NOT NULL,
    source VARCHAR(20) NOT NULL DEFAULT 'web',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_txs_user_date ON public.transactions(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_txs_user_category ON public.transactions(user_id, category);
CREATE INDEX IF NOT EXISTS idx_txs_card_id ON public.transactions(card_id);
CREATE INDEX IF NOT EXISTS idx_txs_active ON public.transactions(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_txs_legacy_id ON public.transactions(legacy_id);

-- 4. Provision dedicated public.auth_otps table
CREATE TABLE IF NOT EXISTS public.auth_otps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_id TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    attempt_count INT NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_otps_lookup ON public.auth_otps(telegram_id, expires_at);

-- 5. Provision dedicated public.auth_exchange_codes table
CREATE TABLE IF NOT EXISTS public.auth_exchange_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id TEXT NOT NULL UNIQUE,
    telegram_id TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exchange_req ON public.auth_exchange_codes(request_id, status);

-- 6. Provision hardened atomic backfill RPC function (Strict Fail-Closed Transaction)
CREATE OR REPLACE FUNCTION public.migrate_legacy_snapshot(
    p_cards JSONB,
    p_transactions JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_card JSONB;
    v_tx JSONB;
    v_inserted_cards INT := 0;
    v_inserted_txs INT := 0;
    v_user_exists BOOLEAN;
    v_card_exists BOOLEAN;
BEGIN
    -- 1. Insert Cards (Fail-closed on any error or constraint violation)
    IF p_cards IS NOT NULL AND jsonb_array_length(p_cards) > 0 THEN
        FOR v_card IN SELECT * FROM jsonb_array_elements(p_cards)
        LOOP
            -- Foreign key pre-check
            SELECT EXISTS (SELECT 1 FROM public.users WHERE id = v_card->>'user_id') INTO v_user_exists;
            IF NOT v_user_exists THEN
                RAISE EXCEPTION 'Foreign key violation: user_id % does not exist', v_card->>'user_id';
            END IF;

            IF NOT EXISTS (SELECT 1 FROM public.cards WHERE id = v_card->>'id') THEN
                INSERT INTO public.cards (
                    id, user_id, name, bank, number_masked, brand, color, initial_balance, is_default, created_at, updated_at
                ) VALUES (
                    v_card->>'id',
                    v_card->>'user_id',
                    v_card->>'name',
                    v_card->>'bank',
                    v_card->>'number_masked',
                    v_card->>'brand',
                    v_card->>'color',
                    (v_card->>'initial_balance')::NUMERIC(15,2),
                    (v_card->>'is_default')::BOOLEAN,
                    (v_card->>'created_at')::TIMESTAMPTZ,
                    (v_card->>'updated_at')::TIMESTAMPTZ
                );
                v_inserted_cards := v_inserted_cards + 1;
            END IF;
        END LOOP;
    END IF;

    -- 2. Insert Transactions (Fail-closed on any error or constraint violation)
    IF p_transactions IS NOT NULL AND jsonb_array_length(p_transactions) > 0 THEN
        FOR v_tx IN SELECT * FROM jsonb_array_elements(p_transactions)
        LOOP
            -- Foreign key pre-check: user_id
            SELECT EXISTS (SELECT 1 FROM public.users WHERE id = v_tx->>'user_id') INTO v_user_exists;
            IF NOT v_user_exists THEN
                RAISE EXCEPTION 'Foreign key violation: user_id % does not exist', v_tx->>'user_id';
            END IF;

            -- Foreign key pre-check: card_id (if present and not null)
            IF v_tx->>'card_id' IS NOT NULL AND v_tx->>'card_id' <> '' THEN
                SELECT EXISTS (SELECT 1 FROM public.cards WHERE id = v_tx->>'card_id') INTO v_card_exists;
                IF NOT v_card_exists THEN
                    RAISE EXCEPTION 'Foreign key violation: card_id % does not exist', v_tx->>'card_id';
                END IF;
            END IF;

            IF NOT EXISTS (SELECT 1 FROM public.transactions WHERE id = v_tx->>'id') THEN
                INSERT INTO public.transactions (
                    id, legacy_id, user_id, card_id, type, amount, category, title, note, debt_who, date, source, created_at, updated_at, deleted_at
                ) VALUES (
                    v_tx->>'id',
                    v_tx->>'legacy_id',
                    v_tx->>'user_id',
                    NULLIF(v_tx->>'card_id', ''),
                    v_tx->>'type',
                    (v_tx->>'amount')::NUMERIC(15,2),
                    v_tx->>'category',
                    v_tx->>'title',
                    v_tx->>'note',
                    v_tx->>'debt_who',
                    (v_tx->>'date')::TIMESTAMPTZ,
                    COALESCE(v_tx->>'source', 'web'),
                    (v_tx->>'created_at')::TIMESTAMPTZ,
                    (v_tx->>'updated_at')::TIMESTAMPTZ,
                    NULLIF(v_tx->>'deleted_at', '')::TIMESTAMPTZ
                );
                v_inserted_txs := v_inserted_txs + 1;
            END IF;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'inserted_cards', v_inserted_cards,
        'inserted_transactions', v_inserted_txs
    );
EXCEPTION
    WHEN OTHERS THEN
        -- Automatic PostgreSQL rollback of all inserts in this transaction
        RAISE EXCEPTION 'Atomic migration rollback: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
END;
$$;

-- 7. Secure RPC Function Permissions (Revoke Public/Anon/Authenticated; Grant Service Role Only)
REVOKE ALL ON FUNCTION public.migrate_legacy_snapshot(JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.migrate_legacy_snapshot(JSONB, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.migrate_legacy_snapshot(JSONB, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.migrate_legacy_snapshot(JSONB, JSONB) TO service_role;
