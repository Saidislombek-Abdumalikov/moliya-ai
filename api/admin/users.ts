import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../_supabaseClient.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // 1. GET: Fetch all users from Supabase with device info
  if (req.method === 'GET') {
    try {
      const { data: suUsers, error } = await supabase
        .from('users')
        .select('*')
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('[ADMIN_USERS] Supabase fetch error:', error.message);
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
      console.error('Error in /api/admin/users GET:', e);
      return res.status(500).json({ error: 'Failed to fetch users', details: e?.message });
    }
  }

  // 2. POST: User management actions
  if (req.method === 'POST') {
    try {
      const { userId, action, isPremium, aiLimit, phone } = req.body || {};
      if (!userId) return res.status(400).json({ error: 'Missing userId' });

      const nowIso = new Date().toISOString();
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
          // aiLimit: null = unlimited, 0/-1 = unlimited, >0 = custom limit
          const limitValue = (aiLimit === null || aiLimit === undefined || aiLimit === -1 || aiLimit === 0) ? null : Number(aiLimit);
          const { error } = await supabase
            .from('users')
            .update({
              ai_limit: limitValue,
              ai_query_count: 0, // Reset count when limit changes
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

        default: {
          // Legacy fallback: simple isPremium toggle
          if (isPremium !== undefined) {
            const { error } = await supabase
              .from('users')
              .upsert({
                id: userId,
                is_premium: !!isPremium,
                updated_at: nowIso
              }, { onConflict: 'id' });

            if (error) return res.status(500).json({ error: 'Failed to update user', details: error.message });
            return res.status(200).json({ success: true, userId, isPremium: !!isPremium });
          }
          return res.status(400).json({ error: 'Missing action or isPremium field' });
        }
      }
    } catch (e: any) {
      console.error('Error in /api/admin/users POST:', e);
      return res.status(500).json({ error: 'Failed to update user', details: e?.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
