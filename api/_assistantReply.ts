import { normalizeAssistantReply } from '../shared/assistant.js';
import { explicitAmount } from '../shared/amountEvidence.js';

const copy = {
  uz: { multiple:'Iltimos, bir safarda faqat bitta tranzaksiya yuboring. Bir ovqatlanishning qismlarini birlashtirish mumkin.', amount:'Summani aniqlashtiring. Hozircha hech narsa saqlanmadi.', kind:'Bu xarajatmi, daromadmi, qarz oldingizmi yoki qarz berdingizmi?', audio:'Ovozni aniq tushunmadim. Qayta ayting yoki matn yozing.', account:'Qaysi hisob yoki kartadan to‘landi?', person:'Kim bilan qarz?', date:'Qaysi sana?', time:'Soat nechada?', currency:'Qaysi valyuta?', notSaved:'Hozircha hech narsa saqlanmadi.' },
  en: { multiple:'Please send one transaction at a time. Items from one meal can be combined.', amount:'Please clarify the amount. Nothing has been saved.', kind:'Is this an expense, income, borrowing, or lending?', audio:'I could not understand the audio clearly. Please repeat it or type it.', account:'Which account or card was used?', person:'Who is the loan with?', date:'Which date?', time:'What time?', currency:'Which currency?', notSaved:'Nothing has been saved.' },
  ru: { multiple:'Отправьте одну операцию за раз. Части одного приёма пищи можно объединить.', amount:'Уточните сумму. Пока ничего не сохранено.', kind:'Это расход, доход, вы взяли или дали в долг?', audio:'Не удалось разобрать запись. Повторите или напишите текст.', account:'С какого счёта или карты оплачено?', person:'С кем связан долг?', date:'На какую дату?', time:'В какое время?', currency:'Какая валюта?', notSaved:'Пока ничего не сохранено.' },
  uz_cyrl: { multiple:'Илтимос, бир мартада фақат битта транзакция юборинг. Бир овқатланишнинг қисмларини бирлаштириш мумкин.', amount:'Суммани аниқлаштиринг. Ҳозирча ҳеч нарса сақланмади.', kind:'Бу харажатми, даромадми, қарз олдингизми ёки қарз бердингизми?', audio:'Овозни аниқ тушунмадим. Қайта айтинг ёки матн ёзинг.', account:'Қайси ҳисоб ёки картадан тўланди?', person:'Ким билан қарз?', date:'Қайси сана?', time:'Соат нечада?', currency:'Қайси валюта?', notSaved:'Ҳозирча ҳеч нарса сақланмади.' }
};
export function assistantLanguage(user:any, requested?:unknown):keyof typeof copy {
  for (const candidate of [requested,user.onboarding?.language,user.language]) {
    if(typeof candidate==='string' && Object.hasOwn(copy,candidate))return candidate as keyof typeof copy;
  }
  return 'uz';
}

// Interpret first; enforce the single-record contract before either client can save.
// Evidence is a consistency check against the returned transcript, not an
// independent proof that the model heard the audio correctly.
export function prepareAssistantReply(raw:any, language:keyof typeof copy, audio:boolean, source='', cards:any[]=[]) {
  const c=copy[language];
  const normalize=(v:string)=>v.toLowerCase().replace(/[`ʻ‘’ʼ]/g,"'").replace(/\bmingli\b/g,'ming').replace(/\s+/g,' ').trim();
  const amountIn=(v:string)=>explicitAmount(normalize(v).replace(/(\d+)\s+ming\s+(\d{1,3})(?!\d)/g,(_,a,b)=>String(Number(a)*1000+Number(b))));
  if(!raw || !Array.isArray(raw.actions))throw Error('INVALID_AI_RESPONSE');
  let data={...raw,actions:raw.actions.map((a:any)=>({...a}))};
  const reject=(message:string)=>normalizeAssistantReply({...data,actions:[],message,question:''});
  const currentSource=String(audio?data.transcription||'':source.split('\n').at(-1)||'');
  const pricedClauses=currentSource.split(/(?:\s+(?:plyus|plus|va|hamda)\s+|\s*\+\s*)/i).map(amountIn).filter((v):v is number=>v!==null);
  const pricedSum=pricedClauses.length>1?pricedClauses.reduce((s,v)=>s+Math.round(v*100),0)/100:null;
  const combinedSingleEvent=data.actions.length===1 && pricedSum!==null &&
    ['expense','income'].includes(data.actions[0]?.kind) &&
    typeof data.actions[0]?.amount==='number' &&
    Math.abs(data.actions[0].amount-pricedSum)<0.001 &&
    !/\b(?:karta\w*|plastik\w*|taksi\w*|yo'?lkira\w*|avtobus\w*|metro\w*|maosh\w*|oylik\w*|qarz\w*)\b/i.test(currentSource);
  if(pricedClauses.length>data.actions.length && data.actions.length>0 && !combinedSingleEvent)return reject(c.multiple);
  if(data.actions.length>1){
    const a=data.actions[0];
    const sameEvent = typeof a.group==='string' && a.group.trim() &&
      ['expense','income'].includes(a.kind) && typeof a.category==='string' && a.category.trim() &&
      typeof a.account==='string' && a.account.trim() && a.account!=='unknown' &&
      typeof a.date==='string' && a.date.trim() &&
      data.actions.every((b:any)=> b.group===a.group && b.kind===a.kind && b.category===a.category &&
        b.currency===a.currency && b.date===a.date && (b.time||null)===(a.time||null) && b.account===a.account &&
        typeof b.amount==='number' && Number.isFinite(b.amount) && b.amount>0 && b.amount<=1e12 &&
        Math.abs(b.amount*100-Math.round(b.amount*100))<0.00001);
    if(!sameEvent)return reject(c.multiple);
  }
  for(const a of data.actions){
    const evidence = typeof a.amountEvidence==='string' ? a.amountEvidence : '';
    const transcript=String(audio?data.transcription||'':source);
    const transcriptAmt = data.actions.length===1 ? (amountIn(transcript) ?? (combinedSingleEvent ? pricedSum : null)) : null;
    const evidenceAmt = evidence ? amountIn(evidence) : null;
    if(evidence && !normalize(transcript).includes(normalize(evidence)) && !(transcriptAmt!==null && evidenceAmt!==null && transcriptAmt===evidenceAmt))return reject(c.amount);
    const observed=combinedSingleEvent ? pricedSum : (evidenceAmt ?? transcriptAmt);
    if(observed!==null && a.amount!==null && observed!==a.amount)return reject(c.amount);
  }
  if(data.actions.length>1){
    const amount=data.actions.reduce((sum:number,a:any)=>sum+Math.round(a.amount*100),0)/100;
    if(!Number.isFinite(amount)||amount>1e12)return reject(c.amount);
    data.actions=[{...data.actions[0],amount,title:data.actions.map((a:any)=>String(a.title||'')).join(' + ').slice(0,100)}];
  }
  for(const a of data.actions){
    if(typeof a.account==='string' && a.account.startsWith('card:') && cards.some(c=>String(c.id)===a.account.slice(5)))a.cardId=a.account.slice(5);
    else if(cards.length>0 && a.account && a.account!=='cash') { a.cardId=''; data.clarification='account'; }
    else a.cardId='cash';
  }
  let key=String(data.clarification||'');
  if((language==='uz'||language==='uz_cyrl') && /\b(?:borrow(?:ing)?|lend(?:ing)?|debt|loan)\b/i.test(String(data.question||'')))key='kind';
  if(key==='multiple')return reject(c.multiple);
  if(Object.hasOwn(c,key) && key!=='notSaved' && key!=='multiple')data.question=c[key as keyof typeof c];
  // For a transaction, all output comes from fields or a clarification, never
  // a model-written acknowledgment. This also handles unanticipated synonyms.
  if(data.actions.length)data.message='';
  else if(data.intent!=='answer'){
    data.message=c.notSaved;
    if(!data.question)data.question=audio?c.audio:c.amount;
  }
  else if(/saqla(?:dim|ndi|b)|kirit(?:dim|ildi)|yozib\s+qo|qayd\s+(?:qil|et)|\b(?:saved|recorded|logged)\b|сохран|записал/i.test(String(data.message||''))){
    data.message=c.notSaved;
    if(!data.question)data.question=audio?c.audio:c.amount;
  }
  return normalizeAssistantReply(data);
}
