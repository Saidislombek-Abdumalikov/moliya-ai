import { updateProfileSnapshot, matchProfileSnapshot } from './_profileWriteService.js';
import { listBotMessages, clearBotMessages } from './_telegramMessageService.js';
import { safeError, safeWarn } from '../_logger.js';
import { supabase } from '../_supabaseClient.js';

export interface UserAccount {
  id: string;
  name?: string;
  phone?: string | null;
  telegram?: string | null;
  telegram_id?: string | null;
  language?: string;
  platform?: string;
  device_info?: any;
  is_blocked?: boolean;
  is_deleted?: boolean;
  account_status?: string;
  created_at?: string;
  updated_at?: string;
  onboarding?: any;
}

/**
 * Fetch basic user account profile by userId.
 * Scoped strictly by userId.
 */
export async function getUserAccount(userId: string): Promise<UserAccount | null> {
  if (!userId) throw new Error('userId is required for getUserAccount');

  const { data, error } = await supabase
    .from('users')
    .select('id, name, phone, telegram, telegram_id, language, platform, device_info, created_at, updated_at, onboarding')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    safeError(`[UserAccountService] Error fetching user ${userId}:`, error.message);
    throw error;
  }

  if (!data) return null;

  const ob = data.onboarding || {};
  return {
    ...data,
    is_blocked: Boolean(ob.is_blocked || data.device_info?.is_blocked),
    is_deleted: Boolean(ob.is_deleted),
    account_status: ob.account_status || (ob.is_blocked ? 'blocked' : 'active')
  };
}

/**
 * Block a user from application and bot access.
 * 
 * STRICT BOUNDARY:
 * - Changes only access/status: sets is_blocked: true inside onboarding.
 * - Does NOT wipe financial data.
 * - Does NOT delete messages.
 * - Does NOT remove premium.
 * - Does NOT delete files.
 */
export async function blockUser(userId: string, reason: string = 'Blocked by administration'): Promise<{ success: boolean; userId: string; isBlocked: boolean }> {
  if (!userId) throw new Error('userId is required for blockUser');

  const nowIso = new Date().toISOString();

  // Fetch current onboarding to preserve other fields
  const { data: user } = await supabase.from('users').select('onboarding, profile_version').eq('id', userId).maybeSingle();
  const updatedOb = {
    ...(user?.onboarding || {}),
    is_blocked: true,
    blocked_at: nowIso,
    block_reason: reason
  };

  const { error } = await updateProfileSnapshot(userId, user, {
      onboarding: updatedOb,
      updated_at: nowIso
    });

  if (error) {
    safeError(`[UserAccountService] Error blocking user ${userId}:`, error.message);
    throw error;
  }

  return { success: true, userId, isBlocked: true };
}

/**
 * Unblock a user, restoring application and bot access.
 * 
 * STRICT BOUNDARY:
 * - Changes only access/status: sets is_blocked: false in onboarding.
 */
export async function unblockUser(userId: string): Promise<{ success: boolean; userId: string; isBlocked: boolean }> {
  if (!userId) throw new Error('userId is required for unblockUser');

  const nowIso = new Date().toISOString();

  const { data: user } = await supabase.from('users').select('onboarding, profile_version').eq('id', userId).maybeSingle();
  const updatedOb = {
    ...(user?.onboarding || {}),
    is_blocked: false,
    unblocked_at: nowIso
  };

  const { error } = await updateProfileSnapshot(userId, user, {
      onboarding: updatedOb,
      updated_at: nowIso
    });

  if (error) {
    safeError(`[UserAccountService] Error unblocking user ${userId}:`, error.message);
    throw error;
  }

  return { success: true, userId, isBlocked: false };
}

/**
 * Helper to wipe Telegram chat history and keyboard for a user
 */
export type TelegramCleanup = { attempted:number; accepted:number; alreadyAbsent:number; notDeletable:number; failed:number; keyboardRemoved:boolean; purged:boolean };
export async function purgeUserTelegramChat(targetChatId:string|number,messageIds:number[]=[]):Promise<TelegramCleanup> {
  const summary:TelegramCleanup={attempted:0,accepted:0,alreadyAbsent:0,notDeletable:0,failed:0,keyboardRemoved:false,purged:false};
  const ids=[...new Set(messageIds.filter(id=>Number.isSafeInteger(id)&&id>0))].sort((a,b)=>b-a);
  const token=(process.env.TELEGRAM_BOT_TOKEN||'').trim();
  if(!token || !/^[1-9][0-9]*$/.test(String(targetChatId))){summary.failed=ids.length||1;return summary;}
  const deadline=Date.now()+22000;
  const call=async(method:string,payload:any)=>{
    const remaining=deadline-Date.now();if(remaining<=0)throw Error('CLEANUP_TIMEOUT');
    const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:String(targetChatId),...payload}),signal:AbortSignal.timeout(Math.min(4000,remaining))});
    return response.json();
  };
  // Remove the native keyboard, then include this temporary message in cleanup.
  try {const r=await call('sendMessage',{text:'🗑️',disable_notification:true,reply_markup:{remove_keyboard:true}});
    if(r.ok&&Number.isSafeInteger(r.result?.message_id)){summary.keyboardRemoved=true;ids.unshift(r.result.message_id);}
  }catch{}
  for(let i=0;i<ids.length;i+=100){
    if(Date.now()>=deadline){summary.failed+=ids.length-i;break;}
    const chunk=ids.slice(i,i+100);summary.attempted+=chunk.length;
    try {const r=await call('deleteMessages',{message_ids:chunk});if(r.ok){summary.accepted+=chunk.length;continue;}if(r.error_code===429){summary.failed+=ids.length-i;break;}}catch{}
    // A single old message can reject a batch. Isolate failures with bounded concurrency.
    for(let j=0;j<chunk.length;j+=5){
      if(Date.now()>=deadline){summary.failed+=chunk.length-j;break;}
      await Promise.all(chunk.slice(j,j+5).map(async message_id=>{
        try {const r=await call('deleteMessage',{message_id});
          if(r.ok)summary.accepted++;
          else if(/not found/i.test(r.description||''))summary.alreadyAbsent++;
          else if(/can't be deleted|cannot be deleted|can not be deleted/i.test(r.description||''))summary.notDeletable++;
          else summary.failed++;
        }catch{summary.failed++;}
      }));
    }
  }
  // Bulk success means the known IDs were accepted, not proof that all chat history is gone.
  summary.purged=summary.keyboardRemoved&&summary.failed===0&&summary.notDeletable===0;
  return summary;
}

/**
 * Delete user account.
 * 
 * STRICT BOUNDARY:
 * - Automatically wipes Telegram bot chat history and keyboards for the user.
 * - Soft delete: marks account as deleted and blocked in onboarding.
 * - Hard delete: removes the user record from users table.
 */
export async function deleteUserAccount(
  userId: string,
  options: { hardDelete?: boolean; wipeTelegramChat?: boolean } = {}
): Promise<{ success: boolean; userId: string; deleted: boolean; mode: 'hard' | 'soft'; chatPurged?: boolean; telegramCleanup?:TelegramCleanup }> {
  if (!/^moliya_user_tg_[0-9]+$/.test(userId)) throw new Error('INVALID_USER_ID');

  const nowIso = new Date().toISOString();
  const shouldWipeChat = options.wipeTelegramChat !== false; // default true

  // Fetch user data prior to deletion for Telegram identity
  const { data: user, error: readError } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
  if(readError) throw new Error('ACCOUNT_STORE_UNAVAILABLE');
  if(!user || user.id!==userId || userId!=='moliya_user_tg_'+String(user.telegram_id)) throw new Error('USER_NOT_FOUND');
  const targetTgId = user?.telegram_id || user?.onboarding?.telegramId || (userId.startsWith('moliya_user_tg_') ? userId.replace('moliya_user_tg_', '') : null);
  const botMessages: any[] = await listBotMessages(userId).catch(() => []);
  const messageIds = [...botMessages.map((m: any) => Number(m.message_id || m.messageId)), ...['last_message_id','last_temp_msg_id','last_system_message_id','last_link_message_id'].map(key=>Number(user.onboarding?.[key]))].filter((id: number) => Number.isSafeInteger(id) && id > 0);

  // External chat cleanup starts only after a successful database mutation.
  const cleanupChat = async () => shouldWipeChat && targetTgId
    ? await purgeUserTelegramChat(targetTgId,messageIds) : undefined;

  if (options.hardDelete) {
    // Compare the identity/session snapshot; do not delete a refreshed account.
    let query=supabase.from('users').delete().eq('id',userId).eq('telegram_id',user.telegram_id);
    query=matchProfileSnapshot(query,user,['onboarding','device_info']);
    const { data: deleted, error } = await query.select('id').maybeSingle();
    if (error) {
      safeError(`[UserAccountService] Error hard-deleting user ${userId}:`, error.message);
      throw error;
    }
    if(!deleted) throw new Error('ACCOUNT_CHANGED');
    const telegramCleanup=await cleanupChat();
    const chatPurged=telegramCleanup?.purged===true;
    return { success: true, userId, deleted: true, mode: 'hard', chatPurged, telegramCleanup };
  } else {
    // Soft delete: deactivate account
    const updatedOb = {
      ...(user?.onboarding || {}),
      is_blocked: true,
      is_deleted: true,
      account_status: 'deleted',
      deleted_at: nowIso
    };
    delete (updatedOb as any).bot_messages;

    const { error } = await updateProfileSnapshot(userId, user, {
        onboarding: updatedOb,
        updated_at: nowIso
      });
    if (!error) await clearBotMessages(userId).catch((e) => safeWarn(`[UserAccountService] chat history clear failed for ${userId}:`, e));

    if (error) {
      safeError(`[UserAccountService] Error soft-deleting user ${userId}:`, error.message);
      throw error;
    }
    const telegramCleanup=await cleanupChat();
    const chatPurged=telegramCleanup?.purged===true;
    return { success: true, userId, deleted: true, mode: 'soft', chatPurged, telegramCleanup };
  }
}
