import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
process.env.SUPABASE_URL='http://127.0.0.1:54321';process.env.SUPABASE_SERVICE_ROLE_KEY='offline-placeholder';
process.env.ADMIN_SECRET_KEY='offline-admin-profile-secret';
globalThis.fetch=async()=>{throw Error('NETWORK_FORBIDDEN')};
const {default:admin}=await import('../api/admin');
const {supabase}=await import('../api/_supabaseClient');
const {updateProfileSnapshot}=await import('../api/services/_profileWriteService');
const {logBotMessage,deleteTelegramMessageHistory}=await import('../api/services/_telegramMessageService');
const {blockUser}=await import('../api/services/_userAccountService');
const {revokePremium}=await import('../api/services/_premiumService');
const db=new PGlite();await db.exec('CREATE TABLE records(id text PRIMARY KEY,doc jsonb NOT NULL)');
const uid='moliya_user_tg_123';
const base={id:uid,telegram_id:'123',is_blocked:false,is_premium:true,device_info:{session_token:'sess_old_1234567890123456'},bot_verification:{phone:'verified'},onboarding:{session_token:'sess_old_1234567890123456',session_expires_at:'2099-01-01',is_blocked:false,unlimited_ai:true,bot_messages:[]},transactions:[{id:'money'}],cards:[{id:'card'}]};
let fail=false;let beforeUpdate:(()=>Promise<void>)|undefined;
async function row(id=uid){return (await db.query<any>('SELECT doc FROM records WHERE id=$1',[id])).rows[0]?.doc;}
async function set(changes:any){await db.query('UPDATE records SET doc=doc || $1::jsonb WHERE id=$2',[JSON.stringify(changes),uid]);}
// Execute the helper's predicates as real PostgreSQL JSON equality comparisons.
(supabase as any).from=(table:string)=>{if(table!=='users')return {insert:async()=>({data:null,error:null})};let patch:any;const filters:[string,any][]=[];const nulls:string[]=[];
 const q:any={select(){return q},eq(k:string,v:any){filters.push([k,v]);return q},is(k:string){nulls.push(k);return q},update(p:any){patch=p;return q},async maybeSingle(){
  if(fail)return {data:null,error:{message:'private database detail'}};
  if(!patch)return {data:await row(filters.find(x=>x[0]==='id')?.[1]),error:null};
  if(beforeUpdate){const hook=beforeUpdate;beforeUpdate=undefined;await hook();}
  const args:any[]=[JSON.stringify(patch)];const where:string[]=[];
  for(const [key,value] of filters){args.push(key);const keyParam='$'+args.length;const valueJson=['onboarding','device_info','bot_verification'].includes(key)?value:JSON.stringify(value);args.push(valueJson);where.push(`doc->${keyParam} = $${args.length}::jsonb`);}
  for(const key of nulls){args.push(key);where.push(`nullif(doc->$${args.length},'null'::jsonb) IS NULL`);}
  const result=await db.query<any>('UPDATE records SET doc=doc || $1::jsonb WHERE '+where.join(' AND ')+' RETURNING doc',args);
  return {data:result.rows[0]?.doc??null,error:null};
 }};return q;
};
let count=0;
async function test(name:string,fn:()=>any){fail=false;beforeUpdate=undefined;await db.exec('TRUNCATE records');await db.query('INSERT INTO records VALUES($1,$2),($3,$4)',[uid,JSON.stringify(base),'moliya_user_tg_456',JSON.stringify({...base,id:'moliya_user_tg_456',telegram_id:'456'})]);await fn();count++;console.log('PASS '+name)};
await test('current snapshot updates profile preserving money',async()=>{await updateProfileSnapshot(uid,await row(),{onboarding:{...base.onboarding,name:'Ali'}});assert.deepEqual((await row()).transactions,base.transactions);assert.deepEqual((await row()).cards,base.cards);assert.equal((await row()).onboarding.name,'Ali')});
await test('stale bot state cannot restore a logged-out session',async()=>{const old=await row();const {session_token,session_expires_at,...clean}=old.onboarding;await set({onboarding:clean});await assert.rejects(updateProfileSnapshot(uid,old,{onboarding:{...old.onboarding,last_temp_msg_id:5}}),/PROFILE_CHANGED/);assert.equal((await row()).onboarding.session_token,undefined)});
await test('stale login cannot undo nested admin restriction',async()=>{const old=await row();await set({onboarding:{...old.onboarding,is_blocked:true}});await assert.rejects(updateProfileSnapshot(uid,old,{onboarding:{...old.onboarding,session_token:'sess_new'}}),/PROFILE_CHANGED/);assert.equal((await row()).onboarding.is_blocked,true)});
await test('top-level restriction prevents stale login even when JSON unchanged',async()=>{const old=await row();await set({is_blocked:true});await assert.rejects(updateProfileSnapshot(uid,old,{onboarding:{...old.onboarding,session_token:'sess_new'}}),/PROFILE_CHANGED/)});
await test('stale phone proof cannot overwrite newer consent',async()=>{const old=await row();await set({bot_verification:{...old.bot_verification,consent_version:'new'}});await assert.rejects(updateProfileSnapshot(uid,old,{bot_verification:{...old.bot_verification,phone:'new-phone'}}),/PROFILE_CHANGED/)});
await test('changed device session cannot be replaced from old copy',async()=>{const old=await row();await set({device_info:{session_token:'new'}});await assert.rejects(updateProfileSnapshot(uid,old,{device_info:{session_token:'old-copy'}}),/PROFILE_CHANGED/)});
await test('parallel profile writes admit only one old snapshot',async()=>{const old=await row();const results=await Promise.allSettled([updateProfileSnapshot(uid,old,{onboarding:{...old.onboarding,name:'a'}}),updateProfileSnapshot(uid,old,{onboarding:{...old.onboarding,name:'b'}})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1)});
await test('missing snapshot fails without writing',async()=>{await assert.rejects(updateProfileSnapshot(uid,null,{onboarding:{}}),/PROFILE_SNAPSHOT_REQUIRED/);assert.deepEqual(await row(),base)});
await test('missing selected JSON column is rejected',async()=>await assert.rejects(updateProfileSnapshot(uid,{id:uid,onboarding:base.onboarding},{device_info:{}}),/PROFILE_SNAPSHOT_REQUIRED/));
await test('wrong-account snapshot rejected',async()=>await assert.rejects(updateProfileSnapshot('moliya_user_tg_456',await row(),{onboarding:{}}),/PROFILE_SNAPSHOT_REQUIRED/));
await test('normal message update preserves original snapshot',async()=>{const entry:any={id:'m',message_id:1,chat_id:123,direction:'user_to_bot',sender:'user',type:'text',text:'old',timestamp:'2026-09-24'};await set({onboarding:{...base.onboarding,bot_messages:[entry]}});await logBotMessage(uid,{...entry,text:'edited'});assert.equal((await row()).onboarding.bot_messages[0].text,'edited');assert.equal((await row()).onboarding.session_token,base.onboarding.session_token)});
await test('message logging racing logout cannot restore session',async()=>{beforeUpdate=async()=>set({onboarding:{bot_messages:[]}});await logBotMessage(uid,{id:'m',message_id:1,chat_id:123,direction:'user_to_bot',sender:'user',type:'text',timestamp:'2026-09-24'});assert.equal((await row()).onboarding.session_token,undefined)});
await test('admin block does not silently undo a newer logout',async()=>{beforeUpdate=async()=>set({onboarding:{bot_messages:[]}});await assert.rejects(blockUser(uid),/PROFILE_CHANGED/);assert.equal((await row()).onboarding.session_token,undefined)});
await test('premium revocation preserves current session',async()=>{await revokePremium(uid);assert.equal((await row()).is_premium,false);assert.equal((await row()).onboarding.session_token,base.onboarding.session_token)});
await test('history deletion preserves blocked state and financial data',async()=>{await set({onboarding:{...base.onboarding,is_blocked:true}});await deleteTelegramMessageHistory(uid);assert.equal((await row()).onboarding.is_blocked,true);assert.deepEqual((await row()).transactions,base.transactions)});
await test('database failure returns safe error',async()=>{fail=true;await assert.rejects(updateProfileSnapshot(uid,base,{onboarding:{}}),/PROFILE_STORE_UNAVAILABLE/)});
async function adminBlock(){const req:any={method:'POST',query:{route:'users'},body:{userId:uid,action:'block'},headers:{'x-admin-key':process.env.ADMIN_SECRET_KEY},socket:{remoteAddress:'192.0.2.77'}};const res:any={statusCode:200,setHeader(){},status(n:number){this.statusCode=n;return this},json(b:any){this.body=b;return this}};await admin(req,res);return res;}
await test('admin block API updates only the selected account',async()=>{const result=await adminBlock();assert.equal(result.statusCode,200);assert.equal((await row()).is_blocked,true);assert.equal((await row()).onboarding.is_blocked,true);assert.equal((await row('moliya_user_tg_456')).is_blocked,false)});
await test('admin API does not report stale profile write as success',async()=>{beforeUpdate=async()=>set({onboarding:{bot_messages:[]}});const result=await adminBlock();assert.notEqual(result.statusCode,200);assert.equal((await row()).onboarding.session_token,undefined);assert.equal((await row()).is_blocked,false)});
await db.close();console.log(`${count} profile concurrency checks passed. PostgreSQL predicates tested with PGlite; live multi-connection testing remains required.`);
