import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../_supabaseClient.js';

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

    // Find user in Supabase with matching session_token
    const { data: userDoc, error } = await supabase
      .from('users')
      .select('*')
      .eq('session_token', sessionToken)
      .maybeSingle();

    if (!error && userDoc) {
      if (userDoc.session_expires_at && new Date(userDoc.session_expires_at).getTime() < Date.now()) {
        return res.status(200).json({ valid: false, reason: 'Session expired' });
      }

      return res.status(200).json({
        valid: true,
        userId: userDoc.id,
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
