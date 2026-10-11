import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {debtBalances, debtRemaining} from '../shared/debts.js';
import {financialTotals} from '../shared/financialTotals.js';

// Exercise the actual context write path with controlled network/cache failures.
const source=fs.readFileSync(new URL('../src/FinanceContext.tsx',import.meta.url),'utf8');
const start=source.indexOf('  const writeFinancial =');
assert.ok(start>0);
const fn=source.slice(start,source.indexOf('  const saveCards =',start));
const code=ts.transpileModule(fn+'\nreturn writeFinancial;', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
let token='session-a', records:any[]=[{id:'one',type:'expense',amount:-24000},{id:'two',type:'income',amount:50000}];
let response:any={ok:true}, syncs=0;
const scope={readSessionToken:()=>token,fetchWithTimeout:async()=>response,getClientAuthHeaders:()=>({}),refreshSequence:{current:0},setCustomTransactions:(updater:any)=>{records=updater(records);},localStorage:{setItem(){throw Error('storage full');}},refreshUserData:()=>{syncs++;return new Promise(()=>{});}};
const write=new Function(...Object.keys(scope),code)(...Object.values(scope));
const completed=await Promise.race([write('delete_transaction',{id:'one'}).then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),100))]);
assert.equal(completed,true,'Committed deletion must not wait for a slow background refresh');
assert.deepEqual(records.map(t=>t.id),['two']);
assert.equal(syncs,1);
await write('put_transaction',{id:'two',type:'income',amount:75000});
assert.equal(records.length,1,'Editing replaces the existing row, without duplicating it');
assert.equal(records[0].amount,75000,'A full browser cache must not turn committed save into a failure');

const errorScope={...scope,refreshUserData:async()=>{}};
const failingWrite=new Function(...Object.keys(errorScope),code)(...Object.values(errorScope));
response={ok:false,status:409,json:async()=>({error:'DEBT_HAS_PAYMENTS'})};
await assert.rejects(failingWrite('delete_transaction',{id:'two'}),/qaytarish yozuvlari/);
assert.equal(records.length,1,'Failed deletion leaves the record visible');
response={ok:false,status:400,json:async()=>({error:'USE_DEBT_ACTION'})};
await assert.rejects(failingWrite('put_transaction',{id:'two'}),/Qarz \/ Haqqim/);

const staleScope={...scope,fetchWithTimeout:async()=>{token='session-b';return {ok:true};}};
const staleWrite=new Function(...Object.keys(staleScope),code)(...Object.values(staleScope));
await assert.rejects(staleWrite('delete_transaction',{id:'two'}),/Sessiya/);
assert.equal(records.length,1,'A response from an old session cannot change the new session');

const debtRecords:any[]=[];
for(let i=0;i<500;i++)debtRecords.push({id:String(i),type:i%2?'debt':'lending',amount:100000.5},{id:'p'+i,type:i%2?'expense':'income',amount:25000.25,debtPaymentFor:String(i)});
const balances=debtBalances(debtRecords);
for(const debt of debtRecords.filter(t=>t.type==='debt'||t.type==='lending'))assert.equal(balances.get(debt.id),debtRemaining(debt,debtRecords));
assert.equal(financialTotals(debtRecords).expense,0,'Debt repayments are not spending categories');

const profile=fs.readFileSync(new URL('../src/components/ProfileScreen.tsx',import.meta.url),'utf8');
const csvStart=profile.indexOf('  const formatCsvField =');
const csvCode=ts.transpileModule(profile.slice(csvStart,profile.indexOf('\n  // Handle report',csvStart))+'\nreturn formatCsvField;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const csv=new Function(csvCode)();
assert.equal(csv('Somsa'),'Somsa');
assert.equal(csv('a,"b"'),'"a,""b"""');
for(const text of ['=1+1',' +1','@SUM(A1:A2)','-1+2','\tformula'])assert.ok(csv(text).startsWith("'"));
console.log('App audit: confirmed save/delete, slow sync, full cache, failed deletion, stale session, 500 loan balances and CSV safety passed. No live services called.');
