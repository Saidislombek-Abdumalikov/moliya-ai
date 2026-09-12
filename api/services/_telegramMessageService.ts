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

/**
 * Log a message entry into the user's bot message history.
 * Idempotent by update_id and (message_id + direction + chat_id).
 */
export async function logBotMessage(userId: string, entry: BotMessageEntry): Promise<void> {
  if (!userId || !entry.message_id) return;
  try {
    const { data: u } = await supabase.from('users').select('onboarding').eq('id', userId).maybeSingle();
    const ob = u?.onboarding || {};
    const existingMsgs: BotMessageEntry[] = Array.isArray(ob.bot_messages) ? ob.bot_messages : [];

    // Idempotency check
    const isDuplicate = existingMsgs.some(m =>
      (entry.update_id && m.update_id === entry.update_id) ||
      (m.message_id === entry.message_id && m.direction === entry.direction && String(m.chat_id) === String(entry.chat_id))
    );
    if (isDuplicate) return;

    // Keep last 500 entries
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
    console.warn('[TelegramMessageService] logBotMessage error:', err);
  }
}

/**
 * Fetch bot message history for a user.
 */
export async function getUserMessageHistory(userId: string, limit: number = 50): Promise<BotMessageEntry[]> {
  if (!userId) return [];
  try {
    const { data: u } = await supabase.from('users').select('onboarding').eq('id', userId).maybeSingle();
    const msgs: BotMessageEntry[] = Array.isArray(u?.onboarding?.bot_messages) ? u.onboarding.bot_messages : [];
    return msgs.slice(-limit);
  } catch {
    return [];
  }
}

/**
 * DELETE TELEGRAM MESSAGE HISTORY FOR A USER.
 * 
 * STRICT BOUNDARY:
 * - Clears ONLY bot_messages: [] inside onboarding JSONB.
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

  const { data: u } = await supabase.from('users').select('onboarding').eq('id', userId).maybeSingle();
  const ob = u?.onboarding || {};
  const updatedOb = {
    ...ob,
    bot_messages: [],
    last_message_id: 0
  };

  const { error } = await supabase
    .from('users')
    .update({ onboarding: updatedOb, updated_at: nowIso })
    .eq('id', userId);

  if (error) {
    console.error(`[TelegramMessageService] Error clearing message history for ${userId}:`, error.message);
    throw error;
  }

  return {
    success: true,
    userId,
    clearedAt: nowIso
  };
}
