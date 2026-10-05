// Unlock sound during the user's tap, before awaiting microphone permission.
export function prepareRecordingCue(): {play:()=>Promise<void>;close:()=>void} {
  let context:AudioContext|undefined;
  try { context=new AudioContext(); void context.resume().catch(()=>{}); } catch {}
  const close=()=>{if(context && context.state!=='closed')void context.close().catch(()=>{});};
  return {close,play:async()=>{
    if(!context || context.state!=='running'){close();return;}
    try {
      const oscillator=context.createOscillator(),gain=context.createGain();
      oscillator.connect(gain);gain.connect(context.destination);
      oscillator.frequency.value=880;
      const now=context.currentTime;
      gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(0.12,now+0.015);
      gain.gain.exponentialRampToValueAtTime(0.001,now+0.12);
      oscillator.start(now);oscillator.stop(now+0.13);
      await new Promise<void>(resolve=>{const timer=setTimeout(resolve,200);oscillator.onended=()=>{clearTimeout(timer);resolve();};});
    } catch {} finally {close();}
  }};
}
