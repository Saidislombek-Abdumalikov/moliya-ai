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
        message: quota.message || 'AI chek skanerlash limiti tugadi. VIP Premium obunasini faollashtiring!'
      });
    }

    // 2. Receipt Parsing with Automatic Key Rotation
    const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, '');
    const imageMime = mimeType || 'image/jpeg';
    const candidateKeys = await getCandidateAiKeys();

    const prompt = `Analyze this receipt image (Uzbekistan/Global receipt) and extract:
- type: 'expense'
- amount: total paid number in UZS currency (e.g. 50000, 120000)
- category: string ('Oziq-ovqat', 'Transport', 'Kiyim', 'Kommunal', 'Sog\'liq', 'Ta\'lim', 'Boshqa')
- title: store name or main item (e.g. 'Korzinka', 'Makro', 'Taksi')
- note: summary of purchased items`;

    for (const key of candidateKeys) {
      if (key.provider !== 'google') continue; // Vision API is primarily Google GenAI
      try {
        const ai = new GoogleGenAI({ apiKey: key.api_key });
        const response = await ai.models.generateContent({
          model: key.model || "gemini-2.5-flash",
          contents: [
            {
              inlineData: {
                mimeType: imageMime,
                data: cleanBase64
              }
            },
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

        if (response?.text) {
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
              note: parsed.note || parsed.title || 'Chekdan olindi',
              providerUsed: `${key.provider}:${key.model}`
            });
          }
        }
      } catch (err: any) {
        console.warn(`[RECEIPT_SCAN] Key ${key.name} vision parse failed, rotating:`, err?.message);
        await recordKeyResult(key.id, false, err?.message, 'temporary');
      }
    }

    return res.status(502).json({ error: 'Receipt scanning failed across available vision AI keys' });
  } catch (e: any) {
    console.error('Error in /api/parse-receipt:', e);
    return res.status(500).json({ error: 'Receipt processing error', details: e?.message });
  }
}
