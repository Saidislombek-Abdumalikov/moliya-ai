import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from "@google/genai";
import crypto from "crypto";
import { supabase } from './_supabaseClient.js';
import { getCandidateAiKeys } from './_aiRouter.js';
import { checkAiQuota, recordAiUsage } from './_aiQuotaHelper.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const appUrl = process.env.APP_URL || "https://moliya-ai-pi.vercel.app";

// ── Telegram API Helpers ─────────────────────────────────────
async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  replyMarkup?: any
) {
  if (!BOT_TOKEN) {
    console.error('[BOT] TELEGRAM_BOT_TOKEN is missing');
    return null;
  }
  try {
    const payload: any = {
      chat_id: String(chatId),
      text,
      parse_mode: 'HTML',
    };
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    console.error('[BOT] Failed to send Telegram message:', err);
    return null;
  }
}

async function editTelegramMessage(
  chatId: number | string,
  messageId: number,
  text: string,
  replyMarkup?: any
) {
  if (!BOT_TOKEN) return null;
  try {
    const payload: any = {
      chat_id: String(chatId),
      message_id: messageId,
      text,
      parse_mode: 'HTML'
    };
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    console.error('[BOT] Failed to edit Telegram message:', err);
    return null;
  }
}

async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  if (!BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text
      })
    });
  } catch (err) {
    console.error('[BOT] Failed to answer callback query:', err);
  }
}

async function getTelegramFileUrl(fileId: string): Promise<string | null> {
  if (!BOT_TOKEN) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
    const data = await res.json();
    if (data.ok && data.result?.file_path) {
      return `https://api.telegram.org/file/bot${BOT_TOKEN}/${data.result.file_path}`;
    }
  } catch (err) {
    console.error('[BOT] Failed to get file URL:', err);
  }
  return null;
}

// ── Canonical User Resolution & Creation ─────────────────────
async function resolveCanonicalUser(fromUser: any) {
  const tgId = String(fromUser.id);
  const userId = `moliya_user_tg_${tgId}`;
  const now = new Date().toISOString();
  const fullName = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ') || 'Foydalanuvchi';
  const username = fromUser.username ? `@${fromUser.username}` : null;

  // 1. Fetch existing user
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (existing) {
    // Check if blocked
    const isBlocked = Boolean(
      existing.is_blocked ||
      existing.onboarding?.is_blocked ||
      existing.device_info?.is_blocked ||
      existing.is_restricted ||
      existing.onboarding?.is_restricted ||
      existing.device_info?.restricted
    );

    return { user: existing, userId, isBlocked, isNew: false };
  }

  // 2. Create canonical user record
  const newOnboarding = {
    completed: true,
    language: 'uz',
    name: fullName,
    telegram: username,
    telegramId: tgId,
  };

  const newPayload = {
    id: userId,
    name: fullName,
    telegram: username,
    telegram_id: tgId,
    phone: null,
    language: 'uz',
    is_premium: false,
    ai_limit: 20,
    ai_query_count: 0,
    platform: 'telegram',
    cards: [],
    transactions: [],
    onboarding: newOnboarding,
    created_at: now,
    updated_at: now
  };

  await supabase.from('users').upsert(newPayload, { onConflict: 'id' });

  return { user: newPayload, userId, isBlocked: false, isNew: true };
}

// ── Authentication Handshake & Web Login ─────────────────────
async function verifyAndMarkLoginRequest(requestId: string, fromUser: any) {
  try {
    const tgId = String(fromUser.id);
    const userId = `moliya_user_tg_${tgId}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 24 * 3600 * 1000).toISOString();

    const randomHex = crypto.randomBytes(16).toString('hex');
    const sessionToken = 'sess_' + randomHex;

    const { user, isBlocked } = await resolveCanonicalUser(fromUser);
    if (isBlocked) return null;

    // Mark login request as VERIFIED
    const cleanId = requestId.replace(/^req_/, '').trim();
    await supabase.from('users').upsert({
      id: `req_${cleanId}`,
      login_request_id: cleanId,
      login_request_status: 'VERIFIED',
      telegram_id: tgId,
      session_token: sessionToken,
      updated_at: now.toISOString()
    }, { onConflict: 'id' });

    // Generate 5-minute single-use exchange code
    const exchangeCode = crypto.randomBytes(24).toString('hex');
    const codeExpiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
    await supabase.from('users').upsert({
      id: `exchange_${exchangeCode}`,
      telegram_id: tgId,
      session_token: sessionToken,
      login_request_status: 'VALID',
      session_expires_at: codeExpiresAt,
      updated_at: now.toISOString()
    }, { onConflict: 'id' });

    return { sessionToken, userId, exchangeCode };
  } catch (err) {
    console.error('[BOT] Error verifying login request:', err);
    return null;
  }
}

// ── Transaction Helper ───────────────────────────────────────
async function saveBotTransaction(userId: string, txItem: { id: string; type: string; name: string; category: string; amount: number; date: string; time?: string; note?: string }) {
  try {
    const { data: user } = await supabase.from('users').select('transactions').eq('id', userId).maybeSingle();
    const currentTxs = Array.isArray(user?.transactions) ? user.transactions : [];
    const updated = [txItem, ...currentTxs.filter((t: any) => t.id !== txItem.id)];
    await supabase.from('users').update({ transactions: updated, updated_at: new Date().toISOString() }).eq('id', userId);
  } catch (err) {
    console.error('[BOT] Error saving transaction:', err);
  }
}

// ── Category Emoji Map ───────────────────────────────────────
const CATEGORY_EMOJIS: Record<string, string> = {
  'Oziq-ovqat': '🍔',
  'Transport': '🚕',
  'Kiyim': '👕',
  'Kommunal': '💡',
  'Sog\'liq': '💊',
  'Ta\'lim': '📚',
  'Ko\'ngil ochar': '🎮',
  'Boshqa': '📦',
  'Maosh': '💼',
  'Freelance': '💻',
  'Biznes': '📈',
  'Sovg\'a': '🎁',
  'Investitsiya': '📊',
  'Do\'st': '🤝',
  'Bank': '🏦',
  'Oila': '👨‍👩‍👦',
  'Hamkasb': '👥'
};

// ── AI Parser Helper ─────────────────────────────────────────
async function parseTextWithAi(text: string) {
  const candidateKeys = await getCandidateAiKeys();
  const envKey = process.env.GEMINI_API_KEY;
  const keysToTry = candidateKeys.length > 0
    ? candidateKeys.map(k => k.api_key)
    : (envKey ? [envKey] : []);

  if (keysToTry.length === 0) {
    return null;
  }

  const prompt = `You are a financial AI assistant for Moliya AI. Parse this transaction text in Uzbek, Russian, or English: "${text}".
Return JSON object:
- type: 'expense' (spending), 'income' (salary/earnings), 'debt' (borrowed), or 'lending' (loaned)
- amount: total amount in numbers (e.g. "45 ming" -> 45000, "1.5 mln" -> 1500000, "100 dollar" -> 100, "ellik ming" -> 50000)
- category: exactly one from: ['Oziq-ovqat', 'Transport', 'Kiyim', 'Kommunal', 'Sog\\'liq', 'Ta\\'lim', 'Ko\\'ngil ochar', 'Boshqa', 'Maosh', 'Freelance', 'Biznes', 'Sovg\\'a', 'Investitsiya', 'Do\\'st', 'Bank', 'Oila', 'Hamkasb']
- note: meaningful description of the item or expense
- title: concise 2-3 word title`;

  for (const key of keysToTry) {
    try {
      const ai = new GoogleGenAI({ apiKey: key.trim() });
      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              type: { type: Type.STRING },
              amount: { type: Type.NUMBER },
              category: { type: Type.STRING },
              note: { type: Type.STRING },
              title: { type: Type.STRING }
            },
            required: ["type", "amount", "category", "note"]
          }
        }
      });

      if (response?.text) {
        return JSON.parse(response.text);
      }
    } catch (e) {
      console.warn('[BOT] Gemini parse error with key, trying next...', e);
    }
  }

  return null;
}

// ── Main Webhook Handler ─────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'Moliya AI Telegram Webhook Live' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const update = req.body;
    if (!update) return res.status(200).json({ status: 'no_body' });

    // 1. Handle Inline Callbacks
    if (update.callback_query) {
      const cb = update.callback_query;
      const data = cb.data;
      const chatId = cb.message?.chat?.id;
      const fromUser = cb.from;

      if (!fromUser) return res.status(200).json({ status: 'no_user' });

      const tgId = String(fromUser.id);
      const userId = `moliya_user_tg_${tgId}`;

      // Restriction check
      const { data: userRow } = await supabase.from('users').select('is_blocked, onboarding, device_info').eq('id', userId).maybeSingle();
      const isBlocked = Boolean(userRow?.is_blocked || userRow?.onboarding?.is_blocked || userRow?.device_info?.is_blocked);
      if (isBlocked) {
        await answerCallbackQuery(cb.id, "⛔ Hisobingiz cheklangan");
        return res.status(200).json({ status: 'blocked' });
      }

      if (chatId && data && data.startsWith('del_')) {
        const txId = data.replace('del_', '');
        const { data: u } = await supabase.from('users').select('transactions').eq('id', userId).maybeSingle();
        const txs = Array.isArray(u?.transactions) ? u.transactions : [];
        const updated = txs.filter((t: any) => String(t.id) !== String(txId));
        await supabase.from('users').update({ transactions: updated, updated_at: new Date().toISOString() }).eq('id', userId);

        await answerCallbackQuery(cb.id, "🗑 Operatsiya o'chirildi!");
        if (cb.message?.message_id) {
          await editTelegramMessage(chatId, cb.message.message_id, "🗑 <b>Operatsiya o'chirildi.</b> ✅");
        }
      }
      return res.status(200).json({ status: 'ok' });
    }

    // 2. Handle Messages
    const message = update.message || update.edited_message;
    if (!message) return res.status(200).json({ status: 'no_message' });

    const chatId = message.chat?.id;
    const fromUser = message.from;
    const text = (message.text || '').trim();

    if (!fromUser || !chatId) return res.status(200).json({ status: 'invalid_chat' });

    // Canonical Identity Resolution & Restriction Check
    const { user, userId, isBlocked } = await resolveCanonicalUser(fromUser);

    if (isBlocked) {
      await sendTelegramMessage(
        chatId,
        `⛔ <b>Hisobingiz ma'muriyat tomonidan cheklangan!</b>\n\nSiz ushbu bot va Moliya AI tizimidan foydalana olmaysiz. Cheklovni bekor qilish uchun ma'muriyat bilan bog'laning.`,
        { remove_keyboard: true }
      );
      return res.status(200).json({ status: 'restricted' });
    }

    // Handle Contact Share (Phone Number)
    if (message.contact) {
      const contact = message.contact;
      const phone = contact.phone_number?.startsWith('+') ? contact.phone_number : `+${contact.phone_number}`;

      await supabase.from('users').update({
        phone,
        updated_at: new Date().toISOString()
      }).eq('id', userId);

      await sendTelegramMessage(
        chatId,
        `✅ <b>Telefon raqamingiz muvaffaqiyatli saqlandi!</b> 🎉\n\n📞 <b>Raqam:</b> ${phone}\n\n👇 <i>Moliya AI imkoniyatlaridan to'liq foydalanishingiz mumkin:</i>`,
        {
          inline_keyboard: [
            [{ text: "📱 Moliya Mini App", web_app: { url: appUrl } }]
          ]
        }
      );
      return res.status(200).json({ status: 'ok' });
    }

    // Handle /start Command
    if (text.startsWith('/start')) {
      const rawArg = text.replace('/start', '').trim();
      const requestId = rawArg.replace('req_', '').trim();

      if (requestId && requestId.length >= 8) {
        // Web login exchange flow
        const verifyResult = await verifyAndMarkLoginRequest(requestId, fromUser);
        const code = verifyResult?.exchangeCode;
        const targetUrl = code ? `${appUrl}?code=${code}` : appUrl;

        await sendTelegramMessage(
          chatId,
          `<b>Assalomu alaykum, ${fromUser.first_name || 'foydalanuvchi'}!</b> 👋✨\n\n` +
          `✅ <b>Profilingiz tasdiqlandi!</b> 🚀\n` +
          `Brauzeringizdagi Moliya AI sahifasiga qaytsangiz, profilingiz avtomatik ochiladi.\n\n` +
          `👇 <i>Ilovaga kirish:</i>`,
          {
            inline_keyboard: [
              [{ text: "📱 Moliya Mini App", web_app: { url: targetUrl } }],
              [{ text: "🌐 Web Ilovaga o'tish", url: targetUrl }]
            ]
          }
        );
        return res.status(200).json({ status: 'ok' });
      }

      // Normal bot start
      const welcomeText =
        `<b>Assalomu alaykum, ${fromUser.first_name || 'foydalanuvchi'}!</b> 👋✨\n\n` +
        `Men <b>Moliya AI</b> — shaxsiy moliyaviy yordamchingizman.\n\n` +
        `💡 <b>Qanday ishlatish mumkin?</b>\n` +
        `• <b>Xarajat yozish:</b> <i>"50 000 go'sht oldim"</i> yoki <i>"taksi 15000"</i>\n` +
        `• <b>Daromad yozish:</b> <i>"Maosh oldim 5 000 000"</i>\n` +
        `• <b>Ovozli xabar:</b> Ovoz bilan xarajatni gapirib yuboring 🎙\n` +
        `• <b>Chek skaner:</b> Xarid cheki rasmini yuboring 📸\n\n` +
        `📊 /stats — Oylik hisobot va balansni ko'rish\n` +
        `❓ /help — Yordam va yo'riqnoma\n\n` +
        `👇 <i>Ilovani ochish uchun quyidagi tugmani bosing:</i>`;

      await sendTelegramMessage(chatId, welcomeText, {
        inline_keyboard: [
          [{ text: "📱 Moliya Mini App", web_app: { url: appUrl } }]
        ]
      });
      return res.status(200).json({ status: 'ok' });
    }

    // Handle /help Command
    if (text.startsWith('/help') || text.startsWith('/yordam')) {
      const helpText =
        `ℹ️ <b>Moliya AI Botdan foydalanish yo'riqnomasi</b>\n\n` +
        `📝 <b>1. Oddiy matn bilan:</b>\n` +
        `Shunchaki xarajatingizni yozing, masalan:\n` +
        `• <i>"Bozordan 120 000 so'mga oziq-ovqat oldim"</i>\n` +
        `• <i>"Benzin 200 000"</i>\n` +
        `• <i>"Kofega 25 ming ketdi"</i>\n\n` +
        `🎙 <b>2. Ovozli xabar:</b>\n` +
        `Ovoz tugmasini bosib, qayerga qancha sarflaganingizni ayting.\n\n` +
        `📸 <b>3. Chek rasmi:</b>\n` +
        `Supermarket yoki to'lov chekini rasmga olib yuboring.\n\n` +
        `📊 <b>Buyruqlar:</b>\n` +
        `• /stats — Oylik xarajatlar tahlili\n` +
        `• /start — Bosh sahifa`;

      await sendTelegramMessage(chatId, helpText, {
        inline_keyboard: [
          [{ text: "📱 Moliya Mini App", web_app: { url: appUrl } }]
        ]
      });
      return res.status(200).json({ status: 'ok' });
    }

    // Handle /stats or /hisobot Command
    if (text.startsWith('/stats') || text.startsWith('/hisobot')) {
      const { data: u } = await supabase.from('users').select('transactions').eq('id', userId).maybeSingle();
      const txs = Array.isArray(u?.transactions) ? u.transactions : [];

      const currentMonth = new Date().getMonth() + 1;
      const currentYear = new Date().getFullYear();

      let totalExpense = 0;
      let totalIncome = 0;
      const catTotals: Record<string, number> = {};

      for (const t of txs) {
        const amt = Number(t.amount || 0);
        if (t.type === 'income') {
          totalIncome += amt;
        } else {
          totalExpense += amt;
          const cat = t.category || 'Boshqa';
          catTotals[cat] = (catTotals[cat] || 0) + amt;
        }
      }

      const balance = totalIncome - totalExpense;
      const sortedCats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 5);

      let breakdownText = '';
      for (const [cat, sum] of sortedCats) {
        const emoji = CATEGORY_EMOJIS[cat] || '📦';
        breakdownText += `${emoji} <b>${cat}:</b> ${sum.toLocaleString()} so'm\n`;
      }

      const statsText =
        `📊 <b>Joriy oylik hisobot (${currentMonth}/${currentYear})</b>\n\n` +
        `🔴 <b>Jami xarajat:</b> ${totalExpense.toLocaleString()} so'm\n` +
        `🟢 <b>Jami daromad:</b> ${totalIncome.toLocaleString()} so'm\n` +
        `💰 <b>Balans:</b> ${balance.toLocaleString()} so'm\n\n` +
        (breakdownText ? `<b>Top xarajat kategoriyalari:</b>\n${breakdownText}\n` : '') +
        `👇 <i>Batafsil ko'rish uchun Mini Appni oching:</i>`;

      await sendTelegramMessage(chatId, statsText, {
        inline_keyboard: [
          [{ text: "📱 Mini Appda to'liq ko'rish", web_app: { url: appUrl } }]
        ]
      });
      return res.status(200).json({ status: 'ok' });
    }

    // Handle /clear Command
    if (text.startsWith('/clear')) {
      await sendTelegramMessage(
        chatId,
        `🧹 <b>Klaviatura tozalandi.</b>\n\nXarajat yozish uchun oddiy matn yuboring yoki quyidagi tugma orqali Mini Appni oching:`,
        {
          remove_keyboard: true,
          inline_keyboard: [
            [{ text: "📱 Moliya Mini App", web_app: { url: appUrl } }]
          ]
        }
      );
      return res.status(200).json({ status: 'ok' });
    }

    // Handle Voice Message (Audio Parsing)
    if (message.voice) {
      const quota = await checkAiQuota(userId);
      if (!quota.allowed) {
        await sendTelegramMessage(chatId, `⚠️ ${quota.message || "AI so'rovlar limitingiz tugadi."}`);
        return res.status(200).json({ status: 'quota_exceeded' });
      }

      const fileUrl = await getTelegramFileUrl(message.voice.file_id);
      if (fileUrl) {
        try {
          const audioRes = await fetch(fileUrl);
          const arrayBuffer = await audioRes.arrayBuffer();
          const base64Audio = Buffer.from(arrayBuffer).toString('base64');

          const candidateKeys = await getCandidateAiKeys();
          const envKey = process.env.GEMINI_API_KEY;
          const apiKey = candidateKeys[0]?.api_key || envKey || '';

          if (apiKey) {
            const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
            const prompt = `You are a financial AI assistant for Moliya AI. Listen to this voice note and extract the financial transaction in Uzbek/Russian.
Return JSON with:
- type: 'expense' | 'income'
- amount: number
- category: 'Oziq-ovqat' | 'Transport' | 'Kiyim' | 'Kommunal' | 'Sog\'liq' | 'Ta\'lim' | 'Ko\'ngil ochar' | 'Boshqa' | 'Maosh'
- note: text description
- title: 2-3 word title`;

            const audioResult = await ai.models.generateContent({
              model: 'gemini-2.0-flash',
              contents: [
                {
                  role: 'user',
                  parts: [
                    {
                      inlineData: {
                        mimeType: 'audio/ogg',
                        data: base64Audio
                      }
                    },
                    { text: prompt }
                  ]
                }
              ],
              config: {
                responseMimeType: "application/json"
              }
            });

            if (audioResult.text) {
              const parsed = JSON.parse(audioResult.text);
              if (parsed.amount) {
                const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                const now = new Date();
                const newTx = {
                  id: txId,
                  type: parsed.type || 'expense',
                  name: parsed.title || parsed.note || 'Ovozli xarajat',
                  category: parsed.category || 'Boshqa',
                  amount: Number(parsed.amount),
                  date: now.toISOString().slice(0, 10),
                  time: now.toTimeString().slice(0, 5),
                  note: parsed.note || 'Ovozli kiritilgan'
                };

                await saveBotTransaction(userId, newTx);
                await recordAiUsage(userId, 'text', parsed.note || 'Voice expense', quota.isPremium);

                const emoji = CATEGORY_EMOJIS[newTx.category] || '💸';
                const successMsg =
                  `✅ <b>Ovozli xabar saqlandi!</b>\n\n` +
                  `${emoji} <b>Kategoriya:</b> ${newTx.category}\n` +
                  `💰 <b>Summa:</b> ${newTx.amount.toLocaleString()} so'm\n` +
                  `📝 <b>Izoh:</b> ${newTx.name}\n` +
                  `📅 <b>Sana:</b> ${newTx.date} ${newTx.time}`;

                await sendTelegramMessage(chatId, successMsg, {
                  inline_keyboard: [
                    [{ text: "🗑 O'chirish", callback_data: `del_${txId}` }],
                    [{ text: "📱 Mini Appda ko'rish", web_app: { url: appUrl } }]
                  ]
                });
                return res.status(200).json({ status: 'ok' });
              }
            }
          }
        } catch (voiceErr) {
          console.error('[BOT] Voice parsing error:', voiceErr);
        }
      }
    }

    // Handle Photo (Receipt OCR Parsing)
    if (message.photo && message.photo.length > 0) {
      const quota = await checkAiQuota(userId);
      if (!quota.allowed) {
        await sendTelegramMessage(chatId, `⚠️ ${quota.message || "AI so'rovlar limitingiz tugadi."}`);
        return res.status(200).json({ status: 'quota_exceeded' });
      }

      const photo = message.photo[message.photo.length - 1];
      const fileUrl = await getTelegramFileUrl(photo.file_id);
      if (fileUrl) {
        try {
          const imgRes = await fetch(fileUrl);
          const arrayBuffer = await imgRes.arrayBuffer();
          const base64Img = Buffer.from(arrayBuffer).toString('base64');

          const candidateKeys = await getCandidateAiKeys();
          const envKey = process.env.GEMINI_API_KEY;
          const apiKey = candidateKeys[0]?.api_key || envKey || '';

          if (apiKey) {
            const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
            const prompt = `You are an OCR receipt scanner for Moliya AI. Extract receipt info into JSON:
- type: 'expense'
- amount: total amount paid
- category: choose best fit from ['Oziq-ovqat', 'Transport', 'Kiyim', 'Kommunal', 'Sog\\'liq', 'Ko\\'ngil ochar', 'Boshqa']
- note: store or merchant name and summary
- title: merchant name`;

            const imgResult = await ai.models.generateContent({
              model: 'gemini-2.0-flash',
              contents: [
                {
                  role: 'user',
                  parts: [
                    {
                      inlineData: {
                        mimeType: 'image/jpeg',
                        data: base64Img
                      }
                    },
                    { text: prompt }
                  ]
                }
              ],
              config: {
                responseMimeType: "application/json"
              }
            });

            if (imgResult.text) {
              const parsed = JSON.parse(imgResult.text);
              if (parsed.amount) {
                const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                const now = new Date();
                const newTx = {
                  id: txId,
                  type: 'expense',
                  name: parsed.title || parsed.note || 'Chek xarajati',
                  category: parsed.category || 'Oziq-ovqat',
                  amount: Number(parsed.amount),
                  date: now.toISOString().slice(0, 10),
                  time: now.toTimeString().slice(0, 5),
                  note: parsed.note || 'Chek skaner qilindi'
                };

                await saveBotTransaction(userId, newTx);
                await recordAiUsage(userId, 'receipt', parsed.note || 'Receipt scan', quota.isPremium);

                const emoji = CATEGORY_EMOJIS[newTx.category] || '🧾';
                const successMsg =
                  `🧾 <b>Chek muvaffaqiyatli saqlandi!</b>\n\n` +
                  `${emoji} <b>Do'kon/Joy:</b> ${newTx.name}\n` +
                  `💰 <b>Jami summa:</b> ${newTx.amount.toLocaleString()} so'm\n` +
                  `📁 <b>Kategoriya:</b> ${newTx.category}\n` +
                  `📅 <b>Sana:</b> ${newTx.date} ${newTx.time}`;

                await sendTelegramMessage(chatId, successMsg, {
                  inline_keyboard: [
                    [{ text: "🗑 O'chirish", callback_data: `del_${txId}` }],
                    [{ text: "📱 Mini Appda ko'rish", web_app: { url: appUrl } }]
                  ]
                });
                return res.status(200).json({ status: 'ok' });
              }
            }
          }
        } catch (imgErr) {
          console.error('[BOT] Receipt parsing error:', imgErr);
        }
      }
    }

    // Handle Natural Language Text Expense (e.g. "50 000 go'sht oldim", "taksi 15000")
    if (text && !text.startsWith('/')) {
      const quota = await checkAiQuota(userId);
      if (!quota.allowed) {
        await sendTelegramMessage(chatId, `⚠️ ${quota.message || "AI so'rovlar limitingiz tugadi."}`);
        return res.status(200).json({ status: 'quota_exceeded' });
      }

      const parsed = await parseTextWithAi(text);
      if (parsed && parsed.amount) {
        const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const now = new Date();
        const newTx = {
          id: txId,
          type: parsed.type || 'expense',
          name: parsed.title || parsed.note || text,
          category: parsed.category || 'Boshqa',
          amount: Number(parsed.amount),
          date: now.toISOString().slice(0, 10),
          time: now.toTimeString().slice(0, 5),
          note: parsed.note || text
        };

        await saveBotTransaction(userId, newTx);
        await recordAiUsage(userId, 'text', text, quota.isPremium);

        const emoji = CATEGORY_EMOJIS[newTx.category] || (newTx.type === 'income' ? '💰' : '💸');
        const isInc = newTx.type === 'income';

        const successMsg =
          `${isInc ? '🟢' : '🔴'} <b>${isInc ? 'Daromad' : 'Xarajat'} saqlandi!</b>\n\n` +
          `${emoji} <b>Kategoriya:</b> ${newTx.category}\n` +
          `💰 <b>Summa:</b> ${newTx.amount.toLocaleString()} so'm\n` +
          `📝 <b>Izoh:</b> ${newTx.name}\n` +
          `📅 <b>Sana:</b> ${newTx.date} ${newTx.time}`;

        await sendTelegramMessage(chatId, successMsg, {
          inline_keyboard: [
            [{ text: "🗑 O'chirish", callback_data: `del_${txId}` }],
            [{ text: "📱 Mini Appda ko'rish", web_app: { url: appUrl } }]
          ]
        });
        return res.status(200).json({ status: 'ok' });
      } else {
        await sendTelegramMessage(
          chatId,
          `🤔 <b>Summani aniqlab bo'lmadi.</b>\n\nIltimos, xarajatni summa bilan yozing, masalan:\n<i>"50 000 so'm go'sht oldim"</i> yoki <i>"taksi 15000"</i>`,
          {
            inline_keyboard: [
              [{ text: "📱 Moliya Mini App", web_app: { url: appUrl } }]
            ]
          }
        );
        return res.status(200).json({ status: 'ok' });
      }
    }

    return res.status(200).json({ status: 'ok' });
  } catch (err: any) {
    console.error('[BOT] Fatal handler error:', err);
    return res.status(200).json({ error: err.message });
  }
}
