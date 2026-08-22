import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../_supabaseClient.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8955141731:AAF0axUBdGs6D1LN32tNncb2cOp47-z9oho";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      title,
      message,
      emoji,
      type = 'info',           // info, feature, maintenance, promo
      target = 'all',           // Legacy field
      target_audience,          // New field: all, vip_only, free_only
      image_url,
      action_url,
      expire_hours = 72
    } = req.body || {};

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Missing broadcast message' });
    }

    const audience = target_audience || target || 'all';
    const expiresAt = new Date(Date.now() + Number(expire_hours) * 60 * 60 * 1000).toISOString();

    // 1. Insert into app_notifications table for in-app display
    const notifPayload: any = {
      title: title || 'Yangilanish',
      message,
      emoji: emoji || (type === 'info' ? 'ℹ️' : type === 'feature' ? '✨' : type === 'maintenance' ? '🔧' : type === 'promo' ? '🎁' : '📢'),
      type,
      target: audience,           // Keep 'target' column for frontend filtering
      target_audience: audience,
      image_url: image_url || null,
      action_url: action_url || null,
      is_active: true,
      expires_at: expiresAt,
      created_at: new Date().toISOString()
    };

    const { data: insertedNotif, error: insertError } = await supabase
      .from('app_notifications')
      .insert([notifPayload])
      .select()
      .maybeSingle();

    if (insertError) {
      console.error('[BROADCAST] Failed to insert notification:', insertError.message);
    }

    // 2. Send Telegram bot messages
    const chatIds = new Set<string>();
    const { data: users, error } = await supabase
      .from('users')
      .select('telegram_id, is_premium, onboarding');

    if (!error && Array.isArray(users)) {
      users.forEach(u => {
        const tgId = u.telegram_id || u.onboarding?.telegramId;
        const isPrem = u.is_premium || u.onboarding?.isPremium;
        if (tgId) {
          if (audience === 'vip_only' && !isPrem) return;
          if (audience === 'free_only' && isPrem) return;
          // 'premium' legacy value maps to vip_only
          if (audience === 'premium' && !isPrem) return;
          if (audience === 'free' && isPrem) return;
          chatIds.add(String(tgId));
        }
      });
    }

    console.log(`[BROADCAST] Audience: ${audience}, Type: ${type}, Recipients: ${chatIds.size}`);

    let sentCount = 0;
    if (BOT_TOKEN && chatIds.size > 0) {
      const typeEmoji = emoji || (type === 'info' ? 'ℹ️' : type === 'feature' ? '✨' : type === 'maintenance' ? '🔧' : type === 'promo' ? '🎁' : '📢');
      const fullMessage = `${typeEmoji} <b>${title || 'Moliya AI'}</b>\n\n${message}`;

      const promises = Array.from(chatIds).map(async (chatId) => {
        try {
          const sendRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: fullMessage,
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

    return res.status(200).json({
      success: true,
      notificationId: insertedNotif?.id || null,
      audience,
      type,
      totalTargeted: chatIds.size,
      sentCount
    });
  } catch (e: any) {
    console.error('Error in /api/admin/broadcast:', e);
    return res.status(500).json({ error: 'Broadcast failed', details: e?.message });
  }
}
