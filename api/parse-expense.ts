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

    // 1. Quota Check & Enforcement for Free and VIP users
    const quota = await checkAndRecordAiUsage(userId, 'text', text);
    if (!quota.allowed) {
      return res.status(429).json({
        success: false,
        error: 'quota_exceeded',
        limit: quota.limit,
        usedCount: quota.usedCount,
        message: quota.message || 'AI so\'rov limiti tugadi. Davom etish uchun VIP Premium obunasini faollashtiring!'
      });
    }

    // 2. Central AI Router Execution with Automatic Key Rotation
    const aiResult = await executeAiWithRotation(text);

    if (aiResult.success) {
      return res.status(200).json({
        success: true,
        type: aiResult.type || 'expense',
        amount: aiResult.amount,
        category: aiResult.category || 'Boshqa',
        note: aiResult.note || text,
        title: aiResult.title || aiResult.note || text,
        debtWho: aiResult.debtWho || '',
        providerUsed: aiResult.providerUsed
      });
    } else {
      console.error('[PARSE_EXPENSE] AI Router error:', aiResult.error);
      return res.status(502).json({ error: aiResult.error || 'AI parsing failed' });
    }
  } catch (e: any) {
    console.error('Error in /api/parse-expense:', e);
    return res.status(500).json({ error: 'AI parsing internal error', details: e?.message });
  }
}
