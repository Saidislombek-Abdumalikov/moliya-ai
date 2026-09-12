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

  const { data: user, error } = await supabase
    .from('users')
    .select('ai_query_count, last_ai_query_at, ai_limit, is_premium, premium_expires_at, onboarding')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error(`[QueryUsageService] Error fetching usage for ${userId}:`, error.message);
    throw error;
  }

  const isPrem = Boolean(user?.is_premium || user?.onboarding?.is_vip);
  const aiLimit = user?.ai_limit !== undefined ? user.ai_limit : (isPrem ? null : 20);
  const isUnlimited = aiLimit === null || isPrem;

  let usedCount = Number(user?.ai_query_count) || 0;
  const lastQueryAt = user?.last_ai_query_at || null;

  // Check UTC day rollover
  const todayUtc = new Date().toISOString().slice(0, 10);
  const lastQueryUtc = lastQueryAt ? new Date(lastQueryAt).toISOString().slice(0, 10) : null;
  if (lastQueryUtc && lastQueryUtc !== todayUtc) {
    usedCount = 0; // Rolled over to new day
  }

  const remaining = isUnlimited ? null : Math.max(0, (aiLimit || 20) - usedCount);

  return {
    userId,
    usedCount,
    limit: aiLimit,
    remaining,
    isUnlimited,
    lastQueryAt
  };
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
  if (!userId) throw new Error('userId is required for resetDailyQueries');

  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .from('users')
    .update({
      ai_query_count: 0,
      last_ai_query_at: nowIso,
      updated_at: nowIso
    })
    .eq('id', userId);

  if (error) {
    console.error(`[QueryUsageService] Error resetting queries for ${userId}:`, error.message);
    throw error;
  }

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

  const { data: user } = await supabase.from('users').select('ai_query_count, last_ai_query_at').eq('id', userId).maybeSingle();

  const now = new Date();
  const nowIso = now.toISOString();
  const todayUtc = nowIso.slice(0, 10);
  const lastUtc = user?.last_ai_query_at ? new Date(user.last_ai_query_at).toISOString().slice(0, 10) : null;

  const currentCount = (lastUtc && lastUtc !== todayUtc) ? 0 : (Number(user?.ai_query_count) || 0);
  const newCount = currentCount + delta;

  await supabase
    .from('users')
    .update({
      ai_query_count: newCount,
      last_ai_query_at: nowIso,
      updated_at: nowIso
    })
    .eq('id', userId);

  return newCount;
}
