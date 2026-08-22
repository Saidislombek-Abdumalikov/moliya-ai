import { supabase } from './_supabaseClient.js';

export interface RelationalTransaction {
  id: string;
  type: string;
  amount: number;
  category: string;
  note: string;
  title?: string;
  debtWho?: string;
  date: string;
  cardId: string;
  source?: string;
}

export interface RelationalCard {
  id: string;
  name: string;
  bank: string;
  number: string;
  balance: string;
  brand: string;
  color?: string;
  isDefault?: boolean;
}

/**
 * Reads user transactions from public.transactions (Relational).
 * Falls back to public.users.transactions JSONB if no relational records exist yet.
 */
export async function getUserTransactionsRelational(userId: string): Promise<RelationalTransaction[]> {
  if (!userId) return [];
  try {
    const { data: relTxs, error: tErr } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('date', { ascending: false });

    if (!tErr && Array.isArray(relTxs) && relTxs.length > 0) {
      return relTxs.map(t => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        category: t.category,
        note: t.note || '',
        title: t.title || undefined,
        debtWho: t.debt_who || undefined,
        date: t.date,
        cardId: t.card_id || 'cash',
        source: t.source || 'web'
      }));
    }

    // Fallback to legacy JSONB if relational table returned 0 rows
    const { data: userDoc } = await supabase
      .from('users')
      .select('transactions')
      .eq('id', userId)
      .maybeSingle();

    if (Array.isArray(userDoc?.transactions)) {
      return userDoc.transactions;
    }

    return [];
  } catch (err: any) {
    console.error('[RELATIONAL_READER] Error fetching user transactions:', err.message);
    return [];
  }
}

/**
 * Reads user cards from public.cards (Relational).
 * Falls back to public.users.cards JSONB if no relational records exist yet.
 */
export async function getUserCardsRelational(userId: string): Promise<RelationalCard[]> {
  if (!userId) return [];
  try {
    const { data: relCards, error: cErr } = await supabase
      .from('cards')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (!cErr && Array.isArray(relCards) && relCards.length > 0) {
      return relCards.map(c => ({
        id: c.id,
        name: c.name,
        bank: c.bank,
        number: c.number_masked,
        balance: String(c.initial_balance || 0),
        brand: c.brand || 'uzcard',
        color: c.color,
        isDefault: Boolean(c.is_default)
      }));
    }

    // Fallback to legacy JSONB if relational table returned 0 rows
    const { data: userDoc } = await supabase
      .from('users')
      .select('cards')
      .eq('id', userId)
      .maybeSingle();

    if (Array.isArray(userDoc?.cards)) {
      return userDoc.cards;
    }

    return [];
  } catch (err: any) {
    console.error('[RELATIONAL_READER] Error fetching user cards:', err.message);
    return [];
  }
}
