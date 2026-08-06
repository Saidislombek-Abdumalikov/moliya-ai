import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from "@google/genai";
import crypto from "crypto";
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from './_firebaseClient.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const appUrl = process.env.APP_URL || "https://moliya-ai-pi.vercel.app";

// Helper: Create 60-day Session Token & Mark Login Request VERIFIED in Firestore
async function verifyAndMarkLoginRequest(requestId: string, fromUser: any, phone?: string) {
  try {
    console.log('[BOT] verifyAndMarkLoginRequest called with requestId:', requestId, 'user:', fromUser?.id);
    const tgId = String(fromUser.id);
    const userId = `moliya_user_tg_${tgId}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 24 * 3600 * 1000).toISOString();

    const randomHex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
    const sessionToken = 'sess_' + randomHex;
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
    
    await setDoc(doc(db, 'users', `tg_user_${tgId}`), {
      userId,
      telegramId: tgId,
      name: tgName,
      telegram: tgUsername,
      phone: existingPhone,
      updatedAt: now.toISOString(),
    }, { merge: true });
    console.log('[BOT] User profile updated in both document paths');

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

async function checkAndIncrementAiLimitAsync(fromUser: any): Promise<{ allowed: boolean; remaining: number; isPremium: boolean }> {
  try {
    const tgId = String(fromUser?.id);
    if (!tgId) return { allowed: true, remaining: 5, isPremium: false };
    const userId = `moliya_user_tg_${tgId}`;
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      const data = userSnap.data();

      // 1. Premium subscription check
      if (data.isPremium === true || data.subscriptionStatus === 'active' || data.plan === 'premium') {
        return { allowed: true, remaining: 999, isPremium: true };
      }

      // 2. 24-hour trial period from user creation
      const createdAt = data.createdAt ? new Date(data.createdAt).getTime() : Date.now();
      const is24hTrial = (Date.now() - createdAt) < (24 * 3600 * 1000);
      if (is24hTrial) {
        return { allowed: true, remaining: 999, isPremium: false };
      }

      // 3. AI usage limit check (synced with App)
      const currentCount = Number(data.aiCount || 0);
      const limit = Number(data.aiLimit || 5);

      if (currentCount >= limit) {
        return { allowed: false, remaining: 0, isPremium: false };
      }

      // Increment count in Firestore
      await setDoc(userRef, { aiCount: currentCount + 1, updatedAt: new Date().toISOString() }, { merge: true });
      return { allowed: true, remaining: limit - (currentCount + 1), isPremium: false };
    } else {
      // First interaction: create user doc with 1 usage
      await setDoc(userRef, { aiCount: 1, aiLimit: 5, createdAt: new Date().toISOString() }, { merge: true });
      return { allowed: true, remaining: 4, isPremium: false };
    }
  } catch (e) {
    console.error('Error checking AI limit in Firestore:', e);
    return { allowed: true, remaining: 5, isPremium: false };
  }
}

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

async function savePendingDraftTx(fromUser: any, draftTx: any) {
  try {
    const tgId = String(fromUser?.id);
    if (!tgId) return null;
    const userId = `moliya_user_tg_${tgId}`;
    const draftRef = doc(db, 'users', userId, 'pending_txs', draftTx.id);
    await setDoc(draftRef, draftTx, { merge: true });
    return draftTx;
  } catch (e) {
    console.error('Error saving pending draft tx:', e);
    return null;
  }
}

async function getPendingDraftTx(fromUser: any, txId: string) {
  try {
    const tgId = String(fromUser?.id);
    if (!tgId) return null;
    const userId = `moliya_user_tg_${tgId}`;
    const draftRef = doc(db, 'users', userId, 'pending_txs', txId);
    const snap = await getDoc(draftRef);
    if (snap.exists()) return snap.data();
  } catch (e) {
    console.error('Error fetching pending draft tx:', e);
  }
  return null;
}

async function confirmPendingDraftTx(fromUser: any, txId: string) {
  try {
    const tgId = String(fromUser?.id);
    if (!tgId) return null;
    const userId = `moliya_user_tg_${tgId}`;
    const draftRef = doc(db, 'users', userId, 'pending_txs', txId);
    const snap = await getDoc(draftRef);
    if (snap.exists()) {
      const draftData = snap.data();
      await saveBotTransaction(fromUser, {
        id: draftData.id,
        type: draftData.type,
        name: draftData.name || draftData.note,
        category: draftData.category,
        amount: draftData.amount,
        date: draftData.date || new Date().toISOString()
      });
      await deleteDoc(draftRef);
      return draftData;
    }
  } catch (e) {
    console.error('Error confirming pending draft tx:', e);
  }
  return null;
}

async function cancelPendingDraftTx(fromUser: any, txId: string) {
  try {
    const tgId = String(fromUser?.id);
    if (!tgId) return null;
    const userId = `moliya_user_tg_${tgId}`;
    const draftRef = doc(db, 'users', userId, 'pending_txs', txId);
    await deleteDoc(draftRef);
    return true;
  } catch (e) {
    console.error('Error cancelling pending draft tx:', e);
  }
  return false;
}

function renderConfirmationCard(draftTx: any) {
  const typeEmoji = draftTx.type === 'income' ? '🟢 Daromad' : '🛒 Xarajat';
  const fmtAmt = Math.abs(draftTx.amount || 0).toLocaleString('en-US').replace(/,/g, ' ');

  const text = `❓ <b>Ushbu operatsiyani saqlaymizmi?</b> 🤔\n\n` +
    `📌 <b>Turi:</b> ${typeEmoji}\n` +
    `💵 <b>Summa:</b> ${fmtAmt} so'm\n` +
    `📂 <b>Kategoriya:</b> ${draftTx.category || 'Boshqa'}\n` +
    `📝 <b>Izoh:</b> ${draftTx.name || draftTx.note || 'Operatsiya'}`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: "✅ Saqlash", callback_data: `tx_confirm_${draftTx.id}` },
        { text: "✏️ Tahrirlash", callback_data: `tx_edit_${draftTx.id}` },
        { text: "❌ Bekor qilish", callback_data: `tx_cancel_${draftTx.id}` }
      ]
    ]
  };

  return { text, inlineKeyboard };
}

async function renderRichTransactionCard(fromUser: any, tx: any, isPending: boolean = false) {
  const txs = await getBotTransactions(fromUser);
  const now = new Date();
  
  const currentMonthTxs = txs.filter(t => {
    const d = new Date(t.date || 0);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const totalIncome = txs.filter(t => t.type === 'income').reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
  const totalExpense = txs.filter(t => t.type === 'expense').reduce((acc, t) => acc + Math.abs(Number(t.amount) || 0), 0);
  const netBalance = totalIncome - totalExpense;

  const monthlyExpense = currentMonthTxs.filter(t => t.type === 'expense').reduce((acc, t) => acc + Math.abs(Number(t.amount) || 0), 0);

  const txCategory = tx.category || 'Boshqa';
  const categoryMonthlyTotal = currentMonthTxs
    .filter(t => t.type === 'expense' && (t.category === txCategory || (!t.category && txCategory === 'Boshqa')))
    .reduce((acc, t) => acc + Math.abs(Number(t.amount) || 0), 0) + (isPending ? Math.abs(Number(tx.amount) || 0) : 0);

  const fmtAmt = (n: number) => Math.abs(n || 0).toLocaleString('en-US').replace(/,/g, ' ');
  const fmtMln = (n: number) => {
    const mln = n / 1000000;
    return mln >= 1 ? `${mln.toFixed(1)}mln` : `${fmtAmt(n)}`;
  };

  const txDate = tx.date ? new Date(tx.date) : new Date();
  const dateFormatted = `${String(txDate.getDate()).padStart(2, '0')}.${String(txDate.getMonth() + 1).padStart(2, '0')}.${txDate.getFullYear()}`;

  let text = "";
  if (tx.type === 'expense') {
    text = `<b>${isPending ? "❓ Hisobotga qo'shilsinmi?" : "Hisobotga qo'shildi ✅"}</b>\n\n` +
      `<b>Chiqim:</b>\n` +
      `<b>Sana:</b> ${dateFormatted}\n\n` +
      `<b>Summa:</b> UZS ${fmtAmt(tx.amount)}\n` +
      `<b>Kategoriya:</b> 💲 ${txCategory}\n` +
      `<b>Izoh:</b> ${tx.name || tx.note || "Xarajat"}\n\n` +
      `💡 <i>${txCategory} kategoriyasidagi jami xarajatlar ${fmtMln(categoryMonthlyTotal)} UZS bo'ldi.</i>\n\n` +
      `<b>Bu oygi chiqimlar:</b> ${fmtAmt(monthlyExpense + (isPending ? Math.abs(Number(tx.amount) || 0) : 0))} UZS\n\n` +
      `<b>Balans:</b>\n` +
      `💵 UY-Ro'zg'or: ${fmtAmt(netBalance - (isPending ? Math.abs(Number(tx.amount) || 0) : 0))} UZS`;
  } else {
    text = `✅ <b>${fmtAmt(tx.amount)} UZS miqdoridagi daromad «UY-Ro'zg'or» balansingizga muvaffaqiyatli qo'shildi.</b>\n\n` +
      `<b>Balans:</b>\n` +
      `💵 UY-Ro'zg'or: ${fmtAmt(netBalance + (isPending ? Math.abs(Number(tx.amount) || 0) : 0))} UZS`;
  }

  let inlineKeyboard: any = null;
  if (isPending) {
    inlineKeyboard = {
      inline_keyboard: [
        [
          { text: "✅ Saqlash", callback_data: `tx_confirm_${tx.id}` },
          { text: "✏️ Tahrirlash", callback_data: `tx_edit_${tx.id}` },
          { text: "❌ Bekor qilish", callback_data: `tx_cancel_${tx.id}` }
        ]
      ]
    };
  } else {
    inlineKeyboard = {
      inline_keyboard: [
        [
          { text: "❌ Bekor qilish", callback_data: `del_${tx.id}` },
          { text: "📱 Mini App", web_app: { url: appUrl } }
        ]
      ]
    };
  }

  return { text, inlineKeyboard };
}

async function buildGoalBudgetReport(fromUser: any) {
  const txs = await getBotTransactions(fromUser);
  const tgId = String(fromUser?.id);
  const userSnap = await getDoc(doc(db, 'users', `moliya_user_tg_${tgId}`));
  const userData = userSnap.exists() ? userSnap.data() : {};
  const goal = userData?.onboarding?.goal || userData?.goal || 2000000;

  const now = new Date();
  const currentMonthTxs = txs.filter(t => {
    const d = new Date(t.date || 0);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const totalExpense = currentMonthTxs.filter(t => t.type === 'expense').reduce((acc, t) => acc + Math.abs(Number(t.amount) || 0), 0);
  const fmt = (n: number) => n.toLocaleString('en-US').replace(/,/g, ' ');

  const percent = goal > 0 ? Math.min(100, Math.round((totalExpense / goal) * 100)) : 0;
  const bar = renderProgressBar(percent / 100, 10);
  const remaining = Math.max(0, goal - totalExpense);

  const text = `🎯 <b>Oylik Byudjet Rejasi</b> 📊\n\n` +
    `💰 <b>Oylik belgilangan byudjet:</b> ${fmt(goal)} UZS\n` +
    `🛒 <b>Shu oygi jami xarajat:</b> ${fmt(totalExpense)} UZS\n` +
    `📊 <b>Byudjet bajarilishi:</b> ${percent}% <code>[${bar}]</code>\n` +
    `💵 <b>Qolgan limit:</b> ${fmt(remaining)} UZS\n\n` +
    `💡 <i>Oylik byudjetingizni o'zgartirish uchun pastdagi tugmalardan tanlang:</i>`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: "🎯 1 mln", callback_data: "save_goal_1000000" },
        { text: "🎯 2 mln", callback_data: "save_goal_2000000" },
        { text: "🎯 3 mln", callback_data: "save_goal_3000000" }
      ],
      [
        { text: "🎯 5 mln", callback_data: "save_goal_5000000" },
        { text: "🎯 10 mln", callback_data: "save_goal_10000000" }
      ],
      [
        { text: "📊 Statistika va Tahlil", callback_data: "period_month" }
      ]
    ]
  };

  return { text, inlineKeyboard };
}

const getMainMenuKeyboard = () => {
  return {
    keyboard: [
      [{ text: "📱 Mini App", web_app: { url: appUrl } }, { text: "🌐 Web App" }],
      [{ text: "📊 Balans & Hisobot" }, { text: "🎯 Byudjet & Limitlar" }],
      [{ text: "🧾 Chek Skanner" }, { text: "📥 Eksport" }],
      [{ text: "💡 Yordam" }]
    ],
    resize_keyboard: true
  };
};

async function sendTelegramMessage(chatId: number | string, text: string, replyMarkup?: any): Promise<number | null> {
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
    if (data.ok && data.result?.message_id) {
      return data.result.message_id;
    } else if (!data.ok) {
      console.error('[BOT] Telegram sendMessage HTML API error:', data);
      // Fallback: Strip HTML tags and retry as plain text if HTML parsing failed
      const cleanText = text.replace(/<[^>]*>/g, '');
      const fallbackRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: cleanText,
          reply_markup: replyMarkup
        })
      });
      const fallbackData = await fallbackRes.json();
      if (fallbackData.ok && fallbackData.result?.message_id) {
        return fallbackData.result.message_id;
      }
    }
  } catch (err) {
    console.error('Failed to send Telegram message:', err);
  }
  return null;
}

async function editTelegramMessage(chatId: number | string, messageId: number, text: string, replyMarkup?: any) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
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
    const data = await res.json();
    if (!data.ok) {
      console.error('[BOT] Telegram editMessageText HTML API error:', data);
      const cleanText = text.replace(/<[^>]*>/g, '');
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text: cleanText,
          reply_markup: replyMarkup
        })
      });
    }
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
      ],
      [
        { text: "🎯 Byudjet limitlarini boshqarish", callback_data: "set_b_menu" }
      ]
    ]
  };

  return { text, inlineKeyboard };
}

let commandsSet = false;
async function setBotCommands() {
  if (commandsSet) return;
  commandsSet = true;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands: [
          { command: "start", description: "🚀 Botni ishga tushirish va menyu" }
        ]
      })
    });
  } catch (e) {
    console.error('Error setting bot commands:', e);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(200).send('Telegram Webhook Active');
  }

  try {
    const update = req.body;
    if (!update) return res.status(200).json({ status: 'ok' });

    setBotCommands().catch(e => console.error('setBotCommands error:', e));

    // A) Callback Query
    if (update.callback_query) {
      const cb = update.callback_query;
      const chatId = cb.message?.chat?.id;
      const data = cb.data;

      if (chatId && data && data.startsWith('tx_confirm_')) {
        const txId = data.replace('tx_confirm_', '');
        const confirmed = await confirmPendingDraftTx(cb.from, txId);
        if (confirmed) {
          await answerCallbackQuery(cb.id, "✅ Operatsiya saqlandi!");
          const richCard = await renderRichTransactionCard(cb.from, confirmed, false);
          if (cb.message?.message_id) {
            await editTelegramMessage(chatId, cb.message.message_id, richCard.text, richCard.inlineKeyboard);
          } else {
            await sendTelegramMessage(chatId, richCard.text, richCard.inlineKeyboard);
          }
        } else {
          await answerCallbackQuery(cb.id, "⚠️ Operatsiya topilmadi!");
        }
      } else if (chatId && data && data.startsWith('save_goal_')) {
        const newGoal = parseInt(data.replace('save_goal_', ''), 10);
        if (newGoal > 0) {
          const tgId = String(cb.from?.id);
          const userId = `moliya_user_tg_${tgId}`;
          await setDoc(doc(db, 'users', userId), { goal: newGoal, 'onboarding.goal': newGoal }, { merge: true });
          const fmtGoal = newGoal.toLocaleString('en-US').replace(/,/g, ' ');
          await answerCallbackQuery(cb.id, `🎯 Byudjet: ${fmtGoal} UZS`);
          const goalReport = await buildGoalBudgetReport(cb.from);
          if (cb.message?.message_id) {
            await editTelegramMessage(chatId, cb.message.message_id, goalReport.text, goalReport.inlineKeyboard);
          } else {
            await sendTelegramMessage(chatId, goalReport.text, goalReport.inlineKeyboard);
          }
        }
      } else if (chatId && data && data.startsWith('tx_cancel_')) {
        const txId = data.replace('tx_cancel_', '');
        await cancelPendingDraftTx(cb.from, txId);
        await answerCallbackQuery(cb.id, "❌ Operatsiya bekor qilindi!");
        const cancelMsg = "❌ <b>Operatsiya bekor qilindi.</b> <i>(Tizimga saqlanmadi)</i>";
        if (cb.message?.message_id) {
          await editTelegramMessage(chatId, cb.message.message_id, cancelMsg, undefined);
        } else {
          await sendTelegramMessage(chatId, cancelMsg);
        }
      } else if (chatId && data && data.startsWith('tx_edit_')) {
        const txId = data.replace('tx_edit_', '');
        const draft = await getPendingDraftTx(cb.from, txId);
        if (draft) {
          const typeEmoji = draft.type === 'income' ? '🟢 Daromad' : '🛒 Xarajat';
          const editMsg = `✏️ <b>Operatsiyani tahrirlash:</b>\n\n📌 <b>Hozirgi tur:</b> ${typeEmoji}\n📂 <b>Hozirgi kategoriya:</b> ${draft.category}`;
          const inlineKeyboard = {
            inline_keyboard: [
              [
                { text: draft.type === 'income' ? "🔄 Xarajatga o'tkazish" : "🔄 Daromadga o'tkazish", callback_data: `tx_toggle_type_${txId}` }
              ],
              [
                { text: "📂 Kategoriyani tanlash", callback_data: `tx_edit_cat_${txId}` }
              ],
              [
                { text: "✅ Saqlash (Tayyor)", callback_data: `tx_confirm_${txId}` },
                { text: "❌ Bekor qilish", callback_data: `tx_cancel_${txId}` }
              ]
            ]
          };
          await answerCallbackQuery(cb.id, "✏️ Tahrirlash rejimi");
          if (cb.message?.message_id) {
            await editTelegramMessage(chatId, cb.message.message_id, editMsg, inlineKeyboard);
          }
        }
      } else if (chatId && data && data.startsWith('tx_toggle_type_')) {
        const txId = data.replace('tx_toggle_type_', '');
        const draft = await getPendingDraftTx(cb.from, txId);
        if (draft) {
          const newType = draft.type === 'income' ? 'expense' : 'income';
          draft.type = newType;
          await savePendingDraftTx(cb.from, draft);
          await answerCallbackQuery(cb.id, `🔄 Tur o'zgartirildi: ${newType === 'income' ? 'Daromad' : 'Xarajat'}`);
          const card = await renderRichTransactionCard(cb.from, draft, true);
          if (cb.message?.message_id) {
            await editTelegramMessage(chatId, cb.message.message_id, card.text, card.inlineKeyboard);
          }
        }
      } else if (chatId && data && data.startsWith('tx_edit_cat_')) {
        const txId = data.replace('tx_edit_cat_', '');
        const catMsg = "📂 <b>Qaysi kategoriyaga o'zgartirmoqchisiz?</b>";
        const inlineKeyboard = {
          inline_keyboard: [
            [
              { text: "🛒 Oziq-ovqat", callback_data: `tx_save_cat_${txId}_Oziq-ovqat` },
              { text: "🚕 Transport", callback_data: `tx_save_cat_${txId}_Transport` }
            ],
            [
              { text: "👕 Kiyim", callback_data: `tx_save_cat_${txId}_Kiyim` },
              { text: "💡 Kommunal", callback_data: `tx_save_cat_${txId}_Kommunal` }
            ],
            [
              { text: "🏥 Sog'liq", callback_data: `tx_save_cat_${txId}_Sog'liq` },
              { text: "🎓 Ta'lim", callback_data: `tx_save_cat_${txId}_Ta'lim` }
            ],
            [
              { text: "💲 Mehnat chiqimlari", callback_data: `tx_save_cat_${txId}_Mehnat chiqimlari` }
            ]
          ]
        };
        await answerCallbackQuery(cb.id, "📂 Kategoriya tanlang");
        if (cb.message?.message_id) {
          await editTelegramMessage(chatId, cb.message.message_id, catMsg, inlineKeyboard);
        }
      } else if (chatId && data && data.startsWith('tx_save_cat_')) {
        const rest = data.replace('tx_save_cat_', '');
        const firstUnderscore = rest.indexOf('_');
        const txId = rest.substring(0, firstUnderscore);
        const newCat = rest.substring(firstUnderscore + 1);

        const draft = await getPendingDraftTx(cb.from, txId);
        if (draft && newCat) {
          draft.category = newCat;
          await savePendingDraftTx(cb.from, draft);
          await answerCallbackQuery(cb.id, `📂 Kategoriya: ${newCat}`);
          const card = await renderRichTransactionCard(cb.from, draft, true);
          if (cb.message?.message_id) {
            await editTelegramMessage(chatId, cb.message.message_id, card.text, card.inlineKeyboard);
          }
        }
      } else if (chatId && data && data.startsWith('del_')) {
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
      } else if (chatId && data === 'set_b_menu') {
        const menuText = "🎯 <b>Qaysi kategoriya uchun byudjet limitini o'rnatmoqchisiz?</b>";
        const inlineKeyboard = {
          inline_keyboard: [
            [
              { text: "🛒 Oziq-ovqat", callback_data: "set_b_cat_Oziq-ovqat" },
              { text: "🚕 Transport", callback_data: "set_b_cat_Transport" }
            ],
            [
              { text: "👕 Kiyim", callback_data: "set_b_cat_Kiyim" },
              { text: "💡 Kommunal", callback_data: "set_b_cat_Kommunal" }
            ],
            [
              { text: "🏥 Sog'liq", callback_data: "set_b_cat_Sog'liq" },
              { text: "🎓 Ta'lim", callback_data: "set_b_cat_Ta'lim" }
            ],
            [
              { text: "🔙 Orqaga", callback_data: "period_month" }
            ]
          ]
        };
        await answerCallbackQuery(cb.id, "🎯 Kategoriya tanlang");
        if (cb.message?.message_id) {
          await editTelegramMessage(chatId, cb.message.message_id, menuText, inlineKeyboard);
        } else {
          await sendTelegramMessage(chatId, menuText, inlineKeyboard);
        }
      } else if (chatId && data && data.startsWith('set_b_cat_')) {
        const category = data.replace('set_b_cat_', '');
        const promptText = `🎯 <b>${category}</b> uchun oylik byudjet limitini tanlang:`;
        const inlineKeyboard = {
          inline_keyboard: [
            [
              { text: "500 ming", callback_data: `save_b_${category}_500000` },
              { text: "1 mln", callback_data: `save_b_${category}_1000000` },
              { text: "1.5 mln", callback_data: `save_b_${category}_1500000` }
            ],
            [
              { text: "2 mln", callback_data: `save_b_${category}_2000000` },
              { text: "3 mln", callback_data: `save_b_${category}_3000000` },
              { text: "5 mln", callback_data: `save_b_${category}_5000000` }
            ],
            [
              { text: "🔙 Orqaga", callback_data: "set_b_menu" }
            ]
          ]
        };
        await answerCallbackQuery(cb.id, `🎯 ${category} tanlandi`);
        if (cb.message?.message_id) {
          await editTelegramMessage(chatId, cb.message.message_id, promptText, inlineKeyboard);
        } else {
          await sendTelegramMessage(chatId, promptText, inlineKeyboard);
        }
      } else if (chatId && data && data.startsWith('save_b_')) {
        const parts = data.replace('save_b_', '').split('_');
        const category = parts[0];
        const amount = parseInt(parts[1] || '0', 10);

        if (category && amount > 0) {
          await setUserBudget(cb.from, category, amount);
          const fmtAmt = amount.toLocaleString('en-US').replace(/,/g, ' ');
          await answerCallbackQuery(cb.id, `✅ ${category}: ${fmtAmt} so'm limit!`);
          const report = await buildPeriodReport(cb.from, 'month');
          if (cb.message?.message_id) {
            await editTelegramMessage(chatId, cb.message.message_id, report.text, report.inlineKeyboard);
          } else {
            await sendTelegramMessage(chatId, report.text, report.inlineKeyboard);
          }
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
            const fullName = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ') || 'Foydalanuvchi';
            const username = fromUser.username ? `@${fromUser.username}` : '';
            
            const profileData = {
              phone,
              name: fullName,
              telegram: username,
              telegramId: tgId,
              updatedAt: new Date().toISOString()
            };

            // Save phone and profile data to both user document paths
            await setDoc(doc(db, 'users', `moliya_user_tg_${tgId}`), {
              ...profileData,
              onboarding: {
                name: fullName,
                phone,
                telegram: username,
                telegramId: tgId
              }
            }, { merge: true });
            
            await setDoc(doc(db, 'users', `tg_user_${tgId}`), profileData, { merge: true });

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
        const limitInfo = await checkAndIncrementAiLimitAsync(fromUser);
        if (!limitInfo.allowed) {
          const limitMsg = `⚠️ <b>Chek skanerlash AI faqat Premium tarifda! (5/5 ishlatildi)</b>\n\nSiz oylik bepul 5 ta AI so'rov imkoniyatizdan foydalandingiz.\nCheksiz AI chek tahlili va ovozli xabar uchun <b>Premium</b> tarifiga o'ting! ⭐`;
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

              let response;
              try {
                response = await ai.models.generateContent({
                  model: "gemini-2.5-flash",
                  contents: [
                    { inlineData: { mimeType: "image/jpeg", data: base64Img } },
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
              } catch (e1) {
                response = await ai.models.generateContent({
                  model: "gemini-1.5-flash",
                  contents: [
                    { inlineData: { mimeType: "image/jpeg", data: base64Img } },
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
              }

              const parsed = JSON.parse(response.text || '{}');
              if (parsed && parsed.amount && parsed.amount > 0) {
                const txId = 'tx_' + Date.now();
                const draftTx = {
                  id: txId,
                  type: 'expense',
                  name: `${parsed.store || "Chek"} - ${parsed.note || "Rasmli operatsiya"}`,
                  category: parsed.category || 'Oziq-ovqat',
                  amount: Math.abs(parsed.amount),
                  date: new Date().toISOString()
                };

                await savePendingDraftTx(fromUser, draftTx);
                const card = await renderRichTransactionCard(fromUser, draftTx, true);
                await sendTelegramMessage(chatId, card.text, card.inlineKeyboard);
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
        const limitInfo = await checkAndIncrementAiLimitAsync(fromUser);
        if (!limitInfo.allowed) {
          const limitMsg = `⚠️ <b>Oylik Bepul AI Limiti Tugadi! (5/5 ishlatildi)</b>\n\nSiz oylik bepul 5 ta AI so'rov imkoniyatizdan foydalandingiz.\nCheksiz AI va ovozli tahlil uchun <b>Premium</b> tarifiga o'ting! ⭐`;
          await sendTelegramMessage(chatId, limitMsg, getCleanInlineKeyboard());
          return res.status(200).json({ status: 'ok' });
        }

        let statusMsgId: number | null = null;
        try {
          statusMsgId = await sendTelegramMessage(chatId, "🎙 <i>Ovozli xabar tahlil qilinmoqda (Moliya AI)...</i>");

          const fileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${voice.file_id}`);
          const fileData = await fileRes.json();
          if (fileData.ok && fileData.result?.file_path) {
            const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileData.result.file_path}`;
            const audioBufRes = await fetch(downloadUrl);
            const audioArrayBuffer = await audioBufRes.arrayBuffer();
            const base64Audio = Buffer.from(audioArrayBuffer).toString('base64');

            if (process.env.GEMINI_API_KEY) {
              const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
              const promptText = `Listen carefully to this spoken Uzbek or Russian voice recording and extract financial transaction info into JSON:
- type: 'expense' | 'income'
- amount: number (total in UZS currency, e.g. 25000, 150000, 4000000)
- category: string ('Oziq-ovqat', 'Transport', 'Kiyim', 'Kommunal', 'Sog\'liq', 'Ta\'lim', 'Boshqa', 'Mehnat chiqimlari', 'Daromad')
- note: string (clear description of transaction in Uzbek)`;

              let response;
              try {
                response = await ai.models.generateContent({
                  model: "gemini-2.5-flash",
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
              } catch (e1) {
                console.log('[BOT] gemini-2.5-flash audio fallback to gemini-1.5-flash');
                response = await ai.models.generateContent({
                  model: "gemini-1.5-flash",
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
              }

              const parsed = JSON.parse(response.text || '{}');
              if (parsed && parsed.amount && parsed.amount > 0) {
                const txId = 'tx_' + Date.now();
                const draftTx = {
                  id: txId,
                  type: parsed.type || 'expense',
                  name: parsed.note || "Ovozli xabar",
                  category: parsed.category || 'Boshqa',
                  amount: Math.abs(parsed.amount),
                  date: new Date().toISOString()
                };

                await savePendingDraftTx(fromUser, draftTx);
                const card = await renderRichTransactionCard(fromUser, draftTx, true);
                if (statusMsgId) {
                  await editTelegramMessage(chatId, statusMsgId, card.text, card.inlineKeyboard);
                } else {
                  await sendTelegramMessage(chatId, card.text, card.inlineKeyboard);
                }
                return res.status(200).json({ status: 'ok' });
              }
            }
          }
        } catch (voiceErr) {
          console.error("Voice processing error:", voiceErr);
        }

        const failText = "⚠️ <i>Ovozli xabarni tushunib bo'lmadi. Qaytadan aniqroq gapirib ko'ring (Masalan: \"Taksi uchun 25000 so'm ishlatdim\").</i>";
        if (statusMsgId) {
          await editTelegramMessage(chatId, statusMsgId, failText, getMainMenuKeyboard());
        } else {
          await sendTelegramMessage(chatId, failText, getMainMenuKeyboard());
        }
        return res.status(200).json({ status: 'ok' });
      }

      if (!text) return res.status(200).json({ status: 'ok' });

      // 1. /start command (Handles Login Request UUID e.g. /start req_UUID or standard /start)
      if (text.startsWith("/start")) {
        const rawArg = text.replace('/start', '').trim();
        const requestId = rawArg.replace('req_', '').trim();
        console.log('[BOT] /start received. rawArg:', rawArg, 'requestId:', requestId, 'from user:', fromUser?.id);

        if (requestId && requestId.length >= 8) {
          console.log('[BOT] Processing login request verification...');
          const result = await verifyAndMarkLoginRequest(requestId, fromUser);
          
          if (!result) {
            console.error('[BOT] ❌ verifyAndMarkLoginRequest returned null — sending error to user');
            await sendTelegramMessage(chatId, "⚠️ Tasdiqlashda xatolik yuz berdi. Qaytadan urinib ko'ring.", getCleanInlineKeyboard());
            return res.status(200).json({ status: 'ok' });
          }

          console.log('[BOT] ✅ Verification successful, sending confirmation to Telegram...');
          const successText = `<b>Assalomu alaykum, ${fromUser?.first_name || 'foydalanuvchi'}!</b> 👋✨\n\n✅ <b>Muvaffaqiyatli tasdiqlandi!</b> 🚀\nBrauzeringizdagi Moliya AI ilovasiga avtomatik kirdingiz.\n\n👇 <i>Ilovaga o'tish uchun quyidagi tugmani bosing:</i>`;
          await sendTelegramMessage(chatId, successText, getCleanInlineKeyboard(requestId));
          await sendTelegramMessage(chatId, "👇 Kerakli bo'limni tanlang:", getMainMenuKeyboard());

          // Check if phone number is missing to prompt contact sharing
          let userData: any = {};
          try {
            const tgId = String(fromUser?.id);
            const userSnap = await getDoc(doc(db, 'users', `moliya_user_tg_${tgId}`));
            if (userSnap.exists()) userData = userSnap.data();
          } catch (e) {
            console.error('[BOT] Error reading user doc on /start req:', e);
          }

          if (!userData?.phone && !userData?.onboarding?.phone) {
            const phonePromptText = `📞 <b>Eslatma:</b> <i>Profilingiz to'liq bo'lishi uchun telefon raqamingizni yuboring (Bu raqam profilingiz uchun saqlanadi):</i>`;
            const phoneReplyKeyboard = {
              keyboard: [
                [{ text: "📞 Telefon raqamini ulashish", request_contact: true }],
                [{ text: "📱 Mini App", web_app: { url: appUrl } }, { text: "🌐 Web App", url: appUrl }]
              ],
              resize_keyboard: true,
              one_time_keyboard: true
            };
            await sendTelegramMessage(chatId, phonePromptText, phoneReplyKeyboard);
          }

          return res.status(200).json({ status: 'ok' });
        }

        // Standard /start without request parameter — check if user has phone saved
        console.log('[BOT] Standard /start (no login request)');
        let userData: any = {};
        try {
          const tgId = String(fromUser?.id);
          const userSnap = await getDoc(doc(db, 'users', `moliya_user_tg_${tgId}`));
          if (userSnap.exists()) userData = userSnap.data();
        } catch (e) {
          console.error('[BOT] Error reading user doc on /start:', e);
        }

        const welcomeText = `<b>Assalomu alaykum, ${fromUser?.first_name || 'foydalanuvchi'}!</b> 👋✨\n\n<b>Moliya AI</b> botiga xush kelibsiz! 🚀\n\nPulingizni oson va aqlli boshqaring.\n\n👇 <b>Ilovani ochish uchun quyidagi tugmani bosing:</b>`;
        
        if (!userData?.phone && !userData?.onboarding?.phone) {
          const phonePromptText = `<b>Assalomu alaykum, ${fromUser?.first_name || 'foydalanuvchi'}!</b> 👋✨\n\n` +
            `<b>Moliya AI</b> botiga xush kelibsiz! 🚀\n\n` +
            `📞 <i>Profilingiz to'liq bo'lishi uchun telefon raqamingizni yuboring (Bu raqam profilingiz uchun saqlanadi):</i>`;
          const phoneReplyKeyboard = {
            keyboard: [
              [{ text: "📞 Telefon raqamini ulashish", request_contact: true }],
              [{ text: "📱 Mini App", web_app: { url: appUrl } }, { text: "🌐 Web App", url: appUrl }]
            ],
            resize_keyboard: true,
            one_time_keyboard: true
          };
          await sendTelegramMessage(chatId, phonePromptText, phoneReplyKeyboard);
          return res.status(200).json({ status: 'ok' });
        }

        await sendTelegramMessage(chatId, welcomeText, getCleanInlineKeyboard());
        await sendTelegramMessage(chatId, "👇 Kerakli bo'limni tanlang:", getMainMenuKeyboard());
        return res.status(200).json({ status: 'ok' });
      }

      // 1.5. Web App Link command ("🌐 Web App")
      if (text.includes("Web App") || text.includes("web app") || text.includes("Web app") || text.startsWith("/webapp") || text.includes("🌐 Web App")) {
        const webAppText = `🌐 <b>Moliya AI Web App:</b>\n\n👇 <i>Brauzerda kirish uchun quyidagi tugmani bosing:</i>`;
        const inlineKeyboard = {
          inline_keyboard: [
            [
              { text: "🌐 Web App-ni brauzerda ochish 🚀", url: appUrl }
            ],
            [
              { text: "📱 Telegram Mini App", web_app: { url: appUrl } }
            ]
          ]
        };
        await sendTelegramMessage(chatId, webAppText, inlineKeyboard);
        return res.status(200).json({ status: 'ok' });
      }

      // 2. Help command ("💡 Yordam")
      if (text.startsWith("/help") || text.includes("Yordam") || text.includes("yordam")) {
        const helpText = `💡 <b>Moliya AI Boti Yordam Markazi</b> ✨\n\n` +
          `• 🎙 <b>Ovozli xabar:</b> Xarajat va daromadlarni ovozli yuboring\n` +
          `• 🧾 <b>Chek skanerlash:</b> Chek rasmini yuboring (AI Vision)\n` +
          `• 📝 <b>Matn:</b> "Taksi 25000" deb yozib yuboring\n` +
          `• 📊 <b>Balans & Hisobot:</b> Kunlik va oylik statistika\n` +
          `• 🎯 <b>Byudjet & Limitlar:</b> Oylik moliyaviy reja\n` +
          `• 📥 <b>Eksport:</b> Tranzaksiyalarni Excel/CSV shaklida yuklab olish\n\n` +
          `👨‍💻 <b>Admin bilan bog'lanish:</b> @saidislombek_abdumalikov`;

        const helpKeyboard = {
          inline_keyboard: [
            [
              { text: "💬 Admin bilan bog'lanish", url: "https://t.me/saidislombek_abdumalikov" }
            ],
            [
              { text: "📱 Mini App", web_app: { url: appUrl } },
              { text: "🌐 Web App", url: appUrl }
            ]
          ]
        };
        await sendTelegramMessage(chatId, helpText, helpKeyboard);
        return res.status(200).json({ status: 'ok' });
      }

      // 3. Balance & Stats (/balance, /stats, "Balans & Hisobot")
      if (text.includes("Balans") || text.includes("balans") || text.startsWith("/balance") || text.includes("Statistika") || text.startsWith("/stats")) {
        const report = await buildPeriodReport(fromUser, 'month');
        await sendTelegramMessage(chatId, report.text, report.inlineKeyboard);
        return res.status(200).json({ status: 'ok' });
      }

      // 4. Budget & Goal (/budget, /byudjet, "Byudjet & Limitlar")
      if (text.includes("Byudjet") || text.includes("byudjet") || text.startsWith("/budget") || text.startsWith("/byudjet") || text.includes("Limitlar")) {
        const goalReport = await buildGoalBudgetReport(fromUser);
        await sendTelegramMessage(chatId, goalReport.text, goalReport.inlineKeyboard);
        return res.status(200).json({ status: 'ok' });
      }

      // 5. Check Scanner Prompt ("🧾 Chek Skanner")
      if (text.includes("Chek") || text.includes("chek") || text.includes("Skanner")) {
        const checkPrompt = `🧾 <b>Chek skanerlash (AI Vision)</b> 📸\n\nDo'kon chekini (Korzinka, Makro, Havas va boshqalar) rasmga olib shu yerga yuboring!\nSun'iy intellekt chekdagi summani avtomatik o'qiydi va hisobotga kiritadi. 🚀`;
        await sendTelegramMessage(chatId, checkPrompt, getMainMenuKeyboard());
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
      const limitInfo = await checkAndIncrementAiLimitAsync(fromUser);
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
          let response;
          try {
            response = await ai.models.generateContent({
              model: "gemini-2.5-flash",
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
          } catch (e1) {
            response = await ai.models.generateContent({
              model: "gemini-1.5-flash",
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
          }
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
        const draftTx = {
          id: txId,
          type: parsed.type || 'expense',
          name: parsed.note || text,
          category: parsed.category || 'Boshqa',
          amount: Math.abs(parsed.amount),
          date: new Date().toISOString()
        };

        await savePendingDraftTx(fromUser, draftTx);
        const card = await renderRichTransactionCard(fromUser, draftTx, true);
        await sendTelegramMessage(chatId, card.text, card.inlineKeyboard);
        return res.status(200).json({ status: 'ok' });
      }

      await sendTelegramMessage(chatId, `👍 Xabaringiz qabul qilindi.`, getMainMenuKeyboard());
    }
  } catch (err) {
    console.error('Error processing Telegram webhook:', err);
  }
  return res.status(200).json({ status: 'ok' });
}
