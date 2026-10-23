// Unlock sound during the user's tap, before awaiting microphone permission,
// and trigger tactile vibration + audio cues on recording start/stop.
export function triggerVoiceHaptic(kind: 'start' | 'stop' | 'success' | 'error'): void {
  try {
    const tgHaptic = (globalThis as any).window?.Telegram?.WebApp?.HapticFeedback;
    if (tgHaptic) {
      if (kind === 'start') {
        tgHaptic.impactOccurred?.('medium');
      } else if (kind === 'stop') {
        tgHaptic.notificationOccurred?.('success');
      } else if (kind === 'success') {
        tgHaptic.notificationOccurred?.('success');
      } else {
        tgHaptic.notificationOccurred?.('warning');
      }
    }
  } catch {}
  try {
    const nav = (globalThis as any).navigator;
    if (typeof nav?.vibrate === 'function') {
      if (kind === 'start') nav.vibrate(45);
      else if (kind === 'stop') nav.vibrate([30, 45, 55]);
      else if (kind === 'success') nav.vibrate([25, 40, 40]);
      else nav.vibrate([60, 50, 60]);
    }
  } catch {}
}

export function playStopRecordingCue(): void {
  try {
    const Ctx = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
    if (!Ctx) return;
    const context: AudioContext = new Ctx();
    void context.resume().catch(() => {});
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.connect(gain);
    gain.connect(context.destination);
    const now = context.currentTime;
    oscillator.frequency.setValueAtTime(740, now);
    oscillator.frequency.exponentialRampToValueAtTime(520, now + 0.11);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.1, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    oscillator.start(now);
    oscillator.stop(now + 0.13);
    oscillator.onended = () => {
      void context.close().catch(() => {});
    };
    setTimeout(() => {
      if (context.state !== 'closed') void context.close().catch(() => {});
    }, 250);
  } catch {}
}

export function prepareRecordingCue(): {play:()=>Promise<void>;close:()=>void} {
  let context:AudioContext|undefined;
  try { context=new AudioContext(); void context.resume().catch(()=>{}); } catch {}
  const close=()=>{if(context && context.state!=='closed')void context.close().catch(()=>{});};
  return {close,play:async()=>{
    if(!context) { close(); return; }
    if((context.state as string)==='suspended'){
      try { await context.resume(); } catch {}
    }
    if(context.state!=='running'){close();return;}
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
