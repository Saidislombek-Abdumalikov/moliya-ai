import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from "@google/genai";
import { checkAndRecordAiUsage } from './_aiQuotaHelper.js';

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

    // 1. Quota Check & Enforcement for Free users
    const quota = await checkAndRecordAiUsage(userId, 'text', text);
    if (!quota.allowed) {
      return res.status(429).json({
        success: false,
        error: 'quota_exceeded',
        limit: quota.limit,
        usedCount: quota.usedCount,
        message: quota.message || 'Bepul AI so\'rov limiti tugadi. Davom etish uchun VIP Premium obunasini faollashtiring!'
      });
    }

    // 2. Gemini AI Parsing Execution
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "";
    if (apiKey) {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Parse this financial transaction text in Uzbek/Russian/English: "${text}".
Return JSON object:
- type: 'expense' | 'income' | 'debt' | 'lending'
- amount: number in UZS (e.g. 25000, 1000000)
- category: string ('Oziq-ovqat', 'Transport', 'Kiyim', 'Kommunal', 'Sog\'liq', 'Ta\'lim', 'Boshqa', 'Maosh', 'Freelance', 'Biznes')
- note: string (clear description)
- title: string (short title)
- debtWho: string (person name if debt or lending, else empty)`;

      let response;
      try {
        response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING },
                amount: { type: Type.NUMBER },
                category: { type: Type.STRING },
                note: { type: Type.STRING },
                title: { type: Type.STRING },
                debtWho: { type: Type.STRING },
              },
              required: ["type", "amount", "category", "note"],
            }
          }
        });
      } catch (err) {
        console.warn('Gemini 2.5 flash parse failed, trying gemini-1.5-flash:', err);
        response = await ai.models.generateContent({
          model: "gemini-1.5-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING },
                amount: { type: Type.NUMBER },
                category: { type: Type.STRING },
                note: { type: Type.STRING },
                title: { type: Type.STRING },
                debtWho: { type: Type.STRING },
              },
              required: ["type", "amount", "category", "note"],
            }
          }
        });
      }

      if (response && response.text) {
        const parsed = JSON.parse(response.text);
        if (parsed.amount) {
          const fmtAmt = parsed.amount.toLocaleString('en-US').replace(/,/g, ' ');
          return res.status(200).json({
            success: true,
            type: parsed.type || 'expense',
            amount: fmtAmt,
            category: parsed.category || 'Boshqa',
            note: parsed.note || text,
            title: parsed.title || parsed.note || text,
            debtWho: parsed.debtWho || '',
          });
        }
      }
    }
  } catch (e) {
    console.error('Error in /api/parse-expense:', e);
  }

  return res.status(500).json({ error: 'AI parsing failed' });
}
