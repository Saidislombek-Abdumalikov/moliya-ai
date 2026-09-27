import {supabase} from '../_supabaseClient.js';
import {effectiveAccess} from '../_accessHelper.js';
export function notificationPayload(input:any,partial=false):Record<string,any> {
 const result:Record<string,any>={};
 const text=(key:string,max:number)=>{if(partial && input[key]===undefined)return;const value=input[key];if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error('INVALID_NOTIFICATION');result[key]=value.trim()};
 text('title',160);text('message',4000);
 if(!partial || input.target!==undefined){const target=input.target??'all';if(typeof target!=='string'||!(/^(all|web|telegram|vip|free)$/.test(target)||/^moliya_user_tg_[0-9]+$/.test(target)))throw new Error('INVALID_NOTIFICATION');result.target=target;}
 for(const key of ['image_url','action_url']){
  if(partial && input[key]===undefined)continue;
  const value=input[key];
  if(value==null||value===''){result[key]=null;continue;}
  if(typeof value!=='string'||value.length>2048)throw new Error('INVALID_NOTIFICATION');
  const url=value.trim();
  // App hash/path links and HTTPS links only; reject script/data/protocol-relative URLs.
  const local=key==='action_url' && /^(?:\/(?!\/)|#)/.test(url) && !/[\\\s]/.test(url);
  let remote=false;try{const parsed=new URL(url);remote=parsed.protocol==='https:' && !parsed.username && !parsed.password;}catch{}
  if(!local&&!remote)throw new Error('INVALID_NOTIFICATION');result[key]=url;
 }
 for(const key of ['is_pinned','is_active']){if(input[key]!==undefined){if(typeof input[key]!=='boolean')throw new Error('INVALID_NOTIFICATION');result[key]=input[key]}else if(!partial)result[key]=key==='is_active';}
 if(!partial||input.priority!==undefined){if(!['high','normal'].includes(input.priority??'normal'))throw new Error('INVALID_NOTIFICATION');result.priority=input.priority??'normal';}
 if(partial && !Object.keys(result).length)throw new Error('INVALID_NOTIFICATION');
 return result;
}
export async function userNotifications(user:any,platform:'web'|'telegram') {
 const targets=['all',platform,effectiveAccess(user).isPremium?'vip':'free',user.id];
 const {data,error}=await supabase.from('app_notifications')
  .select('id,title,message,image_url,target,action_url,is_pinned,priority,created_at')
  .in('target',targets).eq('is_active',true).order('created_at',{ascending:false}).limit(35);
 if(error)throw new Error('NOTIFICATIONS_UNAVAILABLE');
 return (data||[]).map(item=>{
  const safe={...item};
  for(const key of ['image_url','action_url'])try{safe[key]=notificationPayload({[key]:item[key]??null},true)[key];}catch{safe[key]=null;}
  return safe;
 });
}
