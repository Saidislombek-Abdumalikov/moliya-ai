import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from "@google/genai";
import crypto from "crypto";
import { supabase } from './_supabaseClient.js';
import { getCandidateAiKeys, recordKeyResult } from './_aiRouter.js';
import { checkAiQuota, recordAiUsage } from './_aiQuotaHelper.js';
import {
  normalizeUzbekFinancialText,
  buildUzbekFinancialAiPrompt,
  validateAiFinancialOutput,
  getServerDateTimeContext,
  parseSafeDate,
  parseTurboFinancialText,
  TurboTransaction,
  TurboParseResult
} from './_uzbekFinancialNormalizer.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8955141731:AAGILXzT69Vity8ZFi-H8XeZc_H6_BFaS8Y';
const appUrl = process.env.APP_URL || "https://moliya-ai-pi.vercel.app";

// ── Telegram Bot Message Logging & Types ─────────────────────────
export interface BotMessageEntry {
  id: string; // msg_{chatId}_{messageId} or bot_{chatId}_{messageId}
  update_id?: number;
  chat_id: string | number;
  message_id: number;
  direction: 'user_to_bot' | 'bot_to_user';
  sender: 'user' | 'bot';
  type: string; // 'text' | 'command' | 'voice' | 'photo' | 'document' | 'audio' | 'video' | 'sticker' | 'contact' | 'location' | 'bot_response' | 'ai_response' | 'callback_query' | 'system'
  text?: string;
  caption?: string;
  metadata?: Record<string, any>;
  timestamp: string;
}

export async function logBotMessage(userId: string, entry: BotMessageEntry) {
  if (!userId || !entry.message_id) return;
  try {
    const { data: u } = await supabase.from('users').select('onboarding').eq('id', userId).maybeSingle();
    const ob = u?.onboarding || {};
    const existingMsgs: BotMessageEntry[] = Array.isArray(ob.bot_messages) ? ob.bot_messages : [];

    // Idempotency: skip if already logged
    const isDuplicate = existingMsgs.some(m =>
      (entry.update_id && m.update_id === entry.update_id) ||
      (m.message_id === entry.message_id && m.direction === entry.direction && String(m.chat_id) === String(entry.chat_id))
    );
    if (isDuplicate) return;

    // Keep last 500 entries to prevent unbounded JSONB growth while retaining deep history
    const updatedMsgs = [...existingMsgs, entry].slice(-500);
    const numMsgId = Number(entry.message_id) || 0;
    const currentLastId = Number(ob.last_message_id) || 0;
    const updatedOb = {
      ...ob,
      bot_messages: updatedMsgs,
      last_message_id: Math.max(currentLastId, numMsgId)
    };
    await supabase.from('users').update({ onboarding: updatedOb, updated_at: new Date().toISOString() }).eq('id', userId);
  } catch (err) {
    console.warn('[BOT] logBotMessage note:', err);
  }
}

// ── Telegram API Helpers ─────────────────────────────────────
async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  replyMarkup?: any,
  userId?: string,
  customType: string = 'bot_response'
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
    const data = await res.json();
    if (data?.ok && data?.result?.message_id && userId) {
      await logBotMessage(userId, {
        id: `bot_${chatId}_${data.result.message_id}`,
        chat_id: chatId,
        message_id: data.result.message_id,
        direction: 'bot_to_user',
        sender: 'bot',
        type: customType,
        text,
        timestamp: new Date().toISOString()
      });
    }
    return data;
  } catch (err) {
    console.error('[BOT] Failed to send Telegram message:', err);
    return null;
  }
}

async function editTelegramMessage(
  chatId: number | string,
  messageId: number,
  text: string,
  replyMarkup?: any,
  userId?: string,
  customType: string = 'bot_response'
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
    const data = await res.json();
    if (data?.ok && userId) {
      await logBotMessage(userId, {
        id: `bot_${chatId}_${messageId}`,
        chat_id: chatId,
        message_id: messageId,
        direction: 'bot_to_user',
        sender: 'bot',
        type: customType,
        text,
        timestamp: new Date().toISOString()
      });
    }
    return data;
  } catch (err) {
    console.error('[BOT] Failed to edit Telegram message:', err);
    return null;
  }
}

async function deleteTelegramMessage(chatId: number | string, messageId: number | string) {
  if (!BOT_TOKEN || !messageId) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(chatId),
        message_id: Number(messageId)
      })
    });
    return await res.json();
  } catch (err) {
    console.warn('[BOT] Failed to delete message:', err);
    return null;
  }
}

async function setLastTempMsgId(userId: string, msgId: number | string | undefined) {
  if (!userId || !msgId) return;
  try {
    const { data: u } = await supabase.from('users').select('onboarding').eq('id', userId).maybeSingle();
    const updatedOb = { ...(u?.onboarding || {}), last_temp_msg_id: Number(msgId) };
    await supabase.from('users').update({ onboarding: updatedOb }).eq('id', userId);
  } catch {}
}

async function cleanTemporaryBotMessages(chatId: number | string, user: any) {
  const prevMsgId = user?.onboarding?.last_temp_msg_id;
  if (prevMsgId) {
    deleteTelegramMessage(chatId, prevMsgId).catch(() => {});
  }
}

async function sendOrEditMenuMessage(
  chatId: number | string,
  userId: string,
  text: string,
  keyboard?: any
) {
  return await sendTelegramMessage(chatId, text, keyboard, userId);
}

async function sendChatAction(chatId: number | string, action: 'typing' | 'record_voice' | 'upload_voice' | 'record_video' | 'upload_photo') {
  if (!BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: String(chatId), action })
    });
  } catch {}
}

function getMainAppKeyboard(appUrl: string) {
  return {
    inline_keyboard: [
      [{ text: "📱 Moliya Mini Appni ochish", web_app: { url: appUrl } }],
      [
        { text: "💳 Kartalarim", callback_data: "menu_cards" },
        { text: "📊 Oylik Limit", callback_data: "menu_limit" }
      ],
      [
        { text: "👤 Profilim", callback_data: "menu_profile" },
        { text: "📈 Statistika", callback_data: "menu_stats" }
      ],
      [
        { text: "💎 Premium Pro", callback_data: "menu_premium" },
        { text: "❓ Yordam", callback_data: "menu_help" }
      ]
    ]
  };
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

// ── Bot Commands Registration ────────────────────────────────
let commandsRegistered = false;
async function registerBotCommandsOnce() {
  if (commandsRegistered || !BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands: [
          { command: 'start', description: '🚀 Moliya AI ni boshlash' },
          { command: 'app', description: '📱 Mini Appni ochish' },
          { command: 'profile', description: '👤 Profil va hisob ma\'lumotlari' },
          { command: 'cards', description: '💳 Ulangan bank kartalari' },
          { command: 'limit', description: '📊 Oylik limitni ko\'rish/o\'zgartirish' },
          { command: 'premium', description: '⭐ VIP Premium imkoniyatlari' },
          { command: 'stats', description: '📈 Oylik statistika va balans' },
          { command: 'help', description: '❓ Yo\'riqnoma va yordam' }
        ]
      })
    });
    commandsRegistered = true;
  } catch (e) {
    console.warn('[BOT] Failed to register Telegram commands:', e);
  }
}

// ── Canonical User Resolution & Identity Model ───────────────
async function resolveCanonicalUser(fromUser: any) {
  const tgId = String(fromUser.id);
  const userId = `moliya_user_tg_${tgId}`;
  const now = new Date().toISOString();
  const fullName = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ') || 'Foydalanuvchi';
  const username = fromUser.username ? `@${fromUser.username}` : null;

  // 1. Identity-based block check (survives account deletion)
  const { data: blockedIdentity } = await supabase
    .from('users')
    .select('*')
    .eq('id', `restricted_tg_${tgId}`)
    .maybeSingle();

  if (blockedIdentity && blockedIdentity.onboarding?.is_blocked !== false) {
    return { user: blockedIdentity, userId, isBlocked: true, isRegistered: false, isNew: false };
  }

  // 2. Fetch existing active canonical user
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (existing) {
    // Check if user is blocked by admin
    const isBlocked = Boolean(
      existing.onboarding?.is_blocked ||
      existing.device_info?.is_blocked ||
      existing.onboarding?.is_restricted ||
      existing.device_info?.restricted
    );

    if (isBlocked) {
      return { user: existing, userId, isBlocked: true, isRegistered: false, isNew: false };
    }

    return { user: existing, userId, isBlocked: false, isRegistered: true, isNew: false };
  }

  // 3. User was deleted or is first-time visitor -> Create clean active user record with trial
  const trialEnd = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const newOnboarding = {
    completed: false,
    language: 'uz',
    name: fullName,
    telegram: username,
    telegramId: tgId,
    trial_started_at: now,
    trial_ends_at: trialEnd,
    registration_status: 'completed'
  };

  const newPayload = {
    id: userId,
    name: fullName,
    telegram: username,
    telegram_id: tgId,
    phone: null,
    language: 'uz',
    is_premium: true,
    premium_expires_at: trialEnd,
    ai_limit: null,
    ai_query_count: 0,
    platform: 'telegram',
    cards: [],
    transactions: [],
    onboarding: newOnboarding,
    registration_status: 'completed',
    created_at: now,
    updated_at: now
  };

  const { error: upErr } = await supabase.from('users').upsert(newPayload, { onConflict: 'id' });
  if (upErr) {
    console.error('[BOT] Error creating initial user record:', upErr.message);
  }

  return { user: newPayload, userId, isBlocked: false, isRegistered: true, isNew: true };
}

// ── Complete Phone Registration & Grant 1-Day Trial ─────────
async function completePhoneRegistration(fromUser: any, phoneNumber: string) {
  const tgId = String(fromUser.id);
  const userId = `moliya_user_tg_${tgId}`;
  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + 24 * 3600 * 1000).toISOString();
  const fullName = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ') || 'Foydalanuvchi';
  const username = fromUser.username ? `@${fromUser.username}` : null;

  // Clean registration starting completely fresh from zero (no old transactions/cards restored)
  const updatedOnboarding = {
    completed: false,
    language: 'uz',
    name: fullName,
    phone: phoneNumber,
    telegram: username,
    telegramId: tgId,
    registration_status: 'completed',
    trial_started_at: now.toISOString(),
    trial_ends_at: trialEndsAt
  };

  const updatePayload = {
    id: userId,
    name: fullName,
    telegram: username,
    telegram_id: tgId,
    phone: phoneNumber,
    is_premium: true, // Fresh 1-Day Unlimited Premium Trial!
    premium_expires_at: trialEndsAt,
    ai_limit: null, // Unlimited for trial
    ai_query_count: 0,
    platform: 'telegram',
    cards: [], // Fresh account: zero cards
    transactions: [], // Fresh account: zero transactions
    onboarding: updatedOnboarding,
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  };

  const { error: saveErr } = await supabase.from('users').upsert(updatePayload, { onConflict: 'id' });
  if (saveErr) {
    console.error('[BOT] Error saving verified phone registration:', saveErr.message);
  }
  return updatePayload;
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

    const { isBlocked, isRegistered } = await resolveCanonicalUser(fromUser);
    if (isBlocked || !isRegistered) return null;

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
async function saveBotTransactions(userId: string, txItems: Array<{
  id?: string;
  type?: string;
  name?: string;
  title?: string;
  category?: string;
  amount: number;
  date?: string;
  day?: number;
  month?: number;
  year?: number;
  time?: string;
  note?: string;
  debtWho?: string;
  cardId?: string;
  counterparty?: string | null;
  description?: string;
}>) {
  if (!txItems || txItems.length === 0) return [];
  const { data: user, error: fetchErr } = await supabase.from('users').select('transactions').eq('id', userId).maybeSingle();
  if (fetchErr) {
    console.error('[BOT] Error fetching user transactions:', fetchErr);
    throw fetchErr;
  }
  const currentTxs = Array.isArray(user?.transactions) ? user.transactions : [];

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');

  const cleanTxs = txItems.map((txItem, idx) => {
    const finalDate = txItem.date || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const finalDay = txItem.day || now.getDate();
    const finalMonth = txItem.month || (now.getMonth() + 1);
    const finalYear = txItem.year || now.getFullYear();
    const finalTime = txItem.time || `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const txId = txItem.id || `tx_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`;

    const rawAmt = Math.abs(Number(txItem.amount) || 0);
    const isIncome = txItem.type === 'income';
    const signedAmount = isIncome ? rawAmt : -rawAmt;

    return {
      id: txId,
      type: txItem.type || 'expense',
      amount: signedAmount,
      category: txItem.category || 'Boshqa',
      note: txItem.note || txItem.description || txItem.name || txItem.title || txItem.category || '',
      title: txItem.title || txItem.description || txItem.name || txItem.note || '',
      cardId: txItem.cardId || 'cash',
      date: finalDate,
      day: finalDay,
      month: finalMonth,
      year: finalYear,
      time: finalTime,
      debtWho: txItem.debtWho || txItem.counterparty || ''
    };
  });

  const newTxIds = new Set(cleanTxs.map(t => String(t.id)));
  const updated = [...cleanTxs, ...currentTxs.filter((t: any) => !newTxIds.has(String(t.id)))];
  const { error: updateErr } = await supabase.from('users').update({ transactions: updated, updated_at: new Date().toISOString() }).eq('id', userId);
  if (updateErr) {
    console.error('[BOT] Error updating transactions column in Supabase:', updateErr);
    throw updateErr;
  }
  return cleanTxs;
}

async function saveBotTransaction(userId: string, txItem: {
  id?: string;
  type?: string;
  name?: string;
  title?: string;
  category?: string;
  amount: number;
  date?: string;
  day?: number;
  month?: number;
  year?: number;
  time?: string;
  note?: string;
  debtWho?: string;
  cardId?: string;
}) {
  const saved = await saveBotTransactions(userId, [txItem]);
  return saved.length > 0;
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

// ── Marketing & Financial Wisdom Hooks ───────────────────────
const MARKETING_HOOKS = [
  "💡 <b>Moliya AI Maslahati:</b> Har bir xarajatni o'z vaqtida yozib borish oyiga o'rtacha 15-20% ortiqcha sarf-xarajatning oldini oladi!",
  "🎯 <b>Moliyaviy Erkinlik:</b> Oylik xarajat limitingizni belgilang va ko'zlagan maqsadingizga 2 barobar tezroq erishing!",
  "📊 <b>Jonli Tahlil:</b> Balansingiz va xarajatlar tuzilmasini interaktiv grafiklar bilan Moliya Mini App orqali kuzating.",
  "⚡ <b>Tezkorlik:</b> Chek surati yoki 2 soniyali ovozli xabar orqali ham barcha xarajatlaringizni 1 zumda kiritishingiz mumkin!",
  "⭐ <b>VIP Imkoniyatlar:</b> Cheksiz AI tahlili, chuqur oylik hisobotlar va eksklyuziv imkoniyatlar uchun VIP Premium-ga ulaning!"
];

function buildTransactionSuccessCard(tx: {
  id?: string;
  type?: string;
  category?: string;
  amount: number;
  name?: string;
  title?: string;
  note?: string;
  date?: string;
  time?: string;
}, isInc: boolean, txId: string) {
  const cat = tx.category || 'Boshqa';
  const emoji = CATEGORY_EMOJIS[cat] || (isInc ? '💰' : '💸');
  const absAmount = Math.abs(Number(tx.amount) || 0);
  const formattedAmount = absAmount.toLocaleString('uz-UZ').replace(/,/g, ' ');
  const randomHook = MARKETING_HOOKS[Math.floor(Math.random() * MARKETING_HOOKS.length)];
  const label = tx.title || tx.name || tx.note || cat;

  const text =
    `✨ <b>Muvaffaqiyatli saqlandi!</b>\n\n` +
    `${isInc ? '🟢' : '🔴'} <b>Turi:</b> ${isInc ? 'Daromad' : 'Xarajat'}\n` +
    `${emoji} <b>Kategoriya:</b> ${cat}\n` +
    `💰 <b>Summa:</b> ${formattedAmount} so'm\n` +
    `📝 <b>Izoh:</b> ${label}\n` +
    `📅 <b>Sana:</b> ${tx.date || 'Bugun'}${tx.time ? ` | ${tx.time}` : ''}\n\n` +
    `───────────────────\n` +
    `${randomHook}`;

  const keyboard = {
    inline_keyboard: [
      [{ text: "📱 Mini Appni ochish (Jonli Balans) 🚀", web_app: { url: appUrl } }],
      [
        { text: "📊 Bugungi hisobot", callback_data: "today_stats" },
        { text: "⭐ VIP Premium", callback_data: "view_premium" }
      ],
      [{ text: "🗑 Bekor qilish", callback_data: `del_${txId}` }]
    ]
  };

  return { text, keyboard };
}

function buildMultiTransactionSuccessCard(txs: any[]) {
  const randomHook = MARKETING_HOOKS[Math.floor(Math.random() * MARKETING_HOOKS.length)];
  let listText = '';
  let totalExpense = 0;
  let totalIncome = 0;

  for (const tx of txs) {
    const isInc = tx.type === 'income';
    const cat = tx.category || 'Boshqa';
    const emoji = CATEGORY_EMOJIS[cat] || (isInc ? '💰' : '💸');
    const amt = Math.abs(Number(tx.amount) || 0);
    if (isInc) totalIncome += amt;
    else totalExpense += amt;
    const formattedAmt = amt.toLocaleString('uz-UZ').replace(/,/g, ' ');
    const desc = tx.title || tx.note || tx.description || tx.name || cat;
    listText += `${isInc ? '🟢' : '🔴'} ${emoji} <b>${cat}:</b> ${formattedAmt} so'm <i>(${desc})</i>\n`;
  }

  const text =
    `✨ <b>${txs.length} ta operatsiya muvaffaqiyatli saqlandi!</b>\n\n` +
    listText + '\n' +
    (totalExpense > 0 ? `🔴 <b>Jami xarajat:</b> ${totalExpense.toLocaleString('uz-UZ').replace(/,/g, ' ')} so'm\n` : '') +
    (totalIncome > 0 ? `🟢 <b>Jami daromad:</b> ${totalIncome.toLocaleString('uz-UZ').replace(/,/g, ' ')} so'm\n` : '') +
    `📅 <b>Sana:</b> ${txs[0]?.date || 'Bugun'}\n\n` +
    `───────────────────\n` +
    `${randomHook}`;

  const keyboard = {
    inline_keyboard: [
      [{ text: "📱 Mini Appni ochish (Jonli Balans) 🚀", web_app: { url: appUrl } }],
      [
        { text: "📊 Bugungi hisobot", callback_data: "today_stats" },
        { text: "⭐ VIP Premium", callback_data: "view_premium" }
      ]
    ]
  };

  return { text, keyboard };
}

async function parseTextWithAi(text: string) {
  // 1. ROCKET FAST PATH (<1ms): Local Turbo Deterministic NLP Engine
  const turboResult = parseTurboFinancialText(text);
  if (turboResult && turboResult.overall_confidence >= 0.85) {
    const firstTx = turboResult.transactions[0];
    return {
      intent: turboResult.intent,
      transactions: turboResult.transactions,
      // Backward compatibility properties:
      isValid: true,
      type: firstTx?.type || 'expense',
      amount: firstTx?.amount || 0,
      currency: firstTx?.currency || 'UZS',
      category: firstTx?.category || 'Boshqa',
      name: firstTx?.description || text.slice(0, 80),
      note: firstTx?.description || text,
      date: firstTx?.date || getServerDateTimeContext().currentDate,
      debtWho: firstTx?.counterparty || '',
      is_local_turbo: true
    };
  }

  // Pre-process and normalize Uzbek abbreviations & multipliers (e.g. 14 mln, 50k, 2 yarim mln)
  const normalized = normalizeUzbekFinancialText(text);

  // If amount and category cleanly inferred locally, return immediately!
  if (normalized.extractedAmount && normalized.extractedAmount > 0 && normalized.inferredCategory) {
    return {
      intent: 'record_transaction' as const,
      transactions: [{
        type: (normalized.inferredType as any) || 'expense',
        amount: normalized.extractedAmount,
        currency: 'UZS',
        category: normalized.inferredCategory,
        description: normalized.originalText.slice(0, 80),
        date: getServerDateTimeContext().currentDate,
        time: null,
        counterparty: null,
        confidence: 0.95
      }],
      isValid: true,
      type: normalized.inferredType || 'expense',
      amount: normalized.extractedAmount,
      currency: 'UZS',
      category: normalized.inferredCategory,
      name: normalized.originalText.slice(0, 80),
      note: normalized.originalText,
      date: getServerDateTimeContext().currentDate,
      debtWho: '',
      is_local_turbo: true
    };
  }

  const candidateKeys = await getCandidateAiKeys();
  const envKey = process.env.GEMINI_API_KEY;
  const keysToTry = candidateKeys.length > 0
    ? candidateKeys
    : (envKey ? [{ id: 'env_gemini', api_key: envKey, name: 'ENV Key', model: 'gemini-3.5-flash-lite' }] : []);

  if (keysToTry.length === 0) {
    if (normalized.extractedAmount && normalized.extractedAmount > 0) {
      return {
        intent: 'record_transaction' as const,
        transactions: [{
          type: (normalized.inferredType as any) || 'expense',
          amount: normalized.extractedAmount,
          currency: 'UZS',
          category: normalized.inferredCategory || 'Boshqa',
          description: normalized.originalText.slice(0, 80),
          date: getServerDateTimeContext().currentDate,
          time: null,
          counterparty: null,
          confidence: 0.85
        }],
        isValid: true,
        type: normalized.inferredType || 'expense',
        amount: normalized.extractedAmount,
        currency: 'UZS',
        category: normalized.inferredCategory || 'Boshqa',
        name: normalized.originalText.slice(0, 80),
        note: normalized.originalText,
        date: getServerDateTimeContext().currentDate,
        debtWho: '',
        is_local_turbo: true
      };
    }
    return null;
  }

  const prompt = buildUzbekFinancialAiPrompt(normalized.normalizedText);
  const activeModels = ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.5-flash'];

  for (const keyObj of keysToTry) {
    const rawApiKey = (keyObj.api_key || '').trim();
    if (!rawApiKey) continue;

    let primary = keyObj.model || 'gemini-3.5-flash-lite';
    if (primary === 'gemini-flash-latest' || primary.includes('2.0-flash') || primary.includes('3.1-flash')) {
      primary = 'gemini-3.5-flash-lite';
    }
    const modelsToTry = [...new Set([primary, ...activeModels])];

    for (const modelToUse of modelsToTry) {
      try {
        const ai = new GoogleGenAI({ apiKey: rawApiKey });

        let timer: any;
        const timeoutPromise = new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('AI_TIMEOUT')), 2500);
        });

        const generatePromise = ai.models.generateContent({
          model: modelToUse,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            maxOutputTokens: 200,
            temperature: 0.1
          }
        });

        const response: any = await Promise.race([generatePromise, timeoutPromise]);
        clearTimeout(timer);

        if (response?.text) {
          const rawParsed = JSON.parse(response.text);
          const validated = validateAiFinancialOutput(rawParsed, normalized);
          if (validated.isValid) {
            recordKeyResult(keyObj.id, true).catch(() => {});
            return {
              intent: 'record_transaction' as const,
              transactions: [{
                type: (validated.type as any) || 'expense',
                amount: validated.amount,
                currency: 'UZS',
                category: validated.category,
                description: validated.name,
                date: validated.date,
                time: validated.time,
                counterparty: validated.debtWho || null,
                confidence: 0.95
              }],
              isValid: true,
              type: validated.type,
              amount: validated.amount,
              currency: 'UZS',
              category: validated.category,
              name: validated.name,
              note: validated.note,
              date: validated.date,
              debtWho: validated.debtWho || '',
              is_local_turbo: false
            };
          }
        }
      } catch (e: any) {
        recordKeyResult(keyObj.id, false, e?.message, 'temporary').catch(() => {});
        console.warn(`[BOT] Gemini parse error with key on ${modelToUse}:`, e?.message);
        break; // try next key immediately
      }
    }
  }

  // Fallback to purely normalized extraction if AI network fails
  if (normalized.extractedAmount && normalized.extractedAmount > 0) {
    return {
      intent: 'record_transaction' as const,
      transactions: [{
        type: (normalized.inferredType as any) || 'expense',
        amount: normalized.extractedAmount,
        currency: 'UZS',
        category: normalized.inferredCategory || 'Boshqa',
        description: normalized.originalText.slice(0, 80),
        date: getServerDateTimeContext().currentDate,
        time: null,
        counterparty: null,
        confidence: 0.85
      }],
      isValid: true,
      type: normalized.inferredType || 'expense',
      amount: normalized.extractedAmount,
      currency: 'UZS',
      category: normalized.inferredCategory || 'Boshqa',
      name: normalized.originalText.slice(0, 80),
      note: normalized.originalText,
      date: getServerDateTimeContext().currentDate,
      debtWho: '',
      is_local_turbo: true
    };
  }

  return null;
}

// ── Unified Interface Renderers ──────────────────────────────
async function renderProfileMessage(fromUser: any, user: any, userId: string) {
  const { data: u } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
  const dbUser = u || user;
  const quota = await checkAiQuota(userId);
  const planLabel = quota.isTrial
    ? '💎 1-Kunlik Cheksiz Premium Sinovi'
    : quota.isPremium
      ? '⭐ VIP Premium (Cheksiz)'
      : '🆓 Bepul Tarif';

  const quotaStatus = quota.limit === null
    ? '♾️ Cheksiz'
    : `${quota.usedCount} / ${quota.limit} (${quota.remaining} ta qoldi)`;

  const cardsCount = Array.isArray(dbUser?.cards) ? dbUser.cards.length : 0;
  const txsCount = Array.isArray(dbUser?.transactions) ? dbUser.transactions.length : 0;
  const monthlyGoal = Number(dbUser?.onboarding?.monthlyGoal || 3000000);

  const fullName = [fromUser?.first_name, fromUser?.last_name].filter(Boolean).join(' ') || dbUser?.name || 'Moliya Foydalanuvchisi';
  const username = fromUser?.username ? `@${fromUser.username}` : (dbUser?.telegram || '—');
  const tgId = fromUser?.id ? String(fromUser.id) : (dbUser?.telegram_id || '—');
  const phone = dbUser?.phone || '—';

  const text =
    `👤 <b>Moliya Foydalanuvchi Profili</b>\n\n` +
    `• <b>Ism:</b> ${fullName}\n` +
    `• <b>Telegram:</b> ${username}\n` +
    `• <b>Telegram ID:</b> <code>${tgId}</code>\n` +
    `• <b>Telefon:</b> <code>${phone}</code> ${phone !== '—' ? '✅ Tasdiqlangan' : ''}\n\n` +
    `🏷 <b>Tarif:</b> ${planLabel}\n` +
    `⚡ <b>Bugungi AI so'rovi:</b> ${quotaStatus}\n` +
    `📊 <b>Oylik Limit:</b> ${monthlyGoal.toLocaleString()} so'm\n` +
    `💳 <b>Ulangan kartalar:</b> ${cardsCount} ta\n` +
    `📝 <b>Jami operatsiyalar:</b> ${txsCount} ta\n\n` +
    `👇 <i>Bo'limni tanlang yoki Mini Appni oching:</i>`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: "💳 Kartalar", callback_data: "view_cards" },
        { text: "📊 Oylik Limit", callback_data: "view_limit" }
      ],
      [
        { text: "⭐ Premium", callback_data: "view_premium" },
        { text: "📈 Statistika", callback_data: "view_stats" }
      ],
      [
        { text: "🚀 Moliya Mini Appni ochish", web_app: { url: appUrl } }
      ]
    ]
  };

  return { text, keyboard };
}

async function renderCardsMessage(userId: string) {
  const { data: u } = await supabase.from('users').select('cards').eq('id', userId).maybeSingle();
  const cards = Array.isArray(u?.cards) ? u.cards : [];

  let text = `💳 <b>Sizning Bank Kartalaringiz</b>\n\n`;

  if (cards.length === 0) {
    text += `Sizda hali birorta karta ulanmagan.\n\n` +
      `Kartalaringizni Moliya Mini App orqali qo'shishingiz va ularning balanslarini kuzatib borishingiz mumkin. 👇`;
  } else {
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const brandEmoji = c.brand === 'humo' ? '🟧' : (c.brand === 'visa' || c.brand === 'mastercard' ? '🌐' : '🟩');
      const num = c.number || '•••• ••••';
      const balNum = c.balance ? Number(String(c.balance).replace(/\s/g, '').replace(/,/g, '')) : 0;
      text += `${brandEmoji} <b>${c.bank || 'Bank'} (${(c.brand || 'uzcard').toUpperCase()})</b>\n` +
              `• Raqam: <code>${num}</code>\n` +
              `• Balans: <b>${balNum.toLocaleString()} so'm</b>\n\n`;
    }
    text += `👇 <i>Kartalarni qo'shish yoki boshqarish uchun Mini Appga o'ting:</i>`;
  }

  const keyboard = {
    inline_keyboard: [
      [{ text: "➕ Kartalarni boshqarish (Mini App)", web_app: { url: appUrl } }],
      [{ text: "🔙 Profilga qaytish", callback_data: "view_profile" }]
    ]
  };

  return { text, keyboard };
}

async function renderLimitMessage(userId: string, newGoalStr?: string) {
  const { data: u } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
  const onboarding = u?.onboarding || {};
  let monthlyGoal = Number(onboarding.monthlyGoal || 3000000);
  let updateNotice = '';

  if (newGoalStr) {
    const norm = normalizeUzbekFinancialText(newGoalStr);
    const parsedAmt = norm.extractedAmount || parseInt(newGoalStr.replace(/\D/g, ''), 10);
    if (parsedAmt && parsedAmt >= 100000) {
      monthlyGoal = parsedAmt;
      const updatedOb = { ...onboarding, monthlyGoal };
      await supabase.from('users').update({ onboarding: updatedOb, updated_at: new Date().toISOString() }).eq('id', userId);
      updateNotice = `✅ <b>Oylik xarajat limitingiz muvaffaqiyatli yangilandi!</b>\n\n`;
    }
  }

  const txs = Array.isArray(u?.transactions) ? u.transactions : [];
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();

  const monthExpenses = txs.filter((t: any) => {
    if (t.type === 'income') return false;
    const tD = new Date(t.date);
    return !isNaN(tD.getTime()) ? (tD.getMonth() + 1 === currentMonth && tD.getFullYear() === currentYear) : true;
  }).reduce((acc: number, t: any) => acc + (Number(t.amount) || 0), 0);

  const percent = Math.min(Math.round((monthExpenses / monthlyGoal) * 100), 100);
  const filledBars = Math.round(percent / 10);
  const emptyBars = 10 - filledBars;
  const progressBar = '█'.repeat(filledBars) + '░'.repeat(emptyBars);

  const remaining = Math.max(monthlyGoal - monthExpenses, 0);
  const isExceeded = monthExpenses > monthlyGoal;

  const text =
    updateNotice +
    `📊 <b>Oylik Xarajat Limiti (${currentMonth}/${currentYear})</b>\n\n` +
    `🎯 <b>Belgilangan limit:</b> ${monthlyGoal.toLocaleString()} so'm\n` +
    `🔴 <b>Shu oy sarflandi:</b> ${monthExpenses.toLocaleString()} so'm (${percent}%)\n` +
    `[${progressBar}] ${percent}%\n\n` +
    (isExceeded
      ? `⚠️ <b>Diqqat: Oylik limitdan ${(monthExpenses - monthlyGoal).toLocaleString()} so'm ortiqcha sarflandi!</b>\n\n`
      : `🟢 <b>Qolgan byudjet:</b> ${remaining.toLocaleString()} so'm\n\n`) +
    `💡 <i>Limitni o'zgartirish uchun:</i>\n<code>/limit 6000000</code> yoki <code>/limit 5 mln</code> deb yozing.\n` +
    `Yoki Mini App orqali sozlang:`;

  const keyboard = {
    inline_keyboard: [
      [{ text: "⚙️ Limitni Mini Appda sozlash", web_app: { url: appUrl } }],
      [{ text: "🔙 Profilga qaytish", callback_data: "view_profile" }]
    ]
  };

  return { text, keyboard };
}

async function renderPremiumMessage(userId: string) {
  const { data: u } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
  const quota = await checkAiQuota(userId);

  const planLabel = quota.isTrial
    ? '💎 1-Kunlik Cheksiz Premium Sinovi'
    : quota.isPremium
      ? '⭐ VIP Premium (Faol)'
      : '🆓 Bepul Tarif';

  const expiresText = u?.premium_expires_at
    ? `\n⏳ <b>Amal qilish muddati:</b> ${new Date(u.premium_expires_at).toLocaleDateString('uz-UZ')}`
    : '';

  const text =
    `⭐ <b>Moliya AI — VIP Premium</b>\n\n` +
    `• <b>Hozirgi tarif:</b> ${planLabel}${expiresText}\n\n` +
    `✨ <b>VIP Premium imkoniyatlari:</b>\n` +
    `• ♾️ <b>Cheksiz AI so'rovlar</b> (kunlik limitsiz)\n` +
    `• 🎙 <b>Ovozli xabarlarni cheksiz tahlil qilish</b>\n` +
    `• 📸 <b>Chek skaneri (OCR) cheksiz foydalanish</b>\n` +
    `• 📊 <b>Chuqur moliyaviy tahlil va maslahatlar</b>\n` +
    `• ⚡ <b>Tezkor va aniq moliyaviy tahlil</b>\n` +
    `• 🚫 <b>Hech qanday cheklov va kutishlarsiz</b>\n\n` +
    `👇 <i>VIP Premium obunasini faollashtirish uchun:</i>`;

  const keyboard = {
    inline_keyboard: [
      [{ text: "💎 Premium Obuna (Mini App)", web_app: { url: appUrl } }],
      [{ text: "🔙 Profilga qaytish", callback_data: "view_profile" }]
    ]
  };

  return { text, keyboard };
}

async function renderStatsMessage(userId: string) {
  const { data: u } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
  const txs = Array.isArray(u?.transactions) ? u.transactions : [];

  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();

  let totalExpense = 0;
  let totalIncome = 0;
  const catTotals: Record<string, number> = {};

  for (const t of txs) {
    const amt = Math.abs(Number(t.amount || 0));
    if (t.type === 'income') {
      totalIncome += amt;
    } else {
      totalExpense += amt;
    }
    const cat = t.category || 'Boshqa';
    if (t.type !== 'income') {
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

  const quota = await checkAiQuota(userId);
  const planLabel = quota.isTrial
    ? '💎 1-Kunlik Cheksiz Premium Sinovi'
    : quota.isPremium
      ? '⭐ VIP Premium (Cheksiz)'
      : '🆓 Bepul Tarif';

  const quotaStatus = quota.limit === null
    ? '♾️ Cheksiz'
    : `${quota.usedCount} / ${quota.limit} (${quota.remaining} ta qoldi)`;

  const statsText =
    `📊 <b>Moliyaviy hisobot (${currentMonth}/${currentYear})</b>\n\n` +
    `🔴 <b>Jami xarajat:</b> ${totalExpense.toLocaleString()} so'm\n` +
    `🟢 <b>Jami daromad:</b> ${totalIncome.toLocaleString()} so'm\n` +
    `💰 <b>Sof balans:</b> ${balance.toLocaleString()} so'm\n\n` +
    (breakdownText ? `<b>Top xarajatlar:</b>\n${breakdownText}\n` : '') +
    `🏷 <b>Tarif:</b> ${planLabel}\n` +
    `⚡ <b>Bugungi AI so'rovlar:</b> ${quotaStatus}\n\n` +
    `👇 <i>Batafsil tahlil uchun Mini Appni oching:</i>`;

  const keyboard = {
    inline_keyboard: [
      [{ text: "📱 Mini Appda to'liq ko'rish", web_app: { url: appUrl } }],
      [{ text: "🔙 Profilga qaytish", callback_data: "view_profile" }]
    ]
  };

  return { text: statsText, keyboard };
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
    // Register bot menu commands asynchronously on first traffic
    registerBotCommandsOnce().catch(() => {});

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
      const { data: userRow } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
      const isBlocked = Boolean(userRow?.is_blocked || userRow?.onboarding?.is_blocked || userRow?.device_info?.is_blocked);
      if (isBlocked) {
        await answerCallbackQuery(cb.id, "⛔ Hisobingiz cheklangan");
        return res.status(200).json({ status: 'blocked' });
      }

      if (chatId && cb.message?.message_id && data) {
        // Log user callback interaction
        await logBotMessage(userId, {
          id: `cb_${chatId}_${cb.message.message_id}_${data}`,
          update_id: update.update_id,
          chat_id: chatId,
          message_id: cb.message.message_id,
          direction: 'user_to_bot',
          sender: 'user',
          type: 'callback_query',
          text: `🔘 Tugma bosildi: ${data}`,
          metadata: { callback_data: data },
          timestamp: new Date().toISOString()
        });

        if (data.startsWith('del_')) {
          const txId = data.replace('del_', '');
          const { data: u, error: fetchErr } = await supabase.from('users').select('transactions').eq('id', userId).maybeSingle();
          if (fetchErr) {
            await answerCallbackQuery(cb.id, "❌ Xatolik yuz berdi");
            return res.status(500).json({ error: 'DB_FETCH_FAILED' });
          }
          const txs = Array.isArray(u?.transactions) ? u.transactions : [];
          const updated = txs.filter((t: any) => String(t.id) !== String(txId));
          const { error: updateErr } = await supabase.from('users').update({ transactions: updated, updated_at: new Date().toISOString() }).eq('id', userId);
          if (updateErr) {
            await answerCallbackQuery(cb.id, "❌ O'chirishda xatolik yuz berdi");
            return res.status(500).json({ error: 'DB_UPDATE_FAILED' });
          }

          await answerCallbackQuery(cb.id, "🗑 Operatsiya o'chirildi!");
          await editTelegramMessage(chatId, cb.message.message_id, "🗑 <b>Operatsiya o'chirildi.</b> ✅", undefined, userId);
          return res.status(200).json({ status: 'ok' });
        }

        if (data === 'view_cards' || data === 'menu_cards') {
          const { text, keyboard } = await renderCardsMessage(userId);
          await editTelegramMessage(chatId, cb.message.message_id, text, keyboard, userId);
          await answerCallbackQuery(cb.id);
          return res.status(200).json({ status: 'ok' });
        }

        if (data === 'view_limit' || data === 'menu_limit') {
          const { text, keyboard } = await renderLimitMessage(userId);
          await editTelegramMessage(chatId, cb.message.message_id, text, keyboard, userId);
          await answerCallbackQuery(cb.id);
          return res.status(200).json({ status: 'ok' });
        }

        if (data === 'view_premium' || data === 'menu_premium') {
          const { text, keyboard } = await renderPremiumMessage(userId);
          await editTelegramMessage(chatId, cb.message.message_id, text, keyboard, userId);
          await answerCallbackQuery(cb.id);
          return res.status(200).json({ status: 'ok' });
        }

        if (data === 'view_profile' || data === 'menu_profile') {
          const { text, keyboard } = await renderProfileMessage(fromUser, userRow, userId);
          await editTelegramMessage(chatId, cb.message.message_id, text, keyboard, userId);
          await answerCallbackQuery(cb.id);
          return res.status(200).json({ status: 'ok' });
        }

        if (data === 'today_stats') {
          const { data: u } = await supabase.from('users').select('transactions').eq('id', userId).maybeSingle();
          const txs = Array.isArray(u?.transactions) ? u.transactions : [];

          const srv = getServerDateTimeContext();
          const todayStr = srv.currentDate;
          const [tY, tM, tD] = todayStr.split('-').map(Number);

          const todayTxs = txs.filter((t: any) => {
            if (t.date === todayStr) return true;
            if (t.day === tD && t.month === tM && t.year === tY) return true;
            if (t.date && typeof t.date === 'string' && t.date.startsWith(todayStr)) return true;
            return false;
          });

          let todayExpense = 0;
          let todayIncome = 0;
          let expenseCount = 0;

          for (const t of todayTxs) {
            const amt = Math.abs(Number(t.amount) || 0);
            if (t.type === 'income') {
              todayIncome += amt;
            } else {
              todayExpense += amt;
              expenseCount++;
            }
          }

          const netToday = todayIncome - todayExpense;
          const netSign = netToday >= 0 ? '+' : '';

          const reportText =
            `📊 <b>Bugungi Moliyaviy Hisobot (${todayStr})</b>\n\n` +
            `🔴 <b>Bugungi xarajatlar:</b> ${todayExpense.toLocaleString('uz-UZ').replace(/,/g, ' ')} so'm (${expenseCount} ta)\n` +
            `🟢 <b>Bugungi daromadlar:</b> ${todayIncome.toLocaleString('uz-UZ').replace(/,/g, ' ')} so'm\n` +
            `⚖️ <b>Kunlik qoldiq:</b> ${netSign}${netToday.toLocaleString('uz-UZ').replace(/,/g, ' ')} so'm\n\n` +
            `💡 <i>Barcha xarajatlar tahlili, toifalar taqsimoti va chiroyli grafiklar uchun Mini Appni oching!</i>`;

          const reportKeyboard = {
            inline_keyboard: [
              [{ text: "📱 Mini Appda to'liq ko'rish 🚀", web_app: { url: appUrl } }],
              [{ text: "💳 Kartalarim", callback_data: "menu_cards" }, { text: "📈 Oylik statistika", callback_data: "menu_stats" }]
            ]
          };

          await editTelegramMessage(chatId, cb.message.message_id, reportText, reportKeyboard, userId);
          await answerCallbackQuery(cb.id);
          return res.status(200).json({ status: 'ok' });
        }

        if (data === 'view_help' || data === 'menu_help') {
          const helpText =
            `💡 <b>Moliya AI Bot Yo'riqnomasi</b>\n\n` +
            `🤖 <b>Xarajat yoki daromad kiritish:</b>\n` +
            `• Matn yozing: <i>"taksiga 25000"</i> yoki <i>"14 mln oylik tushdi"</i>\n` +
            `• Ovozli xabar yuboring: Ovoz orqali ayting 🎙\n` +
            `• Chek rasmini yuboring: Xarid chekini skanerlang 📸\n\n` +
            `📊 <b>Menyu Tugmalari:</b>\n` +
            `• <b>📱 Mini App</b> — Ilovani to'liq ochish\n` +
            `• <b>👤 Profilim</b> — Hisob ma'lumotlari va tarif\n` +
            `• <b>💳 Kartalarim</b> — Bank kartalari balansi\n` +
            `• <b>📊 Oylik Limit</b> — Byudjet sarfi va nazorat\n` +
            `• <b>💎 Premium Pro</b> — VIP status va imkoniyatlar\n` +
            `• <b>📈 Statistika</b> — Oylik balans va xarajatlar`;
          await editTelegramMessage(chatId, cb.message.message_id, helpText, getMainAppKeyboard(appUrl), userId);
          await answerCallbackQuery(cb.id);
          return res.status(200).json({ status: 'ok' });
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
    const { user, userId, isBlocked, isRegistered } = await resolveCanonicalUser(fromUser);

    // ── Record Incoming User Activity (Idempotent by update_id & message_id) ──
    let userMsgType = 'text';
    let userMsgText = text;
    let userMsgMeta: any = {};

    if (text.startsWith('/')) {
      userMsgType = 'command';
    } else if (message.voice) {
      userMsgType = 'voice';
      userMsgMeta = { duration: message.voice.duration, file_id: message.voice.file_id };
      userMsgText = `🎙 Ovozli xabar (${message.voice.duration || 0}s)`;
    } else if (message.photo) {
      userMsgType = 'photo';
      userMsgMeta = { file_id: message.photo[message.photo.length - 1]?.file_id };
      userMsgText = message.caption ? `📸 Rasm: ${message.caption}` : '📸 Rasm';
    } else if (message.document) {
      userMsgType = 'document';
      userMsgMeta = { file_name: message.document.file_name, file_size: message.document.file_size, mime_type: message.document.mime_type, file_id: message.document.file_id };
      userMsgText = `📄 Hujjat: ${message.document.file_name || 'fayl'}`;
    } else if (message.audio) {
      userMsgType = 'audio';
      userMsgMeta = { duration: message.audio.duration, title: message.audio.title, file_id: message.audio.file_id };
      userMsgText = `🎵 Audio (${message.audio.duration || 0}s)`;
    } else if (message.video) {
      userMsgType = 'video';
      userMsgMeta = { duration: message.video.duration, file_id: message.video.file_id };
      userMsgText = `🎥 Video (${message.video.duration || 0}s)`;
    } else if (message.sticker) {
      userMsgType = 'sticker';
      userMsgMeta = { emoji: message.sticker.emoji, file_id: message.sticker.file_id };
      userMsgText = `Stiker ${message.sticker.emoji || ''}`;
    } else if (message.contact) {
      userMsgType = 'contact';
      userMsgMeta = { phone_number: message.contact.phone_number, first_name: message.contact.first_name };
      userMsgText = `📞 Kontakt: ${message.contact.phone_number}`;
    } else if (message.location) {
      userMsgType = 'location';
      userMsgMeta = { latitude: message.location.latitude, longitude: message.location.longitude };
      userMsgText = `📍 Joylashuv: ${message.location.latitude}, ${message.location.longitude}`;
    }

    // Persist incoming user message to onboarding.bot_messages (Awaited for serverless guarantee)
    await logBotMessage(userId, {
      id: `msg_${chatId}_${message.message_id}`,
      update_id: update.update_id,
      chat_id: chatId,
      message_id: message.message_id,
      direction: 'user_to_bot',
      sender: 'user',
      type: userMsgType,
      text: userMsgText,
      caption: message.caption,
      metadata: userMsgMeta,
      timestamp: new Date(message.date ? message.date * 1000 : Date.now()).toISOString()
    });

    if (isBlocked) {
      await sendTelegramMessage(
        chatId,
        `⛔ <b>Hisobingiz ma'muriyat tomonidan cheklangan!</b>\n\nSiz ushbu bot va Moliya AI tizimidan foydalana olmaysiz. Cheklovni bekor qilish uchun ma'muriyat bilan bog'laning.`,
        { remove_keyboard: true },
        userId
      );
      return res.status(200).json({ status: 'restricted' });
    }

    // ── Handle Contact Share (Phone Number Verification) ────────
    if (message.contact) {
      deleteTelegramMessage(chatId, message.message_id).catch(() => {});

      const contact = message.contact;
      const contactUserId = contact.user_id ? String(contact.user_id) : null;
      const senderTgId = String(fromUser.id);

      if (contactUserId && contactUserId !== senderTgId) {
        await sendTelegramMessage(
          chatId,
          `⚠️ <b>Faqat o'zingizning shaxsiy telefon raqamingizni yuboring.</b>\n\nIltimos, pastdagi tugmani bosing:`,
          {
            keyboard: [[{ text: "📞 Telefon raqamni yuborish", request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true
          },
          userId
        );
        return res.status(200).json({ status: 'invalid_contact' });
      }

      const rawPhone = contact.phone_number || '';
      const phone = rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}`;

      // Complete registration & grant 1-day trial
      await completePhoneRegistration(fromUser, phone);

      const successMsg =
        `🎉 <b>Tabriklaymiz, ${fromUser.first_name || 'foydalanuvchi'}!</b>\n\n` +
        `✅ <b>Telefon raqamingiz tasdiqlandi:</b> <code>${phone}</code>\n` +
        `💎 <b>Sizga 1 kunlik CHEKSIZ PREMIUM va AI sinov muddati taqdim etildi!</b>\n\n` +
        `Endi Moliya Mini App orqali xarajatlaringizni to'liq boshqarishingiz mumkin.\n\n` +
        `👇 <i>Pastdagi tugma orqali Mini Appni ochishingiz yoki to'g'ridan-to'g'ri xarajatlarni yozishingiz mumkin:</i>`;

      // Cleanly remove any physical reply keyboard
      await sendTelegramMessage(chatId, "✅ <i>Telefon raqamingiz qabul qilindi.</i>", { remove_keyboard: true }, userId);
      // Set clickable inline buttons permanently
      await sendTelegramMessage(chatId, successMsg, getMainAppKeyboard(appUrl), userId);
      return res.status(200).json({ status: 'ok' });
    }

    // ── Command: /start or 👤 Profile / 👤 Profil / 👤 Hisobim / /profile ──
    if (text.startsWith('/start') || text === '👤 Profile' || text === '👤 Profil' || text === '👤 Hisobim' || text.startsWith('/profile')) {
      // Only check login request if explicitly /start with an argument (e.g. /start req_xxxx)
      if (text.startsWith('/start') && text.trim().length > 6) {
        const rawArg = text.replace('/start', '').trim();
        const requestId = rawArg.replace('req_', '').trim();

        if (requestId && requestId.length >= 8 && !rawArg.includes(' ')) {
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
                [{ text: "📱 Moliya Mini App", web_app: { url: targetUrl } }]
              ]
            },
            userId
          );
          return res.status(200).json({ status: 'ok' });
        }
      }

      // Check if user is a NEW unverified user needing phone verification
      const hasPhone = Boolean(user?.phone || user?.onboarding?.phone);
      if (!hasPhone) {
        const phoneRequestText =
          `<b>Assalomu alaykum, ${fromUser.first_name || 'foydalanuvchi'}!</b> 👋✨\n\n` +
          `Men <b>Moliya AI</b> — shaxsiy moliyaviy yordamchingizman.\n\n` +
          `Botdan to'liq foydalanish va <b>1 kunlik CHEKSIZ PREMIUM</b> sinovini faollashtirish uchun pastdagi tugma orqali telefon raqamingizni tasdiqlang:`;

        await sendTelegramMessage(
          chatId,
          phoneRequestText,
          {
            keyboard: [[{ text: "📞 Telefon raqamni yuborish", request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true
          },
          userId
        );
        return res.status(200).json({ status: 'phone_requested' });
      }

      // If user tapped 👤 Profile, 👤 Profil, 👤 Hisobim or /profile
      if (text === '👤 Profile' || text === '👤 Profil' || text === '👤 Hisobim' || text.startsWith('/profile')) {
        const { text: profText, keyboard: profKeyboard } = await renderProfileMessage(fromUser, user, userId);
        await sendTelegramMessage(chatId, profText, profKeyboard, userId);
        return res.status(200).json({ status: 'ok' });
      }

      // Check user plan & trial for plain /start
      const quota = await checkAiQuota(userId);
      const planLabel = quota.isTrial
        ? '💎 1-Kunlik Cheksiz Premium Sinovi'
        : quota.isPremium
          ? '⭐ VIP Premium (Cheksiz)'
          : '🆓 Bepul Tarif';

      const quotaStatus = quota.limit === null
        ? '♾️ Cheksiz'
        : `${quota.usedCount} / ${quota.limit} (${quota.remaining} ta qoldi)`;

      const welcomeText =
        `<b>Assalomu alaykum, ${fromUser.first_name || 'foydalanuvchi'}!</b> 👋✨\n\n` +
        `Men <b>Moliya AI</b> — shaxsiy moliyaviy yordamchingizman.\n\n` +
        `👤 <b>Hisob:</b> <code>${user.phone || fromUser.first_name}</code>\n` +
        `🏷 <b>Tarif:</b> ${planLabel}\n` +
        `⚡ <b>Bugungi AI kvotasi:</b> ${quotaStatus}\n\n` +
        `💡 <b>Qanday ishlatish mumkin?</b>\n` +
        `• <b>Xarajat:</b> <i>"50 000 go'sht oldim"</i> yoki <i>"kecha taksiga 25000"</i>\n` +
        `• <b>Daromad:</b> <i>"14 mln maosh tushdi"</i>\n` +
        `• <b>Ovozli xabar:</b> Ovoz bilan xarajatni gapirib yuboring 🎙\n` +
        `• <b>Chek skaner:</b> Xarid cheki rasmini yuboring 📸\n\n` +
        `👇 <i>Quyidagi menyu tugmalaridan foydalaning:</i>`;

      // 1. Permanently remove any legacy physical reply keyboard from Telegram client
      await sendTelegramMessage(
        chatId,
        "✨ <b>Moliya AI tizimiga xush kelibsiz!</b>",
        { remove_keyboard: true },
        userId
      );

      // 2. Send main interactive menu card with pure inline link buttons
      await sendTelegramMessage(chatId, welcomeText, getMainAppKeyboard(appUrl), userId);
      return res.status(200).json({ status: 'ok' });
    }

    // ── Command: 💳 Cards / 💳 Kartalar / /cards / /kartalar ──────
    if (text === '💳 Cards' || text === '💳 Kartalar' || text.startsWith('/cards') || text.startsWith('/kartalar')) {
      if (text === '💳 Cards' || text === '💳 Kartalar') {
        await sendTelegramMessage(chatId, "💳 <b>Kartalar</b>", { remove_keyboard: true }, userId);
      }
      const { text: cardsText, keyboard: cardsKeyboard } = await renderCardsMessage(userId);
      await sendTelegramMessage(chatId, cardsText, cardsKeyboard, userId);
      return res.status(200).json({ status: 'ok' });
    }

    // ── Command: 📊 Monthly Limit / 📊 Oylik Limit / /limit ───────
    if (text === '📊 Monthly Limit' || text === '📊 Oylik Limit' || text.startsWith('/limit')) {
      if (text === '📊 Monthly Limit' || text === '📊 Oylik Limit') {
        await sendTelegramMessage(chatId, "📊 <b>Oylik Limit</b>", { remove_keyboard: true }, userId);
      }
      const arg = text.replace('/limit', '').trim();
      const { text: limitText, keyboard: limitKeyboard } = await renderLimitMessage(userId, arg || undefined);
      await sendTelegramMessage(chatId, limitText, limitKeyboard, userId);
      return res.status(200).json({ status: 'ok' });
    }

    // ── Command: ⭐ Premium / /premium / /vip ─────────────────────
    if (text === '⭐ Premium' || text.startsWith('/premium') || text.startsWith('/vip')) {
      if (text === '⭐ Premium') {
        await sendTelegramMessage(chatId, "⭐ <b>VIP Premium</b>", { remove_keyboard: true }, userId);
      }
      const { text: premText, keyboard: premKeyboard } = await renderPremiumMessage(userId);
      await sendTelegramMessage(chatId, premText, premKeyboard, userId);
      return res.status(200).json({ status: 'ok' });
    }

    // ── Command: /app or 🚀 Moliya or 📱 Mini App ─────────────────
    if (text.startsWith('/app') || text === '🚀 Moliya' || text === '📱 Mini App') {
      const appText = `🚀 <b>Moliya Telegram Mini App</b>\n\nBarcha hisob-kitoblar, kartalar, oylik limit, grafiklar va tahlillar bir joyda! 👇`;
      const appKeyboard = {
        inline_keyboard: [
          [{ text: "📱 Moliya Mini Appni ochish", web_app: { url: appUrl } }]
        ]
      };
      await sendTelegramMessage(chatId, appText, appKeyboard, userId);
      return res.status(200).json({ status: 'ok' });
    }

    // ── Command: /help or /yordam or ❓ Help / ❓ Yordam ───────────
    if (text.startsWith('/help') || text.startsWith('/yordam') || text === '❓ Help' || text === '❓ Yordam') {
      const helpText =
        `ℹ️ <b>Moliya AI Botdan foydalanish yo'riqnomasi</b>\n\n` +
        `📝 <b>1. Oddiy matn bilan kiritish:</b>\n` +
        `Xarajatingiz yoki daromadingizni tabiiy tilda yozing:\n` +
        `• <i>"14 mln maosh tushdi"</i>\n` +
        `• <i>"taksiga 25000 so'm"</i>\n` +
        `• <i>"kecha obedga 45 ming sarfladim"</i>\n` +
        `• <i>"3 kun oldin 120 000 ga dori oldim"</i>\n` +
        `• <i>"25 avgust kuni 2.5 mln qarz qaytardim"</i>\n\n` +
        `🎙 <b>2. Ovozli xabar:</b>\n` +
        `Ovozli xabar yuboring — AI uni matnga o'giradi, sanasini aniqlaydi va bazaga saqlaydi.\n\n` +
        `📸 <b>3. Chek rasmi:</b>\n` +
        `Xarid chekini rasmga olib yuborsangiz, AI do'kon nomi, jami summa va sanani avtomatik o'qiydi.\n\n` +
        `💎 <b>4. AI Limitlari va Premium:</b>\n` +
        `• Bepul tarif: <b>kuniga 5 ta AI so'rovi</b>\n` +
        `• Cheksiz AI so'rovlar uchun <b>VIP Premium</b> oling.\n\n` +
        `📊 <b>Menyu Tugmalari:</b>\n` +
        `• <b>📱 Mini App</b> — Ilovani to'liq ochish\n` +
        `• <b>👤 Profilim</b> — Hisob ma'lumotlari va tarif\n` +
        `• <b>💳 Kartalarim</b> — Bank kartalari balansi\n` +
        `• <b>📊 Oylik Limit</b> — Byudjet sarfi va nazorat\n` +
        `• <b>💎 Premium Pro</b> — VIP status va imkoniyatlar\n` +
        `• <b>📈 Statistika</b> — Oylik balans va xarajatlar`;

      await sendTelegramMessage(chatId, helpText, getMainAppKeyboard(appUrl), userId);
      return res.status(200).json({ status: 'ok' });
    }

    // ── Command: /stats or /hisobot or 📈 Stats / 📈 Statistika ────
    if (text.startsWith('/stats') || text.startsWith('/hisobot') || text === '📈 Stats' || text === '📈 Statistika') {
      deleteTelegramMessage(chatId, message.message_id).catch(() => {});
      const { text: statsText, keyboard: statsKeyboard } = await renderStatsMessage(userId);
      await sendOrEditMenuMessage(chatId, userId, statsText, statsKeyboard);
      return res.status(200).json({ status: 'ok' });
    }

    // ── Voice Message (Audio Parsing) ───────────────────────────
    if (message.voice) {
      const quota = await checkAiQuota(userId);
      if (!quota.allowed) {
        const quotaNotice =
          `⚠️ <b>Bugungi bepul AI limitingiz tugadi!</b>\n\n` +
          `📝 <i>Xarajat va daromadlarni <b>Moliya Mini App</b> orqali qo'lda kiritish mutlaqo bepul va cheksiz!</i>\n\n` +
          `⭐ Cheksiz AI ovozli va chek tahlili uchun <b>VIP Premium</b> tarifiga o'tishingiz mumkin.`;

        await sendTelegramMessage(chatId, quotaNotice, {
          inline_keyboard: [
            [{ text: "📱 Mini App (Qo'lda kiritish)", web_app: { url: appUrl } }],
            [{ text: "⭐ VIP Premium olish", callback_data: "view_premium" }]
          ]
        }, userId);
        return res.status(200).json({ status: 'quota_exceeded' });
      }

      sendChatAction(chatId, 'record_voice').catch(() => {});
      const statusMsg = await sendTelegramMessage(
        chatId,
        `🎙️ <b>Ovozli xabar qabul qilindi...</b>\n⏳ <i>Ovoz yuklab olinmoqda</i>`,
        undefined,
        userId
      );
      const statusMsgId = statusMsg?.result?.message_id;

      const fileUrl = await getTelegramFileUrl(message.voice.file_id);
      if (fileUrl) {
        try {
          const audioRes = await fetch(fileUrl);
          const arrayBuffer = await audioRes.arrayBuffer();
          const base64Audio = Buffer.from(arrayBuffer).toString('base64');

          const candidateKeys = await getCandidateAiKeys();
          const envKey = process.env.GEMINI_API_KEY;
          const keysToTry = candidateKeys.length > 0
            ? candidateKeys
            : (envKey ? [{ id: 'env_gemini', api_key: envKey, name: 'ENV Key', model: 'gemini-3.5-flash-lite' }] : []);

          const activeModels = ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.5-flash'];

          for (const keyObj of keysToTry) {
            const rawApiKey = (keyObj.api_key || '').trim();
            if (!rawApiKey) continue;

            let primary = keyObj.model || 'gemini-3.5-flash-lite';
            if (primary === 'gemini-flash-latest' || primary.includes('2.0-flash') || primary.includes('3.1-flash')) {
              primary = 'gemini-3.5-flash-lite';
            }
            const modelsToTry = [...new Set([primary, ...activeModels])];

            let parsed: any = null;
            const srvCtx = getServerDateTimeContext();
            for (const modelToUse of modelsToTry) {
              try {
                const ai = new GoogleGenAI({ apiKey: rawApiKey });
                const prompt = `Listen to this financial audio in Uzbek/Russian and extract into JSON:
{"type":"expense"|"income"|"debt"|"lending","amount":number,"category":string,"title":string,"note":string,"date":"YYYY-MM-DD","debtWho":string}
CRITICAL RULES:
- Default type is "expense".
- Spending money (taksi, ovqat, to'ladim, ketdi, sarfladim, xarid, bozorlik) is ALWAYS "expense".
- Only mark type="income" if words clearly indicate receiving money (maosh, oylik, daromad, stipendiya, tushdi, berishdi, topdim).
Today: ${srvCtx.currentDate}.`;

                let timer: any;
                const timeoutPromise = new Promise((_, reject) => {
                  timer = setTimeout(() => reject(new Error('AI_TIMEOUT')), 3500);
                });

                const audioPromise = ai.models.generateContent({
                  model: modelToUse,
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
                    responseMimeType: "application/json",
                    maxOutputTokens: 200,
                    temperature: 0.1
                  }
                });

                const audioResult: any = await Promise.race([audioPromise, timeoutPromise]);
                clearTimeout(timer);

                if (audioResult.text) {
                  const resJson = JSON.parse(audioResult.text);
                  const validated = validateAiFinancialOutput(resJson, { originalText: 'Voice note', normalizedText: 'Voice note' }, srvCtx.currentDate);
                  if (validated.isValid && validated.amount > 0) {
                    parsed = validated;
                    recordKeyResult(keyObj.id, true).catch(() => {});
                    break;
                  }
                }
              } catch (voiceErr: any) {
                recordKeyResult(keyObj.id, false, voiceErr?.message, 'temporary').catch(() => {});
                break;
              }
            }

            if (parsed) {
              // Safeguard against false-positive income classifications for common expenses
              const incomeKeywords = /\b(maosh|oylik|daromad|avans|stipendiya|tushdi|keldi|ish haqi|berishdi|topdim)\b/i;
              const isKnownExpenseCat = ['Transport', 'Oziq-ovqat', 'Kiyim', 'Kommunal', 'Sog\'liq', 'Ta\'lim'].includes(parsed.category);
              if (parsed.type === 'income' && (isKnownExpenseCat || !incomeKeywords.test(`${parsed.title || ''} ${parsed.note || ''}`))) {
                parsed.type = 'expense';
              }

              const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
              const safeD = parseSafeDate(parsed.date);
              const rawAmt = Math.abs(Number(parsed.amount) || 0);
              const isIncome = parsed.type === 'income';
              const signedAmount = isIncome ? rawAmt : -rawAmt;

              const newTx = {
                id: txId,
                type: parsed.type || 'expense',
                name: parsed.title || parsed.note || 'Ovozli xarajat',
                title: parsed.title || parsed.note || 'Ovozli xarajat',
                category: parsed.category || 'Boshqa',
                amount: signedAmount,
                date: safeD.date,
                day: safeD.day,
                month: safeD.month,
                year: safeD.year,
                time: safeD.time,
                note: parsed.note || 'Ovozli kiritilgan',
                debtWho: parsed.debtWho || ''
              };

              try {
                if (statusMsgId) {
                  await editTelegramMessage(
                    chatId,
                    statusMsgId,
                    `💾 <b>Ma'lumotlar saqlanmoqda...</b>\n📊 <i>Balansingiz yangilanmoqda</i>`,
                    undefined,
                    userId
                  );
                }

                await saveBotTransaction(userId, newTx);
                await recordAiUsage(userId, 'text', parsed.note || 'Voice expense', quota.isPremium);

                const isInc = newTx.type === 'income';
                const successCard = buildTransactionSuccessCard(newTx, isInc, txId);

                if (statusMsgId) {
                  await editTelegramMessage(chatId, statusMsgId, successCard.text, successCard.keyboard, userId, 'ai_response');
                } else {
                  await sendTelegramMessage(chatId, successCard.text, successCard.keyboard, userId, 'ai_response');
                }
                return res.status(200).json({ status: 'ok' });
              } catch (saveErr) {
                console.error('[BOT] Error saving voice transaction to Supabase:', saveErr);
                if (statusMsgId) {
                  await editTelegramMessage(chatId, statusMsgId, "❌ Xatolik: Ovozli xarajatni saqlab bo'lmadi. Iltimos, qayta urinib ko'ring.", undefined, userId);
                } else {
                  await sendTelegramMessage(chatId, "❌ Xatolik: Ovozli xarajatni saqlab bo'lmadi. Iltimos, qayta urinib ko'ring.", undefined, userId);
                }
                return res.status(500).json({ error: 'DB_SAVE_FAILED' });
              }
            }
          }
        } catch (voiceErr) {
          console.error('[BOT] Voice parsing error:', voiceErr);
        }
      }

      const unparsedMsg = `🎙 <b>Ovozli xabar tahlil qilindi, lekin summa aniqlanmadi.</b>\n\nIltimos, xarajat summasi bilan aniqroq gapiring (masalan: <i>"taksiga 30 ming"</i>) yoki matn orqali yozing.`;
      const unparsedKb = {
        inline_keyboard: [
          [{ text: "📱 Moliya Mini Appni ochish", web_app: { url: appUrl } }]
        ]
      };
      if (statusMsgId) {
        await editTelegramMessage(chatId, statusMsgId, unparsedMsg, unparsedKb, userId);
      } else {
        await sendTelegramMessage(chatId, unparsedMsg, unparsedKb, userId);
      }
      return res.status(200).json({ status: 'ok' });
    }

    // ── Photo Message (Receipt OCR Scanning) ────────────────────
    if (message.photo && message.photo.length > 0) {
      const quota = await checkAiQuota(userId);
      if (!quota.allowed) {
        const quotaNotice =
          `⚠️ <b>Bugungi bepul AI chek skanerlash limitingiz tugadi!</b>\n\n` +
          `📝 <i>Xarajatlarni <b>Moliya Mini App</b> orqali qo'lda kiritish mutlaqo bepul va cheksiz!</i>\n\n` +
          `⭐ Cheksiz AI chek va ovozli tahlil uchun <b>VIP Premium</b> tarifiga o'tishingiz mumkin.`;

        await sendTelegramMessage(chatId, quotaNotice, {
          inline_keyboard: [
            [{ text: "📱 Mini App (Qo'lda kiritish)", web_app: { url: appUrl } }],
            [{ text: "⭐ VIP Premium olish", callback_data: "view_premium" }]
          ]
        }, userId);
        return res.status(200).json({ status: 'quota_exceeded' });
      }

      sendChatAction(chatId, 'upload_photo').catch(() => {});
      const statusMsg = await sendTelegramMessage(
        chatId,
        `📸 <b>Chek qabul qilindi...</b>\n🔍 <i>Chek matni skanerlanmoqda (OCR)...</i>`,
        undefined,
        userId
      );
      const statusMsgId = statusMsg?.result?.message_id;

      const photo = message.photo[message.photo.length - 1];
      const fileUrl = await getTelegramFileUrl(photo.file_id);
      if (fileUrl) {
        try {
          const imgRes = await fetch(fileUrl);
          const arrayBuffer = await imgRes.arrayBuffer();
          const base64Img = Buffer.from(arrayBuffer).toString('base64');

          if (statusMsgId) {
            await editTelegramMessage(
              chatId,
              statusMsgId,
              `🧠 <b>AI tahlil qilmoqda...</b>\n⚡ <i>Jami summa va mahsulotlar hisoblanmoqda</i>`,
              undefined,
              userId
            );
          }

          const candidateKeys = await getCandidateAiKeys();
          const envKey = process.env.GEMINI_API_KEY;
          const keysToTry = candidateKeys.length > 0
            ? candidateKeys
            : (envKey ? [{ id: 'env_gemini', api_key: envKey, name: 'ENV Key', model: 'gemini-3.5-flash-lite' }] : []);

          const activeModels = ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.5-flash'];

          for (const keyObj of keysToTry) {
            const rawApiKey = (keyObj.api_key || '').trim();
            if (!rawApiKey) continue;

            let primary = keyObj.model || 'gemini-3.5-flash-lite';
            if (primary === 'gemini-flash-latest' || primary.includes('2.0-flash') || primary.includes('3.1-flash')) {
              primary = 'gemini-3.5-flash-lite';
            }
            const modelsToTry = [...new Set([primary, ...activeModels])];

            let parsed: any = null;
            for (const modelToUse of modelsToTry) {
              try {
                const ai = new GoogleGenAI({ apiKey: rawApiKey });
                const prompt = `You are an OCR receipt scanner for Moliya AI. Extract receipt info into JSON:
- type: 'expense'
- amount: total integer amount paid in UZS
- category: choose best fit from ['Oziq-ovqat', 'Transport', 'Kiyim', 'Kommunal', 'Sog\\'liq', 'Ko\\'ngil ochar', 'Boshqa']
- note: store or merchant name and summary
- title: merchant name`;

                let timer: any;
                const timeoutPromise = new Promise((_, reject) => {
                  timer = setTimeout(() => reject(new Error('AI_TIMEOUT')), 3500);
                });

                const imgPromise = ai.models.generateContent({
                  model: modelToUse,
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
                    responseMimeType: "application/json",
                    maxOutputTokens: 200,
                    temperature: 0.1
                  }
                });

                const imgResult: any = await Promise.race([imgPromise, timeoutPromise]);
                clearTimeout(timer);

                if (imgResult.text) {
                  const resJson = JSON.parse(imgResult.text);
                  if (resJson.amount && Number(resJson.amount) > 0) {
                    parsed = resJson;
                    recordKeyResult(keyObj.id, true).catch(() => {});
                    break;
                  }
                }
              } catch (imgErr: any) {
                recordKeyResult(keyObj.id, false, imgErr?.message, 'temporary').catch(() => {});
                break;
              }
            }

            if (parsed) {
              const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
              const safeD = parseSafeDate(parsed.date);
              const newTx = {
                id: txId,
                type: 'expense',
                name: parsed.title || parsed.note || 'Chek xarajati',
                title: parsed.title || parsed.note || 'Chek xarajati',
                category: parsed.category || 'Oziq-ovqat',
                amount: Number(parsed.amount),
                date: safeD.date,
                day: safeD.day,
                month: safeD.month,
                year: safeD.year,
                time: safeD.time,
                note: parsed.note || 'Chekdan kiritilgan',
                debtWho: ''
              };

              try {
                if (statusMsgId) {
                  await editTelegramMessage(
                    chatId,
                    statusMsgId,
                    `💾 <b>Ma'lumotlar saqlanmoqda...</b>\n📊 <i>Balansingiz yangilanmoqda</i>`,
                    undefined,
                    userId
                  );
                }

                await saveBotTransaction(userId, newTx);
                await recordAiUsage(userId, 'receipt', parsed.note || 'Receipt scan', quota.isPremium);

                const successCard = buildTransactionSuccessCard(newTx, false, txId);

                if (statusMsgId) {
                  await editTelegramMessage(chatId, statusMsgId, successCard.text, successCard.keyboard, userId, 'ai_response');
                } else {
                  await sendTelegramMessage(chatId, successCard.text, successCard.keyboard, userId, 'ai_response');
                }
                return res.status(200).json({ status: 'ok' });
              } catch (saveErr) {
                console.error('[BOT] Error saving receipt transaction to Supabase:', saveErr);
                await sendTelegramMessage(chatId, "❌ Xatolik: Chek xarajatini saqlab bo'lmadi. Iltimos, qayta urinib ko'ring.", undefined, userId);
                return res.status(500).json({ error: 'DB_SAVE_FAILED' });
              }
            }
          }
        } catch (imgErr) {
          console.error('[BOT] Receipt parsing error:', imgErr);
        }
      }

      await sendTelegramMessage(
        chatId,
        `📸 <b>Rasm qabul qilindi.</b>\n\nAgar bu xarid cheki bo'lsa, iltimos, summasi va do'kon nomi aniq ko'rinadigan qilib qayta yuboring yoki xarajatni matn orqali yozing.`,
        {
          inline_keyboard: [
            [{ text: "📱 Moliya Mini App", web_app: { url: appUrl } }]
          ]
        },
        userId
      );
      return res.status(200).json({ status: 'ok' });
    }

    // ── Document Message ────────────────────────────────────────
    if (message.document) {
      await sendTelegramMessage(
        chatId,
        `📄 <b>Hujjat qabul qilindi:</b> <code>${message.document.file_name || 'fayl'}</code>\n\n` +
        `Moliya AI orqali xarajat yoki daromadlarni hisobga olish uchun matn (masalan: <i>"taksiga 25000"</i>) yoki chek rasmini yuboring.`,
        {
          inline_keyboard: [
            [{ text: "📱 Moliya Mini App", web_app: { url: appUrl } }]
          ]
        },
        userId
      );
      return res.status(200).json({ status: 'ok' });
    }

    // ── Audio Message (Non-voice) ───────────────────────────────
    if (message.audio) {
      await sendTelegramMessage(
        chatId,
        `🎵 <b>Audio qabul qilindi.</b>\n\nOvozli xarajat kiritish uchun ovozli xabar (voice message) yuborishingiz mumkin 🎙`,
        {
          inline_keyboard: [
            [{ text: "📱 Moliya Mini App", web_app: { url: appUrl } }]
          ]
        },
        userId
      );
      return res.status(200).json({ status: 'ok' });
    }

    // ── Video Message ───────────────────────────────────────────
    if (message.video) {
      await sendTelegramMessage(
        chatId,
        `🎥 <b>Video qabul qilindi.</b>\n\nXarajatlarni kiritish uchun matn yoki ovozli xabar yuborishingiz mumkin.`,
        {
          inline_keyboard: [
            [{ text: "📱 Moliya Mini App", web_app: { url: appUrl } }]
          ]
        },
        userId
      );
      return res.status(200).json({ status: 'ok' });
    }

    // ── Sticker Message ─────────────────────────────────────────
    if (message.sticker) {
      await sendTelegramMessage(
        chatId,
        `😊 <b>Assalomu alaykum!</b>\n\nMoliya AI botiga xush kelibsiz. Xarajatlaringizni yozib boring:\n<i>"50 ming tushlik"</i> yoki ovozli xabar yuboring 🎙`,
        {
          inline_keyboard: [
            [{ text: "🚀 Moliya Mini App", web_app: { url: appUrl } }]
          ]
        },
        userId
      );
      return res.status(200).json({ status: 'ok' });
    }

    // ── Location Message ────────────────────────────────────────
    if (message.location) {
      await sendTelegramMessage(
        chatId,
        `📍 <b>Joylashuv qabul qilindi.</b>\n\nXarajatlaringizni to'liq nazorat qilish uchun pastdagi Mini Appni oching:`,
        {
          inline_keyboard: [
            [{ text: "📱 Moliya Mini App", web_app: { url: appUrl } }]
          ]
        },
        userId
      );
      return res.status(200).json({ status: 'ok' });
    }

    // ── Natural Language Text (Expense, Income, or General Questions) ──
    if (text && !text.startsWith('/')) {
      const quota = await checkAiQuota(userId);
      if (!quota.allowed) {
        const quotaNotice =
          `⚠️ <b>Bugungi bepul AI limitingiz tugadi!</b>\n\n` +
          `📝 <i>Xarajat va daromadlarni <b>Moliya Mini App</b> orqali qo'lda kiritish mutlaqo bepul va cheksiz!</i>\n\n` +
          `⭐ Cheksiz AI tahlil va ovozli kiritish uchun <b>VIP Premium</b> tarifiga o'tishingiz mumkin.`;

        await sendTelegramMessage(chatId, quotaNotice, {
          inline_keyboard: [
            [{ text: "📱 Mini App (Qo'lda kiritish)", web_app: { url: appUrl } }],
            [{ text: "⭐ VIP Premium olish", callback_data: "view_premium" }]
          ]
        }, userId);
        return res.status(200).json({ status: 'quota_exceeded' });
      }

      sendChatAction(chatId, 'typing').catch(() => {});
      const parsed = await parseTextWithAi(text);

      // 1. Intent: query_finances (e.g. "balansim qancha?", "oylik xarajatim qancha bo'ldi?")
      if (parsed?.intent === 'query_finances') {
        const { text: statsText, keyboard: statsKeyboard } = await renderStatsMessage(userId);
        await sendTelegramMessage(chatId, statsText, statsKeyboard, userId, 'bot_response');
        return res.status(200).json({ status: 'ok' });
      }

      // 2. Intent: general_question
      if (parsed?.intent === 'general_question') {
        await sendTelegramMessage(
          chatId,
          `💡 <b>Moliya AI yordamchisi</b>\n\n` +
          `Men daromad va xarajatlaringizni avtomatik hisoblab boraman.\n\n` +
          `📝 <b>Qanday ishlatish mumkin?</b>\n` +
          `• <b>Xarajat:</b> <i>"taksiga 25000"</i> yoki <i>"50 000 bozorlik"</i>\n` +
          `• <b>Daromad:</b> <i>"14 mln maosh tushdi"</i>\n` +
          `• <b>Ko'p operatsiya:</b> <i>"50k taksiga va 120 ming bozorlikka"</i>\n` +
          `• <b>Ovozli xabar:</b> Ovoz bilan aytib yuboring 🎙\n` +
          `• <b>Chek:</b> Xarid cheki rasmini yuboring 📸\n\n` +
          `👇 <i>Barcha hisobotlar va tahlillar uchun Mini Appni oching:</i>`,
          {
            inline_keyboard: [
              [{ text: "📱 Moliya Mini Appni ochish", web_app: { url: appUrl } }],
              [{ text: "👤 Profilim", callback_data: "menu_profile" }, { text: "💳 Kartalarim", callback_data: "menu_cards" }]
            ]
          },
          userId,
          'bot_response'
        );
        return res.status(200).json({ status: 'ok' });
      }

      // 3. Multi-Transaction (e.g. "50k taksiga va 120 ming bozorlikka")
      if (parsed?.transactions && parsed.transactions.length > 1) {
        try {
          const savedTxs = await saveBotTransactions(userId, parsed.transactions);
          await recordAiUsage(userId, 'text', text, quota.isPremium);

          const multiCard = buildMultiTransactionSuccessCard(savedTxs);
          await sendTelegramMessage(chatId, multiCard.text, multiCard.keyboard, userId, 'ai_response');
          return res.status(200).json({ status: 'ok' });
        } catch (saveErr) {
          console.error('[BOT] Error saving multi-transactions to Supabase:', saveErr);
          await sendTelegramMessage(chatId, "❌ Xatolik: Operatsiyalarni saqlab bo'lmadi. Iltimos, qayta urinib ko'ring.", undefined, userId);
          return res.status(500).json({ error: 'DB_SAVE_FAILED' });
        }
      }

      // 4. Single Transaction
      if (parsed && ((parsed.amount && Number(parsed.amount) > 0) || (parsed.transactions && parsed.transactions.length === 1))) {
        const txObj = parsed.transactions?.[0] || parsed;
        const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const safeD = parseSafeDate(txObj.date);
        const newTx = {
          id: txId,
          type: txObj.type || 'expense',
          name: (txObj as any).name || txObj.description || text,
          title: (txObj as any).title || txObj.description || (txObj as any).name || text,
          category: txObj.category || 'Boshqa',
          amount: Number(txObj.amount),
          date: safeD.date,
          day: safeD.day,
          month: safeD.month,
          year: safeD.year,
          time: safeD.time,
          note: (txObj as any).note || txObj.description || text,
          debtWho: (txObj as any).debtWho || txObj.counterparty || ''
        };

        try {
          await saveBotTransaction(userId, newTx);
          await recordAiUsage(userId, 'text', text, quota.isPremium);

          const isInc = newTx.type === 'income';
          const successCard = buildTransactionSuccessCard(newTx, isInc, txId);

          await sendTelegramMessage(chatId, successCard.text, successCard.keyboard, userId, 'ai_response');
          return res.status(200).json({ status: 'ok' });
        } catch (saveErr) {
          console.error('[BOT] Error saving text transaction to Supabase:', saveErr);
          await sendTelegramMessage(chatId, "❌ Xatolik: Operatsiyani saqlab bo'lmadi. Iltimos, qayta urinib ko'ring.", undefined, userId);
          return res.status(500).json({ error: 'DB_SAVE_FAILED' });
        }
      } else {
        // Helpful response for general questions, greetings, and guidance
        await sendTelegramMessage(
          chatId,
          `💡 <b>Moliya AI yordamchisi</b>\n\n` +
          `Men daromad va xarajatlaringizni avtomatik hisoblab boraman.\n\n` +
          `📝 <b>Qanday ishlatish mumkin?</b>\n` +
          `• <b>Xarajat:</b> <i>"taksiga 25000"</i> yoki <i>"50 000 bozorlik"</i>\n` +
          `• <b>Daromad:</b> <i>"14 mln maosh tushdi"</i>\n` +
          `• <b>Ko'p operatsiya:</b> <i>"50k taksiga va 120 ming bozorlikka"</i>\n` +
          `• <b>Ovozli xabar:</b> Ovoz bilan aytib yuboring 🎙\n` +
          `• <b>Chek:</b> Xarid cheki rasmini yuboring 📸\n\n` +
          `👇 <i>Barcha hisobotlar va tahlillar uchun Mini Appni oching:</i>`,
          {
            inline_keyboard: [
              [{ text: "📱 Moliya Mini Appni ochish", web_app: { url: appUrl } }],
              [{ text: "👤 Profilim", callback_data: "menu_profile" }, { text: "💳 Kartalarim", callback_data: "menu_cards" }]
            ]
          },
          userId,
          'bot_response'
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
