import type { VercelRequest, VercelResponse } from '@vercel/node';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../_firebaseClient.js';

const PROJECT_ID = "arctic-pad-sn56p";
const DATABASE_ID = "ai-studio-moliyav2-593a4147-5cc2-4aec-9b0e-422088ddb24a";
const REST_BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;

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

  // 1. Try Firestore Client SDK first
  try {
    let snap = await getDoc(doc(db, 'users', `moliya_user_req_${cleanId}`));
    if (!snap.exists()) {
      snap = await getDoc(doc(db, 'users', `moliya_user_req_${requestId}`));
    }

    if (snap.exists()) {
      const data = snap.data();
      if (data?.status === 'VERIFIED' && data.userId && data.sessionToken) {
        const userSnap = await getDoc(doc(db, 'users', data.userId));
        const userData = userSnap.exists() ? userSnap.data() : null;

        return res.status(200).json({
          status: 'VERIFIED',
          userId: data.userId,
          sessionToken: data.sessionToken,
          onboarding: userData?.onboarding || null,
          phone: userData?.phone || '',
        });
      }
      return res.status(200).json({ status: data?.status || 'PENDING' });
    }
  } catch (sdkErr) {
    console.warn('[AUTH] Firestore SDK check error, falling back to REST:', sdkErr);
  }

  // 2. Direct Firestore REST API Fallback
  try {
    const restUrl = `${REST_BASE_URL}/users/moliya_user_req_${cleanId}`;
    const restRes = await fetch(restUrl);
    if (restRes.ok) {
      const json: any = await restRes.json();
      const fields = json.fields || {};
      const status = fields.status?.stringValue || 'PENDING';
      const userId = fields.userId?.stringValue;
      const sessionToken = fields.sessionToken?.stringValue;

      if (status === 'VERIFIED' && userId && sessionToken) {
        return res.status(200).json({
          status: 'VERIFIED',
          userId,
          sessionToken,
          phone: fields.phone?.stringValue || '',
          onboarding: { completed: true }
        });
      }
      return res.status(200).json({ status });
    }
  } catch (restErr) {
    console.error('[AUTH] Firestore REST check error:', restErr);
  }

  return res.status(200).json({ status: 'PENDING' });
}
