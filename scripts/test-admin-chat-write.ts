import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
process.env.SUPABASE_URL='http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY='offline';
process.env.ADMIN_SECRET_KEY='offline-chat-write-key';
process.env.TELEGRAM_BOT_TOKEN='offline-bot';
const { supabase } = await import('../api/_supabaseClient.js');
const { default: handler } = await import('../api/admin.js');
const id='moliya_user_tg_123';
let row: any={id,telegram_id:'123',onboarding:{bot_messages:[
  {id:'admin_8',message_id:8,direction:'bot_to_user',text:'old'},
  {id:'u_7',message_id:7,direction:'user_to_bot',sender:'user',text:'user'}
]}};
let telegramCalls=0,failHistory=false,nextMessageId=77,removedMarkup=0;
(supabase as any).from=(table:string)=>{
  let target='',patch:any,filters:any[]=[];
  const q:any={select(){return q},eq(k:string,v:any){if(k==='id')target=v;else filters.push([k,v]);return q},is(k:string,v:any){filters.push([k,v]);return q},
    update(v:any){patch=v;return q},insert(){return {error:null}},
    async maybeSingle(){
      if(table!=='users')return {data:null,error:null};
      if(target!==id)return {data:null,error:null};
      if(patch){if(failHistory)return {data:null,error:{message:'private DB detail'}};
        for(const [k,v] of filters)if(JSON.stringify(row[k])!==v)return {data:null,error:null};
        row={...row,...patch};
      }
      return {data:structuredClone(row),error:null};
    }
  };return q;
};
async function api(route:string,body:any,key='offline-chat-write-key'){
  const req:any={method:'POST',query:{route},body,headers:key?{'x-admin-key':key}:{},socket:{remoteAddress:'127.0.0.1'}};
  const res:any={statusCode:200,setHeader(){},status(n:number){this.statusCode=n;return this},json(body:any){this.body=body;return this}};
  await handler(req,res);return res;
}
const root=new URL(existsSync(new URL('../../Admin-Dashboard/',import.meta.url))?'../../Admin-Dashboard/':'../../admin Dashboard Moliya/',import.meta.url);
const client=await import(new URL('src/services/userService.js',root).href);
let apiCalls=0;
globalThis.fetch=async (url:any,opts:any)=>{
  if(String(url).startsWith('https://api.telegram.org/')){
    telegramCalls++;
    if(String(url).endsWith('/editMessageReplyMarkup')) removedMarkup++;
    const messageId=String(url).endsWith('/sendMessage')?nextMessageId++:77;
    return {json:async()=>({ok:true,result:{message_id:messageId}})} as any;
  }
  assert.equal(opts.credentials,'include');apiCalls++;
  const route=new URL(String(url),'https://test.invalid').searchParams.get('route')!;
  const response=await api(route,JSON.parse(opts.body));
  return {ok:response.statusCode<400,status:response.statusCode,json:async()=>response.body} as any;
};
assert.equal((await api('bot-message',{userId:id,messageId:'admin_8',action:'purge'},'')).statusCode,401);
assert.equal((await api('bot-message',{userId:id,messageId:'u_7',action:'edit',text:'forged'})).statusCode,403);
assert.equal((await api('telegram-action',{userId:id,chatId:'456',method:'sendMessage',text:'x'})).statusCode,400);
assert.equal(telegramCalls,0);

const sent=await client.sendAdminDirectMessage(id,'123','hello',{linkButtonText:'Open',linkButtonUrl:'https://example.invalid'});
assert.equal(sent.historySaved,true);assert.equal(sent.adminEntry?.id,'admin_77');
assert.equal(row.onboarding.bot_messages.filter((m:any)=>m.message_id===77).length,1);
assert.equal(row.onboarding.bot_messages.at(-1).linkButtonText,'Open');
assert.equal(row.onboarding.last_link_message_id,77);
assert.equal(telegramCalls,1);assert.equal(apiCalls,1);
const edited=await client.editSingleChatMessage(id,'admin_77','edited','123',77);
assert.equal(edited.dbUpdated,true);assert.equal(row.onboarding.bot_messages.at(-1).text,'edited');
const deleted=await client.deleteSingleChatMessage(id,'admin_77','123',77);
assert.equal(deleted.dbDeleted,true);assert.equal(row.onboarding.bot_messages.at(-1).tg_deleted,true);
const purged=await client.deleteSingleChatMessage(id,'admin_77','123',77,{purgeFromDb:true});
assert.equal(purged.dbDeleted,true);assert.ok(!row.onboarding.bot_messages.some((m:any)=>m.message_id===77));
assert.equal(row.onboarding.last_link_message_id,null);
row.onboarding.last_link_message_id=8;
const replacement=await client.sendAdminDirectMessage(id,'123','new link',{linkButtonText:'New',linkButtonUrl:'https://example.invalid'});
assert.equal(replacement.messageId,78);
assert.equal(removedMarkup,1);
assert.equal(row.onboarding.last_link_message_id,78);
await assert.rejects(client.sendAdminDirectMessage(id,'456','wrong'),/RECIPIENT_MISMATCH/);
failHistory=true;
const partial=await client.sendAdminDirectMessage(id,'123','only Telegram');
assert.equal(partial.historySaved,false);assert.equal(partial.adminEntry,null);
assert.equal(telegramCalls,7); // One old-button removal; no retry or browser DB fallback.
console.log('Admin chat writes: one history entry, edit/delete/purge, auth, and partial delivery passed.');
