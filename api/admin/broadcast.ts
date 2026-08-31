import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../_supabaseClient.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Admin authentication
  const ADMIN_KEY = process.env.ADMIN_SECRET_KEY;
  if (!ADMIN_KEY || req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { message, target } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Missing broadcast message' });
    }

    const chatIds = new Set<string>();

    // Query recipients from Supabase users table
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

    console.log(`[BROADCAST] Target: ${target}, total recipients found in Supabase: ${chatIds.size}`);

    // Send messages via Telegram API
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
    console.error('Error in /api/admin/broadcast:', e);
    return res.status(500).json({ error: 'Broadcast failed', details: e?.message });
  }
}
