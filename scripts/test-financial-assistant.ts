import assert from 'node:assert/strict';
import { answerFinancialQuestion, financialInsight, isFinancialQuestion } from '../shared/financialAssistant.js';
import { calculateFinancialMetrics, formatReportForTelegram, generateAiFinancialAdvice } from '../api/_financialReportEngine.js';

const now = new Date('2026-09-26T10:00:00Z');
const transactions = [
  {type:'income',amount:1_000_000,date:'2026-09-10',category:'Ish'},
  {type:'expense',amount:-200_000,date:'2026-09-12',category:'Ovqat <b>'},
  {type:'debt',amount:300_000,date:'2026-09-13',category:'Qarz'},
  {type:'lending',amount:-400_000,date:'2026-09-14',category:'Qarz'},
  {type:'expense',amount:999_000,date:'2026-08-01',category:'Old'}
];
assert.equal(isFinancialQuestion('Taksiga 30 ming'),false);
assert.equal(isFinancialQuestion('income 5000'),false);
assert.equal(isFinancialQuestion('Oyda qancha sarfladim?'),true);
assert.equal(isFinancialQuestion('Сколько я потратил?'),true);
assert.equal(isFinancialQuestion('Шу ой қанча сарфладим?'),true);
const answer=answerFinancialQuestion('Shu oy qancha sarfladim?',transactions,'uz',now)!;
assert.match(answer,/Xarajat: 200 000/);
assert.match(answer,/Olingan qarz: 300 000/);
assert.match(answer,/Berilgan qarz: 400 000/);
assert.match(answer,/Qaydlardagi pul oqimi: 700 000/);
assert.doesNotMatch(answer,/999 000/);
assert.match(answerFinancialQuestion('Any advice?',transactions,'en',now)!,/Ovqat/);
assert.match(answerFinancialQuestion('Bugun qancha?',transactions,'uz',now)!,/qayd topilmadi/);
assert.match(financialInsight([], 'uz',now),/yetarli emas/);
assert.match(financialInsight([{type:'income',amount:100,date:'2026-09-10'}], 'en',now),/not enough data/i);
const metrics=calculateFinancialMetrics(transactions,new Date('2026-09-01'),new Date('2026-09-30'));
const html=formatReportForTelegram({id:'x',userId:'x',userName:'<img>',type:'monthly',periodStart:'',periodEnd:'',periodLabel:'<b>',generatedAt:'',metrics,aiAnalysis:{summary:'<script>',recommendations:['<b>bad</b>'],keyTip:'<i>bad</i>',rawText:''}});
assert.doesNotMatch(html,/<img>|<script>|<b>bad<\/b>|<i>bad<\/i>/);
assert.match(html,/&lt;script&gt;/);
const empty=calculateFinancialMetrics([],new Date('2026-09-01'),new Date('2026-09-30'));
const noData=await generateAiFinancialAdvice('User','monthly','September',empty);
assert.match(noData.summary,/qayd topilmadi/);
console.log('Shared assistant questions, missing data, loan separation, and report escaping passed.');
