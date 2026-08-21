import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from "@google/genai";
import { checkAiQuota, recordAiUsage } from './_aiQuotaHelper.js';
import { executeAiWithRotation, getCandidateAiKeys, recordKeyResult } from './_aiRouter.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { userId, prompt, text, queryType = 'text', imageBase64 } = req.body || {};
    const promptText = prompt || text || '';

    if (!promptText && !imageBase64) {
      return res.status(400).json({ error: 'Missing prompt or imageBase64' });
    }

    // 1. Quota Check ONLY (no increment yet)
    const quota = await checkAiQuota(userId);

    if (!quota.allowed) {
      return res.status(403).json({
        success: false,
        error: 'AI_LIMIT_REACHED',
        message: quota.message || 'AI Limitingiz tugadi. Davom etish uchun VIP Premium obunasini faollashtiring!',
        usage: {
          used: quota.usedCount,
          limit: quota.limit,
          remaining: 0,
          isPremium: quota.isPremium
        }
      });
    }

    // 2. Receipt OCR Scan with Automatic Key Rotation
    if (imageBase64 || queryType === 'receipt') {
      const cleanBase64 = String(imageBase64).replace(/^data:image\/\w+;base64,/, '');
      const candidateKeys = await getCandidateAiKeys();
      const receiptPrompt = `Analyze this receipt image (Uzbekistan/Global receipt) and extract:
- type: 'expense'
- amount: total paid number in UZS currency (e.g. 50000, 120000)
- category: string ('Oziq-ovqat', 'Transport', 'Kiyim', 'Kommunal', 'Sog\\'liq', 'Ta\\'lim', 'Boshqa')
- title: store name or main item (e.g. 'Korzinka', 'Makro', 'Taksi')
- note: summary of purchased items`;

      for (const key of candidateKeys) {
        if (key.provider !== 'google') continue;
        try {
          const cleanKey = (key.api_key || '').trim();
          const candidateModels = [
            (key.model || 'gemini-3.7-flash').trim(),
            'gemini-3.7-flash',
            'gemini-flash-latest',
            'gemini-2.0-flash',
            'gemini-1.5-flash'
          ];
          const uniqueModels = [...new Set(candidateModels)];

          for (const modelName of uniqueModels) {
            try {
              const ai = new GoogleGenAI({ apiKey: cleanKey });
              const response = await ai.models.generateContent({
                model: modelName,
                contents: [
                  {
                    inlineData: {
                      mimeType: 'image/jpeg',
                      data: cleanBase64
                    }
                  },
                  receiptPrompt
                ],
                config: {
                  responseMimeType: "application/json",
                  responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                      type: { type: Type.STRING },
                      amount: { type: Type.NUMBER },
                      category: { type: Type.STRING },
                      title: { type: Type.STRING },
                      note: { type: Type.STRING },
                    },
                    required: ["type", "amount", "category", "title"],
                  }
                }
              });

              if (response?.text) {
                const parsed = JSON.parse(response.text);
                if (parsed.amount) {
                  await recordKeyResult(key.id, true);
                  // Record usage ONLY on success
                  const usageResult = await recordAiUsage(userId, 'receipt', 'Receipt scan', quota.isPremium);
                  const newUsed = usageResult.newCount || (quota.usedCount + 1);
                  const fmtAmt = parsed.amount.toLocaleString('en-US').replace(/,/g, ' ');
                  return res.status(200).json({
                    success: true,
                    response: `Chek muvaffaqiyatli tahlil qilindi: ${fmtAmt} so'm (${parsed.category || 'Oziq-ovqat'})`,
                    parsed: {
                      type: parsed.type || 'expense',
                      amount: fmtAmt,
                      category: parsed.category || 'Oziq-ovqat',
                      title: parsed.title || 'Chek xarajati',
                      note: parsed.note || parsed.title || 'Chekdan olindi',
                    },
                    usage: {
                      used: newUsed,
                      limit: quota.limit,
                      remaining: quota.limit ? Math.max(0, quota.limit - newUsed) : 999999,
                      isPremium: quota.isPremium
                    }
                  });
                }
              }
            } catch (innerErr: any) {
              if (innerErr?.message?.includes('429') || innerErr?.message?.includes('API_KEY_INVALID')) break;
            }
          }
        } catch (err: any) {
          console.warn(`[AI_ROUTER_RECEIPT] Key ${key.name} vision parse failed, rotating:`, err?.message);
          await recordKeyResult(key.id, false, err?.message, 'temporary');
        }
      }

      // All keys failed — DO NOT charge the user
      return res.status(503).json({
        error: 'AI_PROVIDERS_UNAVAILABLE',
        message: 'AI xizmati hozirda band. Iltimos, 1 daqiqadan so\'ng qayta urinib ko\'ring.'
      });
    }

    // 3. Text Parsing & Assistant Query with Automatic Key Rotation
    const aiResult = await executeAiWithRotation(promptText);

    if (aiResult.success) {
      // Record usage ONLY on success
      const usageResult = await recordAiUsage(userId, 'text', promptText, quota.isPremium);
      const newUsed = usageResult.newCount || (quota.usedCount + 1);

      return res.status(200).json({
        success: true,
        response: `Tranzaksiya aniqlandi: ${aiResult.amount} so'm (${aiResult.category})`,
        parsed: {
          type: aiResult.type || 'expense',
          amount: aiResult.amount,
          category: aiResult.category || 'Boshqa',
          note: aiResult.note || promptText,
          title: aiResult.title || aiResult.note || promptText,
          debtWho: aiResult.debtWho || '',
        },
        usage: {
          used: newUsed,
          limit: quota.limit,
          remaining: quota.limit ? Math.max(0, quota.limit - newUsed) : 999999,
          isPremium: quota.isPremium
        }
      });
    } else {
      // All keys failed — DO NOT charge the user
      console.warn('[AI_ROUTER] All keys failed:', aiResult.error);
      return res.status(503).json({
        error: 'AI_PROVIDERS_UNAVAILABLE',
        message: 'AI xizmati hozirda band. Iltimos, 1 daqiqadan so\'ng qayta urinib ko\'ring.'
      });
    }
  } catch (e: any) {
    console.error('Error in /api/ai-router:', e);
    return res.status(500).json({ error: 'AI request failed', details: e?.message });
  }
}
