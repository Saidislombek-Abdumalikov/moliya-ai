import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
process.env.SUPABASE_URL='http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY='offline';
process.env.TELEGRAM_BOT_TOKEN='offline-token';
process.env.TELEGRAM_WEBHOOK_SECRET='offline-secret';
const { supabase } = await import('../api/_supabaseClient.js');
const { default: webhook } = await import('../api/telegram-webhook.js');
const { DEFAULT_OFERTA_TEXT, DEFAULT_PRIVACY_POLICY_TEXT, legalVersion } = await import('../api/_legalDocuments.js');
const adminSource=readFileSync(new URL('../../Admin-Dashboard/src/components/PrivacyPolicyTab.jsx',import.meta.url),'utf8');
assert.equal(adminSource.match(/export const DEFAULT_OFERTA_TEXT = `([\s\S]*?)`;/)?.[1],DEFAULT_OFERTA_TEXT);
assert.equal(adminSource.match(/export const DEFAULT_PRIVACY_POLICY_TEXT = `([\s\S]*?)`;/)?.[1],DEFAULT_PRIVACY_POLICY_TEXT);
let settings:any={oferta_text:'<Offer A & B>',privacy_policy:'Private A'};
let user:any={id:'moliya_user_tg_123',telegram_id:'123',onboarding:{language:'uz'},bot_verification:null,phone:null};
(supabase as any).from=(table:string)=>{
 assert.equal(table,'users'); let id=''; let patch:any=null;
 const q:any={select(){return q},eq(key:string,value:any){if(key==='id')id=value;return q},is(){return q},
 update(value:any){patch=value;return q},async maybeSingle(){
  if(id==='system_app_settings')return {data:{onboarding:settings},error:null};
  assert.equal(id,user.id);
  if(patch)user={...user,...patch};
  return {data:structuredClone(user),error:null};
 }};return q;
};
const sent:any[]=[];
globalThis.fetch=async(url:any,options:any)=>{
 assert.ok(String(url).startsWith('https://api.telegram.org/'));
 const method=String(url).split('/').at(-1); const body=options.body instanceof FormData ? Object.fromEntries(options.body.entries()) : JSON.parse(options.body);
 if(typeof body.reply_markup==='string')body.reply_markup=JSON.parse(body.reply_markup);
 sent.push({method,body});return {ok:true,json:async()=>({ok:true,result:{message_id:sent.length}})} as any;
};
async function callback(data:string,chat=123){
 const req:any={method:'POST',headers:{'x-telegram-bot-api-secret-token':'offline-secret'},body:{update_id:99,callback_query:{id:'cb',from:{id:123},message:{message_id:50,chat:{id:chat,type:chat<0?'supergroup':'private'}},data}}};
 const res:any={statusCode:200,setHeader(){},status(n:number){this.statusCode=n;return this},json(body:any){this.body=body;return this}};
 await webhook(req,res);return res;
}
assert.equal((await callback('privacy_read')).body.status,'oferta_required');
const docs=sent.filter(x=>x.method==='sendDocument');
assert.equal(docs.length,1);
assert.ok(docs[0].body.document instanceof Blob);
assert.ok(docs[0].body.caption.length<200);
const oldButton=docs.at(-1).body.reply_markup.inline_keyboard[0][0].callback_data;
assert.equal(oldButton,`accept_oferta:${legalVersion(settings.oferta_text,settings.privacy_policy).slice(7,31)}`);
assert.equal(user.bot_verification,null);
assert.equal((await callback('accept_oferta')).body.status,'oferta_required');
assert.equal(user.bot_verification,null);
assert.equal((await callback(oldButton,-100)).body.status,'denied');
assert.equal(user.bot_verification,null);
settings={...settings,privacy_policy:'Private B'};
assert.equal((await callback(oldButton)).body.status,'oferta_required');
assert.equal(user.bot_verification,null);
const newButton=sent.filter(x=>x.method==='sendDocument').at(-1).body.reply_markup.inline_keyboard[0][0].callback_data;
assert.notEqual(newButton,oldButton);
assert.equal((await callback(newButton)).body.status,'phone_requested');
assert.equal(user.bot_verification.consent_source,'telegram_button');
assert.equal(user.bot_verification.consent_version,legalVersion(settings.oferta_text,settings.privacy_policy));
settings={};
const fallbackStart=sent.length;
assert.equal((await callback('privacy_read')).body.status,'oferta_required');
const fallback=sent.slice(fallbackStart).filter(x=>x.method==='sendDocument');
assert.equal(fallback.length,1);
assert.ok(fallback[0].body.document.size>0);
assert.equal(fallback.at(-1).body.reply_markup.inline_keyboard[0][0].callback_data,
 `accept_oferta:${legalVersion(DEFAULT_OFERTA_TEXT,DEFAULT_PRIVACY_POLICY_TEXT).slice(7,31)}`);
console.log('Bot legal consent: single document delivery, stale buttons, private chat and versioned proof passed.');
