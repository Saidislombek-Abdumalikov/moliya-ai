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
      const { message, target } = req.body || {};
      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'Missing broadcast message' });
      }

      const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
      const chatIds = new Set<string>();

      const { data: users, error } = await supabase
        .from('users')
        .select('telegram_id, is_premium, onboarding');

      if (!error && Array.isArray(users)) {
        users.forEach(u => {
          const tgId = u.telegram_id || u.onboarding?.telegramId;
          const isPrem = u.is_premium || u.onboarding?.isPremium;
          if (tgId) {
            if (target === 'premium' && !isPrem) return;
            if (target === 'free' && isPrem) return;
            chatIds.add(String(tgId));
          }
        });
      }

      let sentCount = 0;
      if (BOT_TOKEN && chatIds.size > 0) {
        const promises = Array.from(chatIds).map(async (chatId) => {
          try {
            const sendRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'HTML'
              })
            });
            if (sendRes.ok) sentCount++;
          } catch (err) {
            console.error(`Broadcast error to ${chatId}:`, err);
          }
        });
        await Promise.all(promises);
      }

      return res.status(200).json({ success: true, totalTargeted: chatIds.size, sentCount });
    } catch (e: any) {
      return res.status(500).json({ error: 'Broadcast failed', details: e?.message });
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

  return res.status(404).json({ error: 'Admin route not found', route });
}
