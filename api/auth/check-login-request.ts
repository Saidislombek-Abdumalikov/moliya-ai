import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminDb } from '../_firebaseAdmin';

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

  try {
    const snap = await adminDb.collection('login_requests').doc(requestId).get();
    if (!snap.exists) {
      return res.status(200).json({ status: 'NOT_FOUND' });
    }

    const data = snap.data();
    if (data?.status === 'VERIFIED' && data.userId && data.sessionToken) {
      // Fetch full user document
      const userSnap = await adminDb.collection('users').doc(data.userId).get();
      const userData = userSnap.exists ? userSnap.data() : null;

      return res.status(200).json({
        status: 'VERIFIED',
        userId: data.userId,
        sessionToken: data.sessionToken,
        onboarding: userData?.onboarding || null,
        phone: userData?.phone || '',
      });
    }

    return res.status(200).json({ status: data?.status || 'PENDING' });
  } catch (error: any) {
    console.error('Error checking login request:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
