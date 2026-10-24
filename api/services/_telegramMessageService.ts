import { updateProfileSnapshot } from './_profileWriteService.js';
import { safeWarn, safeError } from '../_logger.js';
import { supabase } from '../_supabaseClient.js';

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

// Chat history lives in public.moliya_bot_messages (migration 25), one row per
// message, so profile reads/writes no longer carry the whole history.
const TABLE = 'moliya_bot_messages';

/**
 * Log a message entry into the user's bot message history.
 * Idempotent by update_id and (message_id + direction + chat_id); merging,
 * the 500-message cap and last_message_id happen in one database call.
 */
export async function logBotMessage(userId: string, entry: BotMessageEntry): Promise<void> {
  if (!userId || !entry.message_id) return;
  try {
    const { error } = await supabase.rpc('moliya_log_bot_message', { p_user_id: userId, p_entry: entry });
    if (error) safeWarn('[TelegramMessageService] logBotMessage error:', error.message);
  } catch (err) {
    safeWarn('[TelegramMessageService] logBotMessage error:', err);
  }
}

/** Oldest-first history, newest `limit` messages. Throws when the store is unavailable. */
export async function listBotMessages(userId: string, limit: number = 500): Promise<any[]> {
  const { data, error } = await supabase.from(TABLE).select('entry').eq('user_id', userId)
    .order('created_at', { ascending: false }).order('message_id', { ascending: false, nullsFirst: false }).limit(limit);
  if (error) throw Object.assign(new Error('MESSAGE_STORE_UNAVAILABLE'), { statusCode: 503 });
  return (data || []).map((row: any) => row.entry).reverse();
}

/** Insert or fully replace one stored entry (admin notices, edits, delete marks). */
export async function saveBotMessageEntry(userId: string, entry: any): Promise<void> {
  const messageId = Number(entry.message_id ?? entry.messageId);
  const { error } = await supabase.from(TABLE).upsert({
    user_id: userId, id: String(entry.id), entry,
    chat_id: entry.chat_id != null ? String(entry.chat_id) : null,
    message_id: Number.isInteger(messageId) && messageId > 0 ? messageId : null,
    direction: entry.direction ?? null,
    created_at: entry.timestamp || new Date().toISOString(),
  }, { onConflict: 'user_id,id' });
  if (error) throw Object.assign(new Error('MESSAGE_STORE_UNAVAILABLE'), { statusCode: 503 });
}

export async function deleteBotMessageEntry(userId: string, id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('user_id', userId).eq('id', id);
  if (error) throw Object.assign(new Error('MESSAGE_STORE_UNAVAILABLE'), { statusCode: 503 });
}

/** Mark every stored message as deleted in Telegram (kept for Admin audit). Returns how many. */
export async function markBotMessagesDeleted(userId: string, atIso: string): Promise<number> {
  const messages = await listBotMessages(userId);
  for (const m of messages) if (!m.tg_deleted) await saveBotMessageEntry(userId, { ...m, tg_deleted: true, tg_deleted_at: atIso });
  return messages.length;
}

export async function clearBotMessages(userId: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('user_id', userId);
  if (error) throw Object.assign(new Error('MESSAGE_STORE_UNAVAILABLE'), { statusCode: 503 });
}

/** Telegram message ids the bot knows about for this user (for chat cleanup). */
export async function storedTelegramMessageIds(userId: string): Promise<number[]> {
  const ids = new Set<number>();
  for (const m of await listBotMessages(userId)) {
    const id = Number(m.message_id || m.messageId || (typeof m.id === 'string' && m.id.split('_').pop()));
    if (Number.isInteger(id) && id > 0) ids.add(id);
  }
  return [...ids];
}

/**
 * Fetch bot message history for a user.
 */
export async function getUserMessageHistory(userId: string, limit: number = 50): Promise<BotMessageEntry[]> {
  if (!userId) return [];
  try {
    return await listBotMessages(userId, limit);
  } catch {
    return [];
  }
}

/**
 * DELETE TELEGRAM MESSAGE HISTORY FOR A USER.
 *
 * STRICT BOUNDARY:
 * - Clears ONLY the user's stored bot messages.
 * - Does NOT touch financial records (transactions/cards).
 * - Does NOT touch premium.
 * - Does NOT touch user account or credentials.
 * - Does NOT touch user files.
 * - Does NOT touch Telegram identity.
 */
export async function deleteTelegramMessageHistory(userId: string): Promise<{
  success: boolean;
  userId: string;
  clearedAt: string;
}> {
  if (!userId) throw new Error('userId is required for deleteTelegramMessageHistory');

  const nowIso = new Date().toISOString();

  await clearBotMessages(userId);
  const { data: u } = await supabase.from('users').select('onboarding, profile_version').eq('id', userId).maybeSingle();
  const ob = u?.onboarding || {};
  const updatedOb = {
    ...ob,
    last_message_id: 0
  };
  delete (updatedOb as any).bot_messages;

  const { error } = await updateProfileSnapshot(userId, u, { onboarding: updatedOb, updated_at: nowIso });

  if (error) {
    safeError(`[TelegramMessageService] Error clearing message history for ${userId}:`, error.message);
    throw error;
  }

  return {
    success: true,
    userId,
    clearedAt: nowIso
  };
}

/** One stored entry by Telegram message id (null when missing or the store fails). */
export async function findBotMessage(userId: string, messageId: number): Promise<any | null> {
  if (!Number.isInteger(messageId) || messageId <= 0) return null;
  const { data, error } = await supabase.from(TABLE).select('entry').eq('user_id', userId).eq('message_id', messageId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  return error ? null : (data?.entry ?? null);
}
