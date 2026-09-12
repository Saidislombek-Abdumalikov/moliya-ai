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
    console.error(`[UserAccountService] Error fetching user ${userId}:`, error.message);
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
  const { data: user } = await supabase.from('users').select('onboarding').eq('id', userId).maybeSingle();
  const updatedOb = {
    ...(user?.onboarding || {}),
    is_blocked: true,
    blocked_at: nowIso,
    block_reason: reason
  };

  const { error } = await supabase
    .from('users')
    .update({
      onboarding: updatedOb,
      updated_at: nowIso
    })
    .eq('id', userId);

  if (error) {
    console.error(`[UserAccountService] Error blocking user ${userId}:`, error.message);
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

  const { data: user } = await supabase.from('users').select('onboarding').eq('id', userId).maybeSingle();
  const updatedOb = {
    ...(user?.onboarding || {}),
    is_blocked: false,
    unblocked_at: nowIso
  };

  const { error } = await supabase
    .from('users')
    .update({
      onboarding: updatedOb,
      updated_at: nowIso
    })
    .eq('id', userId);

  if (error) {
    console.error(`[UserAccountService] Error unblocking user ${userId}:`, error.message);
    throw error;
  }

  return { success: true, userId, isBlocked: false };
}

/**
 * Helper to wipe Telegram chat history and keyboard for a user
 */
async function purgeUserTelegramChat(targetChatId: string | number, messageIds: number[] = []): Promise<{ purged: boolean }> {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
  if (!BOT_TOKEN || !targetChatId || String(targetChatId) === '—') return { purged: false };

  try {
    const idsToDelete = new Set<number>();
    messageIds.forEach(id => {
      if (Number.isInteger(id) && id > 0) idsToDelete.add(id);
    });

    let topMsgId: number | null = null;
    try {
      const probeRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: String(targetChatId),
          text: '·',
          disable_notification: true
        })
      });
      const probeData: any = await probeRes.json();
      if (probeData.ok && probeData.result?.message_id) {
        topMsgId = probeData.result.message_id;
        idsToDelete.add(topMsgId);
      }
    } catch {}

    if (topMsgId && topMsgId > 0) {
      const minId = Math.max(1, topMsgId - 150);
      for (let m = topMsgId; m >= minId; m--) {
        idsToDelete.add(m);
      }
    }

    const idList = Array.from(idsToDelete).sort((a, b) => b - a);
    for (let i = 0; i < idList.length; i += 100) {
      const chunk = idList.slice(i, i + 100);
      try {
        const batchRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: String(targetChatId), message_ids: chunk })
        });
        const batchData: any = await batchRes.json();
        if (!batchData.ok) {
          await Promise.allSettled(
            chunk.map(msgId =>
              fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: String(targetChatId), message_id: msgId })
              })
            )
          );
        }
      } catch {}

      if (i + 100 < idList.length) {
        await new Promise(r => setTimeout(r, 40));
      }
    }

    // Permanently wipe client keyboard state
    try {
      const kbRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: String(targetChatId),
          text: '🗑️',
          disable_notification: true,
          reply_markup: { remove_keyboard: true }
        })
      });
      const kbData: any = await kbRes.json();
      if (kbData.ok && kbData.result?.message_id) {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: String(targetChatId), message_id: kbData.result.message_id })
        }).catch(() => {});
      }
    } catch {}

    return { purged: true };
  } catch {
    return { purged: false };
  }
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
): Promise<{ success: boolean; userId: string; deleted: boolean; mode: 'hard' | 'soft'; chatPurged?: boolean }> {
  if (!userId) throw new Error('userId is required for deleteUserAccount');

  const nowIso = new Date().toISOString();
  const shouldWipeChat = options.wipeTelegramChat !== false; // default true

  // Fetch user data prior to deletion for Telegram identity
  const { data: user } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
  const targetTgId = user?.telegram_id || user?.onboarding?.telegramId || (userId.startsWith('moliya_user_tg_') ? userId.replace('moliya_user_tg_', '') : null);
  const botMessages: any[] = Array.isArray(user?.onboarding?.bot_messages) ? user.onboarding.bot_messages : [];
  const messageIds = botMessages.map((m: any) => Number(m.message_id || m.messageId)).filter((id: number) => Number.isInteger(id) && id > 0);

  let chatPurged = false;
  if (shouldWipeChat && targetTgId) {
    const purgeRes = await purgeUserTelegramChat(targetTgId, messageIds);
    chatPurged = purgeRes.purged;
  }

  if (options.hardDelete) {
    const { error } = await supabase.from('users').delete().eq('id', userId);
    if (error) {
      console.error(`[UserAccountService] Error hard-deleting user ${userId}:`, error.message);
      throw error;
    }
    if (targetTgId) {
      try {
        await supabase.from('users').delete().or(`id.eq.moliya_user_tg_${targetTgId},id.eq.req_${targetTgId},id.eq.exchange_${targetTgId}`);
      } catch {}
    }
    return { success: true, userId, deleted: true, mode: 'hard', chatPurged };
  } else {
    // Soft delete: deactivate account
    const updatedOb = {
      ...(user?.onboarding || {}),
      is_blocked: true,
      is_deleted: true,
      account_status: 'deleted',
      deleted_at: nowIso,
      bot_messages: []
    };

    const { error } = await supabase
      .from('users')
      .update({
        onboarding: updatedOb,
        updated_at: nowIso
      })
      .eq('id', userId);

    if (error) {
      console.error(`[UserAccountService] Error soft-deleting user ${userId}:`, error.message);
      throw error;
    }
    return { success: true, userId, deleted: true, mode: 'soft', chatPurged };
  }
}
