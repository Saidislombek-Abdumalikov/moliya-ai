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
  parseSafeDate
} from './_uzbekFinancialNormalizer.js';

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
  try {
    const { data: u } = await supabase.from('users').select('onboarding').eq('id', userId).maybeSingle();
    const lastMsgId = u?.onboarding?.last_temp_msg_id;

    if (lastMsgId) {
      const editRes = await editTelegramMessage(chatId, lastMsgId, text, keyboard);
      if (editRes && editRes.ok) {
        return editRes;
      }
      // If edit failed (e.g. message deleted or expired), delete reference
      deleteTelegramMessage(chatId, lastMsgId).catch(() => {});
    }

    const sent = await sendTelegramMessage(chatId, text, keyboard);
    if (sent?.result?.message_id) {
      await setLastTempMsgId(userId, sent.result.message_id);
    }
    return sent;
  } catch (err) {
    console.error('[BOT] sendOrEditMenuMessage error:', err);
    return await sendTelegramMessage(chatId, text, keyboard);
  }
}

function getMainAppKeyboard(appUrl: string) {
  return {
    keyboard: [
      [
        { text: "🚀 Moliya", web_app: { url: appUrl } },
        { text: "👤 Profile" }
      ],
      [
        { text: "💳 Cards" },
        { text: "📊 Monthly Limit" }
      ],
      [
        { text: "⭐ Premium" },
        { text: "📈 Stats" }
      ],
      [
        { text: "❓ Help" }
      ]
    ],
    resize_keyboard: true,
    is_persistent: true
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

    // Check if registered (has verified phone AND completed registration)
    const isRegistered = Boolean(
      (existing.phone && String(existing.phone).trim() !== '' && existing.phone !== '—') &&
      (existing.registration_status === 'completed' || existing.onboarding?.registration_status === 'completed')
    );

    return { user: existing, userId, isBlocked: false, isRegistered, isNew: false };
  }

  // 3. User was deleted or is first-time visitor -> Create clean unverified skeleton
  const newOnboarding = {
    completed: false,
    language: 'uz',
    name: fullName,
    telegram: username,
    telegramId: tgId,
    registration_status: 'pending_phone'
  };

  const newPayload = {
    id: userId,
    name: fullName,
    telegram: username,
    telegram_id: tgId,
    phone: null,
    language: 'uz',
    is_premium: false,
    ai_limit: 5,
    ai_query_count: 0,
    platform: 'telegram',
    cards: [],
    transactions: [],
    onboarding: newOnboarding,
    created_at: now,
    updated_at: now
  };

  const { error: upErr } = await supabase.from('users').upsert(newPayload, { onConflict: 'id' });
  if (upErr) {
    console.error('[BOT] Error creating initial user record:', upErr.message);
  }

  return { user: newPayload, userId, isBlocked: false, isRegistered: false, isNew: true };
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

async function parseTextWithAi(text: string) {
  // Pre-process and normalize Uzbek abbreviations & multipliers (e.g. 14 mln, 50k, 2 yarim mln)
  const normalized = normalizeUzbekFinancialText(text);

  const candidateKeys = await getCandidateAiKeys();
  const envKey = process.env.GEMINI_API_KEY;
  const keysToTry = candidateKeys.length > 0
    ? candidateKeys
    : (envKey ? [{ id: 'env_gemini', api_key: envKey, name: 'ENV Key', model: 'gemini-3.5-flash' }] : []);

  if (keysToTry.length === 0) {
    return null;
  }

  const prompt = buildUzbekFinancialAiPrompt(normalized.normalizedText);
  const activeModels = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest'];

  for (const keyObj of keysToTry) {
    const rawApiKey = (keyObj.api_key || '').trim();
    if (!rawApiKey) continue;

    for (const modelToUse of activeModels) {
      try {
        const ai = new GoogleGenAI({ apiKey: rawApiKey });
        const response = await ai.models.generateContent({
          model: modelToUse,
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
                title: { type: Type.STRING },
                date: { type: Type.STRING },
                debtWho: { type: Type.STRING }
              },
              required: ["type", "amount", "category", "note"]
            }
          }
        });

        if (response?.text) {
          const rawParsed = JSON.parse(response.text);
          const validated = validateAiFinancialOutput(rawParsed, normalized);
          if (validated.isValid) {
            recordKeyResult(keyObj.id, true).catch(() => {});
            return validated;
          }
        }
      } catch (e: any) {
        recordKeyResult(keyObj.id, false, e?.message, 'temporary').catch(() => {});
        console.warn(`[BOT] Gemini parse error with key on ${modelToUse}, trying next...`, e?.message);
      }
    }
  }

  // Fallback to purely normalized extraction if AI network fails
  if (normalized.extractedAmount && normalized.extractedAmount > 0) {
    return {
      isValid: true,
      type: normalized.inferredType || 'expense',
      amount: normalized.extractedAmount,
      category: normalized.inferredCategory || 'Boshqa',
      name: normalized.originalText.slice(0, 80),
      note: normalized.originalText,
      date: getServerDateTimeContext().currentDate,
      debtWho: ''
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
    const amt = Number(t.amount || 0);
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
        if (data.startsWith('del_')) {
          const txId = data.replace('del_', '');
          const { data: u } = await supabase.from('users').select('transactions').eq('id', userId).maybeSingle();
          const txs = Array.isArray(u?.transactions) ? u.transactions : [];
          const updated = txs.filter((t: any) => String(t.id) !== String(txId));
          await supabase.from('users').update({ transactions: updated, updated_at: new Date().toISOString() }).eq('id', userId);

          await answerCallbackQuery(cb.id, "🗑 Operatsiya o'chirildi!");
          await editTelegramMessage(chatId, cb.message.message_id, "🗑 <b>Operatsiya o'chirildi.</b> ✅");
          return res.status(200).json({ status: 'ok' });
        }

        if (data === 'view_cards') {
          const { text, keyboard } = await renderCardsMessage(userId);
          await editTelegramMessage(chatId, cb.message.message_id, text, keyboard);
          await answerCallbackQuery(cb.id);
          return res.status(200).json({ status: 'ok' });
        }

        if (data === 'view_limit') {
          const { text, keyboard } = await renderLimitMessage(userId);
          await editTelegramMessage(chatId, cb.message.message_id, text, keyboard);
          await answerCallbackQuery(cb.id);
          return res.status(200).json({ status: 'ok' });
        }

        if (data === 'view_premium') {
          const { text, keyboard } = await renderPremiumMessage(userId);
          await editTelegramMessage(chatId, cb.message.message_id, text, keyboard);
          await answerCallbackQuery(cb.id);
          return res.status(200).json({ status: 'ok' });
        }

        if (data === 'view_profile') {
          const { text, keyboard } = await renderProfileMessage(fromUser, userRow, userId);
          await editTelegramMessage(chatId, cb.message.message_id, text, keyboard);
          await answerCallbackQuery(cb.id);
          return res.status(200).json({ status: 'ok' });
        }

        if (data === 'view_stats') {
          const { text, keyboard } = await renderStatsMessage(userId);
          await editTelegramMessage(chatId, cb.message.message_id, text, keyboard);
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

    if (isBlocked) {
      await sendTelegramMessage(
        chatId,
        `⛔ <b>Hisobingiz ma'muriyat tomonidan cheklangan!</b>\n\nSiz ushbu bot va Moliya AI tizimidan foydalana olmaysiz. Cheklovni bekor qilish uchun ma'muriyat bilan bog'laning.`,
        { remove_keyboard: true }
      );
      return res.status(200).json({ status: 'restricted' });
    }

    // ── Handle Contact Share (Phone Number Verification) ────────
    if (message.contact) {
      // Clean user's contact message from chat
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
          }
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
        `👇 <i>Pastdagi menyu orqali Mini Appni ochishingiz yoki to'g'ridan-to'g'ri xarajatlarni yozishingiz mumkin:</i>`;

      // Set physical keyboard with Mini App and commands
      await sendTelegramMessage(chatId, successMsg, getMainAppKeyboard(appUrl));
      return res.status(200).json({ status: 'ok' });
    }

    // ── Registration Guard for Unregistered Users ───────────────
    if (!isRegistered) {
      // Clean incoming message if it was a command
      if (text.startsWith('/')) {
        deleteTelegramMessage(chatId, message.message_id).catch(() => {});
      }

      const phoneRequestMsg =
        `<b>Moliya AI ga xush kelibsiz!</b> 👋✨\n\n` +
        `Dasturdan foydalanish va Mini Appni ochish uchun, iltimos, <b>telefon raqamingizni tasdiqlang</b>.\n\n` +
        `🔒 <i>Telefon raqami Moliya AI hisobingizni xavfsiz yaratish va saqlash uchun talab qilinadi.</i>\n\n` +
        `👇 <i>Pastdagi tugmani bosib raqamingizni ulashing:</i>`;

      await sendTelegramMessage(chatId, phoneRequestMsg, {
        keyboard: [
          [{ text: "📞 Telefon raqamni yuborish", request_contact: true }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      });
      return res.status(200).json({ status: 'phone_required' });
    }

    // ── Command: /start or 👤 Profile / 👤 Profil / 👤 Hisobim / /profile ──
    if (text.startsWith('/start') || text === '👤 Profile' || text === '👤 Profil' || text === '👤 Hisobim' || text.startsWith('/profile')) {
      deleteTelegramMessage(chatId, message.message_id).catch(() => {});

      // Only check login request if explicitly /start with an argument (e.g. /start req_xxxx)
      if (text.startsWith('/start') && text.trim().length > 6) {
        const rawArg = text.replace('/start', '').trim();
        const requestId = rawArg.replace('req_', '').trim();

        if (requestId && requestId.length >= 8 && !rawArg.includes(' ')) {
          // Web login exchange flow
          const verifyResult = await verifyAndMarkLoginRequest(requestId, fromUser);
          const code = verifyResult?.exchangeCode;
          const targetUrl = code ? `${appUrl}?code=${code}` : appUrl;

          const sent = await sendTelegramMessage(
            chatId,
            `<b>Assalomu alaykum, ${fromUser.first_name || 'foydalanuvchi'}!</b> 👋✨\n\n` +
            `✅ <b>Profilingiz tasdiqlandi!</b> 🚀\n` +
            `Brauzeringizdagi Moliya AI sahifasiga qaytsangiz, profilingiz avtomatik ochiladi.\n\n` +
            `👇 <i>Ilovaga kirish:</i>`,
            {
              inline_keyboard: [
                [{ text: "📱 Moliya Mini App", web_app: { url: targetUrl } }]
              ]
            }
          );
          if (sent?.result?.message_id) await setLastTempMsgId(userId, sent.result.message_id);
          return res.status(200).json({ status: 'ok' });
        }
      }

      // If user tapped 👤 Profile, 👤 Profil, 👤 Hisobim or /profile
      if (text === '👤 Profile' || text === '👤 Profil' || text === '👤 Hisobim' || text.startsWith('/profile')) {
        const { text: profText, keyboard: profKeyboard } = await renderProfileMessage(fromUser, user, userId);
        await sendOrEditMenuMessage(chatId, userId, profText, profKeyboard);
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

      await sendOrEditMenuMessage(chatId, userId, welcomeText, getMainAppKeyboard(appUrl));
      return res.status(200).json({ status: 'ok' });
    }

    // ── Command: 💳 Cards / 💳 Kartalar / /cards / /kartalar ──────
    if (text === '💳 Cards' || text === '💳 Kartalar' || text.startsWith('/cards') || text.startsWith('/kartalar')) {
      deleteTelegramMessage(chatId, message.message_id).catch(() => {});
      const { text: cardsText, keyboard: cardsKeyboard } = await renderCardsMessage(userId);
      await sendOrEditMenuMessage(chatId, userId, cardsText, cardsKeyboard);
      return res.status(200).json({ status: 'ok' });
    }

    // ── Command: 📊 Monthly Limit / 📊 Oylik Limit / /limit ───────
    if (text === '📊 Monthly Limit' || text === '📊 Oylik Limit' || text.startsWith('/limit')) {
      deleteTelegramMessage(chatId, message.message_id).catch(() => {});
      const arg = text.replace('/limit', '').trim();
      const { text: limitText, keyboard: limitKeyboard } = await renderLimitMessage(userId, arg || undefined);
      await sendOrEditMenuMessage(chatId, userId, limitText, limitKeyboard);
      return res.status(200).json({ status: 'ok' });
    }

    // ── Command: ⭐ Premium / /premium / /vip ─────────────────────
    if (text === '⭐ Premium' || text.startsWith('/premium') || text.startsWith('/vip')) {
      deleteTelegramMessage(chatId, message.message_id).catch(() => {});
      const { text: premText, keyboard: premKeyboard } = await renderPremiumMessage(userId);
      await sendOrEditMenuMessage(chatId, userId, premText, premKeyboard);
      return res.status(200).json({ status: 'ok' });
    }

    // ── Command: /app or 🚀 Moliya or 📱 Mini App ─────────────────
    if (text.startsWith('/app') || text === '🚀 Moliya' || text === '📱 Mini App') {
      deleteTelegramMessage(chatId, message.message_id).catch(() => {});

      const appText = `🚀 <b>Moliya Telegram Mini App</b>\n\nBarcha hisob-kitoblar, kartalar, oylik limit, grafiklar va tahlillar bir joyda! 👇`;
      const appKeyboard = {
        inline_keyboard: [
          [{ text: "🚀 Moliya Mini Appni ochish", web_app: { url: appUrl } }]
        ]
      };
      await sendOrEditMenuMessage(chatId, userId, appText, appKeyboard);
      return res.status(200).json({ status: 'ok' });
    }

    // ── Command: /help or /yordam or ❓ Help / ❓ Yordam ───────────
    if (text.startsWith('/help') || text.startsWith('/yordam') || text === '❓ Help' || text === '❓ Yordam') {
      deleteTelegramMessage(chatId, message.message_id).catch(() => {});

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
        `• <b>🚀 Moliya</b> — Mini Appni to'liq ochish\n` +
        `• <b>👤 Profile</b> — Hisob ma'lumotlari va tarif\n` +
        `• <b>💳 Cards</b> — Bank kartalari balansi\n` +
        `• <b>📊 Monthly Limit</b> — Byudjet sarfi va nazorat\n` +
        `• <b>⭐ Premium</b> — VIP status va imkoniyatlar\n` +
        `• <b>📈 Stats</b> — Oylik balans va xarajatlar`;

      await sendOrEditMenuMessage(chatId, userId, helpText, getMainAppKeyboard(appUrl));
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
          const keysToTry = candidateKeys.length > 0
            ? candidateKeys
            : (envKey ? [{ id: 'env_gemini', api_key: envKey, name: 'ENV Key', model: 'gemini-3.5-flash' }] : []);

          const activeModels = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest'];

          for (const keyObj of keysToTry) {
            const rawApiKey = (keyObj.api_key || '').trim();
            if (!rawApiKey) continue;

            let parsed: any = null;
          const srvCtx = getServerDateTimeContext();
          for (const modelToUse of activeModels) {
            try {
              const ai = new GoogleGenAI({ apiKey: rawApiKey });
              const prompt = buildUzbekFinancialAiPrompt('Voice audio note containing spoken transaction in Uzbek/Russian', srvCtx);

              const audioResult = await ai.models.generateContent({
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
                  responseMimeType: "application/json"
                }
              });

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
            }
            }

            if (parsed) {
              const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
              const safeD = parseSafeDate(parsed.date);
              const newTx = {
                id: txId,
                type: parsed.type || 'expense',
                name: parsed.title || parsed.note || 'Ovozli xarajat',
                category: parsed.category || 'Boshqa',
                amount: Number(parsed.amount),
                date: safeD.date,
                day: safeD.day,
                month: safeD.month,
                year: safeD.year,
                time: safeD.time,
                note: parsed.note || 'Ovozli kiritilgan',
                debtWho: parsed.debtWho || ''
              };

              await saveBotTransaction(userId, newTx);
              await recordAiUsage(userId, 'text', parsed.note || 'Voice expense', quota.isPremium);

              const emoji = CATEGORY_EMOJIS[newTx.category] || '💸';
              const isInc = newTx.type === 'income';
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
        } catch (voiceErr) {
          console.error('[BOT] Voice parsing error:', voiceErr);
        }
      }
    }

    // ── Photo Message (Receipt OCR Scanning) ────────────────────
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
          const keysToTry = candidateKeys.length > 0
            ? candidateKeys
            : (envKey ? [{ id: 'env_gemini', api_key: envKey, name: 'ENV Key', model: 'gemini-3.5-flash' }] : []);

          const activeModels = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest'];

          for (const keyObj of keysToTry) {
            const rawApiKey = (keyObj.api_key || '').trim();
            if (!rawApiKey) continue;

            let parsed: any = null;
            for (const modelToUse of activeModels) {
              try {
                const ai = new GoogleGenAI({ apiKey: rawApiKey });
                const prompt = `You are an OCR receipt scanner for Moliya AI. Extract receipt info into JSON:
- type: 'expense'
- amount: total integer amount paid in UZS
- category: choose best fit from ['Oziq-ovqat', 'Transport', 'Kiyim', 'Kommunal', 'Sog\\'liq', 'Ko\\'ngil ochar', 'Boshqa']
- note: store or merchant name and summary
- title: merchant name`;

                const imgResult = await ai.models.generateContent({
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
                    responseMimeType: "application/json"
                  }
                });

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
              }
            }

            if (parsed) {
              const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
              const safeD = parseSafeDate(parsed.date);
              const newTx = {
                id: txId,
                type: 'expense',
                name: parsed.title || parsed.note || 'Chek xarajati',
                category: parsed.category || 'Oziq-ovqat',
                amount: Number(parsed.amount),
                date: safeD.date,
                day: safeD.day,
                month: safeD.month,
                year: safeD.year,
                time: safeD.time,
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
        } catch (imgErr) {
          console.error('[BOT] Receipt parsing error:', imgErr);
        }
      }
    }

    // ── Natural Language Text Expense (with Uzbek Normalizer) ────
    if (text && !text.startsWith('/')) {
      const quota = await checkAiQuota(userId);
      if (!quota.allowed) {
        await sendTelegramMessage(chatId, `⚠️ ${quota.message || "AI so'rovlar limitingiz tugadi."}`);
        return res.status(200).json({ status: 'quota_exceeded' });
      }

      const parsed = await parseTextWithAi(text);
      if (parsed && parsed.amount && Number(parsed.amount) > 0) {
        const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const safeD = parseSafeDate(parsed.date);
        const newTx = {
          id: txId,
          type: parsed.type || 'expense',
          name: parsed.name || text,
          category: parsed.category || 'Boshqa',
          amount: Number(parsed.amount),
          date: safeD.date,
          day: safeD.day,
          month: safeD.month,
          year: safeD.year,
          time: safeD.time,
          note: parsed.note || text,
          debtWho: parsed.debtWho || ''
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
          `🤔 <b>Summani aniqlab bo'lmadi.</b>\n\nIltimos, xarajatni summa bilan yozing, masalan:\n<i>"14 mln so'm sarfladim"</i> yoki <i>"taksiga 30 ming"</i>`,
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
