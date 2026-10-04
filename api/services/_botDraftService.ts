import {createHash} from 'node:crypto';
import {supabase} from '../_supabaseClient.js';
import {normalizeBotTransactions} from './_financialDataService.js';

async function draftRpc(userId:string,id:string,action:string,payload:any=null) {
  if(!/^moliya_user_tg_[0-9]+$/.test(userId) || !/^[a-f0-9]{32}$/.test(id))throw new Error('INVALID_BOT_DRAFT');
  const {data,error}=await supabase.rpc('moliya_bot_draft',{p_user_id:userId,p_id:id,p_action:action,p_payload:payload});
  if(error || !data || typeof data.status!=='string')throw new Error('BOT_DRAFT_UNAVAILABLE');
  return data;
}
export async function stageBotDraft(userId:string,chatId:number|string,messageId:number,items:any[]) {
  if(String(chatId)!==userId.replace('moliya_user_tg_','') || !Number.isSafeInteger(messageId) || messageId<=0 || !Array.isArray(items) || items.length<1 || items.length>10)throw new Error('INVALID_BOT_DRAFT');
  const id=createHash('sha256').update(`${userId}:${chatId}:${messageId}`).digest('hex').slice(0,32);
  const txs=normalizeBotTransactions(items.map((item,index)=>({...item,id:`tg_${id}_${index}`})));
  if(txs.some(tx=>!Number.isFinite(tx.amount) || Math.abs(tx.amount)<=0 || Math.abs(tx.amount)>1e12 || !['expense','income','debt','lending'].includes(tx.type)))throw new Error('INVALID_BOT_DRAFT');
  const result=await draftRpc(userId,id,'stage',txs);
  if(!['pending','confirmed','cancelled','expired'].includes(result.status))throw new Error('BOT_DRAFT_UNAVAILABLE');
  if(result.status==='pending' && (!Array.isArray(result.transactions) || !result.transactions.length))throw new Error('BOT_DRAFT_UNAVAILABLE');
  return {...result,id};
}
export async function resolveBotDraft(userId:string,id:string,action:'confirm'|'cancel') {
  return draftRpc(userId,id,action);
}

// Reuse the atomic draft RPC as an idempotency ledger, without a user prompt.
// A repeated Telegram message cannot recreate a deleted or already-saved entry.
export async function saveBotMessageTransactions(userId:string,chatId:number|string,messageId:number,items:any[]) {
  const draft=await stageBotDraft(userId,chatId,messageId,items);
  if(draft.status==='confirmed')return {status:'confirmed',replayed:true,transactions:[]};
  if(draft.status!=='pending')throw new Error('BOT_TRANSACTION_NOT_SAVABLE');
  const result=await resolveBotDraft(userId,draft.id,'confirm');
  if(result.status!=='confirmed')throw new Error('BOT_TRANSACTION_NOT_SAVED');
  return result;
}
