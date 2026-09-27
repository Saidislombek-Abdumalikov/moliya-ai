import crypto from 'node:crypto';
import { supabase } from '../_supabaseClient.js';

export function messageDeliveryKey(update: any): string | null {
  const message = update?.message || update?.edited_message;
  const chatId = message?.chat?.id;
  const messageId = message?.message_id;
  if (!Number.isSafeInteger(chatId) || !Number.isSafeInteger(messageId) || messageId <= 0) return null;
  return `msg:${chatId}:${messageId}`;
}

export async function claimBotMessage(key: string): Promise<{status: 'claimed' | 'busy' | 'done'; owner: string}> {
  const owner = crypto.randomBytes(16).toString('hex');
  const {data,error} = await supabase.rpc('moliya_bot_message_delivery', {p_key:key,p_owner:owner,p_action:'claim'});
  if (error || !['claimed','busy','done'].includes(data)) throw new Error('BOT_DELIVERY_UNAVAILABLE');
  return {status:data,owner};
}

export async function completeBotMessage(key: string, owner: string): Promise<void> {
  const {data,error} = await supabase.rpc('moliya_bot_message_delivery', {p_key:key,p_owner:owner,p_action:'complete'});
  if (error || data !== 'done') throw new Error('BOT_DELIVERY_UNAVAILABLE');
}
