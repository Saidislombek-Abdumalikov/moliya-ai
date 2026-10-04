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
