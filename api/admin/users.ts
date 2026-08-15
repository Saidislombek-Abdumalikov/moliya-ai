import type { VercelRequest, VercelResponse } from '@vercel/node';

const PROJECT_ID = "arctic-pad-sn56p";
const DATABASE_ID = "ai-studio-moliyav2-593a4147-5cc2-4aec-9b0e-422088ddb24a";
const REST_BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // 1. GET: Fetch all users from Firestore via REST API
  if (req.method === 'GET') {
    try {
      const restUrl = `${REST_BASE_URL}/users?pageSize=300`;
      const restRes = await fetch(restUrl);
      
      if (!restRes.ok) {
        const errText = await restRes.text();
        console.error('Firestore REST API error:', restRes.status, errText);
        return res.status(200).json({ success: true, users: [], message: 'Firestore empty or restricted' });
      }

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

          if (fields.onboarding?.mapValue?.fields) {
            const obFields = fields.onboarding.mapValue.fields;
            parsedData.onboarding = {
              name: obFields.name?.stringValue || parsedData.name,
              phone: obFields.phone?.stringValue || parsedData.phone,
              telegram: obFields.telegram?.stringValue || parsedData.telegram,
              isPremium: typeof obFields.isPremium?.booleanValue === 'boolean' ? obFields.isPremium.booleanValue : parsedData.isPremium
            };
          }

          userList.push(parsedData);
        }
      }

      return res.status(200).json({ success: true, users: userList, source: 'firestore_rest' });
    } catch (e: any) {
      console.error('Error in /api/admin/users GET:', e);
      return res.status(500).json({ error: 'Failed to fetch users', details: e?.message });
    }
  }

  // 2. POST: Update User Premium Status via Firestore REST Patch
  if (req.method === 'POST') {
    try {
      const { userId, isPremium, phone } = req.body || {};
      if (!userId) return res.status(400).json({ error: 'Missing userId' });

      const patchUrl = `${REST_BASE_URL}/users/${userId}?updateMask.fieldPaths=isPremium&updateMask.fieldPaths=onboarding.isPremium&updateMask.fieldPaths=updatedAt`;
      
      const patchBody = {
        fields: {
          isPremium: { booleanValue: !!isPremium },
          updatedAt: { stringValue: new Date().toISOString() },
          onboarding: {
            mapValue: {
              fields: {
                isPremium: { booleanValue: !!isPremium }
              }
            }
          }
        }
      };

      const patchRes = await fetch(patchUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody)
      });

      if (patchRes.ok) {
        return res.status(200).json({ success: true, userId, isPremium });
      } else {
        const errText = await patchRes.text();
        return res.status(500).json({ error: 'Firestore patch failed', details: errText });
      }
    } catch (e: any) {
      console.error('Error in /api/admin/users POST:', e);
      return res.status(500).json({ error: 'Failed to update user', details: e?.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
