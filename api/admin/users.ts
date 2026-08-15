import type { VercelRequest, VercelResponse } from '@vercel/node';
import { collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { db } from '../_firebaseClient.js';

const PROJECT_ID = "arctic-pad-sn56p";
const DATABASE_ID = "ai-studio-moliyav2-593a4147-5cc2-4aec-9b0e-422088ddb24a";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // 1. GET: Fetch all users from Firestore
  if (req.method === 'GET') {
    try {
      // Try Firestore Client SDK first
      const snap = await getDocs(collection(db, 'users'));
      const list: any[] = [];
      snap.forEach(d => {
        const id = d.id;
        if (!id.startsWith('moliya_user_sess_') && !id.startsWith('moliya_user_req_')) {
          list.push({ id, ...d.data() });
        }
      });

      if (list.length > 0) {
        return res.status(200).json({ success: true, users: list, source: 'firestore_sdk' });
      }

      // REST API Fallback if SDK returns empty
      const restUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/users?pageSize=300`;
      const restRes = await fetch(restUrl);
      if (restRes.ok) {
        const json: any = await restRes.json();
        const documents = json.documents || [];
        const restList: any[] = [];

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

            restList.push(parsedData);
          }
        }
        return res.status(200).json({ success: true, users: restList, source: 'firestore_rest' });
      }

      return res.status(200).json({ success: true, users: list, source: 'firestore_empty' });
    } catch (e: any) {
      console.error('Error in /api/admin/users GET:', e);
      return res.status(500).json({ error: 'Failed to fetch users', details: e?.message });
    }
  }

  // 2. POST: Update User Premium or Profile
  if (req.method === 'POST') {
    try {
      const { userId, isPremium, phone } = req.body || {};
      if (!userId) return res.status(400).json({ error: 'Missing userId' });

      const userRef = doc(db, 'users', userId);
      const updateData: any = { updatedAt: new Date().toISOString() };
      
      if (typeof isPremium === 'boolean') {
        updateData.isPremium = isPremium;
        updateData['onboarding.isPremium'] = isPremium;
      }
      if (phone) {
        updateData.phone = phone;
        updateData['onboarding.phone'] = phone;
      }

      await setDoc(userRef, updateData, { merge: true });
      return res.status(200).json({ success: true, userId, updated: updateData });
    } catch (e: any) {
      console.error('Error in /api/admin/users POST:', e);
      return res.status(500).json({ error: 'Failed to update user', details: e?.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
