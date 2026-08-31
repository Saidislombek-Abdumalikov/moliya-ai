import { supabase } from './_supabaseClient.js';

export interface QuotaCheckResult {
  allowed: boolean;
  isPremium: boolean;
  limit: number | null;
  usedCount: number;
  message?: string;
}

/**
 * CHECK ONLY — Does the user have remaining AI quota?
 * Does NOT increment any counters. Safe to call before AI request.
 */
export async function checkAiQuota(
  userId: string | undefined
): Promise<QuotaCheckResult> {
  // Allow guest users with a small limit (they haven't connected Telegram yet)
  if (!userId) {
    return { allowed: true, isPremium: false, limit: 10, usedCount: 0 };
  }

  try {
    // 1. Fetch user subscription & quota status from Supabase users table
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
        limit: 20,
        usedCount: 0,
        message: "Ma'lumotlar bazasiga ulanishda xatolik. Iltimos, qayta urinib ko'ring."
      };
    }

    // Check if user is blocked by admin
    if (suUser?.is_blocked) {
      return {
        allowed: false,
        isPremium: Boolean(suUser.is_premium),
        limit: 0,
        usedCount: Number(suUser.ai_query_count || 0),
        message: "Hisobingiz ma'muriyat tomonidan bloklangan. Yordam uchun @moliya_admin ga murojaat qiling."
      };
    }

    let isPremium = false;
    let usedCount = 0;

    if (suUser) {
      const isExpired = suUser.premium_expires_at 
        ? new Date(suUser.premium_expires_at).getTime() <= Date.now() 
        : false;
      isPremium = Boolean(suUser.is_premium && !isExpired);
      usedCount = Number(suUser.ai_query_count || 0);
    }

    // AI Limit Evaluation:
    // null or undefined: VIP = Unlimited (null), Free = 20
    // 0 or -1: UNLIMITED (null)
    // > 0: Custom limit number (e.g. 50, 100)
    let effectiveLimit: number | null = null;
    if (suUser?.ai_limit === 0 || suUser?.ai_limit === -1) {
      effectiveLimit = null; // Unlimited!
    } else if (suUser?.ai_limit !== undefined && suUser?.ai_limit !== null && suUser.ai_limit > 0) {
      effectiveLimit = suUser.ai_limit;
    } else {
      effectiveLimit = isPremium ? null : 20;
    }

    // 2. Check Quota: If effectiveLimit is null, it's UNLIMITED (always allowed)
    const hasQuota = (effectiveLimit === null) || (usedCount < effectiveLimit);

    if (!hasQuota) {
      return {
        allowed: false,
        isPremium,
        limit: effectiveLimit,
        usedCount,
        message: isPremium 
          ? `VIP tarifdagi kunlik AI so'rovlar limitingiz (${effectiveLimit} ta) tugadi.`
          : `Bepul AI kunlik limitingiz (${effectiveLimit || 20} ta) tugadi. Cheksiz AI ishlatish uchun VIP Premium obunasini oling!`
      };
    }

    return { allowed: true, isPremium, limit: effectiveLimit, usedCount };
  } catch (err) {
    console.error('AI Quota check error:', err);
    return {
      allowed: false,
      isPremium: false,
      limit: 20,
      usedCount: 0,
      message: "Tizimda xatolik yuz berdi. Iltimos, qayta urinib ko'ring."
    };
  }
}

/**
 * RECORD USAGE — Increment the user's AI query count and log the request.
 * Call this ONLY AFTER a successful AI response.
 */
export async function recordAiUsage(
  userId: string | undefined,
  queryType: 'text' | 'receipt',
  promptSummary: string,
  isPremium: boolean = false
): Promise<{ newCount: number }> {
  if (!userId) return { newCount: 0 };

  try {
    const { data: user } = await supabase
      .from('users')
      .select('ai_query_count')
      .eq('id', userId)
      .maybeSingle();

    const current = Number(user?.ai_query_count || 0);
    const newCount = current + 1;

    await supabase
      .from('users')
      .update({
        ai_query_count: newCount,
        last_ai_query_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    // Audit log
    await supabase
      .from('ai_logs')
      .insert([{
        user_id: userId,
        query_type: queryType,
        prompt_summary: (promptSummary || '').slice(0, 300),
        is_premium: isPremium,
        timestamp: new Date().toISOString()
      }]);

    return { newCount };
  } catch (e) {
    console.error('[AI_QUOTA] Error recording usage in Supabase:', e);
    return { newCount: 1 };
  }
}

export const recordAiUsageBackend = recordAiUsage;

/**
 * Legacy combined check and record helper for server routes and tests.
 * Maintains backward-compatible return shape including usedCount and isPremium.
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
    limit: check.limit,
    usedCount: usage.newCount,
    message: undefined
  };
}
