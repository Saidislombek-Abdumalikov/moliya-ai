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
 * Delete user account.
 * 
 * STRICT BOUNDARY:
 * - Soft delete (default): marks account as deleted and blocked in onboarding.
 * - Hard delete: removes the user record from users table.
 * - This is an ACCOUNT operation, distinct from data wiping.
 */
export async function deleteUserAccount(
  userId: string,
  options: { hardDelete?: boolean } = {}
): Promise<{ success: boolean; userId: string; deleted: boolean; mode: 'hard' | 'soft' }> {
  if (!userId) throw new Error('userId is required for deleteUserAccount');

  const nowIso = new Date().toISOString();

  if (options.hardDelete) {
    const { error } = await supabase.from('users').delete().eq('id', userId);
    if (error) {
      console.error(`[UserAccountService] Error hard-deleting user ${userId}:`, error.message);
      throw error;
    }
    return { success: true, userId, deleted: true, mode: 'hard' };
  } else {
    // Soft delete: deactivate account
    const { data: user } = await supabase.from('users').select('onboarding').eq('id', userId).maybeSingle();
    const updatedOb = {
      ...(user?.onboarding || {}),
      is_blocked: true,
      is_deleted: true,
      account_status: 'deleted',
      deleted_at: nowIso
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
    return { success: true, userId, deleted: true, mode: 'soft' };
  }
}
