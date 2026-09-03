import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from "@google/genai";
import { checkAndRecordAiUsage } from './_aiQuotaHelper.js';
import { getCandidateAiKeys, recordKeyResult } from './_aiRouter.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { base64Image, mimeType, userId } = req.body || {};
    if (!base64Image) {
      return res.status(400).json({ error: 'Missing base64Image' });
    }

    // 1. Quota Check & Enforcement
    const quota = await checkAndRecordAiUsage(userId, 'receipt', 'Receipt OCR Scan');
    if (!quota.allowed) {
      return res.status(429).json({
        success: false,
        error: 'quota_exceeded',
        limit: quota.limit,
        usedCount: quota.usedCount,
        message: quota.message || "Bepul AI chek skanerlash limiti tugadi. VIP Premium obunasini faollashtiring!"
      });
    }

    // 2. Get AI keys from database with rotation
    const candidateKeys = await getCandidateAiKeys();
    const googleKeys = candidateKeys.filter(k => k.provider === 'google' && k.api_key);

    if (googleKeys.length === 0) {
      return res.status(500).json({ error: 'No active Google AI keys configured for receipt scanning' });
    }

    const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, '');
    const imageMime = mimeType || 'image/jpeg';

    const prompt = `Analyze this receipt image (Uzbekistan/Global receipt) and extract:
- type: 'expense'
- amount: total paid number in UZS currency (e.g. 50000, 120000)
- category: string ('Oziq-ovqat', 'Transport', 'Kiyim', 'Kommunal', 'Sog\\'liq', 'Ta\\'lim', 'Boshqa')
- title: store name or main item (e.g. 'Korzinka', 'Makro', 'Taksi')
- note: summary of purchased items`;

    const visionModels = ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.5-flash'];

    // Try each key with model fallback
    for (const key of googleKeys) {
      let primary = key.model || 'gemini-3.5-flash-lite';
      if (primary === 'gemini-flash-latest' || primary.includes('2.0-flash') || primary.includes('3.1-flash')) {
        primary = 'gemini-3.5-flash-lite';
      }
      const modelsToTry = [...new Set([primary, ...visionModels])];
      for (const modelName of modelsToTry) {
        try {
          const ai = new GoogleGenAI({ apiKey: key.api_key.trim() });
          const response = await ai.models.generateContent({
            model: modelName,
            contents: [
              { inlineData: { mimeType: imageMime, data: cleanBase64 } },
              prompt
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

          if (response && response.text) {
            const parsed = JSON.parse(response.text);
            if (parsed.amount) {
              await recordKeyResult(key.id, true);
              const fmtAmt = parsed.amount.toLocaleString('en-US').replace(/,/g, ' ');
              return res.status(200).json({
                success: true,
                type: parsed.type || 'expense',
                amount: fmtAmt,
                category: parsed.category || 'Oziq-ovqat',
                title: parsed.title || 'Chek xarajati',
                note: parsed.note || parsed.title || 'Chek rasmi tahlil qilindi',
              });
            }
          }
        } catch (err: any) {
          console.warn(`[RECEIPT] Key ${key.name} model ${modelName} failed:`, err?.message);
          await recordKeyResult(key.id, false, err?.message, 'temporary');
          // Try next model/key
        }
      }
    }

    return res.status(500).json({ error: 'AI receipt parsing failed across all keys' });
  } catch (e: any) {
    console.error('Error in /api/parse-receipt:', e);
    return res.status(500).json({ error: 'AI receipt parsing failed', details: e?.message });
  }
}
