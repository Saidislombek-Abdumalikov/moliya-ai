import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {cleanPlannedPayments,paymentReminderKind,nextUnseenPaymentReminder,paymentRecordId,nextPayment,tomorrowDay} from '../shared/plannedPayments.js';
import {normalizeAssistantReply,assistantActionIssue} from '../shared/assistant.js';
import {withBotAppLinks} from '../api/_telegramKeyboard.js';
process.env.SUPABASE_URL='http://127.0.0.1:54321';process.env.SUPABASE_SERVICE_ROLE_KEY='offline';process.env.TELEGRAM_BOT_TOKEN='offline';
const {supabase}=await import('../api/_supabaseClient.js');
const {installFakeBotMessages:__ifb}=await import('./_fakeBotMessages.js');const botStore=__ifb(supabase);
const {deliverPlannedReminder}=await import('../api/services/_plannedReminderService.js');
const db=new PGlite();await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE TABLE users(id text PRIMARY KEY);');
await db.exec(fs.readFileSync(new URL('../migrations/22-planned-reminders.sql',import.meta.url),'utf8'));
const plan=cleanPlannedPayments([{id:'wifi',title:'Wi-Fi',amount:165000,dueDate:'2026-10-10',repeat:'monthly',createdDay:'2026-10-01',time:'18:30',icon:'wifi'}])[0];
const user:any={id:'moliya_user_tg_123',telegram_id:'123',phone:'+998901234567',bot_verification:{telegram_id:'123',phone:'+998901234567',phone_source:'telegram_own_contact',phone_verified_at:'2026-01-01',consent_source:'telegram_button',consent_version:'1',consent_accepted_at:'2026-01-01'},transactions:[],onboarding:{planned_payments:[plan]}};
await db.query('INSERT INTO users VALUES ($1)',[user.id]);
assert.equal(paymentReminderKind(plan,'2026-10-06',[]),null);
assert.equal(paymentReminderKind(plan,'2026-10-07',[]),'early');
assert.equal(paymentReminderKind({...plan,createdDay:'2026-10-08'},'2026-10-08',[]),null);
assert.equal(paymentReminderKind({...plan,snoozedUntil:'2026-10-11'},'2026-10-10',[]),null);
assert.equal(paymentReminderKind({...plan,snoozedUntil:'2026-10-11'},'2026-10-11',[]),'due');
assert.equal(paymentReminderKind(plan,'2026-10-11',[{id:paymentRecordId(plan)}]),null);
assert.equal(nextPayment({...plan,snoozedUntil:'2026-10-11'})?.snoozedUntil,undefined);
assert.equal(tomorrowDay('2026-12-31'),'2027-01-01');
const second={...plan,id:'rent'};
assert.equal(nextUnseenPaymentReminder([plan,second],'2026-10-10',[],p=>p.id==='wifi')?.id,'rent');
assert.equal(nextUnseenPaymentReminder([plan,second],'2026-10-10',[],()=>true),undefined);
assert.equal(nextUnseenPaymentReminder([plan,second],'2026-10-10',[{id:paymentRecordId(second)}],p=>p.id==='wifi'),undefined);
let restricted=false,calls=0,networkMode='ok';
(supabase as any).from=(table:string)=>{
 let op='select',payload:any,filters:any={};
 const q:any={select(){return q},eq(k:string,v:any){filters[k]=v;return q},is(k:string,v:any){filters[k]=v;return q},match(v:any){filters=v;return q},insert(v:any){op='insert';payload=v;return q},update(v:any){op='update';payload=v;return q},delete(){op='delete';return q},maybeSingle(){return q},then(resolve:any,reject:any){return exec().then(resolve,reject)}};
 async function exec(){
  if(table==='users'){if(String(filters.id).startsWith('restricted_'))return {data:restricted?{onboarding:{is_blocked:true}}:null,error:null};if(op==='update')Object.assign(user,payload);return {data:user,error:null};}
  assert.equal(table,'moliya_planned_delivery');
  const cols=['user_id','plan_id','due_date','delivery_day','kind'];
  try{if(op==='insert')await db.query(`INSERT INTO moliya_planned_delivery (${cols.join(',')}) VALUES ($1,$2,$3,$4,$5)`,cols.map(c=>payload[c]));else{const where=cols.map((c,i)=>`${c}=$${i+1}`).join(' AND ');if(op==='delete')await db.query('DELETE FROM moliya_planned_delivery WHERE '+where,cols.map(c=>filters[c]));else if(op==='update')await db.query('UPDATE moliya_planned_delivery SET status=$6 WHERE '+where,[...cols.map(c=>filters[c]),payload.status]);}return {data:null,error:null};}catch(e:any){return {data:null,error:{code:e.code}};}
 }
 return q;
};
(globalThis as any).fetch=async(_url:string,options:any)=>{calls++;const body=JSON.parse(options.body);assert.match(body.text,/18:30/);assert.match(body.reply_markup.inline_keyboard[0][0].web_app.url,/paymentId=wifi/);if(networkMode==='unknown')throw Error('network');return {json:async()=>({ok:true,result:{message_id:calls}})};};
const parallel=await Promise.all(Array.from({length:8},()=>deliverPlannedReminder(user,plan,'2026-10-07')));
assert.equal(parallel.filter(x=>x==='sent').length,1);assert.equal(calls,1);
assert.equal(await deliverPlannedReminder(user,plan,'2026-10-08'),'duplicate');
assert.equal(await deliverPlannedReminder(user,plan,'2026-10-10'),'sent');
assert.equal(await deliverPlannedReminder(user,plan,'2026-10-11'),'sent');
user.transactions=[{id:paymentRecordId(plan)}];assert.equal(await deliverPlannedReminder(user,plan,'2026-10-12'),'skipped');
user.transactions=[];restricted=true;assert.equal(await deliverPlannedReminder(user,plan,'2026-10-13'),'skipped');restricted=false;
networkMode='unknown';assert.equal(await deliverPlannedReminder(user,plan,'2026-10-14'),'failed');assert.equal(await deliverPlannedReminder(user,plan,'2026-10-14'),'duplicate');
const a=normalizeAssistantReply({transcription:'Men kecha 18:30 da Wi-Fi uchun 165 ming to‘ladim',actions:[{kind:'expense',amount:165000,currency:'UZS',title:'Wi-Fi',note:'Short title',date:'2026-10-06',time:'18:30'}]}).actions[0];
assert.match(a.note!,/^Men kecha/);assert.equal(a.time,'18:30');assert.equal(assistantActionIssue(a),null);assert.match(assistantActionIssue({...a,time:'25:00'})!,/Vaqt/);
const links=withBotAppLinks({inline_keyboard:[[{text:'Tahlil',web_app:{url:'https://example.test/?screen=analytics'}}]]},'https://example.test');assert.equal(links.inline_keyboard.at(-1)[0].url,'https://example.test/?screen=analytics');
await db.close();console.log('Planned reminders: timing policy, daily retry, paid suppression, atomic dedup, restrictions, ambiguous delivery, full transcript/time and deep links passed. Offline SQL and mocked Telegram.');
