import type { VercelRequest, VercelResponse } from '@vercel/node';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../_firebaseClient.js';

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

    const sessionSnap = await getDoc(doc(db, 'users', `moliya_user_sess_${sessionToken}`));
    if (!sessionSnap.exists()) {
      return res.status(200).json({ valid: false, reason: 'Session not found' });
    }

    const sessionData = sessionSnap.data();
    if (!sessionData?.expiresAt || new Date(sessionData.expiresAt).getTime() < Date.now()) {
      return res.status(200).json({ valid: false, reason: 'Session expired' });
    }

    const userId = sessionData.userId;
    if (!userId) {
      return res.status(200).json({ valid: false, reason: 'Orphaned session' });
    }

    const userSnap = await getDoc(doc(db, 'users', userId));
    const userData = userSnap.exists() ? userSnap.data() : null;

    return res.status(200).json({
      valid: true,
      userId,
      onboarding: userData?.onboarding || null,
      cards: userData?.cards || [],
      security: userData?.security || null,
    });
  } catch (error: any) {
    console.error('Error validating session:', error);
    return res.status(200).json({ valid: false, error: error.message });
  }
}
