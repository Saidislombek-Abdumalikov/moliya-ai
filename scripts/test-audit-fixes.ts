import assert from 'node:assert/strict';
import { explicitAmount, transactionParts } from '../shared/amountEvidence.js';
import { transactionDay, tashkentDay } from '../shared/reminderPolicy.js';
import { localTransactionDate } from '../shared/transactionDate.js';
import { localDay } from '../shared/debts.js';
import { prepareAssistantReply } from '../api/_assistantReply.js';
import { parseAssistant } from '../api/_assistantParser.js';
import { calculateFinancialMetrics } from '../api/_financialReportEngine.js';

// 1. Non-money quantities & times must not poison explicitAmount()
assert.equal(explicitAmount('3 kishi 60 ming obed'), 60000);
assert.equal(explicitAmount('soat 14 da 30 ming taksi'), 30000);
assert.equal(explicitAmount('2 porsiya osh 70 ming'), 70000);
assert.equal(explicitAmount('15-sana 165 ming wifi'), 165000);
assert.equal(transactionParts('25000 odam keldi'), null);

// 2. prepareAssistantReply: numeric equivalence, combined single-event meals, zero-card fallback
const base = {
  kind: 'expense', category: 'Oziq-ovqat', currency: 'UZS', date: '2026-10-08',
  time: null, account: 'cash', group: 'lunch', amount: 25000, title: 'Somsa + Choy', amountEvidence: ''
};
const combinedMeal = prepareAssistantReply({ actions: [base] }, 'uz', false, '20 ming somsa va 5 ming choy', []);
assert.equal(combinedMeal.actions.length, 1);
assert.equal(combinedMeal.actions[0].amount, 25000);

const eqEvidence = prepareAssistantReply(
  { actions: [{ ...base, amount: 50000, amountEvidence: '50 ming' }] },
  'uz', false, 'taksiga 50k', []
);
assert.equal(eqEvidence.actions.length, 1);
assert.equal(eqEvidence.actions[0].amount, 50000);

const zeroCard = prepareAssistantReply(
  { actions: [{ ...base, account: 'card:unknown' }] },
  'uz', false, 'kartadan 25 ming somsa', []
);
assert.equal(zeroCard.actions[0].cardId, 'cash');
assert.equal(zeroCard.question, '');

// 3. Fast local Turbo path inside parseAssistant()
const fast = await parseAssistant(
  { text: 'taksiga 30 ming' },
  { id: 'moliya_user_tg_123', language: 'uz', cards: [], transactions: [], onboarding: {} }
);
assert.equal(fast.actions.length, 1);
assert.equal(fast.actions[0].amount, 30000);
assert.equal(fast.actions[0].category, 'Transport');

// 4. Date & timezone helpers
assert.match(localDay(new Date('2026-10-23T10:00:00Z')), /^\d{4}-\d{2}-\d{2}$/);
assert.equal(transactionDay('2026-10-07T21:30'), '2026-10-07');
assert.equal(transactionDay('2026-09-27T20:30:00Z'), '2026-09-28');
assert.equal(localTransactionDate('2026-10-07'), '2026-10-07T12:00');
assert.equal(localTransactionDate('2026-10-07', '2026-10-07T09:15'), '2026-10-07T09:15');
assert.equal(localTransactionDate('2026-10-06', '2026-10-07T09:15'), '2026-10-06T00:00');

// 5. Boundary-day inclusion in calculateFinancialMetrics()
const metrics = calculateFinancialMetrics(
  [
    { id: '1', type: 'expense', amount: -50000, category: 'Transport', date: '2026-09-30T12:00' },
    { id: '2', type: 'expense', amount: -30000, category: 'Ovqat', date: '2026-09-30T22:15' }
  ],
  new Date('2026-09-01'),
  new Date('2026-09-30')
);
assert.equal(metrics.totalExpense, 80000);
console.log('All audit fix assertions passed.');
