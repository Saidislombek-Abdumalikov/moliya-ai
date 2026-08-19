import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../_supabaseClient.js';
import { maskApiKey, testSpecificAiKey, AiKeyRecord } from '../_aiRouter.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // 1. GET: Fetch all configured AI Keys (Masked) & Aggregate Metrics
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

      // If no keys yet in DB, check env variable for default item
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

      // Fetch AI usage aggregate logs for Admin metrics
      const { data: aiLogs } = await supabase
        .from('ai_logs')
        .select('id, timestamp')
        .limit(1000);

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

      // Format and mask keys for safe frontend rendering
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

      return res.status(200).json({
        success: true,
        keys: safeKeys,
        metrics
      });
    } catch (err: any) {
      console.error('[ADMIN_AI_KEYS] GET error:', err);
      return res.status(500).json({ error: 'Failed to fetch AI keys', details: err?.message });
    }
  }

  // 2. POST: Add, Edit, Delete, Toggle, or Test AI Key
  if (req.method === 'POST') {
    try {
      const { action, keyData, keyId } = req.body || {};
      const nowIso = new Date().toISOString();

      // ACTION: CREATE
      if (action === 'create') {
        const { name, provider, apiKey, model, priority, status } = keyData || {};
        if (!apiKey || !provider) {
          return res.status(400).json({ error: 'Missing required apiKey or provider' });
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

        const { error: insertErr } = await supabase.from('ai_keys').insert(record);
        if (insertErr) {
          console.warn('[ADMIN_AI_KEYS] Supabase insert warning (creating in-memory fallback):', insertErr);
        }

        return res.status(200).json({
          success: true,
          message: 'AI kaliti muvaffaqiyatli saqlandi! 🔑',
          key: {
            ...record,
            maskedKey: maskApiKey(record.api_key),
            api_key: undefined
          }
        });
      }

      // ACTION: UPDATE
      if (action === 'update') {
        if (!keyId) return res.status(400).json({ error: 'Missing keyId' });

        const updatePayload: any = {
          updated_at: nowIso
        };

        if (keyData.name) updatePayload.name = keyData.name;
        if (keyData.provider) updatePayload.provider = keyData.provider;
        if (keyData.model) updatePayload.model = keyData.model;
        if (keyData.priority !== undefined) updatePayload.priority = Number(keyData.priority);
        if (keyData.status) updatePayload.status = keyData.status;

        // If new secret API key provided (not masked)
        if (keyData.apiKey && !keyData.apiKey.startsWith('••••')) {
          updatePayload.api_key = keyData.apiKey.trim();
        }

        await supabase.from('ai_keys').update(updatePayload).eq('id', keyId);

        return res.status(200).json({
          success: true,
          message: 'AI kaliti yangilandi! ✏️'
        });
      }

      // ACTION: TOGGLE (Enable / Disable)
      if (action === 'toggle') {
        if (!keyId) return res.status(400).json({ error: 'Missing keyId' });

        const { data: existing } = await supabase.from('ai_keys').select('status').eq('id', keyId).maybeSingle();
        const nextStatus = existing?.status === 'active' ? 'disabled' : 'active';

        await supabase.from('ai_keys').update({ status: nextStatus, updated_at: nowIso }).eq('id', keyId);

        return res.status(200).json({
          success: true,
          status: nextStatus,
          message: `AI kaliti ${nextStatus === 'active' ? 'faollashtirildi 🟢' : 'o\'chirildi ⚪'}`
        });
      }

      // ACTION: DELETE
      if (action === 'delete') {
        if (!keyId) return res.status(400).json({ error: 'Missing keyId' });

        await supabase.from('ai_keys').delete().eq('id', keyId);

        return res.status(200).json({
          success: true,
          message: 'AI kaliti o\'chirildi 🗑️'
        });
      }

      // ACTION: TEST
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
          return res.status(400).json({ error: 'No key provided to test' });
        }

        const testResult = await testSpecificAiKey(keyToTest);

        if (keyId) {
          // Update status in DB
          const newStatus = testResult.healthy ? 'active' : testResult.status.includes('Rate') ? 'rate_limited' : 'invalid';
          await supabase.from('ai_keys').update({
            status: newStatus,
            last_error: testResult.error || null,
            last_error_at: testResult.healthy ? null : nowIso,
            updated_at: nowIso
          }).eq('id', keyId);
        }

        return res.status(200).json({
          success: true,
          healthy: testResult.healthy,
          status: testResult.status,
          latencyMs: testResult.latencyMs,
          error: testResult.error
        });
      }

      return res.status(400).json({ error: 'Invalid action' });
    } catch (err: any) {
      console.error('[ADMIN_AI_KEYS] POST error:', err);
      return res.status(500).json({ error: 'Operation failed', details: err?.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
