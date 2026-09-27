import {adminTelegram} from './services/_adminTelegramService.js';
import {notificationPayload} from './services/_notificationService.js';
import {adminUserView} from './_adminUserView.js';
import {eligibleUser} from './_userPolicy.js';
import { shouldRemind, tashkentDay, reminderSlots, type ReminderSlot } from '../shared/reminderPolicy.js';
import { updateProfileSnapshot } from './services/_profileWriteService.js';
import { safeError, safeLog, safeWarn } from './_logger.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { supabase } from './_supabaseClient.js';
import { maskApiKey, testSpecificAiKey, executeAiWithRotation, AiKeyRecord, invalidateAiKeysCache } from './_aiRouter.js';
import { effectiveAccess, accountStatus } from './_accessHelper.js';
import { defaultAiQuotaFromOnboarding } from './_aiQuotaSettings.js';
import { invalidateAiParserGuidance } from './_aiParserGuidance.js';
import { generateAndSaveUserReport } from './_financialReportEngine.js';
import { ruleEnabled, dueAutomationUsers, notifyAutomation, cleanupAutomationClaims } from './_automation.js';
import { dueScheduledReports } from '../shared/scheduledReports.js';
import {
  adminWipeUserData,
  adminToggleUserBlock,
  adminGrantFullPremium,
  adminResetDailyQueries,
  logAdminAudit
} from './services/index.js';
import { applySecurityHeaders } from './_securityHeaders.js';
import { handleCors, isOriginAllowed } from './_cors.js';
import { applyRateLimit } from './_rateLimiter.js';

// ── Admin Audit Log Helper (Delegates to AuditLogService) ─────
async function logAdminAction(action: string, targetUserId?: string, targetUserName?: string, details?: any) {
  return logAdminAudit({
    action,
    target_user_id: targetUserId,
    target_user_name: targetUserName,
    admin_id: 'admin',
    details
  });
}

function formatUzbekExpiryDate(isoDate?: string | null): string {
  if (!isoDate) return "Cheksiz / Doimiy (Lifetime)";
  try {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return String(isoDate);
    const months = [
      'yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
      'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'
    ];
    const day = d.getDate();
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${day}-${month}, ${year} ${hours}:${mins}`;
  } catch {
    return String(isoDate);
  }
}

async function notifyUserVipGrantedTelegram(telegramId: string | number, expiresAt?: string | null, userId?: string) {
  try {
    const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
    if (!token || !telegramId || String(telegramId) === '—') return;

    let expiryDisplay = "Cheksiz (Doimiy VIP)";
    if (expiresAt) {
      try {
        const d = new Date(expiresAt);
        const diffMs = d.getTime() - Date.now();
        const days = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
        const months = [
          'yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
          'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'
        ];
        const day = d.getDate();
        const month = months[d.getMonth()];
        const year = d.getFullYear();
        expiryDisplay = `${days} kun (${day}-${month}, ${year} gacha)`;
      } catch {
        expiryDisplay = formatUzbekExpiryDate(expiresAt);
      }
    }

    // Clean previous system/link card so there is at most 1 active link button
    if (userId) {
      try {
        const { data: curr } = await supabase.from('users').select('onboarding').eq('id', userId).maybeSingle();
        const prevSysId = Number(curr?.onboarding?.last_system_message_id);
        const prevLinkId = Number(curr?.onboarding?.last_link_message_id);
        const idsToPurge = new Set<number>();
        if (Number.isInteger(prevSysId) && prevSysId > 0) idsToPurge.add(prevSysId);
        if (Number.isInteger(prevLinkId) && prevLinkId > 0) idsToPurge.add(prevLinkId);

        for (const mId of idsToPurge) {
          try {
            await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: String(telegramId), message_id: mId })
            });
          } catch {}
        }
      } catch {}
    }

    const text = `🎉 <b>Tabriklaymiz! Sizga Moliya AI VIP Premium obunasi taqdim etildi!</b>\n\n` +
      `<blockquote>✨ <b>VIP Premium imkoniyatlari:</b>\n` +
      `• 🤖 <b>Cheksiz AI tahlil:</b> Kunlik so'rovlar cheklovisiz\n` +
      `• 🎙️ <b>Cheksiz ovozli xabarlar:</b> Xarajatlarni gapirib yuborish\n` +
      `• 🧾 <b>Chek skaneri:</b> Rasmdan avtomatik xarajat aniqlash\n` +
      `• 📊 <b>Barcha hisobotlar:</b> Excel va PDF to'liq eksport\n` +
      `• ⚡ <b>24/7 ustuvor va tezkor yordamchi</b></blockquote>\n\n` +
      `<blockquote>⏳ <b>Amal qilish muddati:</b> <b>${expiryDisplay}</b></blockquote>\n\n` +
      `👇 <i>Moliya Mini App orqali barcha qulayliklardan foydalaning:</i>`;

    const appUrl = process.env.APP_URL || 'https://moliya-ai-pi.vercel.app';
    const keyboard = {
      inline_keyboard: [
        [{ text: "🚀 Moliya Mini Appni ochish", web_app: { url: appUrl } }]
      ]
    };

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(telegramId),
        text,
        parse_mode: 'HTML',
        reply_markup: keyboard
      })
    });
    const result = await res.json();
    const newMsgId = result?.result?.message_id;

    if (userId) {
      const { data: curr } = await supabase.from('users').select('onboarding').eq('id', userId).maybeSingle();
      const existingMsgs = Array.isArray(curr?.onboarding?.bot_messages) ? curr.onboarding.bot_messages : [];
      const newMsg = {
        id: 'msg_vip_' + Date.now(),
        sender: 'bot',
        text,
        timestamp: new Date().toISOString(),
        messageId: newMsgId || null
      };
      await updateProfileSnapshot(userId, curr, {
        onboarding: {
          ...(curr?.onboarding || {}),
          last_system_message_id: newMsgId || curr?.onboarding?.last_system_message_id,
          last_link_message_id: newMsgId || curr?.onboarding?.last_link_message_id,
          bot_messages: [...existingMsgs, newMsg]
        },
        updated_at: new Date().toISOString()
      });
    }

    return result;
  } catch (err) {
    safeError('[VIP NOTIFY] Error notifying user on Telegram:', err);
  }
}

async function notifyUserUnlimitedAiGrantedTelegram(telegramId: string | number, userId?: string) {
  try {
    const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
    if (!token || !telegramId || String(telegramId) === '—') return;

    if (userId) {
      try {
        const { data: curr } = await supabase.from('users').select('onboarding').eq('id', userId).maybeSingle();
        const prevSysId = Number(curr?.onboarding?.last_system_message_id);
        const prevLinkId = Number(curr?.onboarding?.last_link_message_id);
        const idsToPurge = new Set<number>();
        if (Number.isInteger(prevSysId) && prevSysId > 0) idsToPurge.add(prevSysId);
        if (Number.isInteger(prevLinkId) && prevLinkId > 0) idsToPurge.add(prevLinkId);

        for (const mId of idsToPurge) {
          try {
            await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: String(telegramId), message_id: mId })
            });
          } catch {}
        }
      } catch {}
    }

    const text = `🌟 <b>Tabriklaymiz! Sizga Cheksiz AI (Unlimited) imkoniyati taqdim etildi!</b>\n\n` +
      `<blockquote>✨ Endi hisobingizda hech qanday kunlik AI cheklovi yo'q:\n` +
      `• 🤖 <b>Cheksiz AI so'rovlar:</b> Istalgancha xarajat tahlili va savollar\n` +
      `• 🎙️ <b>Cheksiz audio/ovozli yozuvlar</b>\n` +
      `• 🧾 <b>Chek va rasmlar skaneri</b>\n` +
      `• ⚡ <b>Ustuvor tezkor AI marshrutlash</b></blockquote>\n\n` +
      `👇 <i>Moliya Mini App orqali to'liq foydalanishingiz mumkin!</i>`;

    const appUrl = process.env.APP_URL || 'https://moliya-ai-pi.vercel.app';
    const keyboard = {
      inline_keyboard: [
        [{ text: "🚀 Moliya Mini Appni ochish", web_app: { url: appUrl } }]
      ]
    };

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(telegramId),
        text,
        parse_mode: 'HTML',
        reply_markup: keyboard
      })
    });
    const result = await res.json();
    const newMsgId = result?.result?.message_id;

    if (userId) {
      const { data: curr } = await supabase.from('users').select('onboarding').eq('id', userId).maybeSingle();
      const existingMsgs = Array.isArray(curr?.onboarding?.bot_messages) ? curr.onboarding.bot_messages : [];
      const newMsg = {
        id: 'msg_unlimited_' + Date.now(),
        sender: 'bot',
        text,
        timestamp: new Date().toISOString(),
        messageId: newMsgId || null
      };
      await updateProfileSnapshot(userId, curr, {
        onboarding: {
          ...(curr?.onboarding || {}),
          last_system_message_id: newMsgId || curr?.onboarding?.last_system_message_id,
          last_link_message_id: newMsgId || curr?.onboarding?.last_link_message_id,
          bot_messages: [...existingMsgs, newMsg]
        },
        updated_at: new Date().toISOString()
      });
    }

    return result;
  } catch (err) {
    safeError('[UNLIMITED AI NOTIFY] Error notifying user on Telegram:', err);
  }
}
// ── Admin Session Helpers ─────────────────────────────────────
const ADMIN_SESSION_MAX_AGE_SEC = 14400; // 4 hours
const ADMIN_OTP_TTL_MS = 5 * 60 * 1000;
const ADMIN_OTP_MAX_ATTEMPTS = 5;

function adminOtpHash(adminKey:string, challengeId:string, code:string):string {
  return crypto.createHmac('sha256',adminKey).update(`${challengeId}:${code}`).digest('hex');
}

async function replaceAdminDeviceInfo(previous:any, next:any):Promise<boolean> {
  let query=supabase.from('users').update({device_info:next,updated_at:new Date().toISOString()})
    .eq('id','admin_session_state');
  query=previous==null?query.is('device_info',null):query.eq('device_info',JSON.stringify(previous));
  const {data,error}=await query.select('id').maybeSingle();
  if(error)throw new Error('SESSION_STORE_UNAVAILABLE');
  return Boolean(data);
}

function signAdminSession(adminKey: string, sid?: string, maxAgeSec: number = ADMIN_SESSION_MAX_AGE_SEC): string {
  const sessionId = sid || crypto.randomBytes(16).toString('hex');
  const payload = JSON.stringify({
    role: 'admin',
    sid: sessionId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + maxAgeSec
  });
  const b64Payload = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', adminKey).update(b64Payload).digest('base64url');
  return `${b64Payload}.${sig}`;
}

async function verifyAdminSession(token: string, adminKey: string): Promise<boolean> {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [b64Payload, sig] = parts;
  try {
    const expectedSig = crypto.createHmac('sha256', adminKey).update(b64Payload).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return false;
    }
    const payload = JSON.parse(Buffer.from(b64Payload, 'base64url').toString('utf8'));
    if (payload.role !== 'admin') return false;
    const nowSec = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(payload.exp) || payload.exp <= nowSec ||
        !Number.isSafeInteger(payload.iat) || payload.iat > nowSec + 60 ||
        typeof payload.sid !== 'string' || !/^[a-f0-9]{32}$/.test(payload.sid)) return false;

    // Server-Side Invalidation Check against Supabase
    const { data: adminState, error: stateError } = await supabase
      .from('users')
      .select('device_info')
      .eq('id', 'admin_session_state')
      .maybeSingle();

    if(stateError || !adminState?.device_info?.active_sid || !payload.sid) return false;
    if (adminState?.device_info) {
      const validAfter = adminState.device_info.valid_after;
      if (validAfter && payload.iat < validAfter) {
        return false; // Token was issued before logout / invalidation timestamp
      }
      if (adminState.device_info.active_sid === null) {
        return false; // Explicitly logged out
      }
      if (payload.sid && adminState.device_info.active_sid && payload.sid !== adminState.device_info.active_sid) {
        return false; // Superseded by a newer login session
      }
    }

    return true;
  } catch {
    return false;
  }
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      try { cookies[key] = decodeURIComponent(val); } catch { /* Malformed cookies are not credentials. */ }
    }
  }
  return cookies;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applySecurityHeaders(res);

  // 1. Strict Origin-Whitelisted CORS for Admin API (No wildcard '*')
  const corsHandled = handleCors(req, res, { adminOnly: true });
  if (corsHandled) return;

  // 2. Sliding-Window Brute-Force Rate Limiter (20 req/min)


  // Extract route from query (via vercel rewrite ?route=...) or URL path
  let route = (req.query.route as string) || '';
  if (!route && req.url) {
    const cleanUrl = req.url.split('?')[0];
    route = cleanUrl.replace(/^\/api\/admin\/?/, '').trim();
  }

  if (!(await applyRateLimit(req,res,['login','verify-otp'].includes(route)?'admin_login':'admin'))) return;

  // Fail-Closed Admin Server Secret Check
  const ADMIN_KEY = (process.env.ADMIN_SECRET_KEY || '').trim();
  if (!ADMIN_KEY || ADMIN_KEY.length < 16 || ['your-admin-secret','moliya_admin_authorized','admin'].includes(ADMIN_KEY)) {
    safeError('[ADMIN SECURITY ALERT] Privileged admin endpoint accessed but ADMIN_SECRET_KEY is not configured or too weak on server');
    return res.status(500).json({ error: 'Admin server secret configuration error' });
  }

  // Password and OTP never share the signing secret when ADMIN_PASSWORD is set.
  if (route === 'login') {
    if (req.method !== 'POST') return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
    if(!isOriginAllowed(req.headers.origin as string,'ADMIN_ALLOWED_ORIGINS'))return res.status(403).json({error:'CSRF_REJECTED'});
    const rawPassword=req.body?.password;
    if(typeof rawPassword!=='string' || rawPassword.length>1024)return res.status(400).json({error:'INVALID_CREDENTIAL_FORMAT'});
    const password=rawPassword.trim();
    const configuredPassword=(process.env.ADMIN_PASSWORD || ADMIN_KEY).trim();
    if(configuredPassword.length<16 || configuredPassword==='your-separate-long-admin-password')
      return res.status(500).json({error:'ADMIN_PASSWORD_NOT_CONFIGURED'});
    const provided=Buffer.from(password),expected=Buffer.from(configuredPassword);
    if(!password || provided.length!==expected.length || !crypto.timingSafeEqual(provided,expected) ||
      ['admin','your-admin-secret','moliya_admin_authorized'].includes(password))
      return res.status(401).json({error:'Invalid admin credentials'});
    const botToken=(process.env.TELEGRAM_BOT_TOKEN || '').trim();
    const telegramId=(process.env.ADMIN_TELEGRAM_ID || '').trim();
    if(!botToken || !/^[1-9][0-9]{0,15}$/.test(telegramId))
      return res.status(503).json({error:'ADMIN_OTP_UNAVAILABLE'});
    const challengeId=crypto.randomBytes(24).toString('hex');
    const code=String(crypto.randomInt(0,1000000)).padStart(6,'0');
    const now=Date.now();
    try {
      const {data:row,error:readError}=await supabase.from('users').select('device_info')
        .eq('id','admin_session_state').maybeSingle();
      if(readError)return res.status(503).json({error:'SESSION_STORE_UNAVAILABLE'});
      const previous=row?.device_info ?? null;
      if(Number(previous?.pending_otp?.created_at)>now-30000)
        return res.status(429).json({error:'OTP_COOLDOWN'});
      const pending={challenge_id:challengeId,hash:adminOtpHash(ADMIN_KEY,challengeId,code),
        expires_at:now+ADMIN_OTP_TTL_MS,created_at:now,attempts:0};
      const next={...(previous||{}),pending_otp:pending};
      if(row){
        if(!await replaceAdminDeviceInfo(previous,next))return res.status(409).json({error:'SESSION_CHANGED'});
      }else{
        const {error:insertError}=await supabase.from('users').insert({id:'admin_session_state',
          platform:'system_state',device_info:next,updated_at:new Date().toISOString()});
        if(insertError)return res.status(insertError.code==='23505'?409:503).json({error:'SESSION_STORE_UNAVAILABLE'});
      }
      let delivered=false;
      try{
        const response=await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`,{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({chat_id:telegramId,text:`Moliya Admin kirish kodi: ${code}\n5 daqiqa amal qiladi. Agar bu siz bo‘lmasangiz, kodni hech kimga aytmang.`})
        });
        delivered=response.ok && (await response.json()).ok===true;
      }catch{}
      if(!delivered){
        await replaceAdminDeviceInfo(next,{...next,pending_otp:null}).catch(()=>{});
        return res.status(503).json({error:'ADMIN_OTP_DELIVERY_FAILED'});
      }
      return res.status(200).json({success:true,requireOtp:true,challengeId,expiresIn:300});
    }catch{return res.status(503).json({error:'SESSION_STORE_UNAVAILABLE'});}
  }

  if (route === 'verify-otp') {
    if(req.method!=='POST')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
    if(!isOriginAllowed(req.headers.origin as string,'ADMIN_ALLOWED_ORIGINS'))return res.status(403).json({error:'CSRF_REJECTED'});
    const {challengeId,code}=req.body||{};
    if(typeof challengeId!=='string' || !/^[a-f0-9]{48}$/.test(challengeId) ||
      typeof code!=='string' || !/^[0-9]{6}$/.test(code))
      return res.status(400).json({error:'INVALID_OTP_FORMAT'});
    try{
      const {data:row,error:readError}=await supabase.from('users').select('device_info')
        .eq('id','admin_session_state').maybeSingle();
      if(readError)return res.status(503).json({error:'SESSION_STORE_UNAVAILABLE'});
      const previous=row?.device_info;
      const pending=previous?.pending_otp;
      if(!pending || pending.challenge_id!==challengeId ||
        !Number.isSafeInteger(pending.expires_at) || pending.expires_at<=Date.now() ||
        !Number.isSafeInteger(pending.attempts) || pending.attempts>=ADMIN_OTP_MAX_ATTEMPTS)
        return res.status(401).json({error:'INVALID_OR_EXPIRED_OTP'});
      const actual=Buffer.from(adminOtpHash(ADMIN_KEY,challengeId,code));
      const expected=Buffer.from(String(pending.hash||''));
      if(actual.length!==expected.length || !crypto.timingSafeEqual(actual,expected)){
        if(!await replaceAdminDeviceInfo(previous,{...previous,pending_otp:{...pending,attempts:pending.attempts+1}}))
          return res.status(409).json({error:'SESSION_CHANGED'});
        return res.status(401).json({error:'INVALID_OR_EXPIRED_OTP'});
      }
      const sid=crypto.randomBytes(16).toString('hex');
      const nowSec=Math.floor(Date.now()/1000);
      if(!await replaceAdminDeviceInfo(previous,{...previous,active_sid:sid,valid_after:nowSec,
        logged_in_at:new Date().toISOString(),pending_otp:null}))
        return res.status(409).json({error:'SESSION_CHANGED'});
      const sessionToken=signAdminSession(ADMIN_KEY,sid);
      const origin=req.headers.origin;
      const host=req.headers.host;
      const isSecure=process.env.NODE_ENV==='production' || req.headers['x-forwarded-proto']==='https' || (req.socket as any)?.encrypted;
      const isCrossSite=Boolean(origin && host && new URL(origin as string).host!==host);
      const sameSite=isCrossSite && isSecure?'None':'Lax';
      res.setHeader('Set-Cookie',`moliya_admin_session=${sessionToken}; Path=/; Max-Age=${ADMIN_SESSION_MAX_AGE_SEC}; HttpOnly${isSecure?'; Secure':''}; SameSite=${sameSite}`);
      return res.status(200).json({success:true,expiresIn:ADMIN_SESSION_MAX_AGE_SEC});
    }catch{return res.status(503).json({error:'SESSION_STORE_UNAVAILABLE'});}
  }

  // ==========================================
  // ROUTE: /api/admin?route=logout (POST / GET)
  // Clears session cookie and invalidates server-side session
  // ==========================================
  if(route==='logout') {
    if(req.method!=='POST') return res.status(405).json({error:'Method Not Allowed'});
    const token=parseCookies(req.headers.cookie)['moliya_admin_session'];
    if(!token || !(await verifyAdminSession(token,ADMIN_KEY))) return res.status(401).json({error:'Unauthorized'});
    let origin=req.headers.origin;
    if(!origin && req.headers.referer){try{origin=new URL(req.headers.referer as string).origin;}catch{}}
    if(!origin || !isOriginAllowed(origin as string,'ADMIN_ALLOWED_ORIGINS')) return res.status(403).json({error:'CSRF_REJECTED'});
    const payload=JSON.parse(Buffer.from(token.split('.')[0],'base64url').toString());
    const {data,error}=await supabase.from('users').update({device_info:{active_sid:null,valid_after:Math.floor(Date.now()/1000)}}).eq('id','admin_session_state').eq('device_info->>active_sid',payload.sid).select('id');
    if(error) return res.status(503).json({error:'SESSION_STORE_UNAVAILABLE'});
    if(!data?.length) return res.status(409).json({error:'SESSION_CHANGED'});
    res.setHeader('Set-Cookie','moliya_admin_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax'+(process.env.NODE_ENV==='production'?'; Secure':''));
    return res.status(200).json({success:true});
  }

  // ==========================================
  // AUTHENTICATION GUARD FOR PRIVILEGED ROUTES
  // HttpOnly cookie is the ONLY browser session credential
  // Direct x-admin-key accepted ONLY for server-to-server / CLI
  // ==========================================
  const cookies = parseCookies(req.headers.cookie);
  const cookieSession = cookies['moliya_admin_session'];
  const rawAuth = typeof req.headers['authorization'] === 'string' && req.headers['authorization'].startsWith('Bearer ')
    ? req.headers['authorization'].slice(7).trim()
    : null;
  const directKeyHeader = typeof req.headers['x-admin-key'] === 'string'
    ? req.headers['x-admin-key'].trim()
    : Array.isArray(req.headers['x-admin-key'])
      ? req.headers['x-admin-key'][0].trim()
      : '';

  let isAuthorized = false;

  // A. Authenticate browser request via HttpOnly session cookie
  if (cookieSession && (await verifyAdminSession(cookieSession, ADMIN_KEY))) {
    // An explicit admin origin is mandatory for every cookie-authenticated write.
    // Cross-site hosting is supported only for that exact configured origin.
    const reqOrigin = req.headers.origin;
    const reqReferer = req.headers.referer;
    let source: string | undefined;
    if (typeof reqOrigin === 'string') source = reqOrigin;
    if (reqReferer) {
      try {
        const refererOrigin = new URL(reqReferer as string).origin;
        if (!isOriginAllowed(refererOrigin, 'ADMIN_ALLOWED_ORIGINS')) return res.status(403).json({error:'CSRF_REJECTED'});
        source ||= refererOrigin;
      } catch { return res.status(403).json({error:'CSRF_REJECTED'}); }
    }
    if (source && !isOriginAllowed(source, 'ADMIN_ALLOWED_ORIGINS')) return res.status(403).json({error:'CSRF_REJECTED'});
    if (!source && (req.method !== 'GET' || req.headers['sec-fetch-site'] === 'cross-site')) return res.status(403).json({error:'CSRF_REJECTED'});
    // Scheduled server calls may retain GET with a server key; browser cookies may not.
    if (req.method === 'GET' && ['auto-broadcast','automation-due','run-scheduled-reports'].includes(route)) return res.status(405).json({error:'USE_POST_FOR_ADMIN_ACTION'});

    isAuthorized = true;
  }

  // Vercel Cron sends a GET with a dedicated bearer secret. This credential
  // authorizes only scheduled automation routes, never general admin actions.
  if (!isAuthorized && ['auto-broadcast','automation-due','run-scheduled-reports'].includes(route) && req.method === 'GET' && !req.headers.origin && !cookieSession) {
    const cronSecret = (process.env.CRON_SECRET || '').trim();
    const presented = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
    const expected = `Bearer ${cronSecret}`;
    const candidate = Buffer.from(presented);
    const reference = Buffer.from(expected);
    if (cronSecret.length >= 16 && candidate.length === reference.length && crypto.timingSafeEqual(candidate, reference)) {
      isAuthorized = true;
    }
  }

  // B. Fallback: Authenticate server-to-server / CLI scripts using permanent server key
  // Browser code must NEVER use direct x-admin-key (must be cookie only)
  if (!isAuthorized) {
    // The permanent server key must not be guessed through a higher-volume read route.
    if ((directKeyHeader || rawAuth) && !(await applyRateLimit(req,res,'admin_login'))) return;
    if (req.headers.origin && (directKeyHeader || rawAuth)) {
      return res.status(403).json({
        error: 'Direct admin keys are prohibited from browser origins. Use HttpOnly cookie login.'
      });
    }
    const candidateDirectKey = directKeyHeader || (rawAuth && !rawAuth.includes('.') ? rawAuth : '');
    if (candidateDirectKey && candidateDirectKey !== 'moliya_admin_authorized' && candidateDirectKey !== 'your-admin-secret' && candidateDirectKey !== 'admin') {
      const candidateKeyBuf = Buffer.from(candidateDirectKey);
      const adminKeyBuf = Buffer.from(ADMIN_KEY);
      if (candidateKeyBuf.length === adminKeyBuf.length && crypto.timingSafeEqual(candidateKeyBuf, adminKeyBuf)) {
        isAuthorized = true;
      }
    }
  }

  if (!isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized: missing or invalid admin credentials' });
  }

  // ROUTE: verify-session
  if (route === 'verify-session') {
    return res.status(200).json({ success: true, authenticated: true });
  }

  // Read-only health check. Never return database URLs, keys, row contents or errors.
  if (route === 'database-status') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    const start = Date.now();
    try {
      const { error } = await supabase.from('users').select('id').limit(1);
      if (error) return res.status(503).json({ error: 'DATABASE_UNAVAILABLE' });
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).json({ connected: true, latencyMs: Date.now() - start });
    } catch { return res.status(503).json({ error: 'DATABASE_UNAVAILABLE' }); }
  }

  const nowIso = new Date().toISOString();

  // Login Records never expose session secrets, onboarding JSON or finances.
  if (route === 'login-records') {
    if (req.method === 'GET') {
      try {
        const records: any[] = [];
        for (let offset = 0; ; offset += 500) {
          const { data: rows, error } = await supabase.from('users')
            .select('id,name,phone,telegram,telegram_id,platform,is_premium,is_blocked,created_at,updated_at')
            .order('updated_at', { ascending: false }).range(offset, offset + 499);
          if (error) return res.status(503).json({ error: 'USER_STORE_UNAVAILABLE' });
          for (const raw of rows || []) {
            const id = String(raw.id || '');
            if (!/^moliya_user_tg_[0-9]+$/.test(id) && !/^(req_|exchange_|sess_|moliya_user_req_|moliya_user_sess_)/.test(id)) continue;
            const recordType = id.startsWith('req_') || id.startsWith('moliya_user_req_') ? 'login_request'
              : id.startsWith('exchange_') ? 'exchange_code'
              : id.startsWith('sess_') || id.startsWith('moliya_user_sess_') ? 'session' : 'primary';
            const isBlocked = Boolean(raw.is_blocked);
            const safe = { id, name: raw.name || '—', phone: raw.phone || '—', telegram: raw.telegram || '—',
              telegramId: raw.telegram_id || (recordType === 'primary' ? id.slice('moliya_user_tg_'.length) : '—'),
              platform: raw.platform || (recordType === 'primary' ? 'telegram' : 'web_app'),
              isPremium: Boolean(raw.is_premium), isBlocked, isRestricted: isBlocked,
              createdAt: raw.created_at || '—', updatedAt: raw.updated_at || '—',
              recordType, recordTypeLabel: recordType === 'primary' ? '👤 Primary Account'
                : recordType === 'login_request' ? '🔑 Login Request (req_)'
                : recordType === 'exchange_code' ? '⚡ Exchange Code' : '📱 Session (sess_)',
              recordTypeBadge: recordType === 'primary' ? 'pill-blue'
                : recordType === 'login_request' ? 'pill-amber'
                : recordType === 'exchange_code' ? 'pill-purple' : 'pill-green',
              status: isBlocked ? 'BLOCKED' : 'ACTIVE', statusBadge: isBlocked ? 'pill-red' : 'pill-green' };
            records.push({ ...safe, _raw: safe });
          }
          if ((rows || []).length < 500) break;
        }
        res.setHeader('Cache-Control', 'private, no-store');
        return res.status(200).json({ success: true, records });
      } catch { return res.status(503).json({ error: 'USER_STORE_UNAVAILABLE' }); }
    }
    if (req.method === 'POST') {
      const ids = req.body?.ids;
      if (req.body?.action !== 'delete' || !Array.isArray(ids) || ids.length < 1 || ids.length > 100 ||
        ids.some((id:any) => typeof id !== 'string' || id.length > 128 ||
          !/^(req_|exchange_|sess_|moliya_user_req_|moliya_user_sess_)[A-Za-z0-9_-]+$/.test(id)))
        return res.status(400).json({ error: 'INVALID_LOGIN_RECORDS' });
      try {
        const unique = [...new Set(ids)];
        const { data, error } = await supabase.from('users').delete().in('id', unique).select('id');
        if (error) return res.status(503).json({ error: 'USER_STORE_UNAVAILABLE' });
        await logAdminAction('delete_login_records', undefined, undefined, { count: data?.length || 0 });
        return res.status(200).json({ success: true, deleted: data?.length || 0 });
      } catch { return res.status(503).json({ error: 'USER_STORE_UNAVAILABLE' }); }
    }
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  // ==========================================
  // 1. ROUTE: /api/admin/users
  // ==========================================
  if (route === 'users') {
    if (req.method === 'GET') {
      try {
        const suUsers:any[]=[];
        const pageSize=500;
        for(let offset=0;offset<10000;offset+=pageSize){
          const {data,error}=await supabase.from('users').select('*')
            .order('updated_at',{ascending:false}).order('id',{ascending:true})
            .range(offset,offset+pageSize-1);
          if(error || !Array.isArray(data)) return res.status(503).json({error:'USER_STORE_UNAVAILABLE'});
          suUsers.push(...data);
          if(data.length<pageSize) break;
          // Never present a truncated roster as the complete user list.
          if(offset+pageSize>=10000)return res.status(503).json({error:'USER_LIST_TOO_LARGE'});
        }

        const restrictions=new Set((suUsers||[]).filter(u=>String(u.id).startsWith('restricted_tg_') && u.onboarding?.is_blocked!==false).map(u=>String(u.id).replace('restricted_tg_','')));
        const defaultQuota=defaultAiQuotaFromOnboarding((suUsers||[]).find(u=>u.id==='system_app_settings')?.onboarding);
        const formatted=(suUsers||[]).filter(u=>/^moliya_user_tg_[0-9]+$/.test(u.id)).map(u=>adminUserView(u,restrictions.has(String(u.telegram_id)),defaultQuota));
        return res.status(200).json({ success: true, users: formatted, source: 'supabase' });
      } catch (e: any) {
        return res.status(500).json({ error: 'Failed to fetch users' });
      }
    }

    if (req.method === 'POST') {
      try {
        const { userId, action, isPremium, aiLimit } = req.body || {};
        if(typeof userId!=='string'||!/^moliya_user_tg_[0-9]+$/.test(userId))return res.status(400).json({error:'INVALID_USER_ID'});

        // Fetch user name and existing state for audit log and synchronized updates
        const { data: targetUser, error: targetError } = await supabase
          .from('users')
          .select('*')
          .eq('id', userId)
          .maybeSingle();
        if(targetError)return res.status(503).json({error:'USER_STORE_UNAVAILABLE'});
        if(!targetUser||String(targetUser.telegram_id)!==userId.replace('moliya_user_tg_',''))return res.status(404).json({error:'USER_NOT_FOUND'});
        const userName = targetUser?.name || targetUser?.telegram || userId;
        const existingOb = targetUser?.onboarding || {};

        const effectiveAction = action || (isPremium !== undefined ? (isPremium ? 'grant_vip' : 'revoke_vip') : null);

        if(effectiveAction==='grant_vip') {
          const expiry=req.body.expiresAt??req.body.expiry;
          if(expiry!=null && (!Number.isFinite(Date.parse(expiry))||Date.parse(expiry)<=Date.now()))return res.status(400).json({error:'INVALID_PREMIUM_EXPIRY'});
          if(req.body.days!==undefined && req.body.days!==-1 && (!Number.isInteger(req.body.days)||req.body.days<1||req.body.days>36500))return res.status(400).json({error:'INVALID_PREMIUM_DAYS'});
        }
        if(effectiveAction==='set_ai_limit' && aiLimit!==null && (!Number.isInteger(aiLimit)||aiLimit<0||aiLimit>1000000))return res.status(400).json({error:'INVALID_AI_LIMIT'});
        for(const key of ['clearTelegramChat','deleteAiLogs','restrictTelegramId'])if(req.body[key]!==undefined&&typeof req.body[key]!=='boolean')return res.status(400).json({error:'INVALID_DELETE_OPTIONS'});

        switch (effectiveAction) {
          case 'grant_vip': {
            let expiresAt: string | null = null;
            if (req.body.lifetime || req.body.days === -1) {
              expiresAt = null;
            } else if (req.body.expiresAt || req.body.expiry) {
              expiresAt = new Date(req.body.expiresAt || req.body.expiry).toISOString();
            } else {
              const days = Number(req.body.days) || 30;
              expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
            }

            const updatedOb = {
              ...existingOb,
              is_vip: true,
              is_premium: true,
              is_trial: false,
              trial_ends_at: null,
              premium_expires_at: expiresAt,
              unlimited_ai: false
            };

            const { error } = await updateProfileSnapshot(userId, targetUser, {
                is_premium: true,
                premium_expires_at: expiresAt,
                unlimited_ai: false,
                trial_ends_at: null,
                ai_query_count: 0,
                onboarding: updatedOb,
                updated_at: nowIso
              });

            if (error) return res.status(500).json({ error: 'Failed to grant VIP' });
            await logAdminAction('grant_vip', userId, userName, { expiresAt });

            // Instantly notify user on Telegram with Uzbek expiration date
            const tgTarget = targetUser?.telegram_id || (userId.startsWith('moliya_user_tg_') ? userId.replace('moliya_user_tg_', '') : null);
            if (tgTarget) {
              await notifyUserVipGrantedTelegram(tgTarget, expiresAt, userId);
            }

            return res.status(200).json({ success: true, userId, action: 'grant_vip', isPremium: true, premiumExpiresAt: expiresAt });
          }

          case 'revoke_vip': {
            const updatedOb = {
              ...existingOb,
              is_vip: false,
              is_premium: false,
              premium_expires_at: null
            };

            const { error } = await updateProfileSnapshot(userId, targetUser, {
                is_premium: false,
                premium_expires_at: null,
                onboarding: updatedOb,
                updated_at: nowIso
              });

            if (error) return res.status(500).json({ error: 'Failed to revoke VIP' });
            await logAdminAction('revoke_vip', userId, userName);
            return res.status(200).json({ success: true, userId, action: 'revoke_vip', isPremium: false });
          }

          case 'grant_unlimited_ai': {
            const updatedOb = {
              ...existingOb,
              unlimited_ai: true,
              is_vip: true,
              is_premium: true,
              is_trial: false,
              trial_ends_at: null,
              premium_expires_at: null
            };

            const { error } = await updateProfileSnapshot(userId, targetUser, {
                unlimited_ai: true,
                is_premium: true,
                premium_expires_at: null,
                trial_ends_at: null,
                ai_blocked: false,
                ai_query_count: 0,
                onboarding: updatedOb,
                updated_at: nowIso
              });

            if (error) return res.status(500).json({ error: 'Failed to grant unlimited AI' });
            await logAdminAction('grant_unlimited_ai', userId, userName);

            // Notify user on Telegram
            const tgTarget = targetUser?.telegram_id || (userId.startsWith('moliya_user_tg_') ? userId.replace('moliya_user_tg_', '') : null);
            if (tgTarget) {
              await notifyUserUnlimitedAiGrantedTelegram(tgTarget, userId);
            }

            return res.status(200).json({ success: true, userId, action: 'grant_unlimited_ai', unlimitedAi: true });
          }

          case 'revoke_unlimited_ai': {
            const updatedOb = {
              ...existingOb,
              unlimited_ai: false
            };

            const { error } = await updateProfileSnapshot(userId, targetUser, {
                unlimited_ai: false,
                onboarding: updatedOb,
                updated_at: nowIso
              });

            if (error) return res.status(500).json({ error: 'Failed to revoke unlimited AI' });
            await logAdminAction('revoke_unlimited_ai', userId, userName);
            return res.status(200).json({ success: true, userId, action: 'revoke_unlimited_ai', unlimitedAi: false });
          }

          case 'block': {
            const updatedOb = {
              ...existingOb,
              is_blocked: true, session_token:null,session_expires_at:null
            };

            const { error } = await updateProfileSnapshot(userId, targetUser, { is_blocked: true, onboarding: updatedOb, updated_at: nowIso });

            if (error) return res.status(500).json({ error: 'Failed to block user' });
            await logAdminAction('block', userId, userName);
            return res.status(200).json({ success: true, userId, action: 'block', isBlocked: true });
          }

          case 'unblock': {
            const updatedOb = {
              ...existingOb,
              is_blocked: false
            };

            const { error } = await updateProfileSnapshot(userId, targetUser, { is_blocked: false, onboarding: updatedOb, device_info:{...targetUser.device_info,is_blocked:false}, updated_at: nowIso });

            if (error) return res.status(500).json({ error: 'Failed to unblock user' });
            const {error:restrictionError}=await supabase.from('users').delete().eq('id','restricted_tg_'+targetUser.telegram_id);
            if(restrictionError)return res.status(503).json({error:'RESTRICTION_STORE_UNAVAILABLE'});
            await logAdminAction('unblock', userId, userName);
            return res.status(200).json({ success: true, userId, action: 'unblock', isBlocked: false });
          }

          case 'block_ai': {
            const updatedOb = {
              ...existingOb,
              ai_blocked: true
            };

            const { error } = await updateProfileSnapshot(userId, targetUser, { ai_blocked: true, onboarding: updatedOb, updated_at: nowIso });

            if (error) return res.status(500).json({ error: 'Failed to block AI' });
            await logAdminAction('block_ai', userId, userName);
            return res.status(200).json({ success: true, userId, action: 'block_ai', aiBlocked: true });
          }

          case 'unblock_ai': {
            const updatedOb = {
              ...existingOb,
              ai_blocked: false
            };

            const { error } = await updateProfileSnapshot(userId, targetUser, { ai_blocked: false, onboarding: updatedOb, updated_at: nowIso });

            if (error) return res.status(500).json({ error: 'Failed to unblock AI' });
            await logAdminAction('unblock_ai', userId, userName);
            return res.status(200).json({ success: true, userId, action: 'unblock_ai', aiBlocked: false });
          }

          case 'restrict': {
            const updatedOb = {
              ...existingOb,
              is_restricted: true, session_token:null,session_expires_at:null
            };

            const { error } = await updateProfileSnapshot(userId, targetUser, { is_restricted: true, onboarding: updatedOb, updated_at: nowIso });

            if (error) return res.status(500).json({ error: 'Failed to restrict user' });
            await logAdminAction('restrict', userId, userName);
            return res.status(200).json({ success: true, userId, action: 'restrict', isRestricted: true });
          }

          case 'unrestrict': {
            const updatedOb = {
              ...existingOb,
              is_restricted: false
            };

            const { error } = await updateProfileSnapshot(userId, targetUser, { is_restricted: false, onboarding: updatedOb, device_info:{...targetUser.device_info,restricted:false}, updated_at: nowIso });

            if (error) return res.status(500).json({ error: 'Failed to unrestrict user' });
            await logAdminAction('unrestrict', userId, userName);
            return res.status(200).json({ success: true, userId, action: 'unrestrict', isRestricted: false });
          }

          case 'reset_trial': {
            const trialEnd = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
            const updatedOb = {
              ...existingOb,
              is_trial: true,
              unlimited_ai:false,
              is_vip: false,
              is_premium: false,
              trial_ends_at: trialEnd,
              premium_expires_at: null
            };

            const { error } = await updateProfileSnapshot(userId, targetUser, {
                trial_ends_at: trialEnd,
                unlimited_ai:false,
                is_premium: false,
                premium_expires_at: null,
                ai_query_count: 0,
                ai_limit: null,
                onboarding: updatedOb,
                updated_at: nowIso
              });

            if (error) return res.status(500).json({ error: 'Failed to reset trial' });
            await logAdminAction('reset_trial', userId, userName, { trialEnd });
            return res.status(200).json({ success: true, userId, action: 'reset_trial', trialEndsAt: trialEnd });
          }

          case 'set_ai_limit': {
            const limitValue = (aiLimit === null || aiLimit === undefined || aiLimit === -1 || aiLimit === 0) ? null : Number(aiLimit);
            const { error } = await updateProfileSnapshot(userId, targetUser, {
                ai_limit: limitValue,
                ai_query_count: 0,
                updated_at: nowIso
              });

            if (error) return res.status(500).json({ error: 'Failed to set AI limit' });
            await logAdminAction('set_ai_limit', userId, userName, { aiLimit: limitValue });
            return res.status(200).json({ success: true, userId, action: 'set_ai_limit', aiLimit: limitValue, aiQueryCount: 0 });
          }

          case 'reset_ai_count': {
            const resData = await adminResetDailyQueries(userId, 'admin', userName);
            return res.status(200).json({ success: true, userId, action: 'reset_ai_count', aiQueryCount: resData.aiQueryCount });
          }

          case 'wipe_financial': {
            const result = await adminWipeUserData(userId, 'financial', 'admin', userName);
            return res.status(200).json({ success: true, userId, action: 'wipe_financial', result });
          }

          case 'delete_account': {
            const result = await adminWipeUserData(userId, 'account', 'admin', userName, {clearTelegramChat:req.body.clearTelegramChat!==false,deleteAiLogs:req.body.deleteAiLogs!==false,restrictTelegramId:req.body.restrictTelegramId===true});
            return res.status(200).json({ success: true, userId, action: 'delete_account', result });
          }

          default:
            return res.status(400).json({ error: 'Invalid action' });
        }
      } catch (e: any) {
        const code=e?.message;
        const status=['PROFILE_CHANGED','ACCOUNT_CHANGED'].includes(code)?409:code==='USER_NOT_FOUND'?404:503;
        return res.status(status).json({error:status===409?'USER_CHANGED':status===404?'USER_NOT_FOUND':'USER_UPDATE_FAILED'});
      }
    }
  }

  // ==========================================
  // 2. ROUTE: /api/admin/ai-keys
  // ==========================================
  if (route === 'ai-keys') {
    if (req.method === 'GET') {
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
          const envKey = process.env.GEMINI_API_KEY || "";
          if (envKey) {
            keys = [{
              id: 'env_default_gemini',
              name: 'Default Environment Gemini Key',
              provider: 'google',
              api_key: envKey,
              model: 'gemini-3.5-flash-lite',
              priority: 1,
              status: 'active',
              total_requests: 0,
              success_requests: 0,
              failed_requests: 0,
              created_at: nowIso,
              updated_at: nowIso
            }];
          }
        }

        const { data: aiLogs } = await supabase.from('ai_logs').select('id, timestamp').limit(1000);
        const todayStr = new Date().toISOString().slice(0, 10);
        const curMonth = new Date().getMonth();
        const curYear = new Date().getFullYear();

        let requestsToday = 0;
        let requestsMonth = 0;

        (aiLogs || []).forEach((l: any) => {
          if (l.timestamp) {
            const d = new Date(l.timestamp);
            if (l.timestamp.startsWith(todayStr)) requestsToday++;
            if (d.getMonth() === curMonth && d.getFullYear() === curYear) requestsMonth++;
          }
        });

        const safeKeys = keys.map((k: any) => {
          const lastUsed = k.last_used_at ? new Date(k.last_used_at) : null;
          const now = new Date();
          const isSameDay = lastUsed &&
            lastUsed.getUTCFullYear() === now.getUTCFullYear() &&
            lastUsed.getUTCMonth() === now.getUTCMonth() &&
            lastUsed.getUTCDate() === now.getUTCDate();

          let effectiveModel = k.model || 'gemini-3.5-flash-lite';
          if (effectiveModel === 'gemini-flash-latest' || effectiveModel.includes('2.0-flash') || effectiveModel.includes('3.1-flash')) {
            effectiveModel = 'gemini-3.5-flash-lite';
          }

          return {
            id: k.id,
            name: k.name || 'Unnamed Key',
            provider: k.provider || 'gemini',
            maskedKey: maskApiKey(k.api_key),
            model: effectiveModel,
            priority: k.priority || 1,
            status: k.is_active === false ? 'disabled' : (k.health_status || k.status || 'active'),
            isActive: k.is_active !== false,
            healthStatus: k.health_status || 'healthy',
            totalRequests: k.total_requests || 0,
            todayRequests: isSameDay ? (k.today_requests || 0) : 0,
            successRequests: k.success_requests || 0,
            failedRequests: k.failed_requests || 0,
            lastError: k.last_error || null,
            lastUsedAt: k.last_used_at || null,
            createdAt: k.created_at || nowIso,
            updatedAt: k.updated_at || nowIso,
          };
        });

        const metrics = {
          totalKeys: safeKeys.length,
          activeKeys: safeKeys.filter((k: any) => k.isActive).length,
          rateLimitedKeys: safeKeys.filter((k: any) => k.healthStatus === 'rate_limited').length,
          exhaustedKeys: safeKeys.filter((k: any) => k.healthStatus === 'quota_exhausted').length,
          disabledKeys: safeKeys.filter((k: any) => !k.isActive).length,
          requestsToday,
          requestsMonth,
          totalLogged: aiLogs?.length || 0
        };

        return res.status(200).json({ success: true, keys: safeKeys, metrics });
      } catch (err: any) {
        return res.status(500).json({ error: 'Failed to fetch AI keys' });
      }
    }

    if (req.method === 'POST') {
      try {
        const { action, keyData, keyId } = req.body || {};

        if (action === 'create') {
          const { name, provider, apiKey, model, priority } = keyData || {};
          if (!apiKey || !provider) {
            return res.status(400).json({ error: 'Missing required apiKey or provider' });
          }

          const trimmedKey = apiKey.trim();
          const keyPreview = trimmedKey.length > 4 ? `••••••••••••${trimmedKey.slice(-4)}` : '••••••••';
          const record = {
            name: name || `${provider.toUpperCase()} Key`,
            provider: provider === 'google' ? 'gemini' : (provider || 'gemini'),
            api_key: trimmedKey,
            key_preview: keyPreview,
            model: model || (provider === 'google' || provider === 'gemini' ? 'gemini-3.5-flash-lite' : 'gpt-4o-mini'),
            priority: Number(priority) || 1,
            is_active: true,
            health_status: 'healthy',
            total_requests: 0,
            today_requests: 0,
            created_at: nowIso,
            updated_at: nowIso
          };

          const { data, error } = await supabase.from('ai_keys').insert(record).select();
          if (error) {
            safeError('[ADMIN] AI key insert error:', error);
            return res.status(500).json({ error: 'Failed to save AI key' });
          }

          invalidateAiKeysCache();

          return res.status(200).json({
            success: true,
            message: 'AI kaliti muvaffaqiyatli saqlandi! 🔑',
            key: { ...(data?.[0] || record), api_key: undefined, maskedKey: keyPreview }
          });
        }

        if (action === 'update') {
          if (!keyId) return res.status(400).json({ error: 'Missing keyId' });
          const updatePayload: any = { updated_at: nowIso };

          if (keyData.name) updatePayload.name = keyData.name;
          if (keyData.provider) updatePayload.provider = keyData.provider === 'google' ? 'gemini' : keyData.provider;
          if (keyData.model) updatePayload.model = keyData.model;
          if (keyData.priority !== undefined) updatePayload.priority = Number(keyData.priority);
          if (keyData.isActive !== undefined) updatePayload.is_active = Boolean(keyData.isActive);
          if (keyData.status !== undefined) {
            updatePayload.is_active = keyData.status === 'active';
            updatePayload.health_status = keyData.status === 'active' ? 'healthy' : keyData.status;
          }
          if (keyData.apiKey && !keyData.apiKey.startsWith('••••')) {
            const trimmedKey = keyData.apiKey.trim();
            updatePayload.api_key = trimmedKey;
            updatePayload.key_preview = trimmedKey.length > 4 ? `••••••••••••${trimmedKey.slice(-4)}` : '••••••••';
          }

          await supabase.from('ai_keys').update(updatePayload).eq('id', keyId);
          invalidateAiKeysCache();
          return res.status(200).json({ success: true, message: 'AI kaliti yangilandi! ✏️' });
        }

        if (action === 'toggle') {
          if (!keyId) return res.status(400).json({ error: 'Missing keyId' });
          const { data: existing } = await supabase.from('ai_keys').select('is_active').eq('id', keyId).maybeSingle();
          const nextActive = !(existing?.is_active ?? true);
          await supabase.from('ai_keys').update({ 
            is_active: nextActive, 
            health_status: nextActive ? 'healthy' : 'disabled',
            updated_at: nowIso 
          }).eq('id', keyId);
          invalidateAiKeysCache();
          return res.status(200).json({ success: true, is_active: nextActive });
        }

        if (action === 'delete') {
          if (!keyId) return res.status(400).json({ error: 'Missing keyId' });
          await supabase.from('ai_keys').delete().eq('id', keyId);
          invalidateAiKeysCache();
          return res.status(200).json({ success: true, message: 'AI kaliti o\'chirildi 🗑️' });
        }

        if (action === 'test') {
          let keyToTest: { provider: any; api_key: string; model?: string } | null = null;
          if (keyId) {
            const { data: found } = await supabase.from('ai_keys').select('*').eq('id', keyId).maybeSingle();
            if (found) keyToTest = { provider: found.provider, api_key: found.api_key, model: found.model };
          }
          if (!keyToTest && keyData?.apiKey) {
            keyToTest = { provider: keyData.provider || 'google', api_key: keyData.apiKey, model: keyData.model };
          }
          if (!keyToTest || !keyToTest.api_key) return res.status(400).json({ error: 'No key provided to test' });

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
          return res.status(200).json({ success: true, ...testResult, error: testResult.error ? 'AI_KEY_TEST_FAILED' : undefined });
        }

        if (action === 'live_test') {
          const { prompt } = req.body || {};
          if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
            return res.status(400).json({ error: 'Missing prompt for live test' });
          }
          const startTime = Date.now();
          const aiResult = await executeAiWithRotation(prompt.trim());
          return res.status(200).json({
            success: aiResult.success,
            parsed: aiResult.success ? {
              type: aiResult.type || 'expense',
              amount: aiResult.amount,
              category: aiResult.category || 'Boshqa',
              note: aiResult.note || prompt,
              title: aiResult.title || aiResult.note || prompt,
              debtWho: aiResult.debtWho || ''
            } : null,
            latencyMs: Date.now() - startTime,
            providerUsed: aiResult.providerUsed || 'unknown',
            keyIdUsed: aiResult.keyIdUsed || 'unknown',
            error: aiResult.error ? 'AI_REQUEST_FAILED' : null
          });
        }

        return res.status(400).json({ error: 'Invalid action' });
      } catch (err: any) {
        return res.status(500).json({ error: 'Operation failed' });
      }
    }
  }

  // ==========================================
  // 3. ROUTE: /api/admin/ai-logs
  // ==========================================
  if (route === 'ai-logs') {
    if (req.method === 'GET') {
      try {
        const { data: suLogs, error } = await supabase
          .from('ai_logs')
          .select('*')
          .order('timestamp', { ascending: false })
          .limit(100);
        if (error) return res.status(503).json({ error: 'LOG_STORE_UNAVAILABLE' });

        if (!error && Array.isArray(suLogs)) {
          const formatted = suLogs.map(l => ({
            id: l.id,
            userId: l.user_id,
            queryType: l.query_type,
            promptSummary: l.prompt_summary,
            isPremium: l.is_premium,
            model: l.model || l.model_used || null,
            keySlot: l.key_slot || l.slot_used || null,
            latencyMs: l.latency_ms || l.latency || null,
            source: l.source || null,
            timestamp: l.timestamp || l.created_at,
            createdAt: l.created_at || l.timestamp
          }));
          return res.status(200).json({ success: true, count: formatted.length, logs: formatted, source: 'supabase' });
        }
        return res.status(200).json({ success: true, count: 0, logs: [] });
      } catch (e: any) {
        return res.status(500).json({ error: 'Failed to fetch AI logs' });
      }
    }
  }

  // Reset daily AI usage only for canonical Telegram users. Service role owns
  // this operation; browser credentials cannot update the users table.
  if (route === 'ai-query-counts') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    if (req.body?.action !== 'reset_all') return res.status(400).json({ error: 'INVALID_ACTION' });
    try {
      const ids: string[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data: rows, error } = await supabase.from('users')
          .select('id,telegram_id').order('id').range(offset, offset + 499);
        if (error) return res.status(503).json({ error: 'USER_STORE_UNAVAILABLE' });
        for (const row of rows || []) {
          if (/^moliya_user_tg_[0-9]+$/.test(row.id) &&
              String(row.telegram_id) === row.id.slice('moliya_user_tg_'.length)) ids.push(row.id);
        }
        if ((rows || []).length < 500) break;
      }
      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100);
        const { data, error } = await supabase.from('users').update({
          ai_query_count: 0, last_ai_query_at: nowIso, updated_at: nowIso
        }).in('id', batch).select('id');
        if (error || !Array.isArray(data) || data.length !== batch.length) {
          return res.status(503).json({ error: 'USER_STORE_UNAVAILABLE' });
        }
      }
      await logAdminAction('reset_all_ai_count', 'all', undefined, { usersReset: ids.length });
      return res.status(200).json({ success: true, usersReset: ids.length });
    } catch {
      return res.status(503).json({ error: 'USER_STORE_UNAVAILABLE' });
    }
  }

  // ==========================================
  // 4. ROUTE: /api/admin/analytics
  // ==========================================
  if (route === 'analytics') {
    if (req.method === 'GET') {
      try {
        const now = new Date();
        const dayAgo = new Date(now);
        dayAgo.setHours(dayAgo.getHours() - 24);
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 7);

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

        const categoryBreakdown: Record<string, number> = {};
        const userCounts: Record<string, number> = {};
        const premiumVsFree = { premium: 0, free: 0 };
        const hourlyHeatmap = Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 }));
        const dailyTrendMap: Record<string, number> = {};

        for (let i = 6; i >= 0; i--) {
          const d = new Date(now);
          d.setDate(d.getDate() - i);
          dailyTrendMap[d.toISOString().split('T')[0]] = 0;
        }

        if (logs) {
          for (const log of logs) {
            if (log.query_type) categoryBreakdown[log.query_type] = (categoryBreakdown[log.query_type] || 0) + 1;
            if (log.user_id) userCounts[log.user_id] = (userCounts[log.user_id] || 0) + 1;
            if (log.is_premium) premiumVsFree.premium++;
            else premiumVsFree.free++;

            if (log.timestamp) {
              const logDate = new Date(log.timestamp);
              if (logDate >= weekAgo) {
                hourlyHeatmap[logDate.getHours()].count++;
                const dateStr = log.timestamp.split('T')[0];
                if (dailyTrendMap[dateStr] !== undefined) dailyTrendMap[dateStr]++;
              }
            }
          }
        }

        const dailyTrend = Object.keys(dailyTrendMap).sort().map(date => ({ date, count: dailyTrendMap[date] }));
        const topUsers = Object.entries(userCounts).map(([user_id, count]) => ({ user_id, count })).sort((a, b) => b.count - a.count).slice(0, 10);

        return res.status(200).json({
          totalQueries: totalQueries || 0,
          todayQueries: todayQueries || 0,
          weekQueries: weekQueries || 0,
          categoryBreakdown,
          hourlyHeatmap,
          dailyTrend,
          topUsers,
          premiumVsFree
        });
      } catch (error: any) {
        return res.status(500).json({ error: 'INTERNAL_ERROR' });
      }
    }

    if (req.method === 'POST') {
      const { action } = req.body || {};
      if (action === 'reset') {
        try {
          const { error } = await supabase.from('ai_logs').delete().not('id', 'is', null);
          if (error) return res.status(503).json({ error: 'LOG_STORE_UNAVAILABLE' });
          await logAdminAction('clear_all_ai_logs', 'all');
          return res.status(200).json({ success: true, message: 'All analytics data cleared' });
        } catch {
          return res.status(503).json({ error: 'LOG_STORE_UNAVAILABLE' });
        }
      }
      return res.status(400).json({ error: 'Invalid action' });
    }
  }

  // ==========================================
  // 5b. ROUTE: /api/admin/clear-telegram-history
  // ==========================================
  if (route === 'clear-telegram-history') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
      const { userId, telegramId, messageIds = [], allUsers = false, sweepRecent = true } = req.body || {};
      if (typeof allUsers !== 'boolean' || typeof sweepRecent !== 'boolean' ||
          !Array.isArray(messageIds) || messageIds.length > 500 ||
          messageIds.some((id: any) => !Number.isSafeInteger(id) || id <= 0) ||
          (allUsers && (userId != null || telegramId != null || messageIds.length)) ||
          (!allUsers && (typeof userId !== 'string' || !/^moliya_user_tg_[1-9][0-9]{0,15}$/.test(userId) ||
            (telegramId != null && String(telegramId) !== userId.slice('moliya_user_tg_'.length))))) {
        return res.status(400).json({ error: 'RECIPIENT_MISMATCH' });
      }
      const BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
      if (!BOT_TOKEN) {
        return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN is not configured' });
      }

      // Helper: Process message deletion for a single chat
      async function deleteChatMessages(targetChatId: string | number, storedIds: number[], lastMsgId?: number) {
        const cleanChatId = String(targetChatId || '').replace(/[^\d-]/g, '');
        if (!cleanChatId) {
          return { attempted: 0, deleted: 0, alreadyAbsent: 0, notDeletable: 0, failed: 0 };
        }

        const idsToDelete = new Set<number>();
        (storedIds || []).forEach(id => {
          const num = typeof id === 'number' ? id : parseInt(String(id).replace(/\D/g, ''), 10);
          if (Number.isInteger(num) && num > 0) idsToDelete.add(num);
        });

        // Discover latest active message ID in the chat via minimal probe
        let topMsgId = lastMsgId && lastMsgId > 0 ? lastMsgId : null;
        if (sweepRecent || idsToDelete.size === 0) {
          try {
            const probeRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: cleanChatId,
                text: '·',
                disable_notification: true
              })
            });
            const probeData = await probeRes.json();
            if (probeData.ok && probeData.result?.message_id) {
              const probeId = probeData.result.message_id;
              topMsgId = Math.max(topMsgId || 0, probeId);
              idsToDelete.add(probeId);
              // Delete probe immediately
              await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: cleanChatId, message_id: probeId })
              }).catch(() => {});
            }
          } catch (probeErr) {
            safeWarn('[AdminDelete] Probe send warning:', probeErr);
          }
        }

        // Backward sweep up to 250 messages from top discovered message
        if (topMsgId && topMsgId > 0) {
          const minId = Math.max(1, topMsgId - 250);
          for (let m = topMsgId; m >= minId; m--) {
            idsToDelete.add(m);
          }
        }

        const idList = Array.from(idsToDelete).sort((a, b) => b - a);
        let deleted = 0;
        let alreadyAbsent = 0;
        let notDeletable = 0;
        let failed = 0;

        // Process in chunks of 25: try bulk deleteMessages first, then sub-batch fallback of 5 with throttle
        for (let i = 0; i < idList.length; i += 25) {
          const chunk = idList.slice(i, i + 25);
          try {
            const batchRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessages`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: cleanChatId, message_ids: chunk })
            });
            const batchData = await batchRes.json();
            if (batchData.ok) {
              deleted += chunk.length;
            } else {
              // Chunk failed (due to messages > 48h or undeletable). Delete individually in sub-batches of 5
              for (let j = 0; j < chunk.length; j += 5) {
                const sub = chunk.slice(j, j + 5);
                const indResults = await Promise.allSettled(
                  sub.map(async (msgId) => {
                    const sRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ chat_id: cleanChatId, message_id: msgId })
                    });
                    return await sRes.json();
                  })
                );

                indResults.forEach((r) => {
                  if (r.status === 'fulfilled') {
                    const d = r.value;
                    if (d.ok) {
                      deleted++;
                    } else {
                      const desc = (d.description || '').toLowerCase();
                      if (desc.includes('not found')) {
                        alreadyAbsent++;
                      } else if (desc.includes("can't be deleted") || desc.includes('cant be deleted') || desc.includes('everyone')) {
                        notDeletable++;
                      } else {
                        failed++;
                      }
                    }
                  } else {
                    failed++;
                  }
                });

                if (j + 5 < chunk.length) {
                  await new Promise(r => setTimeout(r, 25));
                }
              }
            }
          } catch {
            failed += chunk.length;
          }

          if (i + 25 < idList.length) {
            await new Promise(r => setTimeout(r, 30));
          }
        }

        // Send ReplyKeyboardRemove packet to permanently wipe client keyboard state
        try {
          const kbRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: cleanChatId,
              text: '🗑️ <i>Chat tarixi tozalandi.</i>',
              parse_mode: 'HTML',
              reply_markup: { remove_keyboard: true }
            })
          });
          const kbData = await kbRes.json();
          if (kbData.ok && kbData.result?.message_id) {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: cleanChatId, message_id: kbData.result.message_id })
            }).catch(() => {});
          }
        } catch {}

        return {
          attempted: idList.length,
          deleted,
          alreadyAbsent,
          notDeletable,
          failed
        };
      }

      // Case A: Targeted single user chat history clear
      if (userId && !allUsers) {
        const { data: userRow, error: userError } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
        if (userError) return res.status(503).json({ error: 'RECIPIENT_STORE_UNAVAILABLE' });
        if (!userRow || String(userRow.telegram_id) !== userId.slice('moliya_user_tg_'.length))
          return res.status(404).json({ error: 'USER_NOT_FOUND' });
        const allMatchedUsers: any[] = [userRow];
        const canonicalUserId = userRow.id;
        const cleanTgId = String(userRow.telegram_id);

        // 3. Extract real numeric message IDs (from DB across all aliases + explicitly passed from client)
        const messageIdsToDelete = new Set<number>();
        if (Array.isArray(messageIds)) {
          messageIds.forEach((id: any) => {
            const num = typeof id === 'number' ? id : parseInt(String(id).replace(/\D/g, ''), 10);
            if (Number.isInteger(num) && num > 0) messageIdsToDelete.add(num);
          });
        }
        for (const u of allMatchedUsers) {
          if (!/^moliya_user_tg_[0-9]+$/.test(u.id)) continue;
          const bMsgs: any[] = Array.isArray(u.onboarding?.bot_messages) ? u.onboarding.bot_messages : [];
          for (const m of bMsgs) {
            const numId = Number(m.message_id || m.messageId || (typeof m.id === 'string' && m.id.split('_').pop()));
            if (Number.isInteger(numId) && numId > 0) {
              messageIdsToDelete.add(numId);
            }
          }
        }

        let deletionSummary = { attempted: 0, deleted: 0, alreadyAbsent: 0, notDeletable: 0, failed: 0 };
        const lastMsgId = Number(userRow?.onboarding?.last_message_id) || 0;

        if (cleanTgId && cleanTgId !== '—') {
          deletionSummary = await deleteChatMessages(cleanTgId, Array.from(messageIdsToDelete), lastMsgId);
          safeLog(`[TelegramDelete] userId=${canonicalUserId} telegramId=${cleanTgId} attempted=${deletionSummary.attempted} deleted=${deletionSummary.deleted} alreadyAbsent=${deletionSummary.alreadyAbsent} notDeletable=${deletionSummary.notDeletable} failed=${deletionSummary.failed}`);
        }

        // 4. Targeted mark of stored message history records across ALL matched user rows (keeps in DB for Admin audit)
        let clearedDbRecords = 0;
        const nowIso = new Date().toISOString();
        for (const u of allMatchedUsers) {
          if (!/^moliya_user_tg_[0-9]+$/.test(u.id)) continue;
          const bMsgs: any[] = Array.isArray(u.onboarding?.bot_messages) ? u.onboarding.bot_messages : [];
          clearedDbRecords += bMsgs.length;
          const markedMsgs = bMsgs.map((m: any) => ({ ...m, tg_deleted: true, tg_deleted_at: nowIso }));
          const updatedOnboarding = {
            ...(u.onboarding || {}),
            bot_messages: markedMsgs,
            last_link_message_id: null,
            chat_cleared_at: nowIso
          };
          await updateProfileSnapshot(u.id, u, {
            onboarding: updatedOnboarding,
            updated_at: nowIso
          });
        }

        return res.status(200).json({
          success: true,
          userId: canonicalUserId,
          telegramId: cleanTgId,
          summary: deletionSummary,
          database: {
            clearedRecords: clearedDbRecords
          }
        });
      }

      // Case B: Global message wipe for all users
      if (allUsers) {
        const { data: allUserRows, error: usersError } = await supabase.from('users').select('id, telegram_id, onboarding');
        if (usersError) return res.status(503).json({ error: 'RECIPIENT_STORE_UNAVAILABLE' });
        let totalAttempted = 0;
        let totalDeleted = 0;
        let totalAlreadyAbsent = 0;
        let totalNotDeletable = 0;
        let totalFailed = 0;
        let usersPurged = 0;
        let totalDbCleared = 0;

        for (const u of (allUserRows || [])) {
          if (!/^moliya_user_tg_[0-9]+$/.test(u.id)) continue;
          const uTgId = String(u.telegram_id || '');
          if (uTgId !== u.id.slice('moliya_user_tg_'.length)) continue;

          const uMsgs: any[] = Array.isArray(u.onboarding?.bot_messages) ? u.onboarding.bot_messages : [];
          const uMsgIds: number[] = uMsgs
            .map(m => Number(m.message_id))
            .filter(id => Number.isInteger(id) && id > 0);
          const uLastId = Number(u.onboarding?.last_message_id) || 0;

          if (uTgId && uTgId !== '—') {
            const sum = await deleteChatMessages(uTgId, uMsgIds, uLastId);
            totalAttempted += sum.attempted;
            totalDeleted += sum.deleted;
            totalAlreadyAbsent += sum.alreadyAbsent;
            totalNotDeletable += sum.notDeletable;
            totalFailed += sum.failed;
            safeLog(`[TelegramDelete] Global user=${u.id} tgId=${uTgId} deleted=${sum.deleted} absent=${sum.alreadyAbsent} notDeletable=${sum.notDeletable}`);
          }

          // Mark bot_messages as tg_deleted in onboarding (preserve for Admin audit)
          totalDbCleared += uMsgs.length;
          const markedObMsgs = uMsgs.map((m: any) => ({ ...m, tg_deleted: true, tg_deleted_at: new Date().toISOString() }));
          const updatedOb = { ...(u.onboarding || {}), bot_messages: markedObMsgs, last_link_message_id: null, chat_cleared_at: new Date().toISOString() };
          await updateProfileSnapshot(u.id, u, { onboarding: updatedOb, updated_at: new Date().toISOString() });
          usersPurged++;

          // Gentle throttle
          await new Promise(r => setTimeout(r, 40));
        }

        return res.status(200).json({
          success: true,
          totalUsers: allUserRows?.length || 0,
          usersPurged,
          summary: {
            attempted: totalAttempted,
            deleted: totalDeleted,
            alreadyAbsent: totalAlreadyAbsent,
            notDeletable: totalNotDeletable,
            failed: totalFailed
          },
          database: {
            clearedRecords: totalDbCleared
          }
        });
      }

      return res.status(400).json({ error: 'Missing userId or allUsers parameter' });
    } catch (e: any) {
      safeError('[TelegramDelete] Error:', e);
      return res.status(500).json({ error: 'Clear telegram history failed' });
    }
  }

  // ==========================================
  // 5c. ROUTE: /api/admin/bot-messages
  // ==========================================
  if (route === 'bot-messages') {
    if (!['GET','POST'].includes(req.method || '')) return res.status(405).json({ error: 'Method not allowed' });

    try {
      res.setHeader('Cache-Control','private, no-store');
      const userId = req.method==='POST'?req.body?.userId:req.query.userId;
      if(typeof userId!=='string'||!/^moliya_user_tg_[0-9]+$/.test(userId))return res.status(400).json({error:'INVALID_USER_ID'});

      const { data: userRow, error } = await supabase.from('users').select('id, name, telegram, telegram_id, onboarding').eq('id', userId).maybeSingle();
      if (error) return res.status(500).json({ error: 'INTERNAL_ERROR' });

      if(!userRow || String(userRow.telegram_id)!==userId.replace('moliya_user_tg_',''))return res.status(404).json({error:'USER_NOT_FOUND'});

      const rawMessages = Array.isArray(userRow?.onboarding?.bot_messages) ? userRow.onboarding.bot_messages : [];
      const messages = rawMessages.map((m: any) => {
        const fileId = m.metadata?.file_id;
        return {
          ...m,
          fileDownloadUrl: fileId ? `/api/admin?route=telegram-file&fileId=${encodeURIComponent(fileId)}&download=1` : null,
          filePreviewUrl: fileId ? `/api/admin?route=telegram-file&fileId=${encodeURIComponent(fileId)}` : null
        };
      });

      return res.status(200).json({
        success: true,
        userId,
        messagesCount: messages.length,
        messages
      });
    } catch (e: any) {
      return res.status(500).json({ error: 'Failed to fetch bot messages' });
    }
  }

  // Database-only chat history changes (legacy messages and explicit purge).
  // Telegram delivery is handled separately by adminTelegram, which also
  // persists successful send/edit/delete operations once.
  if (route === 'bot-message') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    const { userId, messageId, action, text } = req.body || {};
    if (typeof userId !== 'string' || !/^moliya_user_tg_[0-9]+$/.test(userId)) return res.status(400).json({ error: 'INVALID_USER_ID' });
    if (typeof messageId !== 'string' && !Number.isSafeInteger(messageId)) return res.status(400).json({ error: 'INVALID_MESSAGE_ID' });
    if (String(messageId).length > 100 || !['edit','delete','purge'].includes(action)) return res.status(400).json({ error: 'INVALID_MESSAGE_ACTION' });
    if (action === 'edit' && (typeof text !== 'string' || !text.trim() || text.length > 4096)) return res.status(400).json({ error: 'INVALID_MESSAGE_TEXT' });
    try {
      const { data: user, error } = await supabase.from('users').select('id,telegram_id,onboarding').eq('id', userId).maybeSingle();
      if (error) return res.status(503).json({ error: 'USER_STORE_UNAVAILABLE' });
      if (!user || String(user.telegram_id) !== userId.slice('moliya_user_tg_'.length)) return res.status(404).json({ error: 'USER_NOT_FOUND' });
      const old = Array.isArray(user.onboarding?.bot_messages) ? user.onboarding.bot_messages : [];
      const target = old.find((m:any) => (m.id != null && String(m.id) === String(messageId)) ||
        (m.message_id != null && String(m.message_id) === String(messageId)) ||
        (m.messageId != null && String(m.messageId) === String(messageId)));
      if (!target) return res.status(404).json({ error: 'MESSAGE_NOT_FOUND' });
      if (action === 'edit' && (target.direction === 'user_to_bot' || target.sender === 'user')) return res.status(403).json({ error: 'MESSAGE_EDIT_DENIED' });
      const matches = (m:any) => m === target;
      const timestamp = new Date().toISOString();
      const messages = action === 'purge' ? old.filter((m:any) => !matches(m)) : old.map((m:any) => !matches(m) ? m :
        action === 'edit' ? { ...m, text: text.trim(), edited: true, edited_at: timestamp } :
        { ...m, tg_deleted: true, tg_deleted_at: timestamp });
      await updateProfileSnapshot(userId, user, { onboarding: { ...user.onboarding, bot_messages: messages,
        ...(action === 'purge' && Number(user.onboarding?.last_link_message_id) === Number(target.message_id) ? { last_link_message_id: null } : {}) } });
      await logAdminAction('bot_message_'+action, userId, undefined, { messageId: String(messageId) });
      return res.status(200).json({ success: true, changed: true });
    } catch {
      return res.status(503).json({ error: 'MESSAGE_STORE_UNAVAILABLE' });
    }
  }

  // ==========================================
  // ROUTE: /api/admin/telegram-file
  // Open / download any file (photos, audio, receipts, documents) sent to the bot
  // ==========================================
  if (route === 'telegram-file') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    try {
      const fileId = req.query.fileId as string;
      if (!fileId) return res.status(400).json({ error: 'Missing fileId parameter' });

      const BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
      if (!BOT_TOKEN) return res.status(500).json({ error: 'Missing TELEGRAM_BOT_TOKEN' });

      const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
      const tgData: any = await tgRes.json();

      if (!tgData.ok || !tgData.result?.file_path) {
        return res.status(404).json({ error: 'File not found on Telegram servers' });
      }

      const filePath = tgData.result.file_path;
      const tgFileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

      // Secure Server-Side Streaming Proxy:
      // Stream buffer directly through the server so TELEGRAM_BOT_TOKEN is NEVER exposed to the browser
      const ext = (filePath.split('.').pop() || 'bin').toLowerCase();
      let mimeType = 'application/octet-stream';
      if (ext === 'oga' || ext === 'ogg') {
        mimeType = 'audio/ogg; codecs=opus';
      } else if (ext === 'mp3') {
        mimeType = 'audio/mpeg';
      } else if (ext === 'm4a' || ext === 'aac') {
        mimeType = 'audio/mp4';
      } else if (ext === 'wav') {
        mimeType = 'audio/wav';
      } else if (ext === 'jpg' || ext === 'jpeg') {
        mimeType = 'image/jpeg';
      } else if (ext === 'png') {
        mimeType = 'image/png';
      } else if (ext === 'webp') {
        mimeType = 'image/webp';
      } else if (ext === 'gif') {
        mimeType = 'image/gif';
      } else if (ext === 'mp4') {
        mimeType = 'video/mp4';
      } else if (ext === 'mov') {
        mimeType = 'video/quicktime';
      } else if (ext === 'pdf') {
        mimeType = 'application/pdf';
      } else {
        mimeType = 'application/octet-stream';
      }

      if (req.query.download === '1' || req.query.raw === '1' || req.query.stream === '1') {
        const streamRes = await fetch(tgFileUrl);
        if (!streamRes.ok) {
          return res.status(streamRes.status).json({ error: 'Failed to stream file from Telegram servers' });
        }
        const arrayBuf = await streamRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        const fileName = `moliya_tg_${fileId.slice(-8)}.${ext}`;

        res.setHeader('Content-Type', mimeType);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'private, no-store');
        handleCors(req, res, { adminOnly: true });

        const totalLength = buffer.length;
        const range = req.headers.range;

        if (range && req.query.download !== '1') {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          let start=0, end=totalLength-1;
          if(match && match[1]) {start=Number(match[1]);if(match[2]) end=Math.min(Number(match[2]),totalLength-1);}
          else if(match && match[2]) {start=Math.max(0,totalLength-Number(match[2]));}
          if(!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start<0 || start>=totalLength || end<start) {
            res.setHeader('Content-Range',`bytes */${totalLength}`);
            return res.status(416).end();
          }
          const chunkSize = end-start+1;
          const chunk = buffer.slice(start, end + 1);

          res.status(206);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${totalLength}`);
          res.setHeader('Content-Length', chunkSize);
          res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
          return res.send(chunk);
        }

        res.setHeader('Content-Length', totalLength);
        if (req.query.download === '1') {
          res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        } else {
          res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
        }
        return res.status(200).send(buffer);
      }

      const safeDownloadUrl = `/api/admin?route=telegram-file&fileId=${encodeURIComponent(fileId)}&download=1`;
      const safeStreamUrl = `/api/admin?route=telegram-file&fileId=${encodeURIComponent(fileId)}&raw=1`;

      return res.status(200).json({
        success: true,
        fileId,
        filePath,
        fileName: `moliya_tg_${fileId.slice(-8)}.${ext}`,
        fileSize: tgData.result.file_size,
        mimeType,
        directUrl: safeStreamUrl,
        downloadUrl: safeDownloadUrl,
        streamUrl: safeStreamUrl,
        isImage: /\.(jpe?g|png|webp|gif)$/i.test(filePath),
        isAudio: /\.(oga|ogg|mp3|m4a|wav)$/i.test(filePath),
        isVideo: /\.(mp4|mov)$/i.test(filePath)
      });
    } catch (err: any) {
      return res.status(500).json({ error: 'Failed to retrieve Telegram file' });
    }
  }

  // ==========================================
  // ROUTE: /api/admin/app-settings
  // ==========================================
  if (route === 'app-settings') {
    if (req.method === 'GET') {
      try {
        const { data, error } = await supabase
          .from('users')
          .select('onboarding')
          .eq('id', 'system_app_settings')
          .maybeSingle();

        if (error) return res.status(500).json({ error: 'INTERNAL_ERROR' });
        return res.status(200).json({
          oferta_text: data?.onboarding?.oferta_text || null,
          privacy_policy: data?.onboarding?.privacy_policy || null,
          default_ai_quota: defaultAiQuotaFromOnboarding(data?.onboarding),
          ai_parser_guidance: typeof data?.onboarding?.ai_parser_guidance === 'string'
            ? data.onboarding.ai_parser_guidance : '',
          updated_at: data?.onboarding?.updated_at || null
        });
      } catch (err: any) {
        return res.status(500).json({ error: 'INTERNAL_ERROR' });
      }
    }

    if (req.method === 'POST') {
      try {
        const { privacy_policy, oferta_text, default_ai_quota, ai_parser_guidance } = req.body || {};
        const keys = Object.keys(req.body || {});
        if (keys.length !== 1 || !['privacy_policy', 'oferta_text', 'default_ai_quota', 'ai_parser_guidance'].includes(keys[0]))
          return res.status(400).json({ error: 'INVALID_SETTINGS_KEY' });
        const value = keys[0] === 'privacy_policy' ? privacy_policy : keys[0] === 'oferta_text' ? oferta_text
          : keys[0] === 'default_ai_quota' ? default_ai_quota : ai_parser_guidance;
        if (keys[0] === 'default_ai_quota') {
          if (!Number.isInteger(value) || value < 1 || value > 500)
            return res.status(400).json({ error: 'INVALID_AI_QUOTA' });
        } else if (keys[0] === 'ai_parser_guidance') {
          if (typeof value !== 'string' || value.length > 2000)
            return res.status(400).json({ error: 'INVALID_AI_GUIDANCE' });
        } else if (typeof value !== 'string' || !value.trim() || value.length > 100000)
          return res.status(400).json({ error: 'INVALID_LEGAL_TEXT' });
        const nowIso = new Date().toISOString();

        const { data: existing, error: readError } = await supabase
          .from('users')
          .select('onboarding')
          .eq('id', 'system_app_settings')
          .maybeSingle();
        if (readError) return res.status(503).json({ error: 'SETTINGS_STORE_UNAVAILABLE' });

        const updatedOnboarding = {
          ...(existing?.onboarding || {}),
          updated_at: nowIso
        };
        (updatedOnboarding as any)[keys[0]] = typeof value === 'string' ? value.trim() : value;

        const { error } = await supabase.from('users').upsert({
          id: 'system_app_settings',
          name: '[SYSTEM_APP_SETTINGS]',
          onboarding: updatedOnboarding,
          updated_at: nowIso
        }, { onConflict: 'id' });

        if (error) return res.status(500).json({ error: 'INTERNAL_ERROR' });
        if (keys[0] === 'ai_parser_guidance') invalidateAiParserGuidance();

        await logAdminAction('UPDATE_APP_SETTINGS', undefined, undefined, {
          updated_keys: Object.keys(req.body || {})
        });

        return res.status(200).json({ success: true, onboarding: updatedOnboarding });
      } catch (err: any) {
        return res.status(500).json({ error: 'INTERNAL_ERROR' });
      }
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (route === 'free-ai-quota') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    if (req.body?.action !== 'reset_overrides' || Object.keys(req.body || {}).length !== 1)
      return res.status(400).json({ error: 'INVALID_QUOTA_ACTION' });
    try {
      const { data, error } = await supabase.rpc('moliya_reset_free_ai_overrides');
      if (error || !Number.isInteger(data) || data < 0)
        return res.status(503).json({ error: 'QUOTA_STORE_UNAVAILABLE' });
      await logAdminAction('RESET_FREE_AI_OVERRIDES', undefined, undefined, { usersChanged: data });
      return res.status(200).json({ success: true, usersChanged: data });
    } catch { return res.status(503).json({ error: 'QUOTA_STORE_UNAVAILABLE' }); }
  }

  // ==========================================
  // 6. ROUTE: /api/admin/notifications
  // ==========================================
  if (route === 'notifications') {
    if (req.method === 'GET') {
      try {
        const { data, error } = await supabase
          .from('app_notifications')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50);

        if (error) return res.status(500).json({ error: 'INTERNAL_ERROR' });
        return res.status(200).json(data);
      } catch (err: any) {
        return res.status(500).json({ error: 'INTERNAL_ERROR' });
      }
    }

    if (req.method === 'POST') {
      const {action,id}=req.body||{};
      if(!['create','insert','update','delete'].includes(action))return res.status(400).json({error:'INVALID_ACTION'});
      if(['update','delete'].includes(action) && (typeof id!=='string'||!id||id.length>128))return res.status(400).json({error:'INVALID_NOTIFICATION_ID'});
      let payload:any;
      try{if(action!=='delete')payload=notificationPayload(req.body,action==='update');}
      catch{return res.status(400).json({error:'INVALID_NOTIFICATION'});}
      try {
        if(payload?.target?.startsWith('moliya_user_tg_')) {
          const {data:recipient,error:recipientError}=await supabase.from('users').select('id').eq('id',payload.target).maybeSingle();
          if(recipientError)return res.status(503).json({error:'NOTIFICATIONS_UNAVAILABLE'});
          if(!recipient)return res.status(404).json({error:'USER_NOT_FOUND'});
        }
        const table=supabase.from('app_notifications');
        const query=action==='delete'?table.delete().eq('id',id):action==='update'?table.update(payload).eq('id',id):table.insert([{...payload,created_at:new Date().toISOString()}]);
        const {data,error}=await query.select().maybeSingle();
        if(error)return res.status(503).json({error:'NOTIFICATIONS_UNAVAILABLE'});
        if(!data)return res.status(action==='create'||action==='insert'?503:404).json({error:'NOTIFICATION_NOT_FOUND'});
        try { await logAdminAction(`notification_${action === 'insert' ? 'create' : action}`, data.target?.startsWith('moliya_user_tg_') ? data.target : undefined, undefined, { notificationId: data.id }); } catch {}
        return res.status(200).json({success:true,notification:data});
      }catch{return res.status(503).json({error:'NOTIFICATIONS_UNAVAILABLE'});}
    }
    return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
  }

  // ==========================================
  // 7. Server-owned daily reminder switch
  // ==========================================
  if (route === 'automation-rules') {
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
    const payload=req.body || {};
    const keys=Object.keys(payload).sort().join(',');
    const ruleIds=['daily_reminder','quota_exhausted','trial_expiry','weekly_digest'];
    const slotsValid=Array.isArray(payload.enabledSlots) &&
      payload.enabledSlots.length <= reminderSlots.length &&
      new Set(payload.enabledSlots).size === payload.enabledSlots.length &&
      payload.enabledSlots.every((slot:unknown)=>typeof slot==='string' && reminderSlots.includes(slot as ReminderSlot));
    if (req.method === 'POST' && (!ruleIds.includes(payload.ruleId) ||
        !((keys==='enabled,ruleId' && typeof payload.enabled==='boolean') ||
          (payload.ruleId==='daily_reminder' && keys==='enabledSlots,ruleId' && slotsValid))))
      return res.status(400).json({error:'INVALID_AUTOMATION_RULE'});
    try {
      const table=supabase.from('moliya_automation_rules');
      if(req.method==='GET'){
        const {data,error}=await table.select('rule_id,enabled,enabled_slots');
        if(error || !Array.isArray(data) || ruleIds.some(id=>!data.some(r=>r.rule_id===id)))
          return res.status(503).json({error:'AUTOMATION_STORE_UNAVAILABLE'});
        return res.status(200).json({success:true,rules:Object.fromEntries(data.map(r=>[r.rule_id,{enabled:r.enabled,enabledSlots:r.enabled_slots}]))});
      }
      const {data,error}=await table.update({...(keys==='enabledSlots,ruleId'?{enabled_slots:payload.enabledSlots}:{enabled:payload.enabled}),updated_at:new Date().toISOString()})
        .eq('rule_id',payload.ruleId).select('rule_id,enabled,enabled_slots').maybeSingle();
      if(error || !data) return res.status(503).json({error:'AUTOMATION_STORE_UNAVAILABLE'});
      if(req.method === 'POST') await logAdminAction('SET_AUTOMATION_RULE',undefined,undefined,{ruleId:payload.ruleId,enabled:data.enabled,enabledSlots:data.enabled_slots});
      return res.status(200).json({success:true,ruleId:data.rule_id,enabled:data.enabled,enabledSlots:data.enabled_slots});
    } catch {return res.status(503).json({error:'AUTOMATION_STORE_UNAVAILABLE'});}
  }

  if (route === 'scheduled-report-settings') {
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
    const ids = ['scheduled_weekly_report','scheduled_monthly_report'];
    const body = req.body || {};
    if (req.method === 'POST' && (Object.keys(body).sort().join(',') !== 'enabled,ruleId' ||
      !ids.includes(body.ruleId) || typeof body.enabled !== 'boolean'))
      return res.status(400).json({error:'INVALID_REPORT_SETTINGS'});
    try {
      const table = supabase.from('moliya_automation_rules');
      if (req.method === 'GET') {
        const {data,error} = await table.select('rule_id,enabled').in('rule_id',ids);
        if (error || !Array.isArray(data) || ids.some(id => !data.some(row => row.rule_id === id)))
          return res.status(503).json({error:'REPORT_SETTINGS_UNAVAILABLE'});
        return res.status(200).json({success:true,weeklyEnabled:data.find(row=>row.rule_id===ids[0])!.enabled,
          monthlyEnabled:data.find(row=>row.rule_id===ids[1])!.enabled});
      }
      const {data,error} = await table.update({enabled:body.enabled,updated_at:new Date().toISOString()})
        .eq('rule_id',body.ruleId).select('rule_id,enabled').maybeSingle();
      if (error || !data) return res.status(503).json({error:'REPORT_SETTINGS_UNAVAILABLE'});
      await logAdminAction('SET_SCHEDULED_REPORT',undefined,undefined,{ruleId:data.rule_id,enabled:data.enabled});
      return res.status(200).json({success:true,ruleId:data.rule_id,enabled:data.enabled});
    } catch {return res.status(503).json({error:'REPORT_SETTINGS_UNAVAILABLE'});}
  }

  if (route === 'automation-due') {
    if(req.method!=='GET' && req.method!=='POST')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
    const ruleId=req.method==='GET'?req.query.ruleId:req.body?.ruleId;
    if(ruleId!=='trial_expiry' && ruleId!=='weekly_digest')return res.status(400).json({error:'INVALID_AUTOMATION_RULE'});
    const action=req.method==='POST'?req.body?.action:'send';
    if(action!=='preview' && action!=='send')return res.status(400).json({error:'INVALID_AUTOMATION_ACTION'});
    try {
      if(!await ruleEnabled(ruleId))return res.status(200).json({success:true,enabled:false,totalTargeted:0,sent:0});
      const now=new Date();
      const users:any[]=[];
      for(let offset=0;offset<10000;offset+=500){
        const {data,error}=await supabase.from('users').select('*')
          .order('updated_at',{ascending:false}).order('id',{ascending:true}).range(offset,offset+499);
        if(error || !Array.isArray(data))return res.status(503).json({error:'USER_STORE_UNAVAILABLE'});
        users.push(...data);
        if(data.length<500)break;
        if(offset+500>=10000)return res.status(503).json({error:'USER_LIST_TOO_LARGE'});
      }
      const recipients=dueAutomationUsers(users,ruleId,now);
      if(action==='preview')return res.status(200).json({success:true,enabled:true,totalTargeted:recipients.length});
      let sent=0,duplicate=0,failed=0;
      for(let i=0;i<recipients.length;i+=10){
        const results=await Promise.all(recipients.slice(i,i+10).map(({user,occurrence,message})=>
          notifyAutomation(user,ruleId,occurrence,true,message)));
        sent+=results.filter(x=>x==='sent').length;
        duplicate+=results.filter(x=>x==='duplicate').length;
        failed+=results.filter(x=>x==='failed').length;
        if(i+10<recipients.length)await new Promise(r=>setTimeout(r,400));
      }
      if(req.method==='POST')await logAdminAction('RUN_AUTOMATION_RULE',undefined,undefined,{ruleId,sent,duplicate,failed});
      return res.status(failed?503:200).json({success:!failed,enabled:true,totalTargeted:recipients.length,sent,duplicate,failed});
    }catch{return res.status(503).json({error:'AUTOMATION_UNAVAILABLE'});}
  }

  // ==========================================
  // 8. ROUTE: /api/admin/auto-broadcast
  // ==========================================
  if (route === 'auto-broadcast') {
    if (req.method !== 'POST' && req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
      const cronSlot = req.method === 'GET' ? req.query.slot : null;
      if (req.method === 'GET' && (typeof cronSlot !== 'string' || !reminderSlots.includes(cronSlot as ReminderSlot)))
        return res.status(400).json({ error: 'INVALID_REMINDER_SLOT' });
      const action=req.method === 'POST' ? req.body?.action : null;
      if(req.method === 'POST' && !['preview','send'].includes(action))
        return res.status(400).json({error:'INVALID_AUTOMATION_ACTION'});
      if(req.method==='GET' && cronSlot==='evening'){
        try {await cleanupAutomationClaims();} catch {safeWarn('[AUTOMATION] Retention cleanup unavailable');}
      }
      const {data:rule,error:ruleError}=await supabase.from('moliya_automation_rules')
        .select('enabled,enabled_slots').eq('rule_id','daily_reminder').maybeSingle();
      if(ruleError || !rule) return res.status(503).json({error:'AUTOMATION_STORE_UNAVAILABLE'});
      if(!rule.enabled) return res.status(200).json({success:true,enabled:false,totalTargeted:0,sent:0,appSaved:0});
      const slot = req.method === 'GET' ? cronSlot as ReminderSlot : null;
      if(slot && (!Array.isArray(rule.enabled_slots) || !rule.enabled_slots.includes(slot)))
        return res.status(200).json({success:true,enabled:true,slotEnabled:false,totalTargeted:0,sent:0,appSaved:0});
      const now = new Date();
      const localDay = tashkentDay(now);
      const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
      const appUrl = process.env.APP_URL || 'https://moliya-ai-pi.vercel.app';

      // 1. Pick a smart rotating daily reminder
      const DAILY_REMINDERS = [
        {
          title: "💰 Kunlik hisob-kitob vaqti!",
          text: "💰 <b>Bugungi xarajatlaringizni Moliya'ga kiritdingizmi?</b>\n\nHar bir so'm nazoratingiz ostida bo'lsin — bir zumda xarajatlarni yozib yoki ovozli xabar orqali yuboring! 🎙✨",
          emoji: "💰"
        },
        {
          title: "📊 Moliyaviy intizom va nazorat",
          text: "📊 <b>Har bir xarajat muhim!</b>\n\nBugungi barcha sarf-xarajatlaringizni qayd etishni unutmang. Moliya sizga oylik byudjetingizni tejashda yordam beradi! 🚀",
          emoji: "📊"
        },
        {
          title: "🎙️ Ovozli xabar bilan bir zumda!",
          text: "🎙️ <b>Yozish o‘rniga ovoz yuboring!</b>\n\nMasalan: <i>\"tushlikka 45 ming sarfladim\"</i>. Ma’lumotni tekshirib tasdiqlaganingizdan keyin saqlanadi.",
          emoji: "🎙️"
        },
        {
          title: "🛒 Bozorlik va xaridlar hisobi",
          text: "🛒 <b>Bugungi xarid va to'lovlaringizni unutmasdan kiriting!</b>\n\nMoliya bilan byudjetingiz doim tartibda bo'ladi. 👇",
          emoji: "🛒"
        },
        {
          title: "💡 Kun yakunida hisob-kitob",
          text: "💡 <b>Kun yakunida balansingizni tekshiring:</b>\n\nBugungi xarajatlarni kiritib, aniq hisobga ega bo'ling. Moliyaviy erkinlik sari olg'a! 🎯",
          emoji: "💡"
        }
      ];

      const dayOfYear = Math.floor(Date.parse(localDay) / 86400000);
      const reminder = DAILY_REMINDERS[dayOfYear % DAILY_REMINDERS.length];

      // 2. Fetch all eligible active users from Supabase
      const users:any[]=[];
      for(let offset=0;offset<10000;offset+=500){
        const {data,error}=await supabase.from('users').select('*')
          .order('updated_at',{ascending:false}).order('id',{ascending:true}).range(offset,offset+499);
        if(error || !Array.isArray(data))return res.status(503).json({error:'USER_STORE_UNAVAILABLE'});
        users.push(...data);
        if(data.length<500)break;
        if(offset+500>=10000)return res.status(503).json({error:'USER_LIST_TOO_LARGE'});
      }

      const eligibleUsers: Array<{ id: string; name: string; telegramId: string }> = [];
      let skippedCount = 0;
      let skippedNotDue = 0;

      (users || []).forEach((u: any) => {
        if (!eligibleUser(u)) {skippedCount++;return;}
        const id = String(u.id || '');
        if (id.startsWith('req_') || id.startsWith('exchange_') || id.startsWith('sess_') || id.startsWith('moliya_user_req_')) {
          skippedCount++;
          return;
        }
        const isBlocked = Boolean(u.is_blocked || u.onboarding?.is_blocked || u.onboarding?.is_restricted || u.device_info?.is_blocked);
        if (isBlocked) {
          skippedCount++;
          return;
        }
        const isDeleted = Boolean(u.is_deleted || u.onboarding?.is_deleted || u.account_status === 'deleted');
        if (isDeleted) {
          skippedCount++;
          return;
        }
        const tgId = u.telegram_id || u.onboarding?.telegramId || (id.startsWith('moliya_user_tg_') ? id.replace('moliya_user_tg_', '') : null);
        if (!tgId || tgId === '—' || String(tgId).trim() === '') {
          skippedCount++;
          return;
        }

        if (!shouldRemind(u, slot, now)) {
          skippedNotDue++;
          return;
        }

        eligibleUsers.push({
          id: u.id,
          name: u.name || u.onboarding?.name || 'Foydalanuvchi',
          telegramId: String(tgId).trim()
        });
      });

      // Deduplicate by Telegram ID
      const seenTg = new Set<string>();
      const uniqueRecipients = eligibleUsers.filter(u => {
        if (seenTg.has(u.telegramId)) return false;
        seenTg.add(u.telegramId);
        return true;
      });

      if(action==='preview') return res.status(200).json({success:true,enabled:true,
        totalTargeted:uniqueRecipients.length,channels:['telegram','app'],reminderSelected:reminder.title});

      let sentCount = 0;
      let failedCount = 0;
      let appSaved = 0;
      let skippedDuplicate = 0;
      let claimFailures = 0;

      const deliver = async (rec: typeof uniqueRecipients[number]) => {
        // Insert first: a repeated or concurrent cron run cannot deliver twice.
        const { data: claimed, error: claimError } = await supabase.from('moliya_reminder_delivery')
          .insert({ user_id: rec.id, local_day: localDay }).select('user_id').maybeSingle();
        if (claimError?.code === '23505') { skippedDuplicate++; return; }
        if (claimError || !claimed) { claimFailures++; return; }
        if (BOT_TOKEN) {
          try {
            const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: rec.telegramId,
                text: reminder.text,
                parse_mode: 'HTML',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "📱 Moliya Mini Appni ochish", web_app: { url: appUrl } }]
                  ]
                }
              })
            });
            const data = await resp.json();
            if (data.ok) sentCount++;
            else failedCount++;
          } catch {
            failedCount++;
          }
        }
        // A per-user target honors opt-out; no global notification bypass.
        const {error:notificationError} = await supabase.from('app_notifications').insert([{
          title: reminder.title,
          message: reminder.text.replace(/<[^>]*>/g, ''),
          target: rec.id,
          is_active: true,
          created_at: now.toISOString()
        }]);
        if (notificationError) { failedCount++; safeError('[AUTO_BROADCAST] Notification persistence failed'); }
        else appSaved++;
      };
      // Ten concurrent deliveries per batch; cap starts to about 25/sec for Telegram.
      for (let i = 0; i < uniqueRecipients.length; i += 10) {
        await Promise.all(uniqueRecipients.slice(i, i + 10).map(deliver));
        if (i + 10 < uniqueRecipients.length) await new Promise(r => setTimeout(r, 400));
      }

      return res.status(claimFailures ? 503 : 200).json({
        success: claimFailures === 0,
        reminderSelected: reminder.title,
        notificationSaved: appSaved === uniqueRecipients.length - skippedDuplicate - claimFailures,
        appSaved,
        skippedDuplicate,
        claimFailures,
        totalTargeted: uniqueRecipients.length,
        sent: sentCount,
        failed: failedCount,
        skipped: skippedCount,
        skippedNotDue
      });
    } catch (err: any) {
      return res.status(500).json({ error: 'Auto-broadcast failed' });
    }
  }

  // ── USER SEARCH ─────────────────────────────────────────────
  if (route === 'user-search') {
    const q = (typeof req.query.q === 'string' ? req.query.q : '').trim().toLowerCase();
    if (!q || q.length < 2) return res.status(400).json({ error: 'Search query too short (min 2 chars)' });

    try {
      const { data: allUsers, error } = await supabase.from('users').select('*');
      if (error) return res.status(500).json({ error: 'Search failed' });

      const defaultQuota=defaultAiQuotaFromOnboarding((allUsers||[]).find(s=>s.id==='system_app_settings')?.onboarding);
      const results = (allUsers || []).filter(u => {
        if (u.id?.startsWith('req_') || u.id?.startsWith('exchange_')) return false;
        const fields = [
          u.name, u.phone, u.telegram, u.telegram_id?.toString(),
          u.onboarding?.name, u.onboarding?.phone, u.onboarding?.telegram,
          u.onboarding?.telegramId?.toString(), u.id
        ].filter(Boolean).map(f => String(f).toLowerCase());
        return fields.some(f => f.includes(q));
      }).map(u => {
        const access = effectiveAccess(u,defaultQuota);
        const status = accountStatus(u);
        return {
          id: u.id, name: u.name, phone: u.phone, telegram: u.telegram,
          telegramId: u.telegram_id, isPremium: u.is_premium,
          premiumExpiresAt: u.premium_expires_at, isBlocked: u.is_blocked || false,
          isRestricted: u.is_restricted || false, unlimitedAi: u.unlimited_ai || false,
          aiBlocked: u.ai_blocked || false, aiQueryCount: u.ai_query_count || 0,
          lastAiQueryAt: u.last_ai_query_at, createdAt: u.created_at,
          onboarding: u.onboarding,
          effectiveAccess: { level: access.level, label: access.label, canUseAi: access.canUseAi, aiLimit: access.aiLimit },
          accountStatus: status
        };
      });

      return res.status(200).json({ success: true, results, count: results.length });
    } catch (e: any) {
      return res.status(500).json({ error: 'Search failed' });
    }
  }

  // ── USER DETAIL ─────────────────────────────────────────────
  if (route === 'user-detail') {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    try {
      const { data: user, error } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
      if (error || !user) return res.status(404).json({ error: 'User not found' });

      const access = effectiveAccess(user);
      const status = accountStatus(user);

      // Fetch AI logs for this user (last 50)
      const { data: aiLogs } = await supabase.from('ai_logs')
        .select('*').eq('user_id', userId)
        .order('timestamp', { ascending: false }).limit(50);

      // Fetch audit log for this user (last 30)
      const { data: auditLogs } = await supabase.from('admin_audit_log')
        .select('*').eq('target_user_id', userId)
        .order('created_at', { ascending: false }).limit(30);

      // Extract files from bot_messages
      const botMessages = user.onboarding?.bot_messages || [];
      const files = botMessages.filter((m: any) =>
        m.metadata?.file_id || ['photo', 'document', 'voice', 'audio', 'video'].includes(m.type)
      ).map((m: any) => ({
        type: m.type, caption: m.caption || m.text,
        fileId: m.metadata?.file_id, fileName: m.metadata?.file_name,
        fileSize: m.metadata?.file_size, mimeType: m.metadata?.mime_type,
        timestamp: m.timestamp,
        downloadUrl: m.metadata?.file_id ? `/api/admin?route=telegram-file&fileId=${m.metadata.file_id}&download=1` : null
      }));

      // AI usage stats
      const today = new Date().toISOString().slice(0, 10);
      const month = new Date().toISOString().slice(0, 7);
      const todayLogs = (aiLogs || []).filter((l: any) => l.timestamp?.startsWith(today));
      const monthLogs = (aiLogs || []).filter((l: any) => l.timestamp?.startsWith(month));

      return res.status(200).json({
        success: true,
        user: {
          id: user.id, name: user.name, phone: user.phone, telegram: user.telegram,
          telegramId: user.telegram_id, language: user.language,
          isPremium: user.is_premium, premiumExpiresAt: user.premium_expires_at,
          isBlocked: user.is_blocked || false, isRestricted: user.is_restricted || false,
          unlimitedAi: user.unlimited_ai || false, aiBlocked: user.ai_blocked || false,
          aiLimit: user.ai_limit, aiQueryCount: user.ai_query_count || 0,
          lastAiQueryAt: user.last_ai_query_at,
          createdAt: user.created_at, updatedAt: user.updated_at,
          onboarding: user.onboarding, deviceInfo: user.device_info,
          privacyConsent: user.privacy_consent || null
        },
        effectiveAccess: { level: access.level, label: access.label, canUseAi: access.canUseAi, aiLimit: access.aiLimit, isPremium: access.isPremium },
        accountStatus: status,
        aiUsage: {
          total: (aiLogs || []).length,
          today: todayLogs.length,
          thisMonth: monthLogs.length,
          remaining: access.aiLimit === null ? 'Unlimited' : Math.max(0, (access.aiLimit || 20) - (user.ai_query_count || 0)),
          recentLogs: (aiLogs || []).slice(0, 20)
        },
        files,
        auditLog: auditLogs || [],
        recentMessages: botMessages.slice(-30).reverse()
      });
    } catch (e: any) {
      return res.status(500).json({ error: 'Failed to get user detail' });
    }
  }

  // ── AUDIT LOG ───────────────────────────────────────────────
  if (route === 'audit-log') {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const { data: logs, error } = await supabase.from('admin_audit_log')
        .select('*').order('created_at', { ascending: false }).limit(limit);

      if (error) return res.status(500).json({ error: 'Failed to fetch audit log' });
      return res.status(200).json({ success: true, logs: logs || [] });
    } catch (e: any) {
      return res.status(500).json({ error: 'Failed to fetch audit log' });
    }
  }

  // ── SEND TELEGRAM MESSAGE (admin → user) ────────────────────
  if(route==='telegram-history') {
    if(req.method!=='POST')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
    const {action,record}=req.body||{};
    if(!['read','save'].includes(action))return res.status(400).json({error:'INVALID_ACTION'});
    if(action==='save'&&(!record||typeof record.id!=='string'||record.id.length>150||JSON.stringify(record).length>500000))return res.status(400).json({error:'INVALID_HISTORY'});
    const id='moliya_system_broadcast_history';
    for(let attempt=0;attempt<3;attempt++){
      const {data:row,error}=await supabase.from('users').select('onboarding').eq('id',id).maybeSingle();
      if(error)return res.status(503).json({error:'HISTORY_UNAVAILABLE'});
      const records=Array.isArray(row?.onboarding?.broadcasts)?row.onboarding.broadcasts:[];
      if(action==='read')return res.status(200).json({records});
      const onboarding={...(row?.onboarding||{}),is_blocked:true,broadcasts:[record,...records.filter((item:any)=>item.id!==record.id)].slice(0,100)};
      if(!row){
        const {error:insertError}=await supabase.from('users').insert({id,name:'[SYSTEM_BROADCAST_HISTORY]',onboarding,updated_at:new Date().toISOString()});
        if(!insertError)return res.status(200).json({success:true});
        if(insertError.code!=='23505')return res.status(503).json({error:'HISTORY_UNAVAILABLE'});
      }else{
        let query=supabase.from('users').update({onboarding,updated_at:new Date().toISOString()}).eq('id',id);
        query=row.onboarding==null?query.is('onboarding',null):query.eq('onboarding',JSON.stringify(row.onboarding));
        const {data:changed,error:writeError}=await query.select('id').maybeSingle();
        if(writeError)return res.status(503).json({error:'HISTORY_UNAVAILABLE'});
        if(changed)return res.status(200).json({success:true});
      }
    }
    return res.status(409).json({error:'HISTORY_CHANGED'});
  }

  if(route==='telegram-action') {
    if(req.method!=='POST')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
    if(req.body?.userId && req.body.userId !== 'moliya_user_tg_'+String(req.body.chatId||''))return res.status(400).json({error:'RECIPIENT_MISMATCH'});
    const output=await adminTelegram(req.body);
    if(output.status===200 && req.body?.method!=='getMe'){try{await logAdminAction('telegram_'+req.body.method,'moliya_user_tg_'+req.body.chatId,undefined,{messageId:(output.body as any).result?.message_id});}catch{}}
    return res.status(output.status).json(output.body);
  }

  if(['send-telegram-message','edit-telegram-message','delete-telegram-message'].includes(route)) {
    if(req.method!=='POST')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
    const body=req.body||{};
    const chatId=String(body.chatId||body.telegramId||String(body.userId||'').replace(/^moliya_user_tg_/,''));
    if(body.userId && body.userId!=='moliya_user_tg_'+chatId)return res.status(400).json({error:'RECIPIENT_MISMATCH'});
    let replyMarkup=body.replyMarkup;
    if(body.linkButtonText && body.linkButtonUrl)replyMarkup={inline_keyboard:[[{text:body.linkButtonText,...(body.linkButtonType==='miniapp'?{web_app:{url:body.linkButtonUrl}}:{url:body.linkButtonUrl})}]]};
    const method=route==='send-telegram-message'?'sendMessage':route==='edit-telegram-message'?'editMessageText':'deleteMessage';
    const output=await adminTelegram({method,chatId,messageId:Number(body.messageId),text:body.message,replyMarkup});
    if(output.status===200)try{await logAdminAction('telegram_'+method,'moliya_user_tg_'+chatId,undefined,{messageId:(output.body as any).result?.message_id || body.messageId});}catch{}
    return res.status(output.status).json({...output.body,messageId:(output.body as any).result?.message_id});
  }

  // ==========================================
  // ROUTE: /api/admin/generate-report
  // Generate deterministic financial metrics + Gemini advisory report
  // ==========================================
  if (route === 'generate-report' && req.method === 'POST') {
    try {
      const { userId, type = 'weekly', sendTelegram = false, force = false, startDate, endDate } = req.body || {};
      if (typeof userId !== 'string' || (userId !== 'all' && !/^moliya_user_tg_[0-9]+$/.test(userId))) return res.status(400).json({ error: 'INVALID_USER_ID' });
      if (!['weekly','monthly'].includes(type) || typeof sendTelegram !== 'boolean' || typeof force !== 'boolean') return res.status(400).json({ error: 'INVALID_REPORT_OPTIONS' });

      // Batch individual report generation for all eligible users
      if (userId === 'all') {
        const { data: allUsers, error: listError } = await supabase
          .from('users')
          .select('id, name, telegram_id, phone, bot_verification, onboarding, device_info, is_blocked, is_restricted, is_deleted, account_status, transactions')
          .neq('id', 'moliya_system_audit_logs');
        if (listError) return res.status(503).json({ error: 'USER_STORE_UNAVAILABLE' });

        const eligibleUsers = (allUsers || []).filter(u => {
          if (!eligibleUser(u)) return false;
          if (!/^moliya_user_tg_[0-9]+$/.test(u.id) || String(u.telegram_id) !== u.id.slice('moliya_user_tg_'.length)) return false;
          const isBlocked = u.onboarding?.is_blocked || u.onboarding?.is_restricted;
          if (isBlocked) return false;
          const hasTx = Array.isArray(u.transactions) && u.transactions.length > 0;
          const hasTg = u.telegram_id && u.telegram_id !== '—';
          return hasTx || hasTg;
        });

        const generatedReports: any[] = [];
        let sentCount = 0;
        let failedCount = 0;

        for (const u of eligibleUsers) {
          try {
            const resSingle = await generateAndSaveUserReport(u.id, type, { sendTelegram, force, startDate, endDate });
            if (resSingle.success && resSingle.report) {
              generatedReports.push(resSingle.report);
              if (resSingle.report.sentToTelegram) sentCount++;
            } else failedCount++;
          } catch {
            failedCount++;
          }
        }

        await logAdminAction('generate_all_reports', 'all', 'Barcha foydalanuvchilar', {
          type,
          totalEligible: eligibleUsers.length,
          generated: generatedReports.length,
          sentToTelegram: sentCount,
          failed: failedCount
        });

        return res.status(200).json({
          success: true,
          total: eligibleUsers.length,
          generated: generatedReports.length,
          sentCount,
          failedCount,
          reports: generatedReports
        });
      }

      const result = await generateAndSaveUserReport(userId, type, { sendTelegram, force, startDate, endDate });
      if (!result.success) {
        return res.status(500).json({ error: 'REPORT_GENERATION_FAILED' });
      }

      await logAdminAction('generate_report', userId, result.report?.userName, {
        type,
        periodLabel: result.report?.periodLabel,
        totalIncome: result.report?.metrics.totalIncome,
        totalExpense: result.report?.metrics.totalExpense,
        sentToTelegram: result.report?.sentToTelegram
      });

      return res.status(200).json({
        success: true,
        report: result.report,
        alreadyExisted: result.alreadyExisted || false
      });
    } catch (e: any) {
      return res.status(500).json({ error: 'Error generating report' });
    }
  }

  // ==========================================
  // ROUTE: /api/admin/run-scheduled-reports
  // Automatic end-of-week & end-of-month scheduled tahlil dispatcher
  // ==========================================
  if (route === 'run-scheduled-reports' && (req.method === 'POST' || req.method === 'GET')) {
    try {
      const now = new Date();
      const due = dueScheduledReports(now);
      const ids = ['scheduled_weekly_report','scheduled_monthly_report'];
      const {data:rules,error:ruleError} = await supabase.from('moliya_automation_rules')
        .select('rule_id,enabled').in('rule_id',ids);
      if (ruleError || !Array.isArray(rules) || ids.some(id=>!rules.some(rule=>rule.rule_id===id)))
        return res.status(503).json({error:'REPORT_SETTINGS_UNAVAILABLE'});
      const selected = due.filter(report=>rules.some(rule=>rule.rule_id===`scheduled_${report.type}_report` && rule.enabled));
      if (!selected.length) return res.status(200).json({success:true,reportTypes:[],totalEligible:0,sentCount:0});

      const allUsers:any[] = [];
      for (let offset=0; offset<10000; offset+=500) {
        const {data,error} = await supabase.from('users')
          .select('id, name, telegram_id, phone, bot_verification, onboarding, device_info, is_blocked, is_restricted, is_deleted, account_status, transactions')
          .order('id',{ascending:true}).range(offset,offset+499);
        if (error || !Array.isArray(data)) return res.status(503).json({error:'USER_STORE_UNAVAILABLE'});
        allUsers.push(...data);
        if (data.length<500) break;
        if (offset+500>=10000) return res.status(503).json({error:'USER_LIST_TOO_LARGE'});
      }

      const eligibleUsers = (allUsers || []).filter(u => {
        if (!eligibleUser(u)) return false;
        const isBlocked = u.onboarding?.is_blocked || u.onboarding?.is_restricted;
        if (isBlocked) return false;
        if (u.onboarding?.notifications?.opt2 === false) return false;
        const hasTg = /^moliya_user_tg_[0-9]+$/.test(u.id) && String(u.telegram_id) === u.id.slice('moliya_user_tg_'.length);
        return Boolean(hasTg && Array.isArray(u.transactions) && u.transactions.length > 0);
      });

      let sentCount = 0, failedCount = 0;
      for (const report of selected) {
        for (const u of eligibleUsers) {
          try {
            const result = await generateAndSaveUserReport(u.id, report.type, {
              startDate:report.startDate,endDate:report.endDate,sendTelegram:true,force:false
            });
            if (!result?.success || result.report?.sentToTelegram !== true) failedCount++;
            else if (!result.alreadyExisted) sentCount++;
          } catch {failedCount++;}
        }
      }

      return res.status(failedCount ? 503 : 200).json({
        success: failedCount === 0,
        reportTypes:selected.map(report=>report.type),
        totalEligible: eligibleUsers.length,
        sentCount,
        failedCount,
        executedAt: now.toISOString()
      });
    } catch (err: any) {
      return res.status(500).json({ error: 'Scheduled report error' });
    }
  }

  // ==========================================
  // ROUTE: /api/admin/reports
  // Fetch generated reports (for a single user or globally)
  // ==========================================
  if (route === 'reports' && ['GET','POST'].includes(req.method || '')) {
    try {
      const userId = (req.method === 'POST' ? req.body?.userId : req.query.userId) as string | undefined;
      if (userId) {
        if (!/^moliya_user_tg_[0-9]+$/.test(userId)) return res.status(400).json({ error: 'INVALID_USER_ID' });
        const { data: user, error } = await supabase.from('users').select('onboarding,telegram_id').eq('id', userId).maybeSingle();
        if (error) return res.status(503).json({ error: 'USER_STORE_UNAVAILABLE' });
        if (!user || String(user.telegram_id) !== userId.slice('moliya_user_tg_'.length)) return res.status(404).json({ error: 'USER_NOT_FOUND' });
        const reports = Array.isArray(user?.onboarding?.ai_reports) ? user.onboarding.ai_reports : [];
        return res.status(200).json({ success: true, reports });
      }

      // Global: fetch all reports across users
      const { data: users, error: listError } = await supabase
        .from('users')
        .select('id, name, telegram, onboarding')
        .not('onboarding->ai_reports', 'is', null)
        .limit(100);
      if (listError) return res.status(503).json({ error: 'REPORTS_UNAVAILABLE' });

      const allReports: any[] = [];
      (users || []).filter((u:any) => /^moliya_user_tg_[0-9]+$/.test(u.id)).forEach((u: any) => {
        const repList = Array.isArray(u.onboarding?.ai_reports) ? u.onboarding.ai_reports : [];
        repList.forEach((r: any) => {
          allReports.push({
            ...r,
            userId: u.id,
            userName: r.userName || u.name || u.telegram || 'Foydalanuvchi'
          });
        });
      });

      allReports.sort((a, b) => new Date(b.generatedAt || 0).getTime() - new Date(a.generatedAt || 0).getTime());
      return res.status(200).json({ success: true, reports: allReports.slice(0, 100) });
    } catch (e: any) {
      return res.status(500).json({ error: 'Failed to fetch reports' });
    }
  }

  // ==========================================
  // ROUTE: /api/admin/admin-audit-logs
  // ==========================================
  if (route === 'admin-audit-logs' && req.method === 'GET') {
    try {
      // 1. Try SQL table admin_audit_log
      const { data, error } = await supabase
        .from('admin_audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (!error && data && data.length > 0) {
        return res.status(200).json({ success: true, logs: data });
      }

      // 2. Fallback to system state row in users
      const { data: sysRow, error: fallbackError } = await supabase
        .from('users')
        .select('onboarding')
        .eq('id', 'moliya_system_audit_logs')
        .maybeSingle();
      if (fallbackError) return res.status(503).json({ error: 'AUDIT_STORE_UNAVAILABLE' });

      const fallbackLogs = Array.isArray(sysRow?.onboarding?.logs) ? sysRow.onboarding.logs : [];
      return res.status(200).json({ success: true, logs: fallbackLogs });
    } catch (e: any) {
      return res.status(503).json({ error: 'AUDIT_STORE_UNAVAILABLE' });
    }
  }

  if (route === 'admin-audit-logs') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });

  return res.status(404).json({ error: 'Admin route not found', route });
}
