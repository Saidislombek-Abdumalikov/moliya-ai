import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
process.env.SUPABASE_URL='http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY='offline';
process.env.TELEGRAM_BOT_TOKEN='offline-token';
process.env.TELEGRAM_WEBHOOK_SECRET='offline-secret';
const {supabase}=await import('../api/_supabaseClient.js');
const {messageDeliveryKey,claimBotMessage,completeBotMessage}=await import('../api/services/_botMessageDelivery.js');
const {default:webhook}=await import('../api/telegram-webhook.js');
const db=new PGlite();
await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
const sql=await readFile(new URL('../migrations/12-bot-message-delivery.sql',import.meta.url),'utf8');
await db.exec(sql);await db.exec(sql);
const raw=async(key:string,owner:string,action:string)=>(await db.query<{value:string}>(
  'SELECT public.moliya_bot_message_delivery($1,$2,$3) AS value',[key,owner,action])).rows[0].value;
const owner='a'.repeat(32),other='b'.repeat(32);
assert.equal(await raw('msg:123:1',owner,'claim'),'claimed');
assert.equal(await raw('msg:123:1',other,'claim'),'busy');
assert.equal(await raw('msg:123:1',other,'complete'),'lost');
assert.equal(await raw('msg:123:1',owner,'complete'),'done');
assert.equal(await raw('msg:123:1',other,'claim'),'done');
assert.equal(await raw('msg:123:2',owner,'claim'),'claimed');
await db.exec("UPDATE moliya_bot_inbound SET lease_until=clock_timestamp()-interval '1 second' WHERE message_key='msg:123:2'");
assert.equal(await raw('msg:123:2',other,'claim'),'claimed');
assert.equal(await raw('msg:123:2',owner,'complete'),'lost');
assert.equal(await raw('msg:123:2',other,'complete'),'done');
for(const key of ['msg:bad:4','msg:1:0'+('x'.repeat(100))])assert.equal(await raw(key,owner,'claim'),'invalid');
assert.equal(messageDeliveryKey({message:{chat:{id:123},message_id:4}}),'msg:123:4');
assert.equal(messageDeliveryKey({edited_message:{chat:{id:123},message_id:4}}),'msg:123:4');
assert.equal(messageDeliveryKey({callback_query:{id:'abc'}}),null);
for(const role of ['anon','authenticated']) {
  await db.exec(`SET ROLE ${role}`);
  try {
    await assert.rejects(db.query('SELECT * FROM moliya_bot_inbound'),/permission denied/);
    await assert.rejects(raw('msg:123:3',owner,'claim'),/permission denied/);
  } finally {await db.exec('RESET ROLE');}
}
let quotaCalls=0;
(supabase as any).rpc=async(name:string,args:any)=>{
  if(name==='moliya_ai_quota') {
    quotaCalls++;
    return {data:{allowed:true,isPremium:false,isTrial:false,limit:2,usedCount:1},error:null};
  }
  assert.equal(name,'moliya_bot_message_delivery');
  return {data:await raw(args.p_key,args.p_owner,args.p_action),error:null};
};
let telegramMessages=0;
globalThis.fetch=async(url:any)=>{
  if(String(url).includes('/sendMessage'))telegramMessages++;
  return {json:async()=>({ok:true,result:{message_id:900}})} as any;
};
function response(){return {statusCode:200,body:null as any,setHeader(){},status(n:number){this.statusCode=n;return this},json(body:any){this.body=body;return this}};}
async function send(messageId:number){
 const req:any={method:'POST',headers:{'x-telegram-bot-api-secret-token':'offline-secret'},body:{update_id:messageId,message:{chat:{id:123},message_id:messageId}}};
 const res=response();await webhook(req,res as any);return res;
}
const first=await send(44);assert.equal(first.statusCode,200);assert.equal(first.body.status,'invalid_chat');
const repeat=await send(44);assert.equal(repeat.statusCode,200);assert.equal(repeat.body.status,'duplicate');
const savedRpc=(supabase as any).rpc;(supabase as any).rpc=async()=>({data:null,error:{message:'PRIVATE_DB_ERROR'}});
const outage=await send(45);assert.equal(outage.statusCode,503);
assert.equal(JSON.stringify(outage.body).includes('PRIVATE_DB_ERROR'),false);
(supabase as any).rpc=savedRpc;
assert.equal((await send(45)).body.status,'invalid_chat');

let profile:any={id:'moliya_user_tg_123',telegram_id:'123',phone:'+998901234567',
  onboarding:{language:'uz',completed:true},device_info:{},
  bot_verification:{telegram_id:'123',phone:'+998901234567',phone_source:'telegram_own_contact',
    phone_verified_at:'2026-01-01',consent_source:'telegram_button',consent_version:'1',consent_accepted_at:'2026-01-01'}};
(supabase as any).from=(table:string)=>{
  if(table==='ai_logs')return {insert:async()=>({error:null})};
  assert.equal(table,'users');let id='';let patch:any=null;
  const q:any={select(){return q},eq(field:string,value:any){if(field==='id')id=value;return q},is(){return q},
    update(value:any){patch=value;return q},async maybeSingle(){
      if(id.startsWith('restricted_'))return {data:null,error:null};
      assert.equal(id,profile.id);
      if(patch)profile={...profile,...patch};
      return {data:structuredClone(profile),error:null};
    }};return q;
};
async function voice(){
  const req:any={method:'POST',headers:{'x-telegram-bot-api-secret-token':'offline-secret'},
    body:{update_id:77,message:{message_id:77,chat:{id:123},from:{id:123},voice:{file_id:'voice1',duration:2}}}};
  const res=response();await webhook(req,res as any);return res;
}
assert.equal((await voice()).body.status,'ok');
const messagesAfterFirst=telegramMessages;
assert.equal(quotaCalls,1);
assert.equal((await voice()).body.status,'duplicate');
assert.equal(quotaCalls,1);
assert.equal(telegramMessages,messagesAfterFirst);
await db.close();
console.log('Bot delivery: durable claim, lease, replay, permissions, webhook and store failure passed.');
