import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {effectiveAccess} from '../api/_accessHelper.js';
process.env.SUPABASE_URL='http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY='offline-test-placeholder';
globalThis.fetch=async()=>{throw new Error('NETWORK_FORBIDDEN');};
const {supabase}=await import('../api/_supabaseClient.js');
const {checkAiQuota,checkAndRecordAiUsage}=await import('../api/_aiQuotaHelper.js');
const db=new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE TABLE public.users(id text PRIMARY KEY,telegram_id text,phone text,onboarding jsonb DEFAULT '{}',device_info jsonb DEFAULT '{}',bot_verification jsonb DEFAULT '{}',
 is_blocked boolean,is_restricted boolean,is_deleted boolean,account_status text,ai_blocked boolean,unlimited_ai boolean,is_premium boolean,is_vip boolean,is_trial boolean,
 created_at timestamptz,premium_expires_at timestamptz,trial_ends_at timestamptz,ai_limit integer,ai_query_count integer DEFAULT 0,last_ai_query_at timestamptz,updated_at timestamptz);`);
const migration=await readFile(new URL('../migrations/02-atomic-ai-quota.sql',import.meta.url),'utf8');
await db.exec(migration);
await db.exec(migration); // repeat application is safe; does not reset counters
const configurable=await readFile(new URL('../migrations/11-configurable-ai-quota.sql',import.meta.url),'utf8');
await db.exec(configurable);
await db.exec(configurable);
await db.exec(await readFile(new URL('../migrations/20-registration-week-trial.sql',import.meta.url),'utf8'));
const id='moliya_user_tg_123';
const now=new Date().toISOString();
const base:any={id,telegram_id:'123',phone:'+998901234567',onboarding:{},device_info:{},bot_verification:{telegram_id:'123',phone:'+998901234567',phone_source:'telegram_own_contact',phone_verified_at:now,consent_source:'telegram_button',consent_version:'1.0',consent_accepted_at:now},ai_query_count:0,ai_limit:null};
async function seed(overrides:any={}){
 await db.exec('TRUNCATE public.users');
 const u={...base,...overrides};
 await db.query('INSERT INTO public.users SELECT * FROM jsonb_populate_record(NULL::public.users,$1::jsonb)',[JSON.stringify(u)]);
 return u;
}
async function reserve(consume=true,uid=id):Promise<any>{const r=await db.query<{result:any}>('SELECT public.moliya_ai_quota($1,$2) AS result',[uid,consume]);return r.rows[0].result;}
let count=0;
async function test(name:string,fn:()=>any){await seed();await fn();count++;console.log('PASS '+name)};
await test('100 simultaneous submissions admit exactly 20 attempts',async()=>{
 const r=await Promise.all(Array.from({length:100},()=>reserve()));
 assert.equal(r.filter(x=>x.allowed).length,20);assert.equal(r.filter(x=>x.code==='QUOTA_EXCEEDED').length,80);
 assert.equal((await reserve(false)).usedCount,20);
});
await test('custom limit 3 admits exactly 3 of 50',async()=>{await seed({ai_limit:3});const r=await Promise.all(Array.from({length:50},()=>reserve()));assert.equal(r.filter(x=>x.allowed).length,3)});
await test('admin default updates SQL quota without touching user rows',async()=>{
 await db.query("INSERT INTO users(id,onboarding) VALUES ('system_app_settings',$1::jsonb)",[JSON.stringify({default_ai_quota:2})]);
 assert.equal((await reserve(false)).limit,2);
 const r=await Promise.all(Array.from({length:5},()=>reserve()));
 assert.equal(r.filter(x=>x.allowed).length,2);
 assert.equal(effectiveAccess(base,2).aiLimit,2);
});
await test('custom limit and unlimited survive a changed default',async()=>{
 await db.query("INSERT INTO users(id,onboarding) VALUES ('system_app_settings',$1::jsonb)",[JSON.stringify({default_ai_quota:2})]);
 await db.query('UPDATE users SET ai_limit=7 WHERE id=$1',[id]);
 assert.equal((await reserve(false)).limit,7);
 await db.query('UPDATE users SET ai_limit=0 WHERE id=$1',[id]);
 assert.equal((await reserve(false)).limit,null);
});
await test('bulk reset only changes eligible positive free overrides',async()=>{
 await db.query('UPDATE users SET ai_limit=8 WHERE id=$1',[id]);
 const duplicate={...base,id:'moliya_user_tg_124',telegram_id:'124',ai_limit:0};
 const vip={...base,id:'moliya_user_tg_125',telegram_id:'125',ai_limit:8,is_premium:true,premium_expires_at:'2099-01-01'};
 const trial={...base,id:'moliya_user_tg_126',telegram_id:'126',ai_limit:8,trial_ends_at:'2099-01-01'};
 const expired={...base,id:'moliya_user_tg_127',telegram_id:'127',ai_limit:8,is_premium:true,premium_expires_at:'2000-01-01'};
 const unverified={...base,id:'moliya_user_tg_128',telegram_id:'128',ai_limit:8,bot_verification:{}};
 for(const u of [duplicate,vip,trial,expired,unverified])await db.query('INSERT INTO users SELECT * FROM jsonb_populate_record(NULL::users,$1::jsonb)',[JSON.stringify({...u,bot_verification:u.bot_verification===base.bot_verification?{...base.bot_verification,telegram_id:u.telegram_id}:u.bot_verification})]);
 assert.equal((await db.query<any>('SELECT public.moliya_reset_free_ai_overrides() AS n')).rows[0].n,2);
 const r=await db.query<any>('SELECT id,ai_limit FROM users WHERE id LIKE $1 ORDER BY id',['moliya_user_tg_%']);
 assert.deepEqual(r.rows.map((x:any)=>x.ai_limit),[null,0,8,8,null,8]);
});
await test('display queries never consume quota',async()=>{await Promise.all(Array.from({length:30},()=>reserve(false)));assert.equal((await reserve(false)).usedCount,0)});
await test('UTC rollover resets once then counts requests',async()=>{await seed({ai_query_count:20,last_ai_query_at:'2000-01-01T00:00:00Z'});const r=await Promise.all([reserve(),reserve()]);assert.deepEqual(r.map(x=>x.usedCount),[1,2])});
await test('blocked account never consumes',async()=>{await seed({is_blocked:true});assert.equal((await reserve()).allowed,false);assert.equal((await db.query<any>('SELECT ai_query_count FROM users')).rows[0].ai_query_count,0)});
await test('AI-blocked account never consumes',async()=>{await seed({ai_blocked:true});assert.equal((await reserve()).code,'AI_BLOCKED')});
await test('missing bot proof denied',async()=>{await seed({bot_verification:{}});assert.equal((await reserve()).allowed,false)});
await test('bad consent date denied',async()=>{await seed({bot_verification:{...base.bot_verification,consent_accepted_at:'bad'}});assert.equal((await reserve()).allowed,false)});
await test('wrong contact identity denied',async()=>{await seed({bot_verification:{...base.bot_verification,telegram_id:'456'}});assert.equal((await reserve()).allowed,false)});
await test('identity tombstone denies access',async()=>{await db.query("INSERT INTO users(id,onboarding) VALUES ('restricted_tg_123','{}')");assert.equal((await reserve()).allowed,false)});
await test('missing account denied',async()=>assert.equal((await reserve(true,'moliya_user_tg_999')).allowed,false));
const future='2099-01-01T00:00:00Z',past='2000-01-01T00:00:00Z';
for(const [name,patch] of Object.entries({registeredToday:{created_at:new Date().toISOString()},registeredSixDays:{created_at:new Date(Date.now()-6*86400000).toISOString(),is_premium:true,premium_expires_at:new Date(Date.now()-5*86400000).toISOString()},expiredWeek:{created_at:new Date(Date.now()-8*86400000).toISOString()},futureRegistration:{created_at:'2099-01-01T00:00:00Z'},blockedTrial:{created_at:new Date().toISOString(),ai_blocked:true},free:{},custom:{ai_limit:3},zero:{ai_limit:0},minusOne:{ai_limit:-1},unlimited:{unlimited_ai:true},vip:{is_premium:true,premium_expires_at:future},lifetime:{is_premium:true},expired:{is_premium:true,premium_expires_at:past},trial:{trial_ends_at:future},disabledTrial:{is_trial:false,trial_ends_at:future},expiredVipNoTrial:{is_premium:true,premium_expires_at:past,trial_ends_at:future},legacyPrivilege:{onboarding:{unlimited_ai:true,is_premium:true,trial_ends_at:future}}})){
 await test('SQL/TypeScript entitlement parity: '+name,async()=>{const u=await seed(patch);const access=effectiveAccess(u),actual=await reserve(false);assert.equal(actual.limit,access.aiLimit);assert.equal(actual.isPremium,access.isPremium);assert.equal(actual.isTrial,access.level==='TRIAL')});
}
await test('unlimited still records exact usage',async()=>{await seed({unlimited_ai:true});const r=await Promise.all(Array.from({length:30},()=>reserve()));assert.equal(r.filter(x=>x.allowed).length,30);assert.equal((await reserve(false)).usedCount,30)});
await test('admin reset does not change premium or erase account',async()=>{await seed({ai_query_count:20,last_ai_query_at:now});await db.query('UPDATE users SET ai_query_count=0 WHERE id=$1',[id]);assert.equal((await reserve()).usedCount,1)});
for(const role of ['anon','authenticated'])await test(role+' cannot execute RPC',async()=>{await db.exec('SET ROLE '+role);try{await assert.rejects(reserve(),/permission denied/)}finally{await db.exec('RESET ROLE')}});
for(const role of ['anon','authenticated'])await test(role+' cannot reset overrides',async()=>{await db.exec('SET ROLE '+role);try{await assert.rejects(db.query('SELECT public.moliya_reset_free_ai_overrides()'),/permission denied/)}finally{await db.exec('RESET ROLE')}});
await test('service-role can execute RPC',async()=>{await db.exec('SET ROLE service_role');try{assert.equal((await reserve()).allowed,true)}finally{await db.exec('RESET ROLE')}});
// Test production TS helper against the real SQL function rather than a counter mock.
(supabase as any).rpc=async(_name:string,args:any)=>({data:await reserve(args.p_consume,args.p_user_id),error:null});
let auditWrites=0;
(supabase as any).from=()=>({insert:async()=>{auditWrites++;return {error:null}}});
await test('mixed web/bot admissions share one counter without double charge',async()=>{auditWrites=0;await seed({ai_limit:4});const r=await Promise.all(Array.from({length:20},(_,i)=>checkAndRecordAiUsage(id,i%2?'voice':'text','test',i%2?'telegram_bot':'mini_app')));assert.equal(r.filter(x=>x.allowed).length,4);assert.equal(auditWrites,4);assert.equal((await checkAiQuota(id)).usedCount,4)});
await test('audit failure does not reset the reserved counter',async()=>{(supabase as any).from=()=>({insert:async()=>({error:{message:'offline audit failure'}})});assert.equal((await checkAndRecordAiUsage(id)).allowed,true);assert.equal((await reserve(false)).usedCount,1)});
await test('RPC error fails closed',async()=>{(supabase as any).rpc=async()=>({data:null,error:{message:'missing RPC'}});const q=await checkAndRecordAiUsage(id);assert.equal(q.allowed,false);assert.equal(q.statusCode,503)});
await test('malformed RPC result fails closed',async()=>{(supabase as any).rpc=async()=>({data:{allowed:true},error:null});assert.equal((await checkAndRecordAiUsage(id)).allowed,false)});
await db.close();
console.log(`\n${count} atomic-quota checks passed using embedded PostgreSQL (PGlite).`);
console.log('PGlite serializes submitted queries; this verifies SQL behavior, not a multi-connection Supabase load test.');
