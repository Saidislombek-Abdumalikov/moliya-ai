import assert from 'node:assert/strict';
import {voiceAmountsAgree,withVoiceProgress} from '../api/_voiceEvidence.js';
import {normalizeUzbekFinancialText,validateAiFinancialOutput} from '../api/_uzbekFinancialNormalizer.js';
for(const [a,b,result] of [
 ["10 so'm taksiga","o'n so'm taksiga",true],
 ["10 so'm taksiga",'15 ming taksiga',false],
 ['taksiga 10 ming','taksiga 15 ming',false],
 ['taksiga 10 ming',"taksiga 10 so'm",false],
 ['100 dollar qarz oldim',"100 so'm qarz oldim",false],
 ['taksiga 10 yoki 15 ming','taksiga 10 ming',false],
 ['taksiga 10 ming','',false]
] as const)assert.equal(voiceAmountsAgree(a,b),result,a);
const ten=validateAiFinancialOutput({type:'expense',amount:10,category:'Transport'},normalizeUzbekFinancialText("10 so'm taksiga"));
assert.equal(ten.isValid,true);assert.equal(ten.amount,10);
let updates=0,finished=false;
await withVoiceProgress(async()=>{await new Promise(r=>setTimeout(r,35));return 1},async()=>{assert.equal(finished,false);updates++;return true},5);
finished=true;const count=updates;await new Promise(r=>setTimeout(r,20));assert.equal(updates,count);assert.ok(count>0);
let blocked=0;
await withVoiceProgress(async()=>{await new Promise(r=>setTimeout(r,25))},async()=>{blocked++;return false},5);
assert.equal(blocked,1);
console.log('Voice: exact 10 som, spoken numbers, mismatched amount/currency/uncertainty and progress stop/backoff passed. No real audio/provider calls.');
