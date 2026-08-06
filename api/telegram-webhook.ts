import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from "@google/genai";
import crypto from "crypto";
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from './_firebaseClient.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8955141731:AAGzuBXoKmZii5t_bJcwbJA0Q92gYrFaGnw";
const appUrl = process.env.APP_URL || "https://moliya-ai-pi.vercel.app";

// Helper: Create 60-day Session Token & Mark Login Request VERIFIED in Firestore
async function verifyAndMarkLoginRequest(requestId: string, fromUser: any, phone?: string) {
  try {
    console.log('[BOT] verifyAndMarkLoginRequest called with requestId:', requestId, 'user:', fromUser?.id);
    const tgId = String(fromUser.id);
    const userId = `moliya_user_tg_${tgId}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 24 * 3600 * 1000).toISOString();

    const sessionToken = 'sess_' + crypto.randomBytes(32).toString('hex');
    const sessionData = {
      sessionToken,
      userId,
      createdAt: now.toISOString(),
      expiresAt,
    };

    // 1. Create session doc in permitted moliya_user_ path
    console.log('[BOT] Creating session document...');
    await setDoc(doc(db, 'users', `moliya_user_sess_${sessionToken}`), sessionData);
    console.log('[BOT] Session created successfully');

    // 2. Update user profile in Firestore
    const tgName = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ') || 'Telegram Foydalanuvchi';
    const tgUsername = fromUser.username ? '@' + fromUser.username : '@moliya_user';

    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);
    const existingData = userSnap.exists() ? userSnap.data() : {};
    const existingPhone = phone || existingData?.phone || existingData?.onboarding?.phone || '';

    const updatedOnboarding = {
      ...(existingData?.onboarding || {}),
      completed: true,
      language: existingData?.onboarding?.language || 'uz',
      name: tgName,
      phone: existingPhone,
      telegram: tgUsername,
      telegramId: tgId,
    };

    console.log('[BOT] Updating user profile in Firestore...');
    await setDoc(userRef, {
      userId,
      telegramId: tgId,
      name: tgName,
      telegram: tgUsername,
      phone: existingPhone,
      onboarding: updatedOnboarding,
      updatedAt: now.toISOString(),
    }, { merge: true });
    console.log('[BOT] User profile updated');

    // 3. Mark login request VERIFIED in Firestore under clean and raw keys for safety
    const cleanId = requestId.replace(/^req_/, '').trim();
    console.log('[BOT] Marking login request VERIFIED. cleanId:', cleanId, 'rawId:', requestId);
    await setDoc(doc(db, 'users', `moliya_user_req_${cleanId}`), {
      requestId: cleanId,
      status: 'VERIFIED',
      userId,
      sessionToken,
      verifiedAt: now.toISOString(),
    }, { merge: true });

    if (cleanId !== requestId) {
      await setDoc(doc(db, 'users', `moliya_user_req_${requestId}`), {
        requestId,
        status: 'VERIFIED',
        userId,
        sessionToken,
        verifiedAt: now.toISOString(),
      }, { merge: true });
    }

    console.log('[BOT] ✅ Login request verified and session created for user:', userId);
    return { sessionToken, userId, onboarding: updatedOnboarding };
  } catch (err) {
    console.error('[BOT] ❌ Error verifying login request:', err);
    return null;
  }
}

// Firestore Transaction Helpers for Bot-WebApp Sync
async function saveBotTransaction(fromUser: any, txItem: { id: string; type: string; name: string; category: string; amount: number; date: string }) {
  try {
    const tgId = String(fromUser.id);
    const userId = `moliya_user_tg_${tgId}`;
    const txRef = doc(db, 'users', userId, 'transactions', txItem.id);
    await setDoc(txRef, {
      type: txItem.type,
      amount: txItem.amount,
      note: txItem.name,
      category: txItem.category,
      date: txItem.date
    }, { merge: true });
    console.log(`[BOT] Saved transaction ${txItem.id} to Firestore for user ${userId}`);
  } catch (err) {
    console.error('[BOT] Error saving transaction to Firestore:', err);
  }
}

async function getBotTransactions(fromUser: any) {
  try {
    const tgId = String(fromUser.id);
    const userId = `moliya_user_tg_${tgId}`;
    const txRef = collection(db, 'users', userId, 'transactions');
    const q = query(txRef, orderBy('date', 'desc'), limit(100));
    const snap = await getDocs(q);
    const txs: any[] = [];
    snap.forEach((d) => txs.push({ id: d.id, ...d.data() }));
    return txs;
  } catch (err) {
    console.error('[BOT] Error fetching transactions from Firestore:', err);
    return [];
  }
}

async function deleteLastBotTransaction(fromUser: any) {
  try {
    const tgId = String(fromUser.id);
    const userId = `moliya_user_tg_${tgId}`;
    const txRef = collection(db, 'users', userId, 'transactions');
    const q = query(txRef, orderBy('date', 'desc'), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const docToDelete = snap.docs[0];
      const data = docToDelete.data();
      await deleteDoc(docToDelete.ref);
      return { id: docToDelete.id, amount: data.amount || 0, category: data.category || 'Boshqa', name: data.note || data.name || 'Operatsiya' };
    }
    return null;
  } catch (err) {
    console.error('[BOT] Error deleting transaction from Firestore:', err);
    return null;
  }
}

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

const getCleanInlineKeyboard = (requestId?: string) => {
  const webUrl = requestId ? `${appUrl}/?req=${requestId}` : appUrl;
  return {
    inline_keyboard: [
      [
        { text: "📱 Telegram Mini App", web_app: { url: appUrl } },
        { text: "🌐 Web App-ga o'tish", url: webUrl }
      ]
    ]
  };
};

const renderProgressBar = (ratio: number, length: number = 8) => {
  const filled = Math.min(length, Math.max(0, Math.round(ratio * length)));
  const empty = length - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
};

async function getUserBudgets(fromUser: any) {
  try {
    const tgId = String(fromUser?.id);
    if (!tgId) return {};
    const userId = `moliya_user_tg_${tgId}`;
    const userSnap = await getDoc(doc(db, 'users', userId));
    if (userSnap.exists()) {
      return userSnap.data()?.budgets || {};
    }
  } catch (e) {
    console.error('Error fetching user budgets:', e);
  }
  return {};
}

async function setUserBudget(fromUser: any, category: string, limitAmt: number) {
  try {
    const tgId = String(fromUser?.id);
    if (!tgId) return null;
    const userId = `moliya_user_tg_${tgId}`;
    const existing = await getUserBudgets(fromUser);
    const updated = { ...existing, [category]: limitAmt };
    await setDoc(doc(db, 'users', userId), { budgets: updated }, { merge: true });
    return updated;
  } catch (e) {
    console.error('Error setting user budget:', e);
    return null;
  }
}

async function sendTelegramDocument(chatId: number | string, fileBuffer: Buffer, fileName: string, caption?: string) {
  try {
    const formData = new FormData();
    formData.append('chat_id', String(chatId));
    formData.append('document', new Blob([fileBuffer], { type: 'text/csv' }), fileName);
    if (caption) formData.append('caption', caption);
    formData.append('parse_mode', 'HTML');

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
      method: 'POST',
      body: formData
    });
  } catch (err) {
    console.error('Failed to send Telegram document:', err);
  }
}

const getMainMenuKeyboard = () => {
  return {
    keyboard: [
      [{ text: "📱 Telegram Mini App", web_app: { url: appUrl } }, { text: "🌐 Web App", url: appUrl }],
      [{ text: "📊 Balans va Hisobot" }, { text: "📈 Kategoriyalar va Byudjet" }],
      [{ text: "📥 Eksport (Excel/CSV)" }, { text: "⏰ Eslatmalar" }],
      [{ text: "❌ Oxirgi operatsiyani o'chirish" }, { text: "💡 Yordam" }]
    ],
    resize_keyboard: true
  };
};

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

async function editTelegramMessage(chatId: number | string, messageId: number, text: string, replyMarkup?: any) {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup
      })
    });
  } catch (err) {
    console.error('Failed to edit Telegram message:', err);
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

async function buildPeriodReport(fromUser: any, period: 'today' | 'week' | 'month' | 'last_month' = 'month') {
  const txs = await getBotTransactions(fromUser);
  const budgets = await getUserBudgets(fromUser);

  const now = new Date();
  let periodTitle = "Shu oy";
  let filteredTxs: any[] = [];

  if (period === 'today') {
    periodTitle = "Bugun";
    filteredTxs = txs.filter(t => {
      const d = new Date(t.date || 0);
      return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
  } else if (period === 'week') {
    periodTitle = "Shu hafta";
    const startOfWeek = new Date(now);
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    startOfWeek.setDate(diff);
    startOfWeek.setHours(0, 0, 0, 0);
    filteredTxs = txs.filter(t => new Date(t.date || 0) >= startOfWeek);
  } else if (period === 'last_month') {
    periodTitle = "O'tgan oy";
    const lmDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    filteredTxs = txs.filter(t => {
      const d = new Date(t.date || 0);
      return d.getMonth() === lmDate.getMonth() && d.getFullYear() === lmDate.getFullYear();
    });
  } else {
    periodTitle = "Shu oy";
    filteredTxs = txs.filter(t => {
      const d = new Date(t.date || 0);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
  }

  const totalExpense = filteredTxs.filter(t => t.type === 'expense').reduce((acc, t) => acc + Math.abs(Number(t.amount) || 0), 0);
  const totalIncome = filteredTxs.filter(t => t.type === 'income').reduce((acc, t) => acc + Number(t.amount) || 0, 0);

  const catMap: Record<string, number> = {};
  filteredTxs.filter(t => t.type === 'expense').forEach(t => {
    const cat = t.category || 'Boshqa';
    catMap[cat] = (catMap[cat] || 0) + Math.abs(Number(t.amount) || 0);
  });

  const fmt = (n: number) => n.toLocaleString('en-US').replace(/,/g, ' ');

  let catReportText = "";
  const catEntries = Object.entries(catMap).sort((a, b) => b[1] - a[1]);

  if (catEntries.length === 0) {
    catReportText = `<i>${periodTitle}da hali xarajatlar mavjud emas.</i>`;
  } else {
    catReportText = catEntries.map(([cat, amt]) => {
      const percent = totalExpense > 0 ? Math.round((amt / totalExpense) * 100) : 0;
      const bar = renderProgressBar(percent / 100, 8);
      const budgetLimit = budgets[cat];
      let budgetNotice = "";
      if (period === 'month' && budgetLimit && budgetLimit > 0) {
        const bPercent = Math.round((amt / budgetLimit) * 100);
        const bEmoji = bPercent >= 100 ? '🚨' : bPercent >= 80 ? '⚠️' : '🎯';
        budgetNotice = `\n   ${bEmoji} <i>Limit: ${fmt(budgetLimit)} so'm (${bPercent}%)</i>`;
      }
      return `📂 <b>${cat}</b>: ${fmt(amt)} so'm (${percent}%)\n   <code>[${bar}]</code>${budgetNotice}`;
    }).join('\n\n');
  }

  const text = `📈 <b>Tahlil va Statistika (${periodTitle})</b> 📊\n\n` +
    `🟢 <b>Daromad:</b> ${fmt(totalIncome)} so'm\n` +
    `🔻 <b>Xarajat:</b> ${fmt(totalExpense)} so'm\n` +
    `💰 <b>Sof qoldiq:</b> ${fmt(totalIncome - totalExpense)} so'm\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `<b>Kategoriyalar bo'yicha ajratish:</b>\n\n` +
    `${catReportText}\n\n` +
    `💡 <i>Vaqt oralig'ini tanlang:</i>`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: period === 'today' ? "✅ Bugun" : "📅 Bugun", callback_data: "period_today" },
        { text: period === 'week' ? "✅ Shu hafta" : "🗓 Shu hafta", callback_data: "period_week" }
      ],
      [
        { text: period === 'month' ? "✅ Shu oy" : "📊 Shu oy", callback_data: "period_month" },
        { text: period === 'last_month' ? "✅ O'tgan oy" : "📆 O'tgan oy", callback_data: "period_last_month" }
      ]
    ]
  };

  return { text, inlineKeyboard };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(200).send('Telegram Webhook Active');
  }

  try {
    const update = req.body;
    if (!update) return res.status(200).json({ status: 'ok' });

    // A) Callback Query
    if (update.callback_query) {
      const cb = update.callback_query;
      const chatId = cb.message?.chat?.id;
      const data = cb.data;

      if (chatId && data && data.startsWith('del_')) {
        const txId = data.replace('del_', '');
        const tgId = String(cb.from?.id || chatId);
        try {
          await deleteDoc(doc(db, 'users', `moliya_user_tg_${tgId}`, 'transactions', txId));
        } catch (e) {
          console.error('[BOT] Error deleting callback tx:', e);
        }

        await answerCallbackQuery(cb.id, "🗑 Operatsiya o'chirildi!");
        await sendTelegramMessage(chatId, "🗑 <b>Operatsiya muvaffaqiyatli o'chirildi!</b> ✅", getMainMenuKeyboard());
      } else if (chatId && data && data.startsWith('period_')) {
        const periodKey = data.replace('period_', '') as 'today' | 'week' | 'month' | 'last_month';
        const report = await buildPeriodReport(cb.from, periodKey);
        await answerCallbackQuery(cb.id, "📊 Tahlil yangilandi");
        if (cb.message?.message_id) {
          await editTelegramMessage(chatId, cb.message.message_id, report.text, report.inlineKeyboard);
        } else {
          await sendTelegramMessage(chatId, report.text, report.inlineKeyboard);
        }
      }
      return res.status(200).json({ status: 'ok' });
    }

    // B) Text or Voice Message
    if (update.message) {
      const message = update.message;
      const chatId = message.chat?.id;
      const text = message.text;
      const voice = message.voice || message.audio;
      const fromUser = message.from;

      if (!chatId) return res.status(200).json({ status: 'ok' });

      // Handle Contact (phone number shared)
      if (message.contact) {
        const phone = message.contact.phone_number;
        if (phone) {
          try {
            const tgId = String(fromUser.id);
            const userId = `tg_user_${tgId}`;
            
            // Save phone to Firestore
            await setDoc(doc(db, 'users', userId), {
              phone,
              updatedAt: new Date().toISOString()
            }, { merge: true });

            // Check if there is a pending login request for this chat
            const pendingRef = doc(db, 'login_requests', `pending_${chatId}`);
            const pendingSnap = await getDoc(pendingRef);
            if (pendingSnap.exists()) {
              const pendingData = pendingSnap.data();
              if (pendingData?.requestId) {
                await verifyAndMarkLoginRequest(pendingData.requestId, fromUser, phone);
                await deleteDoc(pendingRef);
              }
            }

            const successText = `✅ <b>Telefon raqamingiz saqlandi va hisobingiz tasdiqlandi!</b> 🎉\n\n📞 <b>Raqam:</b> ${phone}\n\n👇 Brauzeringizga qaytib ilovadan foydalanishingiz mumkin:`;
            await sendTelegramMessage(chatId, successText, getCleanInlineKeyboard());
            await sendTelegramMessage(chatId, "👇 Kerakli bo'limni tanlang:", getMainMenuKeyboard());
          } catch (contactErr) {
            console.error('Error handling contact share:', contactErr);
          }
        }
        return res.status(200).json({ status: 'ok' });
      }

      // Handle Photo (Receipt OCR)
      const photo = message.photo;
      if (photo && Array.isArray(photo) && photo.length > 0) {
        const limitInfo = checkAndIncrementAiLimit(chatId);
        if (!limitInfo.allowed) {
          const limitMsg = `⚠️ <b>Oylik Bepul AI Limiti Tugadi! (5/5 ishlatildi)</b>\n\nSiz oylik bepul 5 ta AI so'rov imkoniyatizdan foydalandingiz.\nCheksiz AI tahlili uchun <b>Premium</b> tarifiga o'ting! ⭐`;
          await sendTelegramMessage(chatId, limitMsg, getCleanInlineKeyboard());
          return res.status(200).json({ status: 'ok' });
        }

        try {
          await sendTelegramMessage(chatId, "🧾 <i>Chek rasmi tahlil qilinmoqda (AI Vision)...</i>");
          const largestPhoto = photo[photo.length - 1];
          const fileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${largestPhoto.file_id}`);
          const fileData = await fileRes.json();
          if (fileData.ok && fileData.result?.file_path) {
            const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileData.result.file_path}`;
            const imgBufRes = await fetch(downloadUrl);
            const imgArrayBuffer = await imgBufRes.arrayBuffer();
            const base64Img = Buffer.from(imgArrayBuffer).toString('base64');

            if (process.env.GEMINI_API_KEY) {
              const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
              const promptText = `Analyze this Uzbek/Russian store receipt image (Korzinka, Makro, Havas, etc.) and extract JSON:
- amount: total paid amount in UZS (number)
- store: merchant/store name (string)
- category: ('Oziq-ovqat', 'Transport', 'Kiyim', 'Kommunal', 'Sog\'liq', 'Ta\'lim', 'Boshqa')
- note: main items purchased summary (string)`;

              const response = await ai.models.generateContent({
                model: "gemini-3.1-flash-lite",
                contents: [
                  {
                    inlineData: {
                      mimeType: "image/jpeg",
                      data: base64Img
                    }
                  },
                  promptText
                ],
                config: {
                  responseMimeType: "application/json",
                  responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                      amount: { type: Type.NUMBER },
                      store: { type: Type.STRING },
                      category: { type: Type.STRING },
                      note: { type: Type.STRING },
                    },
                    required: ["amount", "store", "category", "note"],
                  }
                }
              });

              const parsed = JSON.parse(response.text || '{}');
              if (parsed && parsed.amount && parsed.amount > 0) {
                const txId = 'tx_' + Date.now();
                const txItem = {
                  id: txId,
                  type: 'expense',
                  name: `${parsed.store || "Chek"} - ${parsed.note || "Rasmli operatsiya"}`,
                  category: parsed.category || 'Oziq-ovqat',
                  amount: Math.abs(parsed.amount),
                  date: new Date().toISOString()
                };

                await saveBotTransaction(fromUser, txItem);
                const formattedAmt = Math.abs(parsed.amount).toLocaleString('en-US').replace(/,/g, ' ');

                const replyCard = `🧾 <b>Chek tahlil qilindi va saqlandi!</b> 🌟\n\n` +
                  `🏪 <b>Do'kon:</b> ${parsed.store || "Noma'lum"}\n` +
                  `💵 <b>Jami summa:</b> ${formattedAmt} so'm\n` +
                  `📂 <b>Kategoriya:</b> ${parsed.category || 'Oziq-ovqat'}\n` +
                  `📝 <b>Tafsilot:</b> ${parsed.note || "Chek xaridi"}`;

                const inlineKeyboard = {
                  inline_keyboard: [
                    [
                      { text: "❌ Operatsiyani o'chirish", callback_data: `del_${txId}` },
                      { text: "📱 Mini App", web_app: { url: appUrl } }
                    ]
                  ]
                };

                await sendTelegramMessage(chatId, replyCard, inlineKeyboard);
                return res.status(200).json({ status: 'ok' });
              }
            }
          }
        } catch (photoErr) {
          console.error("Photo processing error:", photoErr);
        }

        await sendTelegramMessage(chatId, "⚠️ <i>Chek rasmidagi summani o'qib bo'lmadi. Iltimos rasmni tiniqroq tushirib qayta yuboring.</i>", getMainMenuKeyboard());
        return res.status(200).json({ status: 'ok' });
      }

      // Handle Voice Note
      if (voice && voice.file_id) {
        const limitInfo = checkAndIncrementAiLimit(chatId);
        if (!limitInfo.allowed) {
          const limitMsg = `⚠️ <b>Oylik Bepul AI Limiti Tugadi! (5/5 ishlatildi)</b>\n\nSiz oylik bepul 5 ta AI so'rov imkoniyatizdan foydalandingiz.\nCheksiz AI va ovozli tahlil uchun <b>Premium</b> tarifiga o'ting! ⭐`;
          await sendTelegramMessage(chatId, limitMsg, getCleanInlineKeyboard());
          return res.status(200).json({ status: 'ok' });
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

                const userList = await getBotTransactions(fromUser);
                await saveBotTransaction(fromUser, txItem);

                const typeEmoji = parsed.type === 'income' ? '🟢 Daromad' : '🛒 Xarajat';
                const formattedAmt = parsed.amount.toLocaleString('en-US').replace(/,/g, ' ');

                const replyCard = `🎙 <b>Ovozli operatsiya saqlandi!</b> 🌟\n\n📌 <b>Turi:</b> ${typeEmoji}\n💵 <b>Summa:</b> ${formattedAmt} so'm\n📂 <b>Kategoriya:</b> ${parsed.category}\n📝 <b>Izoh:</b> ${parsed.note || "Ovozli xabar"}`;

                const inlineKeyboard = {
                  inline_keyboard: [
                    [
                      { text: "❌ Operatsiyani o'chirish", callback_data: `del_${txId}` },
                      { text: "📱 Moliya AI", url: appUrl }
                    ]
                  ]
                };

                await sendTelegramMessage(chatId, replyCard, inlineKeyboard);
                return res.status(200).json({ status: 'ok' });
              }
            }
          }
        } catch (voiceErr) {
          console.error("Voice processing error:", voiceErr);
        }

        await sendTelegramMessage(chatId, "⚠️ <i>Ovozli xabarni tushunib bo'lmadi. Qaytadan aniqroq gapirib ko'ring.</i>", getMainMenuKeyboard());
        return res.status(200).json({ status: 'ok' });
      }

      if (!text) return res.status(200).json({ status: 'ok' });

      // 1. /start command (Handles Login Request UUID e.g. /start req_UUID or standard /start)
      if (text.startsWith("/start")) {
        const rawArg = text.replace('/start', '').trim();
        const requestId = rawArg.replace('req_', '').trim();
        console.log('[BOT] /start received. rawArg:', rawArg, 'requestId:', requestId, 'from user:', fromUser?.id);

        if (requestId && requestId.length >= 8) {
          // Immediately verify & mark login request in Firestore (no blocking phone requirement)
          console.log('[BOT] Processing login request verification...');
          const result = await verifyAndMarkLoginRequest(requestId, fromUser);
          
          if (!result) {
            console.error('[BOT] ❌ verifyAndMarkLoginRequest returned null — sending error to user');
            await sendTelegramMessage(chatId, "⚠️ Tasdiqlashda xatolik yuz berdi. Qaytadan urinib ko'ring.", getCleanInlineKeyboard());
            return res.status(200).json({ status: 'ok' });
          }

          console.log('[BOT] ✅ Verification successful, sending success message');
          const successText = `<b>Assalomu alaykum, ${fromUser?.first_name || 'foydalanuvchi'}!</b> 👋✨\n\n✅ <b>Muvaffaqiyatli tasdiqlandi!</b> 🚀\nBrauzeringizdagi Moliya AI ilovasiga avtomatik kirdingiz.\n\n👇 <i>Ilovaga o'tish uchun quyidagi tugmani bosing:</i>`;
          await sendTelegramMessage(chatId, successText, getCleanInlineKeyboard(requestId));
          await sendTelegramMessage(chatId, "👇 Kerakli bo'limni tanlang:", getMainMenuKeyboard());
          return res.status(200).json({ status: 'ok' });
        }

        // Standard /start without request parameter
        console.log('[BOT] Standard /start (no login request)');
        const welcomeText = `<b>Assalomu alaykum, ${fromUser?.first_name || 'foydalanuvchi'}!</b> 👋✨\n\n<b>Moliya AI</b> botiga xush kelibsiz! 🚀\n\nPulingizni oson va aqlli boshqaring.\n\n👇 <b>Ilovani ochish uchun quyidagi tugmani bosing:</b>`;
        await sendTelegramMessage(chatId, welcomeText, getCleanInlineKeyboard());
        await sendTelegramMessage(chatId, "👇 Kerakli bo'limni tanlang:", getMainMenuKeyboard());
        return res.status(200).json({ status: 'ok' });
      }

      // 2. Help command
      if (text.startsWith("/help") || text.includes("Yordam") || text.includes("yordam")) {
        const helpText = `💡 <b>Moliya AI Boti bo'limlari:</b>\n\n• 📝 <b>Matnli xarajat kiritish</b>\n• 🎙 <b>Ovozli xabar yuborish</b>\n• 📱 <b>Ilovani ochish</b>\n• 📊 <b>Balans va hisobotlar</b>\n• ❌ <b>Operatsiyalarni o'chirish</b>\n\n⭐ <i>1 kunlik bepul sinov va oylik 5 ta AI so'rov limiti mavjud.</i>`;
        await sendTelegramMessage(chatId, helpText, getMainMenuKeyboard());
        return res.status(200).json({ status: 'ok' });
      }

      // 3. Balance, Stats, and Category Breakdown (/balance, /stats, /budget)
      if (text.includes("Balans") || text.includes("balans") || text.startsWith("/balance") || text.includes("Statistika") || text.startsWith("/stats") || text.includes("Kategoriyalar") || text.includes("Byudjet") || text.startsWith("/budget") || text.startsWith("/byudjet")) {
        const budgetMatch = text.match(/\/(?:budget|byudjet)\s+(.+?)\s+(\d+[\d\s]*)/i);
        if (budgetMatch) {
          const categoryRaw = budgetMatch[1].trim();
          const limitVal = parseInt(budgetMatch[2].replace(/\s+/g, ''), 10);
          if (limitVal > 0) {
            await setUserBudget(fromUser, categoryRaw, limitVal);
            const fmtLimit = limitVal.toLocaleString('en-US').replace(/,/g, ' ');
            const msg = `✅ <b>Byudjet limiti o'rnatildi!</b> 🎯\n\n📂 <b>Kategoriya:</b> ${categoryRaw}\n🎯 <b>Oylik limit:</b> ${fmtLimit} so'm`;
            await sendTelegramMessage(chatId, msg, getMainMenuKeyboard());
            return res.status(200).json({ status: 'ok' });
          }
        }

        const report = await buildPeriodReport(fromUser, 'month');
        await sendTelegramMessage(chatId, report.text, report.inlineKeyboard);
        return res.status(200).json({ status: 'ok' });
      }

      // 5. Delete
      if (text.includes("o'chirish") || text.includes("очириш") || text.startsWith("/delete")) {
        const deletedTx = await deleteLastBotTransaction(fromUser);
        if (!deletedTx) {
          await sendTelegramMessage(chatId, "ℹ️ <i>O'chirish uchun tranzaksiyalar mavjud emas.</i>", getMainMenuKeyboard());
          return res.status(200).json({ status: 'ok' });
        }
        const fmt = (n: number) => n.toLocaleString('en-US').replace(/,/g, ' ');
        await sendTelegramMessage(chatId, `🗑 <b>Oxirgi operatsiya o'chirildi!</b> ✅\n\n❌ <b>O'chirildi:</b> ${fmt(deletedTx.amount)} so'm (${deletedTx.category} - ${deletedTx.name})`, getMainMenuKeyboard());
        return res.status(200).json({ status: 'ok' });
      }

      // 6. CSV Export (/export, "Eksport")
      if (text.startsWith("/export") || text.includes("Eksport") || text.includes("eksport") || text.includes("Excel")) {
        const txs = await getBotTransactions(fromUser);
        if (txs.length === 0) {
          await sendTelegramMessage(chatId, "ℹ️ <i>Eksport qilish uchun tranzaksiyalar mavjud emas.</i>", getMainMenuKeyboard());
          return res.status(200).json({ status: 'ok' });
        }

        const csvHeader = "ID,Sana,Turi,Kategoriya,Summa (so'm),Izoh\n";
        const csvRows = txs.map(t => {
          const dateStr = t.date ? new Date(t.date).toLocaleString('uz-UZ') : '';
          const typeStr = t.type === 'income' ? 'Daromad' : 'Xarajat';
          const catStr = `"${(t.category || 'Boshqa').replace(/"/g, '""')}"`;
          const amtStr = t.amount || 0;
          const noteStr = `"${(t.note || t.name || '').replace(/"/g, '""')}"`;
          return `${t.id},${dateStr},${typeStr},${catStr},${amtStr},${noteStr}`;
        }).join('\n');

        const csvContent = csvHeader + csvRows;
        const fileBuffer = Buffer.from(csvContent, 'utf-8');
        const fileName = `Moliya_AI_Hisobot_${Date.now()}.csv`;

        await sendTelegramDocument(chatId, fileBuffer, fileName, "📊 <b>Barcha moliyaviy tranzaksiyalaringiz fayl shaklida tayyorlandi!</b> 📥");
        return res.status(200).json({ status: 'ok' });
      }

      // 7. Reminders (/remind, "Eslatmalar")
      if (text.startsWith("/remind") || text.includes("Eslatma") || text.includes("eslatma") || text.includes("Eslatmalar")) {
        try {
          const tgId = String(fromUser?.id);
          const userId = `moliya_user_tg_${tgId}`;
          await setDoc(doc(db, 'users', userId), { remindersEnabled: true, reminderHour: 20 }, { merge: true });
          const remindMsg = `⏰ <b>Kunlik Eslatmalar Yoqildi!</b> 🔔\n\nHar kuni soat <b>20:00 da</b> bot sizga moliyaviy xarajatlaringizni kiritishni eslatib turadi.\n\n<i>Eslatmani o'chirish uchun botga har qanday vaqtda yangi tranzaksiya yuborishingiz kifoya.</i>`;
          await sendTelegramMessage(chatId, remindMsg, getMainMenuKeyboard());
        } catch (e) {
          console.error('Error enabling reminders:', e);
        }
        return res.status(200).json({ status: 'ok' });
      }

      // 5. Parse text expense
      const limitInfo = checkAndIncrementAiLimit(chatId);
      if (!limitInfo.allowed) {
        const limitMsg = `⚠️ <b>Oylik Bepul AI Limiti Tugadi! (5/5 ishlatildi)</b>\n\nSiz oylik bepul 5 ta AI so'rov imkoniyatizdan foydalandingiz.\nCheksiz AI so'rovlari uchun <b>Premium</b> tarifiga o'ting! ⭐`;
        await sendTelegramMessage(chatId, limitMsg, getCleanInlineKeyboard());
        return res.status(200).json({ status: 'ok' });
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

        await saveBotTransaction(fromUser, txItem);

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
        return res.status(200).json({ status: 'ok' });
      }

      await sendTelegramMessage(chatId, `👍 Xabaringiz qabul qilindi.`, getMainMenuKeyboard());
    }
  } catch (err) {
    console.error('Error processing Telegram webhook:', err);
  }
  return res.status(200).json({ status: 'ok' });
}
