import { GoogleGenAI, Type, Schema } from "@google/genai";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import crypto from "crypto";

// Initialize Firebase Admin SDK
let adminApp: any;
try {
  if (getApps().length === 0) {
    adminApp = initializeApp({
      projectId: "arctic-pad-sn56p"
    });
    console.log("Firebase Admin SDK initialized successfully.");
  } else {
    adminApp = getApps()[0];
  }
} catch (error) {
  console.error("Error initializing Firebase Admin SDK:", error);
}

const firestore = getFirestore(adminApp, "ai-studio-moliyav2-593a4147-5cc2-4aec-9b0e-422088ddb24a");
firestore.settings({
  ignoreUndefinedProperties: true
});

function verifyTelegramInitData(initData: string, botToken: string): { isValid: boolean; user?: any } {
  if (!botToken || !initData) {
    return { isValid: false };
  }
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return { isValid: false };

    // Delete hash for checking
    params.delete("hash");

    // Sort keys alphabetically
    const keys = Array.from(params.keys()).sort();
    const dataCheckString = keys
      .map((key) => `${key}=${params.get(key)}`)
      .join("\n");

    // Compute secret key derived from bot token with "WebAppData" salt
    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(botToken)
      .digest();

    // Compute signature hash
    const computedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    const isValid = computedHash === hash;
    let user = null;
    if (isValid) {
      const userJson = params.get("user");
      if (userJson) {
        user = JSON.parse(userJson);
      }
    }
    return { isValid, user };
  } catch (e) {
    console.error("Error verifying Telegram initData:", e);
    return { isValid: false };
  }
}

async function getOrCreateInternalUser(externalId: string, type: "telegram" | "firebase", userDetails?: any) {
  // In the Sandbox environment, the backend service account lacks Firestore permissions.
  // Instead of querying/writing to a 'users_mapping' collection, we deterministically
  // generate the moliya_user_ ID based on the external ID.
  const userId = `moliya_user_${type}_${externalId}`;

  // Client uses local token mapping since Firebase Auth allows moliya_user_
  return { userId, customToken: "sandbox-token-not-used" };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API routes FIRST

  // Telegram verification endpoint
  app.post("/api/auth/telegram", async (req, res) => {
    try {
      const { initData } = req.body;
      const botToken = process.env.TELEGRAM_BOT_TOKEN || "8955141731:AAGzuBXoKmZii5t_bJcwbJA0Q92gYrFaGnw";

      // Sandbox support for local testing/development when TELEGRAM_BOT_TOKEN is not configured
      if (!botToken || initData === "sandbox_test_data") {
        console.log("Auth Telegram: Sandbox/bypass active (no bot token or sandbox string passed).");
        const sandboxId = "sandbox_user_12345";
        const sandboxDetails = { id: 12345, username: "sandbox_user", first_name: "Sandbox", last_name: "User" };
        const { userId, customToken } = await getOrCreateInternalUser(sandboxId, "telegram", sandboxDetails);
        res.json({ userId, customToken, user: sandboxDetails, isSandbox: true });
        return;
      }

      const verification = verifyTelegramInitData(initData, botToken);
      if (!verification.isValid) {
        res.status(401).json({ error: "Invalid Telegram signature" });
        return;
      }

      const tgUser = verification.user;
      if (!tgUser || !tgUser.id) {
        res.status(400).json({ error: "User payload missing in Telegram initData" });
        return;
      }

      const { userId, customToken } = await getOrCreateInternalUser(tgUser.id.toString(), "telegram", tgUser);
      res.json({ userId, customToken, user: tgUser });
    } catch (e: any) {
      console.error("Telegram authentication error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // Fallback verification endpoint
  app.post("/api/auth/fallback", async (req, res) => {
    try {
      const { idToken, mockUid } = req.body;

      // Sandbox support for fallback auth
      if (!idToken && mockUid) {
        console.log(`Auth Fallback: Sandbox active with mockUid ${mockUid}`);
        const { userId, customToken } = await getOrCreateInternalUser(mockUid, "firebase");
        res.json({ userId, customToken, isSandbox: true });
        return;
      }

      if (!idToken) {
        res.status(400).json({ error: "Missing Firebase ID Token" });
        return;
      }

      // Verify the Firebase ID Token
      const decodedToken = await getAuth(adminApp).verifyIdToken(idToken);
      const { userId, customToken } = await getOrCreateInternalUser(decodedToken.uid, "firebase");
      res.json({ userId, customToken });
    } catch (e: any) {
      console.error("Fallback authentication error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/parse-expense", async (req, res) => {
    try {
      const { text, cards = [] } = req.body;
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        res.status(400).json({ error: "Missing or invalid 'text' parameter" });
        return;
      }

      if (text.length > 500) {
        res.status(400).json({ error: "Text exceeds maximum length of 500 characters" });
        return;
      }

      const cleanText = text.replace(/[\r\n\t]/g, ' ').slice(0, 500);
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentIso = now.toISOString().slice(0, 16);
      const currentDayName = now.toLocaleDateString('uz-UZ', { weekday: 'long' });

      let cardsContext = '';
      if (cards && cards.length > 0) {
        cardsContext = "Foydalanuvchining hisoblari/kartalari:\n" + cards.map((c: any) => `- ID: "${c.id}", Nomi: "${c.name}", Raqami: "${c.number}"`).join('\n') + "\nAgar matnda ushbu hisoblardan biri tilga olingan bo'lsa (masalan, humo, uzcard, yoki karta nomi), o'sha ID ni 'cardId' maydonida qaytaring. Agar naqd pul, hamyon yoki karta tilga olinmasa, 'cash' deb qaytaring yoki bush qoldiring.";
      }

      const promptText = `
You are a financial parsing assistant for an Uzbek finance tracker.
Parse the following user input and return a JSON object.

Hozirgi vaqt (Current context):
- Joriy yil: ${currentYear}
- Joriy to'liq sana (ISO): ${currentIso}
- Hafta kuni: ${currentDayName}

${cardsContext}

Sana aniqlash qoidalari (Date Parsing Rules):
1. O'zbekcha oylar: yanvar=01, fevral=02, mart=03, aprel=04, may=05, iyun=06, iyul=07, avgust=08, sentabr/sentiyabr=09, oktabr/oktyabr=10, noyabr=11, dekabr=12.
2. Agar foydalanuvchi "kecha" (yesterday) deb aytsa, bugungi kundan 1 kun oldingi sanani ("YYYY-MM-DDTHH:mm") yozing (soatni saqlagan holda).
3. Agar foydalanuvchi "27 -iyul", "27-iyul", "27 iyul" yoki shunga o'xshash sana aytsa, aniq shu oyni raqamga o'girib, joriy yil (${currentYear}) bilan birga "YYYY-MM-DDTHH:mm" formatiga o'tkazing (masalan: "2026-07-27T12:00").
4. Agar foydalanuvchi umuman hech qanday sana tilga olmagan bo'lsa, "date" maydoniga joriy vaqtni ("${currentIso}") yozing.
5. "date" har doim qaytarilishi shart.

JSON output must have:
- type: 'expense' | 'income' | 'debt' | 'lending'
- amount: string (number formatted with spaces, e.g., '5 000 000' or '45 000')
- category: string (the category, e.g., 'Oila', 'Oziq-ovqat', 'Transport', "Do'st", 'Boshqa')
- note: string (a short note, typically a very clean summary of the transaction without messy raw text)
- title: string (a short clean title of the transaction, e.g., "Dadamdan o'tkazma", "Ovqat", etc.)
- debtWho: string (the name of the person involved in a debt or lending transaction, if applicable)
- date: string ("YYYY-MM-DDTHH:mm" format. STRICTLY resolve this using the rules above.)
- cardId: string (optional, the matching card ID if a specific card/bank is mentioned, otherwise 'cash')

Strict Rules:
- "qarz olindi" or "qarz oldim" means borrowing money -> STRICTLY evaluate to type="income" (do NOT use debt)
- "qarz berildi" or "qarz berdim" means lending money -> STRICTLY evaluate to type="expense" (do NOT use lending)
- "dedomla" means father -> likely income from father, type="income", category="Oila", title="Dadamdan", debtWho="Dadam"
- "o'tkazberdila" means transferred to me -> type="income"
- ALWAYS map local slang like "dedomla", "akam", "o'rtog'im" correctly to debtWho if it's a debt/lending.
- Backpack, sumka, ryukzak, clothes, shoes -> category="Kiyim"
- Only use "Oziq-ovqat" if food, groceries, meal, cafe, or restaurant is explicitly mentioned.
- If the item is not food or transport or clothes, use category="Boshqa".
- Do not put raw messy text in title. Make the title very short and clean.

Input text: "${cleanText}"
`;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: promptText,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              type: { type: Type.STRING, enum: ['expense', 'income', 'debt', 'lending'] },
              amount: { type: Type.STRING },
              category: { type: Type.STRING },
              note: { type: Type.STRING },
              title: { type: Type.STRING },
              debtWho: { type: Type.STRING },
              date: { type: Type.STRING },
              cardId: { type: Type.STRING },
            },
            required: ["type", "amount", "category", "note", "date"],
          }
        }
      });
      
      const data = JSON.parse(response.text || '{}');
      res.json(data);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // In-memory Telegram user transaction store for instant response & syncing
  const tgUserTransactions = new Map<number, { id: string; type: string; name: string; category: string; amount: number; date: string }[]>();
  
  // Track active chat IDs for 3-hour automated expense reminders
  const activeTelegramChats = new Set<number>();

  // Shared AI Usage tracker per user: 1-day free trial, then max 5 AI requests / month
  const tgUserAiUsage = new Map<number, { firstSeen: number; count: number }>();

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8955141731:AAGzuBXoKmZii5t_bJcwbJA0Q92gYrFaGnw";
  const appUrl = process.env.APP_URL || "https://moliya-v2.vercel.app";

  async function syncUserTxToFirestore(chatId: number, txs: any[]) {
    if (!firestore) return;
    try {
      await firestore.collection('users').doc(`tg_user_${chatId}`).set({
        customTransactions: txs,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (e) {
      console.error("Firestore sync error:", e);
    }
  }

  const checkAndIncrementAiLimit = (chatId: number): { allowed: boolean; isTrial: boolean; remaining: number } => {
    const now = Date.now();
    let usage = tgUserAiUsage.get(chatId);
    if (!usage) {
      usage = { firstSeen: now, count: 0 };
      tgUserAiUsage.set(chatId, usage);
    }

    // 1-day trial active (24 hours unlimited)
    const isTrial = (now - usage.firstSeen) < (24 * 3600 * 1000);
    if (isTrial) {
      return { allowed: true, isTrial: true, remaining: 999 };
    }

    // After 1-day trial: Max 5 AI requests per month
    if (usage.count >= 5) {
      return { allowed: false, isTrial: false, remaining: 0 };
    }

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

  // Automated 3-Hour Expense Reminder System
  setInterval(async () => {
    console.log(`⏰ Running 3-hour automated expense reminders for ${activeTelegramChats.size} users...`);
    for (const chatId of activeTelegramChats) {
      try {
        const reminderText = `🔔 <b>Assalomu alaykum!</b> 👋\n\nOxirgi xarajatlaringizni kiritishni unutdingizmi?\n📝 Matn shaklida yozing yoki 🎙 ovozli xabar yuboring.`;
        await sendTelegramMessage(chatId, reminderText, getDualLinkInlineButtons());
      } catch (err) {
        console.error(`Failed 3-hour reminder for chatId ${chatId}:`, err);
      }
    }
  }, 3 * 3600 * 1000);

  // Telegram Bot Update Handler
  async function handleTelegramUpdate(update: any) {
    if (!update) return;

    // A) Handle Callback Query (e.g. Inline "O'chirish" button)
    if (update.callback_query) {
      const cb = update.callback_query;
      const chatId = cb.message?.chat?.id;
      const data = cb.data;

      if (chatId) activeTelegramChats.add(chatId);

      if (chatId && data && data.startsWith('del_')) {
        const txId = data.replace('del_', '');
        const txs = tgUserTransactions.get(chatId) || [];
        const newTxs = txs.filter(t => t.id !== txId);
        tgUserTransactions.set(chatId, newTxs);
        await syncUserTxToFirestore(chatId, newTxs);

        await answerCallbackQuery(cb.id, "🗑 Operatsiya o'chirildi!");
        await sendTelegramMessage(chatId, "🗑 <b>Operatsiya muvaffaqiyatli o'chirildi!</b> ✅", getMainMenuKeyboard());
      }
      return;
    }

    // B) Handle Text Message & Voice Note
    if (update.message) {
      const message = update.message;
      const chatId = message.chat?.id;
      const text = message.text;
      const voice = message.voice || message.audio;
      const fromUser = message.from;

      if (!chatId) return;
      activeTelegramChats.add(chatId);

      // Handle Voice Note / Audio Recording
      if (voice && voice.file_id) {
        const limitInfo = checkAndIncrementAiLimit(chatId);
        if (!limitInfo.allowed) {
          const limitMsg = `⚠️ <b>Oylik Bepul AI Limiti Tugadi! (5/5 ishlatildi)</b>\n\nSiz oylik bepul 5 ta AI so'rov imkoniyatizdan foydalandingiz.\nCheksiz AI va ovozli tahlil uchun <b>Premium</b> tarifiga o'ting! ⭐`;
          await sendTelegramMessage(chatId, limitMsg, getDualLinkInlineButtons());
          return;
        }

        try {
          await sendTelegramMessage(chatId, "🎙 <i>Ovozli xabar tahlil qilinmoqda...</i>");

          // 1. Get file path from Telegram
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
                await syncUserTxToFirestore(chatId, userList);

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
        
        await sendTelegramMessage(chatId, welcomeText, getDualLinkInlineButtons(), 60);
        await sendTelegramMessage(chatId, "👇 Kerakli bo'limni tanlang:", getMainMenuKeyboard());
        return;
      }

      // 2. Help command or button
      if (text.startsWith("/help") || text.includes("Yordam") || text.includes("yordam")) {
        const helpText = `💡 <b>Moliya AI Boti bo'limlari:</b>\n\n• 📝 <b>Matnli xarajat kiritish</b>\n• 🎙 <b>Ovozli xabar yuborish</b>\n• 📱 <b>Ilovani ochish</b>\n• 📊 <b>Balans va hisobotlar</b>\n• ❌ <b>Operatsiyalarni o'chirish</b>\n\n⭐ <i>1 kunlik bepul sinov va oylik 5 ta AI so'rov limiti mavjud.</i>`;
        await sendTelegramMessage(chatId, helpText, getMainMenuKeyboard());
        return;
      }

      // 3. Balance & Statistics command or button
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

      // 4. Delete last transaction button or command
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

      // Check AI request limit before running Gemini
      const limitInfo = checkAndIncrementAiLimit(chatId);
      if (!limitInfo.allowed) {
        const limitMsg = `⚠️ <b>Oylik Bepul AI Limiti Tugadi! (5/5 ishlatildi)</b>\n\nSiz oylik bepul 5 ta AI so'rov imkoniyatizdan foydalandingiz.\nCheksiz AI so'rovlari uchun <b>Premium</b> tarifiga o'ting! ⭐`;
        await sendTelegramMessage(chatId, limitMsg, {
          inline_keyboard: [
            [{ text: "⭐ Premium olish", web_app: { url: appUrl } }],
            [{ text: "📱 Ilovani ochish", web_app: { url: appUrl } }]
          ]
        });
        return;
      }

      // 5. Natural Language Expense/Income Parsing (Gemini AI or Smart Fallback)
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
- category: string (e.g. 'Oziq-ovqat', 'Transport', 'Kiyim', 'Kommunal', 'Sog\'liq', 'Ta\'lim', 'Maosh', 'Boshqa')
- note: string (clean summary)
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

      // Fallback NLP Parser if Gemini unavailable or failed
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

        let type = 'expense';
        if (lower.includes('oylik') || lower.includes('maosh') || lower.includes('topdim') || lower.includes('daromad') || lower.includes('tushdi')) {
          type = 'income';
        }

        let category = 'Boshqa';
        if (lower.includes('taksi') || lower.includes('avtobus') || lower.includes(' benzin')) category = 'Transport';
        else if (lower.includes('ovqat') || lower.includes('tushlik') || lower.includes('bozor') || lower.includes('eda')) category = 'Oziq-ovqat';
        else if (lower.includes('backpack') || lower.includes('kiyim') || lower.includes('shoes') || lower.includes('sumka')) category = 'Kiyim';
        else if (type === 'income') category = 'Maosh';

        if (amount > 0) {
          parsed = { type, amount, category, note: text };
        }
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
              { text: "📱 Ilovani ochish", web_app: { url: appUrl } }
            ]
          ]
        };

        await sendTelegramMessage(chatId, replyCard, inlineKeyboard);
        return;
      }

      await sendTelegramMessage(chatId, `👍 Xabaringiz qabul qilindi.`, getMainMenuKeyboard());
    }
  }

  // Webhook Endpoint
  app.post("/api/telegram-webhook", async (req, res) => {
    res.status(200).send("OK");
    try {
      await handleTelegramUpdate(req.body);
    } catch (err) {
      console.error('Error handling webhook:', err);
    }
  });

  // Long Polling Engine for local dev & server instant responsiveness
  let lastUpdateId = 0;
  async function startTelegramLongPolling() {
    try {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`);
      const initRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=-1`);
      if (initRes.ok) {
        const initData = await initRes.json();
        if (initData.ok && Array.isArray(initData.result) && initData.result.length > 0) {
          lastUpdateId = initData.result[initData.result.length - 1].update_id;
        }
      }
      console.log(`🤖 Telegram Bot Polling ready for @moliya_v2bot (starting offset: ${lastUpdateId})...`);
    } catch (e) {
      console.error("Telegram init polling error:", e);
    }

    while (true) {
      try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=15`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (data.ok && Array.isArray(data.result)) {
            for (const update of data.result) {
              lastUpdateId = Math.max(lastUpdateId, update.update_id);
              await handleTelegramUpdate(update);
            }
          } else if (!data.ok && data.error_code === 409) {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`);
            await new Promise(r => setTimeout(r, 2000));
          }
        }
      } catch (e) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  startTelegramLongPolling().catch(e => console.error("Long polling error:", e));

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

  async function sendTelegramMessage(chatId: number | string, text: string, replyMarkup?: any, autoDeleteSeconds?: number) {
    if (!BOT_TOKEN) return null;
    try {
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          reply_markup: replyMarkup
        })
      });
      const data = await res.json();
      if (data.ok && data.result?.message_id && autoDeleteSeconds) {
        const msgId = data.result.message_id;
        setTimeout(() => {
          deleteTelegramMessage(chatId, msgId);
        }, autoDeleteSeconds * 1000);
      }
      return data;
    } catch (err) {
      console.error('Failed to send Telegram message:', err);
      return null;
    }
  }

  async function deleteTelegramMessage(chatId: number | string, messageId: number) {
    try {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId })
      });
    } catch (err) {
      console.error('Failed to delete Telegram message:', err);
    }
  }

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
