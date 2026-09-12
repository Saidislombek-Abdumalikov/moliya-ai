import { supabase } from '../_supabaseClient.js';

export interface FinancialTransaction {
  id: string;
  type: string;
  amount: number;
  category?: string;
  note?: string;
  title?: string;
  cardId?: string;
  date?: string;
  day?: number;
  month?: number;
  year?: number;
  time?: string;
  debtWho?: string;
  counterparty?: string | null;
  description?: string;
  name?: string;
}

export interface FinancialCard {
  id: string;
  name: string;
  number?: string;
  balance?: number;
  currency?: string;
  color?: string;
  isDefault?: boolean;
}

/**
 * Fetch all financial records (transactions and cards) for a specific user.
 * Scoped strictly by userId.
 */
export async function getUserFinancialData(userId: string): Promise<{ transactions: FinancialTransaction[]; cards: FinancialCard[] }> {
  if (!userId) throw new Error('userId is required for getUserFinancialData');

  const { data, error } = await supabase
    .from('users')
    .select('transactions, cards')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error(`[FinancialDataService] Error fetching data for ${userId}:`, error.message);
    throw error;
  }

  return {
    transactions: Array.isArray(data?.transactions) ? data.transactions : [],
    cards: Array.isArray(data?.cards) ? data.cards : []
  };
}

/**
 * Save one or more transactions for a specific user.
 * Prepends new transactions and prevents duplicates by transaction ID.
 */
export async function saveTransactions(
  userId: string,
  txItems: Array<Partial<FinancialTransaction>>
): Promise<FinancialTransaction[]> {
  if (!userId) throw new Error('userId is required for saveTransactions');
  if (!txItems || txItems.length === 0) return [];

  const { data: user, error: fetchErr } = await supabase
    .from('users')
    .select('transactions')
    .eq('id', userId)
    .maybeSingle();

  if (fetchErr) {
    console.error(`[FinancialDataService] Error fetching existing txs for ${userId}:`, fetchErr.message);
    throw fetchErr;
  }

  const currentTxs = Array.isArray(user?.transactions) ? user.transactions : [];
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');

  const cleanTxs: FinancialTransaction[] = txItems.map((txItem, idx) => {
    const finalDate = txItem.date || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const finalDay = txItem.day || now.getDate();
    const finalMonth = txItem.month || (now.getMonth() + 1);
    const finalYear = txItem.year || now.getFullYear();
    const finalTime = txItem.time || `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const txId = txItem.id || `tx_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`;

    const rawAmt = Math.abs(Number(txItem.amount) || 0);
    const isIncome = txItem.type === 'income';
    const signedAmount = isIncome ? rawAmt : -rawAmt;

    return {
      id: txId,
      type: txItem.type || 'expense',
      amount: signedAmount,
      category: txItem.category || 'Boshqa',
      note: txItem.note || txItem.description || txItem.name || txItem.title || txItem.category || '',
      title: txItem.title || txItem.description || txItem.name || txItem.note || '',
      cardId: txItem.cardId || 'cash',
      date: finalDate,
      day: finalDay,
      month: finalMonth,
      year: finalYear,
      time: finalTime,
      debtWho: txItem.debtWho || txItem.counterparty || ''
    };
  });

  const newTxIds = new Set(cleanTxs.map(t => String(t.id)));
  const updated = [...cleanTxs, ...currentTxs.filter((t: any) => !newTxIds.has(String(t.id)))];

  const { error: updateErr } = await supabase
    .from('users')
    .update({ transactions: updated, updated_at: new Date().toISOString() })
    .eq('id', userId);

  if (updateErr) {
    console.error(`[FinancialDataService] Error saving txs for ${userId}:`, updateErr.message);
    throw updateErr;
  }

  return cleanTxs;
}

/**
 * Save a single transaction for a specific user.
 */
export async function saveTransaction(
  userId: string,
  txItem: Partial<FinancialTransaction>
): Promise<FinancialTransaction | null> {
  const saved = await saveTransactions(userId, [txItem]);
  return saved[0] || null;
}

/**
 * Delete a single transaction by ID for a specific user.
 * Scoped strictly to userId — cannot affect other users' transactions.
 */
export async function deleteTransaction(userId: string, txId: string): Promise<{ success: boolean; deletedTxId: string }> {
  if (!userId) throw new Error('userId is required for deleteTransaction');
  if (!txId) throw new Error('txId is required for deleteTransaction');

  const { data: u, error: fetchErr } = await supabase
    .from('users')
    .select('transactions')
    .eq('id', userId)
    .maybeSingle();

  if (fetchErr) {
    console.error(`[FinancialDataService] Error fetching txs for delete on ${userId}:`, fetchErr.message);
    throw fetchErr;
  }

  const txs = Array.isArray(u?.transactions) ? u.transactions : [];
  const updated = txs.filter((t: any) => String(t.id) !== String(txId));

  const { error: updateErr } = await supabase
    .from('users')
    .update({ transactions: updated, updated_at: new Date().toISOString() })
    .eq('id', userId);

  if (updateErr) {
    console.error(`[FinancialDataService] Error deleting tx ${txId} for ${userId}:`, updateErr.message);
    throw updateErr;
  }

  return { success: true, deletedTxId: txId };
}

/**
 * Save cards for a specific user.
 */
export async function saveCards(userId: string, cards: FinancialCard[]): Promise<FinancialCard[]> {
  if (!userId) throw new Error('userId is required for saveCards');

  const { error } = await supabase
    .from('users')
    .update({ cards, updated_at: new Date().toISOString() })
    .eq('id', userId);

  if (error) {
    console.error(`[FinancialDataService] Error saving cards for ${userId}:`, error.message);
    throw error;
  }

  return cards;
}

/**
 * WIPE FINANCIAL DATA ONLY.
 * 
 * STRICT BOUNDARY:
 * - Wipes ONLY `transactions: []` and `cards: []`.
 * - Strictly scoped to `userId`.
 * - NEVER deletes or alters:
 *   - User account root row
 *   - Phone number
 *   - Telegram identity (telegram_id, telegram handle)
 *   - Premium status (is_premium, premium_expires_at)
 *   - AI query counts / quota (ai_query_count, ai_limit)
 *   - Telegram bot message history (onboarding.bot_messages)
 *   - Account block status (is_blocked)
 *   - Other users' data
 */
export async function wipeFinancialData(userId: string): Promise<{
  ok: boolean;
  userId: string;
  wipedAt: string;
  transactionsCount: number;
  cardsCount: number;
}> {
  if (!userId) throw new Error('userId is required for wipeFinancialData');

  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .from('users')
    .update({
      transactions: [],
      cards: [],
      updated_at: nowIso
    })
    .eq('id', userId);

  if (error) {
    console.error(`[FinancialDataService] Error wiping financial data for ${userId}:`, error.message);
    throw error;
  }

  return {
    ok: true,
    userId,
    wipedAt: nowIso,
    transactionsCount: 0,
    cardsCount: 0
  };
}
