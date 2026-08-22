import { GoogleGenAI, Type, Schema } from "@google/genai";
import express from "express";
import path from "path";

import { createClient } from '@supabase/supabase-js';
import crypto from "crypto";
import { executeAiWithRotation, getCandidateAiKeys, maskApiKey, testSpecificAiKey, recordKeyResult, AiKeyRecord } from './api/_aiRouter.js';
import { checkAiQuota, recordAiUsage as recordAiUsageBackend, checkAndRecordAiUsage } from './api/_aiQuotaHelper.js';
import { requireAdminAuth } from './api/_adminAuthHelper.js';
import adminAuthHandler from './api/admin/auth.js';
import { getUserCardsRelational, getUserTransactionsRelational } from './api/_relationalReader.js';


// Supabase client for local dev server (replaces Firebase)
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qjumnjzbgjldbwwluggr.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function verifyTelegramInitData(initData: string, botToken: string): { isValid: boolean; user?: any } {
  if (!botToken || !initData) {
    return { isValid: false };
  }
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return { isValid: false };

    // Delete hash for checking
    params.delete("hash");

    // Sort keys alphabetically
    const keys = Array.from(params.keys()).sort();
    const dataCheckString = keys
      .map((key) => `${key}=${params.get(key)}`)
      .join("\n");

    // Compute secret key derived from bot token with "WebAppData" salt
    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(botToken)
      .digest();

    // Compute signature hash
    const computedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    const isValid = computedHash === hash;
    let user = null;
    if (isValid) {
      const userJson = params.get("user");
      if (userJson) {
        user = JSON.parse(userJson);
      }
    }
    return { isValid, user };
  } catch (e) {
    console.error("Error verifying Telegram initData:", e);
    return { isValid: false };
  }
}



async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API routes FIRST

  // 1. Create Login Request UUID
  app.post("/api/auth/create-login-request", async (req, res) => {
    try {
      const { requestId } = req.body || {};
      if (!requestId || typeof requestId !== 'string' || requestId.length < 8) {
        res.status(400).json({ error: "Invalid or missing requestId" });
        return;
      }
      const cleanId = requestId.replace(/^req_/, '').trim();
      const nowIso = new Date().toISOString();

      await supabase.from('users').upsert({
        id: `req_${cleanId}`,
        onboarding: {
          login_request_id: cleanId,
          login_request_status: 'PENDING',
          created_at: nowIso
        },
        updated_at: nowIso
      }, { onConflict: 'id' });

      res.json({ success: true, requestId });
    } catch (e: any) {
      console.error("Create login request error:", e);
      res.status(200).json({ success: true, requestId: req.body?.requestId || 'fallback' });
    }
  });

  // 2. Check Login Request Verification status
  app.get("/api/auth/check-login-request", async (req, res) => {
    try {
      const requestId = (req.query.requestId as string) || (req.body && req.body.requestId);
      if (!requestId || typeof requestId !== 'string') {
        res.status(400).json({ error: "Missing requestId parameter" });
        return;
      }
      const cleanId = requestId.replace(/^req_/, '').trim();
      const { data: reqDoc, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', `req_${cleanId}`)
        .maybeSingle();

      if (!error && reqDoc) {
        const status = reqDoc.onboarding?.login_request_status || reqDoc.login_request_status;
        const tgId = reqDoc.telegram_id || reqDoc.onboarding?.telegram_id;
        const sessionToken = reqDoc.onboarding?.session_token || reqDoc.session_token;

        if (status === 'VERIFIED' && tgId && sessionToken) {
          const userId = `moliya_user_tg_${tgId}`;
          const { data: userDoc } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
          const [userCards, userTransactions] = await Promise.all([
            getUserCardsRelational(userId),
            getUserTransactionsRelational(userId)
          ]);

          res.json({
            status: "VERIFIED",
            userId,
            sessionToken,
            onboarding: userDoc?.onboarding || null,
            phone: userDoc?.phone || "",
            cards: userCards,
            transactions: userTransactions
          });
          return;
        }
        res.json({ status: status || "PENDING" });
        return;
      }
      res.json({ status: "PENDING" });
    } catch (e: any) {
      console.error("Check login request error:", e);
      res.status(200).json({ status: "PENDING" });
    }
  });

  // 3. Validate Session Token
  app.post("/api/auth/validate-session", async (req, res) => {
    try {
      const { sessionToken } = req.body || {};
      if (!sessionToken || typeof sessionToken !== 'string') {
        res.json({ valid: false, reason: "Missing sessionToken" });
        return;
      }
      const { data: userDoc, error } = await supabase
        .from('users')
        .select('*')
        .eq('onboarding->>session_token', sessionToken)
        .maybeSingle();

      if (!error && userDoc) {
        const expiresAt = userDoc.onboarding?.session_expires_at || userDoc.onboarding?.expires_at;
        if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
          res.json({ valid: false, reason: "Session expired" });
          return;
        }
        const [userCards, userTransactions] = await Promise.all([
          getUserCardsRelational(userDoc.id),
          getUserTransactionsRelational(userDoc.id)
        ]);

        res.json({
          valid: true,
          userId: userDoc.id,
          onboarding: userDoc.onboarding || null,
          cards: userCards,
          transactions: userTransactions,
          isPremium: userDoc.is_premium || false
        });
        return;
      }
      res.json({ valid: false, reason: "Session not found" });
    } catch (e: any) {
      console.error("Validate session error:", e);
      res.status(200).json({ valid: false, error: e.message });
    }
  });

  // Telegram verification endpoint
  app.post("/api/auth/telegram", async (req, res) => {
    try {
      const { initData, initDataUnsafe } = req.body || {};
      const botToken = process.env.TELEGRAM_BOT_TOKEN || "";

      let tgUser: any = null;
      if (initData && botToken) {
        const verification = verifyTelegramInitData(initData, botToken);
        if (verification.isValid && verification.user) {
          tgUser = verification.user;
        }
      }
      if (!tgUser && initDataUnsafe?.user) {
        tgUser = initDataUnsafe.user;
      }

      if (!tgUser || !tgUser.id) {
        res.status(401).json({ error: "Invalid Telegram signature" });
        return;
      }

      const tgId = String(tgUser.id);
      const userId = `moliya_user_tg_${tgId}`;
      const sessionToken = "sess_" + crypto.randomBytes(32).toString("hex");
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 60 * 24 * 3600 * 1000).toISOString();

      const tgName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") || "Telegram Foydalanuvchi";
      const tgUsername = tgUser.username ? "@" + tgUser.username : "@moliya_user";

      const { data: existingUser } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      const updatedOnboarding = {
        ...(existingUser?.onboarding || {}),
        completed: true,
        language: existingUser?.language || tgUser.language_code || "uz",
        name: tgName,
        phone: existingUser?.phone || '',
        telegram: tgUsername,
        telegramId: tgId,
      };

      const onboardingPayload = {
        ...updatedOnboarding,
        session_token: sessionToken,
        session_expires_at: expiresAt,
      };

      await supabase.from('users').upsert({
        id: userId,
        name: tgName,
        telegram: tgUsername,
        telegram_id: tgId,
        phone: existingUser?.phone || null,
        language: updatedOnboarding.language,
        is_premium: existingUser?.is_premium || false,
        onboarding: onboardingPayload,
        updated_at: now.toISOString()
      }, { onConflict: 'id' });

      const [userCards, userTransactions] = await Promise.all([
        getUserCardsRelational(userId),
        getUserTransactionsRelational(userId)
      ]);

      res.json({
        userId,
        sessionToken,
        onboarding: updatedOnboarding,
        cards: userCards,
        transactions: userTransactions,
        isPremium: existingUser?.is_premium || false
      });
    } catch (e: any) {
      console.error("Telegram authentication error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // Standalone Android APK OTP Verification
  app.post("/api/auth/verify-code", async (req, res) => {
    try {
      const { code } = req.body || {};
      if (!code || typeof code !== 'string') {
        res.status(400).json({ success: false, errorType: 'INVALID_CODE', error: "Kiritilgan kod noto'g'ri. Qayta urinib ko'ring." });
        return;
      }

      const cleanCode = code.trim().replace(/\D/g, '');
      if (cleanCode.length !== 6) {
        res.status(400).json({ success: false, errorType: 'INVALID_CODE', error: "Kod 6 ta raqamdan iborat bo'lishi kerak." });
        return;
      }

      const otpId = `otp_${cleanCode}`;
      const { data: otpDoc, error: lookupError } = await supabase
        .from('users')
        .select('*')
        .eq('id', otpId)
        .maybeSingle();

      if (lookupError || !otpDoc) {
        res.status(400).json({ success: false, errorType: 'INVALID_CODE', error: "Kiritilgan kod noto'g'ri yoki eskirgan. Qayta urinib ko'ring." });
        return;
      }

      const expiresAtStr = otpDoc.onboarding?.expires_at || otpDoc.session_expires_at;
      if (expiresAtStr && new Date(expiresAtStr).getTime() < Date.now()) {
        await supabase.from('users').delete().eq('id', otpId);
        res.status(400).json({ success: false, errorType: 'EXPIRED_CODE', error: "Kod muddati tugagan. Yangi kod oling." });
        return;
      }

      const tgId = String(otpDoc.telegram_id || otpDoc.onboarding?.telegram_id || '');
      if (!tgId) {
        await supabase.from('users').delete().eq('id', otpId);
        res.status(400).json({ success: false, errorType: 'INVALID_CODE', error: "Kod ma'lumotlarida xatolik yuz berdi. Yangi kod oling." });
        return;
      }

      await supabase.from('users').delete().eq('id', otpId);

      const userId = `moliya_user_tg_${tgId}`;
      const { data: existingUser } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      const now = new Date();
      const expiresAt = new Date(now.getTime() + 60 * 24 * 3600 * 1000).toISOString();
      const randomHex = crypto.randomBytes(16).toString('hex');
      const sessionToken = existingUser?.onboarding?.session_token || ('sess_' + randomHex);

      const tgName = otpDoc.name || existingUser?.name || 'Telegram Foydalanuvchi';
      const tgUsername = otpDoc.telegram || existingUser?.telegram || '@moliya_user';
      const userPhone = otpDoc.phone || existingUser?.phone || existingUser?.onboarding?.phone || '';

      let updatedOnboarding: any;
      let userCards: any[] = [];
      let userTransactions: any[] = [];
      let isPremium = false;
      let isNewUser = false;
      let onboardingCompleted = false;

      if (existingUser) {
        onboardingCompleted = Boolean(existingUser.onboarding?.completed || (existingUser.created_at && existingUser.onboarding));
        updatedOnboarding = {
          ...(existingUser.onboarding || {}),
          name: tgName,
          phone: userPhone || existingUser.phone || '',
          telegram: tgUsername,
          telegramId: tgId,
          language: existingUser.language || existingUser.onboarding?.language || 'uz',
          completed: onboardingCompleted,
          session_token: sessionToken,
          session_expires_at: expiresAt,
        };
        userCards = Array.isArray(existingUser.cards) ? existingUser.cards : [];
        userTransactions = Array.isArray(existingUser.transactions) ? existingUser.transactions : [];
        isPremium = Boolean(existingUser.is_premium);
        isNewUser = false;

        await supabase.from('users').update({
          name: tgName,
          telegram: tgUsername,
          telegram_id: tgId,
          phone: userPhone || existingUser.phone || null,
          onboarding: updatedOnboarding,
          updated_at: now.toISOString()
        }).eq('id', userId);
      } else {
        isNewUser = true;
        onboardingCompleted = false;
        updatedOnboarding = {
          completed: false,
          language: 'uz',
          name: tgName,
          phone: userPhone,
          telegram: tgUsername,
          telegramId: tgId,
          monthlyGoal: 1000000,
          monthlyIncome: 0,
          isPremium: false,
          budgets: {},
          session_token: sessionToken,
          session_expires_at: expiresAt,
        };

        await supabase.from('users').insert({
          id: userId,
          name: tgName,
          telegram: tgUsername,
          telegram_id: tgId,
          phone: userPhone || null,
          language: 'uz',
          is_premium: false,
          onboarding: updatedOnboarding,
          cards: [],
          transactions: [],
          created_at: now.toISOString(),
          updated_at: now.toISOString()
        });
      }

      const authSession = await createSupabaseAuthSession(tgId, { name: tgName, telegram: tgUsername });

      const [relCards, relTransactions] = await Promise.all([
        getUserCardsRelational(userId),
        getUserTransactionsRelational(userId)
      ]);

      res.status(200).json({
        success: true,
        userId,
        sessionToken,
        access_token: authSession?.access_token || null,
        refresh_token: authSession?.refresh_token || null,
        isNewUser,
        onboardingCompleted,
        onboarding: updatedOnboarding,
        cards: relCards,
        transactions: relTransactions,
        isPremium,
      });
    } catch (e: any) {
      console.error("Verify code error in server:", e);
      res.status(500).json({ success: false, errorType: 'SERVER_ERROR', error: "Serverda vaqtinchalik xatolik yuz berdi. Iltimos, qayta urinib ko'ring." });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // CENTRAL AI ROUTER ENDPOINT (Web App & APK)
  // ─────────────────────────────────────────────────────────────
  app.post("/api/ai-router", async (req, res) => {
    try {
      const { userId, prompt, text, queryType = 'text', imageBase64 } = req.body || {};
      const promptText = prompt || text || '';

      if (!promptText && !imageBase64) {
        res.status(400).json({ error: 'Missing prompt or imageBase64' });
        return;
      }

      // 1. Quota Check ONLY (no increment yet)
      const quota = await checkAiQuota(userId);

      if (!quota.allowed) {
        res.status(403).json({
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
        return;
      }

      // 2. Receipt OCR Scan
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
                // Record usage ONLY on success
                const usageResult = await recordAiUsageBackend(userId, 'receipt', 'Receipt scan', quota.isPremium);
                const newUsed = usageResult.newCount || (quota.usedCount + 1);
                const fmtAmt = parsed.amount.toLocaleString('en-US').replace(/,/g, ' ');
                res.json({
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
                return;
              }
            }
          } catch (err: any) {
            console.warn(`[SERVER_AI_ROUTER] Key ${key.name} receipt failed:`, err?.message);
            await recordKeyResult(key.id, false, err?.message, 'temporary');
          }
        }

        res.status(503).json({
          error: 'AI_PROVIDERS_UNAVAILABLE',
          message: 'AI xizmati hozirda band. Iltimos, 1 daqiqadan so\'ng qayta urinib ko\'ring.'
        });
        return;
      }

      // 3. Text Prompt Parsing
      const aiResult = await executeAiWithRotation(promptText);

      if (aiResult.success) {
        // Record usage ONLY on success
        const usageResult = await recordAiUsageBackend(userId, 'text', promptText, quota.isPremium);
        const newUsed = usageResult.newCount || (quota.usedCount + 1);
        res.json({
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
        res.status(503).json({
          error: 'AI_PROVIDERS_UNAVAILABLE',
          message: 'AI xizmati hozirda band. Iltimos, 1 daqiqadan so\'ng qayta urinib ko\'ring.'
        });
      }
    } catch (err: any) {
      console.error('[SERVER_AI_ROUTER] Error:', err);
      res.status(500).json({ error: 'Internal server error in AI Router' });
    }
  });

  app.post("/api/parse-expense", async (req, res) => {
    try {
      const { text, userId } = req.body || {};
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        res.status(400).json({ error: "Missing or invalid 'text' parameter" });
        return;
      }

      // 1. Quota Check & Enforcement
      const quota = await checkAndRecordAiUsage(userId, 'text', text);
      if (!quota.allowed) {
        res.status(429).json({
          success: false,
          error: 'quota_exceeded',
          limit: quota.limit,
          usedCount: quota.usedCount,
          message: quota.message || 'AI so\'rov limiti tugadi. Davom etish uchun VIP Premium obunasini faollashtiring!'
        });
        return;
      }

      const cleanText = text.replace(/[\r\n\t]/g, ' ').slice(0, 500);
      const aiResult = await executeAiWithRotation(cleanText);

      if (aiResult.success) {
        res.json({
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
        console.error('[SERVER_PARSE_EXPENSE] AI Router error:', aiResult.error);
        res.status(502).json({ error: aiResult.error || 'AI parsing failed' });
      }
    } catch (e: any) {
      console.error('Parse expense error in server:', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/parse-receipt", async (req, res) => {
    try {
      const { base64Image, mimeType, userId } = req.body || {};
      if (!base64Image) {
        res.status(400).json({ error: "Missing image data" });
        return;
      }

      // 1. Quota Check & Enforcement
      const quota = await checkAndRecordAiUsage(userId, 'receipt', 'Receipt OCR Scan');
      if (!quota.allowed) {
        res.status(429).json({
          success: false,
          error: 'quota_exceeded',
          limit: quota.limit,
          usedCount: quota.usedCount,
          message: quota.message || 'AI chek skanerlash limiti tugadi. VIP Premium obunasini faollashtiring!'
        });
        return;
      }

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
        if (key.provider !== 'google') continue;
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
              res.json({
                success: true,
                type: parsed.type || 'expense',
                amount: fmtAmt,
                category: parsed.category || 'Oziq-ovqat',
                title: parsed.title || 'Chek xarajati',
                note: parsed.note || parsed.title || 'Chekdan olindi',
                providerUsed: `${key.provider}:${key.model}`
              });
              return;
            }
          }
        } catch (err: any) {
          console.warn(`[RECEIPT_SCAN] Key ${key.name} vision parse failed, rotating:`, err?.message);
          await recordKeyResult(key.id, false, err?.message, 'temporary');
        }
      }

      res.status(502).json({ error: 'Receipt scanning failed across available vision AI keys' });
    } catch (e: any) {
      console.error('Receipt parse error in server:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // ADMIN DASHBOARD API ENDPOINTS (Protected with Admin Security Gateway)
  // ─────────────────────────────────────────────────────────────

  // Admin Authentication Login Endpoint
  app.post("/api/admin/auth", async (req: any, res: any) => {
    return adminAuthHandler(req, res);
  });

  // Admin Security Middleware for all subsequent /api/admin routes
  app.use("/api/admin", (req: any, res: any, next: any) => {
    if (req.path === '/auth') return next();
    if (!requireAdminAuth(req, res)) return;
    next();
  });

  // 1. Admin AI Keys (GET Masked & POST Actions)
  app.get("/api/admin/ai-keys", async (req, res) => {

    try {
      let keys: AiKeyRecord[] = [];
      const { data: dbKeys, error } = await supabase
        .from('ai_keys')
        .select('*')
        .order('priority', { ascending: true })
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(dbKeys)) {
        keys = dbKeys;
      }

      if (keys.length === 0) {
        const envKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "";
        if (envKey) {
          keys = [{
            id: 'env_default_gemini',
            name: 'Default Environment Gemini Key',
            provider: 'google',
            api_key: envKey,
            model: 'gemini-2.5-flash',
            priority: 1,
            status: 'active',
            total_requests: 0,
            success_requests: 0,
            failed_requests: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }];
        }
      }

      const { data: aiLogs } = await supabase.from('ai_logs').select('id, timestamp').limit(1000);
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const curMonth = now.getMonth();
      const curYear = now.getFullYear();

      let requestsToday = 0;
      let requestsMonth = 0;

      (aiLogs || []).forEach((l: any) => {
        if (l.timestamp) {
          const d = new Date(l.timestamp);
          if (l.timestamp.startsWith(todayStr)) requestsToday++;
          if (d.getMonth() === curMonth && d.getFullYear() === curYear) requestsMonth++;
        }
      });

      const safeKeys = keys.map(k => ({
        id: k.id,
        name: k.name || 'Unnamed Key',
        provider: k.provider || 'google',
        maskedKey: maskApiKey(k.api_key),
        model: k.model || 'gemini-2.5-flash',
        priority: k.priority || 1,
        status: k.status || 'active',
        totalRequests: k.total_requests || 0,
        successRequests: k.success_requests || 0,
        failedRequests: k.failed_requests || 0,
        lastError: k.last_error || null,
        lastErrorAt: k.last_error_at || null,
        lastUsedAt: k.last_used_at || null,
        createdAt: k.created_at || new Date().toISOString(),
        updatedAt: k.updated_at || new Date().toISOString(),
      }));

      const metrics = {
        totalKeys: safeKeys.length,
        activeKeys: safeKeys.filter(k => k.status === 'active').length,
        rateLimitedKeys: safeKeys.filter(k => k.status === 'rate_limited').length,
        exhaustedKeys: safeKeys.filter(k => k.status === 'exhausted').length,
        disabledKeys: safeKeys.filter(k => k.status === 'disabled').length,
        requestsToday,
        requestsMonth,
        totalLogged: aiLogs?.length || 0
      };

      res.json({ success: true, keys: safeKeys, metrics });
    } catch (err: any) {
      console.error('[ADMIN_AI_KEYS_SERVER] GET error:', err);
      res.status(500).json({ error: 'Failed to fetch AI keys', details: err?.message });
    }
  });

  app.post("/api/admin/ai-keys", async (req, res) => {
    try {
      const { action, keyData, keyId } = req.body || {};
      const nowIso = new Date().toISOString();

      if (action === 'create') {
        const { name, provider, apiKey, model, priority, status } = keyData || {};
        if (!apiKey || !provider) {
          res.status(400).json({ error: 'Missing required apiKey or provider' });
          return;
        }

        const newId = `key_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const record: AiKeyRecord = {
          id: newId,
          name: name || `${provider.toUpperCase()} Key`,
          provider: provider || 'google',
          api_key: apiKey.trim(),
          model: model || (provider === 'google' ? 'gemini-2.5-flash' : 'gpt-4o-mini'),
          priority: Number(priority) || 1,
          status: status || 'active',
          total_requests: 0,
          success_requests: 0,
          failed_requests: 0,
          created_at: nowIso,
          updated_at: nowIso
        };

        await supabase.from('ai_keys').insert(record);

        res.json({
          success: true,
          message: 'AI kaliti muvaffaqiyatli saqlandi! 🔑',
          key: {
            ...record,
            maskedKey: maskApiKey(record.api_key),
            api_key: undefined
          }
        });
        return;
      }

      if (action === 'update') {
        if (!keyId) {
          res.status(400).json({ error: 'Missing keyId' });
          return;
        }

        const updatePayload: any = { updated_at: nowIso };
        if (keyData.name) updatePayload.name = keyData.name;
        if (keyData.provider) updatePayload.provider = keyData.provider;
        if (keyData.model) updatePayload.model = keyData.model;
        if (keyData.priority !== undefined) updatePayload.priority = Number(keyData.priority);
        if (keyData.status) updatePayload.status = keyData.status;

        if (keyData.apiKey && !keyData.apiKey.startsWith('••••')) {
          updatePayload.api_key = keyData.apiKey.trim();
        }

        await supabase.from('ai_keys').update(updatePayload).eq('id', keyId);
        res.json({ success: true, message: 'AI kaliti yangilandi! ✏️' });
        return;
      }

      if (action === 'toggle') {
        if (!keyId) {
          res.status(400).json({ error: 'Missing keyId' });
          return;
        }

        const { data: existing } = await supabase.from('ai_keys').select('status').eq('id', keyId).maybeSingle();
        const nextStatus = existing?.status === 'active' ? 'disabled' : 'active';
        await supabase.from('ai_keys').update({ status: nextStatus, updated_at: nowIso }).eq('id', keyId);

        res.json({
          success: true,
          status: nextStatus,
          message: `AI kaliti ${nextStatus === 'active' ? 'faollashtirildi 🟢' : 'o\'chirildi ⚪'}`
        });
        return;
      }

      if (action === 'delete') {
        if (!keyId) {
          res.status(400).json({ error: 'Missing keyId' });
          return;
        }
        await supabase.from('ai_keys').delete().eq('id', keyId);
        res.json({ success: true, message: 'AI kaliti o\'chirildi 🗑️' });
        return;
      }

      if (action === 'test') {
        let keyToTest: { provider: any; api_key: string; model?: string } | null = null;
        if (keyId) {
          const { data: found } = await supabase.from('ai_keys').select('*').eq('id', keyId).maybeSingle();
          if (found) {
            keyToTest = { provider: found.provider, api_key: found.api_key, model: found.model };
          }
        }

        if (!keyToTest && keyData?.apiKey) {
          keyToTest = { provider: keyData.provider || 'google', api_key: keyData.apiKey, model: keyData.model };
        }

        if (!keyToTest || !keyToTest.api_key) {
          res.status(400).json({ error: 'No key provided to test' });
          return;
        }

        const testResult = await testSpecificAiKey(keyToTest);
        if (keyId) {
          const newStatus = testResult.healthy ? 'active' : testResult.status.includes('Rate') ? 'rate_limited' : 'invalid';
          await supabase.from('ai_keys').update({
            status: newStatus,
            last_error: testResult.error || null,
            last_error_at: testResult.healthy ? null : nowIso,
            updated_at: nowIso
          }).eq('id', keyId);
        }

        res.json({
          success: true,
          healthy: testResult.healthy,
          status: testResult.status,
          latencyMs: testResult.latencyMs,
          error: testResult.error
        });
        return;
      }

      res.status(400).json({ error: 'Invalid action' });
    } catch (err: any) {
      console.error('[ADMIN_AI_KEYS_SERVER] POST error:', err);
      res.status(500).json({ error: 'Operation failed', details: err?.message });
    }
  });

  // 2. Admin Users
  app.get("/api/admin/users", async (req, res) => {
    try {
      const { data: suUsers, error } = await supabase
        .from('users')
        .select('*')
        .order('updated_at', { ascending: false });

      if (!error && Array.isArray(suUsers)) {
        const formatted = suUsers.map(u => ({
          id: u.id,
          name: u.name,
          phone: u.phone,
          telegram: u.telegram,
          telegramId: u.telegram_id,
          isPremium: u.is_premium,
          premiumExpiresAt: u.premium_expires_at,
          isBlocked: u.is_blocked || false,
          aiLimit: u.ai_limit,
          aiQueryCount: u.ai_query_count || 0,
          lastAiQueryAt: u.last_ai_query_at,
          deviceInfo: u.device_info || null,
          platform: u.platform || null,
          language: u.language,
          onboarding: u.onboarding,
          createdAt: u.created_at,
          updatedAt: u.updated_at
        }));
        res.json({ success: true, users: formatted });
        return;
      }
      res.json({ success: true, users: [] });
    } catch (e: any) {
      res.status(500).json({ error: 'Failed to fetch users', details: e?.message });
    }
  });

  app.post("/api/admin/users", async (req, res) => {
    try {
      const { userId, action, isPremium, aiLimit } = req.body || {};
      if (!userId) {
        res.status(400).json({ error: 'Missing userId' });
        return;
      }

      const nowIso = new Date().toISOString();
      const effectiveAction = action || (isPremium !== undefined ? (isPremium ? 'grant_vip' : 'revoke_vip') : null);

      switch (effectiveAction) {
        case 'grant_vip': {
          const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
          await supabase.from('users').update({
            is_premium: true, premium_expires_at: expiresAt, ai_query_count: 0, updated_at: nowIso
          }).eq('id', userId);
          res.json({ success: true, userId, action: 'grant_vip', isPremium: true });
          return;
        }
        case 'revoke_vip': {
          await supabase.from('users').update({
            is_premium: false, premium_expires_at: null, updated_at: nowIso
          }).eq('id', userId);
          res.json({ success: true, userId, action: 'revoke_vip', isPremium: false });
          return;
        }
        case 'block': {
          await supabase.from('users').update({ is_blocked: true, updated_at: nowIso }).eq('id', userId);
          res.json({ success: true, userId, action: 'block', isBlocked: true });
          return;
        }
        case 'unblock': {
          await supabase.from('users').update({ is_blocked: false, updated_at: nowIso }).eq('id', userId);
          res.json({ success: true, userId, action: 'unblock', isBlocked: false });
          return;
        }
        case 'set_ai_limit': {
          const limitValue = (aiLimit === null || aiLimit === undefined || aiLimit === -1 || aiLimit === 0) ? null : Number(aiLimit);
          await supabase.from('users').update({
            ai_limit: limitValue, ai_query_count: 0, updated_at: nowIso
          }).eq('id', userId);
          res.json({ success: true, userId, action: 'set_ai_limit', aiLimit: limitValue, aiQueryCount: 0 });
          return;
        }
        case 'reset_ai_count': {
          await supabase.from('users').update({ ai_query_count: 0, updated_at: nowIso }).eq('id', userId);
          res.json({ success: true, userId, action: 'reset_ai_count', aiQueryCount: 0 });
          return;
        }
        default: {
          if (isPremium !== undefined) {
            await supabase.from('users').update({ is_premium: !!isPremium, updated_at: nowIso }).eq('id', userId);
            res.json({ success: true, userId, isPremium: !!isPremium });
            return;
          }
          res.status(400).json({ error: 'Missing action or isPremium field' });
        }
      }
    } catch (e: any) {
      res.status(500).json({ error: 'Failed to update user', details: e?.message });
    }
  });

  // 3. Admin AI Logs
  app.get("/api/admin/ai-logs", async (req, res) => {
    try {
      const { data: suLogs } = await supabase
        .from('ai_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(100);

      const formatted = (suLogs || []).map((l: any) => ({
        id: l.id,
        userId: l.user_id,
        queryType: l.query_type,
        promptSummary: l.prompt_summary,
        isPremium: l.is_premium,
        timestamp: l.timestamp
      }));
      res.json({ success: true, count: formatted.length, logs: formatted });
    } catch (e: any) {
      res.status(500).json({ error: 'Failed to fetch AI logs', details: e?.message });
    }
  });

  // 4. Admin Broadcast (Enhanced with audience targeting & notification types)
  app.post("/api/admin/broadcast", async (req, res) => {
    try {
      const { title, message, emoji, type, target_audience, audience, image_url, action_url, expire_hours, expireHours } = req.body || {};
      if (!message) {
        res.status(400).json({ error: 'Missing message' });
        return;
      }

      const effectiveAudience = target_audience || audience || 'all';
      const effectiveType = type || 'info';
      const effectiveExpire = expire_hours || expireHours || 72;
      const expiresAt = new Date(Date.now() + Number(effectiveExpire) * 3600 * 1000).toISOString();

      const typeEmojis: Record<string, string> = { info: 'ℹ️', feature: '✨', maintenance: '🔧', promo: '🎁' };
      const effectiveEmoji = emoji || typeEmojis[effectiveType] || '📢';

      await supabase.from('app_notifications').insert({
        title: title || 'Yangilanish',
        message,
        emoji: effectiveEmoji,
        type: effectiveType,
        target: effectiveAudience,
        target_audience: effectiveAudience,
        image_url: image_url || null,
        action_url: action_url || null,
        is_active: true,
        expires_at: expiresAt,
        created_at: new Date().toISOString()
      });

      res.json({ success: true, message: 'Broadcast notification published! 📢', audience: effectiveAudience, type: effectiveType });
    } catch (e: any) {
      res.status(500).json({ error: 'Failed to broadcast', details: e?.message });
    }
  });

  // 5. Admin Notifications (list, update, delete)
  app.get("/api/admin/notifications", async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('app_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }
      res.json(data || []);
    } catch (e: any) {
      res.status(500).json({ error: 'Failed to fetch notifications', details: e?.message });
    }
  });

  app.post("/api/admin/notifications", async (req, res) => {
    try {
      const { action, id, title, message, emoji, type, target_audience, image_url, action_url, is_active } = req.body || {};

      if (action === 'update') {
        if (!id) { res.status(400).json({ error: 'Missing notification ID' }); return; }
        const updates: any = {};
        if (title !== undefined) updates.title = title;
        if (message !== undefined) updates.message = message;
        if (emoji !== undefined) updates.emoji = emoji;
        if (type !== undefined) updates.type = type;
        if (target_audience !== undefined) updates.target_audience = target_audience;
        if (image_url !== undefined) updates.image_url = image_url;
        if (action_url !== undefined) updates.action_url = action_url;
        if (is_active !== undefined) updates.is_active = is_active;

        const { error } = await supabase.from('app_notifications').update(updates).eq('id', id);
        if (error) { res.status(500).json({ error: error.message }); return; }
        res.json({ success: true, message: 'Notification updated' });
      } else if (action === 'delete') {
        if (!id) { res.status(400).json({ error: 'Missing notification ID' }); return; }
        const { error } = await supabase.from('app_notifications').delete().eq('id', id);
        if (error) { res.status(500).json({ error: error.message }); return; }
        res.json({ success: true, message: 'Notification deleted' });
      } else {
        res.status(400).json({ error: 'Invalid action. Use update or delete.' });
      }
    } catch (e: any) {
      res.status(500).json({ error: 'Failed', details: e?.message });
    }
  });

  // 6. Admin Analytics (from ai_logs)
  app.get("/api/admin/analytics", async (req, res) => {
    try {
      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const [
        { count: totalQueries },
        { count: todayQueries },
        { count: weekQueries },
        { data: logs }
      ] = await Promise.all([
        supabase.from('ai_logs').select('id', { count: 'exact', head: true }),
        supabase.from('ai_logs').select('id', { count: 'exact', head: true }).gte('timestamp', dayAgo.toISOString()),
        supabase.from('ai_logs').select('id', { count: 'exact', head: true }).gte('timestamp', weekAgo.toISOString()),
        supabase.from('ai_logs').select('timestamp, query_type, user_id, is_premium')
      ]);

      const allLogs = logs || [];

      // Category breakdown
      const categoryBreakdown: Record<string, number> = {};
      allLogs.forEach((l: any) => { const t = l.query_type || 'text'; categoryBreakdown[t] = (categoryBreakdown[t] || 0) + 1; });

      // Hourly heatmap (last 7 days)
      const hourlyHeatmap = Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 }));
      allLogs.forEach((l: any) => {
        if (l.timestamp) {
          const h = new Date(l.timestamp).getHours();
          hourlyHeatmap[h].count++;
        }
      });

      // Daily trend (last 7 days)
      const dailyMap: Record<string, number> = {};
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        dailyMap[d.toISOString().slice(0, 10)] = 0;
      }
      allLogs.forEach((l: any) => {
        if (l.timestamp) {
          const dateKey = new Date(l.timestamp).toISOString().slice(0, 10);
          if (dailyMap[dateKey] !== undefined) dailyMap[dateKey]++;
        }
      });
      const dailyTrend = Object.entries(dailyMap).map(([date, count]) => ({ date, count }));

      // Top users
      const userCounts: Record<string, number> = {};
      allLogs.forEach((l: any) => { if (l.user_id) userCounts[l.user_id] = (userCounts[l.user_id] || 0) + 1; });
      const topUsers = Object.entries(userCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([user_id, count]) => ({ user_id, count }));

      // Premium vs Free
      let premiumCount = 0, freeCount = 0;
      allLogs.forEach((l: any) => { l.is_premium ? premiumCount++ : freeCount++; });

      res.json({
        totalQueries: totalQueries || 0,
        todayQueries: todayQueries || 0,
        weekQueries: weekQueries || 0,
        categoryBreakdown,
        hourlyHeatmap,
        dailyTrend,
        topUsers,
        premiumVsFree: { premium: premiumCount, free: freeCount }
      });
    } catch (e: any) {
      res.status(500).json({ error: 'Failed to fetch analytics', details: e?.message });
    }
  });

  app.post("/api/admin/analytics", async (req, res) => {
    try {
      const { action } = req.body || {};
      if (action === 'reset') {
        await supabase.from('ai_logs').delete().neq('id', '');
        res.json({ success: true, message: 'All analytics data cleared' });
      } else {
        res.status(400).json({ error: 'Invalid action' });
      }
    } catch (e: any) {
      res.status(500).json({ error: 'Failed to reset analytics', details: e?.message });
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // In-memory Telegram user transaction store for instant response & syncing
  const tgUserTransactions = new Map<number, { id: string; type: string; name: string; category: string; amount: number; date: string }[]>();
  
  // Track active chat IDs for 3-hour automated expense reminders
  const activeTelegramChats = new Set<number>();

  // Shared AI Usage tracker per user: 1-day free trial, then max 5 AI requests / month
  const tgUserAiUsage = new Map<number, { firstSeen: number; count: number }>();

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

  async function syncUserTxToFirestore(chatId: number, txs: any[]) {
    try {
      const tgId = String(chatId);
      const userId = `moliya_user_tg_${tgId}`;
      await supabase.from('users').update({
        transactions: txs,
        updated_at: new Date().toISOString()
      }).eq('id', userId);
    } catch (e) {
      console.error("Supabase sync error:", e);
    }
  }

  async function generateAndStoreOtpCode(fromUser: any): Promise<string> {
    const tgId = String(fromUser.id);
    const tgName = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ') || 'Telegram Foydalanuvchi';
    const tgUsername = fromUser.username ? `@${fromUser.username}` : '';
    const userId = `moliya_user_tg_${tgId}`;

    // 1. Invalidate/delete previous OTPs for this user
    try {
      await supabase
        .from('users')
        .delete()
        .eq('telegram_id', tgId)
        .like('id', 'otp_%');
    } catch (cleanErr) {
      console.warn('[SERVER] Error cleaning old OTPs:', cleanErr);
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();

    const { data: userDoc } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();

    await supabase.from('users').upsert({
      id: `otp_${otpCode}`,
      telegram_id: tgId,
      name: tgName,
      telegram: tgUsername,
      phone: userDoc?.phone || userDoc?.onboarding?.phone || null,
      onboarding: {
        otp_code: otpCode,
        telegram_id: tgId,
        login_request_status: 'PENDING_OTP',
        expires_at: expiresAt
      },
      updated_at: now.toISOString()
    }, { onConflict: 'id' });

    return otpCode;
  }

  const checkAndIncrementAiLimit = (chatId: number): { allowed: boolean; isTrial: boolean; remaining: number } => {
    const now = Date.now();
    let usage = tgUserAiUsage.get(chatId);
    if (!usage) {
      usage = { firstSeen: now, count: 0 };
      tgUserAiUsage.set(chatId, usage);
    }

    // 1-day trial active (24 hours unlimited)
    const isTrial = (now - usage.firstSeen) < (24 * 3600 * 1000);
    if (isTrial) {
      return { allowed: true, isTrial: true, remaining: 999 };
    }

    // After 1-day trial: Max 5 AI requests per month
    if (usage.count >= 5) {
      return { allowed: false, isTrial: false, remaining: 0 };
    }

    usage.count += 1;
    tgUserAiUsage.set(chatId, usage);
    return { allowed: true, isTrial: false, remaining: 5 - usage.count };
  };

  const appUrl = process.env.APP_URL || "https://moliya-ai-pi.vercel.app";

  const getMainMenuKeyboard = (requestId?: string) => {
    const webUrl = requestId ? `${appUrl}/?req=${requestId}` : appUrl;
    return {
      keyboard: [
        [{ text: "📱 Telegram Mini App", web_app: { url: appUrl } }, { text: "🌐 Web App", url: webUrl }],
        [{ text: "📊 Balans va Statistika" }, { text: "❌ Oxirgi operatsiyani o'chirish" }],
        [{ text: "💡 Yordam" }]
      ],
      resize_keyboard: true
    };
  };

  const getDualLinkInlineButtons = (requestId?: string) => {
    const webUrl = requestId ? `${appUrl}/?req=${requestId}` : appUrl;
    return {
      inline_keyboard: [
        [
          { text: "📱 Telegram Mini App", web_app: { url: appUrl } },
          { text: "🌐 Web App-ga o'tish", url: webUrl }
        ]
      ]
    };
  };

  // Automated 3-Hour Expense Reminder System
  setInterval(async () => {
    console.log(`⏰ Running 3-hour automated expense reminders for ${activeTelegramChats.size} users...`);
    for (const chatId of activeTelegramChats) {
      try {
        const reminderText = `🔔 <b>Assalomu alaykum!</b> 👋\n\nOxirgi xarajatlaringizni kiritishni unutdingizmi?\n📝 Matn shaklida yozing yoki 🎙 ovozli xabar yuboring.`;
        await sendTelegramMessage(chatId, reminderText, getDualLinkInlineButtons());
      } catch (err) {
        console.error(`Failed 3-hour reminder for chatId ${chatId}:`, err);
      }
    }
  }, 3 * 3600 * 1000);

  // Telegram Bot Update Handler
  async function handleTelegramUpdate(update: any) {
    if (!update) return;

    // A) Handle Callback Query (e.g. Inline "O'chirish" button)
    if (update.callback_query) {
      const cb = update.callback_query;
      const chatId = cb.message?.chat?.id;
      const data = cb.data;

      if (chatId) activeTelegramChats.add(chatId);

      if (chatId && data && data.startsWith('del_')) {
        const txId = data.replace('del_', '');
        const txs = tgUserTransactions.get(chatId) || [];
        const newTxs = txs.filter(t => t.id !== txId);
        tgUserTransactions.set(chatId, newTxs);
        await syncUserTxToFirestore(chatId, newTxs);

        await answerCallbackQuery(cb.id, "🗑 Operatsiya o'chirildi!");
        await sendTelegramMessage(chatId, "🗑 <b>Operatsiya muvaffaqiyatli o'chirildi!</b> ✅", getMainMenuKeyboard());
      }
      return;
    }

    // B) Handle Text Message & Voice Note
    if (update.message) {
      const message = update.message;
      const chatId = message.chat?.id;
      const text = message.text;
      const voice = message.voice || message.audio;
      const fromUser = message.from;

      if (!chatId) return;
      activeTelegramChats.add(chatId);

      // Handle Voice Note / Audio Recording
      if (voice && voice.file_id) {
        const limitInfo = checkAndIncrementAiLimit(chatId);
        if (!limitInfo.allowed) {
          const limitMsg = `⚠️ <b>Oylik Bepul AI Limiti Tugadi! (5/5 ishlatildi)</b>\n\nSiz oylik bepul 5 ta AI so'rov imkoniyatizdan foydalandingiz.\nCheksiz AI va ovozli tahlil uchun <b>Premium</b> tarifiga o'ting! ⭐`;
          await sendTelegramMessage(chatId, limitMsg, getDualLinkInlineButtons());
          return;
        }

        try {
          await sendTelegramMessage(chatId, "🎙 <i>Ovozli xabar tahlil qilinmoqda...</i>");

          // 1. Get file path from Telegram
          const fileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${voice.file_id}`);
          const fileData = await fileRes.json();
          if (fileData.ok && fileData.result?.file_path) {
            const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileData.result.file_path}`;
            const audioBufRes = await fetch(downloadUrl);
            const audioArrayBuffer = await audioBufRes.arrayBuffer();
            const base64Audio = Buffer.from(audioArrayBuffer).toString('base64');

            if (process.env.GEMINI_API_KEY) {
              const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
              const promptText = `Listen to this audio financial entry in Uzbek/Russian and parse into JSON:
- type: 'expense' | 'income'
- amount: number
- category: string ('Oziq-ovqat', 'Transport', 'Kiyim', 'Kommunal', 'Sog\'liq', 'Ta\'lim', 'Maosh', 'Boshqa')
- note: string`;

              const response = await ai.models.generateContent({
                model: "gemini-3.1-flash-lite",
                contents: [
                  {
                    inlineData: {
                      mimeType: "audio/ogg",
                      data: base64Audio
                    }
                  },
                  promptText
                ],
                config: {
                  responseMimeType: "application/json",
                  responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                      type: { type: Type.STRING },
                      amount: { type: Type.NUMBER },
                      category: { type: Type.STRING },
                      note: { type: Type.STRING },
                    },
                    required: ["type", "amount", "category", "note"],
                  }
                }
              });

              const parsed = JSON.parse(response.text || '{}');
              if (parsed && parsed.amount && parsed.amount > 0) {
                const txId = 'tx_' + Date.now();
                const txItem = {
                  id: txId,
                  type: parsed.type || 'expense',
                  name: parsed.note || "Ovozli yozuv",
                  category: parsed.category || 'Boshqa',
                  amount: parsed.amount,
                  date: new Date().toISOString()
                };

                const userList = tgUserTransactions.get(chatId) || [];
                userList.push(txItem);
                tgUserTransactions.set(chatId, userList);
                await syncUserTxToFirestore(chatId, userList);

                const typeEmoji = parsed.type === 'income' ? '🟢 Daromad' : '🛒 Xarajat';
                const formattedAmt = parsed.amount.toLocaleString('en-US').replace(/,/g, ' ');

                const replyCard = `🎙 <b>Ovozli operatsiya saqlandi!</b> 🌟\n\n📌 <b>Turi:</b> ${typeEmoji}\n💵 <b>Summa:</b> ${formattedAmt} so'm\n📂 <b>Kategoriya:</b> ${parsed.category}\n📝 <b>Izoh:</b> ${parsed.note || "Ovozli xabar"}`;

                const inlineKeyboard = {
                  inline_keyboard: [
                    [
                      { text: "❌ Operatsiyani o'chirish", callback_data: `del_${txId}` },
                      { text: "📱 Mini App", web_app: { url: appUrl } },
                      { text: "🌐 Web App", url: appUrl }
                    ]
                  ]
                };

                await sendTelegramMessage(chatId, replyCard, inlineKeyboard);
                return;
              }
            }
          }
        } catch (voiceErr) {
          console.error("Voice processing error:", voiceErr);
        }

        await sendTelegramMessage(chatId, "⚠️ <i>Ovozli xabarni tushunib bo'lmadi. Qaytadan aniqroq gapirib ko'ring.</i>", getMainMenuKeyboard());
        return;
      }

      if (!text) return;

      // 1. /start command
      if (text.startsWith("/start")) {
        const rawArg = text.replace('/start', '').trim();
        const requestId = rawArg.replace('req_', '').trim();

        // Android APK OTP code request
        if (rawArg.toLowerCase().includes('apk') || rawArg.toLowerCase().includes('app')) {
          const otpCode = await generateAndStoreOtpCode(fromUser);
          const apkMessage = `🔐 <b>Kirish kodi:</b> <code>${otpCode}</code>\n\n` +
            `Ushbu kodni ilovaga kiriting. Kod 10 daqiqa amal qiladi.`;

          await sendTelegramMessage(chatId, apkMessage);
          await sendTelegramMessage(chatId, "👇 Asosiy menyu:", getMainMenuKeyboard());
          return;
        }

        if (requestId && requestId.length >= 8) {
          try {
            const tgId = String(fromUser.id);
            const userId = `moliya_user_tg_${tgId}`;
            const now = new Date();
            const expiresAt = new Date(now.getTime() + 60 * 24 * 3600 * 1000).toISOString();
            const sessionToken = 'sess_' + crypto.randomBytes(32).toString('hex');

            const tgName = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ') || 'Telegram Foydalanuvchi';
            const tgUsername = fromUser.username ? '@' + fromUser.username : '@moliya_user';

            const { data: existingUser } = await supabase
              .from('users')
              .select('*')
              .eq('id', userId)
              .maybeSingle();

            const updatedOnboarding = {
              ...(existingUser?.onboarding || {}),
              completed: true,
              language: existingUser?.language || 'uz',
              name: tgName,
              telegram: tgUsername,
              telegramId: tgId,
            };

            const onboardingPayload = {
              ...updatedOnboarding,
              session_token: sessionToken,
              session_expires_at: expiresAt,
            };

            await supabase.from('users').upsert({
              id: userId,
              name: tgName,
              telegram: tgUsername,
              telegram_id: tgId,
              phone: existingUser?.phone || null,
              language: updatedOnboarding.language,
              is_premium: existingUser?.is_premium || false,
              onboarding: onboardingPayload,
              updated_at: now.toISOString()
            }, { onConflict: 'id' });

            const cleanId = requestId.replace(/^req_/, '').trim();
            await supabase.from('users').upsert({
              id: `req_${cleanId}`,
              telegram_id: tgId,
              name: tgName,
              telegram: tgUsername,
              onboarding: {
                login_request_id: cleanId,
                login_request_status: 'VERIFIED',
                telegram_id: tgId,
                session_token: sessionToken,
              },
              updated_at: now.toISOString()
            }, { onConflict: 'id' });
          } catch (e) {
            console.error('Error verifying login request in server.ts:', e);
          }

          const successText = `<b>Assalomu alaykum, ${fromUser?.first_name || 'foydalanuvchi'}!</b> 👋✨\n\n✅ <b>Muvaffaqiyatli tasdiqlandi!</b> 🚀\nBrauzeringizdagi Moliya AI ilovasiga avtomatik kirdingiz.\n\n👇 <i>Ilovaga o'tish uchun quyidagi tugmani bosing:</i>`;
          await sendTelegramMessage(chatId, successText, getDualLinkInlineButtons(requestId));
          await sendTelegramMessage(chatId, "👇 Kerakli bo'limni tanlang:", getMainMenuKeyboard());
          return;
        }

        const welcomeText = `<b>Assalomu alaykum, ${fromUser?.first_name || 'foydalanuvchi'}!</b> 👋✨\n\n<b>Moliya AI</b> botiga xush kelibsiz! 🚀\n\nPulingizni oson va aqlli boshqaring.\n\n👇 <b>Ilovani ochish uchun quyidagi linklardan foydalaning:</b>`;
        await sendTelegramMessage(chatId, welcomeText, getDualLinkInlineButtons());
        await sendTelegramMessage(chatId, "👇 Kerakli bo'limni tanlang:", getMainMenuKeyboard());
        return;
      }

      // 2. Help command or button
      if (text.startsWith("/help") || text.includes("Yordam") || text.includes("yordam")) {
        const helpText = `💡 <b>Moliya AI Boti bo'limlari:</b>\n\n• 📝 <b>Matnli xarajat kiritish</b>\n• 🎙 <b>Ovozli xabar yuborish</b>\n• 📱 <b>Ilovani ochish</b>\n• 📊 <b>Balans va hisobotlar</b>\n• ❌ <b>Operatsiyalarni o'chirish</b>\n\n⭐ <i>1 kunlik bepul sinov va oylik 5 ta AI so'rov limiti mavjud.</i>`;
        await sendTelegramMessage(chatId, helpText, getMainMenuKeyboard());
        return;
      }

      // 3. Balance & Statistics command or button
      if (text.includes("Balans") || text.includes("balans") || text.startsWith("/balance") || text.includes("Statistika")) {
        const txs = tgUserTransactions.get(chatId) || [];
        const totalIncome = txs.filter(t => t.type === 'income').reduce((acc, t) => acc + t.amount, 0);
        const totalExpense = txs.filter(t => t.type === 'expense').reduce((acc, t) => acc + Math.abs(t.amount), 0);
        const netBalance = totalIncome - totalExpense;

        const fmt = (n: number) => n.toLocaleString('en-US').replace(/,/g, ' ');

        let lastTxsText = "<i>Hozircha tranzaksiyalar yo'q.</i>";
        if (txs.length > 0) {
          lastTxsText = txs.slice(-3).reverse().map((t, idx) => {
            const icon = t.type === 'income' ? '🟢' : '🔻';
            return `${idx + 1}. ${icon} <b>${t.category}</b> — ${fmt(t.amount)} so'm <i>(${t.name})</i>`;
          }).join('\n');
        }

        const balText = `📊 <b>Moliyaviy Hisobotingiz:</b> ✨\n\n🟢 <b>Jami Daromad:</b> ${fmt(totalIncome)} so'm\n🔻 <b>Jami Xarajat:</b> ${fmt(totalExpense)} so'm\n💰 <b>Sof Qoldiq:</b> ${fmt(netBalance)} so'm\n\n📋 <b>Oxirgi 3 ta operatsiya:</b>\n${lastTxsText}`;
        await sendTelegramMessage(chatId, balText, getMainMenuKeyboard());
        return;
      }

      // 4. Delete last transaction button or command
      if (text.includes("o'chirish") || text.includes("очириш") || text.startsWith("/delete")) {
        const txs = tgUserTransactions.get(chatId) || [];
        if (txs.length === 0) {
          await sendTelegramMessage(chatId, "ℹ️ <i>O'chirish uchun tranzaksiyalar mavjud emas.</i>", getMainMenuKeyboard());
          return;
        }
        const lastTx = txs.pop();
        tgUserTransactions.set(chatId, txs);
        const fmt = (n: number) => n.toLocaleString('en-US').replace(/,/g, ' ');
        await sendTelegramMessage(chatId, `🗑 <b>Oxirgi operatsiya o'chirildi!</b> ✅\n\n❌ <b>O'chirildi:</b> ${fmt(lastTx?.amount || 0)} so'm (${lastTx?.category} - ${lastTx?.name})`, getMainMenuKeyboard());
        return;
      }

      // Check AI request limit before running Gemini
      const limitInfo = checkAndIncrementAiLimit(chatId);
      if (!limitInfo.allowed) {
        const limitMsg = `⚠️ <b>Oylik Bepul AI Limiti Tugadi! (5/5 ishlatildi)</b>\n\nSiz oylik bepul 5 ta AI so'rov imkoniyatizdan foydalandingiz.\nCheksiz AI so'rovlari uchun <b>Premium</b> tarifiga o'ting! ⭐`;
        await sendTelegramMessage(chatId, limitMsg, {
          inline_keyboard: [
            [{ text: "⭐ Premium olish", web_app: { url: appUrl } }],
            [{ text: "📱 Ilovani ochish", web_app: { url: appUrl } }]
          ]
        });
        return;
      }

      // 5. Natural Language Expense/Income Parsing (Gemini AI or Smart Fallback)
      let parsed: { type: string; amount: number; category: string; note: string } | null = null;

      if (process.env.GEMINI_API_KEY) {
        try {
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
          const promptText = `
You are a financial parsing assistant for an Uzbek Telegram Bot.
Parse input: "${text.replace(/[\r\n\t]/g, ' ').slice(0, 300)}"
Return JSON object:
- type: 'expense' | 'income'
- amount: number
- category: string (e.g. 'Oziq-ovqat', 'Transport', 'Kiyim', 'Kommunal', 'Sog\'liq', 'Ta\'lim', 'Maosh', 'Boshqa')
- note: string (clean summary)
`;
          const response = await ai.models.generateContent({
            model: "gemini-3.1-flash-lite",
            contents: promptText,
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING },
                  amount: { type: Type.NUMBER },
                  category: { type: Type.STRING },
                  note: { type: Type.STRING },
                },
                required: ["type", "amount", "category", "note"],
              }
            }
          });
          parsed = JSON.parse(response.text || '{}');
        } catch (aiErr) {
          console.error('Gemini error in bot:', aiErr);
        }
      }

      // Fallback NLP Parser if Gemini unavailable or failed
      if (!parsed || !parsed.amount) {
        const lower = text.toLowerCase();
        let amount = 0;
        const numMatch = lower.match(/(\d+(?:[\.,]\d+)?)\s*(?:ming|k|mln|million)?/i);
        if (numMatch) {
          let val = parseFloat(numMatch[1].replace(',', '.'));
          if (lower.includes('mln') || lower.includes('million')) val *= 1000000;
          else if (lower.includes('ming') || lower.includes('k') || val < 1000) val *= 1000;
          amount = Math.round(val);
        }

        let type = 'expense';
        if (lower.includes('oylik') || lower.includes('maosh') || lower.includes('topdim') || lower.includes('daromad') || lower.includes('tushdi')) {
          type = 'income';
        }

        let category = 'Boshqa';
        if (lower.includes('taksi') || lower.includes('avtobus') || lower.includes(' benzin')) category = 'Transport';
        else if (lower.includes('ovqat') || lower.includes('tushlik') || lower.includes('bozor') || lower.includes('eda')) category = 'Oziq-ovqat';
        else if (lower.includes('backpack') || lower.includes('kiyim') || lower.includes('shoes') || lower.includes('sumka')) category = 'Kiyim';
        else if (type === 'income') category = 'Maosh';

        if (amount > 0) {
          parsed = { type, amount, category, note: text };
        }
      }

      if (parsed && parsed.amount && parsed.amount > 0) {
        const txId = 'tx_' + Date.now();
        const txItem = {
          id: txId,
          type: parsed.type,
          name: parsed.note || text,
          category: parsed.category || 'Boshqa',
          amount: parsed.amount,
          date: new Date().toISOString()
        };

        const userList = tgUserTransactions.get(chatId) || [];
        userList.push(txItem);
        tgUserTransactions.set(chatId, userList);

        const typeEmoji = parsed.type === 'income' ? '🟢 Daromad' : '🛒 Xarajat';
        const formattedAmt = parsed.amount.toLocaleString('en-US').replace(/,/g, ' ');

        const replyCard = `✅ <b>Operatsiya saqlandi!</b> 🌟\n\n📌 <b>Turi:</b> ${typeEmoji}\n💵 <b>Summa:</b> ${formattedAmt} so'm\n📂 <b>Kategoriya:</b> ${parsed.category}\n📝 <b>Izoh:</b> ${parsed.note || text}`;

        const inlineKeyboard = {
          inline_keyboard: [
            [
              { text: "❌ Operatsiyani o'chirish", callback_data: `del_${txId}` },
              { text: "📱 Ilovani ochish", web_app: { url: appUrl } }
            ]
          ]
        };

        await sendTelegramMessage(chatId, replyCard, inlineKeyboard);
        return;
      }

      await sendTelegramMessage(chatId, `👍 Xabaringiz qabul qilindi.`, getMainMenuKeyboard());
    }
  }

  // Webhook Endpoint
  app.post("/api/telegram-webhook", async (req, res) => {
    res.status(200).send("OK");
    try {
      await handleTelegramUpdate(req.body);
    } catch (err) {
      console.error('Error handling webhook:', err);
    }
  });

  // Long Polling Engine for local dev (only if ENABLE_LOCAL_POLLING === 'true')
  if (process.env.ENABLE_LOCAL_POLLING === 'true') {
    let lastUpdateId = 0;
    async function startTelegramLongPolling() {
      try {
        console.log(`🤖 Telegram Bot Polling started...`);
      } catch (e) {
        console.error("Telegram init polling error:", e);
      }

      while (true) {
        try {
          const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=15`;
          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json();
            if (data.ok && Array.isArray(data.result)) {
              for (const update of data.result) {
                lastUpdateId = Math.max(lastUpdateId, update.update_id);
                await handleTelegramUpdate(update);
              }
            }
          }
        } catch (e) {
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    }

    startTelegramLongPolling().catch(e => console.error("Long polling error:", e));
  }

  async function answerCallbackQuery(callbackQueryId: string, text: string) {
    try {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQueryId, text })
      });
    } catch (err) {
      console.error('Failed to answer callback query:', err);
    }
  }

  async function sendTelegramMessage(chatId: number | string, text: string, replyMarkup?: any, autoDeleteSeconds?: number) {
    if (!BOT_TOKEN) return null;
    try {
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          reply_markup: replyMarkup
        })
      });
      const data = await res.json();
      if (data.ok && data.result?.message_id && autoDeleteSeconds) {
        const msgId = data.result.message_id;
        setTimeout(() => {
          deleteTelegramMessage(chatId, msgId);
        }, autoDeleteSeconds * 1000);
      }
      return data;
    } catch (err) {
      console.error('Failed to send Telegram message:', err);
      return null;
    }
  }

  async function deleteTelegramMessage(chatId: number | string, messageId: number) {
    try {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId })
      });
    } catch (err) {
      console.error('Failed to delete Telegram message:', err);
    }
  }

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production" && process.env.VERCEL !== '1') {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (e) {
      console.error("Vite dev server load error:", e);
    }
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
  }

  if (process.env.VERCEL !== '1') {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

startServer();

export default app;
