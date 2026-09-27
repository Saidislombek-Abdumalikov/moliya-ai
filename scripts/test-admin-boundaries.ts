import assert from 'node:assert/strict';
import crypto from 'node:crypto';
process.env.SUPABASE_URL='http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY='offline-placeholder';
process.env.ADMIN_SECRET_KEY='offline-admin-secret-never-deploy';
process.env.ADMIN_ALLOWED_ORIGINS='https://admin.example';
process.env.ALLOWED_ORIGINS='https://user.example';
globalThis.fetch=async()=>{throw Error('NETWORK_FORBIDDEN');};
const {supabase}=await import('../api/_supabaseClient');
const {default:admin}=await import('../api/admin');
const {verifyTelegramInitData}=await import('../api/auth');
const sid='a'.repeat(32);let activeSid:string|null=sid;let outage=false;let writes=0;
(supabase as any).from=()=>{let payload:any;const q:any={select(){return q},eq(){return q},upsert(p:any){payload=p;return q},update(p:any){payload=p;return q},maybeSingle(){return Promise.resolve(result())},then(ok:any,bad:any){return Promise.resolve(result()).then(ok,bad)}};function result(){if(outage)return {data:null,error:{message:'offline'}};if(payload)writes++;return {data:{device_info:{active_sid:activeSid}},error:null};}return q;};
function cookie(overrides:any={}){const now=Math.floor(Date.now()/1000);const body=Buffer.from(JSON.stringify({role:'admin',sid,iat:now,exp:now+3600,...overrides})).toString('base64url');return body+'.'+crypto.createHmac('sha256',process.env.ADMIN_SECRET_KEY!).update(body).digest('base64url');}
let index=0,count=0;
async function request(method='GET',route='verify-session',headers:any={},body:any={}){const req:any={method,query:{route},body,socket:{remoteAddress:'192.0.2.'+(count+1)},headers:{'x-forwarded-for':'boundaries-'+(++index),...headers}};const res:any={statusCode:200,headers:{},setHeader(k:string,v:any){this.headers[k]=v},status(n:number){this.statusCode=n;return this},json(v:any){this.body=v;return this},end(){return this}};await admin(req,res);return res;}
const trusted=()=>({cookie:'moliya_admin_session='+cookie(),origin:'https://admin.example'});
async function test(name:string,fn:()=>any){outage=false;activeSid=sid;writes=0;await fn();count++;console.log('PASS '+name);}
await test('user app origin cannot access admin even with valid cookie',async()=>assert.equal((await request('GET','verify-session',{...trusted(),origin:'https://user.example'})).statusCode,403));
await test('default Telegram domain is not admin trusted',async()=>assert.equal((await request('GET','verify-session',{...trusted(),origin:'https://web.telegram.org'})).statusCode,403));
await test('lookalike origin is denied',async()=>assert.equal((await request('POST','verify-session',{...trusted(),origin:'https://admin.example.evil.test'})).statusCode,403));
await test('missing admin origins fail closed for browser',async()=>{const saved=process.env.ADMIN_ALLOWED_ORIGINS;delete process.env.ADMIN_ALLOWED_ORIGINS;try{assert.equal((await request('GET','verify-session',trusted())).statusCode,403)}finally{process.env.ADMIN_ALLOWED_ORIGINS=saved}});
await test('cookie write without origin or referer denied',async()=>assert.equal((await request('POST','verify-session',{cookie:'moliya_admin_session='+cookie()})).statusCode,403));
await test('malformed referer denied',async()=>assert.equal((await request('POST','verify-session',{...trusted(),referer:'not-a-url'})).statusCode,403));
await test('separate trusted dashboard cross-site request works',async()=>assert.equal((await request('POST','verify-session',{...trusted(),'sec-fetch-site':'cross-site'})).statusCode,200));
await test('referer-only trusted write works',async()=>assert.equal((await request('POST','verify-session',{cookie:'moliya_admin_session='+cookie(),referer:'https://admin.example/dashboard'})).statusCode,200));
for(const route of ['auto-broadcast','run-scheduled-reports'])await test('cookie GET cannot mutate through '+route,async()=>{assert.equal((await request('GET',route,trusted())).statusCode,405);assert.equal(writes,0)});
await test('revoked session denied',async()=>{activeSid=null;assert.equal((await request('GET','verify-session',trusted())).statusCode,401)});
await test('database outage denies admin session',async()=>{outage=true;assert.equal((await request('GET','verify-session',trusted())).statusCode,401)});
await test('expired cookie denied',async()=>assert.equal((await request('GET','verify-session',{cookie:'moliya_admin_session='+cookie({exp:Math.floor(Date.now()/1000)})})).statusCode,401));
await test('malformed cookie cannot crash endpoint',async()=>assert.equal((await request('GET','verify-session',{cookie:'moliya_admin_session=%E0%A4%A'})).statusCode,401));
await test('forged signature denied',async()=>assert.equal((await request('GET','verify-session',{cookie:'moliya_admin_session='+cookie()+ 'x'})).statusCode,401));
await test('browser cannot use permanent server key',async()=>assert.equal((await request('GET','verify-session',{origin:'https://admin.example','x-admin-key':process.env.ADMIN_SECRET_KEY})).statusCode,403));
await test('server key authentication still works',async()=>assert.equal((await request('GET','verify-session',{'x-admin-key':process.env.ADMIN_SECRET_KEY})).statusCode,200));
await test('non-string password rejected before database',async()=>{assert.equal((await request('POST','login',{origin:'https://admin.example'},{password:{}})).statusCode,400);assert.equal(writes,0)});
await test('missing Telegram OTP configuration denies login without cookie',async()=>{const r=await request('POST','login',{origin:'https://admin.example'},{password:process.env.ADMIN_SECRET_KEY});assert.equal(r.statusCode,503);assert.equal(r.headers['Set-Cookie'],undefined)});
await test('server key guessing cannot bypass login limit through a read route',async()=>{for(let i=0;i<20;i++)assert.equal((await request('GET','verify-session',{'x-admin-key':'wrong-key-'+i})).statusCode,401);assert.equal((await request('GET','verify-session',{'x-admin-key':'wrong-key-21'})).statusCode,429)});
function signed(fields:[string,string][]){const params=new URLSearchParams(fields);const check=[...params.keys()].sort().map(k=>`${k}=${params.get(k)}`).join('\n');const key=crypto.createHmac('sha256','WebAppData').update('test-bot-token').digest();params.set('hash',crypto.createHmac('sha256',key).update(check).digest('hex'));return params.toString();}
const date=String(Math.floor(Date.now()/1000));
await test('valid Telegram HMAC accepted',()=>assert.equal(verifyTelegramInitData(signed([['auth_date',date],['user','{"id":123}']]),'test-bot-token').isValid,true));
await test('signed duplicate Telegram fields rejected',()=>assert.equal(verifyTelegramInitData(signed([['auth_date',date],['auth_date',date],['user','{"id":123}']]),'test-bot-token').isValid,false));
await test('signed malformed timestamp rejected',()=>assert.equal(verifyTelegramInitData(signed([['auth_date',date+'junk'],['user','{"id":123}']]),'test-bot-token').isValid,false));
await test('signed missing user rejected',()=>assert.equal(verifyTelegramInitData(signed([['auth_date',date]]),'test-bot-token').isValid,false));
await test('signed non-numeric Telegram ID rejected',()=>assert.equal(verifyTelegramInitData(signed([['auth_date',date],['user','{"id":"123"}']]),'test-bot-token').isValid,false));
console.log(`${count} admin/auth boundary checks passed. No live services called.`);
