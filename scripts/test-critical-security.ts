import assert from 'node:assert/strict';
// No credentials, database, Telegram or AI network calls are used by this suite.
process.env.SUPABASE_URL='http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY='offline-test-placeholder';
process.env.MOLIYA_TEST='1';
process.env.ADMIN_SECRET_KEY='offline-test-admin-secret-not-for-deployment';
globalThis.fetch=async()=>{throw new Error('NETWORK_FORBIDDEN_IN_TEST');};
const {eligibleUser,safePreferences,publicOnboarding}=await import('../api/_userPolicy.js');
const {effectiveAccess}=await import('../api/_accessHelper.js');
const {supabase}=await import('../api/_supabaseClient.js');
const {default:auth,authenticateCaller,verifyTelegramInitData}=await import('../api/auth.js');
const {default:expense}=await import('../api/parse-expense.js');
const {default:admin}=await import('../api/admin.js');
const {completePhoneRegistration}=await import('../api/telegram-webhook.js');
const token='sess_'+ 'a'.repeat(48);
const base:any={id:'moliya_user_tg_123',telegram_id:'123',phone:'+998901234567',
 onboarding:{session_token:token,session_expires_at:new Date(Date.now()+60000).toISOString()},
 bot_verification:{telegram_id:'123',phone:'+998901234567',phone_source:'telegram_own_contact',phone_verified_at:new Date().toISOString(),consent_source:'telegram_button',consent_version:'1.0',consent_accepted_at:new Date().toISOString()},cards:[{id:'private-card'}],transactions:[{id:'private-tx'}]};
let user:any=structuredClone(base), dbError=false, writes:any[]=[];let concurrentPatch:any=null;
(supabase as any).from=()=>{
 const filters:any[]=[];let payload:any;
 const q:any={select(){return q},like(){return q},eq(k:any,v:any){filters.push([k,v]);return q},is(k:any,v:any){filters.push([k,v]);return q},update(p:any){payload=p;return q},upsert(p:any){payload=p;return q},
  maybeSingle(){return Promise.resolve(result())},single(){return Promise.resolve(result())},
  then(ok:any,bad:any){return Promise.resolve(result()).then(ok,bad)}};
 function result(){
  if(dbError)return {data:null,error:{message:'offline database unavailable'}};
  const restricted=filters.some(([k,v])=>k==='id'&&String(v).startsWith('restricted_'));
  const wrongToken=filters.some(([k,v])=>{if(!/session_token|sessionToken/.test(String(k)))return false;const [column,field]=String(k).split('->>');return user[column]?.[field]!==v;});
  const data=restricted||wrongToken?null:user;
  if(payload){
    if(concurrentPatch){user={...user,...concurrentPatch};concurrentPatch=null;}
    const stale=filters.some(([k,v])=>(k==='onboarding'||k==='device_info') && JSON.stringify(user[k]??null)!== (v===null?'null':v));
    if(stale)return {data:null,error:null};
    writes.push(payload);return {data:{...user,...payload},error:null};
  }
  return {data,error:null};
 }
 return q;
};
let count=0;
async function test(name:string,fn:()=>any){user=structuredClone(base);dbError=false;writes=[];concurrentPatch=null;await fn();count++;console.log('PASS '+name);}
let ip=0;
async function call(handler:any,action:string,method='GET',body:any={},credential=token){
 const req:any={method,query:{action,route:action},url:'/api/auth/'+action,body,headers:{authorization:credential?'Bearer '+credential:'','x-forwarded-for':'offline-'+(++ip)}};
 const res:any={statusCode:200,setHeader(){},status(n:number){this.statusCode=n;return this},json(v:any){this.body=v;return this},end(){return this}};
 await handler(req,res);return res;
}
await test('complete bot evidence unlocks',()=>assert.equal(eligibleUser(user),true));
await test('legacy client consent cannot unlock',()=>{delete user.bot_verification;user.onboarding.completed=true;user.onboarding.oferta_accepted=true;assert.equal(eligibleUser(user),false)});
await test('consent required',()=>{delete user.bot_verification.consent_accepted_at;assert.equal(eligibleUser(user),false)});
await test('own-contact evidence required',()=>{user.bot_verification.phone_source='typed';assert.equal(eligibleUser(user),false)});
await test('phone mismatch rejected',()=>{user.phone='+998901111111';assert.equal(eligibleUser(user),false)});
await test('Telegram identity mismatch rejected',()=>{user.bot_verification.telegram_id='456';assert.equal(eligibleUser(user),false)});
await test('restricted account rejected',()=>{user.is_restricted=true;assert.equal(eligibleUser(user),false)});
await test('preference allowlist strips privilege and identity',()=>assert.deepEqual(safePreferences({name:'Ali',unlimited_ai:true,session_token:'attacker',trial_ends_at:'2099-01-01',phone:'+998901111111',oferta_accepted:true}),{name:'Ali'}));
await test('legacy nested privileges ignored',()=>{user.onboarding.unlimited_ai=true;user.onboarding.is_premium=true;user.onboarding.trial_ends_at='2099-01-01';assert.equal(effectiveAccess(user).canUseAi,true);assert.equal(effectiveAccess(user).aiLimit,20)});
await test('public profile strips tokens',()=>assert.equal(JSON.stringify(publicOnboarding(user)).includes(token),false));
await test('forged Telegram signature rejected',()=>assert.equal(verifyTelegramInitData('hash='+ '0'.repeat(64)+'&auth_date='+Math.floor(Date.now()/1000)+'&user=%7B%22id%22%3A123%7D','dummy').isValid,false));
await test('missing token rejected',async()=>assert.equal((await call(auth,'sync-data','GET',{},'')).statusCode,401));
await test('invented valid-shaped token rejected',async()=>assert.equal((await call(auth,'sync-data','GET',{},'sess_'+'b'.repeat(48))).statusCode,401));
await test('expired session rejected',async()=>{user.onboarding.session_expires_at='2000-01-01';assert.equal((await call(auth,'sync-data')).statusCode,401)});
await test('missing expiry rejected',async()=>{delete user.onboarding.session_expires_at;assert.equal((await call(auth,'sync-data')).statusCode,401)});
await test('database outage fails closed',async()=>{dbError=true;assert.equal((await authenticateCaller({headers:{authorization:'Bearer '+token}},'')).statusCode,503)});
await test('unverified GET hides money data',async()=>{delete user.bot_verification;const r=await call(auth,'sync-data');assert.equal(r.statusCode,200);assert.deepEqual(r.body.user.cards,[]);assert.deepEqual(r.body.user.transactions,[]);assert.equal(r.body.user.isVerified,false)});
await test('unverified POST denied',async()=>{delete user.bot_verification;assert.equal((await call(auth,'sync-data','POST',{cards:[]})).statusCode,403);assert.equal(writes.length,0)});
await test('verified GET returns own data only',async()=>{const r=await call(auth,'sync-data');assert.equal(r.statusCode,200);assert.deepEqual(r.body.user.cards,base.cards);assert.equal(JSON.stringify(r.body).includes(token),false)});
await test('cross-account writes denied',async()=>{assert.equal((await call(auth,'sync-data','POST',{userId:'moliya_user_tg_456',cards:[]})).statusCode,403);assert.equal(writes.length,0)});
await test('protected onboarding cannot be overwritten',async()=>{const r=await call(auth,'sync-data','POST',{onboarding:{name:'Ali',session_token:'attacker',unlimited_ai:true}});assert.equal(r.statusCode,200);assert.equal(writes[0].onboarding.session_token,token);assert.equal(writes[0].onboarding.unlimited_ai,undefined)});
await test('AI rejects token presence alone',async()=>assert.equal((await call(expense,'','POST',{text:'non 5000'},'sess_'+'b'.repeat(48))).statusCode,401));
await test('AI rejects another account ID',async()=>assert.equal((await call(expense,'','POST',{text:'non 5000',userId:'moliya_user_tg_456'})).statusCode,403));
await test('AI requires bot verification',async()=>{delete user.bot_verification;assert.equal((await call(expense,'','POST',{text:'non 5000'})).statusCode,403)});
await test('delete-account rejects another user',async()=>assert.equal((await call(auth,'delete-account','POST',{userId:'moliya_user_tg_456'})).statusCode,403));
await test('admin logout requires POST',async()=>assert.equal((await call(admin,'logout','GET',{},'')).statusCode,405));
await test('canonical account must match Telegram identity',()=>{user.id='moliya_user_tg_456';assert.equal(eligibleUser(user),false)});
await test('phone registration refuses implicit consent',async()=>{delete user.bot_verification;await assert.rejects(completePhoneRegistration({id:123},base.phone),/BOT_CONSENT_REQUIRED/);assert.equal(writes.length,0)});
await test('phone registration rejects malformed phone',async()=>{await assert.rejects(completePhoneRegistration({id:123},'123'),/INVALID_CONTACT_PHONE/);assert.equal(writes.length,0)});
await test('phone registration writes server evidence preserving money',async()=>{await completePhoneRegistration({id:123},base.phone);assert.equal(writes[0].bot_verification.phone_source,'telegram_own_contact');assert.equal(writes[0].bot_verification.consent_accepted_at,base.bot_verification.consent_accepted_at);assert.equal(writes[0].transactions,undefined);assert.equal(writes[0].cards,undefined)});
await test('repeated own-contact verification preserves completed tour',async()=>{
 user.onboarding={...user.onboarding,tour_completed:true};
 await completePhoneRegistration({id:123},base.phone);
 assert.equal(writes[0].onboarding.tour_completed,true);
 assert.equal(writes[0].is_premium,undefined);
 assert.equal(writes[0].transactions,undefined);
});
await test('first own-contact registration starts tour once',async()=>{
 user.phone=null;user.onboarding={...user.onboarding,tour_completed:true};
 await completePhoneRegistration({id:123},base.phone);
 assert.equal(writes[0].onboarding.tour_completed,false);
 assert.equal(writes[0].is_premium,undefined,'Registration must not overwrite paid/admin premium');
 assert.equal(writes[0].created_at,undefined,'Reverification never restarts the seven-day window');
});

await test('logout removes every stored session token',async()=>{user.device_info={sessionToken:token,session_token:token,sessionExpiresAt:'2099-01-01'};const r=await call(auth,'logout','POST');assert.equal(r.statusCode,200);assert.equal(writes[0].onboarding.session_token,undefined);assert.ok(Number.isFinite(Date.parse(writes[0].device_info.session_revoked_at)));assert.equal(writes[0].device_info.session_token,undefined);assert.equal(writes[0].device_info.sessionToken,undefined)});
await test('logout rejects cross-account target',async()=>{assert.equal((await call(auth,'logout','POST',{userId:'moliya_user_tg_456'})).statusCode,403);assert.equal(writes.length,0)});
await test('logout fails closed on database outage',async()=>{dbError=true;assert.equal((await call(auth,'logout','POST')).statusCode,503)});
await test('stale logout cannot erase a newer session',async()=>{concurrentPatch={onboarding:{...user.onboarding,session_token:'sess_new_session_123456'}};assert.equal((await call(auth,'logout','POST')).statusCode,409);assert.equal(writes.length,0)});
await test('stale preference write cannot restore logged-out token',async()=>{concurrentPatch={onboarding:{tour_completed:false}};assert.equal((await call(auth,'sync-data','POST',{onboarding:{name:'Ali'}})).statusCode,409);assert.equal(writes.length,0);assert.equal(user.onboarding.session_token,undefined)});
await test('stale preference write cannot undo admin restriction',async()=>{concurrentPatch={onboarding:{...user.onboarding,is_blocked:true}};assert.equal((await call(auth,'sync-data','POST',{onboarding:{name:'Ali'}})).statusCode,409);assert.equal(writes.length,0);assert.equal(user.onboarding.is_blocked,true)});
await test('old device token cannot survive newer canonical login',async()=>{user.onboarding.session_token='sess_new_canonical_1234567890';user.device_info={session_token:token,session_expires_at:'2099-01-01'};assert.equal((await call(auth,'sync-data')).statusCode,401)});
await test('orphan device token cannot restore logged-out session',async()=>{delete user.onboarding.session_token;user.device_info={session_token:token,session_expires_at:'2099-01-01'};assert.equal((await call(auth,'sync-data')).statusCode,401)});
console.log(`\n${count} critical regression checks passed. No live services called.`);
