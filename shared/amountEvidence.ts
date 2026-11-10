// Conservative source-text evidence. Unknown/ambiguous amounts require clarification.
export const AMOUNT_CLARIFICATION = 'Summani aniq yozing: masalan, «taksiga 30 ming so‘m». Bir nechta xarajat bo‘lsa, har birini summasi bilan alohida yuboring.';
const words:Record<string,number>={bir:1,ikki:2,uch:3,tort:4,"to'rt":4,besh:5,olti:6,yetti:7,sakkiz:8,toqqiz:9,"to'qqiz":9,on:10,"o'n":10,yigirma:20,ottiz:30,"o'ttiz":30,qirq:40,ellik:50,oltmish:60,yetmish:70,sakson:80,toqson:90,"to'qson":90,yuz:100,ming:1000,million:1000000,mln:1000000,yarim:0.5};
export function explicitAmount(source:string):number|null{
 if(typeof source!=='string' || source.length>1000)return null;
 let text=String(source||'').toLowerCase().replace(/[`ʻ‘’ʼ]/g,"'");
 if(/\b(taxmin\w*|atrofida|yoki|balki|chamasi|qariyb|or|about|approximately)\b/.test(text))return null;
 // Dates, times, phones and quantities are not money evidence.
 text=text.replace(/\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b|\b\d{1,2}:\d{2}\b/g,' ')
 .replace(/\b(?:iphone|samsung|macbook|redmi|model|modeli)\s*\d+[a-z]*\b/g,' ')
 .replace(/(?:telefon\s+raqam\w*|raqamim|tel:)\s*[+\d ()-]+/g,' ')
 .replace(/\+?998[\d ()-]{9,}/g,' ')
 .replace(/\bsoat\s+\d{1,2}(?:\s*da)?\b/g,' ')
 .replace(/\b\d{1,2}\s*-\s*(?:sana\w*|kun\w*|oy\w*|marta|sinf|kurs)\b/g,' ')
 .replace(/\b\d+(?:[.,]\d+)?\s*(?:ta|kg|gr|gramm|km|litr|dona|porsiya|pachka|kishi|odam\s+bilan|marta|para|quti|shisha|yosh|yil|kun|oy|soat|daqiqa|minut|foiz|%)\b/g,' ');
 if(/\d\s*[-–]\s*\d/.test(text))return null;
 text=text.replace(/(\d+)\s+yarim\s+(mln|million|ming)\b/g,(_,n,unit)=>`${Number(n)+0.5} ${unit}`);
 text=text.replace(/(\d+)\s*(?:mln|million)\s+(\d+)\s*ming\b/g,(_,a,b)=>String(Number(a)*1e6+Number(b)*1e3));
 const candidates:number[]=[];
 const re=/(?:[$€₽£₸]\s*)?\d+(?:[ \u00a0]\d{3})*(?:[.,]\d+)?\s*(?:(?:mln|million|ming|минг|миллион|млн|k|к|m)(?:ga|lik|dan|ta|cha)?(?![a-zа-я]))?\s*(?:so'm(?:ga|lik|dan)?|som(?:ga|lik|dan)?|sum(?:ga|lik|dan)?|uzs|сум(?:га|лик|дан)?|сўм(?:га|лик|дан)?|usd|dollar(?:ga|lik|dan)?|dollor(?:ga|lik|dan)?|доллар(?:га|лик|дан)?|eur|euro(?:ga|lik|dan)?|evro(?:ga|lik|dan)?|yevro(?:ga|lik|dan)?|евро(?:га|лик|дан)?|rub|rubl(?:ga|lik|dan)?|рубль(?:га|лик|дан)?|руб(?:га|лик|дан)?|gbp|funt(?:ga|lik|dan)?|kzt|tenge(?:ga|lik|dan)?|тенге(?:га|лик|дан)?|[$€₽£₸])?/gi;
 text=text.replace(re,(token,offset)=>{
  // Never read a number embedded in an identifier (card/model/transaction ID).
  if(/[a-zа-я_]/i.test(text[offset-1]||'') || /[a-zа-я_]/i.test(text[offset+token.trimEnd().length]||'')){candidates.push(NaN);return ' ';}
  const digits=token.match(/\d+(?:[ \u00a0]\d{3})*(?:[.,]\d+)?/)?.[0]||'';
  const compact=digits.replace(/[ \u00a0]/g,'');
  // A separator followed by three digits could mean decimal or thousands.
  if(/[.,]\d{3}$/.test(compact)){candidates.push(NaN);return ' ';}
  const n=Number(compact.replace(',','.'));
  const suffix=token.slice(token.indexOf(digits)+digits.length).trim();
  const multiplier=/^(mln|million|миллион|млн|m)(?:ga|lik|dan|ta|cha)?(?![a-z])/i.test(suffix)?1e6:/^(ming|минг|k|к)(?:ga|lik|dan|ta|cha)?(?![a-z])/i.test(suffix)?1e3:1;
  const explicitCurrency=/[$€₽£₸]|so'm|som|sum|uzs|сум|сўм|usd|dollar|dollor|доллар|eur|euro|evro|yevro|евро|rub|rubl|рубль|руб|gbp|funt|kzt|tenge|тенге/.test(token);
  if(multiplier!==1 || explicitCurrency || n>=1000)candidates.push(n*multiplier);
  else candidates.push(NaN); // Do not silently treat a small bare number as thousands.
  return ' ';
 });
 const tokens=text.match(/[a-z']+/g)||[];
 for(let i=0;i<tokens.length;i++){
  if(!(tokens[i] in words))continue;
  let total=0,current=0,hasScale=false;let j=i;
  for(;j<tokens.length && tokens[j] in words;j++){
   const v=words[tokens[j]];
   if(v===100)current=(current||1)*100;
   else if(v>=1000){total+=(current||1)*v;current=0;hasScale=true}
   else current+=v;
  }
  const value=total+current;
  if(hasScale || ["so'm",'som','sum','dollar','usd','euro','evro','yevro','rubl'].includes(tokens[j]))candidates.push(value);
  else candidates.push(NaN);
  i=j-1;
 }
 if(candidates.length!==1 || !Number.isFinite(candidates[0]) || candidates[0]<=0 || candidates[0]>1e12)return null;
 return candidates[0];
}
export function amountParts(source:string):string[]|null{
 const parts=String(source||'').trim().split(/\s+(?:va\s+yana|va|hamda|\+)\s+/i);
 return parts.length && parts.every(p=>explicitAmount(p)!==null)?parts:null;
}

// This is a conservative recording gate, not a general-purpose language classifier.
export const TRANSACTION_CLARIFICATION = '🤔 Yozuv aniq emas. Summa va amalni yozing:\n• Taksiga 30 ming sarfladim\n• 5 mln maosh oldim\n• 100 ming qarz oldim / qarz berdim\nHozircha hech narsa saqlanmadi.';
export function hasTransactionIntent(source:string):boolean {
 const text=source.toLowerCase().replace(/[`ʻ‘’ʼ]/g,"'").trim();
 if(/[?？]/.test(text) || /\b(?:qancha|necha|nima|nega|qanday|agar|ertaga|keyin|reja\w*|kerak|narx\w*|turadi|bo'ladi|bo'lsa|emas|yo'q|olmoqchi\w*|bermoqchi\w*|sarflamoqchi\w*|sarflayman|olaman|beraman|to'layman|would|could|will|price|if|not|tomorrow)\b/.test(text))return false;
 if(/\b[a-z']*(?:madim|magan|mayman|madi)\b/.test(text))return false;
 // Completed actions; longer statements still require the AI parser.
 if(/\b(?:sarfladim|ishlatdim|to'ladim|toladim|to‘ladim|toʻladim|berdim|oldim|tushdi|topdim|yechildi|ketdi|xarid\s+qildim|sotib\s+oldim|o'tkazdim|otkazdim|spent|paid|earned|received)\b/.test(text))return true;
 // Shorthand is accepted only when every non-amount word is a known label.
 const tokens=text.replace(/\b(?:men|bugun|kecha|kechagi|uchun)\b/g,' ').replace(/[.,!]/g,' ').split(/\s+/).filter(Boolean);
 const labels=new Set(['taksi','taksiga','taxi','bozor','bozorlik','bozorlikka','bozorga','non','nonga','ovqat','ovqatga','tushlik','tushlikka','obed','obedga','abet','abetga','nonushta','nonushtaga','kechki','choy','choyga','kofe','kofega','somsa','somsaga','osh','oshga','shashlik','lavash','korzinka','korzinkaga','makro','restoran','restoranga','maosh','oylik','avans','ijara','ijaraga','kvartira','kvartiraga','benzin','benzinga','metan','metanga','propan','propanga','avtobus','avtobusga','metro','metroga','yandex','yandeks','yolkira',"yo'lkira",'internet','internetga','wifi','wifiga','svet','svetga','gaz','gazga','kommunal','transport','kafe','kafega','kurs','kursga','kontrakt','kontraktga','kitob','kitobga','maktab','maktabga','dori','doriga','apteka','aptekaga','dorixona','dorixonaga','kiyim','kiyimga','kino','kinoga','fitnes','telefon','telefonga','ovqatlandim','lunch','lunchga','fastfood','fastfoodga','havas','havasga','supermarket','supermarketga','magazin','magazinga','shifoxona','shifoxonaga','doktor','doktorga','klinika','klinikaga','paynet','paynetga','gosht','goshtga',"go'sht","go'shtga"]);
 let labelCount=0;
 for(const token of tokens){
  if(labels.has(token)){labelCount++;continue;}
  if(token in words || /^(?:so'm|som|sum|uzs|usd|dollar|dollor|eur|euro|evro|yevro|rub|rubl|ming|mln|million|k|m)(?:ga|lik|dan|ta)?$/.test(token))continue;
  if(/^(?:[$€₽£₸])?\d+(?:k|m|ming|mln)?(?:ga|lik|dan)?(?:[$€₽£₸])?$/.test(token))continue;
  return false;
 }
 return labelCount===1;
}
export function transactionParts(source:string):string[]|null {
 const parts=amountParts(source);
 return parts && parts.every(hasTransactionIntent)?parts:null;
}
export function isShortTransaction(source:string):boolean {
 return !!transactionParts(source) && source.toLowerCase().replace(/\b(?:men|bugun|kecha|kechagi|uchun)\b/g,' ').trim().split(/\s+/).length<=4;
}
