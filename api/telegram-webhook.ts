import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from "@google/genai";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8955141731:AAGzuBXoKmZii5t_bJcwbJA0Q92gYrFaGnw";
const appUrl = process.env.APP_URL || "https://moliya-ai-pi.vercel.app";

// In-memory Telegram user transaction store
const tgUserTransactions = new Map<number, { id: string; type: string; name: string; category: string; amount: number; date: string }[]>();
const tgUserAiUsage = new Map<number, { firstSeen: number; count: number }>();

const checkAndIncrementAiLimit = (chatId: number): { allowed: boolean; isTrial: boolean; remaining: number } => {
  const now = Date.now();
  let usage = tgUserAiUsage.get(chatId);
  if (!usage) {
    usage = { firstSeen: now, count: 0 };
    tgUserAiUsage.set(chatId, usage);
  }

  const isTrial = (now - usage.firstSeen) < (24 * 3600 * 1000);
  if (isTrial) return { allowed: true, isTrial: true, remaining: 999 };

  if (usage.count >= 5) return { allowed: false, isTrial: false, remaining: 0 };

  usage.count += 1;
  tgUserAiUsage.set(chatId, usage);
  return { allowed: true, isTrial: false, remaining: 5 - usage.count };
};

const getMainMenuKeyboard = () => ({
  keyboard: [
    [{ text: "📱 Telegram Mini App", web_app: { url: appUrl } }, { text: "🌐 Web App", url: appUrl }],
    [{ text: "📊 Balans va Statistika" }, { text: "❌ Oxirgi operatsiyani o'chirish" }],
    [{ text: "💡 Yordam" }]
  ],
  resize_keyboard: true
});

const getDualLinkInlineButtons = () => ({
  inline_keyboard: [
    [
      { text: "📱 Mini App da ochish", web_app: { url: appUrl } },
      { text: "🌐 Web App (Brauzer)", url: appUrl }
    ]
  ]
});

async function sendTelegramMessage(chatId: number | string, text: string, replyMarkup?: any) {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup
      })
    });
  } catch (err) {
    console.error('Failed to send Telegram message:', err);
  }
}

async function answerCallbackQuery(callbackQueryId: string, text: string) {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text })
    });
  } catch (err) {
    console.error('Failed to answer callback query:', err);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(200).send('Telegram Webhook Active');
  }

  // Acknowledge update immediately to prevent Telegram retries
  res.status(200).json({ status: 'ok' });

  try {
    const update = req.body;
    if (!update) return;

    // A) Callback Query
    if (update.callback_query) {
      const cb = update.callback_query;
      const chatId = cb.message?.chat?.id;
      const data = cb.data;

      if (chatId && data && data.startsWith('del_')) {
        const txId = data.replace('del_', '');
        const txs = tgUserTransactions.get(chatId) || [];
        const newTxs = txs.filter(t => t.id !== txId);
        tgUserTransactions.set(chatId, newTxs);

        await answerCallbackQuery(cb.id, "🗑 Operatsiya o'chirildi!");
        await sendTelegramMessage(chatId, "🗑 <b>Operatsiya muvaffaqiyatli o'chirildi!</b> ✅", getMainMenuKeyboard());
      }
      return;
    }

    // B) Text or Voice Message
    if (update.message) {
      const message = update.message;
      const chatId = message.chat?.id;
      const text = message.text;
      const voice = message.voice || message.audio;
      const fromUser = message.from;

      if (!chatId) return;

      // Handle Voice Note
      if (voice && voice.file_id) {
        const limitInfo = checkAndIncrementAiLimit(chatId);
        if (!limitInfo.allowed) {
          const limitMsg = `⚠️ <b>Oylik Bepul AI Limiti Tugadi! (5/5 ishlatildi)</b>\n\nSiz oylik bepul 5 ta AI so'rov imkoniyatizdan foydalandingiz.\nCheksiz AI va ovozli tahlil uchun <b>Premium</b> tarifiga o'ting! ⭐`;
          await sendTelegramMessage(chatId, limitMsg, getDualLinkInlineButtons());
          return;
        }

        try {
          await sendTelegramMessage(chatId, "🎙 <i>Ovozli xabar tahlil qilinmoqda...</i>");

          const fileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${voice.file_id}`);
          const fileData = await fileRes.json();
          if (fileData.ok && fileData.result?.file_path) {
            const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileData.result.file_path}`;
            const audioBufRes = await fetch(downloadUrl);
            const audioArrayBuffer = await audioBufRes.arrayBuffer();
            const base64Audio = Buffer.from(audioArrayBuffer).toString('base64');

            if (process.env.GEMINI_API_KEY) {
              const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
              const promptText = `Listen to this audio financial entry in Uzbek/Russian and parse into JSON:
- type: 'expense' | 'income'
- amount: number
- category: string ('Oziq-ovqat', 'Transport', 'Kiyim', 'Kommunal', 'Sog\'liq', 'Ta\'lim', 'Maosh', 'Boshqa')
- note: string`;

              const response = await ai.models.generateContent({
                model: "gemini-3.1-flash-lite",
                contents: [
                  {
                    inlineData: {
                      mimeType: "audio/ogg",
                      data: base64Audio
                    }
                  },
                  promptText
                ],
                config: {
                  responseMimeType: "application/json",
                  responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                      type: { type: Type.STRING },
                      amount: { type: Type.NUMBER },
                      category: { type: Type.STRING },
                      note: { type: Type.STRING },
                    },
                    required: ["type", "amount", "category", "note"],
                  }
                }
              });

              const parsed = JSON.parse(response.text || '{}');
              if (parsed && parsed.amount && parsed.amount > 0) {
                const txId = 'tx_' + Date.now();
                const txItem = {
                  id: txId,
                  type: parsed.type || 'expense',
                  name: parsed.note || "Ovozli yozuv",
                  category: parsed.category || 'Boshqa',
                  amount: parsed.amount,
                  date: new Date().toISOString()
                };

                const userList = tgUserTransactions.get(chatId) || [];
                userList.push(txItem);
                tgUserTransactions.set(chatId, userList);

                const typeEmoji = parsed.type === 'income' ? '🟢 Daromad' : '🛒 Xarajat';
                const formattedAmt = parsed.amount.toLocaleString('en-US').replace(/,/g, ' ');

                const replyCard = `🎙 <b>Ovozli operatsiya saqlandi!</b> 🌟\n\n📌 <b>Turi:</b> ${typeEmoji}\n💵 <b>Summa:</b> ${formattedAmt} so'm\n📂 <b>Kategoriya:</b> ${parsed.category}\n📝 <b>Izoh:</b> ${parsed.note || "Ovozli xabar"}`;

                const inlineKeyboard = {
                  inline_keyboard: [
                    [
                      { text: "❌ Operatsiyani o'chirish", callback_data: `del_${txId}` },
                      { text: "📱 Mini App", web_app: { url: appUrl } },
                      { text: "🌐 Web App", url: appUrl }
                    ]
                  ]
                };

                await sendTelegramMessage(chatId, replyCard, inlineKeyboard);
                return;
              }
            }
          }
        } catch (voiceErr) {
          console.error("Voice processing error:", voiceErr);
        }

        await sendTelegramMessage(chatId, "⚠️ <i>Ovozli xabarni tushunib bo'lmadi. Qaytadan aniqroq gapirib ko'ring.</i>", getMainMenuKeyboard());
        return;
      }

      if (!text) return;

      // 1. /start command
      if (text.startsWith("/start")) {
        const welcomeText = `<b>Assalomu alaykum, ${fromUser?.first_name || 'foydalanuvchi'}!</b> 👋✨\n\n<b>Moliya AI</b> botiga xush kelibsiz! 🚀\n\nPulingizni oson va aqlli boshqaring.\n\n👇 <b>Ilovani ochish uchun quyidagi linklardan foydalaning:</b>`;
        await sendTelegramMessage(chatId, welcomeText, getDualLinkInlineButtons());
        await sendTelegramMessage(chatId, "👇 Kerakli bo'limni tanlang:", getMainMenuKeyboard());
        return;
      }

      // 2. Help command
      if (text.startsWith("/help") || text.includes("Yordam") || text.includes("yordam")) {
        const helpText = `💡 <b>Moliya AI Boti bo'limlari:</b>\n\n• 📝 <b>Matnli xarajat kiritish</b>\n• 🎙 <b>Ovozli xabar yuborish</b>\n• 📱 <b>Ilovani ochish</b>\n• 📊 <b>Balans va hisobotlar</b>\n• ❌ <b>Operatsiyalarni o'chirish</b>\n\n⭐ <i>1 kunlik bepul sinov va oylik 5 ta AI so'rov limiti mavjud.</i>`;
        await sendTelegramMessage(chatId, helpText, getMainMenuKeyboard());
        return;
      }

      // 3. Balance
      if (text.includes("Balans") || text.includes("balans") || text.startsWith("/balance") || text.includes("Statistika")) {
        const txs = tgUserTransactions.get(chatId) || [];
        const totalIncome = txs.filter(t => t.type === 'income').reduce((acc, t) => acc + t.amount, 0);
        const totalExpense = txs.filter(t => t.type === 'expense').reduce((acc, t) => acc + Math.abs(t.amount), 0);
        const netBalance = totalIncome - totalExpense;

        const fmt = (n: number) => n.toLocaleString('en-US').replace(/,/g, ' ');

        let lastTxsText = "<i>Hozircha tranzaksiyalar yo'q.</i>";
        if (txs.length > 0) {
          lastTxsText = txs.slice(-3).reverse().map((t, idx) => {
            const icon = t.type === 'income' ? '🟢' : '🔻';
            return `${idx + 1}. ${icon} <b>${t.category}</b> — ${fmt(t.amount)} so'm <i>(${t.name})</i>`;
          }).join('\n');
        }

        const balText = `📊 <b>Moliyaviy Hisobotingiz:</b> ✨\n\n🟢 <b>Jami Daromad:</b> ${fmt(totalIncome)} so'm\n🔻 <b>Jami Xarajat:</b> ${fmt(totalExpense)} so'm\n💰 <b>Sof Qoldiq:</b> ${fmt(netBalance)} so'm\n\n📋 <b>Oxirgi 3 ta operatsiya:</b>\n${lastTxsText}`;
        await sendTelegramMessage(chatId, balText, getMainMenuKeyboard());
        return;
      }

      // 4. Delete
      if (text.includes("o'chirish") || text.includes("очириш") || text.startsWith("/delete")) {
        const txs = tgUserTransactions.get(chatId) || [];
        if (txs.length === 0) {
          await sendTelegramMessage(chatId, "ℹ️ <i>O'chirish uchun tranzaksiyalar mavjud emas.</i>", getMainMenuKeyboard());
          return;
        }
        const lastTx = txs.pop();
        tgUserTransactions.set(chatId, txs);
        const fmt = (n: number) => n.toLocaleString('en-US').replace(/,/g, ' ');
        await sendTelegramMessage(chatId, `🗑 <b>Oxirgi operatsiya o'chirildi!</b> ✅\n\n❌ <b>O'chirildi:</b> ${fmt(lastTx?.amount || 0)} so'm (${lastTx?.category} - ${lastTx?.name})`, getMainMenuKeyboard());
        return;
      }

      // 5. Parse text expense
      const limitInfo = checkAndIncrementAiLimit(chatId);
      if (!limitInfo.allowed) {
        const limitMsg = `⚠️ <b>Oylik Bepul AI Limiti Tugadi! (5/5 ishlatildi)</b>\n\nSiz oylik bepul 5 ta AI so'rov imkoniyatizdan foydalandingiz.\nCheksiz AI so'rovlari uchun <b>Premium</b> tarifiga o'ting! ⭐`;
        await sendTelegramMessage(chatId, limitMsg, getDualLinkInlineButtons());
        return;
      }

      let parsed: { type: string; amount: number; category: string; note: string } | null = null;
      if (process.env.GEMINI_API_KEY) {
        try {
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
          const promptText = `
You are a financial parsing assistant for an Uzbek Telegram Bot.
Parse input: "${text.replace(/[\r\n\t]/g, ' ').slice(0, 300)}"
Return JSON object:
- type: 'expense' | 'income'
- amount: number
- category: string
- note: string
`;
          const response = await ai.models.generateContent({
            model: "gemini-3.1-flash-lite",
            contents: promptText,
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING },
                  amount: { type: Type.NUMBER },
                  category: { type: Type.STRING },
                  note: { type: Type.STRING },
                },
                required: ["type", "amount", "category", "note"],
              }
            }
          });
          parsed = JSON.parse(response.text || '{}');
        } catch (aiErr) {
          console.error('Gemini error in bot:', aiErr);
        }
      }

      if (!parsed || !parsed.amount) {
        const lower = text.toLowerCase();
        let amount = 0;
        const numMatch = lower.match(/(\d+(?:[\.,]\d+)?)\s*(?:ming|k|mln|million)?/i);
        if (numMatch) {
          let val = parseFloat(numMatch[1].replace(',', '.'));
          if (lower.includes('mln') || lower.includes('million')) val *= 1000000;
          else if (lower.includes('ming') || lower.includes('k') || val < 1000) val *= 1000;
          amount = Math.round(val);
        }
        let type = lower.includes('maosh') || lower.includes('tushdi') ? 'income' : 'expense';
        let category = lower.includes('taksi') ? 'Transport' : lower.includes('ovqat') ? 'Oziq-ovqat' : 'Boshqa';
        if (amount > 0) parsed = { type, amount, category, note: text };
      }

      if (parsed && parsed.amount && parsed.amount > 0) {
        const txId = 'tx_' + Date.now();
        const txItem = {
          id: txId,
          type: parsed.type,
          name: parsed.note || text,
          category: parsed.category || 'Boshqa',
          amount: parsed.amount,
          date: new Date().toISOString()
        };

        const userList = tgUserTransactions.get(chatId) || [];
        userList.push(txItem);
        tgUserTransactions.set(chatId, userList);

        const typeEmoji = parsed.type === 'income' ? '🟢 Daromad' : '🛒 Xarajat';
        const formattedAmt = parsed.amount.toLocaleString('en-US').replace(/,/g, ' ');

        const replyCard = `✅ <b>Operatsiya saqlandi!</b> 🌟\n\n📌 <b>Turi:</b> ${typeEmoji}\n💵 <b>Summa:</b> ${formattedAmt} so'm\n📂 <b>Kategoriya:</b> ${parsed.category}\n📝 <b>Izoh:</b> ${parsed.note || text}`;

        const inlineKeyboard = {
          inline_keyboard: [
            [
              { text: "❌ Operatsiyani o'chirish", callback_data: `del_${txId}` },
              { text: "📱 Mini App", web_app: { url: appUrl } },
              { text: "🌐 Web App", url: appUrl }
            ]
          ]
        };

        await sendTelegramMessage(chatId, replyCard, inlineKeyboard);
        return;
      }

      await sendTelegramMessage(chatId, `👍 Xabaringiz qabul qilindi.`, getMainMenuKeyboard());
    }
  } catch (err) {
    console.error('Error processing Telegram webhook:', err);
  }
}
