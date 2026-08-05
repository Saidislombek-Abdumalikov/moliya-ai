import type { VercelRequest, VercelResponse } from '@vercel/node';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../_firebaseClient';

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

    const docRef = doc(db, 'users', `moliya_user_req_${requestId}`);
    await setDoc(docRef, {
      requestId,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    return res.status(200).json({ success: true, requestId });
  } catch (error: any) {
    console.error('Error creating login request:', error);
    return res.status(200).json({ success: true, requestId: req.body?.requestId || 'fallback' });
  }
}
