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
    return {
      allowed: false,
      isPremium: false,
      isTrial: false,
      limit: 20,
      usedCount: 0,
      remaining: 0,
      message: "Foydalanuvchi hisobi aniqlanmadi. Iltimos, tizimga qayta kiring."
    };
  }

  try {
    const tgId = userId.startsWith('moliya_user_tg_') ? userId.replace('moliya_user_tg_', '') : null;
    const idsToFetch = tgId ? [userId, `restricted_tg_${tgId}`] : [userId];

    const { data: userRows, error: fetchError } = await supabase
      .from('users')
      .select('id, is_premium, premium_expires_at, ai_limit, ai_query_count, last_ai_query_at, onboarding, device_info, unlimited_ai, ai_blocked, is_blocked, is_restricted, trial_ends_at')
      .in('id', idsToFetch);

    if (fetchError) {
      console.error('[AI_QUOTA] Database fetch error:', fetchError.message);
      return {
        allowed: false,
        isPremium: false,
        isTrial: false,
        limit: 20,
        usedCount: 0,
        message: "Ma'lumotlar bazasiga ulanishda xatolik. Iltimos, qayta urinib ko'ring."
      };
    }

    const suUser = userRows?.find((u: any) => u.id === userId);
    const blockedDoc = userRows?.find((u: any) => u.id === `restricted_tg_${tgId}`);
    const isIdentityBlocked = Boolean(blockedDoc && blockedDoc.onboarding?.is_blocked !== false);

    const isUserBlocked = Boolean(
      isIdentityBlocked ||
      suUser?.onboarding?.is_blocked ||
      suUser?.device_info?.is_blocked ||
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

    // 2. Use centralized effectiveAccess for all access decisions
    const { effectiveAccess } = await import('./_accessHelper.js');
    const access = effectiveAccess(suUser);
    const isPremium = access.isPremium;
    const isTrial = access.level === 'TRIAL';

    // If access is blocked or AI is blocked, reject immediately
    if (!access.canUseAi) {
      return {
        allowed: false,
        isPremium: false,
        isTrial: false,
        limit: 0,
        usedCount: Number(suUser?.ai_query_count || 0),
        remaining: 0,
        message: access.level === 'BLOCKED'
          ? "⛔ Hisobingiz ma'muriyat tomonidan bloklangan. Yordam uchun @moliya_admin ga murojaat qiling."
          : "⛔ AI xizmati ma'muriyat tomonidan cheklangan. Yordam uchun @moliya_admin ga murojaat qiling."
      };
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

    // 4. Use effectiveAccess aiLimit (single source of truth)
    const effectiveLimit = access.aiLimit;

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
          ? "1 kunlik cheksiz Premium sinov muddatingiz tugadi. Xarajatlarni qo'lda kiritish mutlaqo bepul va cheksiz!"
          : `Kunlik bepul AI limitingiz (${effectiveLimit || 20} ta) tugadi. Xarajatlarni ilovada qo'lda kiritish mutlaqo bepul va cheksiz! Cheksiz AI tahlil uchun VIP oling.`
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
      limit: 20,
      usedCount: 0,
      message: "Tizimda xatolik yuz berdi. Iltimos, qayta urinib ko'ring."
    };
  }
}

/**
 * RECORD USAGE — Increments user AI query count and logs to ai_logs table.
 * Executes writes in parallel without redundant select queries.
 */
export async function recordAiUsage(
  userId: string | undefined,
  queryType: 'text' | 'receipt' | 'voice',
  promptSummary: string,
  isPremium: boolean = false,
  currentCount?: number,
  source?: 'telegram_bot' | 'mini_app' | string
): Promise<{ newCount: number }> {
  if (!userId) return { newCount: 0 };

  const now = new Date();
  const nowIso = now.toISOString();

  let nextCount = 1;
  if (typeof currentCount === 'number') {
    nextCount = currentCount + 1;
  } else {
    try {
      const { data: uRow } = await supabase
        .from('users')
        .select('ai_query_count')
        .eq('id', userId)
        .maybeSingle();
      nextCount = Number(uRow?.ai_query_count || 0) + 1;
    } catch {
      nextCount = 1;
    }
  }

  // Execute database updates in parallel
  // NOTE: ai_logs schema uses raw_payload (JSONB) for metadata, not a top-level 'source' column!
  Promise.all([
    supabase
      .from('users')
      .update({
        ai_query_count: nextCount,
        last_ai_query_at: nowIso,
        updated_at: nowIso
      })
      .eq('id', userId),
    supabase
      .from('ai_logs')
      .insert([{
        user_id: userId,
        query_type: queryType || 'text',
        prompt_summary: (promptSummary || '').slice(0, 300),
        is_premium: isPremium,
        raw_payload: { source: source || 'unknown' },
        timestamp: nowIso
      }])
  ]).catch(err => {
    console.warn('[AI_QUOTA] Background usage recording error:', err?.message);
  });

  return { newCount: nextCount };
}

export const recordAiUsageBackend = recordAiUsage;

/**
 * Combined check & record helper — fast single-fetch execution
 */
export async function checkAndRecordAiUsage(
  userId: string | undefined,
  queryType: 'text' | 'receipt' = 'text',
  promptSummary: string = '',
  source: 'telegram_bot' | 'mini_app' | string = 'mini_app'
): Promise<QuotaCheckResult> {
  const check = await checkAiQuota(userId);
  if (!check.allowed) {
    return check;
  }

  const usage = await recordAiUsage(userId, queryType, promptSummary, check.isPremium, check.usedCount, source);
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
