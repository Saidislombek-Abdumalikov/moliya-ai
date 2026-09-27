import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
process.env.SUPABASE_URL='http://127.0.0.1:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY='offline'
process.env.ADMIN_SECRET_KEY='offline-admin-session-signing-key'
process.env.ADMIN_PASSWORD='offline-separate-admin-password'
process.env.ADMIN_TELEGRAM_ID='123456789'
process.env.TELEGRAM_BOT_TOKEN='offline-telegram-bot'
process.env.ADMIN_ALLOWED_ORIGINS='https://admin.example'
const {supabase}=await import('../api/_supabaseClient.js')
const {default:admin}=await import('../api/admin.js')
const db=new PGlite()
await db.exec('CREATE TABLE users(id text PRIMARY KEY,device_info jsonb,platform text,updated_at timestamptz)')
let failStore=false
;(supabase as any).from=(table:string)=>{
 assert.equal(table,'users')
 let mode='select',payload:any,filters:Array<[string,string,any]>=[]
 const q:any={select(){return q},eq(key:string,value:any){filters.push(['eq',key,value]);return q},is(key:string,value:any){filters.push(['is',key,value]);return q},update(value:any){mode='update';payload=value;return q},insert(value:any){mode='insert';payload=value;return q},async maybeSingle(){const result=await run();return {...result,data:result.data?.[0]??null}},then(ok:any,bad:any){return run().then(ok,bad)}}
 async function run(){
  if(failStore)return {data:null,error:{message:'offline'}}
  const args:any[]=[];const param=(v:any)=>{args.push(v);return '$'+args.length}
  const where=()=>filters.map(([kind,key,value])=>kind==='is'?`"${key}" IS NULL`:`"${key}"=${param(key==='device_info'?JSON.parse(value):value)}${key==='device_info'?'::jsonb':''}`).join(' AND ')
  let sql=''
  if(mode==='select')sql='SELECT id,device_info FROM users WHERE '+where()
  if(mode==='insert')sql=`INSERT INTO users(id,device_info,platform,updated_at) VALUES (${param(payload.id)},${param(payload.device_info)}::jsonb,${param(payload.platform)},${param(payload.updated_at)}) RETURNING id`
  if(mode==='update')sql=`UPDATE users SET device_info=${param(payload.device_info)}::jsonb,updated_at=${param(payload.updated_at)} WHERE ${where()} RETURNING id`
  try{return {data:(await db.query(sql,args)).rows,error:null}}catch(error){return {data:null,error:{message:String(error)}}}
 }
 return q
}
let telegramCode='',deliver=true
const originalFetch=globalThis.fetch
globalThis.fetch=async (_url:any,options:any)=>{
 if(!deliver)throw new Error('telegram offline')
 const body=JSON.parse(options.body)
 assert.equal(body.chat_id,'123456789')
 telegramCode=body.text.match(/\b[0-9]{6}\b/)?.[0]||''
 return {ok:true,json:async()=>({ok:true})} as any
}
let serial=0
async function request(route:string,body:any={},headers:any={},method='POST'){
 const req:any={method,query:{route},body,headers:{origin:'https://admin.example',host:'api.example','x-forwarded-proto':'https','x-forwarded-for':'otp-'+(++serial),...headers},socket:{remoteAddress:'127.0.0.1'}}
 const res:any={statusCode:200,headers:{},setHeader(k:string,v:any){this.headers[k]=v},status(n:number){this.statusCode=n;return this},json(value:any){this.body=value;return this}}
 await admin(req,res);return res
}
try{
 assert.equal((await request('login',{password:'wrong'})).statusCode,401)
 assert.equal((await request('verify-otp',{challengeId:'a'.repeat(48),code:'123456'})).statusCode,401)
 assert.equal((await request('login',{password:process.env.ADMIN_PASSWORD},{origin:'https://evil.example'})).statusCode,403)
 failStore=true;assert.equal((await request('login',{password:process.env.ADMIN_PASSWORD})).statusCode,503);failStore=false
 const first=await request('login',{password:process.env.ADMIN_PASSWORD})
 assert.equal(first.statusCode,200);assert.equal(first.headers['Set-Cookie'],undefined)
 assert.equal(first.body.requireOtp,true);assert.match(first.body.challengeId,/^[a-f0-9]{48}$/)
 let state=(await db.query<any>("SELECT device_info FROM users WHERE id='admin_session_state'")).rows[0].device_info
 assert.notEqual(state.pending_otp.hash,telegramCode)
 assert.equal((await request('login',{password:process.env.ADMIN_PASSWORD})).statusCode,429)
 assert.equal((await request('verify-otp',{challengeId:first.body.challengeId,code:'000000'})).statusCode,401)
 const valid=await request('verify-otp',{challengeId:first.body.challengeId,code:telegramCode})
 assert.equal(valid.statusCode,200)
 assert.match(valid.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=None/)
 assert.equal(valid.body.sessionToken,undefined)
 const sessionCookie=valid.headers['Set-Cookie'].split(';')[0]
 assert.equal((await request('verify-session',{}, {cookie:sessionCookie},'GET')).body.authenticated,true)
 assert.equal((await request('verify-otp',{challengeId:first.body.challengeId,code:telegramCode})).statusCode,401)
 state=(await db.query<any>("SELECT device_info FROM users WHERE id='admin_session_state'")).rows[0].device_info
 assert.equal(state.pending_otp,null)
 const activeSid=state.active_sid
 // A new password challenge must not revoke the current admin session.
 await db.query("UPDATE users SET device_info=jsonb_set(device_info,'{pending_otp,created_at}',to_jsonb(0::int)) WHERE id='admin_session_state'")
 deliver=false
 assert.equal((await request('login',{password:process.env.ADMIN_PASSWORD})).statusCode,503)
 state=(await db.query<any>("SELECT device_info FROM users WHERE id='admin_session_state'")).rows[0].device_info
 assert.equal(state.active_sid,activeSid)
 assert.equal((await request('verify-session',{}, {cookie:sessionCookie},'GET')).body.authenticated,true)
 assert.equal(state.pending_otp,null)
 deliver=true
 const last=await request('login',{password:process.env.ADMIN_PASSWORD})
 assert.equal(last.statusCode,200)
 await db.query("UPDATE users SET device_info=jsonb_set(device_info,'{pending_otp,expires_at}',to_jsonb(0::int)) WHERE id='admin_session_state'")
 assert.equal((await request('verify-otp',{challengeId:last.body.challengeId,code:telegramCode})).statusCode,401)
 await db.query("UPDATE users SET device_info=jsonb_set(device_info,'{pending_otp,created_at}',to_jsonb(0::int)) WHERE id='admin_session_state'")
 const attempts=await request('login',{password:process.env.ADMIN_PASSWORD})
 assert.equal(attempts.statusCode,200)
 const wrongCode=telegramCode==='999999'?'000000':'999999'
 for(let i=0;i<5;i++)assert.equal((await request('verify-otp',{challengeId:attempts.body.challengeId,code:wrongCode})).statusCode,401)
 assert.equal((await request('verify-otp',{challengeId:attempts.body.challengeId,code:telegramCode})).statusCode,401)
 const adminClient=await import('../../Admin-Dashboard/src/services/userService.js')
 const calls:any[]=[]
 globalThis.fetch=async (url:any,options:any)=>{
  calls.push({url,body:JSON.parse(options.body),credentials:options.credentials})
  return {ok:true,json:async()=>String(url).includes('verify-otp')?{success:true}:{success:true,requireOtp:true,challengeId:'a'.repeat(48)}} as any
 }
 assert.equal((await adminClient.loginAdmin('sample-long-password')).requireOtp,true)
 assert.equal((await adminClient.verifyAdminOtp('a'.repeat(48),'123456')).success,true)
 assert.deepEqual(calls.map(c=>c.url),['/api/admin?route=login','/api/admin?route=verify-otp'])
 assert.ok(calls.every(c=>c.credentials==='include'))
 console.log('Admin OTP: password gate, delivery, hash, cookie, replay, expiry, active session and browser API checks passed.')
}finally{globalThis.fetch=originalFetch;await db.close()}
