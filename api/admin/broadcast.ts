import type { VercelRequest, VercelResponse } from '@vercel/node';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../_firebaseClient.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { message, target } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Missing broadcast message' });
    }

    // Fetch all user docs to extract telegramIds
    const snap = await getDocs(collection(db, 'users'));
    const chatIds = new Set<string>();

    snap.forEach(d => {
      const data = d.data();
      const tgId = data.telegramId || data.onboarding?.telegramId;
      const isPrem = data.isPremium || data.onboarding?.isPremium;

      if (tgId) {
        if (target === 'premium' && !isPrem) return;
        if (target === 'free' && isPrem) return;
        chatIds.add(String(tgId));
      }
    });

    console.log(`[BROADCAST] Target: ${target}, unique recipients: ${chatIds.size}`);

    // Send messages in parallel chunks
    if (BOT_TOKEN && chatIds.size > 0) {
      const promises = Array.from(chatIds).map(async (chatId) => {
        try {
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: message,
              parse_mode: 'HTML'
            })
          });
        } catch (err) {
          console.error(`Broadcast error to ${chatId}:`, err);
        }
      });

      await Promise.all(promises);
    }

    return res.status(200).json({ success: true, count: chatIds.size });
  } catch (e: any) {
    console.error('Error in /api/admin/broadcast:', e);
    return res.status(500).json({ error: 'Broadcast failed' });
  }
}
