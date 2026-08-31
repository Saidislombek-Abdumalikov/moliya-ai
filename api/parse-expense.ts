import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkAndRecordAiUsage } from './_aiQuotaHelper.js';
import { executeAiWithRotation } from './_aiRouter.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { text, userId } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Missing text' });
    }

    // 1. Quota Check & Enforcement
    const quota = await checkAndRecordAiUsage(userId, 'text', text);
    if (!quota.allowed) {
      return res.status(429).json({
        success: false,
        error: 'quota_exceeded',
        limit: quota.limit,
        usedCount: quota.usedCount,
        message: quota.message || "Bepul AI so'rov limiti tugadi. Davom etish uchun VIP Premium obunasini faollashtiring!"
      });
    }

    // 2. Execute AI with key rotation from database
    const result = await executeAiWithRotation(text);

    if (result.success && result.amount) {
      return res.status(200).json({
        success: true,
        type: result.type || 'expense',
        amount: result.amount,
        category: result.category || 'Boshqa',
        note: result.note || text,
        title: result.title || result.note || text,
        debtWho: result.debtWho || '',
        providerUsed: result.providerUsed,
        keyNameUsed: result.keyNameUsed,
      });
    }

    // AI router returned no valid result
    return res.status(500).json({
      error: 'AI parsing failed',
      details: result.error || 'No valid response from any AI provider'
    });
  } catch (e: any) {
    console.error('Error in /api/parse-expense:', e);
    return res.status(500).json({ error: 'AI parsing failed', details: e?.message });
  }
}
