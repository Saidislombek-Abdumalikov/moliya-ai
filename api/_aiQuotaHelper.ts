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

  try {
    // 1. Fetch user doc from Firestore REST API
    const userUrl = `${REST_BASE_URL}/users/${userId}`;
    const userRes = await fetch(userUrl);

    let isPremium = false;
    let usedCount = 0;
    let customLimit = 5; // Default free limit

    if (userRes.ok) {
      const docData: any = await userRes.json();
      const fields = docData.fields || {};

      isPremium = fields.isPremium?.booleanValue || fields.onboarding?.mapValue?.fields?.isPremium?.booleanValue || false;
      usedCount = fields.aiQueryCount?.integerValue ? parseInt(fields.aiQueryCount.integerValue) : 0;
      if (fields.customAiLimit?.integerValue) {
        customLimit = parseInt(fields.customAiLimit.integerValue);
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

    // 3. Log AI query & increment count asynchronously
    const nowIso = new Date().toISOString();
    
    // Write AI log entry to global collection /ai_global_logs
    const logUrl = `${REST_BASE_URL}/ai_global_logs`;
    fetch(logUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          userId: { stringValue: userId },
          queryType: { stringValue: queryType },
          promptSummary: { stringValue: promptSummary.slice(0, 150) },
          isPremium: { booleanValue: isPremium },
          timestamp: { stringValue: nowIso }
        }
      })
    }).catch(err => console.error('Error logging AI query to Firestore:', err));

    // Update user's aiQueryCount
    const newCount = usedCount + 1;
    const patchUrl = `${REST_BASE_URL}/users/${userId}?updateMask.fieldPaths=aiQueryCount&updateMask.fieldPaths=lastAiQueryAt`;
    fetch(patchUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          aiQueryCount: { integerValue: newCount },
          lastAiQueryAt: { stringValue: nowIso }
        }
      })
    }).catch(err => console.error('Error updating user aiQueryCount:', err));

    return { allowed: true, isPremium, limit: customLimit, usedCount: newCount };
  } catch (err) {
    console.error('AI Quota helper error:', err);
    // On unexpected error, allow request so user service isn't blocked
    return { allowed: true, isPremium: false, limit: 5, usedCount: 0 };
  }
}
