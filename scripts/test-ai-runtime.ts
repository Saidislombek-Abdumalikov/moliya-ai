import assert from 'node:assert/strict';
process.env.SUPABASE_URL='http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY='offline';
process.env.GEMINI_API_KEY='';
const {supabase}=await import('../api/_supabaseClient.js');
const {getCandidateAiKeys,invalidateAiKeysCache,recordKeyResult}=await import('../api/_aiRouter.js');
const {generateBounded,tryNextModel}=await import('../api/_aiCall.js');
const {default:expense}=await import('../api/parse-expense.js');
const {default:receipt}=await import('../api/parse-receipt.js');
const token='sess_'+'a'.repeat(48),userId='moliya_user_tg_123';
const user:any={id:userId,telegram_id:'123',phone:'+998901234567',onboarding:{session_token:token,session_expires_at:new Date(Date.now()+60000).toISOString()},bot_verification:{telegram_id:'123',phone:'+998901234567',phone_source:'telegram_own_contact',phone_verified_at:'2026-01-01',consent_source:'telegram_button',consent_version:'v1',consent_accepted_at:'2026-01-01'}};
let providerBodies:any[]=[];
let keys:any[]=[],quotaCalls=0,mode='success',providerCalls:Array<{key:string;model:string}>=[];
(supabase as any).from=(table:string)=>{
 const filters:Array<[string,any]>=[];let patch:any=null;
 const result=()=>{
  if(table==='ai_logs')return {data:null,error:null};
  if(table==='ai_keys'){
   const id=filters.find(([k])=>k==='id')?.[1];const row=keys.find(k=>k.id===id);
   if(row&&patch)Object.assign(row,patch);
   return {data:id?(row||null):structuredClone(keys),error:null};
  }
  assert.equal(table,'users');
  const id=filters.find(([k])=>k==='id')?.[1];
  if(id?.startsWith('restricted_')||id==='system_app_settings')return {data:null,error:null};
  const credential=filters.find(([k])=>k==='onboarding->>session_token')?.[1];
  return {data:credential===token?structuredClone(user):null,error:null};
 };
 const q:any={select(){return q},eq(k:string,v:any){filters.push([k,v]);return q},like(){return q},update(v:any){patch=v;return q},insert(){return q},maybeSingle:async()=>result(),then(ok:any,bad:any){return Promise.resolve(result()).then(ok,bad)},
 // Reproduce a legacy ai_keys schema which has no optional priority column.
 order(){return Promise.resolve({data:null,error:{message:'column priority does not exist'}})}};
 return q;
};
(supabase as any).rpc=async(name:string)=>{assert.equal(name,'moliya_ai_quota');quotaCalls++;return {data:{allowed:true,isPremium:true,isTrial:false,usedCount:quotaCalls,limit:null},error:null};};
const response=(status:number,body:any)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
globalThis.fetch=async(input:any,options:any)=>{
 const req=input instanceof Request?input:new Request(input,options);
 assert.equal(new URL(req.url).hostname,'generativelanguage.googleapis.com','Only mocked Gemini is allowed');
 const body=await req.clone().json();providerBodies.push(body);
 assert.ok(body.generationConfig.maxOutputTokens>=2048);
 const key=req.headers.get('x-goog-api-key')||new URL(req.url).searchParams.get('key')||'';
 const model=new URL(req.url).pathname.split('/models/')[1].split(':')[0];providerCalls.push({key,model});
 if(mode==='fallback'&&model==='missing-model')return response(404,{error:{code:404,status:'NOT_FOUND',message:'404 model unavailable'}});
 if(mode==='rotate'&&key==='bad-key')return response(403,{error:{code:403,status:'PERMISSION_DENIED',message:'403 invalid API key'}});
 if(mode==='slow')await new Promise(r=>setTimeout(r,3100));
 let parsed:any={isReceipt:true,totalText:'65 000',currency:'UZS',type:'expense',amount:65000,category:'Transport',title:'Velosiped ta’miri',note:'Ta’mirlash',date:'2026-09-28'};
 const isAudio=JSON.stringify(body.contents).includes('audio/wav');
 if(isAudio){
   parsed={transcription:"10 so'm taksiga",type:'expense',amount:10,currency:'UZS',category:'Transport',needs_clarification:mode==='audio-unclear'};
 }
 if(mode==='receipt-unclear')parsed={isReceipt:false,needs_clarification:true};
 return response(200,{candidates:[{content:{role:'model',parts:[{text:JSON.stringify(parsed)}]},finishReason:'STOP'}]});
};
const key=(id:string,model='gemini-3.5-flash-lite')=>({id,name:'test',provider:'gemini',api_key:id,is_active:true,model});
function reset(rows:any[],nextMode='success'){keys=rows;mode=nextMode;providerCalls=[];providerBodies=[];invalidateAiKeysCache();}
let requestId=0;
async function call(handler:any,body:any,credential=token){
 const req:any={method:'POST',headers:{authorization:credential?'Bearer '+credential:'','x-forwarded-for':'offline-'+(++requestId)},body};
 const res:any={statusCode:200,setHeader(){},status(n:number){this.statusCode=n;return this},json(value:any){this.body=value;return this},end(){}};
 await handler(req,res);return res;
}
const text="Bugun velosiped ta'miriga 65 ming sarfladim";
reset([key('first'),key('second')]);
const initial=await getCandidateAiKeys();assert.equal(initial.length,2,'Missing priority must not hide valid keys');
const cached=await getCandidateAiKeys();await recordKeyResult('first',false,'test','temporary');
assert.deepEqual(cached.map(k=>k.id),['first','second'],'Rotation must not mutate the active iteration');
assert.deepEqual((await getCandidateAiKeys()).map(k=>k.id),['second','first']);
reset([{...key('disabled'),status:'disabled'},key('good')]);assert.deepEqual((await getCandidateAiKeys()).map(k=>k.id),['good']);
reset([key('first','missing-model')],'fallback');
let result=await call(expense,{text,userId});assert.equal(result.statusCode,200,JSON.stringify(result.body));assert.equal(result.body.amount,'65 000');assert.equal(providerCalls.length,2);assert.equal(providerCalls[0].key,providerCalls[1].key);
reset([key('bad-key'),key('good-key')],'rotate');
result=await call(expense,{text,userId});assert.equal(result.statusCode,200);assert.deepEqual(providerCalls.map(c=>c.key),['bad-key','good-key']);
reset([key('good')],'slow');result=await call(expense,{text,userId});assert.equal(result.statusCode,200,'A valid response after 3 seconds must not be abandoned');
const tinyPng='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6nXcAAAAASUVORK5CYII=';
reset([key('first','missing-model')],'fallback');result=await call(receipt,{base64Image:tinyPng,mimeType:'image/png',userId});assert.equal(result.statusCode,200);assert.equal(providerCalls.length,2);
reset([]);result=await call(expense,{text,userId});assert.equal(result.statusCode,503);assert.equal(result.body.error,'AI_NOT_CONFIGURED');
reset([key('good')]);const before=quotaCalls;
assert.equal((await call(expense,{text,userId},'')).statusCode,401);
assert.equal((await call(expense,{text,userId:'moliya_user_tg_999'})).statusCode,403);
assert.equal((await call(expense,{text:'ertaga taksiga 65 ming sarflayman',userId})).statusCode,422);
assert.equal(quotaCalls,before);assert.equal(providerCalls.length,0);

// Regression for the user's exact phrase: no provider needed, one quota check.
reset([]);result=await call(expense,{text:'400000 ishlatdim',userId});
assert.equal(result.statusCode,200);assert.equal(result.body.amount,'400 000');assert.equal(result.body.type,'expense');assert.equal(result.body.category,'Boshqa');assert.equal(providerCalls.length,0);
reset([]);result=await call(expense,{text:'Alidan 100 ming qarz oldim, ertaga qaytaraman',userId});
assert.equal(result.statusCode,200,JSON.stringify(result.body));assert.equal(result.body.type,'debt');assert.equal(result.body.amount,'100 000');assert.equal(result.body.debtWho,'Ali');
const {localDay,addDays}=await import('../shared/debts.js');assert.equal(result.body.debtDueDate,addDays(localDay(),1));assert.equal(providerCalls.length,0);
const {encodeWav}=await import('../src/audioRecorder.js');
const wav=Buffer.from(await encodeWav(new Float32Array(16000)).arrayBuffer()).toString('base64');
reset([key('voice-key')]);result=await call(expense,{base64Audio:wav,userId});
assert.equal(result.statusCode,200,JSON.stringify(result.body));assert.equal(result.body.amount,'10');assert.equal(providerCalls.length,1);
reset([key('voice-key')],'audio-unclear');result=await call(expense,{base64Audio:wav,userId});
assert.equal(result.statusCode,422);assert.equal(providerCalls.length,1,'Uncertain audio must not be retried until accepted');
reset([key('voice-key')]);const voiceQuota=quotaCalls;
assert.equal((await call(expense,{base64Audio:wav,userId},'')).statusCode,401);
assert.equal((await call(expense,{base64Audio:wav,userId:'moliya_user_tg_999'})).statusCode,403);
assert.equal((await call(expense,{base64Audio:'bm90LWF1ZGlv',userId})).statusCode,400);
assert.equal(quotaCalls,voiceQuota);assert.equal(providerCalls.length,0);
reset([key('receipt-key')],'receipt-unclear');result=await call(receipt,{base64Image:tinyPng,mimeType:'image/png',userId});assert.equal(result.statusCode,422);
reset([key('receipt-key')]);const receiptQuota=quotaCalls;
assert.equal((await call(receipt,{base64Image:tinyPng,mimeType:'image/png',userId},'')).statusCode,401);
assert.equal((await call(receipt,{base64Image:tinyPng,mimeType:'image/png',userId:'moliya_user_tg_999'})).statusCode,403);
assert.equal(quotaCalls,receiptQuota);assert.equal(providerCalls.length,0);
console.log('Text 400000 ishlatdim, authenticated audio, unclear audio, malformed audio, receipt clarity and all modality auth gates passed.');
reset([key('voice-key')]);result=await call(expense,{base64Audio:wav,userId});assert.equal(result.statusCode,200);assert.equal(providerCalls.length,1,'Audio must use one provider call');
reset([key('text-key')]);result=await call(expense,{text:'bugun kursga jami 2.5 mln pul sarfladim',userId});assert.equal(result.statusCode,200);assert.equal(result.body.amount,'2 500 000');assert.ok(JSON.stringify(providerBodies[0]).includes('2.5 mln'));assert.equal(result.body.category,"Ta'lim");
console.log('Single audio call and original decimal-multiplier prompt passed.');
let aborted=false;
const fake:any={models:{generateContent:({config}:any)=>new Promise((_resolve,reject)=>{config.abortSignal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'))},{once:true})})}};
const keepAlive=setTimeout(()=>{},200);
await assert.rejects(generateBounded(fake,{model:'test',contents:'test'},Date.now()+15),/aborted/);clearTimeout(keepAlive);assert.equal(aborted,true);
assert.equal(tryNextModel({status:404}),true);assert.equal(tryNextModel({status:403}),false);assert.equal(tryNextModel({status:429}),false);
console.log('AI runtime: legacy key schema, stable rotation, real SDK model fallback, key failover, >3s response, receipt, abort and auth/amount gates passed. Network and DB mocked; no live Gemini call.');
