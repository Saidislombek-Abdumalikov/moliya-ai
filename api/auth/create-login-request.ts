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

  try {
    const { requestId } = req.body || {};
    if (!requestId || typeof requestId !== 'string' || requestId.length < 8) {
      return res.status(400).json({ error: 'Invalid or missing requestId' });
    }

    const cleanId = requestId.replace(/^req_/, '').trim();
    const nowIso = new Date().toISOString();

    // Upsert pending login request to Supabase users table
    await supabase.from('users').upsert({
      id: `req_${cleanId}`,
      onboarding: {
        login_request_id: cleanId,
        login_request_status: 'PENDING',
        created_at: nowIso
      },
      updated_at: nowIso
    }, { onConflict: 'id' });

    return res.status(200).json({ success: true, requestId });
  } catch (error: any) {
    console.error('Error creating login request in Supabase:', error);
    return res.status(200).json({ success: true, requestId: req.body?.requestId || 'fallback' });
  }
}
