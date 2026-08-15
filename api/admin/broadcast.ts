import type { VercelRequest, VercelResponse } from '@vercel/node';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../_firebaseClient.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8955141731:AAF0axUBdGs6D1LN32tNncb2cOp47-z9oho";
const PROJECT_ID = "arctic-pad-sn56p";
const DATABASE_ID = "ai-studio-moliyav2-593a4147-5cc2-4aec-9b0e-422088ddb24a";

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

    const chatIds = new Set<string>();

    // 1. Try SDK
    try {
      const snap = await getDocs(collection(db, 'users'));
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
    } catch (sdkErr) {
      console.warn('[BROADCAST] SDK fetch failed, fallback to REST:', sdkErr);
    }

    // 2. REST API fallback if SDK chatIds is empty
    if (chatIds.size === 0) {
      const restUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/users?pageSize=300`;
      const restRes = await fetch(restUrl);
      if (restRes.ok) {
        const json: any = await restRes.json();
        const documents = json.documents || [];
        for (const docObj of documents) {
          const fields = docObj.fields || {};
          const tgId = fields.telegramId?.stringValue || fields.onboarding?.mapValue?.fields?.telegramId?.stringValue;
          const isPrem = fields.isPremium?.booleanValue || fields.onboarding?.mapValue?.fields?.isPremium?.booleanValue;

          if (tgId) {
            if (target === 'premium' && !isPrem) return;
            if (target === 'free' && isPrem) return;
            chatIds.add(String(tgId));
          }
        }
      }
    }

    console.log(`[BROADCAST] Target: ${target}, total recipients found: ${chatIds.size}`);

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
