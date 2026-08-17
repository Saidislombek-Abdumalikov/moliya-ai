import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../_supabaseClient.js';

const PROJECT_ID = "arctic-pad-sn56p";
const DATABASE_ID = "ai-studio-moliyav2-593a4147-5cc2-4aec-9b0e-422088ddb24a";
const REST_BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // 1. GET: Fetch all users from Supabase (with Firestore fallback)
  if (req.method === 'GET') {
    try {
      const { data: suUsers, error } = await supabase
        .from('users')
        .select('*')
        .order('updated_at', { ascending: false });

      if (!error && Array.isArray(suUsers) && suUsers.length > 0) {
        const formatted = suUsers.map(u => ({
          id: u.id,
          name: u.name,
          phone: u.phone,
          telegram: u.telegram,
          telegramId: u.telegram_id,
          isPremium: u.is_premium,
          language: u.language,
          aiQueryCount: u.ai_query_count,
          lastAiQueryAt: u.last_ai_query_at,
          onboarding: u.onboarding,
          createdAt: u.created_at,
          updatedAt: u.updated_at
        }));
        return res.status(200).json({ success: true, users: formatted, source: 'supabase' });
      }

      // Fallback to Firestore if Supabase table is empty
      const restUrl = `${REST_BASE_URL}/users?pageSize=300`;
      const restRes = await fetch(restUrl);
      if (restRes.ok) {
        const json: any = await restRes.json();
        const documents = json.documents || [];
        const userList: any[] = [];

        for (const docObj of documents) {
          const nameParts = (docObj.name || '').split('/');
          const docId = nameParts[nameParts.length - 1];

          if (!docId.startsWith('moliya_user_sess_') && !docId.startsWith('moliya_user_req_')) {
            const fields = docObj.fields || {};
            const parsedData: any = { id: docId };

            if (fields.name?.stringValue) parsedData.name = fields.name.stringValue;
            if (fields.phone?.stringValue) parsedData.phone = fields.phone.stringValue;
            if (fields.telegram?.stringValue) parsedData.telegram = fields.telegram.stringValue;
            if (fields.telegramId?.stringValue) parsedData.telegramId = fields.telegramId.stringValue;
            if (typeof fields.isPremium?.booleanValue === 'boolean') parsedData.isPremium = fields.isPremium.booleanValue;
            if (fields.aiQueryCount?.integerValue) parsedData.aiQueryCount = parseInt(fields.aiQueryCount.integerValue);

            userList.push(parsedData);
          }
        }
        return res.status(200).json({ success: true, users: userList, source: 'firestore_fallback' });
      }

      return res.status(200).json({ success: true, users: [] });
    } catch (e: any) {
      console.error('Error in /api/admin/users GET:', e);
      return res.status(500).json({ error: 'Failed to fetch users', details: e?.message });
    }
  }

  // 2. POST: Update User Premium Status in Supabase & Firestore
  if (req.method === 'POST') {
    try {
      const { userId, isPremium, phone } = req.body || {};
      if (!userId) return res.status(400).json({ error: 'Missing userId' });

      const nowIso = new Date().toISOString();

      // Update Supabase
      const { error: suErr } = await supabase
        .from('users')
        .upsert({
          id: userId,
          is_premium: !!isPremium,
          updated_at: nowIso
        }, { onConflict: 'id' });

      // Update Firestore
      const patchUrl = `${REST_BASE_URL}/users/${userId}?updateMask.fieldPaths=isPremium&updateMask.fieldPaths=updatedAt`;
      fetch(patchUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            isPremium: { booleanValue: !!isPremium },
            updatedAt: { stringValue: nowIso }
          }
        })
      }).catch(() => {});

      return res.status(200).json({ success: true, userId, isPremium: !!isPremium });
    } catch (e: any) {
      console.error('Error in /api/admin/users POST:', e);
      return res.status(500).json({ error: 'Failed to update user', details: e?.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
