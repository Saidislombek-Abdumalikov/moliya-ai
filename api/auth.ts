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

export async function authenticateCaller(req: any, botToken: string): Promise<{
  authenticated: boolean;
  statusCode: number;
  error?: string;
  userId?: string;
  telegramId?: string | null;
  userDoc?: any;
}> {
  const rawHeaderAuth = req.headers?.['authorization'] || req.headers?.['x-session-token'];
  const bearerToken = typeof rawHeaderAuth === 'string' && rawHeaderAuth.startsWith('Bearer ') 
    ? rawHeaderAuth.slice(7).trim() 
    : (typeof rawHeaderAuth === 'string' ? rawHeaderAuth.trim() : null);

  const sessionToken = req.body?.sessionToken || bearerToken || req.query?.sessionToken;
  const initData = req.body?.initData || req.headers?.['x-telegram-init-data'] || req.query?.initData;

  // MODE A: Telegram Mini App Authentication (Cryptographically Verified)
  if (initData && typeof initData === 'string' && initData.trim()) {
    if (!botToken) {
      return { authenticated: false, statusCode: 500, error: 'Server authentication configuration error: Bot token missing' };
    }
    const verification = verifyTelegramInitData(initData, botToken);
    if (!verification.isValid || !verification.user?.id) {
      return { authenticated: false, statusCode: 401, error: 'Unauthorized: Invalid or expired Telegram authentication' };
    }

    const authenticatedTgId = String(verification.user.id);
    const authenticatedUserId = `moliya_user_tg_${authenticatedTgId}`;

    const { data: foundByTg } = await supabase
      .from('users')
      .select('*')
      .or(`id.eq.${authenticatedUserId},telegram_id.eq.${authenticatedTgId}`)
      .maybeSingle();

    return {
      authenticated: true,
      statusCode: 200,
      userId: foundByTg?.id || authenticatedUserId,
      telegramId: authenticatedTgId,
      userDoc: foundByTg
    };
  }

  // MODE C: Supabase Auth Bearer JWT Token
  if (bearerToken && bearerToken.split('.').length === 3) {
    try {
      const { data: authUser, error: authErr } = await supabase.auth.getUser(bearerToken);
      if (!authErr && authUser?.user) {
        const metaTgId = authUser.user.user_metadata?.telegram_id;
        const tgId = metaTgId || (authUser.user.email?.startsWith('tg') ? authUser.user.email.replace(/^tg/, '').replace(/@.*$/, '') : null);
        const authUid = authUser.user.id;

        const orClauses: string[] = [`auth_user_id.eq.${authUid}`];
        if (tgId) {
          orClauses.push(`id.eq.moliya_user_tg_${tgId}`);
          orClauses.push(`telegram_id.eq.${tgId}`);
        }

        const { data: userDoc } = await supabase
          .from('users')
          .select('*')
          .or(orClauses.join(','))
          .maybeSingle();

        if (userDoc) {
          return {
            authenticated: true,
            statusCode: 200,
            userId: userDoc.id,
            telegramId: userDoc.telegram_id || tgId || null,
            userDoc
          };
        }
      }
    } catch (jwtErr) {
      console.warn('[AUTH] Error verifying JWT token:', jwtErr);
    }
  }

  // MODE B: Standalone Web App Session Authentication
  if (sessionToken && typeof sessionToken === 'string' && sessionToken.trim().length >= 16) {
    const cleanSessionToken = sessionToken.trim();
    let userDoc: any = null;

    try {
      // 1. Check in onboarding jsonb
      const { data: obDoc } = await supabase
        .from('users')
        .select('*')
        .contains('onboarding', { session_token: cleanSessionToken })
        .maybeSingle();
      userDoc = obDoc;

      // 2. Check in device_info jsonb
      if (!userDoc) {
        const { data: devDoc } = await supabase
          .from('users')
          .select('*')
          .contains('device_info', { sessionToken: cleanSessionToken })
          .maybeSingle();
        userDoc = devDoc;
      }
      if (!userDoc) {
        const { data: devDoc2 } = await supabase
          .from('users')
          .select('*')
          .contains('device_info', { session_token: cleanSessionToken })
          .maybeSingle();
        userDoc = devDoc2;
      }
    } catch (searchErr) {
      console.warn('[AUTH] Error looking up session token:', searchErr);
    }

    if (!userDoc) {
      return { authenticated: false, statusCode: 401, error: 'Unauthorized: Invalid or expired session' };
    }

    const expiresAt = userDoc.onboarding?.session_expires_at || userDoc.session_expires_at || userDoc.device_info?.session_expires_at;
    if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
      return { authenticated: false, statusCode: 401, error: 'Unauthorized: Session expired' };
    }

    const authenticatedTgId = userDoc.telegram_id || (userDoc.id?.startsWith('moliya_user_tg_') ? userDoc.id.replace('moliya_user_tg_', '') : null);

    return {
      authenticated: true,
      statusCode: 200,
      userId: userDoc.id,
      telegramId: authenticatedTgId,
      userDoc
    };
  }

  return {
    authenticated: false,
    statusCode: 401,
    error: 'Unauthorized: Valid Telegram initData or Web session token required'
  };
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

  const BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();

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
        return res.status(401).json({ error: "Invalid or unverified Telegram authentication data" });
      }

      const tgId = String(tgUser.id);
      const userId = `moliya_user_tg_${tgId}`;

      // 1. Identity Block Guard: Check if Telegram identity is blocked by Admin
      const { data: blockedDoc } = await supabase
        .from('users')
        .select('id, onboarding, device_info')
        .eq('id', `restricted_tg_${tgId}`)
        .maybeSingle();

      if (blockedDoc && blockedDoc.onboarding?.is_blocked !== false) {
        return res.status(403).json({
          error: 'ACCOUNT_RESTRICTED',
          message: "Hisobingiz ma'muriyat tomonidan bloklangan."
        });
      }

      // 2. Canonical User Check & Auto-Creation
      let { data: userDoc } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (userDoc) {
        const isUserBlocked = Boolean(
          userDoc.onboarding?.is_blocked ||
          userDoc.device_info?.is_blocked ||
          userDoc.onboarding?.is_restricted ||
          userDoc.device_info?.restricted
        );

        if (isUserBlocked) {
          return res.status(403).json({
            error: 'ACCOUNT_RESTRICTED',
            message: "Hisobingiz ma'muriyat tomonidan bloklangan."
          });
        }
      } else {
        // Auto-create user record for first-time Telegram Mini App entry
        const nowStr = new Date().toISOString();
        const trialEnd = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
        const tgName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || 'Telegram Foydalanuvchi';
        const tgUsername = tgUser.username ? '@' + tgUser.username : '@moliya_user';

        const newOnboarding = {
          completed: false,
          tour_completed: false,
          language: tgUser.language_code || 'uz',
          name: tgName,
          telegram: tgUsername,
          telegramId: tgId,
          trial_started_at: nowStr,
          trial_ends_at: trialEnd,
          registration_status: 'pending_registration',
          oferta_accepted: false
        };

        const newRecord = {
          id: userId,
          name: tgName,
          telegram: tgUsername,
          telegram_id: tgId,
          phone: null,
          language: tgUser.language_code || 'uz',
          is_premium: true,
          premium_expires_at: trialEnd,
          ai_limit: null,
          ai_query_count: 0,
          platform: 'telegram',
          cards: [],
          transactions: [],
          onboarding: newOnboarding,
          created_at: nowStr,
          updated_at: nowStr
        };

        const { data: createdUser } = await supabase.from('users').upsert(newRecord, {
          onConflict: 'id',
          ignoreDuplicates: true  // SAFETY: Never overwrite existing user data in race conditions
        }).select().single();
        // If insert was ignored (user appeared between check and insert), re-fetch
        if (!createdUser) {
          const { data: refetched } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
          userDoc = refetched || newRecord;
        } else {
          userDoc = createdUser;
        }
      }
      // ── Effective Access Calculation (replaces destructive trial reset) ──
      // Import effectiveAccess inline to avoid circular deps at module level
      const { effectiveAccess } = await import('./_accessHelper.js');
      const access = effectiveAccess(userDoc);

      // Only grant a new 1-day trial if ALL of these are true:
      //   1. User has no premium_expires_at AND no trial_ends_at
      //   2. User is NOT already VIP or Unlimited (admin-granted)
      //   3. User was JUST created (within the last 60 seconds) OR has never had any access set
      const hasAnyExpiry = userDoc?.premium_expires_at || userDoc?.trial_ends_at || userDoc?.onboarding?.trial_ends_at;
      const isAdminGranted = Boolean(userDoc?.unlimited_ai) || (userDoc?.is_premium && !hasAnyExpiry);
      const isNewlyCreated = userDoc?.created_at && (Date.now() - new Date(userDoc.created_at).getTime()) < 60000;

      let isPremium = access.isPremium;

      if (!hasAnyExpiry && !isAdminGranted && isNewlyCreated) {
        // Genuinely new user — grant 1-day trial
        const trialEnd = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
        isPremium = true;
        await supabase.from('users').update({
          is_premium: true,
          premium_expires_at: trialEnd,
          ai_limit: null,
          updated_at: new Date().toISOString()
        }).eq('id', userId);
      }
      // IMPORTANT: We do NOT auto-downgrade here anymore.
      // The effectiveAccess() function handles expiration logic.
      // This prevents destroying admin-granted VIP/Unlimited status.

      const now = new Date();
      const expiresAt = new Date(now.getTime() + 60 * 24 * 3600 * 1000).toISOString();
      const randomHex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
      const sessionToken = 'sess_' + randomHex;

      const tgName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || 'Telegram Foydalanuvchi';
      const tgUsername = tgUser.username ? '@' + tgUser.username : '@moliya_user';

      const hasPhone = Boolean(userDoc?.phone && String(userDoc.phone).replace(/\D/g, '').length >= 9);
      const hasOferta = Boolean(
        userDoc?.onboarding?.oferta_accepted === true ||
        userDoc?.onboarding?.privacy_consent?.accepted === true
      );
      const isRegisteredInDb = Boolean(hasPhone && hasOferta && userDoc?.onboarding?.completed === true);

      const updatedOnboarding = {
        ...(userDoc?.onboarding || {}),
        completed: isRegisteredInDb,
        tour_completed: userDoc?.onboarding?.tour_completed === true,
        language: userDoc?.language || tgUser.language_code || 'uz',
        name: tgName,
        phone: userDoc?.phone || '',
        telegram: tgUsername,
        telegramId: tgId,
        session_token: sessionToken,
        session_expires_at: expiresAt,
        registration_status: isRegisteredInDb ? 'completed' : 'pending_registration'
      };

      await supabase.from('users').update({
        onboarding: updatedOnboarding,
        updated_at: now.toISOString()
      }).eq('id', userId);

      const authSession = await createSupabaseAuthSession(tgId, { name: tgName, telegram: tgUsername });

      if (authSession?.auth_user_id) {
        await supabase.from('users').update({
          auth_user_id: authSession.auth_user_id
        }).eq('id', userId);
      }

      return res.status(200).json({
        userId,
        sessionToken,
        access_token: authSession?.access_token || null,
        refresh_token: authSession?.refresh_token || null,
        onboarding: updatedOnboarding,
        cards: userDoc?.cards || [],
        transactions: userDoc?.transactions || [],
        isPremium: access.isPremium,
        accessLevel: access.level,
        accessLabel: access.label,
        canUseAi: access.canUseAi,
        trialEndsAt: userDoc?.trial_ends_at || userDoc?.premium_expires_at,
        aiLimit: access.aiLimit
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

      const expiresAt = codeDoc.device_info?.sessionExpiresAt || codeDoc.onboarding?.session_expires_at || codeDoc.session_expires_at;
      if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
        await supabase.from('users').delete().eq('id', codeId);
        return res.status(400).json({ error: 'Code expired' });
      }

      const codeStatus = codeDoc.device_info?.status || codeDoc.onboarding?.login_request_status || 'VALID';
      if (codeStatus === 'USED') {
        const updatedAt = new Date(codeDoc.updated_at || codeDoc.created_at || 0).getTime();
        if (Date.now() - updatedAt > 24 * 3600 * 1000) {
          return res.status(400).json({ error: 'Code expired' });
        }
      }

      const tgId = codeDoc.telegram_id || codeDoc.device_info?.telegram_id;
      if (!tgId) {
        return res.status(400).json({ error: 'Invalid code: no telegram_id' });
      }

      // Mark code as USED
      await supabase.from('users').update({
        device_info: { ...(codeDoc.device_info || {}), status: 'USED' },
        onboarding: { ...(codeDoc.onboarding || {}), login_request_status: 'USED' },
        updated_at: new Date().toISOString()
      }).eq('id', codeId);

      const userId = `moliya_user_tg_${tgId}`;
      let { data: userDoc } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      const sessionToken = userDoc?.device_info?.session_token || userDoc?.onboarding?.session_token || codeDoc.device_info?.sessionToken || codeDoc.onboarding?.session_token || ('sess_' + crypto.randomBytes(24).toString('hex'));

      if (!userDoc) {
        const nowStr = new Date().toISOString();
        const trialEnd = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
        const newOnboarding = {
          completed: false,
          tour_completed: false,
          language: 'uz',
          name: 'Telegram Foydalanuvchi',
          telegram: '@moliya_user',
          telegramId: String(tgId),
          trial_started_at: nowStr,
          trial_ends_at: trialEnd,
          registration_status: 'pending_registration',
          oferta_accepted: true,
          session_token: sessionToken,
          session_expires_at: new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString()
        };
        const newRecord = {
          id: userId,
          telegram_id: String(tgId),
          name: 'Telegram Foydalanuvchi',
          platform: 'web_app',
          is_premium: true,
          premium_expires_at: trialEnd,
          device_info: {
            session_token: sessionToken,
            last_exchange_at: nowStr
          },
          onboarding: newOnboarding,
          cards: [],
          transactions: [],
          created_at: nowStr,
          updated_at: nowStr
        };
        await supabase.from('users').upsert(newRecord, { onConflict: 'id' });
        userDoc = newRecord as any;
      }

      let authSession: any = null;
      try {
        authSession = await createSupabaseAuthSession(
          String(tgId),
          { name: userDoc?.name || '', telegram: userDoc?.telegram || '' }
        );
      } catch (authErr) {
        console.warn('[EXCHANGE-CODE] Warning creating auth session:', authErr);
      }

      const userPhone = userDoc?.phone || userDoc?.onboarding?.phone || '';
      const safeOnboarding = {
        ...(userDoc?.onboarding || {}),
        phone: userPhone,
        completed: Boolean(userPhone) || userDoc?.onboarding?.completed === true,
        oferta_accepted: true,
        session_token: sessionToken
      };

      return res.status(200).json({
        access_token: authSession?.access_token || null,
        refresh_token: authSession?.refresh_token || null,
        userId,
        sessionToken,
        phone: userPhone,
        onboarding: safeOnboarding,
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
        const reqStatus = reqDoc.device_info?.status || reqDoc.onboarding?.login_request_status || 'PENDING';
        const sessionToken = reqDoc.device_info?.sessionToken || reqDoc.onboarding?.session_token;
        const tgId = reqDoc.telegram_id || reqDoc.device_info?.verifiedBy;

        if (reqStatus === 'VERIFIED' && tgId && sessionToken) {
          const userId = `moliya_user_tg_${tgId}`;
          const { data: userDoc } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();

          let authSession: any = null;
          try {
            authSession = await createSupabaseAuthSession(
              String(tgId),
              { name: userDoc?.name || '', telegram: userDoc?.telegram || '' }
            );
          } catch (e) {
            console.warn('[CHECK-LOGIN] Warning creating auth session:', e);
          }

          // Mark request as consumed in device_info and onboarding
          await supabase.from('users').update({
            device_info: { ...(reqDoc.device_info || {}), status: 'CONSUMED' },
            onboarding: { ...(reqDoc.onboarding || {}), login_request_status: 'CONSUMED' },
            updated_at: new Date().toISOString()
          }).eq('id', `req_${cleanId}`);

          const userPhone = userDoc?.phone || userDoc?.onboarding?.phone || '';
          const safeOnboarding = {
            ...(userDoc?.onboarding || {}),
            phone: userPhone,
            completed: true,
            oferta_accepted: true,
            session_token: sessionToken
          };

          return res.status(200).json({
            status: 'VERIFIED',
            userId,
            sessionToken,
            access_token: authSession?.access_token || null,
            refresh_token: authSession?.refresh_token || null,
            onboarding: safeOnboarding,
            phone: userPhone,
            cards: userDoc?.cards || [],
            transactions: userDoc?.transactions || []
          });
        }
        return res.status(200).json({ status: reqStatus });
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
      const { requestId, cachedUserId, clientDeviceId } = req.body || {};
      if (!requestId || typeof requestId !== 'string' || requestId.length < 8) {
        return res.status(400).json({ error: 'Invalid or missing requestId' });
      }

      const cleanId = requestId.replace(/^req_/, '').trim();
      const nowIso = new Date().toISOString();
      const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
      const userAgent = req.headers['user-agent'] || '';

      await supabase.from('users').upsert({
        id: `req_${cleanId}`,
        platform: 'login_request',
        device_info: {
          requestId: cleanId,
          status: 'PENDING',
          cachedUserId: cachedUserId || null,
          clientDeviceId: clientDeviceId || null,
          clientIp,
          userAgent,
          createdAt: nowIso
        },
        onboarding: {
          login_request_id: cleanId,
          login_request_status: 'PENDING',
          created_at: nowIso
        },
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

      // Query via JSONB onboarding->>session_token
      let { data: userDoc, error } = await supabase
        .from('users')
        .select('*')
        .eq('onboarding->>session_token', sessionToken)
        .maybeSingle();

      // Fallback: check device_info->>session_token
      if (!userDoc) {
        const { data: altDoc } = await supabase
          .from('users')
          .select('*')
          .eq('device_info->>session_token', sessionToken)
          .maybeSingle();
        if (altDoc) userDoc = altDoc;
      }

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

        const sessionExpiresAt = userDoc.onboarding?.session_expires_at || userDoc.device_info?.session_expires_at;
        if (sessionExpiresAt && new Date(sessionExpiresAt).getTime() < Date.now()) {
          return res.status(200).json({ valid: false, reason: 'Session expired' });
        }

        const tgId = userDoc.telegram_id || userDoc.onboarding?.telegramId;
        let authSession = null;
        if (tgId) {
          try {
            authSession = await createSupabaseAuthSession(
              String(tgId),
              { name: userDoc.name || '', telegram: userDoc.telegram || '' }
            );
          } catch (sessionErr) {
            console.warn('[VALIDATE-SESSION] Warning creating auth session:', sessionErr);
          }
        }

        const userPhone = userDoc.phone || userDoc.onboarding?.phone || '';
        const safeOnboarding = {
          ...(userDoc.onboarding || {}),
          phone: userPhone,
          completed: Boolean(userPhone) || userDoc.onboarding?.completed === true,
          oferta_accepted: true,
          session_token: sessionToken
        };

        return res.status(200).json({
          valid: true,
          userId: userDoc.id,
          phone: userPhone,
          access_token: authSession?.access_token || null,
          refresh_token: authSession?.refresh_token || null,
          onboarding: safeOnboarding,
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

  // 6. /api/auth/delete-account
  if (action === 'delete-account') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
      const rawHeaderAuth = req.headers['authorization'] || req.headers['x-session-token'];
      const bearerToken = typeof rawHeaderAuth === 'string' && rawHeaderAuth.startsWith('Bearer ') 
        ? rawHeaderAuth.slice(7).trim() 
        : (typeof rawHeaderAuth === 'string' ? rawHeaderAuth.trim() : null);

      const sessionToken = req.body?.sessionToken || bearerToken;
      const initData = req.body?.initData || req.headers['x-telegram-init-data'];

      let authenticatedUserId: string | null = null;
      let authenticatedTgId: string | null = null;
      let authenticatedUserDoc: any = null;

      // MODE A: Telegram Mini App Authentication (Cryptographically Verified)
      if (initData && typeof initData === 'string' && initData.trim()) {
        if (!BOT_TOKEN) {
          return res.status(500).json({ error: 'Server authentication configuration error' });
        }
        const verification = verifyTelegramInitData(initData, BOT_TOKEN);
        if (!verification.isValid || !verification.user?.id) {
          return res.status(401).json({ error: 'Unauthorized: Invalid or expired Telegram authentication' });
        }

        authenticatedTgId = String(verification.user.id);
        authenticatedUserId = `moliya_user_tg_${authenticatedTgId}`;

        // Fetch user from Supabase to retrieve canonical ID and message history
        const { data: foundByTg } = await supabase
          .from('users')
          .select('*')
          .or(`id.eq.${authenticatedUserId},telegram_id.eq.${authenticatedTgId}`)
          .maybeSingle();

        authenticatedUserDoc = foundByTg;
        if (authenticatedUserDoc) {
          authenticatedUserId = authenticatedUserDoc.id;
        }

        // IDOR Prevention: Caller cannot delete any account other than their own verified Telegram ID
        if (req.body?.telegramId && String(req.body.telegramId).trim() !== authenticatedTgId) {
          return res.status(403).json({ error: 'Forbidden: You can only delete your own account' });
        }
        if (req.body?.userId && req.body.userId.trim() !== authenticatedUserId && req.body.userId.trim() !== `moliya_user_tg_${authenticatedTgId}`) {
          return res.status(403).json({ error: 'Forbidden: You can only delete your own account' });
        }
      }
      // MODE B: Standalone Web App Session Authentication
      else if (sessionToken && typeof sessionToken === 'string' && sessionToken.trim().length >= 16) {
        const cleanSessionToken = sessionToken.trim();
        let { data: userDoc } = await supabase
          .from('users')
          .select('*')
          .eq('onboarding->>session_token', cleanSessionToken)
          .maybeSingle();

        if (!userDoc) {
          const { data: altDoc } = await supabase
            .from('users')
            .select('*')
            .eq('device_info->>session_token', cleanSessionToken)
            .maybeSingle();
          userDoc = altDoc;
        }

        if (!userDoc) {
          const { data: colDoc } = await supabase
            .from('users')
            .select('*')
            .eq('session_token', cleanSessionToken)
            .maybeSingle();
          userDoc = colDoc;
        }

        if (!userDoc) {
          return res.status(401).json({ error: 'Unauthorized: Invalid or expired session' });
        }

        // Check session expiration
        const expiresAt = userDoc.onboarding?.session_expires_at || userDoc.session_expires_at || userDoc.device_info?.session_expires_at;
        if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
          return res.status(401).json({ error: 'Unauthorized: Session expired' });
        }

        authenticatedUserDoc = userDoc;
        authenticatedUserId = userDoc.id;
        authenticatedTgId = userDoc.telegram_id || (userDoc.id?.startsWith('moliya_user_tg_') ? userDoc.id.replace('moliya_user_tg_', '') : null);

        // IDOR Prevention: Caller cannot delete any account other than their own verified session user
        if (req.body?.userId && req.body.userId.trim() !== authenticatedUserId) {
          return res.status(403).json({ error: 'Forbidden: You can only delete your own account' });
        }
        if (req.body?.telegramId) {
          const reqTg = String(req.body.telegramId).trim();
          if (!authenticatedTgId || reqTg !== authenticatedTgId) {
            return res.status(403).json({ error: 'Forbidden: You can only delete your own account' });
          }
        }
      }
      // MODE C: Missing or unauthenticated -> FAIL CLOSED
      else {
        return res.status(401).json({ 
          error: 'Unauthorized: Valid Telegram initData or Web session token required to delete account' 
        });
      }

      const canonicalUserId = authenticatedUserId;
      const targetTgId = authenticatedTgId;
      const userDoc = authenticatedUserDoc;

      // Collect any message IDs stored in onboarding.bot_messages
      const botMessages: any[] = Array.isArray(userDoc?.onboarding?.bot_messages) ? userDoc.onboarding.bot_messages : [];
      const storedIds: number[] = [];
      for (const m of botMessages) {
        const numId = Number(m.message_id || m.messageId);
        if (Number.isInteger(numId) && numId > 0 && !storedIds.includes(numId)) {
          storedIds.push(numId);
        }
      }

      const lastMsgId = Number(userDoc?.onboarding?.last_message_id) || 0;

      // 1. Purge Telegram Bot Chat History if targetTgId and BOT_TOKEN exist
      let chatPurged = false;
      const tgDetails = { attempted: 0, deleted: 0, alreadyAbsent: 0, notDeletable: 0, failed: 0 };

      if (targetTgId && targetTgId !== '—' && BOT_TOKEN) {
        try {
          const idsToDelete = new Set<number>();
          storedIds.forEach(id => idsToDelete.add(id));

          // Probe to discover active topMsgId
          let topMsgId = lastMsgId && lastMsgId > 0 ? lastMsgId : null;
          try {
            const probeRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: String(targetTgId),
                text: '·',
                disable_notification: true
              })
            });
            const probeData = await probeRes.json();
            if (probeData.ok && probeData.result?.message_id) {
              const probeId = probeData.result.message_id;
              topMsgId = Math.max(topMsgId || 0, probeId);
              idsToDelete.add(probeId);
            }
          } catch (probeErr) {
            console.warn('[DELETE_ACCOUNT] Probe error:', probeErr);
          }

          // Sweep backwards up to 150 messages from topMsgId
          if (topMsgId && topMsgId > 0) {
            const minId = Math.max(1, topMsgId - 150);
            for (let m = topMsgId; m >= minId; m--) {
              idsToDelete.add(m);
            }
          }

          const idList = Array.from(idsToDelete).sort((a, b) => b - a);
          tgDetails.attempted = idList.length;

          // Process in batches of up to 100 via deleteMessages + individual fallback
          for (let i = 0; i < idList.length; i += 100) {
            const chunk = idList.slice(i, i + 100);
            try {
              const batchRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: String(targetTgId), message_ids: chunk })
              });
              const batchData = await batchRes.json();
              if (batchData.ok) {
                tgDetails.deleted += chunk.length;
              } else {
                // Fallback to individual deleteMessage
                const indResults = await Promise.allSettled(
                  chunk.map(async (msgId) => {
                    const sRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ chat_id: String(targetTgId), message_id: msgId })
                    });
                    return await sRes.json();
                  })
                );

                indResults.forEach((r) => {
                  if (r.status === 'fulfilled') {
                    const d = r.value;
                    if (d?.ok) {
                      tgDetails.deleted++;
                    } else {
                      const desc = (d?.description || '').toLowerCase();
                      if (desc.includes('not found')) {
                        tgDetails.alreadyAbsent++;
                      } else if (desc.includes("can't be deleted") || desc.includes('cant be deleted')) {
                        tgDetails.notDeletable++;
                      } else {
                        tgDetails.failed++;
                      }
                    }
                  } else {
                    tgDetails.failed++;
                  }
                });
              }
            } catch {
              tgDetails.failed += chunk.length;
            }

            if (i + 100 < idList.length) {
              await new Promise(r => setTimeout(r, 40));
            }
          }

          // Permanently wipe client keyboard state
          try {
            const kbRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: String(targetTgId),
                text: '🗑️',
                disable_notification: true,
                reply_markup: { remove_keyboard: true }
              })
            });
            const kbData = await kbRes.json();
            if (kbData.ok && kbData.result?.message_id) {
              await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: String(targetTgId), message_id: kbData.result.message_id })
              }).catch(() => {});
            }
          } catch {}

          chatPurged = true;
        } catch (tgErr) {
          console.warn('[DELETE_ACCOUNT] Telegram purge error:', tgErr);
        }
      }

      // 2. Delete user row from Supabase
      if (canonicalUserId) {
        await supabase.from('users').delete().eq('id', canonicalUserId);
      }
      if (targetTgId) {
        // Also clean up any associated temporary auth docs
        await supabase.from('users').delete().or(`id.eq.moliya_user_tg_${targetTgId},id.eq.req_${targetTgId},id.eq.exchange_${targetTgId}`);
      }

      return res.status(200).json({
        success: true,
        userDeleted: true,
        chatPurged,
        userId: canonicalUserId,
        telegramId: targetTgId,
        details: tgDetails
      });
    } catch (error: any) {
      console.error('[DELETE_ACCOUNT] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  // 7. /api/auth/sync-data (Authenticated User Profile & Financial Data Synchronization)
  if (action === 'sync-data') {
    if (req.method !== 'GET' && req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
      const auth = await authenticateCaller(req, BOT_TOKEN);
      if (!auth.authenticated || !auth.userId) {
        return res.status(auth.statusCode).json({ error: auth.error || 'Unauthorized' });
      }

      const targetUserId = auth.userId;

      // GET: Read own user profile, cards, transactions
      if (req.method === 'GET') {
        const { data: userDoc, error: fetchErr } = await supabase
          .from('users')
          .select('id, name, phone, telegram, telegram_id, language, platform, is_premium, premium_expires_at, cards, transactions, onboarding, created_at, updated_at')
          .eq('id', targetUserId)
          .maybeSingle();

        if (fetchErr) {
          return res.status(500).json({ error: 'Database error fetching user data', details: fetchErr.message });
        }

        return res.status(200).json({
          success: true,
          user: userDoc || auth.userDoc || { id: targetUserId, cards: [], transactions: [] }
        });
      }

      // POST: Update own cards, transactions, or onboarding
      if (req.method === 'POST') {
        // IDOR Check: Ensure body.userId matches auth.userId if specified
        if (req.body?.userId && req.body.userId.trim() !== targetUserId && req.body.userId.trim() !== `moliya_user_tg_${auth.telegramId}`) {
          return res.status(403).json({ error: 'Forbidden: You can only update your own user data' });
        }

        const nowIso = new Date().toISOString();
        const updatePayload: any = { updated_at: nowIso };

        // 1. Transactions update (if provided)
        if (req.body?.transactions !== undefined) {
          if (!Array.isArray(req.body.transactions)) {
            return res.status(400).json({ error: 'transactions must be an array' });
          }
          updatePayload.transactions = req.body.transactions;
        }

        // 2. Cards update (if provided)
        if (req.body?.cards !== undefined) {
          if (!Array.isArray(req.body.cards)) {
            return res.status(400).json({ error: 'cards must be an array' });
          }
          updatePayload.cards = req.body.cards;
        }

        // 3. has_sample_data (stored safely in onboarding jsonb)
        if (req.body?.has_sample_data !== undefined) {
          const currOb = updatePayload.onboarding || auth.userDoc?.onboarding || {};
          updatePayload.onboarding = {
            ...currOb,
            has_sample_data: Boolean(req.body.has_sample_data)
          };
        }

        // 4. Safe Onboarding merge (if provided)
        // STRICT SECURITY GUARD: Strip all privileged fields: is_premium, premium_expires_at, is_blocked, ai_limit, ai_query_count
        if (req.body?.onboarding && typeof req.body.onboarding === 'object') {
          const existingOb = auth.userDoc?.onboarding || {};
          const incomingOb = req.body.onboarding;
          
          const safeMergedOb = {
            ...existingOb,
            ...incomingOb,
            // Force immutable / privileged fields to maintain original server values
            is_premium: auth.userDoc?.is_premium ?? existingOb.is_premium ?? false,
            is_vip: auth.userDoc?.is_premium ?? existingOb.is_vip ?? false,
            premium_expires_at: auth.userDoc?.premium_expires_at ?? existingOb.premium_expires_at ?? null,
            is_blocked: existingOb.is_blocked ?? false,
            ai_limit: auth.userDoc?.ai_limit ?? existingOb.ai_limit,
            ai_query_count: auth.userDoc?.ai_query_count ?? existingOb.ai_query_count ?? 0
          };
          updatePayload.onboarding = safeMergedOb;
          if (incomingOb.name) updatePayload.name = incomingOb.name;
          if (incomingOb.language) updatePayload.language = incomingOb.language;
        }

        // Perform update via service role (bypassing RLS safely on server)
        const { data: updatedDoc, error: updateErr } = await supabase
          .from('users')
          .update(updatePayload)
          .eq('id', targetUserId)
          .select('id, name, phone, telegram, telegram_id, language, is_premium, premium_expires_at, cards, transactions, onboarding, updated_at')
          .maybeSingle();

        if (updateErr) {
          console.error('[SYNC_DATA] Update error:', updateErr);
          return res.status(500).json({ error: 'Failed to update user data', details: updateErr.message });
        }

        return res.status(200).json({
          success: true,
          user: updatedDoc
        });
      }
    } catch (e: any) {
      console.error('[SYNC_DATA] Handler error:', e);
      return res.status(500).json({ error: e.message });
    }
  }

  // 8. /api/auth/wipe-data (Authenticated User Self-Wipe)
  if (action === 'wipe-data') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
      const auth = await authenticateCaller(req, BOT_TOKEN);
      if (!auth.authenticated || !auth.userId) {
        return res.status(auth.statusCode).json({ error: auth.error || 'Unauthorized' });
      }

      const targetUserId = auth.userId;
      if (req.body?.userId && req.body.userId.trim() !== targetUserId && req.body.userId.trim() !== `moliya_user_tg_${auth.telegramId}`) {
        return res.status(403).json({ error: 'Forbidden: You can only wipe your own financial data' });
      }

      const nowIso = new Date().toISOString();
      const { error: wipeErr } = await supabase
        .from('users')
        .update({
          transactions: [],
          cards: [],
          updated_at: nowIso
        })
        .eq('id', targetUserId);

      if (wipeErr) {
        return res.status(500).json({ error: 'Failed to wipe financial data', details: wipeErr.message });
      }

      return res.status(200).json({ success: true, wiped: true, userId: targetUserId });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(404).json({ error: 'Auth route not found', action });
}
