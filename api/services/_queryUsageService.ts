import { safeError } from '../_logger.js';
import {checkAiQuota,checkAndRecordAiUsage} from '../_aiQuotaHelper.js';
import { supabase } from '../_supabaseClient.js';

export interface QueryUsageStatus {
  userId: string;
  usedCount: number;
  limit: number | null;
  remaining: number | null;
  isUnlimited: boolean;
  lastQueryAt?: string | null;
}

/**
 * Fetch daily AI query usage for a user.
 * Scoped strictly by userId.
 */
export async function getDailyQueryUsage(userId: string): Promise<QueryUsageStatus> {
  if (!userId) throw new Error('userId is required for getDailyQueryUsage');

  const quota=await checkAiQuota(userId);
  if(quota.statusCode===503) throw new Error('QUOTA_STORE_UNAVAILABLE');
  return {userId,usedCount:quota.usedCount,limit:quota.limit,remaining:quota.limit===null?null:(quota.remaining || 0),isUnlimited:quota.limit===null};
}

/**
 * RESET DAILY QUERIES TO 0.
 * 
 * STRICT BOUNDARY:
 * - Resets ONLY the daily usage counter: ai_query_count = 0.
 * - Does NOT wipe financial data.
 * - Does NOT delete messages.
 * - Does NOT remove or alter premium.
 * - Does NOT block or unblock user.
 * - Does NOT delete files or accounts.
 * - Strictly scoped to userId.
 */
export async function resetDailyQueries(userId: string): Promise<{
  success: boolean;
  userId: string;
  aiQueryCount: number;
  resetAt: string;
}> {
  if (!/^moliya_user_tg_[0-9]+$/.test(userId)) throw new Error('INVALID_USER_ID');

  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from('users')
    .update({
      ai_query_count: 0,
      last_ai_query_at: nowIso,
      updated_at: nowIso
    })
    .eq('id', userId).select('id').maybeSingle();

  if (error) {
    safeError(`[QueryUsageService] Error resetting queries for ${userId}:`, error.message);
    throw error;
  }

  if(!data)throw new Error('USER_NOT_FOUND');
  return {
    success: true,
    userId,
    aiQueryCount: 0,
    resetAt: nowIso
  };
}

/**
 * Increment daily AI query usage by a given amount (default 1).
 */
export async function incrementDailyUsage(userId: string, delta: number = 1): Promise<number> {
  if (!userId) throw new Error('userId is required for incrementDailyUsage');

  if(delta!==1) throw new Error('Only one preflight AI reservation is supported');
  const quota=await checkAndRecordAiUsage(userId,'text','','internal');
  if(!quota.allowed) throw new Error(quota.code || 'AI_QUOTA_DENIED');
  return quota.usedCount;
}
