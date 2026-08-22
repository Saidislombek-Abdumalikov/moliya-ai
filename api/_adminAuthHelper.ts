import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

export const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || '';

// Token format: v1.<expiresAt>.<base64Payload>.<hmacHexSignature>
export function createAdminSessionToken(adminId: string = 'admin', customSecret?: string): { token: string; expiresAt: number } {
  const secret = customSecret || ADMIN_SECRET_KEY;
  if (!secret) {
    throw new Error('ADMIN_SECRET_KEY environment variable is not configured.');
  }
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  const payload = Buffer.from(JSON.stringify({ sub: adminId, role: 'admin', iat: Date.now() })).toString('base64url');
  const dataToSign = `v1.${expiresAt}.${payload}`;
  const sig = crypto.createHmac('sha256', secret).update(dataToSign).digest('hex');
  return { token: `${dataToSign}.${sig}`, expiresAt };
}

export function verifyAdminSessionToken(tokenOrHeader?: string, customSecret?: string): { valid: boolean; error?: string; adminId?: string } {
  if (!tokenOrHeader || typeof tokenOrHeader !== 'string') {
    return { valid: false, error: 'Missing authorization header or token' };
  }

  const secret = customSecret || ADMIN_SECRET_KEY;
  if (!secret) {
    return { valid: false, error: 'Server configuration error: ADMIN_SECRET_KEY is missing' };
  }

  const token = tokenOrHeader.startsWith('Bearer ') ? tokenOrHeader.slice(7).trim() : tokenOrHeader.trim();
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    return { valid: false, error: 'Invalid admin token format' };
  }

  const [version, expiresAtStr, payloadB64, sig] = parts;
  const expiresAt = parseInt(expiresAtStr, 10);
  if (isNaN(expiresAt) || Date.now() > expiresAt) {
    return { valid: false, error: 'Admin session token has expired' };
  }

  const expectedSig = crypto.createHmac('sha256', secret).update(`v1.${expiresAtStr}.${payloadB64}`).digest('hex');


  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { valid: false, error: 'Invalid admin token signature' };
  }

  try {
    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const parsed = JSON.parse(payloadJson);
    return { valid: true, adminId: parsed.sub || 'admin' };
  } catch (_) {
    return { valid: true, adminId: 'admin' };
  }
}

// In-memory rate limiting against brute force login
const failedAttempts = new Map<string, { count: number; resetAt: number }>();

export function checkAdminRateLimit(ip: string): { allowed: boolean; remainingAttempts: number; retryAfterSec?: number } {
  const now = Date.now();
  const record = failedAttempts.get(ip);
  if (!record || now > record.resetAt) {
    failedAttempts.set(ip, { count: 0, resetAt: now + 15 * 60 * 1000 });
    return { allowed: true, remainingAttempts: 5 };
  }
  if (record.count >= 5) {
    const retryAfterSec = Math.ceil((record.resetAt - now) / 1000);
    return { allowed: false, remainingAttempts: 0, retryAfterSec };
  }
  return { allowed: true, remainingAttempts: 5 - record.count };
}

export function recordAdminFailedAttempt(ip: string) {
  const now = Date.now();
  const record = failedAttempts.get(ip) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  record.count += 1;
  failedAttempts.set(ip, record);
}

export function resetAdminAttempts(ip: string) {
  failedAttempts.delete(ip);
}

/**
 * Express / Vercel middleware helper: Validates Bearer token or returns 401 response.
 */
export function requireAdminAuth(req: VercelRequest, res: VercelResponse): boolean {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,DELETE,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return false;
  }

  const authHeader = (req.headers?.authorization as string) || (req.headers?.Authorization as string) || (req.query?.admin_token as string) || '';
  const result = verifyAdminSessionToken(authHeader);

  if (!result.valid) {
    res.status(401).json({
      error: 'Unauthorized: Admin authentication required',
      details: result.error
    });
    return false;
  }

  return true;
}
