// Financial amounts are unsigned magnitudes; the transaction type controls cash flow.
// A legacy record without a type may use its signed amount. Unknown types are ignored.
export type FinancialKind = 'income' | 'expense' | 'debt' | 'lending';
export type FinancialRecord = { type?: unknown; amount?: unknown; category?: unknown };

export function financialKind(tx: FinancialRecord): FinancialKind | null {
  const type = typeof tx?.type === 'string' ? tx.type.toLowerCase().trim() : '';
  if (type === 'income' || type === 'expense' || type === 'debt' || type === 'lending') return type;
  if (type) return null;
  const amount = Number(tx?.amount);
  return Number.isFinite(amount) && amount !== 0 ? (amount > 0 ? 'income' : 'expense') : null;
}

export function financialAmount(tx: FinancialRecord): number {
  const raw = tx?.amount;
  if (raw === null || raw === undefined || raw === '' || typeof raw === 'boolean') return 0;
  const amount = Number(raw);
  return Number.isFinite(amount) ? Math.abs(amount) : 0;
}

export function financialTotals(records: readonly FinancialRecord[]) {
  let income = 0, expense = 0, borrowed = 0, lent = 0, count = 0;
  let incomeCount = 0, expenseCount = 0;
  const categories: Record<string, number> = Object.create(null);
  for (const tx of records) {
    const type = financialKind(tx);
    const amount = financialAmount(tx);
    if (!type || !amount) continue;
    count++;
    if (type === 'income') { income += amount; incomeCount++; }
    if (type === 'expense') {
      expense += amount; expenseCount++;
      const category = typeof tx.category === 'string' && tx.category.trim() ? tx.category.trim() : 'Boshqa';
      categories[category] = (categories[category] || 0) + amount;
    }
    if (type === 'debt') borrowed += amount;
    if (type === 'lending') lent += amount;
  }
  return { income, expense, borrowed, lent, count, incomeCount, expenseCount,
    operatingNet: income - expense, cashFlow: income + borrowed - expense - lent, categories };
}
