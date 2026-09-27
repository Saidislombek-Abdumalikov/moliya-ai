/** Redacts known credentials and structured private fields from application logs. */
const privateField=/^(?:authorization|cookie|set-cookie|x-admin-key|password|adminKey|secret|token|sessionToken|session_token|access_token|refresh_token|apiKey|api_key|initData|init_data|phone|phone_number|contact|transactions|cards)$/i;
export function sanitizeForLog(input:unknown):string {
 if(input==null)return '';
 let text:string;
 if(input instanceof Error)text=input.message+(input.stack?'\n'+input.stack:'');
 else if(typeof input==='object'){
   const seen=new WeakSet<object>();
   try {text=JSON.stringify(input,(key,value)=>{
     if(privateField.test(key))return '[PROTECTED]';
     if(value && typeof value==='object'){if(seen.has(value))return '[CIRCULAR]';seen.add(value);}
     return typeof value==='bigint'?String(value):value;
   }) || '';}catch{return '[UNSERIALIZABLE]';}
 }else text=String(input);
 // Configured secrets need protection even when their format is not recognizable.
 for(const key of ['TELEGRAM_BOT_TOKEN','TELEGRAM_WEBHOOK_SECRET','ADMIN_SECRET_KEY','MOLIYA_AUTH_SECRET','SUPABASE_SERVICE_ROLE_KEY','GEMINI_API_KEY','UPSTASH_REDIS_REST_TOKEN']){
   const secret=process.env[key]?.trim();
   if(secret && secret.length>=8){for(const form of new Set([secret,encodeURIComponent(secret)]))text=text.split(form).join('[PROTECTED]');}
 }
 text=text.replace(/\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g,'[PROTECTED_BOT_TOKEN]')
   .replace(/https?:\/\/api\.telegram\.org\/(?:file\/)?bot[^/\s]+/gi,'https://api.telegram.org/bot[PROTECTED]')
   .replace(/\bAIza[A-Za-z0-9_-]{30,}\b/g,'[PROTECTED_AI_KEY]')
   .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,'[PROTECTED_JWT]')
   .replace(/\bsb_secret_[A-Za-z0-9_-]+\b/g,'[PROTECTED_SB_SECRET]')
   .replace(/\bsess_[A-Za-z0-9_-]{16,}\b/g,'sess_[PROTECTED]')
   .replace(/([?&](?:key|token|code|initData|requestId|secret|api_key)=)[^&#\s]*/gi,'$1[PROTECTED]')
   .replace(/((?:authorization|x-admin-key|password|session_token|sessionToken|access_token|refresh_token|initData|cookie|set-cookie)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\r\n,}]+)/gi,'$1[PROTECTED]')
   .replace(/\+998[\s-]*\d{2}[\s-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g,'[PROTECTED_PHONE]');
 return text;
}
export const safeLog=(...args:unknown[])=>console.log(...args.map(sanitizeForLog));
export const safeWarn=(...args:unknown[])=>console.warn(...args.map(sanitizeForLog));
export const safeError=(...args:unknown[])=>console.error(...args.map(sanitizeForLog));
