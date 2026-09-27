import assert from 'node:assert/strict';
import { financialTotals, financialKind } from '../shared/financialTotals.js';
import { calculateFinancialMetrics } from '../api/_financialReportEngine.js';

const date = '2026-09-15T12:00:00.000Z';
const txs = [
  { id: '1', type: 'income', amount: 1000, date },
  { id: '2', type: 'expense', amount: -200, category: 'Ovqat', date },
  { id: '3', type: 'debt', amount: 300, category: 'Qarz', date },
  { id: '4', type: 'lending', amount: -400, category: 'Qarz', date },
  { id: '5', amount: -50, category: 'Yo‘l', date },
  { id: '6', type: 'unsupported', amount: 900, date },
  { id: '7', type: 'expense', amount: 'Infinity', date },
  { id: '8', type: 'expense', amount: 9999, date: '2025-01-01' },
];
const period = txs.filter(tx => tx.date === date);
const totals = financialTotals(period);
assert.deepEqual({ income: totals.income, expense: totals.expense, borrowed: totals.borrowed,
  lent: totals.lent, cashFlow: totals.cashFlow, operatingNet: totals.operatingNet, count: totals.count },
  { income: 1000, expense: 250, borrowed: 300, lent: 400, cashFlow: 650, operatingNet: 750, count: 5 });
assert.equal(totals.categories.Ovqat, 200);
assert.equal(totals.categories.Qarz, undefined);
assert.equal(financialKind({ amount: -10 }), 'expense');
assert.equal(financialKind({ amount: 10 }), 'income');
assert.equal(financialKind({ type: 'other', amount: -10 }), null);

const metrics = calculateFinancialMetrics(txs, new Date('2026-09-15'), new Date('2026-09-16'));
assert.equal(metrics.totalIncome, totals.income);
assert.equal(metrics.totalExpense, totals.expense);
assert.equal(metrics.totalBorrowed, totals.borrowed);
assert.equal(metrics.totalLent, totals.lent);
assert.equal(metrics.netBalance, totals.cashFlow);
assert.equal(metrics.savingsRate, 75);
assert.equal(metrics.transactionCount, 5);
assert.equal(metrics.topCategories.length, 2);
assert.equal(metrics.largestExpenses.length, 2);
console.log('Financial totals and report parity: passed');
