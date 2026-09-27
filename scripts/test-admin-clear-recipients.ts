import assert from 'node:assert/strict';

process.env.SUPABASE_URL='http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY='offline';
process.env.ADMIN_SECRET_KEY='offline-clear-key';
process.env.TELEGRAM_BOT_TOKEN='offline-bot';
const {supabase}=await import('../api/_supabaseClient.js');
const {default:handler}=await import('../api/admin.js');
const uid='moliya_user_tg_123';
const original={id:uid,telegram_id:'123',onboarding:{bot_messages:[{message_id:10,text:'keep'}],last_message_id:10}};
let rows:Record<string,any>={};
let dbReads=0,network:any[]=[];
(supabase as any).from=(table:string)=>{
  assert.equal(table,'users');let id:string|undefined,patch:any,filters:any[]=[];
  const q:any={select(){return q},eq(k:string,v:any){if(k==='id')id=v;else filters.push([k,v]);return q},is(k:string,v:any){filters.push([k,v]);return q},update(v:any){patch=v;return q},
    async maybeSingle(){dbReads++;let row=rows[id!];if(!row)return {data:null,error:null};
      if(patch){for(const [k,v] of filters)if((row[k]==null?null:typeof row[k]==='object'?JSON.stringify(row[k]):row[k])!==v)return {data:null,error:null};row=rows[id!]={...row,...patch};}
      return {data:structuredClone(row),error:null};},
    then(resolve:any,reject:any){dbReads++;return Promise.resolve({data:Object.values(rows).map(x=>structuredClone(x)),error:null}).then(resolve,reject)}
  };return q;
};
globalThis.fetch=async (url:any,opts:any)=>{const body=JSON.parse(opts.body);network.push({method:String(url).split('/').pop(),body});
  return {json:async()=>({ok:true,result:{message_id:11}})} as any;};
async function api(body:any){const req:any={method:'POST',query:{route:'clear-telegram-history'},body,headers:{'x-admin-key':'offline-clear-key'},socket:{remoteAddress:'127.0.0.1'}};
  const res:any={statusCode:200,setHeader(){},status(n:number){this.statusCode=n;return this},json(v:any){this.body=v;return this}};await handler(req,res);return res;}
async function reset(){rows={[uid]:structuredClone(original)};network=[];dbReads=0;}
await reset();
for(const body of [
  {userId:uid,telegramId:'456'},
  {userId:'moliya_user_tg_123,telegram_id.eq.456',telegramId:'123'},
  {telegramId:'123'},
  {userId:uid,telegramId:'123',messageIds:[10,'11']},
  {userId:uid,telegramId:'123',allUsers:true},
  {allUsers:'true'}
])assert.equal((await api(body)).statusCode,400);
assert.equal(dbReads,0);assert.equal(network.length,0);

rows[uid].telegram_id='456';
assert.equal((await api({userId:uid,telegramId:'123'})).statusCode,404);
assert.equal(network.length,0);
await reset();delete rows[uid];
assert.equal((await api({userId:uid})).statusCode,404);
assert.equal(network.length,0);

await reset();
const success=await api({userId:uid,telegramId:'123',messageIds:[10],sweepRecent:false});
assert.equal(success.statusCode,200);assert.equal(success.body.telegramId,'123');
assert.ok(network.length>0);assert.ok(network.every(x=>x.body.chat_id==='123'));
assert.equal(rows[uid].onboarding.bot_messages[0].tg_deleted,true);

await reset();rows.moliya_user_tg_456={id:'moliya_user_tg_456',telegram_id:'999',onboarding:{bot_messages:[]}};
const all=await api({allUsers:true});assert.equal(all.statusCode,200);
assert.equal(all.body.usersPurged,1);
assert.ok(network.every(x=>x.body.chat_id==='123'));
console.log('Admin chat clear: canonical recipient, malformed requests, and global mismatch checks passed.');
