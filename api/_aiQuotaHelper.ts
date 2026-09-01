import { supabase } from './_supabaseClient.js';

export interface QuotaCheckResult {
  allowed: boolean;
  isPremium: boolean;
  isTrial: boolean;
  limit: number | null;
  usedCount: number;
  remaining?: number;
  message?: string;
}

/**
 * Helper to get current UTC Date string (YYYY-MM-DD)
 */
function getUtcDateString(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/**
 * CHECK ONLY — Does the user have remaining AI quota?
 * Handles 1-Day Unlimited Trial, Expiration, and Free Tier (5 AI ops/day) with Daily Reset.
 */
export async function checkAiQuota(
  userId: string | undefined
): Promise<QuotaCheckResult> {
  if (!userId) {
    return { allowed: true, isPremium: false, isTrial: false, limit: 5, usedCount: 0, remaining: 5 };
  }

  try {
    const { data: suUser, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (fetchError) {
      console.error('[AI_QUOTA] Database fetch error:', fetchError.message);
      return {
        allowed: false,
        isPremium: false,
        isTrial: false,
        limit: 5,
        usedCount: 0,
        message: "Ma'lumotlar bazasiga ulanishda xatolik. Iltimos, qayta urinib ko'ring."
      };
    }

    // 1. Check if user is blocked by admin
    const isUserBlocked = Boolean(
      suUser?.is_blocked ||
      suUser?.onboarding?.is_blocked ||
      suUser?.device_info?.is_blocked ||
      suUser?.is_restricted ||
      suUser?.onboarding?.is_restricted ||
      suUser?.device_info?.restricted
    );

    if (isUserBlocked) {
      return {
        allowed: false,
        isPremium: Boolean(suUser?.is_premium),
        isTrial: false,
        limit: 0,
        usedCount: Number(suUser?.ai_query_count || 0),
        remaining: 0,
        message: "⛔ Hisobingiz ma'muriyat tomonidan bloklangan. Yordam uchun @moliya_admin ga murojaat qiling."
      };
    }

    // 2. Check 1-Day Premium Trial & Expiration
    let isPremium = false;
    let isTrial = false;
    const nowMs = Date.now();

    if (suUser?.is_premium) {
      if (suUser.premium_expires_at) {
        const expiresMs = new Date(suUser.premium_expires_at).getTime();
        if (nowMs < expiresMs) {
          isPremium = true;
          // If trial_ends_at is set, it's the 1-day trial
          isTrial = Boolean(suUser.trial_ends_at || suUser.onboarding?.trial_ends_at);
        } else {
          // Trial / VIP expired -> auto downgrade in database
          isPremium = false;
          isTrial = false;
          supabase
            .from('users')
            .update({
              is_premium: false,
              ai_limit: 5,
              updated_at: new Date().toISOString()
            })
            .eq('id', userId)
            .then(() => {});
        }
      } else {
        // Lifetime VIP
        isPremium = true;
      }
    }

    // 3. Daily Usage & Daily Reset Calculation (UTC boundary)
    const todayUtc = getUtcDateString(new Date());
    const lastQueryUtc = suUser?.last_ai_query_at ? getUtcDateString(new Date(suUser.last_ai_query_at)) : null;

    let usedCount = 0;
    if (lastQueryUtc === todayUtc) {
      usedCount = Number(suUser?.ai_query_count || 0);
    } else {
      // New day -> usage resets to 0
      usedCount = 0;
    }

    // 4. Effective AI Limit:
    // VIP or Active Trial -> Unlimited (null)
    // Custom limit override -> suUser.ai_limit (if > 0)
    // Free Tier -> 5 AI operations per day
    let effectiveLimit: number | null = null;
    if (isPremium) {
      effectiveLimit = null; // Unlimited for VIP / 1-day Trial
    } else if (suUser?.ai_limit === 0 || suUser?.ai_limit === -1) {
      effectiveLimit = null; // Admin explicit unlimited
    } else if (suUser?.ai_limit !== undefined && suUser?.ai_limit !== null && suUser.ai_limit > 0) {
      effectiveLimit = suUser.ai_limit;
    } else {
      effectiveLimit = 5; // Standard Free tier limit = 5 ops/day
    }

    // 5. Quota Evaluation
    const hasQuota = (effectiveLimit === null) || (usedCount < effectiveLimit);
    const remaining = effectiveLimit === null ? 999 : Math.max(0, effectiveLimit - usedCount);

    if (!hasQuota) {
      return {
        allowed: false,
        isPremium,
        isTrial,
        limit: effectiveLimit,
        usedCount,
        remaining: 0,
        message: isTrial
          ? "1 kunlik cheksiz Premium sinov muddatingiz tugadi. Bepul tarifda kuniga 5 ta AI so'rovi mavjud."
          : `Kunlik bepul AI limitingiz (${effectiveLimit || 5} ta) tugadi. Ertaga yangilanadi yoki cheksiz AI uchun VIP oling!`
      };
    }

    return {
      allowed: true,
      isPremium,
      isTrial,
      limit: effectiveLimit,
      usedCount,
      remaining
    };
  } catch (err) {
    console.error('[AI_QUOTA] Exception during quota check:', err);
    return {
      allowed: false,
      isPremium: false,
      isTrial: false,
      limit: 5,
      usedCount: 0,
      message: "Tizimda xatolik yuz berdi. Iltimos, qayta urinib ko'ring."
    };
  }
}

/**
 * RECORD USAGE — Increments user AI query count and logs to ai_logs table.
 * Resets count if it's a new UTC day.
 */
export async function recordAiUsage(
  userId: string | undefined,
  queryType: 'text' | 'receipt',
  promptSummary: string,
  isPremium: boolean = false
): Promise<{ newCount: number }> {
  if (!userId) return { newCount: 0 };

  try {
    const now = new Date();
    const todayUtc = getUtcDateString(now);

    const { data: user } = await supabase
      .from('users')
      .select('ai_query_count, last_ai_query_at')
      .eq('id', userId)
      .maybeSingle();

    const lastQueryUtc = user?.last_ai_query_at ? getUtcDateString(new Date(user.last_ai_query_at)) : null;

    let newCount = 1;
    if (lastQueryUtc === todayUtc) {
      newCount = Number(user?.ai_query_count || 0) + 1;
    } else {
      newCount = 1; // Reset to 1 for the new day
    }

    await supabase
      .from('users')
      .update({
        ai_query_count: newCount,
        last_ai_query_at: now.toISOString(),
        updated_at: now.toISOString()
      })
      .eq('id', userId);

    // Write audit log
    await supabase
      .from('ai_logs')
      .insert([{
        user_id: userId,
        query_type: queryType,
        prompt_summary: (promptSummary || '').slice(0, 300),
        is_premium: isPremium,
        timestamp: now.toISOString()
      }]);

    return { newCount };
  } catch (e) {
    console.error('[AI_QUOTA] Error recording usage in Supabase:', e);
    return { newCount: 1 };
  }
}

export const recordAiUsageBackend = recordAiUsage;

/**
 * Combined check & record helper
 */
export async function checkAndRecordAiUsage(
  userId: string | undefined,
  queryType: 'text' | 'receipt' = 'text',
  promptSummary: string = ''
): Promise<QuotaCheckResult> {
  const check = await checkAiQuota(userId);
  if (!check.allowed) {
    return check;
  }

  const usage = await recordAiUsage(userId, queryType, promptSummary, check.isPremium);
  return {
    allowed: true,
    isPremium: check.isPremium,
    isTrial: check.isTrial,
    limit: check.limit,
    usedCount: usage.newCount,
    remaining: check.limit === null ? 999 : Math.max(0, check.limit - usage.newCount),
    message: undefined
  };
}
