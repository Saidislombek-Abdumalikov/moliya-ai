import { supabase } from './_supabaseClient.js';
import { eligibleUser } from './_userPolicy.js';
import { tashkentDay } from '../shared/reminderPolicy.js';
import { safeWarn } from './_logger.js';
import { calculateFinancialMetrics, formatUzbekCurrency } from './_financialReportEngine.js';

export type ExtraRule = 'quota_exhausted' | 'trial_expiry' | 'weekly_digest';
const content: Record<string,Record<ExtraRule,{title:string;message:string}>> = {
 uz: {
  quota_exhausted: {
    title: '⚠️ Kunlik AI limiti tugadi',
    message: 'Xarajat va daromadni Mini Appda qo‘lda kiritish bepul. AI limiti ertaga yangilanadi.'
  },
  trial_expiry: {
    title: '⏳ Premium sinov muddati yakunlanmoqda',
    message: 'Sinov muddati yaqin soatlarda tugaydi. Hisobingiz va qo‘lda qayd qilish imkoniyati saqlanadi.'
  },
  weekly_digest: {title:'📈 Haftalik moliyaviy sarhisob',message:'Haftalik natijalaringiz tayyor.'}
 },
 en: {
  quota_exhausted:{title:'⚠️ Daily AI limit reached',message:'You can still add income and expenses manually in the Mini App for free. Your AI limit resets tomorrow.'},
  trial_expiry:{title:'⏳ Premium trial ending soon',message:'Your trial ends in the coming hours. Your records and manual entry remain available.'},
  weekly_digest:{title:'📈 Weekly financial summary',message:'Your weekly figures are ready.'}
 },
 ru: {
  quota_exhausted:{title:'⚠️ Дневной лимит ИИ исчерпан',message:'Доходы и расходы можно бесплатно вносить вручную в Mini App. Лимит ИИ обновится завтра.'},
  trial_expiry:{title:'⏳ Пробный Premium скоро закончится',message:'Пробный период закончится в ближайшие часы. Ваши записи и ручной ввод останутся доступны.'},
  weekly_digest:{title:'📈 Финансовые итоги недели',message:'Ваши показатели за неделю готовы.'}
 },
 uz_cyrl: {
  quota_exhausted:{title:'⚠️ Кунлик AI лимити тугади',message:'Даромад ва харажатни Mini Appда қўлда киритиш бепул. AI лимити эртага янгиланади.'},
  trial_expiry:{title:'⏳ Premium синов муддати якунланмоқда',message:'Синов муддати яқин соатларда тугайди. Ёзувларингиз ва қўлда қайд қилиш сақланади.'},
  weekly_digest:{title:'📈 Ҳафталик молиявий сарҳисоб',message:'Ҳафталик натижаларингиз тайёр.'}
 }
};

const languageOf=(user:any)=>['uz','uz_cyrl','ru','en'].includes(user.language || user.onboarding?.language)
  ? user.language || user.onboarding?.language : 'uz';

export async function ruleEnabled(ruleId:ExtraRule):Promise<boolean> {
  const {data,error}=await supabase.from('moliya_automation_rules').select('enabled').eq('rule_id',ruleId).maybeSingle();
  if(error || !data || typeof data.enabled!=='boolean')throw new Error('AUTOMATION_STORE_UNAVAILABLE');
  return data.enabled;
}

// A claim precedes delivery. Concurrent requests cannot notify twice.
// A failed downstream delivery is intentionally never retried automatically.
export async function notifyAutomation(user:any,ruleId:ExtraRule,occurrence:string,telegram=true,customMessage?:string):Promise<'sent'|'duplicate'|'skipped'|'failed'> {
  if(!eligibleUser(user) || (ruleId==='weekly_digest' && user.onboarding?.notifications?.opt2===false))return 'skipped';
  if(!/^[\w:.+\-]{1,80}$/.test(occurrence))return 'failed';
  const {error:claimError}=await supabase.from('moliya_automation_delivery')
    .insert({user_id:user.id,rule_id:ruleId,occurrence});
  if(claimError?.code==='23505')return 'duplicate';
  if(claimError)return 'failed';
  const {title}=content[languageOf(user)][ruleId];
  const message=customMessage||content[languageOf(user)][ruleId].message;
  const {error:noticeError}=await supabase.from('app_notifications').insert([{
    title,message,target:user.id,is_active:true,created_at:new Date().toISOString()
  }]);
  if(noticeError)safeWarn('[AUTOMATION] App notice failed');
  let telegramOk=!telegram;
  const token=process.env.TELEGRAM_BOT_TOKEN || '';
  if(telegram && token) {
    try {
      const response=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({chat_id:String(user.telegram_id),text:`${title}\n\n${message}`})
      });
      telegramOk=Boolean((await response.json()).ok);
    } catch {telegramOk=false;}
  }
  return !noticeError && telegramOk?'sent':'failed';
}

export async function quotaExhaustedNotice(userId:string,source:string):Promise<void>{
  try {
    if(!await ruleEnabled('quota_exhausted'))return;
    const {data:user,error}=await supabase.from('users').select('*').eq('id',userId).maybeSingle();
    if(error || !user)return;
    // The bot already replies to its own quota denial; don't send it a duplicate.
    await notifyAutomation(user,'quota_exhausted',tashkentDay(new Date()),source!=='telegram_bot');
  } catch {safeWarn('[AUTOMATION] Quota notice unavailable');}
}

// These rows only prevent repeats within a day/week. Financial data and
// notification history are never part of this retention cleanup.
export async function cleanupAutomationClaims(now=new Date()):Promise<void>{
  const cutoff=new Date(now.getTime()-35*86400_000);
  const [reminders,other]=await Promise.all([
    supabase.from('moliya_reminder_delivery').delete().lt('local_day',tashkentDay(cutoff)),
    supabase.from('moliya_automation_delivery').delete().lt('created_at',cutoff.toISOString())
  ]);
  if(reminders.error || other.error)safeWarn('[AUTOMATION] Retention cleanup unavailable');
}

export function dueAutomationUsers(users:any[],ruleId:'trial_expiry'|'weekly_digest',now:Date):Array<{user:any;occurrence:string;message?:string}>{
  const weekday=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tashkent',weekday:'short'}).format(now);
  if(ruleId==='weekly_digest' && weekday!=='Sun')return [];
  return users.flatMap(user=>{
    if(!eligibleUser(user) || (ruleId==='weekly_digest' && user.onboarding?.notifications?.opt2===false))return [];
    if(ruleId==='trial_expiry'){
      if(user.unlimited_ai || user.is_vip || user.onboarding?.is_vip || user.is_trial===false || user.onboarding?.is_trial===false)return [];
      const trialEnd=user.trial_ends_at || user.onboarding?.trial_ends_at;
      const end=Date.parse(trialEnd || '');
      if(!Number.isFinite(end) || end<=now.getTime() || end>now.getTime()+15*3600_000)return [];
      // The bot's 24-hour trial uses is_premium=true with the same expiry.
      // A later paid/admin VIP expiry must never receive a trial warning.
      if(user.is_premium && Date.parse(user.premium_expires_at || '')!==end)return [];
      return [{user,occurrence:new Date(end).toISOString()}];
    }
    const end=new Date(now.getTime()-7*86400_000);
    const metrics=calculateFinancialMetrics(Array.isArray(user.transactions)?user.transactions:[],end,now);
    if(metrics.transactionCount===0)return [];
    const lang=languageOf(user);
    const money=(amount:number)=>['uz','uz_cyrl'].includes(lang)?formatUzbekCurrency(amount):`${Math.round(amount).toLocaleString('en-US')} UZS`;
    const income=money(metrics.totalIncome),expense=money(metrics.totalExpense);
    const message=({
      uz:`So‘nggi 7 kunda daromad: ${income}; xarajat: ${expense}. Batafsil statistika Mini Appda.`,
      en:`Last 7 days — income: ${income}; expenses: ${expense}. See details in the Mini App.`,
      ru:`За 7 дней: доход ${income}; расходы ${expense}. Подробности в Mini App.`,
      uz_cyrl:`Сўнгги 7 кунда даромад: ${income}; харажат: ${expense}. Батафсил статистика Mini Appда.`
    })[languageOf(user)];
    return [{user,occurrence:tashkentDay(now),message}];
  });
}
