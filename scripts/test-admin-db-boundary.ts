import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

process.env.SUPABASE_URL='http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY='offline';
process.env.ADMIN_SECRET_KEY='offline-db-status-key';
const {supabase}=await import('../api/_supabaseClient.js');
const {default:handler}=await import('../api/admin.js');
let failed=false,reads=0;
(supabase as any).from=(table:string)=>{
  assert.equal(table,'users');
  return {select(columns:string){assert.equal(columns,'id');return this},
    async limit(limit:number){assert.equal(limit,1);reads++;return failed
      ? {data:null,error:{message:'PRIVATE_DATABASE_ERROR'}}
      : {data:[{id:'system_app_settings'}],error:null}}};
};
async function status(method='GET',key='offline-db-status-key'){
 const req:any={method,query:{route:'database-status'},headers:key?{'x-admin-key':key}:{},socket:{remoteAddress:'127.0.0.1'}};
 const res:any={statusCode:200,headers:{},setHeader(k:string,v:any){this.headers[k]=v},
   status(code:number){this.statusCode=code;return this},json(body:any){this.body=body;return this}};
 await handler(req,res);return res;
}
assert.equal((await status('GET','')).statusCode,401);
assert.equal((await status('POST')).statusCode,405);
assert.equal(reads,0);
const live=await status();
assert.equal(live.statusCode,200);
assert.deepEqual(Object.keys(live.body).sort(),['connected','latencyMs']);
assert.equal(live.headers['Cache-Control'],'private, no-store');
failed=true;
const unavailable=await status();
assert.equal(unavailable.statusCode,503);
assert.ok(!JSON.stringify(unavailable.body).includes('PRIVATE_DATABASE_ERROR'));

const root=new URL(existsSync(new URL('../../Admin-Dashboard/',import.meta.url))?'../../Admin-Dashboard/':'../../Admin-Dashboard/',import.meta.url);
const ai=await import(new URL('src/services/aiKeyService.js',root).href);
let calls:any[]=[];
globalThis.fetch=async(url:any,options:any)=>{
 calls.push([url,options]);
 return {ok:false,status:503,json:async()=>({error:'BACKEND_UNAVAILABLE'})} as any;
};
await assert.rejects(ai.createAiKey({name:'test',apiKey:'SECRET_GOOGLE_AI_KEY'}),/BACKEND_UNAVAILABLE/);
assert.equal(calls.length,1);
assert.equal(calls[0][0],'/api/admin?route=ai-keys');
assert.equal(calls[0][1].credentials,'include');
assert.equal(JSON.parse(calls[0][1].body).keyData.apiKey,'SECRET_GOOGLE_AI_KEY');
calls=[];
globalThis.fetch=async(url:any,options:any)=>{calls.push([url,options]);return {ok:true,status:200,json:async()=>({key:{id:'key_1',name:'test',key_preview:'••••ABCD'}})} as any};
assert.equal((await ai.createAiKey({name:'test',apiKey:'SECRET_GOOGLE_AI_KEY'})).id,'key_1');
assert.equal(calls.length,1);

const app=readFileSync(new URL('src/App.jsx',root),'utf8');
const settings=readFileSync(new URL('src/components/SettingsTab.jsx',root),'utf8');
const telegram=readFileSync(new URL('src/components/TelegramBotMonitoring.jsx',root),'utf8');
const service=readFileSync(new URL('src/services/userService.js',root),'utf8');
const security=readFileSync(new URL('src/utils/security.js',root),'utf8');
assert.ok(!existsSync(new URL('src/supabase.js',root)));
assert.ok(!existsSync(new URL('api/ai-router.js',root)));
assert.ok(!app.includes('Service Role Secret Key'));
assert.ok(!settings.includes('Service Role / Anon Key'));
assert.ok(!telegram.includes('postgres_changes'));
assert.ok(!service.includes('postgres_changes'));
assert.ok(settings.includes("callAdminApi('database-status')"));
assert.ok(security.includes("localStorage.removeItem('supabase_key')"));
console.log('Admin database boundary: authenticated status, no browser DB secret, and single-host AI key transport passed.');
