// Public financial failure codes are an explicit contract, never raw SQL/provider errors.
const financialErrors:Record<string,number>={
 INVALID_SESSION:401, SESSION_EXPIRED:401,
 ACCOUNT_RESTRICTED:403, BOT_VERIFICATION_REQUIRED:403,
 FINANCIAL_CONFLICT:409, USER_NOT_FOUND:404,
 INVALID_TRANSACTIONS:400, INVALID_TRANSACTION_ID:400, INVALID_FINANCIAL_ACTION:400,
 EXPECTED_CARDS_REQUIRED:400, EXPECTED_FINANCIAL_STATE_REQUIRED:400,
 INVALID_CARD_OPERATION:400, INVALID_CARD_ID:400, INVALID_ADJUSTMENT:400,
 FINANCIAL_STORE_UNAVAILABLE:503
};
export function publicFinancialError(error:unknown):{statusCode:number;error:string}{
 const message=(error as {message?:unknown})?.message;
 if(typeof message==='string' && Object.hasOwn(financialErrors,message))return {statusCode:financialErrors[message],error:message};
 return {statusCode:500,error:'FINANCIAL_WRITE_FAILED'};
}

// No provider responses, SQL text, credentials or user speech in public errors.
export function assistantProviderCode(error:any):string {
 const message=String(error?.message||'');
 const status=Number(error?.status||error?.code||message.match(/\b(400|401|403|404|429|500|503)\b/)?.[1]);
 if(status===429 || /RESOURCE_EXHAUSTED|quota/i.test(message))return 'AI_PROVIDER_LIMIT';
 if(status===401||status===403||/API_KEY_INVALID/i.test(message))return 'AI_PROVIDER_AUTH';
 if(status===400||status===404)return 'AI_PROVIDER_CONFIG';
 if(error?.name==='TimeoutError'||error?.name==='AbortError'||/AI_TIMEOUT|timed?\s*out/i.test(message))return 'AI_TIMEOUT';
 if(error instanceof SyntaxError||/INVALID_AI_|AI_EMPTY_RESPONSE|AI_RESPONSE_INCOMPLETE/.test(message))return 'AI_INVALID_RESPONSE';
 return 'AI_PROVIDER_UNAVAILABLE';
}
export function botAssistantFailure(error:unknown):{code:string;message:string} {
 const code=String((error as any)?.message||'');
 const messages:Record<string,string>={
  AI_NOT_CONFIGURED:'⚠️ AI sozlamasi tayyor emas. Hech narsa saqlanmadi.',
  AI_PROVIDER_LIMIT:'⏳ AI xizmatining limiti vaqtincha tugadi. Hech narsa saqlanmadi. Keyinroq urinib ko‘ring.',
  AI_PROVIDER_AUTH:'⚠️ AI ulanish kalitini tekshirish kerak. Hech narsa saqlanmadi.',
  AI_PROVIDER_CONFIG:'⚠️ AI model sozlamasini tekshirish kerak. Hech narsa saqlanmadi.',
  AI_TIMEOUT:'⏳ AI javobi kechikdi. Hech narsa saqlanmadi. Qayta urinib ko‘ring.',
  AI_INVALID_RESPONSE:'⚠️ AI tranzaksiya ma’lumotlarini to‘liq qaytarmadi. Hech narsa saqlanmadi. Qayta ayting yoki matn yozing.',
  AI_PROVIDER_UNAVAILABLE:'⚠️ AI bilan ulanishda xato. Hech narsa saqlanmadi. Keyinroq urinib ko‘ring.',
  BOT_DRAFT_UNAVAILABLE:'⚠️ Saqlash xizmatidan tasdiq olinmadi. Qayta yuborishdan oldin ilovadagi tarixni tekshiring.',
  BOT_TRANSACTION_NOT_SAVED:'⚠️ Yozuvni saqlab bo‘lmadi. Ilovadagi hisobingizni tekshiring.',
  BOT_TRANSACTION_NOT_SAVABLE:'⚠️ Bu xabarni qayta saqlab bo‘lmaydi. Ilovadagi tarixni tekshiring.',
  BOT_DELIVERY_FAILED:'⚠️ Natija xabarini yetkazib bo‘lmadi. Yozuv saqlangan bo‘lishi mumkin — ilovadagi tarixni tekshiring.',
  PROFILE_STORE_UNAVAILABLE:'⚠️ Sozlamalar yoki rejani saqlash tasdig‘i olinmadi. Ilovadagi holatni tekshiring.',
  PROFILE_CHANGED:'⚠️ Ma’lumotlar boshqa oynada o‘zgardi. Ilovadagi holatni tekshiring va qayta urinib ko‘ring.',
 };
 return Object.hasOwn(messages,code)?{code,message:messages[code]}:{code:'ASSISTANT_FLOW_FAILED',message:'⚠️ Amal yakunlangani tasdiqlanmadi. Qayta yuborishdan oldin ilovadagi tarixni tekshiring.'};
}
