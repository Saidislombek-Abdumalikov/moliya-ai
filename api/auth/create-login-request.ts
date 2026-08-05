import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminDb } from '../_firebaseAdmin';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { requestId } = req.body || {};
    if (!requestId || typeof requestId !== 'string' || requestId.length < 8) {
      return res.status(400).json({ error: 'Invalid or missing requestId' });
    }

    const docRef = adminDb.collection('login_requests').doc(requestId);
    await docRef.set({
      requestId,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    return res.status(200).json({ success: true, requestId });
  } catch (error: any) {
    console.error('Error creating login request:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
