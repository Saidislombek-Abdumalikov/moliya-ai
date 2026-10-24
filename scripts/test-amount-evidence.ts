import assert from 'node:assert/strict';
import {explicitAmount,amountParts,transactionParts,isShortTransaction} from '../shared/amountEvidence.js';
import {parseTurboFinancialText,normalizeUzbekFinancialText,validateAiFinancialOutput} from '../api/_uzbekFinancialNormalizer.js';
let count=0;
for(const [text,expected] of [
 ['taksiga 30 ming',30000],['50k bozorlik',50000],['maosh 14 mln',14000000],['25 000 so‘m non',25000],['taksi 25000',25000],['ellik ming taksi',50000],['ikki yuz ming bozor',200000],['2.5 mln maosh',2500000],['2 yarim mln maosh',2500000],['1mln 250 ming maosh',1250000],['2026-09-24 taksiga 30 ming',30000],['soat 12:30 taksiga 30000',30000],['2 ta non 10000 so‘m',10000],['telefon $100',100],
 ['taksiga pul berdim',null],['taksi 30 yoki 50 ming',null],['taksi 20-30 ming',null],['taxminan 50 ming',null],['iPhone 15 oldim',null],['2026-09-24 uchrashuv',null],['12:30 uchrashuv',null],['2 ta non oldim',null],['telefon +998901234567',null],['taksi 30',null],['50.000 taksi',null],['taksi 50000 ovqat 30000',null],['chegirma 10%',null],['maosh Infinity',null],['2026 yil rejalari',null],['telefon raqamim 901234567',null],['MacBook 2026 oldim',null],['iPhone 15 uchun 10 mln',10000000]
] as const){assert.equal(explicitAmount(text),expected,text);count++}
assert.equal(amountParts('50k taksi va 100k bozor')?.length,2);count++;
assert.equal(amountParts('50k taksi va bozorlik'),null);count++;
assert.equal(parseTurboFinancialText('50k taksi va bozorlik'),null);count++;
assert.equal(parseTurboFinancialText('ellik ming taksi')?.transactions[0].amount,50000);count++;
for(const source of ['taksiga pul berdim','20 yoki 50 ming taksi','2 ta non oldim']){
 const result=validateAiFinancialOutput({amount:999999,note:'taksiga 999999 so‘m'},normalizeUzbekFinancialText(source));assert.equal(result.isValid,false,source);assert.equal(result.amount,0);count++;
}
const result=validateAiFinancialOutput({amount:99999999,note:'taxminiy summa'},normalizeUzbekFinancialText('taksi 30 ming'));assert.equal(result.amount,30000);count++;
assert.equal(parseTurboFinancialText('balansim qancha?')?.intent,'query_finances');count++;
// Intent must be grounded in the user's source, not AI-generated descriptions.
const nonTransactions=[
 '25000 odam keldi','taksi 30000 odam','taksi 30 ming turadi',
 'taksiga 30 ming sarflamadim','ertaga taksiga 30 ming sarflayman',
 'taksiga 30 ming sarfladimmi','taksiga 30 ming sarfladim?',
 'agar 30 ming sarfladim desam','50 ming kerak','50 ming',
 'taksiga 30 ming va 25000 odam keldi','maosh 14 mln emas',
 'taksiga 30 ming to‘lamadim','internet 50 ming narxi'
];
for(const source of nonTransactions){
 assert.equal(transactionParts(source),null,source);
 assert.notEqual(parseTurboFinancialText(source)?.intent,'record_transaction',source);
 assert.equal(validateAiFinancialOutput({amount:30000,note:'taksiga sarfladim'},normalizeUzbekFinancialText(source)).isValid,false,source);count++;
}
for(const source of ['taksiga 30 ming','maosh 14 mln','50k bozorlik','taksiga 30 ming sarfladim','50k taksi va 100k bozor']){
 assert.ok(transactionParts(source),source);count++;
}
const longSource='bugun ishga borish uchun taksiga 30 ming sarfladim';
assert.ok(transactionParts(longSource));assert.equal(isShortTransaction(longSource),false);
assert.equal(parseTurboFinancialText(longSource),null);count++;
assert.equal(validateAiFinancialOutput({amount:30000,needs_clarification:true},normalizeUzbekFinancialText('taksi 30 ming')).isValid,false);count++;
assert.equal(validateAiFinancialOutput({amount:30000,intent:'general_question'},normalizeUzbekFinancialText('taksi 30 ming')).isValid,false);count++;
for(const source of ['Akmalga 50 ming berdim','50 ming oldim']){
 assert.equal(parseTurboFinancialText(source),null,source);
 assert.equal(validateAiFinancialOutput({type:'lending',amount:50000,category:"Do'st"},normalizeUzbekFinancialText(source)).isValid,false,source);
 count++;
}
assert.equal(parseTurboFinancialText('qarz oldim 50 ming')?.transactions[0].type,'debt');count++;
assert.equal(parseTurboFinancialText('qarz berdim 50 ming')?.transactions[0].type,'lending');count++;
assert.equal(parseTurboFinancialText('taksiga 30 ming maosh oldim'),null);count++;
assert.equal(validateAiFinancialOutput({type:'expense',amount:30000},normalizeUzbekFinancialText('taksiga 30 ming maosh oldim')).isValid,false);count++;
assert.equal(validateAiFinancialOutput({type:'income',amount:30000},normalizeUzbekFinancialText('taksiga 30 ming')).isValid,false);count++;
// Long voice transcriptions reach AI; the spoken transaction type still takes precedence.
const spokenExpense='bugun ishga borish uchun taksiga 30 ming sarfladim';
assert.equal(parseTurboFinancialText(spokenExpense),null);
assert.equal(validateAiFinancialOutput({type:'income',amount:30000,category:'Maosh'},normalizeUzbekFinancialText(spokenExpense)).isValid,false);count++;
assert.equal(validateAiFinancialOutput({type:'expense',amount:30000,category:'Maosh'},normalizeUzbekFinancialText(spokenExpense)).category,'Transport');count++;
assert.equal(validateAiFinancialOutput({amount:30000},normalizeUzbekFinancialText('30 ming sarfladim')).isValid,false);count++;
assert.equal(validateAiFinancialOutput({type:'expense',amount:30000,category:'Maosh'},normalizeUzbekFinancialText('taksiga 30 ming')).category,'Transport');count++;
assert.equal(parseTurboFinancialText('suv 50 ming'),null);count++;
assert.equal(validateAiFinancialOutput({type:'expense',amount:50000,category:'Kommunal'},normalizeUzbekFinancialText('suv 50 ming')).isValid,false);count++;
assert.equal(parseTurboFinancialText('suv 50 ming sarfladim')?.transactions[0].category,'Boshqa');count++;
assert.equal(validateAiFinancialOutput({type:'expense',amount:50000,category:'Kommunal'},normalizeUzbekFinancialText('suv 50 ming sarfladim')).category,'Boshqa');count++;
// Exercise the real authenticated endpoint. Missing evidence must not call quota/provider.
process.env.SUPABASE_URL='http://127.0.0.1:54321';process.env.SUPABASE_SERVICE_ROLE_KEY='offline';
const {supabase}=await import('../api/_supabaseClient.js');
const {default:handler}=await import('../api/parse-expense.js');
const token='sess_'+'a'.repeat(48);let quotaCalls=0,networkCalls=0;
globalThis.fetch=async()=>{networkCalls++;throw new Error('NETWORK_FORBIDDEN')};
(supabase as any).rpc=async()=>{quotaCalls++;return {data:{allowed:true},error:null}};
(supabase as any).from=()=>{let restricted=false;const q:any={select(){return q},eq(k:string,v:any){if(k==='id'&&String(v).startsWith('restricted_'))restricted=true;return q},like(){return q},async maybeSingle(){return {error:null,data:restricted?null:{id:'moliya_user_tg_123',telegram_id:'123',phone:'+998901234567',onboarding:{session_token:token,session_expires_at:'2099-01-01'},bot_verification:{telegram_id:'123',phone:'+998901234567',phone_source:'telegram_own_contact',phone_verified_at:'2026-01-01',consent_source:'telegram_button',consent_version:'1',consent_accepted_at:'2026-01-01'}}}}};return q};
for(const text of ['taksiga pul berdim','taksi 30 yoki 50 ming','50k taksi va bozorlik','2026-09-24','x'.repeat(1001)+' 50 ming',...nonTransactions]){
 const req:any={method:'POST',body:{text},headers:{authorization:'Bearer '+token},socket:{remoteAddress:'127.0.0.1'}};
 const res:any={statusCode:200,setHeader(){},status(n:number){this.statusCode=n;return this},json(v:any){this.body=v;return this}};
 await handler(req,res);assert.equal(res.statusCode,422,text);assert.equal(res.body.needs_clarification,true);assert.equal(res.body.amount,undefined);count++;
}
assert.equal(quotaCalls,0);assert.equal(networkCalls,0);
console.log(`${count} source amount checks passed. No network or AI calls.`);
