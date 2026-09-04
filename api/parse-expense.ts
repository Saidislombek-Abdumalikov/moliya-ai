import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from "@google/genai";
import { checkAndRecordAiUsage } from './_aiQuotaHelper.js';
import { getCandidateAiKeys, recordKeyResult } from './_aiRouter.js';
import {
  normalizeUzbekFinancialText,
  buildUzbekFinancialPrompt,
  parseTurboFinancialText
} from './_uzbekFinancialNormalizer.js';

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

    // 1. ROCKET FAST TURBO PATH (<1ms): Local Deterministic NLP Engine
    const turboRes = parseTurboFinancialText(text);
    if (turboRes && turboRes.transactions.length > 0 && turboRes.overall_confidence >= 0.85) {
      const tx = turboRes.transactions[0];
      const fmtAmt = Number(tx.amount).toLocaleString('en-US').replace(/,/g, ' ');
      if (userId) {
        checkAndRecordAiUsage(userId, 'text', text).catch(() => {});
      }
      return res.status(200).json({
        success: true,
        type: tx.type || 'expense',
        amount: fmtAmt,
        category: tx.category,
        note: tx.description,
        title: tx.description.slice(0, 80),
        debtWho: tx.counterparty || '',
        currency: tx.currency,
        date: tx.date,
        transactions: turboRes.transactions,
        is_local_turbo: true
      });
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

    // Fallback Fast Path: If amount and category are cleanly inferred locally, return immediately!
    if (normalized.extractedAmount && normalized.extractedAmount > 0 && normalized.inferredCategory) {
      const fmtAmt = Number(normalized.extractedAmount).toLocaleString('en-US').replace(/,/g, ' ');
      return res.status(200).json({
        success: true,
        type: normalized.inferredType || 'expense',
        amount: fmtAmt,
        category: normalized.inferredCategory,
        note: normalized.originalText,
        title: normalized.originalText.slice(0, 80),
        debtWho: '',
        date: new Date().toISOString().slice(0, 10),
        is_local_turbo: true
      });
    }

    if (candidateKeys.length === 0) {
      return res.status(500).json({ error: 'No active AI keys configured' });
    }

    // Build prompt with normalized financial context
    const prompt = buildUzbekFinancialPrompt(normalized.normalizedText || text);

    // Try each key with fastest active Gemini models first
    const activeModels = ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.5-flash'];

    for (const key of candidateKeys) {
      if (key.provider !== 'google' && (key.provider as string) !== 'gemini') continue;
      
      let primary = key.model || 'gemini-3.5-flash-lite';
      if (primary === 'gemini-flash-latest' || primary.includes('2.0-flash') || primary.includes('3.1-flash')) {
        primary = 'gemini-3.5-flash-lite';
      }
      const keyModels = [...new Set([primary, ...activeModels])];

      for (const modelToUse of keyModels) {
        try {
          const ai = new GoogleGenAI({ apiKey: key.api_key.trim() });
          
          // Timeout race: abort after 2800ms to prevent hanging on throttled keys
          let timer: any;
          const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('AI_TIMEOUT')), 2800);
          });

          const generatePromise = ai.models.generateContent({
            model: modelToUse,
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              maxOutputTokens: 250,
              temperature: 0.1
            }
          });

          const response: any = await Promise.race([generatePromise, timeoutPromise]);
          clearTimeout(timer);

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
                date: parsed.date || new Date().toISOString().slice(0, 10)
              });
            }
          }
        } catch (err: any) {
          console.warn(`[PARSE] Key ${key.name} model ${modelToUse} failed:`, err?.message);
          recordKeyResult(key.id, false, err?.message, 'temporary').catch(() => {});
          // If timed out or throttled, immediately try next key
          break;
        }
      }
    }

    // Instant local fallback if AI keys are slow or unavailable
    if (normalized.extractedAmount && normalized.extractedAmount > 0) {
      const fmtAmt = Number(normalized.extractedAmount).toLocaleString('en-US').replace(/,/g, ' ');
      return res.status(200).json({
        success: true,
        type: normalized.inferredType || 'expense',
        amount: fmtAmt,
        category: normalized.inferredCategory || 'Boshqa',
        note: text,
        title: text,
        debtWho: '',
        date: new Date().toISOString().slice(0, 10)
      });
    }

    return res.status(500).json({ error: 'AI parsing failed across all keys' });
  } catch (e: any) {
    console.error('Error in /api/parse-expense:', e);
    return res.status(500).json({ error: 'AI parsing failed', details: e?.message });
  }
}
