import { safeError } from './_logger.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchLiveBankUzRates } from './_currencyHelper.js';
import { applySecurityHeaders } from './_securityHeaders.js';
import { handleCors } from './_cors.js';
import { applyRateLimit } from './_rateLimiter.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applySecurityHeaders(res);

  // 1. Whitelisted Origin CORS (No wildcard '*')
  const corsHandled = handleCors(req, res, { allowedMethods: 'GET,OPTIONS' });
  if (corsHandled) return;

  // 2. Sliding-Window Rate Limiter (120 req/min for rates)
  if (!(await applyRateLimit(req, res, 'general'))) return;

  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=1800');

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const data = await fetchLiveBankUzRates();
    return res.status(200).json({
      success: true,
      ...data
    });
  } catch (err: any) {
    safeError('Error fetching currency rates:', err);
    res.setHeader('Cache-Control','private, no-store');
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch currency rates'
    });
  }
}
