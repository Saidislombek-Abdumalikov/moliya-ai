import { supabase } from '../api/_supabaseClient.js';

// ============================================================================
// 1. DATA TYPES & FIELD DEFINITIONS
// ============================================================================

export interface ExpectedTransaction {
  id: string;
  legacy_id: string;
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

export interface ExpectedCard {
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

export interface ValidationIssue {
  userId: string;
  recordType: 'card' | 'transaction';
  recordId: string;
  field: string;
  issue: string;
  rawValue: any;
}

export interface PreflightAuditResult {
  canProceedToPhaseB: boolean;
  totalUsersAudited: number;
  totalLegacyCards: number;
  totalLegacyTransactions: number;
  validationIssues: ValidationIssue[];
  cardsToInsert: ExpectedCard[];
  cardsAlreadyVerified: ExpectedCard[];
  cardConflicts: { expected: ExpectedCard; actual: any; differences: string[] }[];
  txsToInsert: ExpectedTransaction[];
  txsAlreadyVerified: ExpectedTransaction[];
  txConflicts: { expected: ExpectedTransaction; actual: any; differences: string[] }[];
  transformationsCount: number;
  postSnapshotRelationalCards: any[];
  postSnapshotRelationalTxs: any[];
}

export interface BackfillExecutionResult {
  success: boolean;
  atomicExecutionMethod: 'POSTGRES_RPC_TRANSACTION';
  insertedCardsCount: number;
  insertedTxsCount: number;
  alreadyVerifiedCardsCount: number;
  alreadyVerifiedTxsCount: number;
  postReconciliationDiscrepancies: string[];
}

// ============================================================================
// 2. DETERMINISTIC EXPECTED DATA BUILDERS (CANONICAL TIMESTAMP POLICY)
// ============================================================================

export function calculateExpectedCards(userId: string, legacyCards: any[], userCreatedAt?: string): ExpectedCard[] {
  const fallbackEpoch = userCreatedAt && !isNaN(new Date(userCreatedAt).getTime())
    ? new Date(userCreatedAt).toISOString()
    : '2026-08-22T00:00:00.000Z';

  return legacyCards.map((c: any) => {
    const cardId = String(c.id || '').trim();
    const createdAt = c.created_at || c.createdAt
      ? new Date(c.created_at || c.createdAt).toISOString()
      : fallbackEpoch;
    const updatedAt = c.updated_at || c.updatedAt
      ? new Date(c.updated_at || c.updatedAt).toISOString()
      : createdAt;

    return {
      id: cardId,
      user_id: userId,
      name: String(c.name || '').trim(),
      bank: String(c.bank || '').trim(),
      number_masked: String(c.number_masked || c.number || '').trim(),
      brand: String(c.brand || 'uzcard').trim(),
      color: String(c.color || 'from-blue-600 to-indigo-600').trim(),
      initial_balance: Number(c.initial_balance !== undefined ? c.initial_balance : c.balance) || 0,
      is_default: Boolean(c.isDefault),
      created_at: createdAt,
      updated_at: updatedAt
    };
  });
}

export function calculateExpectedTransactions(userId: string, legacyTxs: any[]): { expected: ExpectedTransaction[]; transformedCount: number } {
  const seenTxIds = new Map<string, number>();
  const expectedList: ExpectedTransaction[] = [];
  let transformedCount = 0;

  for (const t of legacyTxs) {
    const origId = String(t.id || '').trim();
    const count = (seenTxIds.get(origId) || 0) + 1;
    seenTxIds.set(origId, count);

    // Rule 3: Deterministic suffixing for duplicate IDs
    const targetId = count > 1 ? `${origId}_${count}` : origId;
    const rawAmt = Number(t.amount);
    
    // Rule 1: Positive absolute amount for expenses
    const transformedAmount = Math.abs(rawAmt);
    
    // Rule 2: Cash -> NULL card_id
    const cardRef = t.cardId || t.card_id;
    const transformedCardId = cardRef === 'cash' ? null : (cardRef || null);

    if (rawAmt < 0 || cardRef === 'cash' || count > 1 || t.title) {
      transformedCount++;
    }

    // Canonical Timestamp: UTC Instant ISO format
    const txDateIso = t.date && !isNaN(new Date(t.date).getTime())
      ? new Date(t.date).toISOString()
      : '2026-08-22T00:00:00.000Z';

    const createdAt = t.created_at || t.createdAt
      ? new Date(t.created_at || t.createdAt).toISOString()
      : txDateIso;

    const updatedAt = t.updated_at || t.updatedAt
      ? new Date(t.updated_at || t.updatedAt).toISOString()
      : createdAt;

    const deletedAt = t.deleted_at || t.deletedAt
      ? new Date(t.deleted_at || t.deletedAt).toISOString()
      : null;

    expectedList.push({
      id: targetId,
      legacy_id: origId,
      user_id: userId,
      card_id: transformedCardId,
      type: t.type,
      amount: transformedAmount,
      category: String(t.category || '').trim(),
      title: t.title ? String(t.title).trim() : null,
      note: t.note !== undefined && t.note !== null ? String(t.note) : null,
      debt_who: t.debtWho || t.debt_who || null,
      date: txDateIso,
      source: String(t.source || 'web').trim(),
      created_at: createdAt,
      updated_at: updatedAt,
      deleted_at: deletedAt
    });
  }

  return { expected: expectedList, transformedCount };
}

// ============================================================================
// 3. RECORD VALIDATORS
// ============================================================================

export function validateLegacyCard(card: any, userId: string): ValidationIssue[] {
  const errs: ValidationIssue[] = [];
  if (!card || typeof card !== 'object') {
    errs.push({ userId, recordType: 'card', recordId: 'UNKNOWN', field: 'card', issue: 'Card is not an object', rawValue: card });
    return errs;
  }
  const id = typeof card.id === 'string' ? card.id.trim() : '';
  if (!id) errs.push({ userId, recordType: 'card', recordId: 'MISSING_ID', field: 'id', issue: 'Missing card id', rawValue: card.id });
  if (typeof card.name !== 'string' || !card.name.trim()) errs.push({ userId, recordType: 'card', recordId: id, field: 'name', issue: 'Missing or empty card name', rawValue: card.name });
  if (typeof card.bank !== 'string' || !card.bank.trim()) errs.push({ userId, recordType: 'card', recordId: id, field: 'bank', issue: 'Missing or empty card bank', rawValue: card.bank });
  const num = card.number_masked || card.number;
  if (typeof num !== 'string' || !num.trim()) errs.push({ userId, recordType: 'card', recordId: id, field: 'number', issue: 'Missing card number/number_masked', rawValue: num });
  if (typeof card.brand !== 'string' || !card.brand.trim() || card.brand.length > 20) errs.push({ userId, recordType: 'card', recordId: id, field: 'brand', issue: 'Invalid or > 20 char brand', rawValue: card.brand });
  if (typeof card.color !== 'string' || !card.color.trim()) errs.push({ userId, recordType: 'card', recordId: id, field: 'color', issue: 'Missing card color', rawValue: card.color });
  const bal = card.initial_balance !== undefined ? card.initial_balance : card.balance;
  const numBal = Number(bal);
  if (typeof bal !== 'number' && typeof bal !== 'string' || isNaN(numBal) || !isFinite(numBal) || numBal < 0 || numBal > 9999999999999.99) {
    errs.push({ userId, recordType: 'card', recordId: id, field: 'balance', issue: 'Card balance must be a finite number between 0 and 9,999,999,999,999.99', rawValue: bal });
  }
  return errs;
}

export function validateLegacyTransaction(tx: any, userId: string, validCardsSet: Set<string>): ValidationIssue[] {
  const errs: ValidationIssue[] = [];
  if (!tx || typeof tx !== 'object') {
    errs.push({ userId, recordType: 'transaction', recordId: 'UNKNOWN', field: 'transaction', issue: 'Transaction is not an object', rawValue: tx });
    return errs;
  }
  const id = typeof tx.id === 'string' ? tx.id.trim() : '';
  if (!id) errs.push({ userId, recordType: 'transaction', recordId: 'MISSING_ID', field: 'id', issue: 'Missing transaction id', rawValue: tx.id });
  if (!['expense', 'income', 'debt', 'lending'].includes(tx.type)) errs.push({ userId, recordType: 'transaction', recordId: id, field: 'type', issue: `Invalid type: ${tx.type}`, rawValue: tx.type });
  const amt = Number(tx.amount);
  if (isNaN(amt) || !isFinite(amt) || amt === 0 || Math.abs(amt) > 9999999999999.99) {
    errs.push({ userId, recordType: 'transaction', recordId: id, field: 'amount', issue: 'Amount is 0, NaN, or exceeds limits', rawValue: tx.amount });
  }
  if (amt < 0 && tx.type !== 'expense') {
    errs.push({ userId, recordType: 'transaction', recordId: id, field: 'amount', issue: 'Negative amount on non-expense transaction', rawValue: tx });
  }
  if (typeof tx.category !== 'string' || !tx.category.trim()) errs.push({ userId, recordType: 'transaction', recordId: id, field: 'category', issue: 'Missing category', rawValue: tx.category });
  if (!tx.date || isNaN(new Date(tx.date).getTime())) errs.push({ userId, recordType: 'transaction', recordId: id, field: 'date', issue: 'Invalid or missing date timestamp', rawValue: tx.date });
  const cardRef = tx.cardId || tx.card_id;
  if (cardRef && cardRef !== 'cash' && !validCardsSet.has(cardRef)) {
    errs.push({ userId, recordType: 'transaction', recordId: id, field: 'cardId', issue: `Orphan card reference: "${cardRef}"`, rawValue: cardRef });
  }
  return errs;
}

// ============================================================================
// 4. FULL-FIELD EQUALITY COMPARATORS
// ============================================================================

export function compareCardFullFields(expected: ExpectedCard, actual: any): string[] {
  const diffs: string[] = [];
  if (actual.id !== expected.id) diffs.push(`id: expected "${expected.id}", got "${actual.id}"`);
  if (actual.user_id !== expected.user_id) diffs.push(`user_id: expected "${expected.user_id}", got "${actual.user_id}"`);
  if (actual.name !== expected.name) diffs.push(`name: expected "${expected.name}", got "${actual.name}"`);
  if (actual.bank !== expected.bank) diffs.push(`bank: expected "${expected.bank}", got "${actual.bank}"`);
  if (actual.number_masked !== expected.number_masked) diffs.push(`number_masked: expected "${expected.number_masked}", got "${actual.number_masked}"`);
  if (actual.brand !== expected.brand) diffs.push(`brand: expected "${expected.brand}", got "${actual.brand}"`);
  if (actual.color !== expected.color) diffs.push(`color: expected "${expected.color}", got "${actual.color}"`);
  if (Math.abs(Number(actual.initial_balance) - expected.initial_balance) > 0.0001) diffs.push(`initial_balance: expected ${expected.initial_balance}, got ${Number(actual.initial_balance)}`);
  if (Boolean(actual.is_default) !== expected.is_default) diffs.push(`is_default: expected ${expected.is_default}, got ${Boolean(actual.is_default)}`);
  return diffs;
}

export function compareTransactionFullFields(expected: ExpectedTransaction, actual: any): string[] {
  const diffs: string[] = [];
  if (actual.id !== expected.id) diffs.push(`id: expected "${expected.id}", got "${actual.id}"`);
  if (actual.legacy_id !== expected.legacy_id) diffs.push(`legacy_id: expected "${expected.legacy_id}", got "${actual.legacy_id}"`);
  if (actual.user_id !== expected.user_id) diffs.push(`user_id: expected "${expected.user_id}", got "${actual.user_id}"`);
  if (actual.type !== expected.type) diffs.push(`type: expected "${expected.type}", got "${actual.type}"`);
  if (Math.abs(Number(actual.amount) - expected.amount) > 0.0001) diffs.push(`amount: expected ${expected.amount}, got ${Number(actual.amount)}`);
  if (actual.category !== expected.category) diffs.push(`category: expected "${expected.category}", got "${actual.category}"`);
  if ((actual.title || null) !== (expected.title || null)) diffs.push(`title: expected "${expected.title}", got "${actual.title}"`);
  if ((actual.note || null) !== (expected.note || null)) diffs.push(`note: expected "${expected.note}", got "${actual.note}"`);
  if ((actual.debt_who || null) !== (expected.debt_who || null)) diffs.push(`debt_who: expected "${expected.debt_who}", got "${actual.debt_who}"`);
  if ((actual.card_id || null) !== (expected.card_id || null)) diffs.push(`card_id: expected "${expected.card_id}", got "${actual.card_id}"`);
  if (new Date(actual.date).toISOString() !== expected.date) diffs.push(`date: expected "${expected.date}", got "${new Date(actual.date).toISOString()}"`);
  if (actual.source !== expected.source) diffs.push(`source: expected "${expected.source}", got "${actual.source}"`);
  return diffs;
}

// ============================================================================
// 5. PHASE A: READ-ONLY PRE-FLIGHT AUDIT & RECONCILIATION
// ============================================================================

export async function runReadOnlyPreflight(providedUsers?: any[]): Promise<PreflightAuditResult> {
  console.log('====================================================');
  console.log('?? PHASE A: READ-ONLY PRE-FLIGHT & CONFLICT AUDIT');
  console.log('====================================================\n');

  let users = providedUsers;
  if (!users) {
    const { data: fetchedUsers, error: fetchErr } = await supabase
      .from('users')
      .select('id, name, telegram_id, transactions, cards, created_at, updated_at');
    if (fetchErr) throw new Error(`Failed to fetch users: ${fetchErr.message}`);
    users = fetchedUsers || [];
  }

  const validationIssues: ValidationIssue[] = [];
  const cardsToInsert: ExpectedCard[] = [];
  const cardsAlreadyVerified: ExpectedCard[] = [];
  const cardConflicts: { expected: ExpectedCard; actual: any; differences: string[] }[] = [];

  const txsToInsert: ExpectedTransaction[] = [];
  const txsAlreadyVerified: ExpectedTransaction[] = [];
  const txConflicts: { expected: ExpectedTransaction; actual: any; differences: string[] }[] = [];

  const postSnapshotRelationalCards: any[] = [];
  const postSnapshotRelationalTxs: any[] = [];

  let totalLegacyCards = 0;
  let totalLegacyTxs = 0;
  let totalTransformations = 0;

  const globalCardIds = new Map<string, string>();
  const globalTxIds = new Map<string, string>();

  // Fetch all existing relational rows across the database for conflict checking
  const { data: allRelCards } = await supabase.from('cards').select('*');
  const { data: allRelTxs } = await supabase.from('transactions').select('*');

  const relCardsById = new Map((allRelCards || []).map(c => [c.id, c]));
  const relTxsById = new Map((allRelTxs || []).map(t => [t.id, t]));

  for (const user of users) {
    const userId = user.id;
    const legacyCards = Array.isArray(user.cards) ? user.cards : [];
    const legacyTxs = Array.isArray(user.transactions) ? user.transactions : [];

    totalLegacyCards += legacyCards.length;
    totalLegacyTxs += legacyTxs.length;

    // 1. Run Preflight Validations
    const userCardIds = new Set<string>();
    for (const card of legacyCards) {
      const errs = validateLegacyCard(card, userId);
      validationIssues.push(...errs);

      if (card?.id) {
        if (userCardIds.has(card.id)) {
          validationIssues.push({ userId, recordType: 'card', recordId: card.id, field: 'id', issue: 'Duplicate card ID within user', rawValue: card.id });
        }
        userCardIds.add(card.id);

        if (globalCardIds.has(card.id) && globalCardIds.get(card.id) !== userId) {
          validationIssues.push({ userId, recordType: 'card', recordId: card.id, field: 'id', issue: `Cross-user card collision with ${globalCardIds.get(card.id)}`, rawValue: card.id });
        }
        globalCardIds.set(card.id, userId);
      }
    }

    const userTxIds = new Set<string>();
    for (const tx of legacyTxs) {
      const errs = validateLegacyTransaction(tx, userId, userCardIds);
      validationIssues.push(...errs);

      if (tx?.id) {
        userTxIds.add(tx.id);
        if (globalTxIds.has(tx.id) && globalTxIds.get(tx.id) !== userId) {
          validationIssues.push({ userId, recordType: 'transaction', recordId: tx.id, field: 'id', issue: `Cross-user transaction collision with ${globalTxIds.get(tx.id)}`, rawValue: tx.id });
        }
        globalTxIds.set(tx.id, userId);
      }
    }

    // 2. Build Expected Transformed Records
    const expectedCards = calculateExpectedCards(userId, legacyCards, user.created_at);
    const { expected: expectedTxs, transformedCount } = calculateExpectedTransactions(userId, legacyTxs);
    totalTransformations += transformedCount;

    // 3. Reconcile Cards Against Existing Relational Database (Conflict Check)
    for (const expCard of expectedCards) {
      if (relCardsById.has(expCard.id)) {
        const actual = relCardsById.get(expCard.id)!;
        const diffs = compareCardFullFields(expCard, actual);
        if (diffs.length === 0) {
          cardsAlreadyVerified.push(expCard);
        } else {
          cardConflicts.push({ expected: expCard, actual, differences: diffs });
        }
      } else {
        cardsToInsert.push(expCard);
      }
    }

    // 4. Reconcile Transactions Against Existing Relational Database (Conflict Check)
    for (const expTx of expectedTxs) {
      if (relTxsById.has(expTx.id)) {
        const actual = relTxsById.get(expTx.id)!;
        const diffs = compareTransactionFullFields(expTx, actual);
        if (diffs.length === 0) {
          txsAlreadyVerified.push(expTx);
        } else {
          txConflicts.push({ expected: expTx, actual, differences: diffs });
        }
      } else {
        txsToInsert.push(expTx);
      }
    }
  }

  // Snapshot boundary: Unmapped relational rows are informational post-snapshot records (non-blocking)
  const allExpectedCardIds = new Set([...cardsToInsert, ...cardsAlreadyVerified].map(c => c.id));
  for (const relCard of allRelCards || []) {
    if (!allExpectedCardIds.has(relCard.id)) {
      postSnapshotRelationalCards.push(relCard);
    }
  }

  const allExpectedTxIds = new Set([...txsToInsert, ...txsAlreadyVerified].map(t => t.id));
  for (const relTx of allRelTxs || []) {
    if (!allExpectedTxIds.has(relTx.id)) {
      postSnapshotRelationalTxs.push(relTx);
    }
  }

  const canProceed =
    validationIssues.length === 0 &&
    cardConflicts.length === 0 &&
    txConflicts.length === 0;

  console.log('----------------------------------------------------');
  console.log(`Users Audited: ${users.length}`);
  console.log(`Legacy Cards: ${totalLegacyCards} | To Insert: ${cardsToInsert.length} | Verified Existing: ${cardsAlreadyVerified.length}`);
  console.log(`Legacy Txs: ${totalLegacyTxs} | To Insert: ${txsToInsert.length} | Verified Existing: ${txsAlreadyVerified.length}`);
  console.log(`Validation Issues: ${validationIssues.length}`);
  console.log(`Card Conflicts: ${cardConflicts.length}`);
  console.log(`Transaction Conflicts: ${txConflicts.length}`);
  console.log(`Transformed Records: ${totalTransformations}`);
  console.log(`Post-Snapshot Independent Cards: ${postSnapshotRelationalCards.length} | Txs: ${postSnapshotRelationalTxs.length}`);
  console.log(`Can Proceed to Phase B: ${canProceed ? 'YES ?' : 'NO ?'}`);

  return {
    canProceedToPhaseB: canProceed,
    totalUsersAudited: users.length,
    totalLegacyCards,
    totalLegacyTransactions: totalLegacyTxs,
    validationIssues,
    cardsToInsert,
    cardsAlreadyVerified,
    cardConflicts,
    txsToInsert,
    txsAlreadyVerified,
    txConflicts,
    transformationsCount: totalTransformations,
    postSnapshotRelationalCards,
    postSnapshotRelationalTxs
  };
}

// ============================================================================
// 6. PHASE B: LIVE WRITE BACKFILL (STRICT POSTGRES ATOMIC TRANSACTION ONLY)
// ============================================================================

export async function executeLiveBackfill(preflight: PreflightAuditResult): Promise<BackfillExecutionResult> {
  console.log('\n====================================================');
  console.log('?? PHASE B: LIVE ATOMIC POSTGRES TRANSACTION WRITE BACKFILL');
  console.log('====================================================\n');

  if (!preflight.canProceedToPhaseB) {
    throw new Error('FAIL-CLOSED: Phase B aborted because Phase A discovered validation issues or conflicts.');
  }

  let insertedCardsCount = 0;
  let insertedTxsCount = 0;
  const postReconciliationDiscrepancies: string[] = [];

  if (preflight.cardsToInsert.length > 0 || preflight.txsToInsert.length > 0) {
    console.log(`Executing atomic PostgreSQL RPC 'migrate_legacy_snapshot' for ${preflight.cardsToInsert.length} cards and ${preflight.txsToInsert.length} transactions...`);

    const { data: rpcData, error: rpcErr } = await (supabase as any).rpc('migrate_legacy_snapshot', {
      p_cards: preflight.cardsToInsert,
      p_transactions: preflight.txsToInsert
    });

    if (rpcErr) {
      throw new Error(`FAIL-CLOSED ATOMIC ABORT: PostgreSQL RPC 'migrate_legacy_snapshot' failed: ${rpcErr.message}. ZERO client-side writes were performed.`);
    }

    if (!rpcData?.success) {
      throw new Error(`FAIL-CLOSED ATOMIC ABORT: PostgreSQL RPC did not return success status. ZERO client-side writes were performed.`);
    }

    insertedCardsCount = rpcData.inserted_cards || 0;
    insertedTxsCount = rpcData.inserted_transactions || 0;
    console.log(`? Atomic PostgreSQL transaction executed successfully (${insertedCardsCount} cards, ${insertedTxsCount} transactions inserted).`);
  }

  // Post-Write Full-Field Reconciliation
  console.log('Running Post-Write Full-Field Reconciliation...');
  const { data: finalRelCards } = await supabase.from('cards').select('*');
  const { data: finalRelTxs } = await supabase.from('transactions').select('*');

  const finalCardsMap = new Map((finalRelCards || []).map(c => [c.id, c]));
  const finalTxsMap = new Map((finalRelTxs || []).map(t => [t.id, t]));

  const allExpectedCards = [...preflight.cardsToInsert, ...preflight.cardsAlreadyVerified];
  for (const expCard of allExpectedCards) {
    const actual = finalCardsMap.get(expCard.id);
    if (!actual) {
      postReconciliationDiscrepancies.push(`Missing card ${expCard.id} in relational table`);
    } else {
      const diffs = compareCardFullFields(expCard, actual);
      if (diffs.length > 0) {
        postReconciliationDiscrepancies.push(`Card ${expCard.id} field discrepancy: ${diffs.join(', ')}`);
      }
    }
  }

  const allExpectedTxs = [...preflight.txsToInsert, ...preflight.txsAlreadyVerified];
  for (const expTx of allExpectedTxs) {
    const actual = finalTxsMap.get(expTx.id);
    if (!actual) {
      postReconciliationDiscrepancies.push(`Missing transaction ${expTx.id} in relational table`);
    } else {
      const diffs = compareTransactionFullFields(expTx, actual);
      if (diffs.length > 0) {
        postReconciliationDiscrepancies.push(`Transaction ${expTx.id} field discrepancy: ${diffs.join(', ')}`);
      }
    }
  }

  const success = postReconciliationDiscrepancies.length === 0;

  console.log('----------------------------------------------------');
  console.log(`Execution Method: POSTGRES_RPC_TRANSACTION`);
  console.log(`Cards Inserted: ${insertedCardsCount} | Verified Existing: ${preflight.cardsAlreadyVerified.length}`);
  console.log(`Transactions Inserted: ${insertedTxsCount} | Verified Existing: ${preflight.txsAlreadyVerified.length}`);
  console.log(`Post-Write Discrepancies: ${postReconciliationDiscrepancies.length}`);
  console.log(`Overall Backfill Status: ${success ? 'PASS ?' : 'FAIL ?'}`);

  return {
    success,
    atomicExecutionMethod: 'POSTGRES_RPC_TRANSACTION',
    insertedCardsCount,
    insertedTxsCount,
    alreadyVerifiedCardsCount: preflight.cardsAlreadyVerified.length,
    alreadyVerifiedTxsCount: preflight.txsAlreadyVerified.length,
    postReconciliationDiscrepancies
  };
}

// CLI Execution Entry Point
if (process.argv[1]?.includes('parity_check')) {
  runReadOnlyPreflight()
    .then(async (preflight) => {
      if (!preflight.canProceedToPhaseB) {
        console.error('Migration aborted during Phase A Preflight.');
        process.exit(1);
      }
      const result = await executeLiveBackfill(preflight);
      if (!result.success) process.exit(1);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fatal Workflow Error:', err);
      process.exit(1);
    });
}
