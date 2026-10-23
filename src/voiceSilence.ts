// Energy-based pause detection, not speech recognition. Never sends before speech.
export function createPauseDetector(silenceMs=1000) {
  let voicedSince:number|null=null, lastVoice:number|null=null, heardSpeech=false, sent=false;
  return (rms:number,now:number,enabled:boolean)=>{
    if(!enabled){voicedSince=null;lastVoice=null;heardSpeech=false;return false;}
    if(sent)return false;
    if(rms>=0.018){
      if(voicedSince===null)voicedSince=now;
      if(now-voicedSince>=200)heardSpeech=true;
      lastVoice=now;
    }else {
      voicedSince=null;
      if(heardSpeech && lastVoice!==null && now-lastVoice>=silenceMs){sent=true;return true;}
    }
    return false;
  };
}

// Created during the microphone tap to unlock Web Audio on mobile browsers.
export function prepareSilenceMonitor() {
  let context:AudioContext|undefined,source:MediaStreamAudioSourceNode|undefined,analyser:AnalyserNode|undefined;
  let timer:ReturnType<typeof setInterval>|undefined;
  try {context=new AudioContext();void context.resume().catch(()=>{});}catch{}
  const stop=()=>{
    if(timer)clearInterval(timer);timer=undefined;
    source?.disconnect();analyser?.disconnect();
    if(context && context.state!=='closed')void context.close().catch(()=>{});
  };
  return {stop,start:(stream:MediaStream,enabled:()=>boolean,onPause:()=>void)=>{
    if(!context || context.state==='closed'){stop();return false;}
    if(context.state==='suspended')void context.resume().catch(()=>{});
    try {
      source=context.createMediaStreamSource(stream);analyser=context.createAnalyser();
      analyser.fftSize=2048;source.connect(analyser);
      const samples=new Float32Array(analyser.fftSize),detect=createPauseDetector();
      timer=setInterval(()=>{
        if(!analyser)return;
        analyser.getFloatTimeDomainData(samples);
        const rms=Math.sqrt(samples.reduce((total,x)=>total+x*x,0)/samples.length);
        if(detect(rms,performance.now(),enabled())){stop();onPause();}
      },50);
      return true;
    }catch{stop();return false;}
  }};
}
