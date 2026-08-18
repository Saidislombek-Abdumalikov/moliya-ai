import { supabase } from './_supabaseClient.js';

export interface QuotaCheckResult {
  allowed: boolean;
  isPremium: boolean;
  limit: number;
  usedCount: number;
  message?: string;
}

export async function checkAndRecordAiUsage(
  userId: string | undefined,
  queryType: 'text' | 'receipt',
  promptSummary: string
): Promise<QuotaCheckResult> {
  // If no userId, allow query as guest with standard limit check skipped
  if (!userId) {
    return { allowed: true, isPremium: false, limit: 5, usedCount: 0 };
  }

  const nowIso = new Date().toISOString();
  let isPremium = false;
  let usedCount = 0;
  const customLimit = 5; // Default free quota

  try {
    // 1. Fetch user subscription & quota status from Supabase users table
    const { data: suUser } = await supabase
      .from('users')
      .select('is_premium, premium_expires_at, ai_limit, ai_query_count')
      .eq('id', userId)
      .maybeSingle();

    if (suUser) {
      const isExpired = suUser.premium_expires_at 
        ? new Date(suUser.premium_expires_at) <= new Date() 
        : false;
      isPremium = Boolean(suUser.is_premium && !isExpired);
      usedCount = Number(suUser.ai_query_count || 0);
    }

    const aiLimit = suUser?.ai_limit !== undefined && suUser?.ai_limit !== null
      ? suUser.ai_limit
      : (isPremium ? null : 5);

    // 2. Check Quota
    const hasQuota = isPremium 
      ? (aiLimit === null || usedCount < aiLimit)
      : usedCount < (aiLimit || 5);

    if (!hasQuota) {
      return {
        allowed: false,
        isPremium,
        limit: aiLimit || 5,
        usedCount,
        message: isPremium 
          ? `VIP tarifdagi oylik AI so'rovlar limiti (${aiLimit} ta) tugadi.`
          : `Bepul AI limiti (${aiLimit || 5} ta) tugadi. Cheksiz AI ishlatish uchun VIP Premium oling!`
      };
    }

    const newCount = usedCount + 1;

    // 3. Log to Supabase ai_logs table
    await supabase.from('ai_logs').insert({
      user_id: userId,
      query_type: queryType,
      prompt_summary: promptSummary.slice(0, 250),
      is_premium: isPremium,
      timestamp: nowIso
    });

    // 4. Update user's ai_query_count and last_ai_query_at in Supabase
    await supabase.from('users').upsert({
      id: userId,
      is_premium: isPremium,
      ai_query_count: newCount,
      last_ai_query_at: nowIso,
      updated_at: nowIso
    }, { onConflict: 'id' });

    return { allowed: true, isPremium, limit: customLimit, usedCount: newCount };
  } catch (err) {
    console.error('AI Quota helper error:', err);
    return { allowed: true, isPremium: false, limit: 5, usedCount: 0 };
  }
}
