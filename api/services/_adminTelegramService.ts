import {normalizeTelegramKeyboard,hasTelegramLinkButton} from '../_telegramKeyboard.js';
import {supabase} from '../_supabaseClient.js';
import {accountDenied} from '../_userPolicy.js';
import {updateProfileSnapshot} from './_profileWriteService.js';
const methods=new Set(['getMe','sendMessage','sendPhoto','sendVideo','editMessageText','editMessageCaption','editMessageReplyMarkup','deleteMessage','deleteMessages']);
export async function adminTelegram(input:any) {
 const method=input?.method;
 if(!methods.has(method))return {status:400,body:{error:'INVALID_TELEGRAM_ACTION'}};
 const token=(process.env.TELEGRAM_BOT_TOKEN||'').trim();
 if(!token)return {status:503,body:{error:'TELEGRAM_NOT_CONFIGURED'}};
 let user:any=null;const payload:any={};
 if(method!=='getMe'){
  const chatId=String(input.chatId??'');
  if(!/^[1-9][0-9]{0,15}$/.test(chatId))return {status:400,body:{error:'INVALID_TELEGRAM_RECIPIENT'}};
  const {data,error}=await supabase.from('users').select('*').eq('id','moliya_user_tg_'+chatId).maybeSingle();
  if(error)return {status:503,body:{error:'RECIPIENT_STORE_UNAVAILABLE'}};
  if(!data||String(data.telegram_id)!==chatId)return {status:404,body:{error:'USER_NOT_FOUND'}};
  user=data;payload.chat_id=chatId;
  if(method.startsWith('send')){
   const {data:restriction,error:restrictionError}=await supabase.from('users').select('onboarding').eq('id','restricted_tg_'+chatId).maybeSingle();
   if(restrictionError)return {status:503,body:{error:'RECIPIENT_STORE_UNAVAILABLE'}};
   if(accountDenied(user)||(restriction&&restriction.onboarding?.is_blocked!==false))return {status:403,body:{error:'ACCOUNT_RESTRICTED'}};
  }
  if(['editMessageText','editMessageCaption','editMessageReplyMarkup','deleteMessage'].includes(method)){
   if(!Number.isSafeInteger(input.messageId)||input.messageId<=0)return {status:400,body:{error:'INVALID_MESSAGE_ID'}};
   payload.message_id=input.messageId;
  }
  if(method==='deleteMessages'){
   if(!Array.isArray(input.messageIds)||input.messageIds.length<1||input.messageIds.length>100||input.messageIds.some((n:any)=>!Number.isSafeInteger(n)||n<=0))return {status:400,body:{error:'INVALID_MESSAGE_IDS'}};
   payload.message_ids=[...new Set(input.messageIds)];
  }
  if(['sendMessage','editMessageText','sendPhoto','sendVideo','editMessageCaption'].includes(method)){
   const text=input.text??'';const caption=['sendPhoto','sendVideo','editMessageCaption'].includes(method);
   if(typeof text!=='string'||text.length>(caption?1024:4096)||(!caption&&!text.trim()))return {status:400,body:{error:'INVALID_MESSAGE_TEXT'}};
   payload[caption?'caption':'text']=text;payload.parse_mode='HTML';
  }
  if(['sendPhoto','sendVideo'].includes(method)){
   try{const url=new URL(input.mediaUrl);if(url.protocol!=='https:'||url.username||url.password)throw Error();}catch{return {status:400,body:{error:'INVALID_MEDIA_URL'}};}
   payload[method==='sendPhoto'?'photo':'video']=input.mediaUrl;
  }
  if(input.replyMarkup!==undefined&&input.replyMarkup!==null){
   try { payload.reply_markup=normalizeTelegramKeyboard(input.replyMarkup); }
   catch { return {status:400,body:{error:'INVALID_KEYBOARD_OR_BUTTON_URL'}}; }
  }

 }
 if(method.startsWith('send') && hasTelegramLinkButton(payload.reply_markup)) payload.protect_content=true;
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);
 try{
  const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
  const result=await response.json();
  if(!result.ok)return {status:result.error_code===429?429:502,body:{error:'TELEGRAM_REQUEST_REJECTED',retryAfter:Number(result.parameters?.retry_after)||undefined}};
  if(method==='getMe')return {status:200,body:{success:true,bot:{id:result.result?.id,username:result.result?.username,first_name:result.result?.first_name}}};
  const messageId=result.result?.message_id;
  if(method.startsWith('send')&&!Number.isSafeInteger(messageId))return {status:502,body:{error:'TELEGRAM_DELIVERY_UNKNOWN'}};
  let historySaved=true;
  let adminEntry:any=null;
  try{
   const {data:current,error}=await supabase.from('users').select('*').eq('id',user.id).maybeSingle();
   if(error||!current)throw Error();
   let messages=Array.isArray(current.onboarding?.bot_messages)?current.onboarding.bot_messages:[];
   const now=new Date().toISOString();
   if(method.startsWith('send')){
    adminEntry={id:'admin_'+messageId,message_id:messageId,messageId,chat_id:payload.chat_id,chatId:payload.chat_id,direction:'bot_to_user',sender:input.adminDirect===true?'admin':'bot',type:'admin_direct',text:input.text||'',timestamp:now};
    if(input.adminDirect===true && payload.reply_markup?.inline_keyboard){
     adminEntry.hasLinkButton=true;
     adminEntry.linkButtonText=String(input.linkButtonText||'').slice(0,100);
     adminEntry.linkButtonUrl=payload.reply_markup.inline_keyboard[0]?.[0]?.url || payload.reply_markup.inline_keyboard[0]?.[0]?.web_app?.url || null;
    }
    messages=[...messages,adminEntry].slice(-500);
   }
   else messages=messages.map((m:any)=>{
    const matches=method==='deleteMessages'?payload.message_ids.includes(Number(m.message_id)):Number(m.message_id)===payload.message_id;
    if(!matches)return m;
    if(method.startsWith('delete'))return {...m,tg_deleted:true,tg_deleted_at:now};
    if(method==='editMessageText'||method==='editMessageCaption')return {...m,text:input.text,edited:true,edited_at:now};return m;
   });
   await updateProfileSnapshot(user.id,current,{onboarding:{...current.onboarding,bot_messages:messages,
    ...(adminEntry?.hasLinkButton?{last_link_message_id:messageId}:{})}});
  }catch{historySaved=false;}
  return {status:200,body:{success:true,result:messageId?{message_id:messageId}:true,historySaved,
   adminEntry:historySaved?adminEntry:null}};
 }catch{return {status:504,body:{error:'TELEGRAM_DELIVERY_UNKNOWN'}};}finally{clearTimeout(timer)}
}
