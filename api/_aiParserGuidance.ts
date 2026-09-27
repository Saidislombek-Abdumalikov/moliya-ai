import { supabase } from './_supabaseClient.js';

let cached = '';
let expiresAt = 0;
let inFlight: Promise<string> | null = null;

// A short cache keeps normal parsing fast. Missing settings never disable the
// server-owned amount and eligibility rules.
export async function loadAiParserGuidance(): Promise<string> {
  if (Date.now() < expiresAt) return cached;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const { data, error } = await supabase.from('users').select('onboarding')
        .eq('id', 'system_app_settings').maybeSingle();
      if (error) return '';
      const value = data?.onboarding?.ai_parser_guidance;
      cached = typeof value === 'string' && value.length <= 2000 ? value : '';
      expiresAt = Date.now() + 30000;
      return cached;
    } catch { return ''; }
    finally { inFlight = null; }
  })();
  return inFlight;
}

export function invalidateAiParserGuidance(): void {
  cached = '';
  expiresAt = 0;
}
