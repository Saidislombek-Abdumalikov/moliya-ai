import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
process.env.SUPABASE_URL='http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY='offline-placeholder';
const {supabase}=await import('../api/_supabaseClient.js');
const {saveTransactions,deleteTransaction,wipeBotFinancialData}=await import('../api/services/_financialDataService.js');
const {default:auth}=await import('../api/auth.js');
globalThis.fetch=async()=>{throw new Error('NETWORK_FORBIDDEN');};
const db=new PGlite();
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE public.users(id text PRIMARY KEY, telegram_id text, phone text, onboarding jsonb DEFAULT '{}', device_info jsonb DEFAULT '{}', bot_verification jsonb, is_blocked boolean DEFAULT false, is_restricted boolean DEFAULT false, is_deleted boolean DEFAULT false, account_status text, transactions jsonb DEFAULT '[]',cards jsonb DEFAULT '[]',updated_at timestamptz);`);
const sql=await readFile(new URL('../migrations/03-financial-writes.sql',import.meta.url),'utf8');
await db.exec(sql);await db.exec(sql);
const cardSql=await readFile(new URL('../migrations/04-atomic-card-operations.sql',import.meta.url),'utf8');
await db.exec(cardSql);await db.exec(cardSql);
const eligibilitySql=await readFile(new URL('../migrations/06-financial-eligibility.sql',import.meta.url),'utf8');
await db.exec(eligibilitySql);await db.exec(eligibilitySql);
const token='sess_'+'a'.repeat(48);
const sessionSql=await readFile(new URL('../migrations/07-session-financial-writes.sql',import.meta.url),'utf8');
await db.exec(sessionSql);await db.exec(sessionSql);
const destructiveSql=await readFile(new URL('../migrations/08-destructive-user-actions.sql',import.meta.url),'utf8');
await db.exec(destructiveSql);await db.exec(destructiveSql);
const id='moliya_user_tg_123';
const old={id:'old',amount:100,type:'expense'};
async function seed(){await db.exec('TRUNCATE users');await db.query('INSERT INTO users(id,transactions,cards) VALUES ($1,$2,$3),($4,$5,$6)',[id,JSON.stringify([old]),JSON.stringify([{id:'cash',balance:100}]),'moliya_user_tg_456','[]','[]']);
 await db.exec(`UPDATE users SET telegram_id=replace(id,'moliya_user_tg_',''),phone='+998901234567',bot_verification=jsonb_build_object('telegram_id',replace(id,'moliya_user_tg_',''),'phone','+998901234567','phone_source','telegram_own_contact','phone_verified_at','2026-01-01','consent_source','telegram_button','consent_version','1','consent_accepted_at','2026-01-01')`);
 await db.query('UPDATE users SET onboarding=$1',[JSON.stringify({session_token:token,session_expires_at:'2099-01-01'})]);
}
async function sessionWrite(action:string,payload:any,expected:any=null,uid=id,credential:any=token):Promise<any>{return (await db.query<any>('SELECT public.moliya_session_financial_write($1,$2,$3,$4::jsonb,$5::jsonb) AS result',[uid,credential,action,JSON.stringify(payload),expected===null?null:JSON.stringify(expected)])).rows[0].result;}
async function write(action:string,payload:any,expected:any=null,uid=id):Promise<any>{return (await db.query<any>('SELECT public.moliya_financial_write($1,$2,$3::jsonb,$4::jsonb) AS result',[uid,action,JSON.stringify(payload),expected===null?null:JSON.stringify(expected)])).rows[0].result;}
async function row(uid=id){return (await db.query<any>('SELECT * FROM users WHERE id=$1',[uid])).rows[0];}
let count=0;
async function test(name:string,fn:()=>any){await seed();await fn();count++;console.log('PASS '+name)};
await test('50 submitted appends preserve every existing and new record',async()=>{const r=await Promise.all(Array.from({length:50},(_,i)=>write('append_transactions',[{id:'new-'+i,amount:i+1}])));assert.equal(r.filter(x=>x.success).length,50);assert.equal((await row()).transactions.length,51)});
await test('web put and bot append coexist',async()=>{await Promise.all([write('put_transaction',{id:'web',amount:3}),write('append_transactions',[{id:'bot',amount:-4}])]);assert.deepEqual(new Set((await row()).transactions.map((x:any)=>x.id)),new Set(['old','web','bot']))});
await test('same request ID replay does not duplicate',async()=>{const tx={id:'once',amount:5};await Promise.all([write('put_transaction',tx),write('put_transaction',tx)]);assert.equal((await row()).transactions.filter((x:any)=>x.id==='once').length,1)});
await test('conflicting same-ID append never overwrites',async()=>{assert.equal((await write('append_transactions',[{...old,amount:999}])).statusCode,409);assert.deepEqual((await row()).transactions,[old])});
await test('batch conflict rolls back all new items',async()=>{assert.equal((await write('append_transactions',[{id:'new',amount:1},{...old,amount:999}])).statusCode,409);assert.deepEqual((await row()).transactions,[old])});
await test('concurrent edits reject the stale version',async()=>{const results=await Promise.all([write('put_transaction',{...old,amount:2},old),write('put_transaction',{...old,amount:3},old)]);assert.equal(results.filter(x=>x.success).length,1);assert.equal(results.filter(x=>x.statusCode===409).length,1)});
await test('delete does not erase concurrent unrelated append',async()=>{await Promise.all([write('delete_transaction',{id:'old'},old),write('append_transactions',[{id:'new',amount:4}])]);assert.deepEqual((await row()).transactions,[{id:'new',amount:4}])});
await test('stale edit cannot resurrect a deleted transaction',async()=>{await write('delete_transaction',{id:'old'});assert.equal((await write('put_transaction',{...old,amount:2},old)).statusCode,409);assert.deepEqual((await row()).transactions,[])});
await test('stale delete does not remove an updated transaction',async()=>{await write('put_transaction',{...old,amount:2},old);assert.equal((await write('delete_transaction',{id:'old'},old)).statusCode,409);assert.equal((await row()).transactions[0].amount,2)});
await test('replayed delete is harmless',async()=>{await write('delete_transaction',{id:'old'});assert.equal((await write('delete_transaction',{id:'old'})).success,true)});
await test('concurrent card snapshots conflict rather than overwrite',async()=>{const original=(await row()).cards;const r=await Promise.all([write('replace_cards',[{id:'a'}],original),write('replace_cards',[{id:'b'}],original)]);assert.equal(r.filter(x=>x.success).length,1);assert.equal(r.filter(x=>x.statusCode===409).length,1)});
await test('card save cannot overwrite concurrent transactions',async()=>{await Promise.all([write('replace_cards',[],(await row()).cards),write('append_transactions',[{id:'new',amount:4}])]);assert.equal((await row()).transactions.length,2);assert.deepEqual((await row()).cards,[])});
await test('card snapshot required',async()=>assert.equal((await write('replace_cards',[])).statusCode,400));
await test('duplicate IDs in batch rejected without mutation',async()=>{assert.equal((await write('append_transactions',[old,old])).statusCode,400);assert.deepEqual((await row()).transactions,[old])});
await test('missing account not recreated',async()=>assert.equal((await write('put_transaction',old,null,'moliya_user_tg_999')).statusCode,404));
await test('writes are scoped to one user',async()=>{await write('put_transaction',{id:'new',amount:1});assert.deepEqual((await row('moliya_user_tg_456')).transactions,[])});
for(const role of ['anon','authenticated'])await test(role+' cannot call financial RPC',async()=>{await db.exec('SET ROLE '+role);try{await assert.rejects(write('put_transaction',old),/permission denied/)}finally{await db.exec('RESET ROLE')}});
await test('service-role can call financial RPC',async()=>{await db.exec('SET ROLE service_role');try{assert.equal((await write('put_transaction',old)).success,true)}finally{await db.exec('RESET ROLE')}});
(supabase as any).rpc=async(n:string,a:any)=>({data:n==='moliya_session_financial_write'?await sessionWrite(a.p_action,a.p_payload,a.p_expected,a.p_user_id,a.p_session_token):await write(a.p_action,a.p_payload,a.p_expected,a.p_user_id),error:null});
await test('bot service saves parallel requests without lost updates',async()=>{await Promise.all(Array.from({length:20},(_,i)=>saveTransactions(id,[{id:'bot-'+i,amount:10,type:'expense'}])));assert.equal((await row()).transactions.length,21)});
await test('bot deletion service preserves other records',async()=>{await saveTransactions(id,[{id:'bot',amount:2}]);await deleteTransaction(id,'old');assert.equal((await row()).transactions.length,1);assert.equal((await row()).transactions[0].id,'bot')});

(supabase as any).from=()=>{let restricted=false;const q:any={select(){return q},like(){return q},eq(k:string,v:any){if(k==='id'&&String(v).startsWith('restricted_'))restricted=true;return q},async maybeSingle(){return {error:null,data:restricted?null:{id,telegram_id:'123',phone:'+998901234567',onboarding:{session_token:token,session_expires_at:'2099-01-01'},bot_verification:{telegram_id:'123',phone:'+998901234567',phone_source:'telegram_own_contact',phone_verified_at:'2026-01-01',consent_source:'telegram_button',consent_version:'1',consent_accepted_at:'2026-01-01'}}}}};return q};
let ip=0;
async function api(body:any,route='sync-data'){const req:any={method:'POST',query:{action:route},body,headers:{authorization:'Bearer '+token,'x-forwarded-for':'financial-'+(++ip)}};const res:any={statusCode:200,setHeader(){},status(n:number){this.statusCode=n;return this},json(x:any){this.body=x;return this}};await auth(req,res);return res;}
await test('legacy full-array writes rejected',async()=>assert.equal((await api({transactions:[]})).statusCode,400));
await test('API passes current user identity to the RPC',async()=>{assert.equal((await api({financialAction:'put_transaction',payload:{id:'web',amount:2}})).statusCode,200);assert.equal((await row()).transactions.length,2)});
await test('API propagates financial conflict',async()=>assert.equal((await api({financialAction:'put_transaction',payload:{...old,amount:2},expected:null})).statusCode,409));
await test('API rejects cross-account operation',async()=>{assert.equal((await api({userId:'moliya_user_tg_456',financialAction:'put_transaction',payload:old})).statusCode,403);assert.deepEqual((await row('moliya_user_tg_456')).transactions,[])});

const newCard={id:'bank',balance:'0'};
const funding={id:'funding',amount:500,type:'income',cardId:'bank'};
async function snapshot(){const r=await row();return {cards:r.cards,transactions:r.transactions};}
await test('card creation and funding commit together',async()=>{const before=await snapshot();assert.equal((await write('save_cards_atomic',{cards:[...before.cards,newCard],transactions:[funding]},before)).success,true);const after=await row();assert.equal(after.cards.length,2);assert.equal(after.transactions[0].id,'funding')});
await test('invalid funding cannot partially save card',async()=>{const before=await snapshot();assert.equal((await write('save_cards_atomic',{cards:[newCard],transactions:[funding,{...funding}]},before)).statusCode,400);assert.deepEqual(await snapshot(),before)});
await test('existing transaction collision rolls back card edit',async()=>{const before=await snapshot();assert.equal((await write('save_cards_atomic',{cards:[newCard],transactions:[old]},before)).statusCode,409);assert.deepEqual(await snapshot(),before)});
await test('bot activity makes a stale balance adjustment conflict',async()=>{const before=await snapshot();await write('append_transactions',[funding]);assert.equal((await write('save_cards_atomic',{cards:[newCard],transactions:[]},before)).statusCode,409);assert.deepEqual((await row()).cards,before.cards);assert.equal((await row()).transactions.length,2)});
await test('exact card operation replay cannot double funding',async()=>{const before=await snapshot();const payload={cards:[newCard],transactions:[funding]};await write('save_cards_atomic',payload,before);assert.equal((await write('save_cards_atomic',payload,before)).success,true);assert.equal((await row()).transactions.length,2)});
await test('two device card edits admit only one',async()=>{const before=await snapshot();const results=await Promise.all([write('save_cards_atomic',{cards:[newCard],transactions:[funding]},before),write('save_cards_atomic',{cards:[{...newCard,name:'other'}],transactions:[]},before)]);assert.equal(results.filter(x=>x.success).length,1);assert.equal(results.filter(x=>x.statusCode===409).length,1)});
for(const initial of [0,100,-100]) await test('deleting card preserves total with initial '+initial,async()=>{
 await db.query('UPDATE users SET cards=$1,transactions=$2 WHERE id=$3',[JSON.stringify([{id:'bank',balance:String(initial)}]),JSON.stringify([funding,{id:'expense',type:'expense',amount:200,cardId:'bank'}]),id]);
 const before=await snapshot();assert.equal((await write('delete_card_atomic',{id:'bank'},before)).success,true);
 const after=await row();assert.deepEqual(after.cards,[]);assert.equal(after.transactions.reduce((sum:number,t:any)=>sum+(t.type==='income'?1:-1)*Math.abs(Number(t.amount)),0),initial+300);
 assert.equal(after.transactions.filter((t:any)=>t.cardId==='bank').length,0);
 assert.equal(after.transactions.find((t:any)=>t.id==='funding').removedCardId,'bank');
 assert.equal((await write('delete_card_atomic',{id:'bank'},before)).statusCode,409);assert.deepEqual(await row(),after);
});
await test('stale deletion preserves concurrent transaction and card',async()=>{const before=await snapshot();await write('append_transactions',[funding]);assert.equal((await write('delete_card_atomic',{id:'cash'},before)).statusCode,409);assert.deepEqual((await row()).cards,before.cards)});
await test('API authenticates and accepts atomic card writes',async()=>{const before=await snapshot();assert.equal((await api({financialAction:'save_cards_atomic',payload:{cards:[newCard],transactions:[funding]},expected:before})).statusCode,200);assert.equal((await row()).transactions.length,2)});
await test('compound operation requires full expected state',async()=>{assert.equal((await write('save_cards_atomic',{cards:[],transactions:[]},{})).statusCode,400);assert.equal((await write('delete_card_atomic',{id:'cash'},{})).statusCode,400)});

// Every rejection must leave both financial arrays untouched.
for(const [name,change,code] of [
 ['top block',"is_blocked=true",'ACCOUNT_RESTRICTED'],
 ['top restriction',"is_restricted=true",'ACCOUNT_RESTRICTED'],
 ['deleted account',"account_status='deleted'",'ACCOUNT_RESTRICTED'],
 ['nested block',`onboarding='{"is_blocked":true}'`,'ACCOUNT_RESTRICTED'],
 ['device restriction',`device_info='{"restricted":true}'`,'ACCOUNT_RESTRICTED'],
 ['mismatched identity',"telegram_id='999'",'ACCOUNT_RESTRICTED'],
 ['missing proof',"bot_verification=NULL",'BOT_VERIFICATION_REQUIRED'],
 ['changed phone',"phone='+998901234568'",'BOT_VERIFICATION_REQUIRED'],
 ['foreign proof',`bot_verification=bot_verification || '{"telegram_id":"999"}'`,'BOT_VERIFICATION_REQUIRED'],
 ['untrusted phone source',`bot_verification=bot_verification || '{"phone_source":"typed"}'`,'BOT_VERIFICATION_REQUIRED'],
 ['missing consent',"bot_verification=bot_verification - 'consent_accepted_at'",'BOT_VERIFICATION_REQUIRED'],
 ['untrusted consent',`bot_verification=bot_verification || '{"consent_source":"web"}'`,'BOT_VERIFICATION_REQUIRED'],
 ['invalid timestamp',`bot_verification=bot_verification || '{"phone_verified_at":"bad"}'`,'BOT_VERIFICATION_REQUIRED'],
 ['infinite timestamp',`bot_verification=bot_verification || '{"consent_accepted_at":"infinity"}'`,'BOT_VERIFICATION_REQUIRED'],
] as const) await test('locked financial policy rejects '+name,async()=>{
 const before=await snapshot();await db.exec('UPDATE users SET '+change+" WHERE id='"+id+"'");
 const result=await write('put_transaction',{id:'denied',amount:9});
 assert.equal(result.statusCode,403);assert.equal(result.code,code);assert.deepEqual(await snapshot(),before);
});
await test('restriction tombstone prevents financial writes',async()=>{
 const before=await snapshot();await db.exec(`INSERT INTO users(id,onboarding) VALUES ('restricted_tg_123','{"is_blocked":true}')`);
 assert.equal((await write('append_transactions',[{id:'denied',amount:1}])).statusCode,403);assert.deepEqual(await snapshot(),before);
});
await test('API stale eligible auth snapshot cannot bypass a current block',async()=>{
 const before=await snapshot();await db.query('UPDATE users SET is_blocked=true WHERE id=$1',[id]);
 const result=await api({financialAction:'put_transaction',payload:{id:'denied',amount:9}});
 assert.equal(result.statusCode,403);assert.deepEqual(await snapshot(),before);
});
for(const action of ['delete_transaction','replace_cards','save_cards_atomic','delete_card_atomic'])await test('blocked account cannot invoke '+action,async()=>{
 const before=await snapshot();await db.query('UPDATE users SET is_blocked=true WHERE id=$1',[id]);
 assert.equal((await write(action,{id:'old'},before)).statusCode,403);assert.deepEqual(await snapshot(),before);
});


for(const [name,onboarding,code] of [
 ['logout',{},'INVALID_SESSION'],
 ['new login',{session_token:'sess_'+'b'.repeat(48),session_expires_at:'2099-01-01'},'INVALID_SESSION'],
 ['expiry',{session_token:token,session_expires_at:'2000-01-01'},'SESSION_EXPIRED'],
 ['missing expiry',{session_token:token},'SESSION_EXPIRED'],
 ['invalid expiry',{session_token:token,session_expires_at:'bad'},'SESSION_EXPIRED'],
 ['infinite expiry',{session_token:token,session_expires_at:'infinity'},'SESSION_EXPIRED'],
] as const)await test('stale HTTP auth is rejected after '+name,async()=>{
 const before=await snapshot();await db.query('UPDATE users SET onboarding=$1 WHERE id=$2',[JSON.stringify(onboarding),id]);
 const result=await api({financialAction:'put_transaction',payload:{id:'late',amount:5}});
 assert.equal(result.statusCode,401);assert.equal(result.body.error,code);assert.deepEqual(await snapshot(),before);
});
for(const action of ['put_transaction','delete_transaction','replace_cards','save_cards_atomic','delete_card_atomic'])await test('logout denies session action '+action,async()=>{
 const before=await snapshot();await db.query("UPDATE users SET onboarding='{}' WHERE id=$1",[id]);
 assert.equal((await sessionWrite(action,{id:'old'},before)).statusCode,401);assert.deepEqual(await snapshot(),before);
});
for(const credential of [null,'','malformed','sess_'+'z'.repeat(48)])await test('invalid credential denied: '+String(credential),async()=>{
 const before=await snapshot();assert.equal((await sessionWrite('put_transaction',{id:'late',amount:2},null,id,credential)).statusCode,401);assert.deepEqual(await snapshot(),before);
});
await test('another account session cannot authorize this user',async()=>{
 await db.query('UPDATE users SET onboarding=$1 WHERE id=$2',[JSON.stringify({session_token:'sess_'+'c'.repeat(48),session_expires_at:'2099-01-01'}),'moliya_user_tg_456']);
 assert.equal((await sessionWrite('put_transaction',{id:'late'},null,'moliya_user_tg_456')).statusCode,401);
});
await test('current replacement session succeeds',async()=>{
 const next='sess_'+'b'.repeat(48);await db.query('UPDATE users SET onboarding=$1 WHERE id=$2',[JSON.stringify({session_token:next,session_expires_at:'2099-01-01'}),id]);
 assert.equal((await sessionWrite('put_transaction',{id:'current',amount:2},null,id,next)).success,true);
});
await test('verified bot can write after web logout',async()=>{
 await db.query("UPDATE users SET onboarding='{}' WHERE id=$1",[id]);
 await saveTransactions(id,[{id:'bot-after-logout',amount:2}]);assert.equal((await row()).transactions.length,2);
});
for(const role of ['anon','authenticated'])await test(role+' cannot call session financial RPC',async()=>{
 await db.exec('SET ROLE '+role);try{await assert.rejects(sessionWrite('put_transaction',old),/permission denied/)}finally{await db.exec('RESET ROLE')}
});
await test('service role may invoke session RPC with valid session',async()=>{
 await db.exec('SET ROLE service_role');try{assert.equal((await sessionWrite('put_transaction',{id:'valid',amount:2})).success,true)}finally{await db.exec('RESET ROLE')}
});
await test('untrusted body fields cannot select bot write path',async()=>{
 await db.query("UPDATE users SET onboarding='{}' WHERE id=$1",[id]);
 assert.equal((await api({financialAction:'put_transaction',payload:{id:'late',amount:2},source:'bot',skipSession:true})).statusCode,401);
});


for(const route of ['wipe-data','delete-account']) {
 for(const [name,session] of [
  ['logout',{}],['new login',{session_token:'sess_'+'z'.repeat(48),session_expires_at:'2099-01-01'}],
  ['expiry',{session_token:token,session_expires_at:'2000-01-01'}]
 ] as const)await test(route+' rejects stale auth after '+name,async()=>{
  await db.query('UPDATE users SET onboarding=$1 WHERE id=$2',[JSON.stringify(session),id]);const before=await row();
  const response=await api({},route);assert.equal(response.statusCode,401);assert.deepEqual(await row(),before);
 });
 await test(route+' rejects a cross-account body',async()=>{
  const before=await row('moliya_user_tg_456');assert.equal((await api({userId:'moliya_user_tg_456'},route)).statusCode,403);assert.deepEqual(await row('moliya_user_tg_456'),before);
 });
 await test(route+' rechecks a current block',async()=>{
  await db.query('UPDATE users SET is_blocked=true WHERE id=$1',[id]);const before=await row();
  assert.equal((await api({},route)).statusCode,403);assert.deepEqual(await row(),before);
 });
}
await test('self wipe clears only financial arrays',async()=>{
 const before=await row();assert.equal((await api({},'wipe-data')).statusCode,200);const after=await row();
 assert.deepEqual(after.transactions,[]);assert.deepEqual(after.cards,[]);
 delete before.transactions;delete before.cards;delete before.updated_at;delete after.transactions;delete after.cards;delete after.updated_at;assert.deepEqual(after,before);
});
await test('self deletion removes only own row',async()=>{
 const other=await row('moliya_user_tg_456');assert.equal((await api({},'delete-account')).statusCode,200);
 assert.equal(await row(),undefined);assert.deepEqual(await row('moliya_user_tg_456'),other);
 assert.equal((await sessionWrite('put_transaction',{id:'late',amount:1})).statusCode,401);
});
await test('unverified user may delete their own account',async()=>{
 await db.query('UPDATE users SET bot_verification=NULL WHERE id=$1',[id]);assert.equal((await api({},'delete-account')).statusCode,200);assert.equal(await row(),undefined);
});
await test('unverified user cannot wipe financial data',async()=>{
 await db.query('UPDATE users SET bot_verification=NULL WHERE id=$1',[id]);const before=await row();assert.equal((await api({},'wipe-data')).statusCode,403);assert.deepEqual(await row(),before);
});
await test('bot wipe works after web logout',async()=>{
 await db.query("UPDATE users SET onboarding='{}' WHERE id=$1",[id]);await wipeBotFinancialData(id);assert.deepEqual(await snapshot(),{cards:[],transactions:[]});
});
await test('blocked bot wipe cannot bypass current policy',async()=>{
 await db.query('UPDATE users SET is_blocked=true WHERE id=$1',[id]);const before=await snapshot();await assert.rejects(wipeBotFinancialData(id),/ACCOUNT_RESTRICTED/);assert.deepEqual(await snapshot(),before);
});
await test('account recreated during Telegram cleanup is never deleted again',async()=>{
 const original=globalThis.fetch;const oldToken=process.env.TELEGRAM_BOT_TOKEN;let calls=0;
 process.env.TELEGRAM_BOT_TOKEN='offline-placeholder';
 globalThis.fetch=async()=>{if(calls++===0)await db.query("INSERT INTO users(id,telegram_id,onboarding) VALUES ($1,'123','{\"fresh\":true}')",[id]);return {json:async()=>({ok:false,description:'offline cleanup unavailable'})} as any};
 try{assert.equal((await api({},'delete-account')).statusCode,200);assert.equal((await row()).onboarding.fresh,true);assert.ok(calls>0)}
 finally{globalThis.fetch=original;if(oldToken===undefined)delete process.env.TELEGRAM_BOT_TOKEN;else process.env.TELEGRAM_BOT_TOKEN=oldToken;}
});
await test('delete failure produces no Telegram side effects',async()=>{
 const original=globalThis.fetch;const botToken=process.env.TELEGRAM_BOT_TOKEN;let calls=0;
 process.env.TELEGRAM_BOT_TOKEN='offline-placeholder';globalThis.fetch=async()=>{calls++;throw new Error('NETWORK_FORBIDDEN')};
 try {await db.query("UPDATE users SET onboarding='{}' WHERE id=$1",[id]);assert.equal((await api({},'delete-account')).statusCode,401);assert.equal(calls,0)}
 finally{globalThis.fetch=original;if(botToken===undefined)delete process.env.TELEGRAM_BOT_TOKEN;else process.env.TELEGRAM_BOT_TOKEN=botToken;}
});
for(const route of ['wipe-data','delete-account'])await test(route+' RPC outage never returns success',async()=>{
 const rpc=supabase.rpc;const before=await row();(supabase as any).rpc=async()=>({data:null,error:{message:'offline'}});
 try{assert.equal((await api({},route)).statusCode,503);assert.deepEqual(await row(),before)}finally{(supabase as any).rpc=rpc}
});

await test('RPC outage produces failure, never fake success',async()=>{(supabase as any).rpc=async()=>({data:null,error:{message:'offline'}});assert.equal((await api({financialAction:'put_transaction',payload:old})).statusCode,503)});
await db.close();console.log(`\n${count} financial-write checks passed in PGlite. Queries are serialized by this embedded engine; live multi-connection load testing remains required.`);
