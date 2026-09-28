import {hasTelegramLinkButton} from './_telegramKeyboard.js';
import {generateBounded,tryNextModel} from './_aiCall.js';
import {stageBotDraft,resolveBotDraft} from './services/_botDraftService.js';
import { messageDeliveryKey, claimBotMessage, completeBotMessage } from './services/_botMessageDelivery.js';
import {transactionParts,TRANSACTION_CLARIFICATION} from '../shared/amountEvidence.js';
import { updateProfileSnapshot } from './services/_profileWriteService.js';
import { safeWarn, safeError } from './_logger.js';
import { accountDenied, acceptedConsent, verifiedPhone, eligibleUser } from './_userPolicy.js';
import { financialAmount, financialKind, financialTotals } from '../shared/financialTotals.js';
import { answerFinancialQuestion, isFinancialQuestion } from '../shared/financialAssistant.js';
import { transactionDay } from '../shared/reminderPolicy.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from "@google/genai";
import crypto from "crypto";
import { sendLegalFile } from './_legalFile.js';
import { loadLegalDocuments } from './_legalDocuments.js';
import { supabase } from './_supabaseClient.js';
import { applySecurityHeaders } from './_securityHeaders.js';
import { getCandidateAiKeys, recordKeyResult } from './_aiRouter.js';
import { checkAiQuota, checkAndRecordAiUsage } from './_aiQuotaHelper.js';
import { loadAiParserGuidance } from './_aiParserGuidance.js';
import {
  normalizeUzbekFinancialText,
  buildUzbekFinancialAiPrompt,
  validateAiFinancialOutput,
  correctAiMultiplierHallucination,
  getServerDateTimeContext,
  parseSafeDate,
  parseTurboFinancialText,
  TurboTransaction,
  TurboParseResult
} from './_uzbekFinancialNormalizer.js';

let BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const appUrl = process.env.APP_URL || "https://moliya-ai-pi.vercel.app";

import {
  deleteTransaction,
  wipeBotFinancialData,
  logBotMessage,
  type BotMessageEntry
} from './services/index.js';

export { logBotMessage, type BotMessageEntry };

function escapeTelegramHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendLegalConsentRequest(chatId: string | number): Promise<boolean> {
  const docs = await loadLegalDocuments();
  return sendLegalFile(BOT_TOKEN, chatId, docs);
}

// ── Telegram API Helpers ─────────────────────────────────────
async function editTelegramMessageReplyMarkup(chatId: number | string, messageId: number | string, replyMarkup: any) {
  if (!BOT_TOKEN || !messageId) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageReplyMarkup`, {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(chatId),
        message_id: Number(messageId),
        reply_markup: replyMarkup
      })
    });
    return await res.json();
  } catch (err) {
    safeWarn('[BOT] Failed to edit reply markup:', err);
    return null;
  }
}

// Only a previous bot system card may be replaced. Admin announcements and
// transaction keyboards remain interactive even when a user starts the bot.
async function sendOrReplaceSystemMessage(chatId: number | string, text: string,
  replyMarkup?: any, userId?: string, customType = 'bot_response') {
  if (!BOT_TOKEN) return null;
  try {
    const response=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,{
      method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(10000),
      body:JSON.stringify({chat_id:String(chatId),text,parse_mode:'HTML',...(hasTelegramLinkButton(replyMarkup)?{protect_content:true}:{}),...(replyMarkup?{reply_markup:replyMarkup}:{})})
    });
    const result=await response.json();
    if (!result?.ok || !result.result?.message_id || !userId) return result;
    // Show the next onboarding step first; bookkeeping is still awaited before
    // the webhook is acknowledged so Vercel cannot discard it.
    const messageId=result.result.message_id;
    try {
      const {data:current,error}=await supabase.from('users').select('onboarding').eq('id',userId).maybeSingle();
      if(error || !current) return result;
      const ob=current.onboarding || {};
      const messages=Array.isArray(ob.bot_messages)?ob.bot_messages:[];
      const previous=messages.find((m:any)=>Number(m.message_id)===Number(ob.last_system_message_id));
      await updateProfileSnapshot(userId,current,{onboarding:{...ob,last_system_message_id:messageId,last_message_id:Math.max(Number(ob.last_message_id)||0,messageId),
        bot_messages:[...messages,{id:`bot_${chatId}_${messageId}`,chat_id:chatId,message_id:messageId,
          direction:'bot_to_user',sender:'bot',type:customType,text,timestamp:new Date().toISOString()}].slice(-500)}});
      if(previous?.sender==='bot' && ['welcome_card','phone_request','lang_request','bot_response'].includes(previous.type)) {
        await deleteTelegramMessage(chatId,previous.message_id);
      }
    } catch(error) { safeWarn('[BOT] System message history unavailable:',error); }
    return result;
  } catch(error) { safeError('[BOT] System message delivery failed:',error); return null; }
}

async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  replyMarkup?: any,
  userId?: string,
  customType: string = 'bot_response'
) {
  if (!BOT_TOKEN) {
    safeError('[BOT] TELEGRAM_BOT_TOKEN is missing');
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
      if (hasTelegramLinkButton(replyMarkup)) payload.protect_content = true;
    }
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data?.ok && data?.result?.message_id) {
      const msgId = data.result.message_id;
      if (userId) {
        await logBotMessage(userId, {
          id: `bot_${chatId}_${msgId}`,
          chat_id: chatId,
          message_id: msgId,
          direction: 'bot_to_user',
          sender: 'bot',
          type: customType,
          text,
          timestamp: new Date().toISOString()
        });
      }
    }
    return data;
  } catch (err) {
    safeError('[BOT] Failed to send Telegram message:', err);
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
      signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data?.ok) {
      if (userId) {
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
    }
    return data;
  } catch (err) {
    safeError('[BOT] Failed to edit Telegram message:', err);
    return null;
  }
}

async function deleteTelegramMessage(chatId: number | string, messageId: number | string) {
  if (!BOT_TOKEN || !messageId) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(chatId),
        message_id: Number(messageId)
      })
    });
    return await res.json();
  } catch (err) {
    safeWarn('[BOT] Failed to delete message:', err);
    return null;
  }
}

async function setLastTempMsgId(userId: string, msgId: number | string | undefined) {
  if (!userId || !msgId) return;
  try {
    const { data: u } = await supabase.from('users').select('onboarding').eq('id', userId).maybeSingle();
    const updatedOb = { ...(u?.onboarding || {}), last_temp_msg_id: Number(msgId) };
    await updateProfileSnapshot(userId, u, { onboarding: updatedOb });
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
      signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: String(chatId), action })
    });
  } catch {}
}



async function createQuickExchangeCode(tgId: string | number): Promise<string> {
  try {
    const now = new Date();
    const exchangeCode = crypto.randomBytes(24).toString('hex');
    const codeExpiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
    const sessionToken = 'sess_' + crypto.randomBytes(24).toString('hex');

    const userId = `moliya_user_tg_${tgId}`;
    const { error: codeError } = await supabase.from('users').upsert({
      id: `exchange_${exchangeCode}`,
      platform: 'exchange_code',
      telegram_id: String(tgId),
      device_info: {
        code: exchangeCode,
        status: 'VALID',
        sessionToken: sessionToken,
        sessionExpiresAt: codeExpiresAt
      },
      onboarding: {
        login_request_status: 'VALID',
        session_token: sessionToken,
        session_expires_at: codeExpiresAt
      },
      updated_at: now.toISOString()
    }, { onConflict: 'id' });

    if (codeError) throw new Error('EXCHANGE_CODE_STORE_UNAVAILABLE');

    return exchangeCode;
  } catch (e) {
    safeError('[BOT] Error creating quick exchange code:', e);
    return '';
  }
}

const BOT_HELP_TEXT =
  `❓ <b>Moliya AI — yordam</b>\n\n` +
  `<blockquote>📝 “Taksiga 25 ming” yoki “14 mln maosh tushdi”\n` +
  `🎙 Ovozli xabar yoki 📸 chek rasmini yuboring.</blockquote>\n\n` +
  `Summani tekshiring va yozuvni tasdiqlang.\n` +
  `📱 Ilovada kartalar, limit va statistikani ko‘rasiz.\n` +
  `👤 Tarif va AI limiti — profilingizda.`;

function getMainAppKeyboard(appUrl: string, webUrl?: string) {
  const targetWeb = webUrl || appUrl;
  return {
    inline_keyboard: [
      [
        { text: "📱 Moliya Mini App", style: "primary", web_app: { url: appUrl } },
        { text: "🌐 Veb-Ilova", style: "primary", url: targetWeb }
      ],
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
        { text: "❓ Yordam", style: "success", callback_data: "menu_help" }
      ]
    ]
  };
}

async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  if (!BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text
      })
    });
  } catch (err) {
    safeError('[BOT] Failed to answer callback query:', err);
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
    safeError('[BOT] Failed to get file URL:', err);
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
      signal: AbortSignal.timeout(10000),
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
          { command: 'tozalash', description: '🗑 Xarajatlar tarixini tozalash' },
          { command: 'help', description: '❓ Yo\'riqnoma va yordam' }
        ]
      })
    });
    commandsRegistered = true;
  } catch (e) {
    safeWarn('[BOT] Failed to register Telegram commands:', e);
  }
}

// ── Phone Verification Helpers ──────────────────────────────
export function isValidPhoneNumber(phone: any): boolean {
  if (!phone) return false;
  const s = String(phone).trim();
  return s.length >= 7 && s !== '—' && s !== '-' && s !== 'null' && s !== 'undefined';
}

// ── Canonical User Resolution & Identity Model ───────────────
async function resolveCanonicalUser(fromUser: any) {
  const tgId = String(fromUser.id);
  const userId = `moliya_user_tg_${tgId}`;
  const now = new Date().toISOString();
  const fullName = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ') || 'Foydalanuvchi';
  const username = fromUser.username ? `@${fromUser.username}` : null;

  // 1. Identity-based block check & parallel user lookup (fast concurrent round-trip)
  const [blockedRes,existingRes]=await Promise.all([
    supabase.from('users').select('*').eq('id',`restricted_tg_${tgId}`).maybeSingle(),
    supabase.from('users').select('*').eq('id',userId).maybeSingle()
  ]);
  if(blockedRes.error || existingRes.error) throw new Error('AUTH_STORE_UNAVAILABLE');
  if(blockedRes.data && blockedRes.data.onboarding?.is_blocked!==false)
    return {user:blockedRes.data,userId,isBlocked:true,isRegistered:false,isNew:false,hasPhone:false,hasAcceptedOferta:false};
  const existing=existingRes.data;
  if(existing) return {user:existing,userId,isBlocked:accountDenied(existing),isRegistered:eligibleUser(existing),isNew:false,hasPhone:verifiedPhone(existing),hasAcceptedOferta:acceptedConsent(existing)};

  // 3. User was deleted or is first-time visitor -> Create clean active user record with trial
  const trialEnd = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const newOnboarding = {
    completed: false,
    tour_completed: false,
    oferta_accepted: false,
    language: 'uz',
    name: fullName,
    telegram: username,
    telegramId: tgId,
    trial_started_at: now,
    trial_ends_at: trialEnd,
    registration_status: 'pending_oferta',
    privacy_consent: null
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
    created_at: now,
    updated_at: now
  };

  const { data: created, error: upErr } = await supabase.from('users').upsert(newPayload, {
    onConflict: 'id',
    ignoreDuplicates: true  // SAFETY: Never overwrite existing user data in race conditions
  }).select().maybeSingle();
  if (upErr) {
    safeError('[BOT] Error creating initial user record:', upErr.message);
  }

  // If insert was ignored (user appeared between check and insert), re-fetch existing
  if (!created) {
    const { data: refetched } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
    if (refetched) {
      return { user:refetched,userId,isBlocked:accountDenied(refetched),isRegistered:eligibleUser(refetched),isNew:false,hasPhone:verifiedPhone(refetched),hasAcceptedOferta:acceptedConsent(refetched) };
    }
  }

  if (!created) throw new Error('USER_CREATE_FAILED');
  return { user: created, userId, isBlocked: false, isRegistered: false, isNew: true, hasPhone: false, hasAcceptedOferta: false };
}

// ── Complete Phone Registration & Grant 1-Day Trial ─────────
export async function completePhoneRegistration(fromUser: any, phoneNumber: string) {
  const tgId = String(fromUser.id);
  const userId = `moliya_user_tg_${tgId}`;
  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + 24 * 3600 * 1000).toISOString();
  const fullName = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ') || 'Foydalanuvchi';
  const username = fromUser.username ? `@${fromUser.username}` : null;

  // IMPORTANT: Fetch existing user data first to PRESERVE transactions and cards
  const { data: existingUser, error: readError } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
  if(readError || !acceptedConsent(existingUser)) throw new Error('BOT_CONSENT_REQUIRED');
  if(!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) throw new Error('INVALID_CONTACT_PHONE');
  const existingOb = existingUser?.onboarding || {};
  const isFirstRegistration = !existingUser?.phone;

  const updatedOnboarding = {
    ...existingOb,  // Preserve existing onboarding data (bot_messages, etc.)
    completed: true,
    tour_completed: isFirstRegistration ? false : existingOb.tour_completed === true,
    language: existingOb.language || existingUser?.language || 'uz',
    name: fullName,
    phone: phoneNumber,
    telegram: username,
    telegramId: tgId,
    registration_status: 'completed',
    oferta_accepted: true,
    trial_started_at: existingOb.trial_started_at || now.toISOString(),
    trial_ends_at: existingOb.trial_ends_at || trialEndsAt,
    privacy_consent: existingOb.privacy_consent
  };

  const updatePayload: any = {
    id: userId,
    name: fullName,
    telegram: username,
    telegram_id: tgId,
    phone: phoneNumber,
    bot_verification: {...existingUser.bot_verification,telegram_id:tgId,phone:phoneNumber,phone_source:'telegram_own_contact',phone_verified_at:now.toISOString()},
    platform: 'telegram',
    onboarding: updatedOnboarding,
    updated_at: now.toISOString()
  };

  // Only grant fresh trial for FIRST-TIME registration (not re-registration)
  if (isFirstRegistration) {
    updatePayload.is_premium = true;
    updatePayload.premium_expires_at = trialEndsAt;
    updatePayload.ai_limit = null;
    updatePayload.ai_query_count = 0;
    updatePayload.created_at = now.toISOString();
  }

  const { error: saveErr } = await updateProfileSnapshot(userId, existingUser, updatePayload);
  if (saveErr) {
    throw new Error('PHONE_VERIFICATION_SAVE_FAILED');
  }

  // Auto-verify any pending login request from web app waiting for this user
  const pendingReqId = existingUser?.device_info?.pending_login_request_id || existingOb.pending_login_request_id;
  if (pendingReqId) {
    try {
      await verifyAndMarkLoginRequest(pendingReqId, fromUser);
    } catch (vErr) {
      safeError('[BOT] Error auto-verifying pending login request after phone registration:', vErr);
    }
  }

  return updatePayload;
}

// ── Authentication Handshake & Web Login ─────────────────────
async function verifyAndMarkLoginRequest(requestId: string, fromUser: any) {
  try {
    const cleanId = requestId.replace(/^req_/, '').trim();
    if(!/^[a-zA-Z0-9_-]{16,128}$/.test(cleanId)) return null;
    const {data:pending,error:pendingError}=await supabase.from('users').select('*').eq('id','req_'+cleanId).maybeSingle();
    const createdAt=pending?.device_info?.createdAt;
    if(pendingError || !pending || pending.device_info?.status!=='PENDING' ||
       !Number.isFinite(Date.parse(createdAt || '')) || Date.now()-Date.parse(createdAt)>300000) return null;
    const tgId = String(fromUser.id);
    const userId = `moliya_user_tg_${tgId}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 24 * 3600 * 1000).toISOString();

    const randomHex = crypto.randomBytes(16).toString('hex');
    const sessionToken = 'sess_' + randomHex;

    const { isBlocked } = await resolveCanonicalUser(fromUser);
    if (isBlocked) return null;

    // Fetch existing user to preserve onboarding & device info
    const { data: existingUser } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
    if(!eligibleUser(existingUser)) return null;
    const existingOb = existingUser?.onboarding || {};
    const existingDev = existingUser?.device_info || {};

    // Claim before rotating the canonical token. A cancelled or duplicate
    // request must never revoke an already working user session.
    const {data:claimed,error:claimError}=await supabase.from('users').update({
      telegram_id: tgId,
      device_info: {...pending.device_info,requestId:cleanId,status:'PROCESSING',verifiedBy:tgId},
      updated_at: now.toISOString()
    }).eq('id','req_'+cleanId).eq('device_info->>status','PENDING').select('id');
    if(claimError || !claimed?.length) return null;

    const failClaim = async () => {
      await supabase.from('users').update({
        device_info:{...pending.device_info,status:'FAILED'},
        onboarding:{login_request_id:cleanId,login_request_status:'FAILED'},
        updated_at:new Date().toISOString()
      }).eq('id','req_'+cleanId).eq('device_info->>status','PROCESSING');
    };

    const exchangeCode = crypto.randomBytes(24).toString('hex');
    const codeExpiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
    const {error:codeError}=await supabase.from('users').upsert({
      id: `exchange_${exchangeCode}`,
      platform: 'exchange_code',
      telegram_id: tgId,
      device_info: {code:exchangeCode,status:'VALID',sessionToken,sessionExpiresAt:codeExpiresAt},
      onboarding: {login_request_status:'VALID',session_token:sessionToken,session_expires_at:codeExpiresAt},
      updated_at: now.toISOString()
    }, {onConflict:'id'});
    if(codeError) { await failClaim(); return null; }

    // Persist session token to user record inside onboarding & device_info.
    // A stale profile snapshot fails closed; no VERIFIED result is published.
    try { await updateProfileSnapshot(userId, existingUser, {
      onboarding: {
        ...existingOb,
        session_token: sessionToken,
        session_expires_at: expiresAt,
        phone: existingUser?.phone || existingOb.phone || '',
        completed: existingOb.completed === true,
        oferta_accepted: existingOb.oferta_accepted === true
      },
      device_info: {
        ...existingDev,
        session_token: sessionToken,
        last_verified_at: now.toISOString()
      },
      updated_at: now.toISOString()
    }); } catch { await failClaim(); return null; }

    // Publish the session only after the canonical token is durable.
    const {data:published,error:publishError}=await supabase.from('users').update({
      id: `req_${cleanId}`,
      platform: 'login_request',
      telegram_id: tgId,
      device_info: {
        ...pending.device_info,
        requestId: cleanId,
        status: 'VERIFIED',
        sessionToken: sessionToken,
        verifiedAt: now.toISOString(),
        verifiedBy: tgId
      },
      onboarding: {
        login_request_id: cleanId,
        login_request_status: 'VERIFIED',
        session_token: sessionToken
      },
      updated_at: now.toISOString()
    }).eq('id','req_'+cleanId).eq('device_info->>status','PROCESSING').select('id');
    if(publishError || !published?.length) { await failClaim(); return null; }

    return { sessionToken, userId, exchangeCode };
  } catch (err) {
    safeError('[BOT] Error verifying login request:', err);
    return null;
  }
}

function escapeBotHtml(value:any):string { return String(value).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]!)); }

// A draft is durable before Telegram displays the confirmation buttons.
async function requestTransactionConfirmation(userId:string, chatId:number|string, sourceMessageId:number, txs:any[], statusMsgId?:number) {
  const draft=await stageBotDraft(userId,chatId,sourceMessageId,txs);
  if(draft.status!=='pending') {
    await sendTelegramMessage(chatId,'Bu xabar allaqachon ko‘rib chiqilgan. Yangi yozuv uchun yangi xabar yuboring.',undefined,userId);
    return;
  }
  const escape=escapeBotHtml;
  const lines=draft.transactions.map((tx:any)=>{
    const label=({expense:'💸 Xarajat',income:'💰 Daromad',debt:'📥 Qarz olish',lending:'📤 Qarz berish'} as Record<string,string>)[tx.type] || tx.type;
    return `${escape(label)} · <b>${Math.abs(tx.amount).toLocaleString('en-US').replace(/,/g,' ')} so‘m</b>\n${escape(String(tx.category || 'Boshqa'))} · ${escape(String(tx.title || '').slice(0,80))}`;
  });
  const text='📝 <b>Yozuvni tekshiring</b>\n\n'+lines.join('\n\n')+'\n\nHali saqlanmadi. Tasdiqlang yoki bekor qiling. ⏳ 15 daqiqa.';
  const keyboard={inline_keyboard:[[{text:'✅ Tasdiqlash',style:'success',callback_data:'txok_'+draft.id},{text:'✕ Bekor qilish',style:'danger',callback_data:'txno_'+draft.id}]]};
  let delivered=statusMsgId ? await editTelegramMessage(chatId,statusMsgId,text,keyboard,userId,'ai_response') : null;
  if(!delivered?.ok)delivered=await sendTelegramMessage(chatId,text,keyboard,userId,'ai_response');
  if(!delivered?.ok)throw new Error('BOT_CONFIRMATION_DELIVERY_FAILED');
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
    `${emoji} <b>Kategoriya:</b> ${escapeBotHtml(cat)}\n` +
    `💰 <b>Summa:</b> ${formattedAmount} so'm\n` +
    `📝 <b>Izoh:</b> ${escapeBotHtml(label)}\n` +
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
  const totals = financialTotals(txs);

  for (const tx of txs) {
    const kind = financialKind(tx);
    const isInc = kind === 'income' || kind === 'debt';
    const cat = tx.category || 'Boshqa';
    const emoji = CATEGORY_EMOJIS[cat] || (isInc ? '💰' : '💸');
    const amt = financialAmount(tx);
    const formattedAmt = amt.toLocaleString('uz-UZ').replace(/,/g, ' ');
    const desc = tx.title || tx.note || tx.description || tx.name || cat;
    listText += `${isInc ? '🟢' : '🔴'} ${emoji} <b>${escapeBotHtml(cat)}:</b> ${formattedAmt} so'm <i>(${escapeBotHtml(desc)})</i>\n`;
  }

  const text =
    `✨ <b>${txs.length} ta operatsiya muvaffaqiyatli saqlandi!</b>\n\n` +
    listText + '\n' +
    (totals.expense > 0 ? `🔴 <b>Jami xarajat:</b> ${totals.expense.toLocaleString('uz-UZ').replace(/,/g, ' ')} so'm\n` : '') +
    (totals.income > 0 ? `🟢 <b>Jami daromad:</b> ${totals.income.toLocaleString('uz-UZ').replace(/,/g, ' ')} so'm\n` : '') +
    (totals.borrowed > 0 ? `🤝 <b>Olingan qarz:</b> ${totals.borrowed.toLocaleString('uz-UZ')} so'm\n` : '') +
    (totals.lent > 0 ? `🤝 <b>Berilgan qarz:</b> ${totals.lent.toLocaleString('uz-UZ')} so'm\n` : '') +
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

  if(!transactionParts(text))return null;

  // Pre-process and normalize Uzbek abbreviations & multipliers (e.g. 14 mln, 50k, 2 yarim mln)
  const normalized = normalizeUzbekFinancialText(text);

  const candidateKeys = await getCandidateAiKeys();
  const envKey = process.env.GEMINI_API_KEY;
  const keysToTry = candidateKeys.length > 0
    ? candidateKeys
    : (envKey ? [{ id: 'env_gemini', api_key: envKey, name: 'ENV Key', model: 'gemini-3.5-flash-lite' }] : []);

  if (keysToTry.length === 0) return null;

  const prompt = buildUzbekFinancialAiPrompt(normalized.normalizedText, undefined, await loadAiParserGuidance());
  const aiDeadline=Date.now()+25000;
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
      if(Date.now()>=aiDeadline)break;
      try {
        const ai = new GoogleGenAI({ apiKey: rawApiKey });

        const response = await generateBounded(ai,{
          model: modelToUse,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            maxOutputTokens: 200,
            temperature: 0.1
          }
        },aiDeadline,10000);

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
        safeWarn(`[BOT] Gemini parse error with key on ${modelToUse}:`, e?.message);
        if(!tryNextModel(e))break; // Preserve fallback for unavailable models.
      }
    }
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
    `👤 <b>${escapeTelegramHtml(fullName)}</b>\n` +
    `${escapeTelegramHtml(username)} · <code>${escapeTelegramHtml(String(phone))}</code>\n\n` +
    `<blockquote>${planLabel}\n⚡ AI: ${quotaStatus}\n` +
    `🎯 Oylik limit: ${monthlyGoal.toLocaleString()} so‘m</blockquote>\n` +
    `💳 ${cardsCount} karta · 📝 ${txsCount} yozuv`;


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

  let text = `💳 <b>Kartalar</b>\n\n`;

  if (cards.length === 0) {
    text += `Hali karta qo‘shilmagan.\n\n` +
      `👇 Ilovada karta qo‘shing va balansini kiriting.`;
  } else {
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const brandEmoji = c.brand === 'humo' ? '🟧' : (c.brand === 'visa' || c.brand === 'mastercard' ? '🌐' : '🟩');
      const num = c.number || '•••• ••••';
      const balNum = c.balance ? Number(String(c.balance).replace(/\s/g, '').replace(/,/g, '')) : 0;
      text += `${brandEmoji} <b>${escapeTelegramHtml(String(c.bank || 'Bank'))} (${escapeTelegramHtml(String(c.brand || 'uzcard').toUpperCase())})</b>\n` +
              `• Raqam: <code>${escapeTelegramHtml(String(num))}</code>\n` +
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
      await updateProfileSnapshot(userId, u, { onboarding: updatedOb });
      updateNotice = `✅ <b>Limit yangilandi</b>\n\n`;
    }
  }

  const txs = Array.isArray(u?.transactions) ? u.transactions : [];
  const [currentYear,currentMonth]=getServerDateTimeContext().currentDate.split('-').map(Number);
  const monthExpenses = financialTotals(txs.filter((t: any) =>
    transactionDay(t.date).slice(0, 7) === `${currentYear}-${String(currentMonth).padStart(2, '0')}`)).expense;

  const percent = Math.min(Math.round((monthExpenses / monthlyGoal) * 100), 100);
  const filledBars = Math.round(percent / 10);
  const emptyBars = 10 - filledBars;
  const progressBar = '█'.repeat(filledBars) + '░'.repeat(emptyBars);

  const remaining = Math.max(monthlyGoal - monthExpenses, 0);
  const isExceeded = monthExpenses > monthlyGoal;

  const text =
    updateNotice +
    `🎯 <b>Oylik limit · ${currentMonth}/${currentYear}</b>\n\n` +
    `🎯 <b>Belgilangan limit:</b> ${monthlyGoal.toLocaleString()} so'm\n` +
    `💸 <b>Sarflandi:</b> ${monthExpenses.toLocaleString()} so'm (${percent}%)\n` +
    `[${progressBar}] ${percent}%\n\n` +
    (isExceeded
      ? `⚠️ <b>Limitdan ${(monthExpenses - monthlyGoal).toLocaleString()} so'm ortiqcha sarflandi!</b>\n\n`
      : `🟢 <b>Qolgan byudjet:</b> ${remaining.toLocaleString()} so'm\n\n`) +
    `💡 <i>Limitni o'zgartirish uchun:</i>\n<code>/limit 6000000</code> yoki <code>/limit 5 mln</code> deb yozing.\n` +
    `👇 Yoki ilovada sozlang.`;

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
    `💎 <b>Premium</b>\n\n${planLabel}${expiresText}\n\n` +
    `<blockquote>🎙 Ovoz · 📸 Chek · 📊 Tahlil\n⚡ AI imkoniyatlari va limitlar — ilovada.</blockquote>\n` +
    `Tarif tafsilotlarini quyida ko‘ring.`;


  const keyboard = {
    inline_keyboard: [
      [{ text: "💎 Premium Obuna (Mini App)", web_app: { url: appUrl } }],
      [{ text: "🔙 Profilga qaytish", callback_data: "view_profile" }]
    ]
  };

  return { text, keyboard };
}

async function renderStatsMessage(userId: string, period: 'today' | 'month' | 'all' = 'month', page: number = 1) {
  const { data: u } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
  const txs = Array.isArray(u?.transactions) ? u.transactions : [];

  const srv = getServerDateTimeContext();
  const todayStr = srv.currentDate; // 'YYYY-MM-DD'
  const [curY, curM, curD] = todayStr.split('-').map(Number);

  let filteredTxs = txs;
  let periodTitle = "Joriy Oy (Sentabr 2026)";

  if (period === 'today') {
    periodTitle = `Bugun (${todayStr})`;
    filteredTxs = txs.filter((t: any) => {
      if (transactionDay(t.date) === todayStr) return true;
      if (t.day === curD && t.month === curM && t.year === curY) return true;
      return false;
    });
  } else if (period === 'month') {
    const monthNames = ['', 'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
    periodTitle = `${monthNames[curM] || curM} ${curY}`;
    filteredTxs = txs.filter((t: any) => {
      if (t.year && t.month) return Number(t.year) === curY && Number(t.month) === curM;
      return transactionDay(t.date).slice(0, 7) === `${curY}-${String(curM).padStart(2, '0')}`;
    });
  } else {
    periodTitle = "Barcha vaqtlar";
  }

  // Sort newest transactions first
  const sortedTxs = [...filteredTxs].sort((a: any, b: any) => {
    const timeA = a.date ? new Date(`${a.date}T${a.time || '00:00'}:00Z`).getTime() : (Number(a.id) || 0);
    const timeB = b.date ? new Date(`${b.date}T${b.time || '00:00'}:00Z`).getTime() : (Number(b.id) || 0);
    return timeB - timeA;
  });

  const totals = financialTotals(sortedTxs);
  const totalExpense = totals.expense;
  const totalIncome = totals.income;
  const catTotals = totals.categories;
  const balance = totals.cashFlow;
  const netSign = balance >= 0 ? '+' : '';

  // Pagination for records list
  const pageSize = 8;
  const totalPages = Math.max(1, Math.ceil(sortedTxs.length / pageSize));
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const startIndex = (currentPage - 1) * pageSize;
  const pageTxs = sortedTxs.slice(startIndex, startIndex + pageSize);

  let recordsListText = '';
  if (sortedTxs.length === 0) {
    recordsListText = `<i>Ushbu davrda hech qanday operatsiya kiritilmagan.</i>\n`;
  } else {
    recordsListText = pageTxs.map((t: any, idx: number) => {
      const globalNum = startIndex + idx + 1;
      const kind = financialKind(t);
      const isInc = kind === 'income' || kind === 'debt';
      const typeEmoji = kind === 'debt' || kind === 'lending' ? '🤝' : isInc ? '🟢' : '🔴';
      const amt = financialAmount(t).toLocaleString('uz-UZ').replace(/,/g, ' ');
      const sign = isInc ? '+' : '-';
      const name = (t.title || t.note || t.name || (kind === 'debt' ? 'Olingan qarz' : kind === 'lending' ? 'Berilgan qarz' : 'Xarajat')).trim();
      const catEmoji = CATEGORY_EMOJIS[t.category] || (isInc ? '💰' : '📦');
      const catName = t.category || 'Boshqa';
      const dateDisplay = t.date ? t.date : 'Bugun';
      const timeDisplay = t.time ? ` ${t.time}` : '';
      const paymentType = t.cardId === 'cash' || !t.cardId ? '💵 Naqd' : '💳 Karta';

      return `${globalNum}. ${typeEmoji} <b>${name}</b>: <code>${sign}${amt} so'm</code>\n` +
             `   └ ${catEmoji} <i>${catName}</i> • 📅 ${dateDisplay}${timeDisplay} • ${paymentType}`;
    }).join('\n\n');
  }

  // Top category summary
  const topCats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 3);
  let topCatStr = '';
  if (topCats.length > 0) {
    topCatStr = topCats.map(([cat, sum]) => {
      const em = CATEGORY_EMOJIS[cat] || '📦';
      return `${em} ${cat}: <b>${sum.toLocaleString('uz-UZ').replace(/,/g, ' ')}</b>`;
    }).join('  |  ');
  }

  const quota = await checkAiQuota(userId);
  const planLabel = quota.isTrial
    ? '💎 1-Kunlik Premium Sinov'
    : quota.isPremium
      ? '⭐ VIP Premium'
      : '🆓 Bepul Tarif';

  const statsText =
    `📊 <b>Moliyaviy hisobot: ${periodTitle}</b>\n\n` +
    `🔴 <b>Xarajat:</b> ${totalExpense.toLocaleString('uz-UZ').replace(/,/g, ' ')} so'm\n` +
    `🟢 <b>Daromad:</b> ${totalIncome.toLocaleString('uz-UZ').replace(/,/g, ' ')} so'm\n` +
    (totals.borrowed ? `🤝 <b>Olingan qarz:</b> ${totals.borrowed.toLocaleString('uz-UZ')} so'm\n` : '') +
    (totals.lent ? `🤝 <b>Berilgan qarz:</b> ${totals.lent.toLocaleString('uz-UZ')} so'm\n` : '') +
    `⚖️ <b>Pul oqimi:</b> ${netSign}${balance.toLocaleString('uz-UZ').replace(/,/g, ' ')} so'm\n` +
    `📋 <b>Jami operatsiyalar:</b> ${sortedTxs.length} ta\n` +
    (topCatStr ? `🏆 <b>Top xarajatlar:</b> ${topCatStr}\n` : '') +
    `🏷 <b>Tarif:</b> ${planLabel}\n` +
    `\n──────────────────\n` +
    `📝 <b>Kiritilgan yozuvlar (${sortedTxs.length > 0 ? `${startIndex + 1}-${Math.min(startIndex + pageSize, sortedTxs.length)} / ${sortedTxs.length}` : '0'}):</b>\n\n` +
    recordsListText +
    (totalPages > 1 ? `\n\n📄 <i>Sahifa: ${currentPage} / ${totalPages}</i>` : '') +
    `\n\n👇 <i>Barcha xarajatlar tahlili va grafiklar Mini Appda!</i>`;

  // Dynamic Navigation & Filter Keyboard
  const periodRow = [
    { text: period === 'today' ? "🔘 Bugun" : "📅 Bugun", callback_data: `stats_today_1` },
    { text: period === 'month' ? "🔘 Shu oy" : "🗓️ Shu oy", callback_data: `stats_month_1` },
    { text: period === 'all' ? "🔘 Barchasi" : "📋 Barchasi", callback_data: `stats_all_1` },
  ];

  const inline_keyboard: any[] = [periodRow];

  // Pagination row if multiple pages exist
  if (totalPages > 1) {
    const pageRow: any[] = [];
    if (currentPage > 1) {
      pageRow.push({ text: `⬅️ Oldingi`, callback_data: `stats_${period}_${currentPage - 1}` });
    }
    pageRow.push({ text: `• ${currentPage} / ${totalPages} •`, callback_data: `noop` });
    if (currentPage < totalPages) {
      pageRow.push({ text: `Keyingi ➡️`, callback_data: `stats_${period}_${currentPage + 1}` });
    }
    inline_keyboard.push(pageRow);
  }

  inline_keyboard.push([
    { text: "📱 Mini Appda to'liq ko'rish 🚀", web_app: { url: appUrl } }
  ]);
  inline_keyboard.push([
    { text: "🔙 Asosiy Profil", callback_data: "view_profile" }
  ]);

  return { text: statsText, keyboard: { inline_keyboard } };
}

// ── Main Webhook Handler ─────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  applySecurityHeaders(res);
  BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();

  if (req.method === 'GET') {
    return res.status(200).json({ status: 'Moliya AI Telegram Webhook Live' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify Telegram Webhook secret token (Fail-closed with constant-time comparison)
  const webhookSecret = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  if (!webhookSecret) {
    safeError('[SECURITY] Telegram webhook secret is not configured in environment (fail-closed)');
    return res.status(500).json({ error: 'Server configuration error: Webhook secret not configured' });
  }

  const rawHeader = req.headers['x-telegram-bot-api-secret-token'];
  const incomingSecret = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (!incomingSecret || typeof incomingSecret !== 'string') {
    safeWarn('[SECURITY] Unauthorized webhook request: missing secret token header');
    return res.status(401).json({ error: 'Unauthorized: Missing secret token header' });
  }

  const secretBuffer = Buffer.from(webhookSecret);
  const incomingBuffer = Buffer.from(incomingSecret);
  if (secretBuffer.length !== incomingBuffer.length || !crypto.timingSafeEqual(secretBuffer, incomingBuffer)) {
    safeWarn('[SECURITY] Unauthorized webhook request: invalid secret token');
    return res.status(401).json({ error: 'Unauthorized: Invalid secret token' });
  }

  if (!BOT_TOKEN) {
    safeError('[SECURITY] TELEGRAM_BOT_TOKEN is not configured in environment (fail-closed)');
    return res.status(500).json({ error: 'Server configuration error: TELEGRAM_BOT_TOKEN is not configured' });
  }

  const incomingHistory: Array<{userId:string;entry:BotMessageEntry}> = [];
  async function processUpdate(res: VercelResponse) {
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

      if(typeof data==='string' && /^(txok_|txno_)[a-f0-9]{32}$/.test(data)) {
        if(String(chatId)!==tgId || !eligibleUser(userRow)) {
          await answerCallbackQuery(cb.id,'Hisobni bot orqali tasdiqlang.');
          return res.status(200).json({status:'denied'});
        }
        try {
        const result=await resolveBotDraft(userId,data.slice(5),data.startsWith('txok_')?'confirm':'cancel');
        const notice=result.status==='confirmed'?(result.replayed?'Bu yozuv avval tasdiqlangan.':'✅ Saqlandi.'):result.status==='cancelled'?'❌ Bekor qilindi.':result.status==='expired'?'Tasdiqlash muddati tugagan. Qayta yuboring.':'Bu yozuvni tasdiqlab bo‘lmadi.';
        await answerCallbackQuery(cb.id,notice);
        if(result.replayed)return res.status(200).json({status:result.status});
        const saved=result.status==='confirmed' && !result.replayed && Array.isArray(result.transactions) ? result.transactions : [];
        const card=saved.length>1?buildMultiTransactionSuccessCard(saved):saved.length===1?buildTransactionSuccessCard(saved[0],saved[0].type==='income',saved[0].id):null;
        await editTelegramMessage(chatId,cb.message.message_id,card?.text||notice,card?.keyboard||{inline_keyboard:[]},userId,'ai_response');
        return res.status(200).json({status:result.status});
        } catch(error) {
          safeError('[BOT] Confirmation failed:',error);
          await answerCallbackQuery(cb.id,'Vaqtincha xatolik. Qayta tasdiqlang.');
          return res.status(503).json({error:'BOT_CONFIRMATION_UNAVAILABLE'});
        }
      }

      if (chatId && cb.message?.message_id && data) {
        // Log user callback interaction
        incomingHistory.push({userId,entry:{
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
        }});

        // 0. Handle Language Selection (Til tanlash)
        if (data.startsWith('set_lang_')) {
          const langCode = data.replace('set_lang_', '');
          const { data: currUser } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
          const updatedOb = {
            ...(currUser?.onboarding || {}),
            language: langCode
          };
          await updateProfileSnapshot(userId, currUser, {
            language: langCode,
            onboarding: updatedOb,
            updated_at: new Date().toISOString()
          });

          await answerCallbackQuery(cb.id, "✅ Til tanlandi!");

          // Next Step: Check Oferta
          const hasOferta = acceptedConsent(currUser);
          if (!hasOferta) {
            const delivered = await sendLegalConsentRequest(chatId);
            return res.status(delivered ? 200 : 503).json({ status: delivered ? 'oferta_required' : 'legal_delivery_failed' });
          }

          // If Oferta already accepted, check phone
          const alreadyHasPhone = verifiedPhone(currUser);
          if (!alreadyHasPhone) {
            const phoneReqText =
              `🎉 <b>Til tanlandi!</b>\n\n` +
              `Endi botdan to'liq foydalanish va hisobingizni faollashtirish uchun telefon raqamingizni tasdiqlang.\n\n` +
              `<blockquote>💎 <b>1 kunlik CHEKSIZ VIP PREMIUM:</b>\n` +
              `Raqamingiz tasdiqlangach, sizga darhol bepul sinov muddati taqdim etiladi!</blockquote>\n\n` +
              `👇 <i>Pastdagi tugmani bosing va telefon raqamingizni yuboring:</i>`;

            await sendOrReplaceSystemMessage(
              chatId,
              phoneReqText,
              {
                keyboard: [[{ text: "📞 Telefon raqamni yuborish", request_contact: true }]],
                resize_keyboard: true,
                one_time_keyboard: true
              },
              userId,
              'phone_request'
            );
            return res.status(200).json({ status: 'ok' });
          }

          const quickCode = await createQuickExchangeCode(fromUser.id);
          const quickWebUrl = quickCode ? `${appUrl}?code=${quickCode}` : appUrl;
          await sendOrReplaceSystemMessage(chatId, "✅ <b>Muvaffaqiyatli faollashtirildi!</b>", getMainAppKeyboard(appUrl, quickWebUrl), userId, 'welcome_card');
          return res.status(200).json({ status: 'ok' });
        }

        // 1. Handle Oferta / Privacy Acceptance (must be handled before phone gate!)
        if (data === 'accept_oferta' || data === 'privacy_accept' || (typeof data === 'string' && data.startsWith('accept_oferta:'))) {
          if (String(chatId) !== tgId || cb.message?.chat?.type && cb.message.chat.type !== 'private') {
            await answerCallbackQuery(cb.id, 'Rozilikni shaxsiy bot chatida tasdiqlang.');
            return res.status(200).json({ status: 'denied' });
          }
          const docs = await loadLegalDocuments();
          if (data !== `accept_oferta:${docs.version.slice(7, 31)}`) {
            await answerCallbackQuery(cb.id, 'Shartlar yangilangan. Joriy matnni o‘qing.');
            const delivered = await sendLegalConsentRequest(chatId);
            return res.status(delivered ? 200 : 503).json({ status: delivered ? 'oferta_required' : 'legal_delivery_failed' });
          }
          const consentData = {
            policy_version: docs.version,
            accepted: true,
            accepted_at: new Date().toISOString(),
            source: 'telegram_button'
          };
          const { data: currUser } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
          const alreadyHasPhone = verifiedPhone(currUser);
          const updatedOb = {
            ...(currUser?.onboarding || {}),
            oferta_accepted: true,
            privacy_consent: consentData,
            completed: Boolean(alreadyHasPhone),
            registration_status: alreadyHasPhone ? 'completed' : 'oferta_accepted'
          };
          if(!currUser) throw new Error('CONSENT_USER_MISSING');
          const {error:consentError} = await updateProfileSnapshot(userId, currUser, {
            onboarding: updatedOb,
            bot_verification: {...(currUser?.bot_verification || {}),telegram_id:String(fromUser.id),consent_source:'telegram_button',consent_version:consentData.policy_version,consent_accepted_at:consentData.accepted_at},
            updated_at: new Date().toISOString()
          });
          if(consentError) throw new Error('CONSENT_SAVE_FAILED');

          await answerCallbackQuery(cb.id, "✅ Shartlar qabul qilindi!");

          // If user already has a verified phone, confirm and show main app
          if (alreadyHasPhone) {
            const pendingReqId = currUser?.device_info?.pending_login_request_id || currUser?.onboarding?.pending_login_request_id;
            if (pendingReqId) {
              try {
                await verifyAndMarkLoginRequest(pendingReqId, fromUser);
              } catch (vErr) {
                safeError('[BOT] Error auto-verifying pending login request after oferta:', vErr);
              }
            }

            const quickCode = await createQuickExchangeCode(fromUser.id);
            const quickWebUrl = quickCode ? `${appUrl}?code=${quickCode}` : appUrl;
            await sendOrReplaceSystemMessage(
              chatId,
              `✅ <b>Ommaviy oferta va shartlar qabul qilindi!</b>\n\nEndi bot va Moliya Mini Appdan to'liq foydalanishingiz mumkin.`,
              getMainAppKeyboard(appUrl, quickWebUrl),
              userId,
              'welcome_card'
            );
            return res.status(200).json({ status: 'ok' });
          }

          // Fresh user: Send phone number request card
          const phoneReqText =
            `🎉 <b>Roziligingiz qabul qilindi!</b>\n\n` +
            `Endi botdan to'liq foydalanish va hisobingizni faollashtirish uchun telefon raqamingizni tasdiqlang.\n\n` +
            `<blockquote>💎 <b>1 kunlik CHEKSIZ VIP PREMIUM:</b>\n` +
            `Raqamingiz tasdiqlangach, sizga darhol bepul sinov muddati taqdim etiladi!</blockquote>\n\n` +
            `👇 <i>Pastdagi tugmani bosing va telefon raqamingizni yuboring:</i>`;

          await sendOrReplaceSystemMessage(
            chatId,
            phoneReqText,
            {
              keyboard: [[{ text: "📞 Telefon raqamni yuborish", request_contact: true }]],
              resize_keyboard: true,
              one_time_keyboard: true
            },
            userId,
            'phone_request'
          );
          return res.status(200).json({ status: 'phone_requested' });
        }

        if (data === 'privacy_read') {
          if (String(chatId) !== tgId || (cb.message?.chat?.type && cb.message.chat.type !== 'private')) {
            await answerCallbackQuery(cb.id, 'Hujjatlarni shaxsiy bot chatida o‘qing.');
            return res.status(200).json({ status: 'denied' });
          }
          await answerCallbackQuery(cb.id);
          const delivered = await sendLegalConsentRequest(chatId);
          return res.status(delivered ? 200 : 503).json({ status: delivered ? 'oferta_required' : 'legal_delivery_failed' });
        }

        if (data === 'privacy_decline') {
          await answerCallbackQuery(cb.id, "ℹ️ Botdan foydalanish uchun shartlarga rozilik bildirish lozim.");
          return res.status(200).json({ status: 'ok' });
        }

        // 1.5 Handle 1-Tap Web Login Confirmation from Bot
        if (data.startsWith('confirm_login_req_')) {
          const reqCleanId = data.replace('confirm_login_req_', '').trim();
          const verifyResult = await verifyAndMarkLoginRequest(reqCleanId, fromUser);
          if (!verifyResult) {
            await answerCallbackQuery(cb.id, 'Kirish so‘rovi eskirgan yoki bekor qilingan. Yangisini boshlang.');
            return res.status(200).json({status:'login_request_unavailable'});
          }
          const code = verifyResult?.exchangeCode;
          const webTargetUrl = code ? `${appUrl}?code=${code}` : appUrl;

          await answerCallbackQuery(cb.id, "✅ Veb-ilovaga kirish tasdiqlandi!");
          await sendOrReplaceSystemMessage(
            chatId,
            `✅ <b>Veb-ilovaga kirish muvaffaqiyatli tasdiqlandi!</b> 🚀\n\n` +
            `Brauzeringizdagi Moliya AI sahifasi ochildi.\n\n` +
            `👇 <i>Qulay usul orqali ilovaga kiring:</i>`,
            {
              inline_keyboard: [
                [
                  { text: "🌐 Veb-Ilovani ochish", style: "primary", url: webTargetUrl },
                  { text: "📱 Moliya Mini App", style: "primary", web_app: { url: appUrl } }
                ]
              ]
            },
            userId,
            'login_card'
          );
          return res.status(200).json({ status: 'ok' });
        }

        if (data.startsWith('cancel_login_req_')) {
          const reqCleanId = data.replace('cancel_login_req_', '').trim();
          if (!/^[a-zA-Z0-9_-]{16,128}$/.test(reqCleanId)) return res.status(200).json({status:'invalid_login_request'});
          const {data:cancelled}=await supabase.from('users').update({
            device_info: { status: 'CANCELLED' },
            onboarding: { login_request_status: 'CANCELLED' },
            updated_at: new Date().toISOString()
          }).eq('id', `req_${reqCleanId}`).eq('device_info->>status','PENDING').select('id');

          if (!cancelled?.length) {
            await answerCallbackQuery(cb.id, 'Bu so‘rov allaqachon ko‘rib chiqilgan.');
            return res.status(200).json({status:'login_request_unavailable'});
          }

          await answerCallbackQuery(cb.id, "❌ Kirish so'rovi bekor qilindi");
          await sendOrReplaceSystemMessage(
            chatId,
            `❌ <b>Veb-ilovaga kirish so'rovi bekor qilindi.</b>`,
            getMainAppKeyboard(appUrl),
            userId,
            'welcome_card'
          );
          return res.status(200).json({ status: 'ok' });
        }

        // Phone verification gate for other inline buttons (cards, limit, stats, etc.)
        const userHasPhone = isValidPhoneNumber(userRow?.phone) || isValidPhoneNumber(userRow?.onboarding?.phone);
        if (!userHasPhone) {
          await answerCallbackQuery(cb.id, "⚠️ Botdan foydalanish uchun telefon raqamingizni tasdiqlang!");
          const phoneReqText =
            `⚠️ <b>Botdan to'liq foydalanish uchun telefon raqamingizni tasdiqlang:</b>\n\n` +
            `<blockquote>💎 <b>1 kunlik CHEKSIZ VIP PREMIUM:</b>\n` +
            `Raqamingiz tasdiqlangach, sizga darhol bepul sinov muddati taqdim etiladi!</blockquote>\n\n` +
            `👇 <i>Pastdagi tugmani bosing va telefon raqamingizni yuboring:</i>`;

          await sendOrReplaceSystemMessage(
            chatId,
            phoneReqText,
            {
              keyboard: [[{ text: "📞 Telefon raqamni yuborish", request_contact: true }]],
              resize_keyboard: true,
              one_time_keyboard: true
            },
            userId,
            'phone_request'
          );
          return res.status(200).json({ status: 'phone_required' });
        }

        if (data.startsWith('del_')) {
          const txId = data.replace('del_', '');
          try {
            await deleteTransaction(userId, txId);
            await answerCallbackQuery(cb.id, "🗑 Operatsiya o'chirildi!");
            await editTelegramMessage(chatId, cb.message.message_id, "🗑 <b>Operatsiya o'chirildi.</b> ✅", undefined, userId);
            return res.status(200).json({ status: 'ok' });
          } catch (delErr) {
            safeError(`[BOT] Error deleting transaction ${txId}:`, delErr);
            await answerCallbackQuery(cb.id, "❌ O'chirishda xatolik yuz berdi");
            return res.status(500).json({ error: 'DB_UPDATE_FAILED' });
          }
        }

        if (data === 'confirm_wipe_financial') {
          try {
            await wipeBotFinancialData(userId);
            await answerCallbackQuery(cb.id, "✅ Ma'lumotlar tozalandi!");
            await editTelegramMessage(
              chatId,
              cb.message.message_id,
              `✅ <b>Barcha xarajat va daromad ma'lumotlaringiz muvaffaqiyatli tozalandi!</b>\n\n` +
              `Profilingiz, telefon raqamingiz va VIP Premium obunangiz to'liq saqlanib qoldi. Yangi xarajat kiritish uchun oddiy matn yoki ovozli xabar yuborishingiz mumkin.`,
              {
                inline_keyboard: [
                  [{ text: "📱 Moliya Mini Appni ochish", web_app: { url: appUrl } }]
                ]
              },
              userId
            );
            return res.status(200).json({ status: 'ok' });
          } catch (wipeErr) {
            safeError('[BOT] Error wiping financial data via callback:', wipeErr);
            await answerCallbackQuery(cb.id, "❌ Xatolik yuz berdi");
            return res.status(500).json({ error: 'WIPE_FAILED' });
          }
        }

        if (data === 'cancel_wipe_financial') {
          await answerCallbackQuery(cb.id, "Bekor qilindi");
          await editTelegramMessage(
            chatId,
            cb.message.message_id,
            `❌ <b>Tozalash bekor qilindi.</b>\n\nBarcha ma'lumotlaringiz xavfsiz saqlanmoqda.`,
            undefined,
            userId
          );
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

        if (data.startsWith('stats_')) {
          const parts = data.split('_'); // ['stats', period, page]
          const periodParam = (parts[1] === 'today' || parts[1] === 'all') ? parts[1] : 'month';
          const pageParam = Math.max(1, parseInt(parts[2], 10) || 1);

          const { text: statsText, keyboard: statsKeyboard } = await renderStatsMessage(userId, periodParam, pageParam);
          await editTelegramMessage(chatId, cb.message.message_id, statsText, statsKeyboard, userId);
          await answerCallbackQuery(cb.id);
          return res.status(200).json({ status: 'ok' });
        }

        if (data === 'menu_stats' || data === 'view_stats') {
          const { text: statsText, keyboard: statsKeyboard } = await renderStatsMessage(userId, 'month', 1);
          await editTelegramMessage(chatId, cb.message.message_id, statsText, statsKeyboard, userId);
          await answerCallbackQuery(cb.id);
          return res.status(200).json({ status: 'ok' });
        }

        if (data === 'today_stats') {
          const { text: statsText, keyboard: statsKeyboard } = await renderStatsMessage(userId, 'today', 1);
          await editTelegramMessage(chatId, cb.message.message_id, statsText, statsKeyboard, userId);
          await answerCallbackQuery(cb.id);
          return res.status(200).json({ status: 'ok' });
        }

        if (data === 'noop') {
          await answerCallbackQuery(cb.id);
          return res.status(200).json({ status: 'ok' });
        }

        if (data === 'view_help' || data === 'menu_help') {
          const helpText = BOT_HELP_TEXT;
          const quickCode = await createQuickExchangeCode(cb.from.id);
          const quickWebUrl = quickCode ? `${appUrl}?code=${quickCode}` : appUrl;
          await editTelegramMessage(chatId, cb.message.message_id, helpText, getMainAppKeyboard(appUrl, quickWebUrl), userId);
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

    if (!fromUser || !chatId || (message.chat?.type && message.chat.type !== 'private') || String(chatId) !== String(fromUser.id)) return res.status(200).json({ status: 'invalid_chat' });

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
      userMsgText = `📄 Hujjat: ${escapeTelegramHtml(String(message.document.file_name || 'fayl'))}`;
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
    incomingHistory.push({userId,entry:{
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
    }});

    if (isBlocked) {
      await sendTelegramMessage(
        chatId,
        `⛔ <b>Hisobingiz ma'muriyat tomonidan cheklangan!</b>\n\nSiz ushbu bot va Moliya AI tizimidan foydalana olmaysiz. Cheklovni bekor qilish uchun ma'muriyat bilan bog'laning.`,
        { remove_keyboard: true },
        userId
      );
      return res.status(200).json({ status: 'restricted' });
    }

    // ── Extract any start parameter (e.g. /start req_xxxxx) ────────
    let incomingRequestId: string | null = null;
    if (text && text.startsWith('/start')) {
      const parts = text.split(' ');
      if (parts.length > 1 && parts[1]) {
        const rawArg = parts[1].trim();
        if (rawArg.startsWith('req_')) {
          incomingRequestId = rawArg.replace(/^req_/, '').trim();
        } else if (rawArg.length >= 8 && !rawArg.includes(' ') && rawArg !== 'open') {
          incomingRequestId = rawArg;
        }
      }
    }

    if (incomingRequestId) {
      // Save pending request ID to user's record so it survives the registration sequence
      const existingDev = user?.device_info || {};
      const existingOb = user?.onboarding || {};
      await updateProfileSnapshot(userId, user, {
        device_info: { ...existingDev, pending_login_request_id: incomingRequestId },
        onboarding: { ...existingOb, pending_login_request_id: incomingRequestId },
        updated_at: new Date().toISOString()
      });
    }

    // ── Handle Contact Share (Phone Number Verification) ────────
    if (message.contact) {
      deleteTelegramMessage(chatId, message.message_id).catch(() => {});

      const contact = message.contact;
      const contactUserId = contact.user_id ? String(contact.user_id) : null;
      const senderTgId = String(fromUser.id);

      if (!contactUserId || contactUserId !== senderTgId) {
        await sendOrReplaceSystemMessage(
          chatId,
          `⚠️ <b>Faqat o'zingizning shaxsiy telefon raqamingizni yuboring.</b>\n\n` +
          `<blockquote>Iltimos, pastdagi tugmani bosish orqali o'zingizning raqamingizni tasdiqlang.</blockquote>`,
          {
            keyboard: [[{ text: "📞 Telefon raqamni yuborish", request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true
          },
          userId,
          'phone_request'
        );
        return res.status(200).json({ status: 'invalid_contact' });
      }

      if (!acceptedConsent(user)) {
        const delivered = await sendLegalConsentRequest(chatId);
        return res.status(delivered ? 200 : 503).json({status:delivered ? 'oferta_required' : 'legal_delivery_failed'});
      }
      const rawPhone = contact.phone_number || '';
      const phone = rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}`;

      // If user already has a verified phone, acknowledge cleanly without duplicate messages
      const alreadyRegistered = verifiedPhone(user) && acceptedConsent(user);
      if (alreadyRegistered) {
        const pendingReq = incomingRequestId || user?.device_info?.pending_login_request_id || user?.onboarding?.pending_login_request_id;
        if (pendingReq) {
          try {
            await verifyAndMarkLoginRequest(pendingReq, fromUser);
          } catch (vErr) {
            safeError('[BOT] Error auto-verifying pending request on contact:', vErr);
          }
        }
        const removeRes = await sendTelegramMessage(chatId, `✅ <i>Telefon raqamingiz allaqachon tasdiqlangan.</i>`, { remove_keyboard: true }, userId);
        if (removeRes?.result?.message_id) {
          setTimeout(() => deleteTelegramMessage(chatId, removeRes.result.message_id).catch(() => {}), 1500);
        }
        const quickCode = await createQuickExchangeCode(fromUser.id);
        const quickWebUrl = quickCode ? `${appUrl}?code=${quickCode}` : appUrl;
        await sendOrReplaceSystemMessage(
          chatId,
          `✅ <b>Siz allaqachon ro'yxatdan o'tgansiz!</b>\n\nXarajat yozish uchun oddiy matn yuboring yoki quyidagi tugmalar orqali ilovalarga kiring.`,
          getMainAppKeyboard(appUrl, quickWebUrl),
          userId,
          'welcome_card'
        );
        return res.status(200).json({ status: 'ok' });
      }

      // Complete registration & grant 1-day trial
      await completePhoneRegistration(fromUser, phone);

      const successMsg =
        `✅ <b>Telefon tasdiqlandi</b>\n<code>${escapeTelegramHtml(phone)}</code>\n\n` +
        `📱 Moliya AI tayyor. Ilovani ochib, hisobingizni boshqaring.`;

      // Remove reply keyboard cleanly
      const removeRes = await sendTelegramMessage(chatId, "✅ <i>Telefon raqamingiz qabul qilindi.</i>", { remove_keyboard: true }, userId);
      if (removeRes?.result?.message_id) {
        setTimeout(() => deleteTelegramMessage(chatId, removeRes.result.message_id).catch(() => {}), 1500);
      }
      const quickCode = await createQuickExchangeCode(fromUser.id);
      const quickWebUrl = quickCode ? `${appUrl}?code=${quickCode}` : appUrl;
      await sendOrReplaceSystemMessage(chatId, successMsg, getMainAppKeyboard(appUrl, quickWebUrl), userId, 'welcome_card');
      return res.status(200).json({ status: 'ok' });
    }

    // ── 0. LANGUAGE SELECTION (TIL TANLASH) ───────────────────────
    const hasChosenLanguage = Boolean(user?.language || user?.onboarding?.language);

    if (!hasChosenLanguage) {
      const langText =
        `👋 <b>Moliya AI</b>ga xush kelibsiz!\n\n` +
        `🌐 Tilni tanlang · Выберите язык · Choose a language`;

      const langKeyboard = {
        inline_keyboard: [
          [
            { text: "🇺🇿 O'zbekcha (Lotin)", callback_data: "set_lang_uz" },
            { text: "🇺🇿 Ўзбекча (Кирилл)", callback_data: "set_lang_uz_cyrl" }
          ],
          [
            { text: "🇷🇺 Русский", callback_data: "set_lang_ru" },
            { text: "🇬🇧 English", callback_data: "set_lang_en" }
          ]
        ]
      };

      await sendOrReplaceSystemMessage(chatId, langText, langKeyboard, userId, 'lang_request');
      return res.status(200).json({ status: 'lang_required' });
    }

    // ── 1. OFERTA & ROZILIK (TERMS & PRIVACY) AGREEMENT ───────────
    const hasAcceptedOferta = acceptedConsent(user);

    if (!hasAcceptedOferta) {
      const delivered = await sendLegalConsentRequest(chatId);
      return res.status(delivered ? 200 : 503).json({ status: delivered ? 'oferta_required' : 'legal_delivery_failed' });
    }

    // ── 2. STRICT PHONE NUMBER REQUIREMENT & TEXT PHONE DETECTION ──
    let userHasPhone = verifiedPhone(user);

    if (!userHasPhone) {
      const phoneRequestText =
        `📞 <b>Telefon raqamingizni tasdiqlang</b>\n\n` +
        `<blockquote>Davom etish uchun o‘zingizning Telegram raqamingizni yuboring.</blockquote>\n\n` +
        `👇 Pastdagi tugmani bosing.`;

      await sendOrReplaceSystemMessage(
        chatId,
        phoneRequestText,
        {
          keyboard: [[{ text: "📞 Telefon raqamni yuborish", request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true
        },
        userId,
        'phone_request'
      );
      return res.status(200).json({ status: 'phone_required' });
    }

    // ── Command: /start or 👤 Profile / 👤 Profil / 👤 Hisobim / /profile ──
    if (text.startsWith('/start') || text === '👤 Profile' || text === '👤 Profil' || text === '👤 Hisobim' || text.startsWith('/profile')) {
      // 1. Explicit /start req_xxxx or argument from incomingRequestId
      const targetRequestId = incomingRequestId || (text.startsWith('/start') && text.trim().length > 6 ? text.replace('/start', '').trim().replace(/^req_/, '').trim() : null);

      if (targetRequestId && targetRequestId.length >= 8 && !targetRequestId.includes(' ') && targetRequestId !== 'open') {
        const verifyResult = await verifyAndMarkLoginRequest(targetRequestId, fromUser);
        if (!verifyResult) {
          await sendTelegramMessage(chatId, 'Kirish so‘rovi eskirgan yoki bekor qilingan. Veb-ilovada yangidan kirishni boshlang.', undefined, userId);
          return res.status(200).json({status:'login_request_unavailable'});
        }
        const code = verifyResult?.exchangeCode;
        const webTargetUrl = code ? `${appUrl}?code=${code}` : appUrl;

        await sendOrReplaceSystemMessage(
          chatId,
          `<b>Assalomu alaykum, ${escapeTelegramHtml(fromUser.first_name || 'foydalanuvchi')}!</b> 👋✨\n\n` +
          `✅ <b>Profilingiz va Veb-ilovaga kirish tasdiqlandi!</b> 🚀\n` +
          `Brauzeringizdagi Moliya AI sahifasi avtomatik ochildi.\n\n` +
          `👇 <i>Qulay usul orqali ilovaga kiring:</i>`,
          {
            inline_keyboard: [
              [
                { text: "🌐 Veb-Ilovani ochish", style: "primary", url: webTargetUrl },
                { text: "📱 Moliya Mini App", style: "primary", web_app: { url: appUrl } }
              ]
            ]
          },
          userId,
          'login_card'
        );
        return res.status(200).json({ status: 'ok' });
      }

      // Plain /start has no request ID. Never guess which browser to sign in.

      // If user tapped 👤 Profile, 👤 Profil, 👤 Hisobim or /profile
      if (text === '👤 Profile' || text === '👤 Profil' || text === '👤 Hisobim' || text.startsWith('/profile')) {
        const { text: profText, keyboard: profKeyboard } = await renderProfileMessage(fromUser, user, userId);
        await sendOrReplaceSystemMessage(chatId, profText, profKeyboard, userId, 'profile_card');
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
        `👋 <b>Salom, ${escapeTelegramHtml(fromUser.first_name || 'foydalanuvchi')}!</b>\n\n` +
        `<blockquote>${planLabel}\n⚡ Bugungi AI: ${quotaStatus}</blockquote>\n\n` +
        `📝 “Taksiga 25 ming” deb yozing, 🎙 ovoz yoki 📸 chek yuboring.\n` +
        `Yozuvni saqlashdan oldin tasdiqlaysiz.\n\n` +
        `👇 <b>Moliya AI</b>ni oching:`;

      const quickCode = await createQuickExchangeCode(fromUser.id);
      const quickWebUrl = quickCode ? `${appUrl}?code=${quickCode}` : appUrl;
      // Authoritative replacement so at most 1 welcome card stays in chat
      await sendOrReplaceSystemMessage(chatId, welcomeText, getMainAppKeyboard(appUrl, quickWebUrl), userId, 'welcome_card');
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
      const quickCode = await createQuickExchangeCode(fromUser.id);
      const quickWebUrl = quickCode ? `${appUrl}?code=${quickCode}` : appUrl;
      const appText =
        `🚀 <b>Moliya AI Ilovalari</b>\n\n` +
        `<blockquote>Barcha hisob-kitoblar, kartalar balansi, oylik limit, grafiklar va aqlli tahlillar bir joyda!</blockquote>\n\n` +
        `👇 <i>Kerakli ilovani tanlang:</i>`;
      const appKeyboard = {
        inline_keyboard: [
          [
            { text: "📱 Telegram Mini App", web_app: { url: appUrl } },
            { text: "🌐 Veb-Ilova (Brauzer)", url: quickWebUrl }
          ]
        ]
      };
      await sendOrReplaceSystemMessage(chatId, appText, appKeyboard, userId, 'app_card');
      return res.status(200).json({ status: 'ok' });
    }

    // ── Command: /web or /webapp or /link or 🌐 Veb-Ilova ─────────
    if (text.startsWith('/web') || text.startsWith('/webapp') || text.startsWith('/link') || text === '🌐 Veb-Ilova') {
      const quickCode = await createQuickExchangeCode(fromUser.id);
      const quickWebUrl = quickCode ? `${appUrl}?code=${quickCode}` : appUrl;
      const webText =
        `🌐 <b>Moliya AI Veb-Ilovasi</b>\n\n` +
        `Kompyuter yoki telefoningizning alohida brauzerida (Chrome, Safari, Edge va h.k.) kirish uchun quyidagi havoladan foydalaning.\n\n` +
        `<blockquote>🔒 <i>Havola hisobingizga xavfsiz avtomatik ulanadi va 15 daqiqa davomida amal qiladi.</i></blockquote>\n\n` +
        `👇 <i>Ilovaga o'tish:</i>`;
      const webKeyboard = {
        inline_keyboard: [
          [{ text: "🌐 Veb-Ilovani ochish", style: "primary", url: quickWebUrl }],
          [{ text: "📱 Telegram Mini App", web_app: { url: appUrl } }]
        ]
      };
      await sendOrReplaceSystemMessage(chatId, webText, webKeyboard, userId, 'webapp_card');
      return res.status(200).json({ status: 'ok' });
    }

    // ── Command: /help or /yordam or ❓ Help / ❓ Yordam ───────────
    if (text.startsWith('/help') || text.startsWith('/yordam') || text === '❓ Help' || text === '❓ Yordam') {
      const helpText = BOT_HELP_TEXT;

      const quickCode = await createQuickExchangeCode(fromUser.id);
      const quickWebUrl = quickCode ? `${appUrl}?code=${quickCode}` : appUrl;
      await sendOrReplaceSystemMessage(chatId, helpText, getMainAppKeyboard(appUrl, quickWebUrl), userId, 'help_card');
      return res.status(200).json({ status: 'ok' });
    }

    // ── Command: /stats or /hisobot or 📈 Stats / 📈 Statistika / 📊 Statistika ────
    const lowerText = text.toLowerCase().trim();
    if (
      lowerText.startsWith('/stats') ||
      lowerText.startsWith('/stat') ||
      lowerText.startsWith('/hisobot') ||
      lowerText === '📈 stats' ||
      lowerText === '📈 statistika' ||
      lowerText === '📊 stats' ||
      lowerText === '📊 statistika' ||
      lowerText === 'statistika' ||
      lowerText === 'hisobot'
    ) {
      deleteTelegramMessage(chatId, message.message_id).catch(() => {});
      const { text: statsText, keyboard: statsKeyboard } = await renderStatsMessage(userId, 'month', 1);
      await sendOrEditMenuMessage(chatId, userId, statsText, statsKeyboard);
      return res.status(200).json({ status: 'ok' });
    }

    // ── Command: /tozalash or /wipe or /reset ───────────────────
    if (
      lowerText.startsWith('/tozalash') ||
      lowerText.startsWith('/wipe') ||
      lowerText.startsWith('/reset') ||
      lowerText === '🗑 tozalash' ||
      lowerText === "ma'lumotlarni tozalash"
    ) {
      deleteTelegramMessage(chatId, message.message_id).catch(() => {});
      const wipeCardText =
        `⚠️ <b>Moliyaviy ma'lumotlarni tozalash</b>\n\n` +
        `Haqiqatan ham barcha kiritilgan xarajat va daromad operatsiyalaringizni tozalashni xohlaysizmi?\n\n` +
        `ℹ️ <b>Diqqat:</b>\n` +
        `• Faqat kiritilgan xarajatlar va daromadlar o'chiriladi.\n` +
        `• Sizning profilingiz, telefon raqamingiz va VIP Premium statusi saqlanib qoladi.\n` +
        `• Boshqa foydalanuvchilar hisobiga mutlaqo daxl qilmaydi.`;
      const wipeCardKb = {
        inline_keyboard: [
          [
            { text: "🗑 Ha, barcha xarajatlarni tozalash", callback_data: "confirm_wipe_financial" }
          ],
          [
            { text: "❌ Bekor qilish", callback_data: "cancel_wipe_financial" }
          ]
        ]
      };
      await sendTelegramMessage(chatId, wipeCardText, wipeCardKb, userId);
      return res.status(200).json({ status: 'ok' });
    }

    // ── Voice & Audio Message (Audio Parsing) ───────────────────
    const audioMsg = message.voice || message.audio;
    if (audioMsg) {
      // Audio boundary defense: max 120 seconds duration and max 10MB size
      if (audioMsg.duration && audioMsg.duration > 120) {
        await sendTelegramMessage(
          chatId,
          `⚠️ <b>Ovozli xabar davomiyligi 2 daqiqadan oshmasligi kerak.</b>\nIltimos, qisqaroq ovozli xabar yuboring.`,
          undefined,
          userId
        );
        return res.status(200).json({ status: 'audio_too_long' });
      }

      if (audioMsg.file_size && audioMsg.file_size > 10 * 1024 * 1024) {
        await sendTelegramMessage(
          chatId,
          `⚠️ <b>Audio fayl hajmi juda katta (maksimal 10MB).</b>`,
          undefined,
          userId
        );
        return res.status(200).json({ status: 'audio_too_large' });
      }

      // 1. Immediately send chat action and active acknowledgement status before any heavy operations
      sendChatAction(chatId, 'record_voice').catch(() => {});
      const isVoice = Boolean(message.voice);
      const statusMsg = await sendTelegramMessage(
        chatId,
        isVoice
          ? `🎙️ <b>Ovozli xabar qabul qilindi!</b>\n<i>Tahlil qilinmoqda…</i>`
          : `🎵 <b>Audio qabul qilindi!</b>\n<i>Tahlil qilinmoqda…</i>`,
        undefined,
        userId
      );
      const statusMsgId = statusMsg?.result?.message_id;

      // 2. Check AI Quota
      const quota = await checkAndRecordAiUsage(userId, 'voice', 'Telegram audio', 'telegram_bot');
      if (!quota.allowed) {
        const quotaNotice = quota.code !== 'QUOTA_EXCEEDED'
          ? '⚠️ <b>AI vaqtincha mavjud emas</b>\nKeyinroq urinib ko‘ring yoki ilovada qo‘lda kiriting.'
          : '⏳ <b>AI limiti tugadi</b>\nYozuvni ilovada qo‘lda kiritishingiz mumkin.';

        const buttons: any[] = [
          [{ text: "📱 Mini App (Qo'lda kiritish)", web_app: { url: appUrl } }]
        ];
        if (!quota.isPremium) {
          buttons.push([{ text: "⭐ VIP Premium olish", callback_data: "view_premium" }]);
        }

        if (statusMsgId) {
          await editTelegramMessage(chatId, statusMsgId, quotaNotice, { inline_keyboard: buttons }, userId);
        } else {
          await sendTelegramMessage(chatId, quotaNotice, { inline_keyboard: buttons }, userId);
        }
        return res.status(200).json({ status: 'quota_exceeded' });
      }

      sendChatAction(chatId, 'typing').catch(() => {});
      const fileUrl = await getTelegramFileUrl(audioMsg.file_id);
      if (fileUrl) {
        try {
          const audioRes = await fetch(fileUrl);
          const arrayBuffer = await audioRes.arrayBuffer();
          const audioBuffer = Buffer.from(arrayBuffer);

          if (audioBuffer.length > 10 * 1024 * 1024) {
            if (statusMsgId) {
              await editTelegramMessage(chatId, statusMsgId, "⚠️ Audio fayl hajmi 10MB dan oshmasligi kerak.", undefined, userId);
            }
            return res.status(200).json({ status: 'audio_too_large' });
          }

          // Audio file signature / magic bytes verification (OGG, MP3, M4A/AAC, WAV)
          const isOgg = audioBuffer.length >= 4 && audioBuffer.slice(0, 4).toString('ascii') === 'OggS';
          const isMp3 = audioBuffer.length >= 3 && (
            audioBuffer.slice(0, 3).toString('ascii') === 'ID3' ||
            (audioBuffer[0] === 0xFF && (audioBuffer[1] & 0xE0) === 0xE0)
          );
          const isM4a = audioBuffer.length >= 8 && audioBuffer.slice(4, 8).toString('ascii') === 'ftyp';
          const isWav = audioBuffer.length >= 12 && audioBuffer.slice(0, 4).toString('ascii') === 'RIFF' && audioBuffer.slice(8, 12).toString('ascii') === 'WAVE';

          if (!isOgg && !isMp3 && !isM4a && !isWav) {
            safeWarn('[BOT] Audio payload failed magic bytes validation');
            if (statusMsgId) {
              await editTelegramMessage(chatId, statusMsgId, "⚠️ Yuborilgan audio formati qo'llab-quvvatlanmaydi.", undefined, userId);
            } else {
              await sendTelegramMessage(chatId, "⚠️ Yuborilgan audio formati qo'llab-quvvatlanmaydi.", undefined, userId);
            }
            return res.status(200).json({ status: 'invalid_audio_format' });
          }

          const base64Audio = audioBuffer.toString('base64');

          if (statusMsgId) {
            editTelegramMessage(
              chatId,
              statusMsgId,
              `🧠 <b>Moliya AI ovozni qayta ishlamoqda...</b>\n📊 <i>Xarajat summasi hisoblanmoqda...</i>`,
              undefined,
              userId
            ).catch(() => {});
          }

          const candidateKeys = await getCandidateAiKeys();
          const envKey = process.env.GEMINI_API_KEY;
          const keysToTry = candidateKeys.length > 0
            ? candidateKeys
            : (envKey ? [{ id: 'env_gemini', api_key: envKey, name: 'ENV Key', model: 'gemini-3.6-flash' }] : []);

          // gemini-3.6-flash has superior voice/audio capabilities and lower latency
          const activeModels = ['gemini-3.6-flash', 'gemini-3.5-flash-lite'];

          const aiDeadline=Date.now()+30000;
          for (const keyObj of keysToTry) {
            const rawApiKey = (keyObj.api_key || '').trim();
            if (!rawApiKey) continue;

            const modelsToTry = [...new Set(['gemini-3.6-flash', keyObj.model, ...activeModels])].filter(Boolean);

            let parsed: any = null;
            const srvCtx = getServerDateTimeContext();
            for (const modelToUse of modelsToTry) {
              if(Date.now()>=aiDeadline)break;
              try {
                const ai = new GoogleGenAI({ apiKey: rawApiKey });
                const prompt = `Listen to this financial voice audio in Uzbek or Russian.
Include a "transcription" field containing only the verbatim words actually heard, including the amount. Never add an amount to the transcription. If unclear, use transcription:"" and amount:null. Do not estimate an amount.
Extract the transaction into JSON with these exact fields:
{"transcription":"verbatim words heard","type":"expense"|"income"|"debt"|"lending","amount":number,"category":string,"title":string,"note":string,"date":"YYYY-MM-DD","debtWho":string}
CRITICAL RULES:
- Default type is "expense".
- Spending money (taksi, ovqat, to'ladim, to'lov qildim, kurs, kontrakt, ketdi, sarfladim, xarid, bozorlik, dori, kiyim) is ALWAYS "expense".
- "kurs", "o'qish", "kontrakt", "maktab", "repetitor", "dars" is ALWAYS category "Ta'lim", type "expense".
- Only mark type="income" if words clearly indicate receiving money (maosh, oylik, daromad, stipendiya, tushdi, berishdi, topdim).
- CRITICAL FOR UZBEK NUMBERS:
  * "ming" / "минг" / "k" = THOUSAND (1,000 UZS). E.g. "500 ming" = 500000 (500 thousand, NEVER 500 million!). E.g. "30 ming" = 30000.
  * "million" / "млн" / "mln" = MILLION (1,000,000 UZS). E.g. "14 mln" = 14000000.
  * NEVER confuse "ming" with "million"!
- amount: total integer number in UZS (e.g. 500000, 25000, 50000, 14000000).
- note: Uzbek transcription of what was said in the voice note.
Today: ${srvCtx.currentDate}. Output valid JSON only.`;

                const audioResult = await generateBounded(ai,{
                  model: modelToUse,
                  contents: [
                    {
                      role: 'user',
                      parts: [
                        {
                          inlineData: {
                            mimeType: audioMsg.mime_type || (message.voice ? 'audio/ogg' : 'audio/mp3'),
                            data: base64Audio
                          }
                        },
                        { text: prompt }
                      ]
                    }
                  ],
                  config: {
                    responseMimeType: "application/json",
                    maxOutputTokens: 250,
                    temperature: 0.1
                  }
                },aiDeadline,12000);

                if (audioResult?.text) {
                  const resJson = JSON.parse(audioResult.text);
                  const voiceTranscription = typeof resJson.transcription==='string'?resJson.transcription:'';
                  if(!transactionParts(voiceTranscription) || transactionParts(voiceTranscription)!.length!==1)continue;

                  // Authoritative Check: If voice note transcription parses cleanly with Local Turbo Engine, use it!
                  if (voiceTranscription) {
                    const turboRes = parseTurboFinancialText(voiceTranscription);
                    if (turboRes && turboRes.transactions.length > 0 && turboRes.overall_confidence >= 0.85) {
                      const first = turboRes.transactions[0];
                      parsed = {
                        isValid: true,
                        type: first.type,
                        amount: first.amount,
                        currency: first.currency,
                        category: first.category,
                        name: first.description,
                        note: voiceTranscription,
                        date: first.date || srvCtx.currentDate,
                        time: first.time,
                        debtWho: first.counterparty || ''
                      };
                      recordKeyResult(keyObj.id, true).catch(() => {});
                      break;
                    }
                  }

                  const validated = validateAiFinancialOutput(resJson, normalizeUzbekFinancialText(voiceTranscription), srvCtx.currentDate);
                  if (validated.isValid && validated.amount > 0) {
                    parsed = validated;
                    recordKeyResult(keyObj.id, true).catch(() => {});
                    break;
                  }

                }
              } catch (voiceErr: any) {
                safeWarn(`[BOT] Voice model ${modelToUse} failed:`, voiceErr?.message);
                recordKeyResult(keyObj.id, false, voiceErr?.message, 'temporary').catch(() => {});
                if(!tryNextModel(voiceErr))break; // Rotate throttled keys; retain model fallback.
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

              const defaultTitle = message.voice ? 'Ovozli xarajat' : 'Audio xarajat';
              const defaultNote = message.voice ? 'Ovozli kiritilgan' : 'Audio orqali kiritilgan';

              const newTx = {
                id: txId,
                type: parsed.type || 'expense',
                name: parsed.title || parsed.note || defaultTitle,
                title: parsed.title || parsed.note || defaultTitle,
                category: parsed.category || 'Boshqa',
                amount: signedAmount,
                date: safeD.date,
                day: safeD.day,
                month: safeD.month,
                year: safeD.year,
                time: safeD.time,
                note: parsed.note || defaultNote,
                debtWho: parsed.debtWho || ''
              };

              try {
                if (statusMsgId) {
                  await editTelegramMessage(
                    chatId,
                    statusMsgId,
                    `📝 <b>Tasdiqlash uchun tayyorlanmoqda...</b>`,
                    undefined,
                    userId
                  );
                }

                await requestTransactionConfirmation(userId,chatId,message.message_id,[newTx],statusMsgId);
                return res.status(200).json({ status: 'ok' });
              } catch (saveErr) {
                safeError('[BOT] Error saving voice transaction to Supabase:', saveErr);
                if (statusMsgId) {
                  await editTelegramMessage(chatId, statusMsgId, "⚠️ Ovozli yozuv saqlanmadi. Qayta urinib ko‘ring.", undefined, userId);
                } else {
                  await sendTelegramMessage(chatId, "⚠️ Ovozli yozuv saqlanmadi. Qayta urinib ko‘ring.", undefined, userId);
                }
                return res.status(500).json({ error: 'DB_SAVE_FAILED' });
              }
            }
          }
        } catch (voiceErr) {
          safeError('[BOT] Voice/Audio parsing error:', voiceErr);
        }
      }

      const unparsedMsg = message.voice
        ? `🎙 <b>Ovozli xabar tahlil qilindi, lekin summa aniqlanmadi.</b>\n\nIltimos, xarajat summasi bilan aniqroq gapiring (masalan: <i>"taksiga 30 ming"</i>) yoki matn orqali yozing.`
        : `🎵 <b>Audio tahlil qilindi, lekin xarajat summasi aniqlanmadi.</b>\n\nIltimos, xarajat summasi bilan aniqroq gapiring yoki matn orqali yozing.`;
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
      const quota = await checkAndRecordAiUsage(userId, 'receipt', 'Telegram receipt', 'telegram_bot');
      if (!quota.allowed) {
        const quotaNotice = quota.code !== 'QUOTA_EXCEEDED'
          ? '⚠️ <b>AI vaqtincha mavjud emas</b>\nKeyinroq urinib ko‘ring yoki ilovada qo‘lda kiriting.'
          : '⏳ <b>AI limiti tugadi</b>\nYozuvni ilovada qo‘lda kiritishingiz mumkin.';

        const buttons: any[] = [
          [{ text: "📱 Mini App (Qo'lda kiritish)", web_app: { url: appUrl } }]
        ];
        if (!quota.isPremium) {
          buttons.push([{ text: "⭐ VIP Premium olish", callback_data: "view_premium" }]);
        }

        await sendTelegramMessage(chatId, quotaNotice, {
          inline_keyboard: buttons
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

          const aiDeadline=Date.now()+30000;
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
              if(Date.now()>=aiDeadline)break;
              try {
                const ai = new GoogleGenAI({ apiKey: rawApiKey });
                const prompt = `You are an OCR receipt scanner for Moliya AI. Extract receipt info into JSON:
- type: 'expense'
- amount: total integer amount paid in UZS
- category: choose best fit from ['Oziq-ovqat', 'Transport', 'Kiyim', 'Kommunal', 'Sog\\'liq', 'Ko\\'ngil ochar', 'Boshqa']
- note: store or merchant name and summary
- title: merchant name`;

                const imgResult = await generateBounded(ai,{
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
                },aiDeadline,12000);

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
                if(!tryNextModel(imgErr))break;
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
                    `📝 <b>Tasdiqlash uchun tayyorlanmoqda...</b>`,
                    undefined,
                    userId
                  );
                }

                await requestTransactionConfirmation(userId,chatId,message.message_id,[newTx],statusMsgId);
                return res.status(200).json({ status: 'ok' });
              } catch (saveErr) {
                safeError('[BOT] Error saving receipt transaction to Supabase:', saveErr);
                await sendTelegramMessage(chatId, "⚠️ Chek yozuvi saqlanmadi. Qayta urinib ko‘ring.", undefined, userId);
                return res.status(500).json({ error: 'DB_SAVE_FAILED' });
              }
            }
          }
        } catch (imgErr) {
          safeError('[BOT] Receipt parsing error:', imgErr);
        }
      }

      await sendTelegramMessage(
        chatId,
        `📸 <b>Rasm qabul qilindi.</b>\n\nAgar bu xarid cheki bo'lsa, iltimos, summasi va do'kon nomi aniq ko'rinadigan qilib qayta yuboring yoki xarajatni matn orqali yozing.`,
        {
          inline_keyboard: [
            [{ text: "📱 Moliya Mini App", style: "primary", web_app: { url: appUrl } }]
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
        `📄 <b>Hujjat qabul qilindi:</b> <code>${escapeTelegramHtml(String(message.document.file_name || 'fayl'))}</code>\n\n` +
        `Yozuv uchun matn, 🎙 ovoz yoki 📸 chek rasmini yuboring.`,
        {
          inline_keyboard: [
            [{ text: "📱 Moliya Mini App", style: "primary", web_app: { url: appUrl } }]
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
        `🎥 <b>Video tahlil qilinmaydi</b>\n\nXarajatlarni kiritish uchun matn yoki ovozli xabar yuborishingiz mumkin.`,
        {
          inline_keyboard: [
            [{ text: "📱 Moliya Mini App", style: "primary", web_app: { url: appUrl } }]
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
        `📍 <b>Joylashuvdan yozuv yaratilmaydi</b>\n\nXarajatlaringizni to'liq nazorat qilish uchun pastdagi Mini Appni oching:`,
        {
          inline_keyboard: [
            [{ text: "📱 Moliya Mini App", style: "primary", web_app: { url: appUrl } }]
          ]
        },
        userId
      );
      return res.status(200).json({ status: 'ok' });
    }

    // ── Natural Language Text (Expense, Income, or General Questions) ──
    if (text && !text.startsWith('/')) {
      if (isFinancialQuestion(text)) {
        const {data:assistantUser,error:assistantError}=await supabase.from('users')
          .select('id,language,transactions').eq('id',userId).maybeSingle();
        if(assistantError || !assistantUser) return res.status(503).json({error:'FINANCIAL_DATA_UNAVAILABLE'});
        const language=['uz','uz_cyrl','ru','en'].includes(assistantUser.language) ? assistantUser.language : 'uz';
        const reply=answerFinancialQuestion(text,Array.isArray(assistantUser.transactions)?assistantUser.transactions:[],language);
        if(reply) {
          await sendTelegramMessage(chatId,`📊 <b>Moliya yordamchisi</b>\n\n${escapeBotHtml(reply)}`,undefined,userId,'bot_response');
          return res.status(200).json({status:'financial_answer'});
        }
      }
      const intentCheck=parseTurboFinancialText(text);
      if(!transactionParts(text) && !['query_finances','general_question'].includes(intentCheck?.intent || '')){
        await sendTelegramMessage(chatId,TRANSACTION_CLARIFICATION,undefined,userId);
        return res.status(200).json({status:'needs_clarification'});
      }
      const quota = await checkAndRecordAiUsage(userId, 'text', text, 'telegram_bot');
      if (!quota.allowed) {
        const quotaNotice = quota.code !== 'QUOTA_EXCEEDED'
          ? '⚠️ <b>AI vaqtincha mavjud emas</b>\nKeyinroq urinib ko‘ring yoki ilovada qo‘lda kiriting.'
          : '⏳ <b>AI limiti tugadi</b>\nYozuvni ilovada qo‘lda kiritishingiz mumkin.';

        const buttons: any[] = [
          [{ text: "📱 Mini App (Qo'lda kiritish)", web_app: { url: appUrl } }]
        ];
        if (!quota.isPremium) {
          buttons.push([{ text: "⭐ VIP Premium olish", callback_data: "view_premium" }]);
        }

        await sendTelegramMessage(chatId, quotaNotice, {
          inline_keyboard: buttons
        }, userId);
        return res.status(200).json({ status: 'quota_exceeded' });
      }

      sendChatAction(chatId, 'typing').catch(() => {});
      const statusMsg = await sendTelegramMessage(
        chatId,
        `⏳ <b>Yozuv tahlil qilinmoqda…</b>`,
        undefined,
        userId
      );
      const statusMsgId = statusMsg?.result?.message_id;

      const parsed = await parseTextWithAi(text);

      // 1. Intent: query_finances (e.g. "balansim qancha?", "oylik xarajatim qancha bo'ldi?")
      if (parsed?.intent === 'query_finances') {
        const { text: statsText, keyboard: statsKeyboard } = await renderStatsMessage(userId);
        if (statusMsgId) {
          await editTelegramMessage(chatId, statusMsgId, statsText, statsKeyboard, userId, 'bot_response');
        } else {
          await sendTelegramMessage(chatId, statsText, statsKeyboard, userId, 'bot_response');
        }
        return res.status(200).json({ status: 'ok' });
      }

      // 2. Intent: general_question
      if (parsed?.intent === 'general_question') {
        const helpMsg =
          `💡 <b>Moliya AI yordamchisi</b>\n\n` +
          `Men daromad va xarajatlaringizni avtomatik hisoblab boraman.\n\n` +
          `📝 <b>Qanday ishlatish mumkin?</b>\n` +
          `• <b>Xarajat:</b> <i>"taksiga 25000"</i> yoki <i>"50 000 bozorlik"</i>\n` +
          `• <b>Daromad:</b> <i>"14 mln maosh tushdi"</i>\n` +
          `• <b>Ko'p operatsiya:</b> <i>"50k taksiga va 120 ming bozorlikka"</i>\n` +
          `• <b>Ovozli xabar:</b> Ovoz bilan aytib yuboring 🎙\n` +
          `• <b>Chek:</b> Xarid cheki rasmini yuboring 📸\n\n` +
          `👇 <i>Barcha hisobotlar va tahlillar uchun Mini Appni oching:</i>`;
        const helpKb = {
          inline_keyboard: [
            [{ text: "📱 Moliya Mini Appni ochish", web_app: { url: appUrl } }],
            [{ text: "👤 Profilim", callback_data: "menu_profile" }, { text: "💳 Kartalarim", callback_data: "menu_cards" }]
          ]
        };
        if (statusMsgId) {
          await editTelegramMessage(chatId, statusMsgId, helpMsg, helpKb, userId, 'bot_response');
        } else {
          await sendTelegramMessage(chatId, helpMsg, helpKb, userId, 'bot_response');
        }
        return res.status(200).json({ status: 'ok' });
      }

      // 3. Multi-Transaction (e.g. "50k taksiga va 120 ming bozorlikka")
      if (parsed?.transactions && parsed.transactions.length > 1) {
        try {
          await requestTransactionConfirmation(userId,chatId,message.message_id,parsed.transactions,statusMsgId);
                return res.status(200).json({ status: 'ok' });
        } catch (saveErr) {
          safeError('[BOT] Error saving multi-transactions to Supabase:', saveErr);
          if (statusMsgId) {
            await editTelegramMessage(chatId, statusMsgId, "⚠️ Yozuvlar saqlanmadi. Qayta urinib ko‘ring.", undefined, userId);
          } else {
            await sendTelegramMessage(chatId, "⚠️ Yozuvlar saqlanmadi. Qayta urinib ko‘ring.", undefined, userId);
          }
          return res.status(500).json({ error: 'DB_SAVE_FAILED' });
        }
      }

      // 4. Single Transaction
      if (parsed && ((parsed.amount && Number(parsed.amount) > 0) || (parsed.transactions && parsed.transactions.length === 1))) {
        const txObj = parsed.transactions?.[0] || { ...parsed, description: 'note' in parsed ? parsed.note : text, counterparty: 'debtWho' in parsed ? parsed.debtWho : '' };
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
          await requestTransactionConfirmation(userId,chatId,message.message_id,[newTx],statusMsgId);
                return res.status(200).json({ status: 'ok' });
        } catch (saveErr) {
          safeError('[BOT] Error saving text transaction to Supabase:', saveErr);
          if (statusMsgId) {
            await editTelegramMessage(chatId, statusMsgId, "⚠️ Yozuv saqlanmadi. Qayta urinib ko‘ring.", undefined, userId);
          } else {
            await sendTelegramMessage(chatId, "⚠️ Yozuv saqlanmadi. Qayta urinib ko‘ring.", undefined, userId);
          }
          return res.status(500).json({ error: 'DB_SAVE_FAILED' });
        }
      } else {
        // Helpful response for general questions, greetings, and guidance
        const fallbackHelp =
          `💡 <b>Moliya AI yordamchisi</b>\n\n` +
          `Men daromad va xarajatlaringizni avtomatik hisoblab boraman.\n\n` +
          `📝 <b>Qanday ishlatish mumkin?</b>\n` +
          `• <b>Xarajat:</b> <i>"taksiga 25000"</i> yoki <i>"50 000 bozorlik"</i>\n` +
          `• <b>Daromad:</b> <i>"14 mln maosh tushdi"</i>\n` +
          `• <b>Ko'p operatsiya:</b> <i>"50k taksiga va 120 ming bozorlikka"</i>\n` +
          `• <b>Ovozli xabar:</b> Ovoz bilan aytib yuboring 🎙\n` +
          `• <b>Chek:</b> Xarid cheki rasmini yuboring 📸\n\n` +
          `👇 <i>Barcha hisobotlar va tahlillar uchun Mini Appni oching:</i>`;
        const fallbackKb = {
          inline_keyboard: [
            [{ text: "📱 Moliya Mini Appni ochish", web_app: { url: appUrl } }],
            [{ text: "👤 Profilim", callback_data: "menu_profile" }, { text: "💳 Kartalarim", callback_data: "menu_cards" }]
          ]
        };
        if (statusMsgId) {
          await editTelegramMessage(chatId, statusMsgId, fallbackHelp, fallbackKb, userId, 'bot_response');
        } else {
          await sendTelegramMessage(chatId, fallbackHelp, fallbackKb, userId, 'bot_response');
        }
        return res.status(200).json({ status: 'ok' });
      }
    }

    return res.status(200).json({ status: 'ok' });
  } catch (err: any) {
    safeError('[BOT] Fatal handler error:', err);
    return res.status(503).json({ error: 'WEBHOOK_PROCESSING_FAILED' });
  }
  }

  const messageKey = messageDeliveryKey(req.body);
  if (!messageKey) {
    // Callback profile changes finish before history changes the same JSON.
    let status=200; let body:any={status:'ok'};
    await processUpdate({status(code:number){status=code;return this;},json(value:any){body=value;return this;}} as unknown as VercelResponse);
    for (const item of incomingHistory) await logBotMessage(item.userId,item.entry);
    return res.status(status).json(body);
  }
  let claim: Awaited<ReturnType<typeof claimBotMessage>>;
  try { claim = await claimBotMessage(messageKey); }
  catch { return res.status(503).json({error:'BOT_DELIVERY_UNAVAILABLE'}); }
  if (claim.status === 'done') return res.status(200).json({status:'duplicate'});
  if (claim.status === 'busy') return res.status(503).json({error:'BOT_MESSAGE_PROCESSING'});

  // Delay the HTTP acknowledgement until the durable completion marker commits.
  let resultStatus = 200;
  let resultBody: any = {status:'ok'};
  const bufferedRes = {
    status(code: number) {resultStatus=code;return this;},
    json(body: any) {resultBody=body;return this;}
  } as unknown as VercelResponse;
  await processUpdate(bufferedRes);
  for (const item of incomingHistory) await logBotMessage(item.userId,item.entry);
  if (resultStatus < 500) {
    try { await completeBotMessage(messageKey, claim.owner); }
    catch { return res.status(503).json({error:'BOT_DELIVERY_UNAVAILABLE'}); }
  }
  return res.status(resultStatus).json(resultBody);
}
