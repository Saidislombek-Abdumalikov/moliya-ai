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

  const requestId = (req.query.requestId as string) || (req.body && req.body.requestId);
  if (!requestId || typeof requestId !== 'string') {
    return res.status(400).json({ error: 'Missing requestId parameter' });
  }

  const cleanId = requestId.replace(/^req_/, '').trim();

  try {
    const { data: reqDoc, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', `req_${cleanId}`)
      .maybeSingle();

    if (!error && reqDoc) {
      if (reqDoc.login_request_status === 'VERIFIED' && reqDoc.telegram_id && reqDoc.session_token) {
        const userId = `moliya_user_tg_${reqDoc.telegram_id}`;
        const { data: userDoc } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();

        // Create real Supabase Auth session
        const authSession = await createSupabaseAuthSession(
          reqDoc.telegram_id,
          { name: userDoc?.name || '', telegram: userDoc?.telegram || '' }
        );

        return res.status(200).json({
          status: 'VERIFIED',
          userId,
          sessionToken: reqDoc.session_token,
          // Real Supabase Auth tokens
          access_token: authSession?.access_token || null,
          refresh_token: authSession?.refresh_token || null,
          onboarding: userDoc?.onboarding || null,
          phone: userDoc?.phone || '',
          cards: userDoc?.cards || [],
          transactions: userDoc?.transactions || []
        });
      }
      return res.status(200).json({ status: reqDoc.login_request_status || 'PENDING' });
    }

    return res.status(200).json({ status: 'PENDING' });
  } catch (error: any) {
    console.error('Error checking login request in Supabase:', error);
    return res.status(200).json({ status: 'PENDING' });
  }
}
