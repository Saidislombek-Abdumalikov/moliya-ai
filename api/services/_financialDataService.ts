import { safeError } from '../_logger.js';
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
    safeError(`[FinancialDataService] Error fetching data for ${userId}:`, error.message);
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

  const cleanTxs = normalizeBotTransactions(txItems);

  await mutateFinancialData(userId,'append_transactions',cleanTxs);

  return cleanTxs;
}

export function normalizeBotTransactions(txItems: Array<Partial<FinancialTransaction>>): FinancialTransaction[] {
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

  await mutateFinancialData(userId,'delete_transaction',{id:txId});

  return { success: true, deletedTxId: txId };
}

/**
 * Save cards for a specific user.
 */
export async function saveCards(userId: string, cards: FinancialCard[], expectedCards: FinancialCard[]): Promise<FinancialCard[]> {
  if (!userId) throw new Error('userId is required for saveCards');

  await mutateFinancialData(userId,'replace_cards',cards,expectedCards);

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
  if (!/^moliya_user_tg_[0-9]+$/.test(userId)) throw new Error('INVALID_USER_ID');

  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from('users')
    .update({
      transactions: [],
      cards: [],
      updated_at: nowIso
    })
    .eq('id', userId).select('id').maybeSingle();

  if (error) {
    safeError(`[FinancialDataService] Error wiping financial data for ${userId}:`, error.message);
    throw error;
  }

  if(!data) throw new Error('USER_NOT_FOUND');

  return {
    ok: true,
    userId,
    wipedAt: nowIso,
    transactionsCount: 0,
    cardsCount: 0
  };
}

export async function mutateFinancialData(userId:string,action:string,payload:unknown,expected:unknown=null):Promise<void>{
  const {data,error}=await supabase.rpc('moliya_financial_write',{p_user_id:userId,p_action:action,p_payload:payload,p_expected:expected});
  if(error || !data || typeof data.success!=='boolean') throw Object.assign(new Error('FINANCIAL_STORE_UNAVAILABLE'),{statusCode:503});
  if(!data.success) throw Object.assign(new Error(data.code || 'FINANCIAL_WRITE_FAILED'),{statusCode:data.statusCode || 500});
}

// Web callers must use the session-bound entry point, even for an empty token.
// Never fall back to the bot RPC if session verification fails.
export async function mutateSessionFinancialData(userId:string,sessionToken:string,action:string,payload:unknown,expected:unknown=null):Promise<void>{
  if(typeof sessionToken!=='string' || !/^sess_[a-zA-Z0-9_-]{16,128}$/.test(sessionToken))
    throw Object.assign(new Error('INVALID_SESSION'),{statusCode:401});
  const {data,error}=await supabase.rpc('moliya_session_financial_write',{
    p_user_id:userId,p_session_token:sessionToken,p_action:action,p_payload:payload,p_expected:expected
  });
  if(error || !data || typeof data.success!=='boolean') throw Object.assign(new Error('FINANCIAL_STORE_UNAVAILABLE'),{statusCode:503});
  if(!data.success) throw Object.assign(new Error(data.code || 'FINANCIAL_WRITE_FAILED'),{statusCode:data.statusCode || 500});
}

export async function wipeBotFinancialData(userId:string):Promise<void>{
  await mutateFinancialData(userId,'wipe_financial',{});
}
