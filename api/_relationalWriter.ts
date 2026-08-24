import { supabase } from './_supabaseClient.js';

export interface RelationalTransactionRow {
  id: string;
  legacy_id: string | null;
  user_id: string;
  card_id: string | null;
  type: 'expense' | 'income' | 'debt' | 'lending';
  amount: number;
  category: string;
  title: string | null;
  note: string | null;
  debt_who: string | null;
  date: string;
  source: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface RelationalCardRow {
  id: string;
  user_id: string;
  name: string;
  bank: string;
  number_masked: string;
  brand: string;
  color: string;
  initial_balance: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface NormalizationResult<T> {
  success: boolean;
  error?: string;
  data?: T;
}

/**
 * Robust numeric parser supporting various localized currency formats
 * (e.g. 50000, "50 000", "50 000,00", "50,000.00", "50.000,00").
 */
export function parseNumericAmount(val: any): number {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    let str = val.trim().replace(/\s/g, '');
    if (!str) return NaN;
    if (/^\d+,\d{1,2}$/.test(str)) {
      str = str.replace(',', '.');
    } else if (/^\d{1,3}(\.\d{3})*,\d+$/.test(str)) {
      str = str.replace(/\./g, '').replace(',', '.');
    } else if (/^\d{1,3}(,\d{3})*\.\d+$/.test(str)) {
      str = str.replace(/,/g, '');
    } else if (/^\d{1,3}(,\d{3})+$/.test(str)) {
      str = str.replace(/,/g, '');
    } else {
      str = str.replace(/,/g, '');
    }
    return parseFloat(str);
  }
  return NaN;
}

/**
 * Normalizes any transaction payload (Web, APK, Bot, AI, or Legacy)
 * into a strictly validated public.transactions PostgreSQL row.
 */
export function normalizeTransactionForWrite(
  raw: any,
  userId: string,
  source: string = 'web'
): NormalizationResult<RelationalTransactionRow> {
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    return { success: false, error: 'Missing or invalid userId for transaction normalization' };
  }

  if (!raw || typeof raw !== 'object') {
    return { success: false, error: 'Invalid transaction payload: object expected' };
  }

  // 1. Transaction ID preservation
  let id = '';
  if (raw.id !== undefined && raw.id !== null && String(raw.id).trim() !== '') {
    id = String(raw.id).trim();
  } else {
    id = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  const legacyId = raw.legacy_id ? String(raw.legacy_id).trim() : (raw.id ? String(raw.id).trim() : null);

  // 2. Type validation
  const rawType = String(raw.type || '').toLowerCase().trim();
  let type: 'expense' | 'income' | 'debt' | 'lending' = 'expense';
  if (rawType === 'income') {
    type = 'income';
  } else if (rawType === 'debt') {
    type = 'debt';
  } else if (rawType === 'lending') {
    type = 'lending';
  } else if (rawType === 'expense') {
    type = 'expense';
  } else {
    type = 'expense';
  }

  // 3. Amount normalization & validation (enforce CHECK (amount > 0))
  const rawAmountNum = parseNumericAmount(raw.amount);

  if (isNaN(rawAmountNum)) {
    return { success: false, error: `Invalid transaction amount '${raw.amount}': must be a valid number` };
  }

  const positiveAmount = Math.abs(rawAmountNum);
  if (positiveAmount <= 0) {
    return { success: false, error: `Invalid transaction amount ${positiveAmount}: must be strictly greater than 0` };
  }

  // Round to 2 decimal places
  const normalizedAmount = Math.round(positiveAmount * 100) / 100;

  // 4. Card ID normalization (cash, empty string, undefined -> NULL)
  let cardId: string | null = null;
  const rawCardId = raw.cardId !== undefined ? raw.cardId : raw.card_id;
  if (rawCardId !== undefined && rawCardId !== null) {
    const cardStr = String(rawCardId).trim();
    if (cardStr !== '' && cardStr.toLowerCase() !== 'cash' && cardStr.toLowerCase() !== 'undefined' && cardStr.toLowerCase() !== 'null') {
      cardId = cardStr;
    }
  }

  // 5. Category normalization
  const category = (raw.category && String(raw.category).trim()) ? String(raw.category).trim() : 'Boshqa';

  // 6. Note and Title
  const note = (raw.note !== undefined && raw.note !== null) ? String(raw.note).trim() : null;
  const title = (raw.title !== undefined && raw.title !== null && String(raw.title).trim() !== '') ? String(raw.title).trim() : null;

  // 7. Debt metadata
  const debtWho = (raw.debtWho !== undefined && raw.debtWho !== null && String(raw.debtWho).trim() !== '')
    ? String(raw.debtWho).trim()
    : (raw.debt_who !== undefined && raw.debt_who !== null && String(raw.debt_who).trim() !== '')
      ? String(raw.debt_who).trim()
      : null;

  // 8. Date normalization
  let dateIso = '';
  if (raw.date) {
    const d = new Date(raw.date);
    if (!isNaN(d.getTime())) {
      dateIso = d.toISOString();
    }
  }
  if (!dateIso) {
    dateIso = new Date().toISOString();
  }

  // 9. Source, Timestamps, DeletedAt
  const txSource = (raw.source && String(raw.source).trim()) ? String(raw.source).trim() : source;
  const nowIso = new Date().toISOString();
  const createdAt = raw.created_at ? new Date(raw.created_at).toISOString() : nowIso;
  const updatedAt = raw.updated_at ? new Date(raw.updated_at).toISOString() : nowIso;
  const deletedAt = raw.deleted_at ? new Date(raw.deleted_at).toISOString() : null;

  return {
    success: true,
    data: {
      id,
      legacy_id: legacyId,
      user_id: userId.trim(),
      card_id: cardId,
      type,
      amount: normalizedAmount,
      category,
      title,
      note,
      debt_who: debtWho,
      date: dateIso,
      source: txSource,
      created_at: createdAt,
      updated_at: updatedAt,
      deleted_at: deletedAt,
    }
  };
}

/**
 * Normalizes any card payload into a strictly validated public.cards PostgreSQL row.
 */
export function normalizeCardForWrite(
  raw: any,
  userId: string
): NormalizationResult<RelationalCardRow> {
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    return { success: false, error: 'Missing or invalid userId for card normalization' };
  }

  if (!raw || typeof raw !== 'object') {
    return { success: false, error: 'Invalid card payload: object expected' };
  }

  // 1. Card ID preservation
  let id = '';
  if (raw.id !== undefined && raw.id !== null && String(raw.id).trim() !== '') {
    id = String(raw.id).trim();
  } else {
    id = `card_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // 2. Name & Bank
  const name = (raw.name && String(raw.name).trim()) ? String(raw.name).trim() : 'Asosiy karta';
  const bank = (raw.bank && String(raw.bank).trim()) ? String(raw.bank).trim() : 'Bank';

  // 3. Masked number
  let numberMasked = (raw.number_masked || raw.number) ? String(raw.number_masked || raw.number).trim() : '**** 0000';
  if (!numberMasked) numberMasked = '**** 0000';

  // 4. Brand
  const brandRaw = String(raw.brand || 'uzcard').toLowerCase().trim();
  let brand = 'uzcard';
  if (brandRaw.includes('humo')) brand = 'humo';
  else if (brandRaw.includes('visa')) brand = 'visa';
  else if (brandRaw.includes('master')) brand = 'mastercard';
  else brand = 'uzcard';

  // 5. Color
  const color = (raw.color && String(raw.color).trim()) ? String(raw.color).trim() : 'from-purple-600 to-indigo-600';

  // 6. Balance
  const rawBal = raw.initial_balance !== undefined ? raw.initial_balance : raw.balance;
  const initialBalance = parseNumericAmount(rawBal) || 0;

  // 7. is_default
  const isDefault = Boolean(raw.is_default !== undefined ? raw.is_default : raw.isDefault);

  // 8. Timestamps
  const nowIso = new Date().toISOString();
  const createdAt = raw.created_at ? new Date(raw.created_at).toISOString() : nowIso;
  const updatedAt = raw.updated_at ? new Date(raw.updated_at).toISOString() : nowIso;

  return {
    success: true,
    data: {
      id,
      user_id: userId.trim(),
      name,
      bank,
      number_masked: numberMasked,
      brand,
      color,
      initial_balance: Math.round(initialBalance * 100) / 100,
      is_default: isDefault,
      created_at: createdAt,
      updated_at: updatedAt,
    }
  };
}

/**
 * Server/Bot Helper: Atomic upsert of a transaction to public.transactions.
 */
export async function writeTransactionRelational(
  raw: any,
  userId: string,
  source: string = 'server'
): Promise<{ success: boolean; data?: RelationalTransactionRow; error?: string }> {
  const norm = normalizeTransactionForWrite(raw, userId, source);
  if (!norm.success || !norm.data) {
    return { success: false, error: norm.error };
  }

  try {
    const { data, error } = await supabase
      .from('transactions')
      .upsert(norm.data, { onConflict: 'id' })
      .select()
      .single();

    if (error) {
      console.error('[RELATIONAL_WRITER] Transaction write error:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (err: any) {
    console.error('[RELATIONAL_WRITER] Exception during transaction write:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Server/Bot Helper: Delete or soft-delete a transaction from public.transactions.
 */
export async function deleteTransactionRelational(
  txId: string,
  userId: string,
  softDelete: boolean = false
): Promise<{ success: boolean; error?: string }> {
  if (!txId || !userId) {
    return { success: false, error: 'Missing txId or userId for transaction deletion' };
  }

  try {
    if (softDelete) {
      const { error } = await supabase
        .from('transactions')
        .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', txId)
        .eq('user_id', userId);

      if (error) return { success: false, error: error.message };
    } else {
      const { error } = await supabase
        .from('transactions')
        .delete()
        .eq('id', txId)
        .eq('user_id', userId);

      if (error) return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Server/Bot Helper: Upsert a card to public.cards.
 */
export async function writeCardRelational(
  raw: any,
  userId: string
): Promise<{ success: boolean; data?: RelationalCardRow; error?: string }> {
  const norm = normalizeCardForWrite(raw, userId);
  if (!norm.success || !norm.data) {
    return { success: false, error: norm.error };
  }

  try {
    const { data, error } = await supabase
      .from('cards')
      .upsert(norm.data, { onConflict: 'id' })
      .select()
      .single();

    if (error) {
      console.error('[RELATIONAL_WRITER] Card write error:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (err: any) {
    console.error('[RELATIONAL_WRITER] Exception during card write:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Server/Bot Helper: Delete a card from public.cards.
 */
export async function deleteCardRelational(
  cardId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  if (!cardId || !userId) {
    return { success: false, error: 'Missing cardId or userId for card deletion' };
  }

  try {
    const { error } = await supabase
      .from('cards')
      .delete()
      .eq('id', cardId)
      .eq('user_id', userId);

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Server/Bot Helper: Idempotent offline synchronization.
 */
export async function syncOfflineDataRelational(
  userId: string,
  localTxs: any[] = [],
  localCards: any[] = [],
  deletedTxIds: string[] = [],
  source: string = 'web'
): Promise<{
  success: boolean;
  syncedTxs: number;
  syncedCards: number;
  deletedTxs: number;
  error?: string;
}> {
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    return { success: false, syncedTxs: 0, syncedCards: 0, deletedTxs: 0, error: 'Missing userId' };
  }

  let syncedTxs = 0;
  let syncedCards = 0;
  let deletedTxs = 0;

  try {
    // 1. Process pending deletions first
    if (Array.isArray(deletedTxIds) && deletedTxIds.length > 0) {
      for (const delId of deletedTxIds) {
        if (delId && typeof delId === 'string') {
          const { error } = await supabase
            .from('transactions')
            .delete()
            .eq('id', delId)
            .eq('user_id', userId);
          if (!error) deletedTxs++;
        }
      }
    }

    // 2. Upsert offline transactions
    if (Array.isArray(localTxs) && localTxs.length > 0) {
      for (const tx of localTxs) {
        if (deletedTxIds.includes(String(tx.id))) continue;
        const norm = normalizeTransactionForWrite(tx, userId, source);
        if (norm.success && norm.data) {
          const { error } = await supabase
            .from('transactions')
            .upsert(norm.data, { onConflict: 'id' });
          if (!error) syncedTxs++;
        }
      }
    }

    // 3. Upsert offline cards
    if (Array.isArray(localCards) && localCards.length > 0) {
      for (const card of localCards) {
        const norm = normalizeCardForWrite(card, userId);
        if (norm.success && norm.data) {
          const { error } = await supabase
            .from('cards')
            .upsert(norm.data, { onConflict: 'id' });
          if (!error) syncedCards++;
        }
      }
    }

    return { success: true, syncedTxs, syncedCards, deletedTxs };
  } catch (err: any) {
    console.error('[SYNC_OFFLINE_RELATIONAL] Error during offline sync:', err.message);
    return { success: false, syncedTxs, syncedCards, deletedTxs, error: err.message };
  }
}

/**
 * Server/Bot Helper: Clear only financial data from relational tables (transactions & cards).
 */
export async function clearUserFinancialDataRelational(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  if (!userId) return { success: false, error: 'Missing userId' };

  try {
    const { error: tErr } = await supabase
      .from('transactions')
      .delete()
      .eq('user_id', userId);

    if (tErr) {
      console.error('[CLEAR_FINANCIAL_RELATIONAL] Transactions delete error:', tErr.message);
      return { success: false, error: tErr.message };
    }

    const { error: cErr } = await supabase
      .from('cards')
      .delete()
      .eq('user_id', userId);

    if (cErr) {
      console.error('[CLEAR_FINANCIAL_RELATIONAL] Cards delete error:', cErr.message);
      return { success: false, error: cErr.message };
    }

    return { success: true };
  } catch (err: any) {
    console.error('[CLEAR_FINANCIAL_RELATIONAL] Exception during clear:', err.message);
    return { success: false, error: err.message };
  }
}
