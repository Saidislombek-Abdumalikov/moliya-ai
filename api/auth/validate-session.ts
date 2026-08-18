import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../_supabaseClient.js';
import { createSupabaseAuthSession } from '../_authHelper.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { sessionToken } = req.body || {};
    if (!sessionToken || typeof sessionToken !== 'string') {
      return res.status(200).json({ valid: false, reason: 'Missing sessionToken' });
    }

    // Find user in Supabase with matching session_token in onboarding JSONB
    const { data: userDoc, error } = await supabase
      .from('users')
      .select('*')
      .eq('onboarding->>session_token', sessionToken)
      .maybeSingle();

    if (!error && userDoc) {
      const expiresAt = userDoc.onboarding?.session_expires_at || userDoc.onboarding?.expires_at;
      if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
        return res.status(200).json({ valid: false, reason: 'Session expired' });
      }

      // Create real Supabase Auth session for this user
      const tgId = userDoc.telegram_id || userDoc.onboarding?.telegramId;
      let authSession = null;
      if (tgId) {
        authSession = await createSupabaseAuthSession(
          String(tgId),
          { name: userDoc.name || '', telegram: userDoc.telegram || '' }
        );
      }

      return res.status(200).json({
        valid: true,
        userId: userDoc.id,
        // Real Supabase Auth tokens
        access_token: authSession?.access_token || null,
        refresh_token: authSession?.refresh_token || null,
        onboarding: userDoc.onboarding || null,
        cards: userDoc.cards || [],
        transactions: userDoc.transactions || [],
        isPremium: userDoc.is_premium || false
      });
    }

    return res.status(200).json({ valid: false, reason: 'Session not found' });
  } catch (error: any) {
    console.error('Error validating session in Supabase:', error);
    return res.status(200).json({ valid: false, error: error.message });
  }
}
