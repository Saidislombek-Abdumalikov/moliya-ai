import assert from 'node:assert/strict';
process.env.SUPABASE_URL='http://127.0.0.1:54321';process.env.SUPABASE_SERVICE_ROLE_KEY='offline-placeholder';process.env.ADMIN_SECRET_KEY='offline-admin-secret-not-for-deployment';process.env.TELEGRAM_BOT_TOKEN='offline-bot-token';
const {supabase}=await import('../api/_supabaseClient');
const {default:admin}=await import('../api/admin');
const {publicFinancialError}=await import('../api/_apiErrors');
const internal='PRIVATE_DATABASE_SCHEMA private-token https://upstream.example/?key=private-key';
(supabase as any).from=()=>{const q:any={select(){return q},eq(){return q},order(){return q},limit(){return q},range(){return q},update(){return q},maybeSingle(){return Promise.resolve({data:null,error:{message:internal}})},then(ok:any,bad:any){return Promise.resolve({data:null,error:{message:internal}}).then(ok,bad)}};return q;};
globalThis.fetch=async()=>new Response(JSON.stringify({ok:false,description:internal}));
let count=0;
async function test(name:string,fn:()=>any){await fn();count++;console.log('PASS '+name)};
async function call(route:string,method='GET'){const req:any={method,query:{route,fileId:'test-file',userId:'moliya_user_tg_123'},headers:{'x-admin-key':process.env.ADMIN_SECRET_KEY},body:{action:'reset'},socket:{remoteAddress:'192.0.2.40'}};const res:any={statusCode:200,setHeader(){},status(n:number){this.statusCode=n;return this},json(x:any){this.body=x;return this}};await admin(req,res);return res;}
for(const route of ['users','app-settings','notifications','bot-messages','audit-log'])await test(route+' hides database failure details',async()=>{const r=await call(route);assert.equal(r.statusCode,route==='users'?503:500);assert.equal(JSON.stringify(r.body).includes('PRIVATE_DATABASE_SCHEMA'),false);assert.equal(r.body.details,undefined);assert.equal(JSON.stringify(r.body).includes('private-key'),false)});
await test('Telegram file error does not echo provider response',async()=>{const r=await call('telegram-file');assert.equal(r.statusCode,404);assert.equal(r.body.details,undefined);assert.equal(JSON.stringify(r.body).includes('private-key'),false)});
await test('financial conflict remains actionable',()=>assert.deepEqual(publicFinancialError(new Error('FINANCIAL_CONFLICT')),{statusCode:409,error:'FINANCIAL_CONFLICT'}));
await test('unknown financial error and status are hidden',()=>assert.deepEqual(publicFinancialError({message:internal,statusCode:200}),{statusCode:500,error:'FINANCIAL_WRITE_FAILED'}));
await test('database outage preserves retryable status',()=>assert.deepEqual(publicFinancialError(new Error('FINANCIAL_STORE_UNAVAILABLE')),{statusCode:503,error:'FINANCIAL_STORE_UNAVAILABLE'}));
console.log(`${count} API error disclosure checks passed. No live services called.`);
