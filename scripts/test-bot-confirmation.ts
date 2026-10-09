import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
process.env.SUPABASE_URL='http://127.0.0.1:54321';process.env.SUPABASE_SERVICE_ROLE_KEY='offline';
const {supabase}=await import('../api/_supabaseClient.js');
const {stageBotDraft,resolveBotDraft,saveBotMessageTransactions}=await import('../api/services/_botDraftService.js');
globalThis.fetch=async()=>{throw new Error('NETWORK_FORBIDDEN')};
const db=new PGlite();
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
CREATE TABLE users(id text PRIMARY KEY, telegram_id text, phone text, onboarding jsonb DEFAULT '{}',device_info jsonb DEFAULT '{}',bot_verification jsonb,is_blocked boolean DEFAULT false,is_restricted boolean DEFAULT false,is_deleted boolean DEFAULT false,account_status text,transactions jsonb DEFAULT '[]',cards jsonb DEFAULT '[]',updated_at timestamptz);`);
for(const file of ['03-financial-writes','04-atomic-card-operations','06-financial-eligibility','07-session-financial-writes','08-destructive-user-actions','09-bot-transaction-confirmation']){
 const sql=await readFile(new URL('../migrations/'+file+'.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
}
const user='moliya_user_tg_123',other='moliya_user_tg_456';let count=0;
async function seed(){
 await db.exec('TRUNCATE users CASCADE');
 for(const id of [user,other])await db.query(`INSERT INTO users(id,telegram_id,phone,bot_verification) VALUES ($1,$2,'+998901234567',$3)`,[id,id.split('_').at(-1),JSON.stringify({telegram_id:id.split('_').at(-1),phone:'+998901234567',phone_source:'telegram_own_contact',phone_verified_at:'2026-01-01',consent_source:'telegram_button',consent_version:'1',consent_accepted_at:'2026-01-01'})]);
}
async function rpc(uid:string,id:string,action:string,payload:any=null){return (await db.query<any>('SELECT moliya_bot_draft($1,$2,$3,$4::jsonb) AS result',[uid,id,action,JSON.stringify(payload)])).rows[0].result}
(supabase as any).rpc=async(name:string,args:any)=>{assert.equal(name,'moliya_bot_draft');return {data:await rpc(args.p_user_id,args.p_id,args.p_action,args.p_payload),error:null}};
async function transactions(uid=user){return (await db.query<any>('SELECT transactions FROM users WHERE id=$1',[uid])).rows[0]?.transactions}
const items=[{type:'expense',amount:30000,title:'Taksi',date:'2026-09-25'}];
async function stage(input=items,msg=5){return stageBotDraft(user,123,msg,input)}
async function test(name:string,fn:()=>Promise<any>){await seed();await fn();count++;console.log('PASS '+name)}
await test('automatic save commits once without a user confirmation',async()=>{
 const a=await saveBotMessageTransactions(user,123,501,items);
 assert.equal(a.status,'confirmed');assert.equal((await transactions()).length,1);
 const b=await saveBotMessageTransactions(user,123,501,items);
 assert.equal(b.replayed,true);assert.equal((await transactions()).length,1);
});
await test('automatic save keeps all four financial types and signs',async()=>{
 await saveBotMessageTransactions(user,123,502,['expense','income','debt','lending'].map(type=>({type,amount:50000,date:'2026-09-28',title:type})));
 assert.deepEqual((await transactions()).map((tx:any)=>[tx.type,tx.amount]),[['expense',-50000],['income',50000],['debt',50000],['lending',-50000]]);
});
await test('draft is not a financial write',async()=>{const d=await stage();assert.equal(d.status,'pending');assert.deepEqual(await transactions(),[]);assert.equal(d.transactions[0].amount,-30000)});
await test('same Telegram message freezes the first preview',async()=>{const a=await stage();const b=await stage([{...items[0],amount:99999}]);assert.equal(a.id,b.id);assert.deepEqual(a.transactions,b.transactions)});
await test('confirm saves once under repeated concurrent requests',async()=>{const d=await stage();const replies=await Promise.all(Array.from({length:20},()=>resolveBotDraft(user,d.id,'confirm')));assert.ok(replies.every(x=>x.status==='confirmed'));assert.equal((await transactions()).length,1);assert.equal(replies.filter(x=>!x.replayed).length,1)});
await test('different messages with same content remain distinct',async()=>{for(const msg of [5,6]){const d=await stage(items,msg);await resolveBotDraft(user,d.id,'confirm')}assert.equal((await transactions()).length,2)});
await test('cancel prevents subsequent confirm',async()=>{const d=await stage();assert.equal((await resolveBotDraft(user,d.id,'cancel')).status,'cancelled');assert.equal((await resolveBotDraft(user,d.id,'confirm')).status,'cancelled');assert.deepEqual(await transactions(),[])});
await test('foreign owner cannot confirm or cancel',async()=>{const d=await stage();assert.equal((await resolveBotDraft(other,d.id,'confirm')).status,'missing');assert.equal((await resolveBotDraft(other,d.id,'cancel')).status,'missing');assert.deepEqual(await transactions(),[]);assert.deepEqual(await transactions(other),[])});
await test('expiry refuses writes and cannot be renewed by replay',async()=>{const d=await stage();await db.query("UPDATE moliya_bot_drafts SET expires_at=clock_timestamp()-interval '1 second'");assert.equal((await resolveBotDraft(user,d.id,'confirm')).status,'expired');assert.equal((await stage()).status,'expired');assert.deepEqual(await transactions(),[])});
await test('blocked after preview cannot confirm',async()=>{const d=await stage();await db.query('UPDATE users SET is_blocked=true WHERE id=$1',[user]);assert.equal((await resolveBotDraft(user,d.id,'confirm')).status,'denied');assert.deepEqual(await transactions(),[])});
await test('removed consent after preview cannot confirm',async()=>{const d=await stage();await db.query("UPDATE users SET bot_verification='{}' WHERE id=$1",[user]);assert.equal((await resolveBotDraft(user,d.id,'confirm')).status,'denied');assert.deepEqual(await transactions(),[])});
await test('account deletion removes pending drafts',async()=>{const d=await stage();await db.query('DELETE FROM users WHERE id=$1',[user]);assert.equal((await rpc(user,d.id,'confirm')).status,'missing');assert.equal((await db.query('SELECT * FROM moliya_bot_drafts')).rows.length,0)});
await test('a batch confirms all entries together',async()=>{const d=await stage([...items,{type:'income',amount:100000,title:'Maosh',date:'2026-09-25'}]);await resolveBotDraft(user,d.id,'confirm');assert.deepEqual((await transactions()).map((t:any)=>t.amount),[-30000,100000])});
await test('financial conflict does not consume draft or partially append',async()=>{const d=await stage([...items,{...items[0],amount:5}]);await db.query('UPDATE users SET transactions=$1 WHERE id=$2',[JSON.stringify([{...d.transactions[1],amount:7}]),user]);assert.equal((await resolveBotDraft(user,d.id,'confirm')).status,'denied');assert.equal((await transactions()).length,1);assert.equal((await stage()).status,'pending')});
await test('database failure rolls back money and draft together',async()=>{const d=await stage();await db.exec(`CREATE FUNCTION reject_confirm() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='confirmed' THEN RAISE EXCEPTION 'offline failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_confirm BEFORE UPDATE ON moliya_bot_drafts FOR EACH ROW EXECUTE FUNCTION reject_confirm();`);await assert.rejects(resolveBotDraft(user,d.id,'confirm'));assert.deepEqual(await transactions(),[]);assert.equal((await stage()).status,'pending');await db.exec('DROP TRIGGER reject_confirm ON moliya_bot_drafts; DROP FUNCTION reject_confirm();')});
await test('confirm/cancel race has one terminal outcome',async()=>{const d=await stage();const results=await Promise.all([resolveBotDraft(user,d.id,'cancel'),resolveBotDraft(user,d.id,'confirm')]);assert.equal(results[0].status,results[1].status);assert.deepEqual(await transactions(),[])});
await test('replay after user deletes the saved transaction cannot restore it',async()=>{const d=await stage();await resolveBotDraft(user,d.id,'confirm');await db.query("UPDATE users SET transactions='[]' WHERE id=$1",[user]);assert.equal((await resolveBotDraft(user,d.id,'confirm')).replayed,true);assert.deepEqual(await transactions(),[])});
await test('invalid identity, amount, empty or oversized batch rejected',async()=>{await assert.rejects(stageBotDraft(user,456,5,items));await assert.rejects(stageBotDraft(user,123,0,items));for(const amount of [0,NaN,Infinity,1e13])await assert.rejects(stage([{...items[0],amount}]));await assert.rejects(stage([]));await assert.rejects(stage(Array(11).fill(items[0])))});
await test('browser roles cannot read drafts or execute confirmation',async()=>{for(const role of ['anon','authenticated']){const row=(await db.query<any>(`SELECT has_table_privilege($1,'moliya_bot_drafts','SELECT') AS r,has_function_privilege($1,'moliya_bot_draft(text,text,text,jsonb)','EXECUTE') AS e`,[role])).rows[0];assert.equal(row.r,false);assert.equal(row.e,false)}});

await test('pending draft cap bounds active previews',async()=>{for(let i=1;i<=20;i++)await stage(items,i);await assert.rejects(stage(items,21));assert.deepEqual(await transactions(),[])});
await test('malformed RPC payload cannot become a draft',async()=>{for(const payload of [null,{},[],[{id:'bad',amount:1,type:'expense'}]])assert.equal((await rpc(user,'a'.repeat(32),'stage',payload)).status,'invalid')});
// Exercise the actual webhook callback route with Telegram transport mocked.
process.env.TELEGRAM_BOT_TOKEN='offline-token';process.env.TELEGRAM_WEBHOOK_SECRET='offline-secret';
const {default:handler}=await import('../api/telegram-webhook.js');
const sent:Array<{method:string;body:any}>=[];
globalThis.fetch=async(url:any,options:any)=>{assert.ok(String(url).startsWith('https://api.telegram.org/'));sent.push({method:String(url).split('/').at(-1)!,body:JSON.parse(options?.body||'{}')});return {json:async()=>({ok:true,result:{}})} as any};
(supabase as any).from=(table:string)=>{assert.equal(table,'users');let uid=user;const q:any={select(){return q},update(){return q},eq(k:string,v:any){if(k==='id')uid=v;return q},is(){return q},async maybeSingle(){return {data:(await db.query('SELECT * FROM users WHERE id=$1',[uid])).rows[0]||null,error:null}}};return q};
async function callback(id:string,actor=123,chat=actor,secret='offline-secret'){
 const req:any={method:'POST',headers:{'x-telegram-bot-api-secret-token':secret},body:{update_id:55,callback_query:{id:'callback',from:{id:actor},message:{message_id:100,chat:{id:chat}},data:'txok_'+id}}};
 const res:any={statusCode:200,setHeader(){},status(n:number){this.statusCode=n;return this},json(body:any){this.body=body;return this}};
 await handler(req,res);return res;
}
await test('webhook requires its secret before confirming',async()=>{const d=await stage();assert.equal((await callback(d.id,123,123,'wrong')).statusCode,401);assert.deepEqual(await transactions(),[])});
await test('webhook binds sender and private chat',async()=>{const d=await stage();assert.equal((await callback(d.id,456)).body.status,'missing');assert.equal((await callback(d.id,123,-100)).body.status,'denied');assert.deepEqual(await transactions(),[])});
await test('webhook confirms once and preserves unrelated pending buttons',async()=>{
 const d=await stage([{...items[0],title:'<b>fake</b>'}]);
 await db.query('UPDATE users SET onboarding=$1 WHERE id=$2',[JSON.stringify({bot_messages:[{message_id:99,type:'ai_response'}],last_temp_msg_id:99,last_system_message_id:99}),user]);
 sent.length=0;assert.equal((await callback(d.id)).body.status,'confirmed');assert.equal((await transactions()).length,1);
 assert.ok(sent.some(x=>x.method==='editMessageText' && x.body.text.includes('&lt;b&gt;fake&lt;/b&gt;')));
 assert.equal(sent.filter(x=>x.method==='editMessageReplyMarkup').length,0);
 const edits=sent.filter(x=>x.method==='editMessageText').length;
 assert.equal((await callback(d.id)).body.status,'confirmed');assert.equal((await transactions()).length,1);
 assert.equal(sent.filter(x=>x.method==='editMessageText').length,edits);
});
await test('webhook database outage returns retryable failure without a write',async()=>{const d=await stage();const savedRpc=(supabase as any).rpc;(supabase as any).rpc=async()=>({data:null,error:{message:'private database detail'}});try{const res=await callback(d.id);assert.equal(res.statusCode,503);assert.equal(JSON.stringify(res.body).includes('private'),false);assert.deepEqual(await transactions(),[])}finally{(supabase as any).rpc=savedRpc}});
// Full inbound message -> shared parser -> confirmation (receipt remains legacy autosave), transports mocked.
await db.exec(await readFile(new URL('../migrations/12-bot-message-delivery.sql',import.meta.url),'utf8'));
const {encodeWav}=await import('../src/audioRecorder.js');
const wav=Buffer.from(await encodeWav(new Float32Array(16000)).arrayBuffer());
(supabase as any).rpc=async(name:string,args:any)=>{
 if(name==='moliya_financial_write')return {data:(await db.query<any>('SELECT moliya_financial_write($1,$2,$3::jsonb,$4::jsonb) AS v',[args.p_user_id,args.p_action,JSON.stringify(args.p_payload),JSON.stringify(args.p_expected)])).rows[0].v,error:null};
 if(name==='moliya_ai_quota')return {data:{allowed:true,isPremium:true,isTrial:false,limit:null,usedCount:1},error:null};
 if(name==='moliya_bot_message_delivery')return {data:(await db.query<any>('SELECT moliya_bot_message_delivery($1,$2,$3) AS v',[args.p_key,args.p_owner,args.p_action])).rows[0].v,error:null};
 assert.equal(name,'moliya_bot_draft');return {data:await rpc(args.p_user_id,args.p_id,args.p_action,args.p_payload),error:null};
};
(supabase as any).from=(table:string)=>{
 let uid=user,patch:any=null;
 const execute=async()=>{
  if(table==='ai_logs')return {data:null,error:null};
  if(table==='ai_keys')return {data:[{id:'test-ai',api_key:'test-only',provider:'google',is_active:true}],error:null};
  assert.equal(table,'users');
  if(patch){for(const field of ['onboarding','device_info'])if(field in patch)await db.query(`UPDATE users SET ${field}=$1::jsonb WHERE id=$2`,[JSON.stringify(patch[field]),uid]);}
  return {data:(await db.query('SELECT * FROM users WHERE id=$1',[uid])).rows[0] || null,error:null};
 };
 const q:any={like(){return q},select(){return q},update(v:any){patch=v;return q},insert(){return q},eq(k:string,v:any){if(k==='id')uid=v;return q},is(){return q},maybeSingle:execute,then(ok:any,bad:any){return execute().then(ok,bad)}};return q;
};
let transportId=1000;
let scriptedAssistantReply:any=null;
let providerStatus=200;
globalThis.fetch=async(input:any,options:any)=>{
 const req=input instanceof Request?input:new Request(input,options),url=req.url;
 if(url.includes('generativelanguage.googleapis.com')){
  if(providerStatus!==200)return new Response(JSON.stringify({error:{code:providerStatus,message:'simulated failure',status:providerStatus===429?'RESOURCE_EXHAUSTED':'PERMISSION_DENIED'}}),{status:providerStatus,headers:{'Content-Type':'application/json'}});
  const content=await req.clone().json();const str=JSON.stringify(content.contents);
  const parsed=scriptedAssistantReply || (str.includes('You are a finance input assistant.')?{message:'',question:'',transcription:'400000 ishlatdim',actions:[{kind:str.includes('Alidan')?'debt':'expense',amount:str.includes('Alidan')?100000:400000,currency:'UZS',title:str.includes('Alidan')?'Ali':'Xarajat',category:'Boshqa',date:'2026-10-07',person:str.includes('Alidan')?'Ali':'',dueDate:null,dueUnknown:false,repeat:'none',debtId:''}]}:
   str.includes('Read this receipt.')?{isReceipt:true,totalText:'25 000',currency:'UZS',category:'Boshqa',title:'Do‘kon'}:
   str.includes('Transcribe exactly what is heard.')?{transcription:'400000 ishlatdim'}:
   {transcription:'400000 ishlatdim',type:'expense',amount:400000,currency:'UZS',category:'Boshqa'});
  return new Response(JSON.stringify({candidates:[{content:{role:'model',parts:[{text:JSON.stringify(parsed)}]},finishReason:'STOP'}]}),{status:200,headers:{'Content-Type':'application/json'}});
 }
 assert.ok(url.startsWith('https://api.telegram.org/'),url);
 if(url.includes('/file/'))return new Response(new Uint8Array(url.endsWith('.png')?Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6nXcAAAAASUVORK5CYII=','base64'):wav));
 const body=options?.body?JSON.parse(options.body):{};
 sent.push({method:url.split('/').at(-1)!,body});
 return new Response(JSON.stringify({ok:true,result:url.includes('/getFile?')?{file_path:url.includes('test-image')?'test.png':'test.wav'}:{message_id:++transportId}}),{status:200,headers:{'Content-Type':'application/json'}});
};
async function inbound(messageId:number,extra:any){
 const res:any={statusCode:200,setHeader(){},status(n:number){this.statusCode=n;return this},json(body:any){this.body=body;return this}};
 await handler({method:'POST',headers:{'x-telegram-bot-api-secret-token':'offline-secret'},body:{update_id:messageId,message:{message_id:messageId,chat:{id:123,type:'private'},from:{id:123},...extra}}} as any,res);
 return res;
}
for(const [index,extra,expected] of [[601,{text:'400000 ishlatdim'},400000],[602,{voice:{file_id:'test-audio',duration:1,mime_type:'audio/wav'}},400000],[603,{photo:[{file_id:'test-image'}]},25000]] as const){
 await test(`inbound ${index}: parse, autosave once and reject replay`,async()=>{
  await db.query("UPDATE users SET onboarding='{"+'"language":"uz","completed":true'+"}' WHERE id=$1",[user]);
  sent.length=0;
  const result=await inbound(index,extra);assert.equal(result.statusCode,200,JSON.stringify(result.body));
  assert.equal(sent.flatMap(x=>x.body.reply_markup?.inline_keyboard?.flat()||[]).some(x=>String(x.callback_data||'').startsWith('txok_')),false);
  const txs=await transactions();assert.equal(txs.length,1,JSON.stringify(result.body));assert.equal(txs[0].amount,-expected);assert.equal(txs[0].type,'expense');
  assert.ok(sent.some(x=>x.body.text?.includes('Saqlandi') || x.body.text?.includes('saqlandi')));
  assert.equal((await inbound(index,extra)).body.status,'duplicate');assert.equal((await transactions()).length,1);
 });
}
await test('undated debt autosaves once with no guessed return date',async()=>{
 await db.query('UPDATE users SET onboarding=$1 WHERE id=$2',[JSON.stringify({language:'uz',completed:true}),user]);
 sent.length=0;
 const result=await inbound(700,{text:'Alidan 100 ming qarz oldim'});
 assert.equal(result.statusCode,200,JSON.stringify(result.body));
 assert.equal(sent.some(x=>x.body.reply_markup?.force_reply),false);
 const after=await transactions();assert.equal(after.length,1);assert.equal(after[0].type,'debt');assert.equal(after[0].debtWho,'Ali');assert.equal(after[0].debtDueDate,null);assert.equal(after[0].debtDateConfirmed,true);
 assert.equal((await inbound(700,{text:'Alidan 100 ming qarz oldim'})).body.status,'duplicate');
 assert.equal((await transactions()).length,1);
});
const mealItem={kind:'expense',category:'Oziq-ovqat',currency:'UZS',date:'2026-10-08',account:'cash',group:'lunch',amount:24000,title:'Somsa',amountEvidence:'24 mingli'};
await test('one lunch: 24000 plus 4000 saves exactly one 28000 expense and sends database receipt',async()=>{
 scriptedAssistantReply={transcription:'Kecha abetga 24 mingli somsa va 4 mingli non choy',actions:[mealItem,{...mealItem,title:'Non choy',amount:4000,amountEvidence:'4 mingli'}]};
 try{
  sent.length=0;
  await db.query('UPDATE users SET onboarding=$1 WHERE id=$2',[JSON.stringify({language:'uz',completed:true}),user]);
  await inbound(710,{voice:{file_id:'test-audio',duration:5}});
  const txs=await transactions();assert.equal(txs.length,1);assert.equal(txs[0].amount,-28000);
  const receipt=sent.find(x=>x.body.text?.includes('Muvaffaqiyatli saqlandi'));
  assert.ok(receipt);assert.match(receipt.body.text,/Oziq-ovqat/);assert.match(receipt.body.text,/Somsa|somsa/);
  assert.match(receipt.body.text.replace(/[^0-9]/g,''),/28000/);
  await inbound(710,{voice:{file_id:'test-audio',duration:5}});assert.equal((await transactions()).length,1);
 }finally{scriptedAssistantReply=null;}
});
for(const [id,reply] of [
 [711,{transcription:'avtobusga',actions:[],message:"Avtobusga qilgan xarajatni yozib qo'ydim."}],
 [712,{transcription:'24 mingli somsa',actions:[{...mealItem,amount:24000000}]}],
 [713,{transcription:'24 mingli somsa va 4 mingli taksi',actions:[mealItem,{...mealItem,category:'Transport',amount:4000,amountEvidence:'4 mingli'}]}]
] as const){
 await test(`unsafe interpretation ${id}: no ledger write and no success claim`,async()=>{
  scriptedAssistantReply=reply;
  try{await db.query('UPDATE users SET onboarding=$1 WHERE id=$2',[JSON.stringify({language:'uz',completed:true}),user]);sent.length=0;await inbound(id,{voice:{file_id:'test-audio',duration:5}});assert.equal((await transactions()).length,0);
   assert.equal(sent.some(x=>/yozib qo|Muvaffaqiyatli saqlandi/.test(x.body.text||'')),false);
  }finally{scriptedAssistantReply=null;}
 });
}
await test('provider throttling is reported separately and creates no financial write',async()=>{
 providerStatus=429;
 try{
  await db.query('UPDATE users SET onboarding=$1 WHERE id=$2',[JSON.stringify({language:'uz',completed:true}),user]);
  sent.length=0;const result=await inbound(720,{voice:{file_id:'test-audio',duration:5}});
  assert.equal(result.statusCode,503);assert.equal((await transactions()).length,0);
  assert.ok(sent.some(x=>x.body.text?.includes('limiti vaqtincha')));
 }finally{providerStatus=200;}
});
console.log(`${count} bot confirmation checks passed. Offline PostgreSQL; not a live load test.`);await db.close();
