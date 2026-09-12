import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from './_supabaseClient.js';
import { maskApiKey, testSpecificAiKey, executeAiWithRotation, AiKeyRecord, invalidateAiKeysCache } from './_aiRouter.js';
import { effectiveAccess, accountStatus } from './_accessHelper.js';
import { generateAndSaveUserReport } from './_financialReportEngine.js';
import {
  adminWipeUserData,
  adminToggleUserBlock,
  adminGrantFullPremium,
  adminResetDailyQueries,
  logAdminAudit
} from './services/index.js';

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
    const token = process.env.TELEGRAM_BOT_TOKEN || '8955141731:AAGILXzT69Vity8ZFi-H8XeZc_H6_BFaS8Y';
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

    const text = `🎉 <b>Tabriklaymiz! Sizga Moliya AI Premium (VIP) obunasi taqdim etildi!</b>\n\n` +
      `✨ Endi siz barcha imkoniyatlardan cheklovlarsiz foydalanishingiz mumkin:\n` +
      `• 🤖 <b>Cheksiz AI tahlil:</b> Kunlik savollar va cheklovlar yo'q\n` +
      `• 🎙️ <b>Cheksiz ovozli xabarlar:</b> Ovozli xarajatlarni 1 zumda kiritish\n` +
      `• 🧾 <b>Chek skaneri:</b> Rasmdan avtomatik xarajat aniqlash\n` +
      `• 📊 <b>Barcha hisobotlar:</b> Excel va PDF formatida to'liq eksport\n` +
      `• ⚡ <b>24/7 ustuvor va tezkor AI yordamchi</b>\n\n` +
      `⏳ <b>Amal qilish muddati:</b> <b>${expiryDisplay}</b>\n\n` +
      `📱 <i>Moliya Mini App ga kiring va barcha qulayliklardan bahramand bo'ling!</i>`;

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

    if (userId) {
      const { data: curr } = await supabase.from('users').select('onboarding').eq('id', userId).maybeSingle();
      const existingMsgs = Array.isArray(curr?.onboarding?.bot_messages) ? curr.onboarding.bot_messages : [];
      const newMsg = {
        id: 'msg_vip_' + Date.now(),
        sender: 'bot',
        text,
        timestamp: new Date().toISOString(),
        messageId: result?.result?.message_id || null
      };
      await supabase.from('users').update({
        onboarding: { ...(curr?.onboarding || {}), bot_messages: [...existingMsgs, newMsg] },
        updated_at: new Date().toISOString()
      }).eq('id', userId);
    }

    return result;
  } catch (err) {
    console.error('[VIP NOTIFY] Error notifying user on Telegram:', err);
  }
}

async function notifyUserUnlimitedAiGrantedTelegram(telegramId: string | number, userId?: string) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN || '8955141731:AAGILXzT69Vity8ZFi-H8XeZc_H6_BFaS8Y';
    if (!token || !telegramId || String(telegramId) === '—') return;

    const text = `🌟 <b>Tabriklaymiz! Sizga Cheksiz AI (Unlimited) imkoniyati taqdim etildi!</b>\n\n` +
      `✨ Endi hisobingizda hech qanday kunlik AI cheklovi yo'q:\n` +
      `• 🤖 <b>Cheksiz AI so'rovlar:</b> Istalgancha xarajat tahlili va savollar\n` +
      `• 🎙️ <b>Cheksiz audio/ovozli yozuvlar</b>\n` +
      `• 🧾 <b>Chek va rasmlar skaneri</b>\n` +
      `• ⚡ <b>Ustuvor tezkor AI marshrutlash</b>\n\n` +
      `📱 <i>Moliya Mini App orqali to'liq foydalanishingiz mumkin!</i>`;

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

    if (userId) {
      const { data: curr } = await supabase.from('users').select('onboarding').eq('id', userId).maybeSingle();
      const existingMsgs = Array.isArray(curr?.onboarding?.bot_messages) ? curr.onboarding.bot_messages : [];
      const newMsg = {
        id: 'msg_unlimited_' + Date.now(),
        sender: 'bot',
        text,
        timestamp: new Date().toISOString(),
        messageId: result?.result?.message_id || null
      };
      await supabase.from('users').update({
        onboarding: { ...(curr?.onboarding || {}), bot_messages: [...existingMsgs, newMsg] },
        updated_at: new Date().toISOString()
      }).eq('id', userId);
    }

    return result;
  } catch (err) {
    console.error('[UNLIMITED AI NOTIFY] Error notifying user on Telegram:', err);
  }
}
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Admin authentication guard
  const ADMIN_KEY = process.env.ADMIN_SECRET_KEY;
  if (ADMIN_KEY && req.headers['x-admin-key'] && req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Extract route from query (via vercel rewrite ?route=...) or URL path
  let route = (req.query.route as string) || '';
  if (!route && req.url) {
    const cleanUrl = req.url.split('?')[0];
    route = cleanUrl.replace(/^\/api\/admin\/?/, '').trim();
  }

  const nowIso = new Date().toISOString();

  // ==========================================
  // 1. ROUTE: /api/admin/users
  // ==========================================
  if (route === 'users') {
    if (req.method === 'GET') {
      try {
        const { data: suUsers, error } = await supabase
          .from('users')
          .select('*')
          .order('updated_at', { ascending: false });

        if (error) {
          return res.status(500).json({ error: 'Failed to fetch users', details: error.message });
        }

        const formatted = (suUsers || []).map(u => {
          const access = effectiveAccess(u);
          const status = accountStatus(u);
          return {
            id: u.id,
            name: u.name,
            phone: u.phone,
            telegram: u.telegram,
            telegramId: u.telegram_id,
            isPremium: u.is_premium,
            premiumExpiresAt: u.premium_expires_at,
            isBlocked: u.is_blocked || false,
            isRestricted: u.is_restricted || false,
            unlimitedAi: u.unlimited_ai || false,
            aiBlocked: u.ai_blocked || false,
            language: u.language,
            aiLimit: u.ai_limit,
            aiQueryCount: u.ai_query_count || 0,
            lastAiQueryAt: u.last_ai_query_at,
            deviceInfo: u.device_info || null,
            platform: u.platform || null,
            onboarding: u.onboarding,
            createdAt: u.created_at,
            updatedAt: u.updated_at,
            effectiveAccess: {
              level: access.level,
              label: access.label,
              canUseAi: access.canUseAi,
              aiLimit: access.aiLimit,
              isPremium: access.isPremium
            },
            accountStatus: status
          };
        });
        return res.status(200).json({ success: true, users: formatted, source: 'supabase' });
      } catch (e: any) {
        return res.status(500).json({ error: 'Failed to fetch users', details: e?.message });
      }
    }

    if (req.method === 'POST') {
      try {
        const { userId, action, isPremium, aiLimit } = req.body || {};
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        // Fetch user name and existing state for audit log and synchronized updates
        const { data: targetUser } = await supabase
          .from('users')
          .select('name, telegram, telegram_id, onboarding, is_premium, premium_expires_at')
          .eq('id', userId)
          .maybeSingle();
        const userName = targetUser?.name || targetUser?.telegram || userId;
        const existingOb = targetUser?.onboarding || {};

        const effectiveAction = action || (isPremium !== undefined ? (isPremium ? 'grant_vip' : 'revoke_vip') : null);

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

            const { error } = await supabase
              .from('users')
              .update({
                is_premium: true,
                premium_expires_at: expiresAt,
                unlimited_ai: false,
                trial_ends_at: null,
                ai_query_count: 0,
                onboarding: updatedOb,
                updated_at: nowIso
              })
              .eq('id', userId);

            if (error) return res.status(500).json({ error: 'Failed to grant VIP', details: error.message });
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

            const { error } = await supabase
              .from('users')
              .update({
                is_premium: false,
                premium_expires_at: null,
                onboarding: updatedOb,
                updated_at: nowIso
              })
              .eq('id', userId);

            if (error) return res.status(500).json({ error: 'Failed to revoke VIP', details: error.message });
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

            const { error } = await supabase
              .from('users')
              .update({
                unlimited_ai: true,
                is_premium: true,
                premium_expires_at: null,
                trial_ends_at: null,
                ai_blocked: false,
                ai_query_count: 0,
                onboarding: updatedOb,
                updated_at: nowIso
              })
              .eq('id', userId);

            if (error) return res.status(500).json({ error: 'Failed to grant unlimited AI', details: error.message });
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

            const { error } = await supabase
              .from('users')
              .update({
                unlimited_ai: false,
                onboarding: updatedOb,
                updated_at: nowIso
              })
              .eq('id', userId);

            if (error) return res.status(500).json({ error: 'Failed to revoke unlimited AI', details: error.message });
            await logAdminAction('revoke_unlimited_ai', userId, userName);
            return res.status(200).json({ success: true, userId, action: 'revoke_unlimited_ai', unlimitedAi: false });
          }

          case 'block': {
            const updatedOb = {
              ...existingOb,
              is_blocked: true
            };

            const { error } = await supabase
              .from('users')
              .update({ is_blocked: true, onboarding: updatedOb, updated_at: nowIso })
              .eq('id', userId);

            if (error) return res.status(500).json({ error: 'Failed to block user', details: error.message });
            await logAdminAction('block', userId, userName);
            return res.status(200).json({ success: true, userId, action: 'block', isBlocked: true });
          }

          case 'unblock': {
            const updatedOb = {
              ...existingOb,
              is_blocked: false
            };

            const { error } = await supabase
              .from('users')
              .update({ is_blocked: false, onboarding: updatedOb, updated_at: nowIso })
              .eq('id', userId);

            if (error) return res.status(500).json({ error: 'Failed to unblock user', details: error.message });
            await logAdminAction('unblock', userId, userName);
            return res.status(200).json({ success: true, userId, action: 'unblock', isBlocked: false });
          }

          case 'block_ai': {
            const updatedOb = {
              ...existingOb,
              ai_blocked: true
            };

            const { error } = await supabase
              .from('users')
              .update({ ai_blocked: true, onboarding: updatedOb, updated_at: nowIso })
              .eq('id', userId);

            if (error) return res.status(500).json({ error: 'Failed to block AI', details: error.message });
            await logAdminAction('block_ai', userId, userName);
            return res.status(200).json({ success: true, userId, action: 'block_ai', aiBlocked: true });
          }

          case 'unblock_ai': {
            const updatedOb = {
              ...existingOb,
              ai_blocked: false
            };

            const { error } = await supabase
              .from('users')
              .update({ ai_blocked: false, onboarding: updatedOb, updated_at: nowIso })
              .eq('id', userId);

            if (error) return res.status(500).json({ error: 'Failed to unblock AI', details: error.message });
            await logAdminAction('unblock_ai', userId, userName);
            return res.status(200).json({ success: true, userId, action: 'unblock_ai', aiBlocked: false });
          }

          case 'restrict': {
            const updatedOb = {
              ...existingOb,
              is_restricted: true
            };

            const { error } = await supabase
              .from('users')
              .update({ is_restricted: true, onboarding: updatedOb, updated_at: nowIso })
              .eq('id', userId);

            if (error) return res.status(500).json({ error: 'Failed to restrict user', details: error.message });
            await logAdminAction('restrict', userId, userName);
            return res.status(200).json({ success: true, userId, action: 'restrict', isRestricted: true });
          }

          case 'unrestrict': {
            const updatedOb = {
              ...existingOb,
              is_restricted: false
            };

            const { error } = await supabase
              .from('users')
              .update({ is_restricted: false, onboarding: updatedOb, updated_at: nowIso })
              .eq('id', userId);

            if (error) return res.status(500).json({ error: 'Failed to unrestrict user', details: error.message });
            await logAdminAction('unrestrict', userId, userName);
            return res.status(200).json({ success: true, userId, action: 'unrestrict', isRestricted: false });
          }

          case 'reset_trial': {
            const trialEnd = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
            const updatedOb = {
              ...existingOb,
              is_trial: true,
              is_vip: false,
              is_premium: false,
              trial_ends_at: trialEnd,
              premium_expires_at: null
            };

            const { error } = await supabase
              .from('users')
              .update({
                trial_ends_at: trialEnd,
                is_premium: false,
                premium_expires_at: null,
                ai_query_count: 0,
                ai_limit: null,
                onboarding: updatedOb,
                updated_at: nowIso
              })
              .eq('id', userId);

            if (error) return res.status(500).json({ error: 'Failed to reset trial', details: error.message });
            await logAdminAction('reset_trial', userId, userName, { trialEnd });
            return res.status(200).json({ success: true, userId, action: 'reset_trial', trialEndsAt: trialEnd });
          }

          case 'set_ai_limit': {
            const limitValue = (aiLimit === null || aiLimit === undefined || aiLimit === -1 || aiLimit === 0) ? null : Number(aiLimit);
            const { error } = await supabase
              .from('users')
              .update({
                ai_limit: limitValue,
                ai_query_count: 0,
                updated_at: nowIso
              })
              .eq('id', userId);

            if (error) return res.status(500).json({ error: 'Failed to set AI limit', details: error.message });
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
            const result = await adminWipeUserData(userId, 'account', 'admin', userName);
            return res.status(200).json({ success: true, userId, action: 'delete_account', result });
          }

          default:
            return res.status(400).json({ error: 'Invalid action' });
        }
      } catch (e: any) {
        return res.status(500).json({ error: 'Failed to update user', details: e?.message });
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
        return res.status(500).json({ error: 'Failed to fetch AI keys', details: err?.message });
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
            console.error('[ADMIN] AI key insert error:', error);
            return res.status(500).json({ error: 'Failed to save AI key', details: error.message });
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
          return res.status(200).json({ success: true, ...testResult });
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
            error: aiResult.error || null
          });
        }

        return res.status(400).json({ error: 'Invalid action' });
      } catch (err: any) {
        return res.status(500).json({ error: 'Operation failed', details: err?.message });
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

        if (!error && Array.isArray(suLogs)) {
          const formatted = suLogs.map(l => ({
            id: l.id,
            userId: l.user_id,
            queryType: l.query_type,
            promptSummary: l.prompt_summary,
            isPremium: l.is_premium,
            timestamp: l.timestamp
          }));
          return res.status(200).json({ success: true, count: formatted.length, logs: formatted, source: 'supabase' });
        }
        return res.status(200).json({ success: true, count: 0, logs: [] });
      } catch (e: any) {
        return res.status(500).json({ error: 'Failed to fetch AI logs', details: e?.message });
      }
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
        return res.status(500).json({ error: error.message || 'Internal server error' });
      }
    }

    if (req.method === 'POST') {
      const { action } = req.body || {};
      if (action === 'reset') {
        const { error } = await supabase.from('ai_logs').delete().not('id', 'is', null);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true, message: 'All analytics data cleared' });
      }
      return res.status(400).json({ error: 'Invalid action' });
    }
  }

  // ==========================================
  // 5. ROUTE: /api/admin/broadcast
  // ==========================================
  if (route === 'broadcast') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
      const { message, target, type = 'text', mediaUrl = '' } = req.body || {};
      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'Missing broadcast message' });
      }

      const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8955141731:AAGILXzT69Vity8ZFi-H8XeZc_H6_BFaS8Y';
      if (!BOT_TOKEN) {
        return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN is not configured' });
      }

      const { data: users, error } = await supabase
        .from('users')
        .select('*');

      if (error) {
        return res.status(500).json({ error: 'Failed to fetch users from database', details: error.message });
      }

      // Filter eligible active users strictly according to account lifecycle rules
      const eligibleUsers: Array<{ id: string; name: string; telegramId: string }> = [];
      let skippedCount = 0;

      (users || []).forEach((u: any) => {
        const id = String(u.id || '');
        // Skip temporary authentication stubs
        if (id.startsWith('req_') || id.startsWith('exchange_') || id.startsWith('sess_') || id.startsWith('moliya_user_req_') || id.startsWith('moliya_user_sess_')) {
          skippedCount++;
          return;
        }

        // Skip blocked users
        const isBlocked = Boolean(u.is_blocked || u.onboarding?.is_blocked || u.onboarding?.is_restricted || u.device_info?.is_blocked || id.startsWith('restricted_'));
        if (isBlocked) {
          skippedCount++;
          return;
        }

        // Skip deleted users
        const isDeleted = Boolean(u.is_deleted || u.onboarding?.is_deleted || u.account_status === 'deleted');
        if (isDeleted) {
          skippedCount++;
          return;
        }

        // Must have valid Telegram ID
        const tgId = u.telegram_id || u.onboarding?.telegramId;
        if (!tgId || tgId === '—' || String(tgId).trim() === '') {
          skippedCount++;
          return;
        }

        // Segment filter (free vs premium)
        const isPrem = Boolean(u.is_premium || u.onboarding?.isPremium);
        if (target === 'premium' && !isPrem) {
          skippedCount++;
          return;
        }
        if (target === 'free' && isPrem) {
          skippedCount++;
          return;
        }

        eligibleUsers.push({
          id: u.id,
          name: u.name || u.onboarding?.name || 'User',
          telegramId: String(tgId).trim()
        });
      });

      // Deduplicate by Telegram ID
      const seenChatIds = new Set<string>();
      const uniqueRecipients: Array<{ id: string; name: string; telegramId: string }> = [];
      for (const rec of eligibleUsers) {
        if (!seenChatIds.has(rec.telegramId)) {
          seenChatIds.add(rec.telegramId);
          uniqueRecipients.push(rec);
        }
      }

      let sentCount = 0;
      let failedCount = 0;
      const failureSummary: Array<{ user: string; chatId: string; error: string }> = [];

      // Send sequentially with throttling to strictly respect Telegram rate limits
      for (let i = 0; i < uniqueRecipients.length; i++) {
        const recipient = uniqueRecipients[i];
        const chatId = recipient.telegramId;

        try {
          let url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
          let payload: any = {
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML'
          };

          if (type === 'photo' && mediaUrl && mediaUrl.trim()) {
            url = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;
            payload = { chat_id: chatId, photo: mediaUrl.trim(), caption: message, parse_mode: 'HTML' };
          } else if (type === 'video' && mediaUrl && mediaUrl.trim()) {
            url = `https://api.telegram.org/bot${BOT_TOKEN}/sendVideo`;
            payload = { chat_id: chatId, video: mediaUrl.trim(), caption: message, parse_mode: 'HTML' };
          }

          let response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          let resData = await response.json();

          // Handle 429 Too Many Requests (Rate limit backoff)
          if (!resData.ok && response.status === 429) {
            const retryAfterSec = resData.parameters?.retry_after || 3;
            await new Promise(r => setTimeout(r, (retryAfterSec + 1) * 1000));
            response = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            resData = await response.json();
          }

          if (resData.ok) {
            sentCount++;
          } else {
            failedCount++;
            failureSummary.push({
              user: recipient.name,
              chatId,
              error: resData.description || 'Unknown Telegram error'
            });
          }
        } catch (callErr: any) {
          failedCount++;
          failureSummary.push({
            user: recipient.name,
            chatId,
            error: callErr.message || 'Network request failed'
          });
        }

        // Throttle 60ms between requests to avoid Telegram floods
        if (i < uniqueRecipients.length - 1) {
          await new Promise(r => setTimeout(r, 60));
        }
      }

      return res.status(200).json({
        success: true,
        totalTargeted: uniqueRecipients.length,
        sent: sentCount,
        failed: failedCount,
        skipped: skippedCount,
        failureSummary
      });
    } catch (e: any) {
      return res.status(500).json({ error: 'Broadcast failed', details: e?.message });
    }
  }

  // ==========================================
  // 5b. ROUTE: /api/admin/clear-telegram-history
  // ==========================================
  if (route === 'clear-telegram-history') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
      const { userId, telegramId, messageIds = [], allUsers = false, sweepRecent = true } = req.body || {};
      const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8955141731:AAGILXzT69Vity8ZFi-H8XeZc_H6_BFaS8Y';

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
            console.warn('[AdminDelete] Probe send warning:', probeErr);
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
        const uidStr = String(userId).trim();
        const rawId = uidStr.replace('moliya_user_tg_', '');
        const tgIdStr = telegramId && telegramId !== '—' ? String(telegramId).trim() : null;

        // 1. Precise user row resolution across possible ID patterns - fetch ALL matching records
        const orFilter = tgIdStr
          ? `id.eq.${uidStr},id.eq.moliya_user_tg_${rawId},telegram_id.eq.${rawId},id.eq.moliya_user_tg_${tgIdStr},telegram_id.eq.${tgIdStr}`
          : `id.eq.${uidStr},id.eq.moliya_user_tg_${rawId},telegram_id.eq.${rawId}`;
        const { data: matchedRows } = await supabase.from('users').select('*').or(orFilter);
        const allMatchedUsers: any[] = Array.isArray(matchedRows) ? matchedRows : [];
        if (allMatchedUsers.length === 0) {
          const { data: byId } = await supabase.from('users').select('*').eq('id', uidStr).maybeSingle();
          if (byId) allMatchedUsers.push(byId);
        }

        const userRow = allMatchedUsers[0] || null;
        const canonicalUserId = userRow?.id || uidStr;

        // 2. Chat ID resolution across all matched records
        let rawTgId = tgIdStr;
        for (const u of allMatchedUsers) {
          if (!rawTgId && u.telegram_id && u.telegram_id !== '—') rawTgId = u.telegram_id;
          if (!rawTgId && u.onboarding?.telegramId) rawTgId = u.onboarding.telegramId;
          if (!rawTgId && u.id?.startsWith('moliya_user_tg_')) rawTgId = u.id.replace('moliya_user_tg_', '');
          const bMsgs = Array.isArray(u.onboarding?.bot_messages) ? u.onboarding.bot_messages : [];
          const foundInMsg = bMsgs.find((m: any) => m.chat_id)?.chat_id;
          if (!rawTgId && foundInMsg) rawTgId = String(foundInMsg);
        }

        const cleanTgId = rawTgId ? String(rawTgId).replace(/[^\d-]/g, '') : null;

        // 3. Extract real numeric message IDs (from DB across all aliases + explicitly passed from client)
        const messageIdsToDelete = new Set<number>();
        if (Array.isArray(messageIds)) {
          messageIds.forEach((id: any) => {
            const num = typeof id === 'number' ? id : parseInt(String(id).replace(/\D/g, ''), 10);
            if (Number.isInteger(num) && num > 0) messageIdsToDelete.add(num);
          });
        }
        for (const u of allMatchedUsers) {
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
          console.log(`[TelegramDelete] userId=${canonicalUserId} telegramId=${cleanTgId} attempted=${deletionSummary.attempted} deleted=${deletionSummary.deleted} alreadyAbsent=${deletionSummary.alreadyAbsent} notDeletable=${deletionSummary.notDeletable} failed=${deletionSummary.failed}`);
        }

        // 4. Targeted clear of stored message history records across ALL matched user rows
        let clearedDbRecords = 0;
        const nowIso = new Date().toISOString();
        for (const u of allMatchedUsers) {
          const bMsgs: any[] = Array.isArray(u.onboarding?.bot_messages) ? u.onboarding.bot_messages : [];
          clearedDbRecords += bMsgs.length;
          const updatedOnboarding = {
            ...(u.onboarding || {}),
            bot_messages: [],
            last_link_message_id: null,
            chat_cleared_at: nowIso
          };
          await supabase.from('users').update({
            onboarding: updatedOnboarding,
            updated_at: nowIso
          }).eq('id', u.id);
        }

        // Also ensure any moliya_user_tg_${cleanTgId} is updated if not already covered
        if (cleanTgId) {
          const tgKey = `moliya_user_tg_${cleanTgId}`;
          if (!allMatchedUsers.some(u => u.id === tgKey)) {
            const { data: tgUser } = await supabase.from('users').select('onboarding').eq('id', tgKey).maybeSingle();
            if (tgUser) {
              await supabase.from('users').update({
                onboarding: { ...(tgUser.onboarding || {}), bot_messages: [], last_link_message_id: null, chat_cleared_at: nowIso },
                updated_at: nowIso
              }).eq('id', tgKey);
            }
          }
        }

        // Clear chat query logs for this user across all aliases
        if (canonicalUserId) {
          await supabase.from('ai_logs').delete().eq('user_id', canonicalUserId);
        }
        if (cleanTgId) {
          await supabase.from('ai_logs').delete().eq('user_id', cleanTgId);
          await supabase.from('ai_logs').delete().eq('user_id', `moliya_user_tg_${cleanTgId}`);
        }
        for (const u of allMatchedUsers) {
          if (u.id && u.id !== canonicalUserId) {
            await supabase.from('ai_logs').delete().eq('user_id', u.id);
          }
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
        const { data: allUserRows } = await supabase.from('users').select('id, telegram_id, onboarding');
        let totalAttempted = 0;
        let totalDeleted = 0;
        let totalAlreadyAbsent = 0;
        let totalNotDeletable = 0;
        let totalFailed = 0;
        let usersPurged = 0;
        let totalDbCleared = 0;

        for (const u of (allUserRows || [])) {
          const uTgId =
            u.telegram_id ||
            u.onboarding?.telegramId ||
            (u.id?.startsWith('moliya_user_tg_') ? u.id.replace('moliya_user_tg_', '') : null);

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
            console.log(`[TelegramDelete] Global user=${u.id} tgId=${uTgId} deleted=${sum.deleted} absent=${sum.alreadyAbsent} notDeletable=${sum.notDeletable}`);
          }

          // Clear bot_messages in onboarding
          totalDbCleared += uMsgs.length;
          const updatedOb = { ...(u.onboarding || {}), bot_messages: [] };
          await supabase.from('users').update({ onboarding: updatedOb, updated_at: new Date().toISOString() }).eq('id', u.id);
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
      console.error('[TelegramDelete] Error:', e);
      return res.status(500).json({ error: 'Clear telegram history failed', details: e?.message });
    }
  }

  // ==========================================
  // 5c. ROUTE: /api/admin/bot-messages
  // ==========================================
  if (route === 'bot-messages') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
      const userId = req.query.userId as string;
      if (!userId) return res.status(400).json({ error: 'Missing userId' });

      const { data: userRow, error } = await supabase.from('users').select('id, name, telegram, telegram_id, onboarding').eq('id', userId).maybeSingle();
      if (error) return res.status(500).json({ error: error.message });

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
      return res.status(500).json({ error: 'Failed to fetch bot messages', details: e?.message });
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

      const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8955141731:AAGILXzT69Vity8ZFi-H8XeZc_H6_BFaS8Y';
      if (!BOT_TOKEN) return res.status(500).json({ error: 'Missing TELEGRAM_BOT_TOKEN' });

      const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
      const tgData: any = await tgRes.json();

      if (!tgData.ok || !tgData.result?.file_path) {
        return res.status(404).json({ error: 'File not found on Telegram servers', details: tgData });
      }

      const filePath = tgData.result.file_path;
      const tgFileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

      // Secure Server-Side Streaming Proxy:
      // Stream buffer directly through the server so TELEGRAM_BOT_TOKEN is NEVER exposed to the browser
      if (req.query.download === '1' || req.query.raw === '1' || req.query.stream === '1') {
        const streamRes = await fetch(tgFileUrl);
        if (!streamRes.ok) {
          return res.status(streamRes.status).json({ error: 'Failed to stream file from Telegram servers' });
        }
        const arrayBuf = await streamRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        const contentType = streamRes.headers.get('content-type') || 'application/octet-stream';
        const ext = filePath.split('.').pop() || 'bin';
        const fileName = `moliya_tg_${fileId.slice(-8)}.${ext}`;

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', buffer.length);
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
        fileSize: tgData.result.file_size,
        downloadUrl: safeDownloadUrl,
        streamUrl: safeStreamUrl,
        isImage: /\.(jpe?g|png|webp|gif)$/i.test(filePath),
        isAudio: /\.(oga|ogg|mp3|m4a)$/i.test(filePath),
        isVideo: /\.(mp4|mov)$/i.test(filePath)
      });
    } catch (err: any) {
      return res.status(500).json({ error: 'Failed to retrieve Telegram file', details: err?.message });
    }
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

        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data);
      } catch (err: any) {
        return res.status(500).json({ error: err.message });
      }
    }

    if (req.method === 'POST') {
      try {
        const { action, id, title, message, emoji, type, target_audience, image_url, action_url, is_active } = req.body;

        if (action === 'update') {
          if (!id) return res.status(400).json({ error: 'Missing notification ID' });
          const updates: any = {};
          if (title !== undefined) updates.title = title;
          if (message !== undefined) updates.message = message;
          if (emoji !== undefined) updates.emoji = emoji;
          if (type !== undefined) updates.type = type;
          if (target_audience !== undefined) updates.target_audience = target_audience;
          if (image_url !== undefined) updates.image_url = image_url;
          if (action_url !== undefined) updates.action_url = action_url;
          if (is_active !== undefined) updates.is_active = is_active;

          const { data, error } = await supabase.from('app_notifications').update(updates).eq('id', id).select().maybeSingle();
          if (error) return res.status(500).json({ error: error.message });
          return res.status(200).json(data);
        }

        if (action === 'delete') {
          if (!id) return res.status(400).json({ error: 'Missing notification ID' });
          const { error } = await supabase.from('app_notifications').delete().eq('id', id);
          if (error) return res.status(500).json({ error: error.message });
          return res.status(200).json({ success: true });
        }

        return res.status(400).json({ error: 'Invalid action' });
      } catch (err: any) {
        return res.status(500).json({ error: err.message });
      }
    }
  }

  // ==========================================
  // 7. ROUTE: /api/admin/auto-broadcast
  // ==========================================
  if (route === 'auto-broadcast') {
    if (req.method !== 'POST' && req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
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
          text: "🎙️ <b>Xarajatni yozish shart emas!</b>\n\nBotga shunchaki ovozli xabar yuboring: <i>\"tushlikka 45 ming sarfladim\"</i> — AI uni avtomatik saqlaydi! ⚡",
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

      const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24));
      const reminder = DAILY_REMINDERS[dayOfYear % DAILY_REMINDERS.length];

      // 2. Fetch all eligible active users from Supabase
      const { data: users, error } = await supabase.from('users').select('*');
      if (error) return res.status(500).json({ error: error.message });

      const eligibleUsers: Array<{ id: string; name: string; telegramId: string }> = [];
      let skippedCount = 0;
      let skippedAlreadyRecorded = 0;

      const todayTashkent = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tashkent" })).toISOString().slice(0, 10);

      (users || []).forEach((u: any) => {
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

        // SMART AUDIENCE RULE: Check if user already recorded an expense today
        const transactions = Array.isArray(u.transactions) ? u.transactions : [];
        const hasExpenseToday = transactions.some((tx: any) => {
          if (!tx || String(tx.type || '').toLowerCase() === 'income') return false;
          const txDate = String(tx.date || '').slice(0, 10);
          return txDate === todayTashkent;
        });

        if (hasExpenseToday) {
          skippedAlreadyRecorded++;
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

      let sentCount = 0;
      let failedCount = 0;

      if (BOT_TOKEN && uniqueRecipients.length > 0) {
        for (let i = 0; i < uniqueRecipients.length; i++) {
          const rec = uniqueRecipients[i];
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

          if (i < uniqueRecipients.length - 1) {
            await new Promise(r => setTimeout(r, 60));
          }
        }
      }

      // 3. Post to app_notifications so in-app users also see it
      await supabase.from('app_notifications').insert([{
        title: reminder.title,
        message: reminder.text.replace(/<[^>]*>/g, ''),
        emoji: reminder.emoji,
        type: 'reminder',
        target_audience: 'all',
        is_active: true,
        created_at: new Date().toISOString()
      }]).catch(() => {});

      return res.status(200).json({
        success: true,
        reminderSelected: reminder.title,
        totalTargeted: uniqueRecipients.length,
        sent: sentCount,
        failed: failedCount,
        skipped: skippedCount,
        skippedAlreadyRecorded
      });
    } catch (err: any) {
      return res.status(500).json({ error: 'Auto-broadcast failed', details: err?.message });
    }
  }

  // ── USER SEARCH ─────────────────────────────────────────────
  if (route === 'user-search') {
    const q = (typeof req.query.q === 'string' ? req.query.q : '').trim().toLowerCase();
    if (!q || q.length < 2) return res.status(400).json({ error: 'Search query too short (min 2 chars)' });

    try {
      const { data: allUsers, error } = await supabase.from('users').select('*');
      if (error) return res.status(500).json({ error: 'Search failed', details: error.message });

      const results = (allUsers || []).filter(u => {
        if (u.id?.startsWith('req_') || u.id?.startsWith('exchange_')) return false;
        const fields = [
          u.name, u.phone, u.telegram, u.telegram_id?.toString(),
          u.onboarding?.name, u.onboarding?.phone, u.onboarding?.telegram,
          u.onboarding?.telegramId?.toString(), u.id
        ].filter(Boolean).map(f => String(f).toLowerCase());
        return fields.some(f => f.includes(q));
      }).map(u => {
        const access = effectiveAccess(u);
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
      return res.status(500).json({ error: 'Search failed', details: e?.message });
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
      return res.status(500).json({ error: 'Failed to get user detail', details: e?.message });
    }
  }

  // ── AUDIT LOG ───────────────────────────────────────────────
  if (route === 'audit-log') {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const { data: logs, error } = await supabase.from('admin_audit_log')
        .select('*').order('created_at', { ascending: false }).limit(limit);

      if (error) return res.status(500).json({ error: 'Failed to fetch audit log', details: error.message });
      return res.status(200).json({ success: true, logs: logs || [] });
    } catch (e: any) {
      return res.status(500).json({ error: 'Failed to fetch audit log', details: e?.message });
    }
  }

  // ── SEND TELEGRAM MESSAGE (admin → user) ────────────────────
  if (route === 'send-telegram-message' && req.method === 'POST') {
    try {
      const { userId, telegramId, message } = req.body || {};
      if (!message || (!userId && !telegramId)) {
        return res.status(400).json({ error: 'Missing message, userId or telegramId' });
      }

      let chatId = telegramId;
      if (!chatId && userId) {
        // Extract telegram ID from user record
        const { data: user } = await supabase.from('users').select('telegram_id, onboarding').eq('id', userId).maybeSingle();
        chatId = user?.telegram_id || user?.onboarding?.telegramId;
      }

      if (!chatId) return res.status(400).json({ error: 'Could not determine Telegram chat ID' });

      const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8955141731:AAGILXzT69Vity8ZFi-H8XeZc_H6_BFaS8Y';
      if (!BOT_TOKEN) return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN is not configured' });

      const sendResp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML'
        })
      });

      const sendResult = await sendResp.json();
      if (!sendResult.ok) {
        return res.status(500).json({ error: 'Failed to send Telegram message', details: sendResult.description });
      }

      await logAdminAction('send_telegram_message', userId || `tg_${chatId}`, undefined, { chatId, messagePreview: message.slice(0, 100) });

      return res.status(200).json({ success: true, messageId: sendResult.result?.message_id });
    } catch (e: any) {
      return res.status(500).json({ error: 'Failed to send message', details: e?.message });
    }
  }

  // ── EDIT TELEGRAM MESSAGE (admin → bot message) ────────────
  if (route === 'edit-telegram-message' && req.method === 'POST') {
    try {
      const { chatId, messageId, message } = req.body || {};
      if (!chatId || !messageId || !message) {
        return res.status(400).json({ error: 'Missing chatId, messageId or message' });
      }

      const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8955141731:AAGILXzT69Vity8ZFi-H8XeZc_H6_BFaS8Y';
      if (!BOT_TOKEN) return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN is not configured' });

      const editResp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text: message,
          parse_mode: 'HTML'
        })
      });

      const editResult = await editResp.json();
      if (!editResult.ok) {
        return res.status(500).json({ error: 'Failed to edit Telegram message', details: editResult.description });
      }

      await logAdminAction('edit_telegram_message', `tg_${chatId}`, undefined, { chatId, messageId, messagePreview: message.slice(0, 100) });

      return res.status(200).json({ success: true, result: editResult.result });
    } catch (e: any) {
      return res.status(500).json({ error: 'Failed to edit message', details: e?.message });
    }
  }

  // ── DELETE TELEGRAM MESSAGE (admin → bot message) ──────────
  if (route === 'delete-telegram-message' && req.method === 'POST') {
    try {
      const { chatId, messageId } = req.body || {};
      if (!chatId || !messageId) {
        return res.status(400).json({ error: 'Missing chatId or messageId' });
      }

      const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8955141731:AAGILXzT69Vity8ZFi-H8XeZc_H6_BFaS8Y';
      if (!BOT_TOKEN) return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN is not configured' });

      const cleanChatId = String(chatId).replace(/[^\d-]/g, '');
      const delResp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: cleanChatId,
          message_id: messageId
        })
      });

      const delResult = await delResp.json();
      if (!delResult.ok) {
        return res.status(500).json({ error: 'Failed to delete Telegram message', details: delResult.description });
      }

      await logAdminAction('delete_telegram_message', `tg_${chatId}`, undefined, { chatId, messageId });

      return res.status(200).json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: 'Failed to delete message', details: e?.message });
    }
  }

  // ==========================================
  // ROUTE: /api/admin/generate-report
  // Generate deterministic financial metrics + Gemini advisory report
  // ==========================================
  if (route === 'generate-report' && req.method === 'POST') {
    try {
      const { userId, type = 'weekly', sendTelegram = false, force = false, startDate, endDate } = req.body || {};
      if (!userId) return res.status(400).json({ error: 'Missing userId parameter' });

      // Batch individual report generation for all eligible users
      if (userId === 'all') {
        const { data: allUsers } = await supabase
          .from('users')
          .select('id, name, telegram_id, onboarding, transactions')
          .neq('id', 'moliya_system_audit_logs');

        const eligibleUsers = (allUsers || []).filter(u => {
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
            }
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
        return res.status(500).json({ error: result.error || 'Failed to generate report' });
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
      return res.status(500).json({ error: 'Error generating report', details: e?.message });
    }
  }

  // ==========================================
  // ROUTE: /api/admin/run-scheduled-reports
  // Automatic end-of-week & end-of-month scheduled tahlil dispatcher
  // ==========================================
  if (route === 'run-scheduled-reports' && (req.method === 'POST' || req.method === 'GET')) {
    try {
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 86400000);
      const isMonthEnd = tomorrow.getDate() === 1;
      const reportType: 'weekly' | 'monthly' = isMonthEnd ? 'monthly' : 'weekly';

      const { data: allUsers } = await supabase
        .from('users')
        .select('id, name, telegram_id, onboarding, transactions')
        .neq('id', 'moliya_system_audit_logs');

      const eligibleUsers = (allUsers || []).filter(u => {
        const isBlocked = u.onboarding?.is_blocked || u.onboarding?.is_restricted;
        if (isBlocked) return false;
        const hasTg = u.telegram_id && u.telegram_id !== '—';
        return Boolean(hasTg);
      });

      let sentCount = 0;
      for (const u of eligibleUsers) {
        try {
          const res = await generateAndSaveUserReport(u.id, reportType, { sendTelegram: true, force: false });
          if (res?.success && res.report?.sentToTelegram) sentCount++;
        } catch {}
      }

      return res.status(200).json({
        success: true,
        reportType,
        totalEligible: eligibleUsers.length,
        sentCount,
        executedAt: now.toISOString()
      });
    } catch (err: any) {
      return res.status(500).json({ error: 'Scheduled report error', details: err?.message });
    }
  }

  // ==========================================
  // ROUTE: /api/admin/reports
  // Fetch generated reports (for a single user or globally)
  // ==========================================
  if (route === 'reports' && req.method === 'GET') {
    try {
      const userId = req.query.userId as string;
      if (userId) {
        const { data: user } = await supabase.from('users').select('onboarding').eq('id', userId).maybeSingle();
        const reports = Array.isArray(user?.onboarding?.ai_reports) ? user.onboarding.ai_reports : [];
        return res.status(200).json({ success: true, reports });
      }

      // Global: fetch all reports across users
      const { data: users } = await supabase
        .from('users')
        .select('id, name, telegram, onboarding')
        .not('onboarding->ai_reports', 'is', null)
        .limit(100);

      const allReports: any[] = [];
      (users || []).forEach((u: any) => {
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
      return res.status(500).json({ error: 'Failed to fetch reports', details: e?.message });
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
      const { data: sysRow } = await supabase
        .from('users')
        .select('onboarding')
        .eq('id', 'moliya_system_audit_logs')
        .maybeSingle();

      const fallbackLogs = Array.isArray(sysRow?.onboarding?.logs) ? sysRow.onboarding.logs : [];
      return res.status(200).json({ success: true, logs: fallbackLogs });
    } catch (e: any) {
      return res.status(200).json({ success: true, logs: [] });
    }
  }

  return res.status(404).json({ error: 'Admin route not found', route });
}
