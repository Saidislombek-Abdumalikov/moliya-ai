import { safeWarn } from './_logger.js';
import { supabase } from './_supabaseClient.js';
import { quotaExhaustedNotice } from './_automation.js';

export interface QuotaCheckResult {
  allowed: boolean; isPremium: boolean; isTrial: boolean;
  limit: number | null; usedCount: number; remaining?: number;
  message?: string; statusCode?: number; code?: string;
}
const unavailable=():QuotaCheckResult=>({allowed:false,isPremium:false,isTrial:false,limit:0,usedCount:0,remaining:0,statusCode:503,code:'QUOTA_STORE_UNAVAILABLE',message:'AI limitini tekshirib bo‘lmadi. Qayta urinib ko‘ring.'});
async function quota(userId:string|undefined,consume:boolean):Promise<QuotaCheckResult>{
  if(!userId || !/^moliya_user_tg_[0-9]+$/.test(userId)) return {...unavailable(),statusCode:401,code:'USER_REQUIRED'};
  try {
    const {data,error}=await supabase.rpc('moliya_ai_quota',{p_user_id:userId,p_consume:consume});
    if(error || !data || typeof data.allowed!=='boolean' || !Number.isFinite(data.usedCount) ||
      !(data.limit===null || Number.isFinite(data.limit))) return unavailable();
    return {...data,message:data.allowed?undefined:data.code==='QUOTA_EXCEEDED'
      ? `Kunlik AI limitingiz (${data.limit}) tugadi. Xarajatlarni qo‘lda kiritish bepul.`
      : 'AI uchun hisobingizning bot tasdig‘i va kirish ruxsatini tekshiring.'};
  } catch {return unavailable();}
}
// Display-only. Never use this as authorization to start an AI operation.
export async function checkAiQuota(userId:string|undefined):Promise<QuotaCheckResult>{return quota(userId,false);}

// The database reserves one attempt BEFORE any local/cloud AI work starts.
// A failed provider call consumes that attempt; there is no unsafe counter rollback.
export async function checkAndRecordAiUsage(userId:string|undefined,queryType:'text'|'receipt'|'voice'='text',promptSummary='',source='mini_app'):Promise<QuotaCheckResult>{
  const result=await quota(userId,true);
  if(!result.allowed || !userId) {
    if(userId && result.code==='QUOTA_EXCEEDED' && !result.isPremium && ['mini_app','telegram_bot'].includes(source))
      await quotaExhaustedNotice(userId,source);
    return result;
  }
  try {
    const pendingInsert = supabase.from('ai_logs').insert([{
      user_id:userId,query_type:queryType,prompt_summary:promptSummary.slice(0,300),
      is_premium:result.isPremium,raw_payload:{source,phase:'reserved'},timestamp:new Date().toISOString()
    }]);
    Promise.resolve(pendingInsert)
      .then((res: any) => { if (res?.error) safeWarn('[AI_QUOTA] Reservation audit write failed'); })
      .catch(() => { safeWarn('[AI_QUOTA] Reservation audit write failed'); });
  } catch {safeWarn('[AI_QUOTA] Reservation audit write failed');}
  return result;
}
