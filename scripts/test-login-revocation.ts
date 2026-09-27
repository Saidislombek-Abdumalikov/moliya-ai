import assert from 'node:assert/strict';
process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'offline-test';
process.env.TELEGRAM_BOT_TOKEN = 'offline-bot';
const { supabase } = await import('../api/_supabaseClient.js');
const { default: auth } = await import('../api/auth.js');

const oldToken = 'sess_' + 'a'.repeat(48);
const revokedAt = new Date(Date.now() - 30_000).toISOString();
const requestId = 'b'.repeat(48);
const code = 'c'.repeat(48);
const proof = {telegram_id:'123',phone:'+998901234567',phone_source:'telegram_own_contact',
  phone_verified_at:new Date().toISOString(),consent_source:'telegram_button',consent_version:'1',consent_accepted_at:new Date().toISOString()};
let user:any = {id:'moliya_user_tg_123',telegram_id:'123',phone:proof.phone,bot_verification:proof,
  onboarding:{session_expires_at:new Date(Date.now()+600_000).toISOString()},device_info:{session_revoked_at:revokedAt},
  cards:[{id:'private-card'}],transactions:[{id:'private-transaction'}]};
const request:any = {id:'req_'+requestId,telegram_id:'123',created_at:new Date().toISOString(),
  device_info:{status:'VERIFIED',createdAt:new Date().toISOString(),sessionToken:oldToken}};
const codeRow:any = {id:'exchange_'+code,telegram_id:'123',updated_at:new Date(Date.now()-60_000).toISOString(),
  device_info:{status:'VALID',sessionToken:oldToken,sessionExpiresAt:new Date(Date.now()+300_000).toISOString()}};
(supabase as any).from = (_table:string) => {
  let filters:Array<[string,any]> = [], patch:any = null, updating = false;
  const q:any = {
    select(){return q},eq(k:string,v:any){filters.push([k,v]);return q},neq(k:string,v:any){filters.push(['!'+k,v]);return q},like(){return q},
    update(v:any){patch=v;updating=true;return q},
    async maybeSingle(){const r=run();return {data:r.data?.[0]??null,error:null}},
    then(ok:any,bad:any){return Promise.resolve(run()).then(ok,bad)}
  };
  function run(){
    const id=filters.find(([key])=>key==='id')?.[1];
    let row = id===request.id ? request : id===codeRow.id ? codeRow :
      id==='restricted_tg_123' ? null : id===user.id || filters.some(([k])=>k==='onboarding->>session_token') ? user : null;
    for(const [key,value] of filters){
      if(key==='id' && row?.id!==value) row=null;
      else if(key==='onboarding->>session_token' && row?.onboarding?.session_token!==value) row=null;
      else if(key==='device_info->>status' && row?.device_info?.status!==value) row=null;
      else if(key==='!device_info->>status' && row?.device_info?.status===value) row=null;
      else if(['onboarding','device_info','bot_verification'].includes(key) && JSON.stringify(row?.[key])!==value) row=null;
    }
    if(updating && row){Object.assign(row,patch);return {data:[structuredClone(row)],error:null};}
    return {data:row?[structuredClone(row)]:[],error:null};
  }
  return q;
};

let n=0;
async function call(action:string,method:string,body:any={},query:any={}){
  const req:any={method,query:{action,...query},body,headers:{'x-forwarded-for':'offline-'+(++n)},url:'/api/auth/'+action};
  const res:any={statusCode:200,setHeader(){},status(code:number){this.statusCode=code;return this},json(data:any){this.body=data;return this},end(){return this}};
  await auth(req,res);return res;
}
const poll = await call('check-login-request','GET',{}, {requestId});
assert.equal(poll.statusCode,200);
assert.equal(poll.body.status,'EXPIRED');
assert.equal(JSON.stringify(poll.body).includes('private-'),false);
console.log('PASS verified poll cannot reveal data or token after logout');

const stale = await call('exchange-code','POST',{code});
assert.equal(stale.statusCode,400);
assert.equal(user.onboarding.session_token,undefined);
console.log('PASS code issued before logout cannot create a new session');

codeRow.device_info.status='VALID';
codeRow.updated_at=new Date().toISOString();
const fresh = await call('exchange-code','POST',{code});
assert.equal(fresh.statusCode,200);
assert.match(fresh.body.sessionToken,/^sess_[a-f0-9]{48}$/);
assert.equal(user.onboarding.session_token,fresh.body.sessionToken);
console.log('PASS fresh bot code still signs in a verified user');

// A still-current verified request keeps its original one-time sign-in flow.
user.onboarding.session_token=oldToken;
request.device_info.status='VERIFIED';
const currentPoll=await call('check-login-request','GET',{}, {requestId});
assert.equal(currentPoll.statusCode,200);
assert.equal(currentPoll.body.status,'VERIFIED');
assert.equal(currentPoll.body.sessionToken,oldToken);
assert.equal(request.device_info.status,'CONSUMED');
console.log('PASS current verified request signs in once');

// Cancelling a pending web login must not rotate the current user token.
request.device_info={status:'PENDING',createdAt:new Date().toISOString()};
const beforeCancel=user.onboarding.session_token;
const cancel=await call('cancel-login-request','POST',{requestId});
assert.equal(cancel.statusCode,200);
assert.equal(request.device_info.status,'CANCELLED');
assert.equal(user.onboarding.session_token,beforeCancel);
assert.equal((await call('check-login-request','GET',{}, {requestId})).body.status,'CANCELLED');
assert.equal((await call('cancel-login-request','POST',{requestId})).statusCode,409);
console.log('PASS cancelled request stays cancelled and leaves existing session valid');
