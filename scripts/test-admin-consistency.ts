import {existsSync} from 'node:fs';
import assert from 'node:assert/strict';
import {adminUserView} from '../api/_adminUserView.js';
import {eligibleUser} from '../api/_userPolicy.js';
import {effectiveAccess} from '../api/_accessHelper.js';
const adminRoot=new URL(existsSync(new URL('../../Admin-Dashboard/',import.meta.url))?'../../Admin-Dashboard/':'../../Admin-Dashboard/',import.meta.url);
const {normalizeUser}=await import(new URL('src/services/userService.js',adminRoot).href);
const {requestAdmin}=await import(new URL('src/services/adminTransport.js',adminRoot).href);
const base={id:'moliya_user_tg_123',telegram_id:'123',phone:'+998901234567',onboarding:{session_token:'secret',session_expires_at:'2099-01-01'},device_info:{session_token:'secret'},bot_verification:{telegram_id:'123',phone:'+998901234567',phone_source:'telegram_own_contact',phone_verified_at:'2026-01-01',consent_source:'telegram_button',consent_version:'v1',consent_accepted_at:'2026-01-01'},cards:[{id:'cash'}],transactions:[{id:'tx',amount:10}]};
let count=0;
async function test(name:string,fn:()=>any){await fn();count++;console.log('PASS '+name)}
for(const [name,patch] of [
 ['verified',{}],['trial',{trial_ends_at:'2099-01-01'}],['disabled trial',{trial_ends_at:'2099-01-01',is_trial:false}],['expired premium',{is_premium:true,premium_expires_at:'2000-01-01',trial_ends_at:'2099-01-01'}],['premium',{is_premium:true,premium_expires_at:'2099-01-01'}],['unlimited',{unlimited_ai:true}],['custom limit',{ai_limit:7}],['AI blocked',{ai_blocked:true}]
] as const)await test('admin matches server access: '+name,()=>{const user={...base,...patch};const expected=effectiveAccess(user);const view=adminUserView(user);const admin=normalizeUser(view);assert.equal(admin.isPremium,expected.isPremium);assert.equal(admin.aiLimit,expected.aiLimit);assert.equal(admin.effectiveAccess.canUseAi,eligibleUser(user)&&expected.canUseAi);assert.equal(admin.premiumExpiresAt,(patch as any).premium_expires_at||null)});
await test('legacy phone/onboarding never fabricates consent',()=>{const user={...base,bot_verification:null,onboarding:{completed:true,oferta_accepted:true}};const admin=normalizeUser(adminUserView(user));assert.equal(admin.ofertaAccepted,false);assert.equal(admin.isRegistered,false);assert.equal(admin.effectiveAccess.canUseAi,false)});
await test('tombstone blocks canonical account',()=>{const admin=normalizeUser(adminUserView(base,true));assert.equal(admin.isBlocked,true);assert.equal(admin.effectiveAccess.canUseAi,false)});
await test('nested restriction is reflected',()=>{const admin=normalizeUser(adminUserView({...base,device_info:{restricted:true}}));assert.equal(admin.isBlocked,true);assert.equal(admin.effectiveAccess.canUseApp,false)});
await test('session credentials are absent from admin view',()=>{const view=adminUserView(base);assert.ok(!JSON.stringify(view).includes('secret'));assert.equal((view as any).deviceInfo,undefined)});
await test('financial profile retains actual data',()=>{const admin=normalizeUser(adminUserView(base));assert.equal(admin.cardsCount,1);assert.equal(admin.transactionsCount,1)});
await test('admin financial summary uses the same four transaction types',()=>{
 const date=new Date().toISOString().slice(0,10);
 const transactions=[{type:'income',amount:1000,date},{type:'expense',amount:-200,date},
  {type:'debt',amount:300,date},{type:'lending',amount:-400,date}];
 const admin=normalizeUser(adminUserView({...base,transactions}));
 assert.equal(admin.financialSummary.income,1000);
 assert.equal(admin.financialSummary.expense,200);
 assert.equal(admin.financialSummary.borrowed,300);
 assert.equal(admin.financialSummary.lent,400);
 assert.equal(admin.financialSummary.cashFlow,700);
 assert.equal(admin.todaySummary.expense,200);
});
await test('mutation is never retried against other hosts',async()=>{let calls=0;await assert.rejects(requestAdmin('users','POST',{action:'wipe'},{fetcher:async()=>{calls++;throw new Error('offline')}}),/offline/);assert.equal(calls,1)});
await test('server error details are not copied',async()=>{await assert.rejects(requestAdmin('users','GET',null,{fetcher:async()=>({ok:false,status:500,json:async()=>({error:'FAILED',details:'secret SQL'})})}),/^Error: FAILED$/)});
await test('logout failure is visible',async()=>{await assert.rejects(requestAdmin('logout','POST',null,{fetcher:async()=>({ok:false,status:503,json:async()=>({error:'STORE_UNAVAILABLE'})})}),/STORE_UNAVAILABLE/)});
await test('request uses intended backend and cookie credentials',async()=>{let options:any;await requestAdmin('users','GET',null,{baseUrl:'https://example.invalid',fetcher:async(url:any,opts:any)=>{assert.equal(url,'https://example.invalid/api/admin?route=users');options=opts;return {ok:true,json:async()=>({success:true})}}});assert.equal(options.credentials,'include');assert.ok(options.signal)});
await test('admin API returns only canonical users with merged restriction',async()=>{
 process.env.SUPABASE_URL='http://127.0.0.1:54321';process.env.SUPABASE_SERVICE_ROLE_KEY='offline';process.env.ADMIN_SECRET_KEY='offline-admin-test';
 const {supabase}=await import('../api/_supabaseClient.js');const {default:handler}=await import('../api/admin.js');
 const rows=[base,{id:'restricted_tg_123',onboarding:{is_blocked:true}},{id:'exchange_secret',onboarding:{session_token:'secret'}}];
 (supabase as any).from=()=>({select(){return this},order(){return this},range:async(from:number,to:number)=>({data:rows.slice(from,to+1),error:null})});
 const req:any={method:'GET',query:{route:'users'},headers:{'x-admin-key':'offline-admin-test'},socket:{remoteAddress:'127.0.0.1'}};
 const res:any={statusCode:200,setHeader(){},status(n:number){this.statusCode=n;return this},json(v:any){this.body=v;return this}};
 await handler(req,res);assert.equal(res.statusCode,200);assert.equal(res.body.users.length,1);assert.equal(res.body.users[0].isBlocked,true);assert.ok(!JSON.stringify(res.body).includes('secret'));
});
await test('admin roster includes users across the database page boundary',async()=>{
 const {supabase}=await import('../api/_supabaseClient.js');const {default:handler}=await import('../api/admin.js');
 const many=Array.from({length:1001},(_,i)=>({...base,id:`moliya_user_tg_${10000+i}`,telegram_id:String(10000+i),bot_verification:null,cards:[],transactions:[]}));
 const rows=[...many,{id:'restricted_tg_10000',onboarding:{is_blocked:true}}];
 const pages:number[]=[];
 (supabase as any).from=()=>({select(){return this},order(){return this},range:async(from:number,to:number)=>{pages.push(from);return {data:rows.slice(from,to+1),error:null}}});
 const req:any={method:'GET',query:{route:'users'},headers:{'x-admin-key':'offline-admin-test'},socket:{remoteAddress:'127.0.1.2'}};
 const res:any={statusCode:200,setHeader(){},status(n:number){this.statusCode=n;return this},json(v:any){this.body=v;return this}};
 await handler(req,res);assert.equal(res.statusCode,200);assert.equal(res.body.users.length,1001);
 assert.equal(res.body.users[0].isBlocked,true);assert.ok(res.body.users.some((u:any)=>u.id==='moliya_user_tg_11000'));
 assert.deepEqual(pages,[0,500,1000]);
});
console.log(`${count} admin consistency and transport checks passed. No live services called.`);
