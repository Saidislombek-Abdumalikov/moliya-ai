import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import {
  ADMIN_SECRET_KEY,
  createAdminSessionToken,
  checkAdminRateLimit,
  recordAdminFailedAttempt,
  resetAdminAttempts
} from '../_adminAuthHelper.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const clientIp = ((req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket?.remoteAddress || '127.0.0.1').trim();

  // 1. Rate Limiting Check
  const rateLimit = checkAdminRateLimit(clientIp);
  if (!rateLimit.allowed) {
    return res.status(429).json({
      error: `Too many failed admin login attempts. Please try again in ${rateLimit.retryAfterSec} seconds.`,
      retryAfterSec: rateLimit.retryAfterSec
    });
  }

  try {
    const { secretKey, password, key } = req.body || {};
    const inputSecret = (secretKey || password || key || '').trim();

    if (!ADMIN_SECRET_KEY) {
      console.error('[ADMIN_AUTH] CRITICAL: ADMIN_SECRET_KEY environment variable is not configured.');
      return res.status(500).json({ error: 'Server configuration error: Admin authentication key missing' });
    }

    // Timing-safe comparison to prevent side-channel timing attacks
    const inputBuf = Buffer.from(inputSecret);
    const expectedBuf = Buffer.from(ADMIN_SECRET_KEY);

    const isMatch = inputBuf.length === expectedBuf.length && crypto.timingSafeEqual(inputBuf, expectedBuf);


    if (!isMatch) {
      recordAdminFailedAttempt(clientIp);
      const remaining = rateLimit.remainingAttempts - 1;
      return res.status(401).json({
        error: 'Invalid admin secret key',
        remainingAttempts: Math.max(0, remaining)
      });
    }

    // Success: Reset rate limit tracker and issue cryptographically signed session token
    resetAdminAttempts(clientIp);
    const session = createAdminSessionToken('super_admin');

    return res.status(200).json({
      success: true,
      token: session.token,
      expiresAt: session.expiresAt
    });
  } catch (err: any) {
    console.error('[ADMIN_AUTH] Unexpected error:', err.message);
    return res.status(500).json({ error: 'Internal server error during admin authentication' });
  }
}
