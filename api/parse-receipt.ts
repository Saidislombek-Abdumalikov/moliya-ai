import {parseReceiptImage} from './_receiptParser.js';
import { safeError } from './_logger.js';
import { requireEligibleCaller } from './auth.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkAndRecordAiUsage } from './_aiQuotaHelper.js';
import { applySecurityHeaders } from './_securityHeaders.js';
import { handleCors } from './_cors.js';
import { applyRateLimit } from './_rateLimiter.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applySecurityHeaders(res);

  // 1. Whitelisted Origin CORS (No wildcard '*')
  const corsHandled = handleCors(req, res);
  if (corsHandled) return;

  // 2. Sliding-Window Rate Limiter (30 req/min for AI endpoints)
  if (!(await applyRateLimit(req, res, 'ai_parse'))) return;

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { base64Image, mimeType, userId } = req.body || {};
    if (!base64Image || typeof base64Image !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid base64Image' });
    }

    // Stay below Vercel request payload limit, including JSON overhead.
    if (base64Image.length > 3 * 1024 * 1024) {
      return res.status(413).json({ error: 'Image payload too large (max 2MB)' });
    }

    const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/jpg'];
    const imageMime = (mimeType || 'image/jpeg').toLowerCase();
    if (!ALLOWED_IMAGE_MIMES.includes(imageMime)) {
      return res.status(400).json({ error: 'Unsupported image mime type' });
    }

    const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, '');
    const imgBuffer = Buffer.from(cleanBase64, 'base64');
    if (imgBuffer.length < 16) {
      return res.status(400).json({ error: 'Corrupted or empty image buffer' });
    }

    // Magic bytes verification
    const isJpeg = imgBuffer.length >= 3 && imgBuffer[0] === 0xFF && imgBuffer[1] === 0xD8 && imgBuffer[2] === 0xFF;
    const isPng = imgBuffer.length >= 8 && imgBuffer[0] === 0x89 && imgBuffer.slice(1, 4).toString('ascii') === 'PNG';
    const isWebp = imgBuffer.length >= 12 && imgBuffer.slice(0, 4).toString('ascii') === 'RIFF' && imgBuffer.slice(8, 12).toString('ascii') === 'WEBP';
    const isHeic = imgBuffer.length >= 12 && imgBuffer.slice(4, 8).toString('ascii') === 'ftyp';

    if (!isJpeg && !isPng && !isWebp && !isHeic) {
      return res.status(400).json({ error: 'Invalid image file signature' });
    }

    const caller=await requireEligibleCaller(req,res);
    if(!caller) return;
    const effectiveQuotaUserId=caller.userId;
    if(userId && userId!==caller.userId) return res.status(403).json({error:'USER_MISMATCH'});

    // 1. Quota Check & Enforcement
    const quota = await checkAndRecordAiUsage(effectiveQuotaUserId, 'receipt', 'Receipt OCR Scan', 'mini_app');
    if (!quota.allowed) {
      return res.status(quota.statusCode || 429).json({
        success: false,
        error: quota.code || 'quota_exceeded',
        limit: quota.limit,
        usedCount: quota.usedCount,
        message: quota.message || "Bepul AI chek skanerlash limiti tugadi. VIP Premium obunasini faollashtiring!"
      });
    }

    try {
      const parsed=await parseReceiptImage(cleanBase64,imageMime==='image/jpg'?'image/jpeg':imageMime);
      if(!parsed)return res.status(422).json({error:'RECEIPT_UNCLEAR',needs_clarification:true});
      return res.status(200).json({success:true,...parsed,amount:String(parsed.amount)});
    } catch(error:any) {
      return res.status(503).json({error:error?.message==='AI_NOT_CONFIGURED'?'AI_NOT_CONFIGURED':'AI_PARSING_UNAVAILABLE'});
    }

  } catch (e: any) {
    safeError('Error in /api/parse-receipt:', e);
    return res.status(500).json({ error: 'AI receipt parsing failed' });
  }
}
