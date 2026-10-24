import {supabase} from '../_supabaseClient.js';

const PROFILE_JSON_KEYS = ['onboarding','device_info','bot_verification'] as const;

/** Filter a users write/delete so it only matches the row the snapshot came from.
 * Prefer profile_version (migration 23): putting whole JSON values in the
 * request URL fails once onboarding grows past gateway URL limits.
 * Snapshots read without profile_version fall back to the JSON comparison.
 */
export function matchProfileSnapshot<Q extends {eq:any;is:any}>(query:Q,snapshot:any,keys:readonly string[]=PROFILE_JSON_KEYS):Q {
 if(!keys.length)return query;
 if(snapshot?.profile_version!=null)return query.eq('profile_version',snapshot.profile_version);
 for(const key of keys)query=snapshot[key]==null?query.is(key,null):query.eq(key,JSON.stringify(snapshot[key]));
 return query;
}

/** Compare against the actual snapshot that produced the patch.
 * Never re-read here: doing so would bless a stale patch with a newer snapshot.
 */
export async function updateProfileSnapshot(userId:string,snapshot:any,patch:Record<string,any>):Promise<{data:any;error:{message:string}|null}> {
 if(!/^moliya_user_tg_[0-9]+$/.test(userId)||!snapshot || (snapshot.id && snapshot.id!==userId))throw Object.assign(new Error('PROFILE_SNAPSHOT_REQUIRED'),{statusCode:409});
 let query=supabase.from('users').update({...patch,updated_at:new Date().toISOString()}).eq('id',userId);
 const compared:string[]=[];
 for(const key of PROFILE_JSON_KEYS){
   if(!Object.hasOwn(patch,key) && !(key==='onboarding' && Object.hasOwn(snapshot,key)))continue;
   // Supabase returns selected columns even when null. A missing column means
   // the caller did not read enough state to safely replace that JSON.
   if(!Object.hasOwn(snapshot,key))throw Object.assign(new Error('PROFILE_SNAPSHOT_REQUIRED'),{statusCode:409});
   compared.push(key);
 }
 query=matchProfileSnapshot(query,snapshot,compared);
 // Login/contact/admin profile writes must not overwrite a newly restricted account.
 for(const key of ['is_blocked','is_restricted','is_deleted','account_status','is_premium','premium_expires_at','unlimited_ai','ai_blocked']){
   if(Object.hasOwn(snapshot,key))query=snapshot[key]==null?query.is(key,null):query.eq(key,snapshot[key]);
 }
 const {data,error}=await query.select('*').maybeSingle();
 if(error)throw Object.assign(new Error('PROFILE_STORE_UNAVAILABLE'),{statusCode:503});
 if(!data)throw Object.assign(new Error('PROFILE_CHANGED'),{statusCode:409});
 return {data,error:null};
}
