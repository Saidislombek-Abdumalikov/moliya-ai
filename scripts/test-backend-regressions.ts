import assert from 'node:assert/strict';
process.env.SUPABASE_URL='http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY='offline-test-placeholder';
process.env.ADMIN_SECRET_KEY='offline-test-admin-secret-not-for-deployment';
process.env.TELEGRAM_BOT_TOKEN='offline-bot-secret';
const {supabase}=await import('../api/_supabaseClient.js');
const {default:admin}=await import('../api/admin.js');
const {normalizeUzbekFinancialText,parseTurboFinancialText,validateAiFinancialOutput}=await import('../api/_uzbekFinancialNormalizer.js');
let writes:any[]=[], notificationError=false, fetchCount=0, filePath='documents/example.unknown';
let reminderUsers:any[]=[];
// Only explicit offline responses. No real database, Telegram or AI calls.
globalThis.fetch=async(url:any)=>{
 fetchCount++;
 if(String(url).includes('/getFile?')) return new Response(JSON.stringify({ok:true,result:{file_path:filePath,file_size:6}}));
 if(String(url).includes('/file/bot')) return new Response('abcdef');
 throw new Error('UNEXPECTED_NETWORK_CALL');
};
(supabase as any).from=(table:string)=>{
 let payload:any;
 const q:any={select(){return q},eq(){return q},order(){return q},range(from:number,to:number){return Promise.resolve({data:reminderUsers.slice(from,to+1),error:null})},insert(p:any){payload=p;return q},update(p:any){payload=p;return q},maybeSingle(){return Promise.resolve(result())},then(ok:any,bad:any){return Promise.resolve(result()).then(ok,bad)}};
 function result(){
  if(table==='moliya_automation_rules')return {data:{enabled:true,rule_id:'daily_reminder'},error:null};
  if(payload)writes.push({table,payload});
  return {data:table==='users'?reminderUsers:{id:'notification-1',...payload},error:notificationError&&table==='app_notifications'?{message:'offline-write-error'}:null};
 }
 return q;
};
let ip=0,count=0;
async function call(route:string,method='GET',query:any={},body:any={},headers:any={}){
 const req:any={method,query:{route,...query},body,url:'/api/admin',headers:{'x-admin-key':process.env.ADMIN_SECRET_KEY,'x-forwarded-for':'backend-test-'+(++ip),...headers}};
 const res:any={statusCode:200,headers:{},setHeader(k:string,v:any){this.headers[k]=v},status(n:number){this.statusCode=n;return this},json(v:any){this.body=v;return this},send(v:any){this.body=v;return this},end(){return this}};
 await admin(req,res);return res;
}
async function test(name:string,fn:()=>any){writes=[];notificationError=false;fetchCount=0;filePath='documents/example.unknown';await fn();count++;console.log('PASS '+name)};
await test('unknown file extension metadata does not crash or leak bot secret',async()=>{
 const r=await call('telegram-file','GET',{fileId:'test-file'});assert.equal(r.statusCode,200);assert.equal(r.body.mimeType,'application/octet-stream');assert.match(r.body.directUrl,/^\/api\/admin\?/);assert.equal(JSON.stringify(r.body).includes(process.env.TELEGRAM_BOT_TOKEN!),false);assert.equal(fetchCount,1);
});
await test('private file download is not publicly cacheable',async()=>{const r=await call('telegram-file','GET',{fileId:'test-file',download:'1'});assert.equal(r.statusCode,200);assert.equal(r.body.toString(),'abcdef');assert.equal(r.headers['Cache-Control'],'private, no-store')});
await test('valid byte range streams exact bytes',async()=>{const r=await call('telegram-file','GET',{fileId:'test-file',raw:'1'},{},{range:'bytes=1-3'});assert.equal(r.statusCode,206);assert.equal(r.body.toString(),'bcd');assert.equal(r.headers['Content-Range'],'bytes 1-3/6')});
await test('suffix byte range works',async()=>{const r=await call('telegram-file','GET',{fileId:'test-file',raw:'1'},{},{range:'bytes=-2'});assert.equal(r.statusCode,206);assert.equal(r.body.toString(),'ef')});
await test('out-of-range request returns 416',async()=>{const r=await call('telegram-file','GET',{fileId:'test-file',raw:'1'},{},{range:'bytes=999-1000'});assert.equal(r.statusCode,416)});
await test('malformed range returns 416',async()=>{const r=await call('telegram-file','GET',{fileId:'test-file',raw:'1'},{},{range:'bytes=bad-range'});assert.equal(r.statusCode,416)});
await test('notification update saves target pin and priority',async()=>{
 const r=await call('notifications','POST',{}, {action:'update',id:'notification-1',target:'all',is_pinned:true,priority:'high'});assert.equal(r.statusCode,200);assert.deepEqual(writes[0].payload,{target:'all',is_pinned:true,priority:'high'});
});
await test('notification update requires an ID',async()=>{const r=await call('notifications','POST',{}, {action:'update'});assert.equal(r.statusCode,400);assert.equal(writes.length,0)});
await test('notification DB failure is reported',async()=>{notificationError=true;const r=await call('notifications','POST',{}, {action:'update',id:'notification-1',priority:'high'});assert.equal(r.statusCode,503)});
await test('auto-broadcast with no eligible users creates no global notification',async()=>{const r=await call('auto-broadcast','POST',{}, {action:'send'});assert.equal(r.statusCode,200);assert.equal(r.body.appSaved,0);assert.equal(writes.length,0)});
await test('auto-broadcast reports a targeted in-app write failure',async()=>{
  process.env.TELEGRAM_BOT_TOKEN='';
  reminderUsers=[{id:'moliya_user_tg_123',telegram_id:'123',phone:'+998901234567',onboarding:{},transactions:[],
    bot_verification:{telegram_id:'123',phone:'+998901234567',phone_source:'telegram_own_contact',phone_verified_at:'2026-01-01',
      consent_source:'telegram_button',consent_version:'v1',consent_accepted_at:'2026-01-01'}}];
  notificationError=true;const r=await call('auto-broadcast','POST',{}, {action:'send'});assert.equal(r.statusCode,200);
  assert.equal(r.body.notificationSaved,false);assert.equal(r.body.failed,1);assert.equal(fetchCount,0);
  assert.equal(writes.find(w=>w.table==='app_notifications')?.payload[0].target,'moliya_user_tg_123');
  reminderUsers=[];
});
await test('bot normalizer preserves 50 ming amount',()=>{assert.equal(normalizeUzbekFinancialText('taksiga 50 ming').extractedAmount,50000)});
await test('bot parser returns a valid single transaction',()=>{const r=parseTurboFinancialText('taksiga 50 ming');assert.equal(r?.transactions[0].amount,50000);assert.equal(r?.transactions[0].type,'expense')});
await test('invalid AI response is rejected',()=>assert.equal(validateAiFinancialOutput(null,normalizeUzbekFinancialText('test')).isValid,false));
console.log(`\n${count} backend regression checks passed. All services mocked.`);
