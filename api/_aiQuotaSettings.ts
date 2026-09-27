import { supabase } from './_supabaseClient.js';

export const FALLBACK_FREE_AI_QUOTA = 20;

export function defaultAiQuotaFromOnboarding(onboarding: any): number {
  const value = onboarding?.default_ai_quota;
  return Number.isInteger(value) && value >= 1 && value <= 500 ? value : FALLBACK_FREE_AI_QUOTA;
}

export async function loadDefaultAiQuota(): Promise<number> {
  try {
    const { data, error } = await supabase.from('users').select('onboarding')
      .eq('id', 'system_app_settings').maybeSingle();
    if (error) return FALLBACK_FREE_AI_QUOTA;
    return defaultAiQuotaFromOnboarding(data?.onboarding);
  } catch { return FALLBACK_FREE_AI_QUOTA; }
}
