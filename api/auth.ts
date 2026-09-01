import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { supabase } from './_supabaseClient.js';
import { createSupabaseAuthSession } from './_authHelper.js';

function verifyTelegramInitData(initData: string, botToken: string): { isValid: boolean; user?: any } {
  if (!botToken || !initData) {
    return { isValid: false };
  }
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return { isValid: false };

    params.delete("hash");

    const keys = Array.from(params.keys()).sort();
    const dataCheckString = keys
      .map((key) => `${key}=${params.get(key)}`)
      .join("\n");

    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(botToken)
      .digest();

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Extract action from query (via vercel rewrite ?action=...) or URL path
  let action = (req.query.action as string) || '';
  if (!action && req.url) {
    const cleanUrl = req.url.split('?')[0];
    action = cleanUrl.replace(/^\/api\/auth\/?/, '').trim();
  }

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

  // 1. /api/auth/telegram
  if (action === 'telegram') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
      const { initData } = req.body || {};
      let tgUser: any = null;

      if (initData && BOT_TOKEN) {
        const verification = verifyTelegramInitData(initData, BOT_TOKEN);
        if (verification.isValid && verification.user) {
          tgUser = verification.user;
        }
      }

      if (!tgUser || !tgUser.id) {
        return res.status(400).json({ error: "Invalid Telegram authentication data" });
      }

      const tgId = String(tgUser.id);
      const userId = `moliya_user_tg_${tgId}`;

      // Restriction & Block Guard: Deny access if Telegram ID is restricted or blocked
      const { data: restrictionCheck } = await supabase
        .from('users')
        .select('*')
        .or(`id.eq.${userId},id.eq.restricted_tg_${tgId},telegram_id.eq.${tgId}`)
        .maybeSingle();

      const isUserRestricted = Boolean(
        restrictionCheck?.is_restricted ||
        restrictionCheck?.is_blocked ||
        restrictionCheck?.id?.startsWith('restricted_') ||
        restrictionCheck?.device_info?.restricted ||
        restrictionCheck?.device_info?.is_blocked ||
        restrictionCheck?.onboarding?.is_restricted ||
        restrictionCheck?.onboarding?.is_blocked
      );

      if (isUserRestricted) {
        return res.status(403).json({
          error: 'ACCOUNT_RESTRICTED',
          message: "Hisobingiz ma'muriyat tomonidan cheklangan."
        });
      }

      // Registration Guard: Deny access if user has not completed phone number registration
      const isRegistered = Boolean(
        restrictionCheck?.phone &&
        (restrictionCheck?.registration_status === 'completed' || restrictionCheck?.onboarding?.registration_status === 'completed')
      );

      if (!isRegistered) {
        return res.status(403).json({
          error: 'REGISTRATION_REQUIRED',
          message: "Iltimos, avval Telegram botda telefon raqamingizni tasdiqlang."
        });
      }

      // Dynamic 1-Day Trial Expiration Check
      let isPremium = Boolean(restrictionCheck?.is_premium);
      if (isPremium && restrictionCheck?.premium_expires_at) {
        if (new Date(restrictionCheck.premium_expires_at).getTime() < Date.now()) {
          isPremium = false;
          await supabase
            .from('users')
            .update({ is_premium: false, ai_limit: 5, updated_at: new Date().toISOString() })
            .eq('id', userId);
        }
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + 60 * 24 * 3600 * 1000).toISOString();
      const randomHex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
      const sessionToken = 'sess_' + randomHex;

      const tgName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || 'Telegram Foydalanuvchi';
      const tgUsername = tgUser.username ? '@' + tgUser.username : '@moliya_user';

      const updatedOnboarding = {
        ...(restrictionCheck?.onboarding || {}),
        language: restrictionCheck?.language || tgUser.language_code || 'uz',
        name: tgName,
        phone: restrictionCheck?.phone || '',
        telegram: tgUsername,
        telegramId: tgId,
        registration_status: 'completed'
      };

      await supabase.from('users').update({
        session_token: sessionToken,
        session_expires_at: expiresAt,
        onboarding: updatedOnboarding,
        updated_at: now.toISOString()
      }).eq('id', userId);

      const authSession = await createSupabaseAuthSession(tgId, { name: tgName, telegram: tgUsername });

      return res.status(200).json({
        userId,
        sessionToken,
        access_token: authSession?.access_token || null,
        refresh_token: authSession?.refresh_token || null,
        onboarding: updatedOnboarding,
        cards: restrictionCheck?.cards || [],
        transactions: restrictionCheck?.transactions || [],
        isPremium,
        trialEndsAt: restrictionCheck?.trial_ends_at || restrictionCheck?.premium_expires_at,
        aiLimit: isPremium ? null : (restrictionCheck?.ai_limit || 5)
      });
    } catch (error: any) {
      console.error('Error in auth telegram:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  // 2. /api/auth/exchange-code
  if (action === 'exchange-code') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
      const { code } = req.body || {};
      if (!code || typeof code !== 'string' || code.length < 16) {
        return res.status(400).json({ error: 'Missing or invalid code' });
      }

      const codeId = `exchange_${code}`;
      const { data: codeDoc, error: lookupError } = await supabase
        .from('users')
        .select('*')
        .eq('id', codeId)
        .maybeSingle();

      if (lookupError || !codeDoc) {
        return res.status(400).json({ error: 'Invalid or expired code' });
      }

      if (codeDoc.session_expires_at && new Date(codeDoc.session_expires_at).getTime() < Date.now()) {
        await supabase.from('users').delete().eq('id', codeId);
        return res.status(400).json({ error: 'Code expired' });
      }

      if (codeDoc.login_request_status === 'USED') {
        return res.status(400).json({ error: 'Code already used' });
      }

      const tgId = codeDoc.telegram_id;
      if (!tgId) {
        return res.status(400).json({ error: 'Invalid code: no telegram_id' });
      }

      await supabase.from('users').update({
        login_request_status: 'USED',
        updated_at: new Date().toISOString()
      }).eq('id', codeId);

      const userId = `moliya_user_tg_${tgId}`;
      const { data: userDoc } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      let authSession: any = null;
      try {
        authSession = await createSupabaseAuthSession(
          String(tgId),
          { name: userDoc?.name || '', telegram: userDoc?.telegram || '' }
        );
      } catch (authErr) {
        console.warn('[EXCHANGE-CODE] Warning creating auth session:', authErr);
      }

      return res.status(200).json({
        access_token: authSession?.access_token || null,
        refresh_token: authSession?.refresh_token || null,
        userId,
        sessionToken: userDoc?.session_token || codeDoc.session_token || null,
        onboarding: userDoc?.onboarding || null,
        cards: userDoc?.cards || [],
        transactions: userDoc?.transactions || [],
        isPremium: userDoc?.is_premium || false
      });
    } catch (error: any) {
      console.error('[EXCHANGE-CODE] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  // 3. /api/auth/check-login-request
  if (action === 'check-login-request') {
    const requestId = (req.query.requestId as string) || (req.body && req.body.requestId);
    if (!requestId || typeof requestId !== 'string') {
      return res.status(400).json({ error: 'Missing requestId parameter' });
    }

    const cleanId = requestId.replace(/^req_/, '').trim();

    try {
      const { data: reqDoc, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', `req_${cleanId}`)
        .maybeSingle();

      if (!error && reqDoc) {
        if (reqDoc.login_request_status === 'VERIFIED' && reqDoc.telegram_id && reqDoc.session_token) {
          const userId = `moliya_user_tg_${reqDoc.telegram_id}`;
          const { data: userDoc } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();

          let authSession: any = null;
          try {
            authSession = await createSupabaseAuthSession(
              reqDoc.telegram_id,
              { name: userDoc?.name || '', telegram: userDoc?.telegram || '' }
            );
          } catch (e) {
            console.warn('[CHECK-LOGIN] Warning creating auth session:', e);
          }

          // Mark request as consumed
          await supabase.from('users').update({ login_request_status: 'CONSUMED' }).eq('id', `req_${cleanId}`);

          return res.status(200).json({
            status: 'VERIFIED',
            userId,
            sessionToken: reqDoc.session_token,
            access_token: authSession?.access_token || null,
            refresh_token: authSession?.refresh_token || null,
            onboarding: userDoc?.onboarding || null,
            phone: userDoc?.phone || '',
            cards: userDoc?.cards || [],
            transactions: userDoc?.transactions || []
          });
        }
        return res.status(200).json({ status: reqDoc.login_request_status || 'PENDING' });
      }

      return res.status(200).json({ status: 'PENDING' });
    } catch (error: any) {
      console.error('Error checking login request in Supabase:', error);
      return res.status(200).json({ status: 'PENDING' });
    }
  }

  // 4. /api/auth/create-login-request
  if (action === 'create-login-request') {
    try {
      const { requestId } = req.body || {};
      if (!requestId || typeof requestId !== 'string' || requestId.length < 8) {
        return res.status(400).json({ error: 'Invalid or missing requestId' });
      }

      const cleanId = requestId.replace(/^req_/, '').trim();
      const nowIso = new Date().toISOString();

      await supabase.from('users').upsert({
        id: `req_${cleanId}`,
        login_request_id: cleanId,
        login_request_status: 'PENDING',
        updated_at: nowIso
      }, { onConflict: 'id' });

      return res.status(200).json({ success: true, requestId });
    } catch (error: any) {
      console.error('Error creating login request in Supabase:', error);
      return res.status(200).json({ success: true, requestId: req.body?.requestId || 'fallback' });
    }
  }

  // 5. /api/auth/validate-session
  if (action === 'validate-session') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
      const { sessionToken } = req.body || {};
      if (!sessionToken || typeof sessionToken !== 'string') {
        return res.status(200).json({ valid: false, reason: 'Missing sessionToken' });
      }

      const { data: userDoc, error } = await supabase
        .from('users')
        .select('*')
        .eq('session_token', sessionToken)
        .maybeSingle();

      if (!error && userDoc) {
        // Restriction & Block check
        const isBlocked = Boolean(
          userDoc.is_blocked ||
          userDoc.is_restricted ||
          userDoc.id?.startsWith('restricted_') ||
          userDoc.device_info?.is_blocked ||
          userDoc.device_info?.restricted ||
          userDoc.onboarding?.is_blocked ||
          userDoc.onboarding?.is_restricted
        );

        if (isBlocked) {
          return res.status(200).json({ valid: false, reason: 'ACCOUNT_RESTRICTED', message: "Hisobingiz cheklangan" });
        }

        if (userDoc.session_expires_at && new Date(userDoc.session_expires_at).getTime() < Date.now()) {
          return res.status(200).json({ valid: false, reason: 'Session expired' });
        }

        const tgId = userDoc.telegram_id || userDoc.onboarding?.telegramId;
        let authSession = null;
        if (tgId) {
          authSession = await createSupabaseAuthSession(
            String(tgId),
            { name: userDoc.name || '', telegram: userDoc.telegram || '' }
          );
        }

        return res.status(200).json({
          valid: true,
          userId: userDoc.id,
          access_token: authSession?.access_token || null,
          refresh_token: authSession?.refresh_token || null,
          onboarding: userDoc.onboarding || null,
          cards: userDoc.cards || [],
          transactions: userDoc.transactions || [],
          isPremium: userDoc.is_premium || false
        });
      }

      return res.status(200).json({ valid: false, reason: 'Session not found' });
    } catch (error: any) {
      console.error('Error validating session in Supabase:', error);
      return res.status(200).json({ valid: false, error: error.message });
    }
  }

  return res.status(404).json({ error: 'Auth route not found', action });
}
