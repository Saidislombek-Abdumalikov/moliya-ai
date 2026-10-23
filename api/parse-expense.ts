import {parseAssistant} from './_assistantParser.js';
import {debtPrincipalText,withDebtDetails} from '../shared/debts.js';
import {audioMime,parseFinancialAudio} from './_audioParser.js';
import {generateBounded,tryNextModel} from './_aiCall.js';
import {transactionParts,TRANSACTION_CLARIFICATION} from '../shared/amountEvidence.js';
import { safeError, safeWarn } from './_logger.js';
import { requireEligibleCaller } from './auth.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from "@google/genai";
import { checkAndRecordAiUsage } from './_aiQuotaHelper.js';
import { loadAiParserGuidance } from './_aiParserGuidance.js';
import { getCandidateAiKeys, recordKeyResult } from './_aiRouter.js';
import {
  normalizeUzbekFinancialText,
  buildUzbekFinancialPrompt,
  parseTurboFinancialText,
  validateAiFinancialOutput
} from './_uzbekFinancialNormalizer.js';
import { applySecurityHeaders } from './_securityHeaders.js';
import { handleCors } from './_cors.js';
import { applyRateLimit, getClientIp } from './_rateLimiter.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applySecurityHeaders(res);

  // 1. Whitelisted Origin CORS (No wildcard '*')
  const corsHandled = handleCors(req, res);
  if (corsHandled) return;

  // 2. Sliding-Window Rate Limiter (30 req/min for AI endpoints)
  if (!(await applyRateLimit(req, res, 'ai_parse'))) return;

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { text, userId, base64Audio } = req.body || {};
    if (req.body?.mode === 'assistant') {
      const caller=await requireEligibleCaller(req,res);if(!caller)return;
      if(userId && userId!==caller.userId)return res.status(403).json({error:'USER_MISMATCH'});
      let audio:Buffer|undefined;
      if(base64Audio!==undefined){
        if(typeof base64Audio!=='string'||base64Audio.length>3*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64Audio))return res.status(400).json({error:'INVALID_AUDIO'});
        audio=Buffer.from(base64Audio,'base64');if(!audioMime(audio))return res.status(400).json({error:'INVALID_AUDIO'});
      }else if(typeof text!=='string'||!text.trim()||text.length>4000)return res.status(400).json({error:'INVALID_TEXT'});
      const quota=await checkAndRecordAiUsage(caller.userId,audio?'voice':'text',audio?'Audio':text,'mini_app');
      if(!quota.allowed)return res.status(quota.statusCode||429).json({error:quota.code,message:quota.message});
      try{return res.status(200).json(await parseAssistant({text,audio,history:req.body.history,language:req.body.language},caller.userDoc));}
      catch{return res.status(503).json({error:'AI_PARSING_UNAVAILABLE'});}
    }
    if (base64Audio !== undefined) {
      const caller=await requireEligibleCaller(req,res);
      if(!caller)return;
      if(userId && userId!==caller.userId)return res.status(403).json({error:'USER_MISMATCH'});
      if(typeof base64Audio!=='string' || base64Audio.length>3*1024*1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64Audio))return res.status(400).json({error:'INVALID_AUDIO'});
      const buffer=Buffer.from(base64Audio,'base64');
      if(!audioMime(buffer))return res.status(400).json({error:'INVALID_AUDIO'});
      const quota=await checkAndRecordAiUsage(caller.userId,'voice','App audio','mini_app');
      if(!quota.allowed)return res.status(quota.statusCode || 429).json({error:quota.code || 'quota_exceeded',message:quota.message});
      try {
        const parsed=await parseFinancialAudio(buffer);
        if(!parsed)return res.status(422).json({error:'AMOUNT_CLARIFICATION_REQUIRED',needs_clarification:true,message:TRANSACTION_CLARIFICATION});
        return res.status(200).json({success:true,...parsed,title:parsed.name,amount:String(parsed.amount)});
      } catch(error:any) {
        return res.status(503).json({error:error?.message==='AI_NOT_CONFIGURED'?'AI_NOT_CONFIGURED':'AI_PARSING_UNAVAILABLE'});
      }
    }
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Missing text' });
    }

    // Input boundary defense: cap text at 1000 characters and trim
    const sourceText=text.slice(0,1000).trim();
    const cleanText = debtPrincipalText(sourceText);
    if (!cleanText) {
      return res.status(400).json({ error: 'Empty text' });
    }

    const caller=await requireEligibleCaller(req,res);
    if(!caller) return;
    const effectiveQuotaUserId=caller.userId;
    if(userId && userId!==caller.userId) return res.status(403).json({error:'USER_MISMATCH'});

    if(!transactionParts(cleanText))return res.status(422).json({success:false,error:'AMOUNT_CLARIFICATION_REQUIRED',needs_clarification:true,message:TRANSACTION_CLARIFICATION});

    // 1. ROCKET FAST TURBO PATH (<1ms): Local Deterministic NLP Engine
    const turboRes = parseTurboFinancialText(cleanText);
    if (turboRes && turboRes.transactions.length > 0 && turboRes.overall_confidence >= 0.85) {
      const tx = turboRes.transactions[0];
      const fmtAmt = Number(tx.amount).toLocaleString('en-US').replace(/,/g, ' ');
      const quota = await checkAndRecordAiUsage(effectiveQuotaUserId, 'text', cleanText, 'mini_app');
      if(!quota.allowed) return res.status(quota.statusCode || 429).json({error:quota.code || 'quota_exceeded',message:quota.message});
      return res.status(200).json({
        success: true,
        ...withDebtDetails({type:tx.type},sourceText),
        type: tx.type || 'expense',
        amount: fmtAmt,
        category: tx.category,
        note: sourceText,
        title: tx.description.slice(0, 80),
        debtWho: tx.counterparty || '',
        currency: tx.currency,
        date: tx.date,
        transactions: turboRes.transactions,
        is_local_turbo: true
      });
    }

    const normalized = normalizeUzbekFinancialText(cleanText);

    const quota = await checkAndRecordAiUsage(effectiveQuotaUserId, 'text', cleanText, 'mini_app');

    if (!quota.allowed) {
      return res.status(quota.statusCode || 429).json({
        success: false,
        error: quota.code || 'quota_exceeded',
        limit: quota.limit,
        usedCount: quota.usedCount,
        message: quota.message || "Bepul AI so'rov limiti tugadi. Davom etish uchun VIP Premium obunasini faollashtiring!"
      });
    }

    const candidateKeys = await getCandidateAiKeys();

    if (candidateKeys.length === 0) {
      return res.status(503).json({ error: 'AI_NOT_CONFIGURED' });
    }

    // Build prompt with normalized financial context
    const prompt = buildUzbekFinancialPrompt(cleanText, undefined, await loadAiParserGuidance());

    // Try each key with fastest active Gemini models first
    const activeModels = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];

    const aiDeadline=Date.now()+25000;
    for (const key of candidateKeys) {
      if (key.provider !== 'google' && (key.provider as string) !== 'gemini') continue;
      
      let primary = String(key.model || '').trim() || 'gemini-2.5-flash';
      if (primary === 'gemini-flash-latest' || /^gemini-3\./i.test(primary)) {
        primary = 'gemini-2.5-flash';
      }
      const keyModels = [...new Set([primary, ...activeModels])];

      for (const modelToUse of keyModels) {
        if(Date.now()>=aiDeadline)break;
        try {
          const ai = new GoogleGenAI({ apiKey: key.api_key.trim() });
          
          const response = await generateBounded(ai,{
            model: modelToUse,
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              maxOutputTokens: 250,
              temperature: 0.1
            }
          },aiDeadline);

          if (response?.text) {
            const parsed = JSON.parse(response.text);
            if (parsed.amount) {
              recordKeyResult(key.id, true).catch(() => {});
              const validated = validateAiFinancialOutput(parsed, normalized);
              if(!validated.isValid)return res.status(422).json({success:false,error:'AMOUNT_CLARIFICATION_REQUIRED',needs_clarification:true,message:TRANSACTION_CLARIFICATION});
              const fmtAmt = Number(validated.amount).toLocaleString('en-US').replace(/,/g, ' ');
              return res.status(200).json({
                success: true,
                ...withDebtDetails({type:validated.type},sourceText),
                type: validated.type || 'expense',
                amount: fmtAmt,
                category: validated.category || 'Boshqa',
                note: sourceText,
                title: validated.name || cleanText,
                debtWho: validated.debtWho || '',
                date: validated.date || new Date().toISOString().slice(0, 10)
              });
            }
          }
        } catch (err: any) {
          safeWarn(`[PARSE] Key ${key.name} model ${modelToUse} failed:`, err?.message);
          recordKeyResult(key.id, false, err?.message, 'temporary').catch(() => {});
          // If timed out or throttled, immediately try next key
          if(!tryNextModel(err))break;
        }
      }
    }

    // An unavailable model cannot turn an amount into a guessed expense.
    return res.status(503).json({ error: 'AI_PARSING_UNAVAILABLE' });
  } catch (e: any) {
    safeError('Error in /api/parse-expense:', e);
    return res.status(500).json({ error: 'AI parsing failed' });
  }
}
