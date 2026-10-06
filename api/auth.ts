import { effectiveAccess } from './_accessHelper.js';
import { cleanPlannedPayments } from '../shared/plannedPayments.js';
import { effectiveTrialEnd } from '../shared/registrationTrial.js';
import {userNotifications} from './services/_notificationService.js';
import { updateProfileSnapshot } from './services/_profileWriteService.js';
import { activeSessionToken } from './_sessionChoice.js';
import { publicFinancialError } from './_apiErrors.js';
import { safeWarn, safeError } from './_logger.js';
import {mutateSessionFinancialData} from './services/_financialDataService.js';
import { accountDenied, eligibleUser, verifiedPhone, acceptedConsent, publicOnboarding, safePreferences } from './_userPolicy.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { supabase } from './_supabaseClient.js';
import { createSupabaseAuthSession, isValidPhoneNumber } from './_authHelper.js';
import { applySecurityHeaders } from './_securityHeaders.js';
import { handleCors } from './_cors.js';
import { applyRateLimit } from './_rateLimiter.js';
import { loadDefaultAiQuota } from './_aiQuotaSettings.js';
import { DEFAULT_OFERTA_TEXT, DEFAULT_PRIVACY_POLICY_TEXT } from './_legalDocuments.js';

export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds: number = 86400
): { isValid: boolean; user?: any; error?: string } {
  if (!botToken || !initData || typeof initData !== 'string') {
    return { isValid: false, error: 'MISSING_INIT_DATA_OR_TOKEN' };
  }
  try {
    const params = new URLSearchParams(initData);
    const keysSeen = new Set<string>();
    for (const key of params.keys()) {
      if (keysSeen.has(key)) return {isValid:false,error:'DUPLICATE_AUTH_FIELD'};
      keysSeen.add(key);
    }
    const hash = params.get("hash");
    if (!hash || !/^[a-f0-9]{64}$/.test(hash)) {
      return { isValid: false, error: 'INVALID_OR_MISSING_HASH' };
    }

    // Enforce auth_date freshness (replay defense)
    const authDateStr = params.get("auth_date");
    if (!authDateStr) {
      return { isValid: false, error: 'MISSING_AUTH_DATE' };
    }
    if (!/^[0-9]+$/.test(authDateStr)) return {isValid:false,error:'MALFORMED_AUTH_DATE'};
    const authDate = Number(authDateStr);
    if (!Number.isSafeInteger(authDate) || authDate <= 0) {
      return { isValid: false, error: 'MALFORMED_AUTH_DATE' };
    }
    const nowSec = Math.floor(Date.now() / 1000);
    // Allow up to 300 seconds (5 minutes) of clock skew in the future
    if (authDate > nowSec + 300) {
      return { isValid: false, error: 'FUTURE_AUTH_DATE' };
    }
    // Reject stale data older than maxAgeSeconds (default 24h)
    if (nowSec - authDate > maxAgeSeconds) {
      return { isValid: false, error: 'EXPIRED_AUTH_DATE' };
    }

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

    const computedBuf = Buffer.from(computedHash, 'utf8');
    const hashBuf = Buffer.from(hash, 'utf8');

    if (computedBuf.length !== hashBuf.length || !crypto.timingSafeEqual(computedBuf, hashBuf)) {
      return { isValid: false, error: 'HASH_MISMATCH' };
    }

    let user: Record<string, any> | null = null;
    const userJson = params.get("user");
    if (userJson) {
      user = JSON.parse(userJson);
      if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) {
        return { isValid: false, error: 'INVALID_USER_OBJECT' };
      }
    }
    if (!user) return {isValid:false,error:'MISSING_USER'};
    return { isValid: true, user };
  } catch (e) {
    return { isValid: false, error: 'VERIFICATION_EXCEPTION' };
  }
}

export async function authenticateCaller(req: any, botToken: string): Promise<any> {
  const fail = (statusCode: number, error: string) => ({authenticated:false,statusCode,error});
  const raw = req.headers?.authorization || req.headers?.['x-session-token'];
  const token = req.body?.sessionToken || (typeof raw === 'string' ? raw.replace(/^Bearer /, '').trim() : '');
  const initData = req.body?.initData || req.headers?.['x-telegram-init-data'];
  try {
    let userDoc: any = null;
    if (token) {
      if (typeof token !== 'string' || !/^sess_[a-zA-Z0-9_-]{16,128}$/.test(token)) return fail(401,'INVALID_SESSION');
      // The current canonical token is the sole credential. Legacy device_info
      // copies must not keep an old login valid after a newer session is issued.
      const {data,error} = await supabase.from('users').select('*')
        .eq('onboarding->>session_token',token).like('id','moliya_user_tg_%').maybeSingle();
      if(error) return fail(503,'AUTH_STORE_UNAVAILABLE');
      userDoc=data;
      if(!userDoc) return fail(401,'INVALID_SESSION');
      const expiry=Date.parse(userDoc.onboarding?.session_expires_at || '');
      if(!Number.isFinite(expiry) || expiry<=Date.now()) return fail(401,'SESSION_EXPIRED');
    } else if (initData && req.allowTelegramBootstrap === true) {
      const check=verifyTelegramInitData(initData,botToken);
      if(!check.isValid || !check.user?.id) return fail(401,'INVALID_TELEGRAM_AUTH');
      const {data,error}=await supabase.from('users').select('*').eq('id','moliya_user_tg_'+String(check.user.id)).maybeSingle();
      if(error) return fail(503,'AUTH_STORE_UNAVAILABLE');
      userDoc=data;
    } else return fail(401,'SESSION_REQUIRED');
    if(accountDenied(userDoc)) return fail(403,'ACCOUNT_RESTRICTED');
    const {data:restricted,error}=await supabase.from('users').select('onboarding').eq('id','restricted_tg_'+userDoc.telegram_id).maybeSingle();
    if(error) return fail(503,'AUTH_STORE_UNAVAILABLE');
    if(restricted && restricted.onboarding?.is_blocked!==false) return fail(403,'ACCOUNT_RESTRICTED');
    return {authenticated:true,statusCode:200,userId:userDoc.id,telegramId:String(userDoc.telegram_id),userDoc,sessionToken:token || null};
  } catch { return fail(503,'AUTH_STORE_UNAVAILABLE'); }
}

export async function requireEligibleCaller(req:any,res:any) {
  const auth=await authenticateCaller(req,(process.env.TELEGRAM_BOT_TOKEN || '').trim());
  if(!auth.authenticated) {res.status(auth.statusCode).json({error:auth.error});return null;}
  if(!eligibleUser(auth.userDoc)) {res.status(403).json({error:'BOT_VERIFICATION_REQUIRED'});return null;}
  return auth;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applySecurityHeaders(res);

  // 1. Whitelisted Origin CORS (No wildcard '*')
  const corsHandled = handleCors(req, res);
  if (corsHandled) return;

  // 2. Sliding-Window Rate Limiter (30 req/min for auth exchanges/polling)


  // Extract action from query (via vercel rewrite ?action=...) or URL path
  let action = (req.query.action as string) || '';
  if (!action && req.url) {
    const cleanUrl = req.url.split('?')[0];
    action = cleanUrl.replace(/^\/api\/auth\/?/, '').trim();
  }

  const tier = action === 'check-login-request' ? 'auth_poll' : ['sync-data','logout','wipe-data','notifications','legal','debts'].includes(action) ? 'general' : 'auth_exchange';
  if (!(await applyRateLimit(req,res,tier))) return;

  const BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();

  // Public legal text is readable before Telegram consent; only legal fields
  // are exposed from the server-owned system row.
  if (action === 'legal') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    try {
      const { data, error } = await supabase.from('users').select('onboarding')
        .eq('id', 'system_app_settings').maybeSingle();
      if (error) return res.status(503).json({ error: 'LEGAL_TEXT_UNAVAILABLE' });
      res.setHeader('Cache-Control', 'public, max-age=30');
      return res.status(200).json({ success: true,
        oferta_text: typeof data?.onboarding?.oferta_text === 'string' && data.onboarding.oferta_text.trim()
          ? data.onboarding.oferta_text.trim() : DEFAULT_OFERTA_TEXT,
        privacy_policy: typeof data?.onboarding?.privacy_policy === 'string' && data.onboarding.privacy_policy.trim()
          ? data.onboarding.privacy_policy.trim() : DEFAULT_PRIVACY_POLICY_TEXT });
    } catch { return res.status(503).json({ error: 'LEGAL_TEXT_UNAVAILABLE' }); }
  }

  if(action==='debts') {
    if(req.method!=='POST')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
    const caller=await requireEligibleCaller(req,res);if(!caller)return;
    const {txId,operation,payload,expected}=req.body||{};
    if(typeof txId!=='string'||txId.length>200||!expected||typeof expected!=='object'||Array.isArray(expected)||!['pay','edit','dismiss'].includes(operation))return res.status(400).json({error:'INVALID_DEBT_ACTION'});
    const {data,error}=await supabase.rpc('moliya_debt_action',{p_user_id:caller.userId,p_session_token:caller.sessionToken,p_tx_id:txId,p_action:operation,p_payload:payload||{},p_expected:expected});
    if(error||!data)return res.status(503).json({error:'DEBT_STORE_UNAVAILABLE'});
    return res.status(data.success?200:data.statusCode||400).json(data);
  }

  if(action==='notifications') {
    res.setHeader('Cache-Control','private, no-store');
    if(req.method!=='GET')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
    const caller=await requireEligibleCaller(req,res);if(!caller)return;
    const platform=req.query.platform==='telegram'?'telegram':'web';
    try{return res.status(200).json(await userNotifications(caller.userDoc,platform));}
    catch{return res.status(503).json({error:'NOTIFICATIONS_UNAVAILABLE'});}
  }

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
      const { data: blockedDoc, error: blockedError } = await supabase
        .from('users')
        .select('id, onboarding, device_info')
        .eq('id', `restricted_tg_${tgId}`)
        .maybeSingle();

      if(blockedError) return res.status(503).json({error:'AUTH_STORE_UNAVAILABLE'});
      if (blockedDoc && blockedDoc.onboarding?.is_blocked !== false) {
        return res.status(403).json({
          error: 'ACCOUNT_RESTRICTED',
          message: "Hisobingiz ma'muriyat tomonidan bloklangan."
        });
      }

      // 2. Canonical User Check & Auto-Creation
      let { data: userDoc, error: identityError } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
      if(identityError) return res.status(503).json({error:'AUTH_STORE_UNAVAILABLE'});

      if (userDoc) {
        if(accountDenied(userDoc)) return res.status(403).json({error:'ACCOUNT_RESTRICTED'});
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
          trial_started_at: null,
          trial_ends_at: null,
          registration_status: 'unverified',
          oferta_accepted: false
        };

        const newRecord = {
          id: userId,
          name: tgName,
          telegram: tgUsername,
          telegram_id: tgId,
          phone: null,
          language: tgUser.language_code || 'uz',
          is_premium: false,
          premium_expires_at: null,
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
          const { data: refetched } = await supabase.from('users').select('*').eq('id',userId).maybeSingle();
          userDoc = refetched || newRecord;
        } else {
          userDoc = createdUser;
        }
      }

      // Check if user has completed phone registration via Telegram Bot
      const hasPhone = verifiedPhone(userDoc);

      // ── Effective Access Calculation (replaces destructive trial reset) ──
      // Import effectiveAccess inline to avoid circular deps at module level
      const { effectiveAccess } = await import('./_accessHelper.js');
      const access = effectiveAccess(userDoc, await loadDefaultAiQuota());

      const isPremium = hasPhone ? access.isPremium : false;

      const now = new Date();
      const expiresAt = new Date(now.getTime() + 60 * 24 * 3600 * 1000).toISOString();
      const sessionToken = activeSessionToken(userDoc.onboarding,now.getTime())
        || 'sess_' + crypto.randomBytes(32).toString('hex');

      const tgName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || 'Telegram Foydalanuvchi';
      const tgUsername = tgUser.username ? '@' + tgUser.username : '@moliya_user';

      const hasOferta = acceptedConsent(userDoc);
      const isRegisteredInDb = eligibleUser(userDoc);

      const updatedOnboarding = {
        ...(userDoc?.onboarding || {}),
        completed: isRegisteredInDb,
        tour_completed: userDoc?.onboarding?.tour_completed === true,
        language: userDoc?.language || tgUser.language_code || 'uz',
        name: tgName,
        phone: userDoc?.phone || userDoc?.onboarding?.phone || '',
        telegram: tgUsername,
        telegramId: tgId,
        session_token: sessionToken,
        session_expires_at: expiresAt,
        registration_status: isRegisteredInDb ? 'completed' : (hasPhone ? 'phone_verified' : (hasOferta ? 'oferta_accepted' : 'unverified'))
      };

      const {error:sessionSaveError}=await updateProfileSnapshot(userId, userDoc, {
        onboarding: updatedOnboarding,
        updated_at: now.toISOString()
      });

      if(sessionSaveError) return res.status(503).json({error:'AUTH_STORE_UNAVAILABLE'});
      const authSession: any = null;

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
        isVerified: isRegisteredInDb,
        requiresBotVerification: !isRegisteredInDb,
        onboarding: publicOnboarding({...userDoc,onboarding:updatedOnboarding}),
        cards: isRegisteredInDb ? (userDoc?.cards || []) : [],
        transactions: isRegisteredInDb ? (userDoc?.transactions || []) : [],
        isPremium,
        premiumExpiresAt: userDoc?.premium_expires_at || null,
        unlimitedAi: userDoc?.unlimited_ai || false,
        accessLevel: isRegisteredInDb ? access.level : 'unverified',
        accessLabel: isRegisteredInDb ? access.label : 'Tasdiqlanmagan',
        canUseAi: isRegisteredInDb ? access.canUseAi : false,
        trialEndsAt: isRegisteredInDb ? effectiveTrialEnd(userDoc) : null,
        aiLimit: isRegisteredInDb ? access.aiLimit : 0
      });
    } catch (error: any) {
      safeError('Error in auth telegram:', error);
      return res.status(500).json({ error: 'AUTHENTICATION_FAILED' });
    }
  }

  // 2. /api/auth/exchange-code
  if (action === 'exchange-code') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
      const { code } = req.body || {};
      if (!code || typeof code !== 'string' || ! /^[a-zA-Z0-9_-]{16,128}$/.test(code)) {
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
      if (!Number.isFinite(Date.parse(expiresAt || '')) || Date.parse(expiresAt) <= Date.now()) {
        await supabase.from('users').delete().eq('id', codeId);
        return res.status(400).json({ error: 'Code expired' });
      }

      const codeStatus = codeDoc.device_info?.status || codeDoc.onboarding?.login_request_status || 'VALID';
      if (codeStatus !== 'VALID') {
        return res.status(400).json({ error: 'Code already used' });
      }

      const tgId = codeDoc.telegram_id || codeDoc.device_info?.telegram_id;
      if (!tgId) {
        return res.status(400).json({ error: 'Invalid code: no telegram_id' });
      }

      // Concurrency Defense: Atomically consume code via conditional update (prevents TOCTOU race)
      const { data: consumedRows, error: consumeErr } = await supabase
        .from('users')
        .update({
          device_info: { ...(codeDoc.device_info || {}), status: 'USED' },
          onboarding: { ...(codeDoc.onboarding || {}), login_request_status: 'USED' },
          updated_at: new Date().toISOString()
        })
        .eq('id', codeId)
        .eq('device_info->>status', 'VALID')
        .select('*');

      if (consumeErr || !consumedRows || consumedRows.length === 0) {
        return res.status(400).json({ error: 'Code already used' });
      }

      const userId = `moliya_user_tg_${tgId}`;
      const { data: userDoc, error: userError } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
      if(userError) return res.status(503).json({error:'AUTH_STORE_UNAVAILABLE'});
      if(accountDenied(userDoc)) return res.status(403).json({error:'ACCOUNT_RESTRICTED'});
      const issuedAt = Date.parse(codeDoc.updated_at || '');
      const revokedAt = Date.parse(userDoc.device_info?.session_revoked_at || '');
      if (!Number.isFinite(issuedAt) || (Number.isFinite(revokedAt) && issuedAt <= revokedAt)) {
        return res.status(400).json({error:'Code expired'});
      }
      const sessionToken = 'sess_' + crypto.randomBytes(24).toString('hex');
      const {error:sessionError} = await updateProfileSnapshot(userId, userDoc, {
        onboarding:{...userDoc.onboarding,session_token:sessionToken,session_expires_at:new Date(Date.now()+60*24*3600*1000).toISOString()},
        device_info:{...userDoc.device_info,session_token:sessionToken},updated_at:new Date().toISOString()
      });
      if(sessionError) return res.status(503).json({error:'AUTH_STORE_UNAVAILABLE'});

      let authSession: any = null;
      try {
        authSession = null;
      } catch (authErr) {
        safeWarn('[EXCHANGE-CODE] Warning creating auth session:', authErr);
      }

      const userPhone = userDoc?.phone || userDoc?.onboarding?.phone || '';
      const hasPhone = verifiedPhone(userDoc);
      const hasOferta = acceptedConsent(userDoc);
      const isRegisteredInDb = eligibleUser(userDoc);
      const safeOnboarding = {
        ...(userDoc?.onboarding || {}),
        phone: userPhone,
        completed: isRegisteredInDb,
        oferta_accepted: hasOferta,
        session_token: sessionToken
      };

      return res.status(200).json({
        access_token: authSession?.access_token || null,
        refresh_token: authSession?.refresh_token || null,
        userId,
        sessionToken,
        phone: userPhone,
        onboarding: publicOnboarding(userDoc),
        cards: isRegisteredInDb ? (userDoc?.cards || []) : [],
        transactions: isRegisteredInDb ? (userDoc?.transactions || []) : [],
        isPremium: effectiveAccess(userDoc).isPremium,
        accessLevel: effectiveAccess(userDoc).level,
        premiumExpiresAt: userDoc?.premium_expires_at || null,
        trialEndsAt: effectiveTrialEnd(userDoc),
        unlimitedAi: userDoc?.unlimited_ai || false
      });
    } catch (error: any) {
      safeError('[EXCHANGE-CODE] Error:', error);
      return res.status(500).json({ error: 'AUTHENTICATION_FAILED' });
    }
  }

  // 3. /api/auth/check-login-request
  if (action === 'check-login-request') {
    const requestId = (req.query.requestId as string) || (req.body && req.body.requestId);
    if (!requestId || typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(requestId)) {
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
        // Enforce 5-minute expiration window on login requests
        const createdAt = reqDoc.device_info?.createdAt || reqDoc.created_at;
        if (!Number.isFinite(Date.parse(createdAt || '')) || Date.now() - Date.parse(createdAt) > 5 * 60 * 1000) {
          return res.status(200).json({ status: 'EXPIRED' });
        }

        const reqStatus = reqDoc.device_info?.status || reqDoc.onboarding?.login_request_status || 'PENDING';
        const sessionToken = reqDoc.device_info?.sessionToken || reqDoc.onboarding?.session_token;
        const tgId = reqDoc.telegram_id || reqDoc.device_info?.verifiedBy;

        if (reqStatus === 'VERIFIED' && tgId && sessionToken) {
          const userId = `moliya_user_tg_${tgId}`;
          // A previously verified request is not authority after logout or a newer login.
          const current = await authenticateCaller({headers:{authorization:'Bearer '+sessionToken}}, BOT_TOKEN);
          if (!current.authenticated || current.userId !== userId || !eligibleUser(current.userDoc)) {
            return res.status(200).json({status:'EXPIRED'});
          }
          const userDoc = current.userDoc;

          let authSession: any = null;
          try {
            authSession = null;
          } catch (e) {
            safeWarn('[CHECK-LOGIN] Warning creating auth session:', e);
          }

          // Atomically mark request as consumed in device_info and onboarding
          const { data: consumedReq } = await supabase
            .from('users')
            .update({
              device_info: { ...(reqDoc.device_info || {}), status: 'CONSUMED' },
              onboarding: { ...(reqDoc.onboarding || {}), login_request_status: 'CONSUMED' },
              updated_at: new Date().toISOString()
            })
            .eq('id', `req_${cleanId}`)
            .neq('device_info->>status', 'CONSUMED')
            .select('*');

          if (!consumedReq || consumedReq.length === 0) {
            return res.status(200).json({ status: 'CONSUMED' });
          }

          const userPhone = userDoc?.phone || userDoc?.onboarding?.phone || '';
          const hasPhone = verifiedPhone(userDoc);
          const hasOferta = acceptedConsent(userDoc);
          const isRegisteredInDb = eligibleUser(userDoc);
          const safeOnboarding = {
            ...(userDoc?.onboarding || {}),
            phone: userPhone,
            completed: isRegisteredInDb,
            oferta_accepted: hasOferta,
            session_token: sessionToken
          };

          return res.status(200).json({
            status: 'VERIFIED',
            isPremium: effectiveAccess(userDoc).isPremium,
            accessLevel: effectiveAccess(userDoc).level,
            premiumExpiresAt: userDoc?.premium_expires_at || null,
        trialEndsAt: effectiveTrialEnd(userDoc),
            unlimitedAi: userDoc?.unlimited_ai || false,
            userId,
            sessionToken,
            access_token: authSession?.access_token || null,
            refresh_token: authSession?.refresh_token || null,
            onboarding: publicOnboarding(userDoc),
            phone: userPhone,
            cards: isRegisteredInDb ? (userDoc?.cards || []) : [],
            transactions: isRegisteredInDb ? (userDoc?.transactions || []) : []
          });
        }
        return res.status(200).json({ status: reqStatus });
      }

      return res.status(200).json({ status: 'PENDING' });
    } catch (error: any) {
      safeError('Error checking login request in Supabase:', error);
      return res.status(200).json({ status: 'PENDING' });
    }
  }

  // 4. /api/auth/create-login-request
  if (action === 'cancel-login-request') {
    if (req.method !== 'POST') return res.status(405).json({error:'Method Not Allowed'});
    const requestId = req.body?.requestId;
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(requestId))
      return res.status(400).json({error:'INVALID_REQUEST_ID'});
    const cleanId=requestId.replace(/^req_/,'');
    const {data,error}=await supabase.from('users').update({
      device_info: {requestId:cleanId,status:'CANCELLED'},
      onboarding: {login_request_id:cleanId,login_request_status:'CANCELLED'},
      updated_at:new Date().toISOString()
    }).eq('id',`req_${cleanId}`).eq('device_info->>status','PENDING').select('id');
    if(error) return res.status(503).json({error:'LOGIN_REQUEST_UNAVAILABLE'});
    if(!data?.length) return res.status(409).json({error:'LOGIN_REQUEST_ALREADY_PROCESSED'});
    return res.status(200).json({success:true});
  }

  // 5. /api/auth/create-login-request
  if (action === 'create-login-request') {
    if(req.method!=='POST') return res.status(405).json({error:'Method Not Allowed'});
    try {
      const { requestId, cachedUserId, clientDeviceId } = req.body || {};
      if (!requestId || typeof requestId !== 'string' || ! /^[a-zA-Z0-9_-]{16,128}$/.test(requestId)) {
        return res.status(400).json({ error: 'Invalid or missing requestId' });
      }

      const cleanId = requestId.replace(/^req_/, '').trim();
      const nowIso = new Date().toISOString();
      const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
      const userAgent = req.headers['user-agent'] || '';

      const {error:saveError} = await supabase.from('users').insert({
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
      });
      if(saveError) return res.status(503).json({error:'LOGIN_REQUEST_UNAVAILABLE'});

      return res.status(200).json({ success: true, requestId });
    } catch (error: any) {
      safeError('Error creating login request in Supabase:', error);
      return res.status(503).json({ error: 'LOGIN_REQUEST_UNAVAILABLE' });
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

      const auth = await authenticateCaller(req,BOT_TOKEN);
      if(!auth.authenticated) return res.status(auth.statusCode).json({valid:false,error:auth.error});
      const userDoc=auth.userDoc;
      if(userDoc) {
        const userPhone = userDoc.phone || userDoc.onboarding?.phone || '';
        const hasPhone = verifiedPhone(userDoc);
        const hasOferta = acceptedConsent(userDoc);
        const isRegisteredInDb = eligibleUser(userDoc);
        const safeOnboarding = {
          ...(userDoc.onboarding || {}),
          phone: userPhone,
          completed: isRegisteredInDb,
          oferta_accepted: hasOferta,
          session_token: sessionToken
        };

        return res.status(200).json({
          valid: true,
          userId: userDoc.id,
          phone: userPhone,
          access_token: null,
          refresh_token: null,
          onboarding: publicOnboarding(userDoc),
          cards: isRegisteredInDb ? (userDoc.cards || []) : [],
          transactions: isRegisteredInDb ? (userDoc.transactions || []) : [],
          isPremium: effectiveAccess(userDoc).isPremium,
          accessLevel: effectiveAccess(userDoc).level,
          premiumExpiresAt: userDoc.premium_expires_at || null,
          trialEndsAt: effectiveTrialEnd(userDoc),
          unlimitedAi: userDoc.unlimited_ai || false
        });
      }

      return res.status(200).json({ valid: false, reason: 'Session not found' });
    } catch (error: any) {
      safeError('Error validating session in Supabase:', error);
      return res.status(200).json({ valid: false, error: 'AUTHENTICATION_FAILED' });
    }
  }

  // 5.5. /api/auth/logout
  if (action === 'logout') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
      const caller = await authenticateCaller(req, BOT_TOKEN);
      if (!caller.authenticated) return res.status(caller.statusCode).json({error:caller.error});
      if (req.body?.userId && req.body.userId !== caller.userId) return res.status(403).json({error:'ACCOUNT_MISMATCH'});
      const userDoc = caller.userDoc;
      const onboarding = {...(userDoc.onboarding || {})};
      const deviceInfo = {...(userDoc.device_info || {})};
      deviceInfo.session_revoked_at = new Date().toISOString();
      delete onboarding.session_token;
      delete onboarding.session_expires_at;
      for (const key of ['session_token','sessionToken','session_expires_at','sessionExpiresAt']) delete deviceInfo[key];
      let query = supabase.from('users').update({onboarding,device_info:deviceInfo,updated_at:new Date().toISOString()})
        .eq('id',caller.userId).eq('onboarding',JSON.stringify(userDoc.onboarding));
      query = userDoc.device_info == null ? query.is('device_info',null) : query.eq('device_info',JSON.stringify(userDoc.device_info));
      const {data,error} = await query.select('id').maybeSingle();
      if (error) return res.status(503).json({error:'SESSION_STORE_UNAVAILABLE'});
      if (!data) return res.status(409).json({error:'SESSION_CHANGED'});
      return res.status(200).json({success:true,loggedOut:true});
    } catch {
      return res.status(503).json({error:'SESSION_STORE_UNAVAILABLE'});
    }
  }

  // 6. /api/auth/delete-account
  if (action === 'delete-account') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
      const caller = await authenticateCaller(req, BOT_TOKEN);
      if (!caller.authenticated) return res.status(caller.statusCode).json({error:caller.error});
      const canonicalUserId = caller.userId;
      const targetTgId = caller.telegramId;
      const userDoc = caller.userDoc;
      if ((req.body?.userId && req.body.userId !== canonicalUserId) ||
          (req.body?.telegramId && String(req.body.telegramId) !== targetTgId)) {
        return res.status(403).json({error:'ACCOUNT_MISMATCH'});
      }

      // Commit session-checked deletion before any irreversible external cleanup.
      await mutateSessionFinancialData(canonicalUserId,caller.sessionToken,'delete_account',{});

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
            safeWarn('[DELETE_ACCOUNT] Probe error:', probeErr);
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

          chatPurged = tgDetails.failed === 0 && tgDetails.notDeletable === 0;
        } catch (tgErr) {
          safeWarn('[DELETE_ACCOUNT] Telegram purge error:', tgErr);
        }
      }

      // Canonical row was deleted atomically above. Never delete it again:
      // the bot may already have created a fresh account during chat cleanup.

      // 3. Delete Supabase Auth user record if linked
      if (userDoc?.auth_user_id) {
        try {
          await supabase.auth.admin.deleteUser(userDoc.auth_user_id);
        } catch (authDelErr) {
          safeWarn('[DELETE_ACCOUNT] Supabase auth delete warning:', authDelErr);
        }
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
      safeError('[DELETE_ACCOUNT] Error:', error);
      const failure=publicFinancialError(error);
      return res.status(failure.statusCode).json({error:failure.error});
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
        const u=auth.userDoc;
        const allowed=eligibleUser(u);
        const {effectiveAccess}=await import('./_accessHelper.js');
        const access=effectiveAccess(u,await loadDefaultAiQuota());
        const safeUser={created_at:u.created_at,id:u.id,name:u.name,language:u.language,telegram_id:u.telegram_id,
          phone:verifiedPhone(u)?u.phone:'',onboarding:publicOnboarding(u),
          isVerified:allowed,is_premium:allowed && u.is_premium,premium_expires_at:u.premium_expires_at,
          canUseAi:allowed && access.canUseAi,unlimited_ai:allowed && u.unlimited_ai,
          trial_ends_at:allowed ? u.trial_ends_at : null,
          cards:allowed?(u.cards||[]):[],transactions:allowed?(u.transactions||[]):[]};
        return res.status(200).json({
          success: true,
          user: safeUser
        });
      }

      // POST: Update own cards, transactions, or onboarding
      if (req.method === 'POST') {
        if(!eligibleUser(auth.userDoc)) return res.status(403).json({error:'BOT_VERIFICATION_REQUIRED'});
        // IDOR Check: Ensure body.userId matches auth.userId if specified
        if (req.body?.userId && req.body.userId.trim() !== targetUserId && req.body.userId.trim() !== `moliya_user_tg_${auth.telegramId}`) {
          return res.status(403).json({ error: 'Forbidden: You can only update your own user data' });
        }

        const nowIso = new Date().toISOString();
        const updatePayload: any = { updated_at: nowIso };

        if(req.body?.financialAction){
          const action=req.body.financialAction;
          if(!['put_transaction','delete_transaction','replace_cards','save_cards_atomic','delete_card_atomic'].includes(action)) return res.status(400).json({error:'INVALID_FINANCIAL_ACTION'});
          if(req.body.transactions!==undefined || req.body.cards!==undefined || req.body.onboarding!==undefined) return res.status(400).json({error:'MIXED_WRITE_NOT_ALLOWED'});
          try {
            await mutateSessionFinancialData(targetUserId,auth.sessionToken,action,req.body.payload,req.body.expected ?? null);
            return res.status(200).json({success:true});
          } catch(error:any){const failure=publicFinancialError(error);return res.status(failure.statusCode).json({error:failure.error});}
        }
        if(req.body?.transactions!==undefined || req.body?.cards!==undefined) return res.status(400).json({error:'FINANCIAL_ACTION_REQUIRED'});

        if(typeof req.body?.clearAssistantDraft==='string'){
          const pending=auth.userDoc.onboarding?.assistant_pending;
          if(pending?.id===req.body.clearAssistantDraft){await updateProfileSnapshot(targetUserId,auth.userDoc,{onboarding:{...auth.userDoc.onboarding,assistant_pending:null}});}
          return res.status(200).json({success:true});
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
        // STRICT SECURITY GUARD: Strip all privileged AND bot-authoritative identity fields:
        // Client can NEVER forge: phone, oferta_accepted, privacy_consent, registration_status, completed,
        // is_premium, premium_expires_at, is_blocked, ai_limit, ai_query_count
        if (req.body?.onboarding && typeof req.body.onboarding === 'object') {
          const existingOb = auth.userDoc?.onboarding || {};
          const incomingOb = safePreferences(req.body.onboarding);
          if ('planned_payments' in incomingOb && JSON.stringify(cleanPlannedPayments(existingOb.planned_payments)) !== JSON.stringify(cleanPlannedPayments(req.body.expectedPlannedPayments))) {
            return res.status(409).json({error:'PLANS_CHANGED'});
          }
          updatePayload.onboarding = {...existingOb,...incomingOb};
          if(incomingOb.name) updatePayload.name=incomingOb.name;
          if(incomingOb.language) updatePayload.language=incomingOb.language;
        }

        // Perform update via service role (bypassing RLS safely on server)
        const { data: updatedDoc, error: updateErr } = await supabase
          .from('users')
          .update(updatePayload)
          .eq('id', targetUserId)
          .eq('onboarding', JSON.stringify(auth.userDoc.onboarding))
          .select('id, name, phone, telegram, telegram_id, language, is_premium, premium_expires_at, cards, transactions, onboarding, updated_at')
          .maybeSingle();

        if (updateErr) {
          safeError('[SYNC_DATA] Update error:', updateErr);
          return res.status(500).json({ error: 'Failed to update user data' });
        }

        if (!updatedDoc) return res.status(409).json({error:'PROFILE_CHANGED'});
        return res.status(200).json({
          success: true,
          user: updatedDoc ? {...updatedDoc,onboarding:publicOnboarding({...auth.userDoc,...updatedDoc})} : null
        });
      }
    } catch (e: any) {
      safeError('[SYNC_DATA] Handler error:', e);
      return res.status(500).json({ error: 'Failed to process sync request' });
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

      await mutateSessionFinancialData(targetUserId,auth.sessionToken,'wipe_financial',{});

      return res.status(200).json({ success: true, wiped: true, userId: targetUserId });
    } catch (e: any) {
      safeError('[WIPE_DATA] Handler error:', e);
      const failure=publicFinancialError(e);
      return res.status(failure.statusCode).json({error:failure.error});
    }
  }

  return res.status(404).json({ error: 'Auth route not found', action });
}
