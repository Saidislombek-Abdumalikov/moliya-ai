import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from "@google/genai";
import { checkAndRecordAiUsage } from './_aiQuotaHelper.js';
import { getCandidateAiKeys, recordKeyResult } from './_aiRouter.js';
import { normalizeUzbekFinancialText, buildUzbekFinancialPrompt } from './_uzbekFinancialNormalizer.js';

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

    const normalized = normalizeUzbekFinancialText(text);

    // Run quota check AND key fetch in PARALLEL for speed
    const [quota, candidateKeys] = await Promise.all([
      checkAndRecordAiUsage(userId, 'text', text),
      getCandidateAiKeys()
    ]);

    if (!quota.allowed) {
      return res.status(429).json({
        success: false,
        error: 'quota_exceeded',
        limit: quota.limit,
        usedCount: quota.usedCount,
        message: quota.message || "Bepul AI so'rov limiti tugadi. Davom etish uchun VIP Premium obunasini faollashtiring!"
      });
    }

    if (candidateKeys.length === 0) {
      return res.status(500).json({ error: 'No active AI keys configured' });
    }

    // Build prompt with normalized financial context
    const prompt = buildUzbekFinancialPrompt(normalized.normalizedText || text);

    // Try each key with active Gemini models
    const activeModels = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest'];

    for (const key of candidateKeys) {
      if (key.provider !== 'google') continue;
      
      const keyModels = [key.model, ...activeModels.filter(m => m !== key.model)].filter(Boolean);

      for (const modelToUse of keyModels) {
        try {
          const ai = new GoogleGenAI({ apiKey: key.api_key.trim() });
          const response = await ai.models.generateContent({
            model: modelToUse,
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

          if (response?.text) {
            const parsed = JSON.parse(response.text);
            if (parsed.amount) {
              recordKeyResult(key.id, true).catch(() => {});
              const fmtAmt = Number(parsed.amount).toLocaleString('en-US').replace(/,/g, ' ');
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
        } catch (err: any) {
          console.warn(`[PARSE] Key ${key.name} model ${modelToUse} failed:`, err?.message);
          recordKeyResult(key.id, false, err?.message, 'temporary').catch(() => {});
          // Try next model or next key
        }
      }
    }

    return res.status(500).json({ error: 'AI parsing failed across all keys' });
  } catch (e: any) {
    console.error('Error in /api/parse-expense:', e);
    return res.status(500).json({ error: 'AI parsing failed', details: e?.message });
  }
}
