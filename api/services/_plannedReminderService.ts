import {supabase} from '../_supabaseClient.js';
import {eligibleUser} from '../_userPolicy.js';
import {cleanPlannedPayments,paymentReminderKind,type PlannedPayment} from '../../shared/plannedPayments.js';
import {logBotMessage} from './_telegramMessageService.js';
export async function deliverPlannedReminder(user:any,plan:PlannedPayment,today:string):Promise<'sent'|'duplicate'|'skipped'|'failed'>{
 const kind=paymentReminderKind(plan,today,user.transactions||[]);
 if(!eligibleUser(user)||user.onboarding?.notifications?.opt1===false||!kind)return 'skipped';
 const token=(process.env.TELEGRAM_BOT_TOKEN||'').trim();if(!token)return 'failed';
 const key={user_id:user.id,plan_id:plan.id,due_date:plan.dueDate,delivery_day:kind==='early'?plan.dueDate:today,kind};
 const {error}=await supabase.from('moliya_planned_delivery').insert(key);
 if(error?.code==='23505')return 'duplicate';if(error)return 'failed';
 const status=(value:string)=>supabase.from('moliya_planned_delivery').update({status:value}).match(key);
 const release=()=>supabase.from('moliya_planned_delivery').delete().match(key);
 let attempted=false;
 try{
   const {data:fresh,error:readError}=await supabase.from('users').select('*').eq('id',user.id).maybeSingle();
   const {data:restriction,error:restrictionError}=await supabase.from('users').select('onboarding').eq('id','restricted_tg_'+user.telegram_id).maybeSingle();
   if(readError||restrictionError)throw Error('STORE_UNAVAILABLE');
   const current=cleanPlannedPayments(fresh?.onboarding?.planned_payments).find(p=>p.id===plan.id&&p.dueDate===plan.dueDate);
   if(!eligibleUser(fresh)||fresh.onboarding?.notifications?.opt1===false||(restriction&&restriction.onboarding?.is_blocked!==false)||!current||paymentReminderKind(current,today,fresh.transactions||[])!==kind){await status('skipped');return 'skipped';}
   const url=new URL(process.env.APP_URL||'https://moliya-ai-pi.vercel.app');url.searchParams.set('paymentId',current.id);
   const text=`🔔 ${kind==='early'?'To‘lov yaqinlashmoqda':'To‘lovni qildingizmi?'}\n${current.title} · ${current.amount.toLocaleString('en-US').replace(/,/g,' ')} so‘m\n📅 ${current.dueDate}${current.time?' · '+current.time:''}`;
   attempted=true;
   const response=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(10000),body:JSON.stringify({chat_id:String(user.telegram_id),text,reply_markup:{inline_keyboard:[[{text:kind==='early'?'📱 To‘lovni ko‘rish':'📱 Javob berish',web_app:{url:url.href}}],[{text:'🌐 Webda ochish',url:url.href}]]}})});
   const result=await response.json();
   if(!result.ok){if(result.error_code===429||result.error_code>=500)await release();else await status('rejected');return 'failed';}
   await status('sent');
   if(Number.isSafeInteger(result.result?.message_id))await logBotMessage(user.id,{id:'planned_'+result.result.message_id,message_id:result.result.message_id,chat_id:user.telegram_id,direction:'bot_to_user',sender:'bot',type:'bot_response',text,timestamp:new Date().toISOString()});
   return 'sent';
 }catch{if(attempted)await status('unknown');else await release();return 'failed';}
}
