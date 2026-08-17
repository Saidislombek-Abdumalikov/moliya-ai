import { supabase } from './_supabaseClient.js';

const PROJECT_ID = "arctic-pad-sn56p";
const DATABASE_ID = "ai-studio-moliyav2-593a4147-5cc2-4aec-9b0e-422088ddb24a";
const REST_BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;

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
  let customLimit = 5; // Default free quota

  try {
    // 1. Check Supabase first
    const { data: suUser } = await supabase
      .from('users')
      .select('is_premium, ai_query_count')
      .eq('id', userId)
      .maybeSingle();

    if (suUser) {
      isPremium = !!suUser.is_premium;
      usedCount = Number(suUser.ai_query_count || 0);
    } else {
      // Fallback: Check Firestore REST API
      const userUrl = `${REST_BASE_URL}/users/${userId}`;
      const userRes = await fetch(userUrl);
      if (userRes.ok) {
        const docData: any = await userRes.json();
        const fields = docData.fields || {};
        isPremium = fields.isPremium?.booleanValue || fields.onboarding?.mapValue?.fields?.isPremium?.booleanValue || false;
        usedCount = fields.aiQueryCount?.integerValue ? parseInt(fields.aiQueryCount.integerValue) : 0;
      }
    }

    // 2. Check Quota for Free Users
    if (!isPremium && usedCount >= customLimit) {
      return {
        allowed: false,
        isPremium: false,
        limit: customLimit,
        usedCount,
        message: `Bepul AI limidi (${customLimit} ta) tugadi. Cheksiz AI ishlatish uchun VIP Premium oling!`
      };
    }

    const newCount = usedCount + 1;

    // 3. Log to Supabase ai_logs & update Supabase users
    supabase.from('ai_logs').insert({
      user_id: userId,
      query_type: queryType,
      prompt_summary: promptSummary.slice(0, 250),
      is_premium: isPremium,
      timestamp: nowIso
    }).then(({ error }) => {
      if (error) console.error('[SUPABASE] ai_logs insert error:', error.message);
    });

    supabase.from('users').upsert({
      id: userId,
      is_premium: isPremium,
      ai_query_count: newCount,
      last_ai_query_at: nowIso,
      updated_at: nowIso
    }, { onConflict: 'id' }).then(({ error }) => {
      if (error) console.error('[SUPABASE] users update error:', error.message);
    });

    // 4. Also update Firestore for dual backup
    fetch(`${REST_BASE_URL}/users/${userId}?updateMask.fieldPaths=aiQueryCount&updateMask.fieldPaths=lastAiQueryAt`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          aiQueryCount: { integerValue: newCount },
          lastAiQueryAt: { stringValue: nowIso }
        }
      })
    }).catch(() => {});

    return { allowed: true, isPremium, limit: customLimit, usedCount: newCount };
  } catch (err) {
    console.error('AI Quota helper error:', err);
    return { allowed: true, isPremium: false, limit: 5, usedCount: 0 };
  }
}
