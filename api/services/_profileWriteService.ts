import {supabase} from '../_supabaseClient.js';

/** Compare the JSON being replaced against the actual snapshot that produced it.
 * Never re-read here: doing so would bless a stale patch with a newer snapshot.
 */
export async function updateProfileSnapshot(userId:string,snapshot:any,patch:Record<string,any>):Promise<{data:any;error:{message:string}|null}> {
 if(!/^moliya_user_tg_[0-9]+$/.test(userId)||!snapshot || (snapshot.id && snapshot.id!==userId))throw Object.assign(new Error('PROFILE_SNAPSHOT_REQUIRED'),{statusCode:409});
 let query=supabase.from('users').update({...patch,updated_at:new Date().toISOString()}).eq('id',userId);
 for(const key of ['onboarding','device_info','bot_verification']){
   if(!Object.hasOwn(patch,key) && !(key==='onboarding' && Object.hasOwn(snapshot,key)))continue;
   // Supabase returns selected columns even when null. A missing column means
   // the caller did not read enough state to safely replace that JSON.
   if(!Object.hasOwn(snapshot,key))throw Object.assign(new Error('PROFILE_SNAPSHOT_REQUIRED'),{statusCode:409});
   query=snapshot[key]==null?query.is(key,null):query.eq(key,JSON.stringify(snapshot[key]));
 }
 // Login/contact/admin profile writes must not overwrite a newly restricted account.
 for(const key of ['is_blocked','is_restricted','is_deleted','account_status','is_premium','premium_expires_at','unlimited_ai','ai_blocked']){
   if(Object.hasOwn(snapshot,key))query=snapshot[key]==null?query.is(key,null):query.eq(key,snapshot[key]);
 }
 const {data,error}=await query.select('*').maybeSingle();
 if(error)throw Object.assign(new Error('PROFILE_STORE_UNAVAILABLE'),{statusCode:503});
 if(!data)throw Object.assign(new Error('PROFILE_CHANGED'),{statusCode:409});
 return {data,error:null};
}
