import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchLiveBankUzRates } from './_currencyHelper.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=1800');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const data = await fetchLiveBankUzRates();
    return res.status(200).json({
      success: true,
      ...data
    });
  } catch (err: any) {
    console.error('Error fetching currency rates:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch currency rates',
      details: err?.message
    });
  }
}
