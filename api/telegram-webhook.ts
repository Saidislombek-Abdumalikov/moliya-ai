import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from "@google/genai";
import crypto from "crypto";
import { supabase } from './_supabaseClient.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const appUrl = process.env.APP_URL || "https://moliya-ai-pi.vercel.app";

// Helper: Create 60-day Session Token & Mark Login Request VERIFIED in Supabase
async function verifyAndMarkLoginRequest(requestId: string, fromUser: any, phone?: string) {
  try {
    console.log('[BOT] verifyAndMarkLoginRequest called with requestId:', requestId, 'user:', fromUser?.id);
    if (!fromUser || !fromUser.id) {
      console.error('[BOT] verifyAndMarkLoginRequest failed: fromUser is missing');
      return null;
    }

    const tgId = String(fromUser.id);
    const userId = `moliya_user_tg_${tgId}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 24 * 3600 * 1000).toISOString();

    const randomHex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
    const sessionToken = 'sess_' + randomHex;

    const tgName = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ') || 'Telegram Foydalanuvchi';
    const tgUsername = fromUser.username ? '@' + fromUser.username : '@moliya_user';

    // 1. Fetch existing user from Supabase
    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    const existingPhone = phone || existingUser?.phone || existingUser?.onboarding?.phone || '';

    const updatedOnboarding = {
      ...(existingUser?.onboarding || {}),
      completed: true,
      language: existingUser?.language || existingUser?.onboarding?.language || 'uz',
      name: tgName,
      phone: existingPhone,
      telegram: tgUsername,
      telegramId: tgId,
    };

    // 2. Upsert user in Supabase users table
    await supabase.from('users').upsert({
      id: userId,
      name: tgName,
      telegram: tgUsername,
      telegram_id: tgId,
      phone: existingPhone || null,
      language: updatedOnboarding.language,
      is_premium: existingUser?.is_premium || false,
      session_token: sessionToken,
      session_expires_at: expiresAt,
      onboarding: updatedOnboarding,
      updated_at: now.toISOString()
    }, { onConflict: 'id' });

    // 3. Mark login request VERIFIED in Supabase
    const cleanId = requestId.replace(/^req_/, '').trim();
    await supabase.from('users').upsert({
      id: `req_${cleanId}`,
      login_request_id: cleanId,
      login_request_status: 'VERIFIED',
      telegram_id: tgId,
      session_token: sessionToken,
      updated_at: now.toISOString()
    }, { onConflict: 'id' });

    // 4. Generate short-lived exchange code (5-minute TTL, single-use)
    const exchangeCode = crypto.randomBytes(24).toString('hex'); // 48-char random code
    const codeExpiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString(); // 5 minutes
    await supabase.from('users').upsert({
      id: `exchange_${exchangeCode}`,
      telegram_id: tgId,
      session_token: sessionToken,
      login_request_status: 'VALID',
      session_expires_at: codeExpiresAt,
      updated_at: now.toISOString()
    }, { onConflict: 'id' });

    console.log('[BOT] ✅ Login request verified in Supabase for user:', userId);
    return { sessionToken, userId, onboarding: updatedOnboarding, exchangeCode };
  } catch (err) {
    console.error('[BOT] ❌ Error verifying login request:', err);
    return null;
  }
}

// Transaction Helpers via Supabase users.transactions JSON Array
async function saveBotTransaction(fromUser: any, txItem: { id: string; type: string; name: string; category: string; amount: number; date: string }) {
  try {
    const tgId = String(fromUser.id);
    const userId = `moliya_user_tg_${tgId}`;
    const { data: user } = await supabase.from('users').select('transactions').eq('id', userId).maybeSingle();
    const currentTxs = Array.isArray(user?.transactions) ? user.transactions : [];
    const updated = [txItem, ...currentTxs.filter((t: any) => t.id !== txItem.id)];
    await supabase.from('users').update({ transactions: updated, updated_at: new Date().toISOString() }).eq('id', userId);
    console.log(`[BOT] Saved transaction ${txItem.id} to Supabase for user ${userId}`);
  } catch (err) {
    console.error('[BOT] Error saving transaction to Supabase:', err);
  }
}

async function getBotTransactions(fromUser: any) {
  try {
    const tgId = String(fromUser.id);
    const userId = `moliya_user_tg_${tgId}`;
    const { data: user } = await supabase.from('users').select('transactions').eq('id', userId).maybeSingle();
    return Array.isArray(user?.transactions) ? user.transactions : [];
  } catch (err) {
    console.error('[BOT] Error fetching transactions from Supabase:', err);
    return [];
  }
}

async function deleteLastBotTransaction(fromUser: any) {
  try {
    const tgId = String(fromUser.id);
    const userId = `moliya_user_tg_${tgId}`;
    const { data: user } = await supabase.from('users').select('transactions').eq('id', userId).maybeSingle();
    const currentTxs = Array.isArray(user?.transactions) ? user.transactions : [];
    if (currentTxs.length > 0) {
      const deleted = currentTxs[0];
      const updated = currentTxs.slice(1);
      await supabase.from('users').update({ transactions: updated, updated_at: new Date().toISOString() }).eq('id', userId);
      return deleted;
    }
    return null;
  } catch (err) {
    console.error('[BOT] Error deleting transaction from Supabase:', err);
    return null;
  }
}

async function checkAndIncrementAiLimitAsync(fromUser: any): Promise<{ allowed: boolean; remaining: number; isPremium: boolean }> {
  try {
    const tgId = String(fromUser?.id);
    if (!tgId) return { allowed: true, remaining: 5, isPremium: false };
    const userId = `moliya_user_tg_${tgId}`;
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();

    if (user) {
      if (user.is_premium) {
        return { allowed: true, remaining: 999, isPremium: true };
      }

      const currentCount = Number(user.ai_query_count || 0);
      const limit = 5;

      if (currentCount >= limit) {
        return { allowed: false, remaining: 0, isPremium: false };
      }

      const newCount = currentCount + 1;
      await supabase.from('users').update({
        ai_query_count: newCount,
        last_ai_query_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq('id', userId);

      return { allowed: true, remaining: limit - newCount, isPremium: false };
    } else {
      await supabase.from('users').upsert({
        id: userId,
        telegram_id: tgId,
        ai_query_count: 1,
        last_ai_query_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });
      return { allowed: true, remaining: 4, isPremium: false };
    }
  } catch (e) {
    console.error('Error checking AI limit in Supabase:', e);
    return { allowed: true, remaining: 5, isPremium: false };
  }
}

const getCleanInlineKeyboard = (exchangeCode?: string) => {
  const urlWithAuth = exchangeCode ? `${appUrl}?code=${exchangeCode}` : appUrl;
  return {
    inline_keyboard: [
      [
        { text: "📱 Telegram Mini App", web_app: { url: urlWithAuth } },
        { text: "🌐 Saytga o'tish 🚀", url: urlWithAuth }
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
    const { data: user } = await supabase.from('users').select('onboarding').eq('id', userId).maybeSingle();
    return user?.onboarding?.budgets || {};
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
    const { data: user } = await supabase.from('users').select('onboarding').eq('id', userId).maybeSingle();
    const newOnboarding = { ...(user?.onboarding || {}), budgets: updated };
    await supabase.from('users').update({ onboarding: newOnboarding, updated_at: new Date().toISOString() }).eq('id', userId);
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

// In-memory pending draft cache for fast Telegram callbacks
const pendingDraftsCache = new Map<string, any>();

async function savePendingDraftTx(fromUser: any, draftTx: any) {
  try {
    const tgId = String(fromUser?.id);
    if (!tgId) return null;
    pendingDraftsCache.set(`${tgId}_${draftTx.id}`, draftTx);
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
    return pendingDraftsCache.get(`${tgId}_${txId}`) || null;
  } catch (e) {
    console.error('Error fetching pending draft tx:', e);
  }
  return null;
}

async function confirmPendingDraftTx(fromUser: any, txId: string) {
  try {
    const tgId = String(fromUser?.id);
    if (!tgId) return null;
    const draftData = pendingDraftsCache.get(`${tgId}_${txId}`);
    if (draftData) {
      await saveBotTransaction(fromUser, {
        id: draftData.id,
        type: draftData.type,
        name: draftData.name || draftData.note,
        category: draftData.category,
        amount: draftData.amount,
        date: draftData.date || new Date().toISOString()
      });
      pendingDraftsCache.delete(`${tgId}_${txId}`);
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
    pendingDraftsCache.delete(`${tgId}_${txId}`);
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

  const inlineKeyboard = isPending
    ? {
        inline_keyboard: [
          [
            { text: "✅ Ha, to'g'ri", callback_data: `tx_confirm_${tx.id}` },
            { text: "🔄 Turini o'zgartirish", callback_data: `tx_toggle_type_${tx.id}` }
          ],
          [
            { text: "📂 Kategoriyani tanlash", callback_data: `tx_edit_cat_${tx.id}` },
            { text: "✏️ Tahrirlash", callback_data: `tx_edit_${tx.id}` }
          ],
          [
            { text: "❌ Bekor qilish", callback_data: `tx_cancel_${tx.id}` }
          ]
        ]
      }
    : {
        inline_keyboard: [
          [
            { text: "🗑 O'chirish", callback_data: `del_${tx.id}` },
            { text: "📱 Mini App", web_app: { url: appUrl } }
          ]
        ]
      };

  return { text, inlineKeyboard };
}

async function renderUserReportSummary(fromUser: any) {
  const tgId = String(fromUser?.id);
  const userId = `moliya_user_tg_${tgId}`;
  const { data: user } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
  const txs: any[] = Array.isArray(user?.transactions) ? user.transactions : [];

  const now = new Date();
  const currentMonthTxs = txs.filter(t => {
    const d = new Date(t.date || 0);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const totalIncome = txs.filter(t => t.type === 'income').reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
  const totalExpense = txs.filter(t => t.type === 'expense').reduce((acc, t) => acc + Math.abs(Number(t.amount) || 0), 0);
  const netBalance = totalIncome - totalExpense;

  const monthlyExpense = currentMonthTxs.filter(t => t.type === 'expense').reduce((acc, t) => acc + Math.abs(Number(t.amount) || 0), 0);
  const monthlyIncome = currentMonthTxs.filter(t => t.type === 'income').reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

  const fmt = (n: number) => Math.abs(n || 0).toLocaleString('en-US').replace(/,/g, ' ');

  const goal = Number(user?.onboarding?.monthlyGoal || user?.goal || 0);
  let goalText = "";
  if (goal > 0) {
    const pct = Math.min(100, Math.round((monthlyExpense / goal) * 100));
    goalText = `\n🎯 <b>Oylik limit:</b> ${fmt(goal)} so'm (${pct}% sarflandi)\n${renderProgressBar(monthlyExpense / goal)}`;
  }

  const text = `📊 <b>Moliya AI — Hisobot & Balans</b> ✨\n\n` +
    `👤 <b>Foydalanuvchi:</b> ${fromUser?.first_name || 'Hurmatli foydalanuvchi'}\n` +
    `💵 <b>Umumiy Sof Balans:</b> ${netBalance >= 0 ? '+' : ''}${fmt(netBalance)} so'm\n\n` +
    `📅 <b>Joriy oy ko'rsatkichlari:</b>\n` +
    `🟢 <b>Daromad:</b> +${fmt(monthlyIncome)} so'm\n` +
    `🔴 <b>Xarajat:</b> -${fmt(monthlyExpense)} so'm` +
    goalText + `\n\n` +
    `👇 <i>Batafsil grafiklar va tahlil ilovada mavjud:</i>`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: "📱 Mini App-da ko'rish", web_app: { url: appUrl } },
        { text: "🌐 Web App", url: appUrl }
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

async function answerCallbackQuery(callbackQueryId: string, text?: string) {
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
    console.error('Failed to answer callback query:', err);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'Moliya AI Telegram Webhook Live (Supabase)' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const update = req.body;
    if (!update) return res.status(200).json({ status: 'no_body' });

    // Handle Inline Callbacks
    if (update.callback_query) {
      const cb = update.callback_query;
      const data = cb.data;
      const chatId = cb.message?.chat?.id;

      if (chatId && data && data.startsWith('tx_confirm_')) {
        const txId = data.replace('tx_confirm_', '');
        const confirmed = await confirmPendingDraftTx(cb.from, txId);
        if (confirmed) {
          await answerCallbackQuery(cb.id, "✅ Operatsiya muvaffaqiyatli saqlandi!");
          const card = await renderRichTransactionCard(cb.from, confirmed, false);
          if (cb.message?.message_id) {
            await editTelegramMessage(chatId, cb.message.message_id, card.text, card.inlineKeyboard);
          }
        } else {
          await answerCallbackQuery(cb.id, "⚠️ Operatsiya allaqachon tasdiqlangan");
        }
      } else if (chatId && data && data.startsWith('tx_cancel_')) {
        const txId = data.replace('tx_cancel_', '');
        await cancelPendingDraftTx(cb.from, txId);
        await answerCallbackQuery(cb.id, "❌ Operatsiya bekor qilindi");
        if (cb.message?.message_id) {
          await editTelegramMessage(chatId, cb.message.message_id, "❌ <b>Operatsiya bekor qilindi.</b>", getMainMenuKeyboard());
        }
      } else if (chatId && data && data.startsWith('del_')) {
        const txId = data.replace('del_', '');
        const tgId = String(cb.from?.id || chatId);
        const userId = `moliya_user_tg_${tgId}`;
        const { data: user } = await supabase.from('users').select('transactions').eq('id', userId).maybeSingle();
        const txs = Array.isArray(user?.transactions) ? user.transactions : [];
        const updated = txs.filter((t: any) => String(t.id) !== String(txId));
        await supabase.from('users').update({ transactions: updated, updated_at: new Date().toISOString() }).eq('id', userId);

        await answerCallbackQuery(cb.id, "🗑 Operatsiya o'chirildi!");
        await sendTelegramMessage(chatId, "🗑 <b>Operatsiya muvaffaqiyatli o'chirildi!</b> ✅", getMainMenuKeyboard());
      }
      return res.status(200).json({ status: 'ok' });
    }

    const message = update.message || update.edited_message;
    if (!message) return res.status(200).json({ status: 'no_message' });

    const chatId = message.chat?.id;
    const fromUser = message.from;
    const text = (message.text || "").trim();

    // Handle Contact Share (Phone Number)
    if (message.contact) {
      const contact = message.contact;
      const phone = contact.phone_number?.startsWith('+') ? contact.phone_number : `+${contact.phone_number}`;
      const tgId = String(contact.user_id || fromUser.id);
      const fullName = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ') || contact.first_name || 'Foydalanuvchi';
      const username = fromUser.username ? `@${fromUser.username}` : '';
      const userId = `moliya_user_tg_${tgId}`;

      // Fetch existing user to preserve onboarding, transactions, cards, session_token
      const { data: existingUser } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();

      const updatedOnboarding = {
        ...(existingUser?.onboarding || {}),
        completed: true,
        language: existingUser?.language || existingUser?.onboarding?.language || 'uz',
        name: fullName || existingUser?.name || 'Foydalanuvchi',
        phone,
        telegram: username || existingUser?.telegram || '',
        telegramId: tgId,
      };

      await supabase.from('users').upsert({
        id: userId,
        name: fullName || existingUser?.name || 'Foydalanuvchi',
        phone,
        telegram: username || existingUser?.telegram || null,
        telegram_id: tgId,
        language: updatedOnboarding.language,
        is_premium: existingUser?.is_premium || false,
        onboarding: updatedOnboarding,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

      // Generate single-use exchange code so the user can open Web App / Mini App authenticated
      const now = new Date();
      const exchangeCode = crypto.randomBytes(24).toString('hex');
      const codeExpiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
      await supabase.from('users').upsert({
        id: `exchange_${exchangeCode}`,
        telegram_id: tgId,
        session_token: existingUser?.session_token || null,
        login_request_status: 'VALID',
        session_expires_at: codeExpiresAt,
        updated_at: now.toISOString()
      }, { onConflict: 'id' });

      const successText = `✅ <b>Telefon raqamingiz saqlandi va profilingiz tasdiqlandi!</b> 🎉\n\n📞 <b>Raqam:</b> ${phone}\n\n👇 <i>Ilovaga o'tish uchun quyidagi tugmani bosing:</i>`;
      await sendTelegramMessage(chatId, successText, getCleanInlineKeyboard(exchangeCode));
      await sendTelegramMessage(chatId, "👇 Kerakli bo'limni tanlang:", getMainMenuKeyboard());
      return res.status(200).json({ status: 'ok' });
    }

    // Handle /start command
    if (text.startsWith("/start")) {
      const rawArg = text.replace('/start', '').trim();
      const requestId = rawArg.replace('req_', '').trim();

      if (requestId && requestId.length >= 8) {
        const verifyResult = await verifyAndMarkLoginRequest(requestId, fromUser);
        const code = verifyResult?.exchangeCode || undefined;
        const tgId = String(fromUser?.id);
        const { data: userDoc } = await supabase.from('users').select('*').eq('id', `moliya_user_tg_${tgId}`).maybeSingle();

        const successText = `<b>Assalomu alaykum, ${fromUser?.first_name || 'foydalanuvchi'}!</b> 👋✨\n\n✅ <b>Profilingiz muvaffaqiyatli tasdiqlandi!</b> 🚀\nBrauzeringizdagi Moliya AI sahifasiga qaytsangiz, profilingiz avtomatik ochiladi.\n\n👇 <i>Ilovani to'g'ridan-to'g'ri ochish:</i>`;
        await sendTelegramMessage(chatId, successText, getCleanInlineKeyboard(code));

        if (!userDoc?.phone && !userDoc?.onboarding?.phone) {
          const phonePromptText = `📞 <i>Profilingiz to'liq bo'lishi uchun telefon raqamingizni ham ulashing:</i>`;
          const phoneReplyKeyboard = {
            keyboard: [
              [{ text: "📞 Telefon raqamini ulashish", request_contact: true }],
              [{ text: "📱 Mini App", web_app: { url: code ? `${appUrl}?code=${code}` : appUrl } }, { text: "🌐 Web App", url: code ? `${appUrl}?code=${code}` : appUrl }]
            ],
            resize_keyboard: true,
            one_time_keyboard: true
          };
          await sendTelegramMessage(chatId, phonePromptText, phoneReplyKeyboard);
        } else {
          await sendTelegramMessage(chatId, "👇 Kerakli bo'limni tanlang:", getMainMenuKeyboard());
        }
        return res.status(200).json({ status: 'ok' });
      }

      // Standard /start
      const tgId = String(fromUser?.id);
      const tgName = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ') || 'Telegram Foydalanuvchi';
      const tgUsername = fromUser.username ? `@${fromUser.username}` : '';
      const userId = `moliya_user_tg_${tgId}`;

      // Always get and store Telegram User ID, name, username
      const { data: userDoc } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();

      const existingPhone = userDoc?.phone || userDoc?.onboarding?.phone || '';
      const updatedOnboarding = {
        ...(userDoc?.onboarding || {}),
        name: tgName || userDoc?.name,
        telegram: tgUsername || userDoc?.telegram,
        telegramId: tgId,
        language: userDoc?.language || userDoc?.onboarding?.language || 'uz',
        phone: existingPhone
      };

      await supabase.from('users').upsert({
        id: userId,
        name: tgName,
        telegram: tgUsername,
        telegram_id: tgId,
        phone: existingPhone || null,
        language: updatedOnboarding.language,
        onboarding: updatedOnboarding,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

      // Generate single-use exchange code for buttons
      const now = new Date();
      const exchangeCode = crypto.randomBytes(24).toString('hex');
      const codeExpiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
      await supabase.from('users').upsert({
        id: `exchange_${exchangeCode}`,
        telegram_id: tgId,
        session_token: userDoc?.session_token || null,
        login_request_status: 'VALID',
        session_expires_at: codeExpiresAt,
        updated_at: now.toISOString()
      }, { onConflict: 'id' });

      if (!existingPhone) {
        const phonePromptText = `<b>Assalomu alaykum, ${fromUser?.first_name || 'foydalanuvchi'}!</b> 👋✨\n\n` +
          `<b>Moliya AI</b> botiga xush kelibsiz! 🚀\n\n` +
          `📞 <i>Profilingiz to'liq bo'lishi uchun telefon raqamingizni yuboring:</i>`;
        const phoneReplyKeyboard = {
          keyboard: [
            [{ text: "📞 Telefon raqamini ulashish", request_contact: true }],
            [{ text: "📱 Mini App", web_app: { url: `${appUrl}?code=${exchangeCode}` } }, { text: "🌐 Web App", url: `${appUrl}?code=${exchangeCode}` }]
          ],
          resize_keyboard: true,
          one_time_keyboard: true
        };
        await sendTelegramMessage(chatId, phonePromptText, phoneReplyKeyboard);
        return res.status(200).json({ status: 'ok' });
      }

      const welcomeText = `<b>Assalomu alaykum, ${fromUser?.first_name || 'foydalanuvchi'}!</b> 👋✨\n\n<b>Moliya AI</b> botiga xush kelibsiz! 🚀\nPulingizni oson va aqlli boshqaring.\n\n👇 <b>Kerakli bo'limni tanlang:</b>`;
      await sendTelegramMessage(chatId, welcomeText, getCleanInlineKeyboard(exchangeCode));
      await sendTelegramMessage(chatId, "👇 Asosiy menyu:", getMainMenuKeyboard());
      return res.status(200).json({ status: 'ok' });
    }

    // Balans & Hisobot
    if (text.includes("Balans & Hisobot") || text.startsWith("/report") || text.startsWith("/balans")) {
      const summary = await renderUserReportSummary(fromUser);
      await sendTelegramMessage(chatId, summary.text, summary.inlineKeyboard);
      return res.status(200).json({ status: 'ok' });
    }

    // Web App Link
    if (text.includes("Web App") || text.startsWith("/webapp")) {
      await sendTelegramMessage(chatId, `🌐 <b>Moliya AI Web App:</b>\n\n👇 <i>Brauzerda kirish uchun tugmani bosing:</i>`, {
        inline_keyboard: [
          [{ text: "🌐 Web App-ni ochish 🚀", url: appUrl }],
          [{ text: "📱 Telegram Mini App", web_app: { url: appUrl } }]
        ]
      });
      return res.status(200).json({ status: 'ok' });
    }

    // Default: AI Expense/Income Parsing for text inputs
    if (text.length > 2) {
      const aiLimit = await checkAndIncrementAiLimitAsync(fromUser);
      if (!aiLimit.allowed) {
        await sendTelegramMessage(chatId, "⚠️ <b>Bepul AI limitingiz tugadi!</b> Cheksiz ishlatish uchun Premium oling.", getCleanInlineKeyboard());
        return res.status(200).json({ status: 'ok' });
      }

      const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "";
      if (apiKey) {
        try {
          const ai = new GoogleGenAI({ apiKey });
          const prompt = `Parse this financial text: "${text}". Return JSON: { type: 'expense'|'income', amount: number, category: string, note: string }`;
          const result = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: { responseMimeType: "application/json" }
          });

          if (result && result.text) {
            const parsed = JSON.parse(result.text);
            if (parsed.amount) {
              const draftTx = {
                id: Date.now().toString() + Math.random().toString(36).substring(2, 6),
                type: parsed.type || 'expense',
                amount: parsed.amount,
                name: parsed.note || text,
                category: parsed.category || 'Boshqa',
                date: new Date().toISOString()
              };

              await savePendingDraftTx(fromUser, draftTx);
              const card = await renderRichTransactionCard(fromUser, draftTx, true);
              await sendTelegramMessage(chatId, card.text, card.inlineKeyboard);
              return res.status(200).json({ status: 'ok' });
            }
          }
        } catch (aiErr) {
          console.error('AI parse error:', aiErr);
        }
      }
    }

    // Default fallback
    await sendTelegramMessage(chatId, "👇 Kerakli bo'limni tanlang:", getMainMenuKeyboard());
    return res.status(200).json({ status: 'ok' });
  } catch (err: any) {
    console.error('Telegram Webhook error:', err);
    return res.status(200).json({ status: 'error_handled' });
  }
}
