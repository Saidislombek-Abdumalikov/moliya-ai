import {explicitAmount,transactionParts} from '../shared/amountEvidence.js';
import {detectCurrency} from './_currencyHelper.js';
// Two independent readings reduce transcription errors, but cannot prove what was spoken.
export function voiceAmountsAgree(first:unknown,second:unknown):boolean {
 if(typeof first!=='string'||typeof second!=='string')return false;
 if(transactionParts(first)?.length!==1 || transactionParts(second)?.length!==1)return false;
 const a=explicitAmount(first),b=explicitAmount(second);
 return a!==null && a===b && detectCurrency(first).currency===detectCurrency(second).currency;
}
export async function withVoiceProgress<T>(work:()=>Promise<T>,edit:(text:string)=>Promise<boolean>,delay=2000):Promise<T> {
 let stopped=false,index=0,timer:ReturnType<typeof setTimeout>|undefined;
 let inFlight:Promise<void>=Promise.resolve();
 const frames=['🧠 <b>Ovoz qayta ishlanmoqda.</b>','🧠 <b>Ovoz qayta ishlanmoqda..</b>','🧠 <b>Ovoz qayta ishlanmoqda...</b>'];
 const schedule=()=>{timer=setTimeout(()=>{
  inFlight=(async()=>{try {if(!stopped && !await edit(frames[index++%frames.length]))stopped=true;}catch{stopped=true;}if(!stopped)schedule();})();
 },delay);};
 schedule();
 try{return await work();}finally{stopped=true;if(timer)clearTimeout(timer);await inFlight;}
}
