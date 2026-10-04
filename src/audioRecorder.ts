// Browser speech recognition is not consistently available in Telegram WebViews.
// Record actual audio, then encode mono WAV for the same server parser as the bot.
export function encodeWav(samples:Float32Array,rate=16000):Blob {
  const bytes=new ArrayBuffer(44+samples.length*2),v=new DataView(bytes);
  const word=(at:number,s:string)=>{for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i))};
  word(0,'RIFF');v.setUint32(4,36+samples.length*2,true);word(8,'WAVE');word(12,'fmt ');
  v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
  v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);
  word(36,'data');v.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++){const x=Math.max(-1,Math.min(1,samples[i]));v.setInt16(44+i*2,x<0?x*32768:x*32767,true)}
  return new Blob([bytes],{type:'audio/wav'});
}
export async function recordedWav(blob:Blob):Promise<Blob>{
  const ctx=new AudioContext();
  try{
    const decoded=await ctx.decodeAudioData(await blob.arrayBuffer());
    if(decoded.duration<0.25 || decoded.duration>46)throw new Error('INVALID_AUDIO');
    const offline=new OfflineAudioContext(1,Math.ceil(decoded.duration*16000),16000);
    const source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start();
    const rendered=await offline.startRendering();
    return encodeWav(rendered.getChannelData(0));
  }finally{await ctx.close()}
}
export function blobDataUrl(blob:Blob):Promise<string>{
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('FILE_READ_FAILED'));reader.readAsDataURL(blob)});
}
