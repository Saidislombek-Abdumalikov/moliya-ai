import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from "@google/genai";
import { checkAndRecordAiUsage } from './_aiQuotaHelper.js';
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

    // 1. Quota Check & Enforcement for Free / VIP users
    const quota = await checkAndRecordAiUsage(
      userId,
      imageBase64 ? 'receipt' : 'text',
      promptText || 'Receipt Scan'
    );

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
- category: string ('Oziq-ovqat', 'Transport', 'Kiyim', 'Kommunal', 'Sog\'liq', 'Ta\'lim', 'Boshqa')
- title: store name or main item (e.g. 'Korzinka', 'Makro', 'Taksi')
- note: summary of purchased items`;

      for (const key of candidateKeys) {
        if (key.provider !== 'google') continue;
        try {
          const ai = new GoogleGenAI({ apiKey: key.api_key });
          const response = await ai.models.generateContent({
            model: key.model || "gemini-2.5-flash",
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
                  used: quota.usedCount,
                  limit: quota.limit,
                  remaining: quota.limit ? Math.max(0, quota.limit - quota.usedCount) : 999999,
                  isPremium: quota.isPremium
                }
              });
            }
          }
        } catch (err: any) {
          console.warn(`[AI_ROUTER_RECEIPT] Key ${key.name} vision parse failed, rotating:`, err?.message);
          await recordKeyResult(key.id, false, err?.message, 'temporary');
        }
      }

      return res.status(503).json({
        error: 'AI_PROVIDERS_UNAVAILABLE',
        message: 'AI xizmati hozirda band. Iltimos, 1 daqiqadan so\'ng qayta urinib ko\'ring.'
      });
    }

    // 3. Text Parsing & Assistant Query with Automatic Key Rotation
    const aiResult = await executeAiWithRotation(promptText);

    if (aiResult.success) {
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
          used: quota.usedCount,
          limit: quota.limit,
          remaining: quota.limit ? Math.max(0, quota.limit - quota.usedCount) : 999999,
          isPremium: quota.isPremium
        }
      });
    } else {
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
