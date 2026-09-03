import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from './_supabaseClient.js';
import { maskApiKey, testSpecificAiKey, executeAiWithRotation, AiKeyRecord } from './_aiRouter.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Admin authentication guard
  const ADMIN_KEY = process.env.ADMIN_SECRET_KEY;
  if (!ADMIN_KEY || req.headers['x-admin-key'] !== ADMIN_KEY) {
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

        const formatted = (suUsers || []).map(u => ({
          id: u.id,
          name: u.name,
          phone: u.phone,
          telegram: u.telegram,
          telegramId: u.telegram_id,
          isPremium: u.is_premium,
          premiumExpiresAt: u.premium_expires_at,
          isBlocked: u.is_blocked || false,
          language: u.language,
          aiLimit: u.ai_limit,
          aiQueryCount: u.ai_query_count || 0,
          lastAiQueryAt: u.last_ai_query_at,
          deviceInfo: u.device_info || null,
          platform: u.platform || null,
          onboarding: u.onboarding,
          createdAt: u.created_at,
          updatedAt: u.updated_at
        }));
        return res.status(200).json({ success: true, users: formatted, source: 'supabase' });
      } catch (e: any) {
        return res.status(500).json({ error: 'Failed to fetch users', details: e?.message });
      }
    }

    if (req.method === 'POST') {
      try {
        const { userId, action, isPremium, aiLimit } = req.body || {};
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        const effectiveAction = action || (isPremium !== undefined ? (isPremium ? 'grant_vip' : 'revoke_vip') : null);

        switch (effectiveAction) {
          case 'grant_vip': {
            const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
            const { error } = await supabase
              .from('users')
              .update({
                is_premium: true,
                premium_expires_at: expiresAt,
                ai_query_count: 0,
                updated_at: nowIso
              })
              .eq('id', userId);

            if (error) return res.status(500).json({ error: 'Failed to grant VIP', details: error.message });
            return res.status(200).json({ success: true, userId, action: 'grant_vip', isPremium: true, premiumExpiresAt: expiresAt });
          }

          case 'revoke_vip': {
            const { error } = await supabase
              .from('users')
              .update({
                is_premium: false,
                premium_expires_at: null,
                updated_at: nowIso
              })
              .eq('id', userId);

            if (error) return res.status(500).json({ error: 'Failed to revoke VIP', details: error.message });
            return res.status(200).json({ success: true, userId, action: 'revoke_vip', isPremium: false });
          }

          case 'block': {
            const { error } = await supabase
              .from('users')
              .update({ is_blocked: true, updated_at: nowIso })
              .eq('id', userId);

            if (error) return res.status(500).json({ error: 'Failed to block user', details: error.message });
            return res.status(200).json({ success: true, userId, action: 'block', isBlocked: true });
          }

          case 'unblock': {
            const { error } = await supabase
              .from('users')
              .update({ is_blocked: false, updated_at: nowIso })
              .eq('id', userId);

            if (error) return res.status(500).json({ error: 'Failed to unblock user', details: error.message });
            return res.status(200).json({ success: true, userId, action: 'unblock', isBlocked: false });
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
            return res.status(200).json({ success: true, userId, action: 'set_ai_limit', aiLimit: limitValue, aiQueryCount: 0 });
          }

          case 'reset_ai_count': {
            const { error } = await supabase
              .from('users')
              .update({
                ai_query_count: 0,
                updated_at: nowIso
              })
              .eq('id', userId);

            if (error) return res.status(500).json({ error: 'Failed to reset AI count', details: error.message });
            return res.status(200).json({ success: true, userId, action: 'reset_ai_count', aiQueryCount: 0 });
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
              model: 'gemini-2.5-flash',
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

        const safeKeys = keys.map((k: any) => ({
          id: k.id,
          name: k.name || 'Unnamed Key',
          provider: k.provider || 'gemini',
          maskedKey: maskApiKey(k.api_key),
          model: k.model || 'gemini-2.0-flash',
          priority: k.priority || 1,
          status: k.is_active === false ? 'disabled' : (k.health_status || k.status || 'active'),
          isActive: k.is_active !== false,
          healthStatus: k.health_status || 'healthy',
          totalRequests: k.total_requests || 0,
          todayRequests: k.today_requests || 0,
          successRequests: k.success_requests || 0,
          failedRequests: k.failed_requests || 0,
          lastError: k.last_error || null,
          lastUsedAt: k.last_used_at || null,
          createdAt: k.created_at || nowIso,
          updatedAt: k.updated_at || nowIso,
        }));

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
            model: model || (provider === 'google' || provider === 'gemini' ? 'gemini-2.0-flash' : 'gpt-4o-mini'),
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
          return res.status(200).json({ success: true, is_active: nextActive });
        }

        if (action === 'delete') {
          if (!keyId) return res.status(400).json({ error: 'Missing keyId' });
          await supabase.from('ai_keys').delete().eq('id', keyId);
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

      const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
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
      const { userId, telegramId, allUsers = false, sweepRecent = true } = req.body || {};
      const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8955141731:AAGILXzT69Vity8ZFi-H8XeZc_H6_BFaS8Y';

      if (!BOT_TOKEN) {
        return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN is not configured' });
      }

      // Helper: Process message deletion for a single chat
      async function deleteChatMessages(targetChatId: string | number, storedIds: number[], lastMsgId?: number) {
        const idsToDelete = new Set<number>();
        storedIds.forEach(id => {
          if (Number.isInteger(id) && id > 0) idsToDelete.add(id);
        });

        // If sweepRecent requested or stored IDs are empty, discover top active message ID
        let topMsgId = lastMsgId && lastMsgId > 0 ? lastMsgId : null;
        if (sweepRecent || idsToDelete.size === 0) {
          try {
            const probeRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: String(targetChatId),
                text: '·', // Minimal 1-char probe
                disable_notification: true
              })
            });
            const probeData = await probeRes.json();
            if (probeData.ok && probeData.result?.message_id) {
              const probeId = probeData.result.message_id;
              topMsgId = Math.max(topMsgId || 0, probeId);
              idsToDelete.add(probeId);
            }
          } catch {}
        }

        // If top message ID discovered, sweep backwards through recent range (up to 150 messages)
        if (topMsgId && topMsgId > 0) {
          const minId = Math.max(1, topMsgId - 150);
          for (let m = topMsgId; m >= minId; m--) {
            idsToDelete.add(m);
          }
        }

        const idList = Array.from(idsToDelete).sort((a, b) => b - a);
        let deleted = 0;
        let alreadyAbsent = 0;
        let notDeletable = 0;
        let failed = 0;

        // Process in batches of up to 100 via deleteMessages + fallback
        for (let i = 0; i < idList.length; i += 100) {
          const chunk = idList.slice(i, i + 100);
          try {
            const batchRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessages`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: String(targetChatId), message_ids: chunk })
            });
            const batchData = await batchRes.json();
            if (batchData.ok) {
              deleted += chunk.length;
            } else {
              // Fallback to individual deleteMessage to accurately classify results
              const indResults = await Promise.allSettled(
                chunk.map(async (msgId) => {
                  const sRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: String(targetChatId), message_id: msgId })
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
                    } else if (desc.includes("can't be deleted") || desc.includes('cant be deleted')) {
                      notDeletable++;
                    } else {
                      failed++;
                    }
                  }
                } else {
                  failed++;
                }
              });
            }
          } catch {
            failed += chunk.length;
          }

          if (i + 100 < idList.length) {
            await new Promise(r => setTimeout(r, 40));
          }
        }

        // Send ReplyKeyboardRemove packet to permanently wipe client keyboard state
        try {
          const kbRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: String(targetChatId),
              text: '🗑️ <i>Chat tarixi tozalandi.</i>',
              parse_mode: 'HTML',
              reply_markup: { remove_keyboard: true }
            })
          });
          const kbData = await kbRes.json();
          // Immediately delete the confirmation message so chat stays clean
          if (kbData.ok && kbData.result?.message_id) {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: String(targetChatId), message_id: kbData.result.message_id })
            });
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
        let userRow: any = null;
        const uidStr = String(userId).trim();
        const tgIdStr = telegramId && telegramId !== '—' ? String(telegramId).trim() : null;

        // 1. Precise user row resolution across possible ID patterns
        const { data: byId } = await supabase.from('users').select('*').eq('id', uidStr).maybeSingle();
        if (byId) {
          userRow = byId;
        } else {
          const rawId = uidStr.replace('moliya_user_tg_', '');
          const orFilter = tgIdStr
            ? `id.eq.moliya_user_tg_${rawId},telegram_id.eq.${rawId},id.eq.moliya_user_tg_${tgIdStr},telegram_id.eq.${tgIdStr}`
            : `id.eq.moliya_user_tg_${rawId},telegram_id.eq.${rawId}`;
          const { data: byOr } = await supabase.from('users').select('*').or(orFilter).limit(1);
          if (Array.isArray(byOr) && byOr.length > 0) {
            userRow = byOr[0];
          }
        }

        const canonicalUserId = userRow?.id || uidStr;
        const botMessages: any[] = Array.isArray(userRow?.onboarding?.bot_messages) ? userRow.onboarding.bot_messages : [];

        // 2. Chat ID resolution
        const validTgId =
          tgIdStr ||
          userRow?.telegram_id ||
          userRow?.onboarding?.telegramId ||
          (userRow?.id?.startsWith('moliya_user_tg_') ? userRow.id.replace('moliya_user_tg_', '') : null) ||
          (botMessages.find((m: any) => m.chat_id)?.chat_id ? String(botMessages.find((m: any) => m.chat_id).chat_id) : null);

        // 3. Extract real numeric message IDs
        const messageIdsToDelete: number[] = [];
        for (const m of botMessages) {
          const numId = Number(m.message_id);
          if (Number.isInteger(numId) && numId > 0 && !messageIdsToDelete.includes(numId)) {
            messageIdsToDelete.push(numId);
          }
        }

        let deletionSummary = { attempted: 0, deleted: 0, alreadyAbsent: 0, notDeletable: 0, failed: 0 };
        const lastMsgId = Number(userRow?.onboarding?.last_message_id) || 0;

        if (validTgId && validTgId !== '—') {
          deletionSummary = await deleteChatMessages(validTgId, messageIdsToDelete, lastMsgId);
          console.log(`[TelegramDelete] userId=${canonicalUserId} telegramId=${validTgId} attempted=${deletionSummary.attempted} deleted=${deletionSummary.deleted} alreadyAbsent=${deletionSummary.alreadyAbsent} notDeletable=${deletionSummary.notDeletable} failed=${deletionSummary.failed}`);
        }

        // 4. Targeted clear of stored message history records: onboarding.bot_messages = []
        // CRITICAL DATA SAFETY: NEVER TOUCH transactions, cards, phone, name, is_premium, or ai_logs!
        let clearedDbRecords = 0;
        if (userRow) {
          clearedDbRecords = botMessages.length;
          const updatedOnboarding = { ...(userRow.onboarding || {}), bot_messages: [] };
          await supabase.from('users').update({
            onboarding: updatedOnboarding,
            updated_at: new Date().toISOString()
          }).eq('id', canonicalUserId);
        }

        return res.status(200).json({
          success: true,
          userId: canonicalUserId,
          telegramId: validTgId,
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

      const messages = Array.isArray(userRow?.onboarding?.bot_messages) ? userRow.onboarding.bot_messages : [];
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
        skipped: skippedCount
      });
    } catch (err: any) {
      return res.status(500).json({ error: 'Auto-broadcast failed', details: err?.message });
    }
  }

  return res.status(404).json({ error: 'Admin route not found', route });
}
