import type { VercelRequest, VercelResponse } from '@vercel/node';
import { collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { db } from '../_firebaseClient.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // 1. GET: Fetch all users
  if (req.method === 'GET') {
    try {
      const snap = await getDocs(collection(db, 'users'));
      const list: any[] = [];
      snap.forEach(d => {
        const id = d.id;
        if (!id.startsWith('moliya_user_sess_') && !id.startsWith('moliya_user_req_')) {
          list.push({ id, ...d.data() });
        }
      });
      return res.status(200).json({ success: true, users: list });
    } catch (e: any) {
      console.error('Error in /api/admin/users GET:', e);
      return res.status(500).json({ error: 'Failed to fetch users' });
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
      return res.status(500).json({ error: 'Failed to update user' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
