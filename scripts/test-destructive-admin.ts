import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
process.env.SUPABASE_URL='http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY='offline-test-placeholder';
process.env.TELEGRAM_BOT_TOKEN='offline-test-placeholder';
const {supabase}=await import('../api/_supabaseClient.js');
const {deleteUserAccount}=await import('../api/services/_userAccountService.js');
const {wipeFinancialData}=await import('../api/services/_financialDataService.js');
const db=new PGlite();
await db.exec(`CREATE TABLE users(id text PRIMARY KEY,telegram_id text,onboarding jsonb,device_info jsonb,transactions jsonb,cards jsonb,updated_at timestamptz);`);
const id='moliya_user_tg_123';let conflict=false,fail=false,network=0;
globalThis.fetch=async()=>{network++;throw new Error('NETWORK_FORBIDDEN')};
(supabase as any).from=()=>{
 let mode='read',patch:any=null;const filters:Array<[string,any]>=[];
 const q:any={select(){return q},eq(k:string,v:any){filters.push([k,v]);return q},is(k:string,v:any){filters.push([k,v]);return q},delete(){mode='delete';return q},update(v:any){mode='update';patch=v;return q},maybeSingle:execute};
 async function execute(){
  if(fail)return {data:null,error:{message:'offline'}};
  if(mode!=='read'&&conflict){conflict=false;await db.query(`UPDATE users SET onboarding='{"session_token":"replacement"}' WHERE id=$1`,[id]);}
  const args:any[]=[];const where=filters.map(([k,v])=>{assert.ok(['id','telegram_id','onboarding','device_info'].includes(k));if(v===null)return `${k} IS NULL`;args.push(v);return `${k}=$${args.length}`}).join(' AND ')||'true';
  let sql='SELECT * FROM users WHERE '+where;
  if(mode==='delete')sql='DELETE FROM users WHERE '+where+' RETURNING *';
  if(mode==='update'){
   const set=Object.entries(patch).map(([k,v])=>{assert.ok(['transactions','cards','updated_at','onboarding','device_info'].includes(k));args.push(typeof v==='object'?JSON.stringify(v):v);return `${k}=$${args.length}`}).join(',');
   sql='UPDATE users SET '+set+' WHERE '+where+' RETURNING *';
  }
  return {data:(await db.query(sql,args)).rows[0]||null,error:null};
 }
 return q;
};
async function row(uid=id){return (await db.query('SELECT * FROM users WHERE id=$1',[uid])).rows[0] as any}
let count=0;
async function test(name:string,fn:()=>Promise<void>){
 conflict=false;fail=false;network=0;await db.exec(`TRUNCATE users; INSERT INTO users VALUES ('moliya_user_tg_123','123','{"session_token":"original"}','{}','[{"id":"tx"}]','[{"id":"cash"}]',now()),('moliya_user_tg_456','456','{}','{}','[]','[]',now());`);
 await fn();assert.equal(network,0);count++;console.log('PASS '+name);
}
await test('admin wipe preserves account and other users',async()=>{const before=await row();const other=await row('moliya_user_tg_456');await wipeFinancialData(id);const after=await row();assert.deepEqual(after.transactions,[]);assert.deepEqual(after.cards,[]);assert.deepEqual(after.onboarding,before.onboarding);assert.deepEqual(await row('moliya_user_tg_456'),other)});
await test('admin wipe rejects missing target',async()=>{await assert.rejects(wipeFinancialData('moliya_user_tg_999'),/USER_NOT_FOUND/)});
await test('admin wipe rejects system row IDs',async()=>{await assert.rejects(wipeFinancialData('admin_session'),/INVALID_USER_ID/)});
await test('admin deletion affects only its target',async()=>{const other=await row('moliya_user_tg_456');await deleteUserAccount(id,{hardDelete:true,wipeTelegramChat:false});assert.equal(await row(),undefined);assert.deepEqual(await row('moliya_user_tg_456'),other)});
await test('stale admin delete preserves changed session and skips Telegram',async()=>{conflict=true;await assert.rejects(deleteUserAccount(id,{hardDelete:true}),/ACCOUNT_CHANGED/);assert.equal((await row()).onboarding.session_token,'replacement')});
await test('missing admin delete target skips Telegram',async()=>{await assert.rejects(deleteUserAccount('moliya_user_tg_999',{hardDelete:true}),/USER_NOT_FOUND/)});
await test('database failure cannot produce fake deletion or Telegram cleanup',async()=>{fail=true;await assert.rejects(deleteUserAccount(id,{hardDelete:true}),/ACCOUNT_STORE_UNAVAILABLE/);assert.ok(await row())});
await test('invalid target ID rejected before cleanup',async()=>{await assert.rejects(deleteUserAccount('system_state',{hardDelete:true}),/INVALID_USER_ID/)});
await test('soft delete preserves money and revokes access',async()=>{const before=await row();await deleteUserAccount(id,{wipeTelegramChat:false});const after=await row();assert.equal(after.onboarding.is_deleted,true);assert.equal(after.onboarding.is_blocked,true);assert.deepEqual(after.transactions,before.transactions)});
await db.close();console.log(`${count} destructive admin checks passed. Offline PostgreSQL predicates; no live services called.`);
