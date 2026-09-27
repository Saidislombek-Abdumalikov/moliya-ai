import assert from 'node:assert/strict';
process.env.SUPABASE_URL='http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY='offline';
process.env.TELEGRAM_BOT_TOKEN='offline-token';
process.env.TELEGRAM_WEBHOOK_SECRET='offline-secret';
const {supabase}=await import('../api/_supabaseClient.js');
const {default:webhook}=await import('../api/telegram-webhook.js');
const rows=new Map<string,any>();
let conflicts=0,deliveryFails=false;
(supabase as any).from=(table:string)=>{
 assert.equal(table,'users');let filters:Array<[string,any]>=[],patch:any=null,insert:any=null;
 const q:any={select(){return q},eq(key:string,value:any){filters.push([key,value]);return q},is(key:string,value:any){filters.push([key,value]);return q},update(value:any){patch=value;return q},upsert(value:any){insert=value;return q},async maybeSingle(){
   const id=insert?.id||filters.find(([key])=>key==='id')?.[1];
   if(insert&&!rows.has(id))rows.set(id,{device_info:null,bot_verification:null,...structuredClone(insert)});
   const row=rows.get(id);
   if(patch&&row){
     const matches=filters.every(([key,value])=>['onboarding','device_info','bot_verification'].includes(key)&&value!==null?JSON.stringify(row[key])===value:row[key]===value);
     if(!matches){conflicts++;return {data:null,error:null};}
     rows.set(id,{...row,...structuredClone(patch)});
   }
   return {data:rows.has(id)?structuredClone(rows.get(id)):null,error:null};
 }};return q;
};
const completed=new Set<string>();
(supabase as any).rpc=async(name:string,args:any)=>{
 assert.equal(name,'moliya_bot_message_delivery');
 if(args.p_action==='complete'){completed.add(args.p_key);return {data:'done',error:null};}
 return {data:completed.has(args.p_key)?'done':'claimed',error:null};
};
const sent:string[]=[];
globalThis.fetch=async(url:any)=>{
 const method=String(url).split('/').at(-1)!;sent.push(method);
 return {ok:!deliveryFails,json:async()=>({ok:!deliveryFails,result:{message_id:sent.length}})} as any;
};
async function send(messageId:number,text:string,chat=123){
 const req:any={method:'POST',headers:{'x-telegram-bot-api-secret-token':'offline-secret'},body:{update_id:messageId,message:{message_id:messageId,chat:{id:chat,type:chat===123?'private':'group'},from:{id:123,first_name:'Test'},text}}};
 const res:any={statusCode:200,setHeader(){},status(n:number){this.statusCode=n;return this},json(body:any){this.body=body;return this}};
 await webhook(req,res);return res;
}
const initial=await send(1,'/start req_1234567890abcdef');
assert.equal(initial.statusCode,200);assert.equal(initial.body.status,'oferta_required');
assert.equal(conflicts,0,'Incoming history must not invalidate the pending-login snapshot');
const user=rows.get('moliya_user_tg_123');
assert.equal(user.onboarding.pending_login_request_id,'1234567890abcdef');
assert.equal(user.device_info.pending_login_request_id,'1234567890abcdef');
assert.equal(user.onboarding.bot_messages.length,1);
assert.equal(user.bot_verification,null);assert.equal(user.phone,null);
assert.equal(sent.filter(x=>x==='sendDocument').length,1);
assert.equal(sent.filter(x=>x==='sendMessage').length,0);
assert.equal((await send(1,'/start req_1234567890abcdef')).body.status,'duplicate');
assert.equal(sent.filter(x=>x==='sendDocument').length,1);
assert.equal((await send(2,'/start',-100)).body.status,'invalid_chat');
deliveryFails=true;
assert.equal((await send(3,'/start')).statusCode,503);
assert.equal(completed.has('msg:123:3'),false,'Failed document delivery must remain retryable');
console.log('New user: strict snapshot comparison, pending web login, single document, duplicate/private-chat gates and delivery retry passed.');
