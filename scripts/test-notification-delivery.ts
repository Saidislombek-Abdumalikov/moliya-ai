import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
process.env.SUPABASE_URL='http://127.0.0.1:54321';process.env.SUPABASE_SERVICE_ROLE_KEY='offline';process.env.ADMIN_SECRET_KEY='offline-admin-test';
const {supabase}=await import('../api/_supabaseClient.js');
const {notificationPayload,userNotifications}=await import('../api/services/_notificationService.js');
const {default:auth}=await import('../api/auth.js');const {default:admin}=await import('../api/admin.js');
const db=new PGlite();let count=0;
async function test(name:string,fn:()=>any){await fn();count++;console.log('PASS '+name)}
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE TABLE app_notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title text,message text,target_audience text,created_at timestamptz DEFAULT now());GRANT SELECT(message) ON app_notifications TO anon;INSERT INTO app_notifications(title,message,target_audience) VALUES ('private','private','moliya_user_tg_456');`);
const sql=await readFile(new URL('../migrations/10-private-app-notifications.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
await test('migration preserves private legacy audience',async()=>assert.equal((await db.query<any>('SELECT target FROM app_notifications')).rows[0].target,'moliya_user_tg_456'));
await test('browser table and column grants are removed',async()=>{for(const role of ['anon','authenticated']){const r=(await db.query<any>("SELECT has_table_privilege($1,'app_notifications','SELECT') t,has_column_privilege($1,'app_notifications','message','SELECT') c,has_table_privilege($1,'app_notifications','INSERT') i",[role])).rows[0];assert.deepEqual(r,{t:false,c:false,i:false})}});
let failure=false;const token='sess_'+'a'.repeat(48);const auditEntries:any[]=[];
let user:any={id:'moliya_user_tg_123',telegram_id:'123',phone:'+998901234567',onboarding:{session_token:token,session_expires_at:'2099-01-01'},bot_verification:{telegram_id:'123',phone:'+998901234567',phone_source:'telegram_own_contact',phone_verified_at:'2026-01-01',consent_source:'telegram_button',consent_version:'1',consent_accepted_at:'2026-01-01'}};
(supabase as any).from=(table:string)=>{
 let mode='select',payload:any,filters:Array<[string,any]>=[],targets:any=null,limit=50;
 const q:any={select(){return q},insert(rows:any){mode='insert';payload=rows[0];return q},update(data:any){mode='update';payload=data;return q},delete(){mode='delete';return q},eq(k:string,v:any){filters.push([k,v]);return q},like(){return q},in(_k:string,v:any){targets=v;return q},order(){return q},limit(n:number){limit=n;return q},async maybeSingle(){const result=await run();return {...result,data:result.data?.[0]??null}},then(resolve:any,reject:any){return run().then(resolve,reject)}};
 async function run(){
  if(failure)return {data:null,error:{message:'private SQL'}};
  if(table==='admin_audit_log'){if(mode==='insert')auditEntries.push(payload);return {data:[],error:null};}
  if(table==='users'){const restricted=filters.some(([k,v])=>k==='id'&&String(v).startsWith('restricted_'));const missing=filters.some(([k,v])=>k==='id'&&v!==user.id);return {data:restricted||missing?[]:[user],error:null};}
  assert.equal(table,'app_notifications');const args:any[]=[];const param=(v:any)=>{args.push(v);return '$'+args.length};
  let query='';
  const where=()=>{const conditions=filters.map(([k,v])=>`"${k}"=${param(v)}`);if(targets)conditions.push(`target=ANY(${param(targets)}::text[])`);return conditions.length?' WHERE '+conditions.join(' AND '):''};
  if(mode==='insert'){const cols=Object.keys(payload);query=`INSERT INTO app_notifications(${cols.map(x=>'"'+x+'"').join(',')}) VALUES (${cols.map(k=>param(payload[k])).join(',')}) RETURNING *`;}
  if(mode==='update')query='UPDATE app_notifications SET '+Object.keys(payload).map(k=>`"${k}"=${param(payload[k])}`).join(',')+where()+' RETURNING *';
  if(mode==='delete')query='DELETE FROM app_notifications'+where()+' RETURNING *';
  if(mode==='select')query='SELECT * FROM app_notifications'+where()+' ORDER BY created_at DESC LIMIT '+limit;
  try{return {data:(await db.query(query,args)).rows,error:null}}catch(e){return {data:null,error:{message:String(e)}}}
 }
 return q;
};
globalThis.fetch=async()=>{throw new Error('NETWORK_FORBIDDEN')};let seq=0;
async function api(handler:any,route:string,method:string,body:any={},authorized=true){const req:any={method,query:handler===auth?{action:route,platform:'telegram',userId:'moliya_user_tg_456',isPremium:'true'}:{route},body,headers:{...(authorized?(handler===auth?{authorization:'Bearer '+token}:{'x-admin-key':'offline-admin-test'}):{}),'x-forwarded-for':'notif-'+(++seq)},socket:{remoteAddress:'127.0.0.1'}};const res:any={statusCode:200,headers:{},setHeader(k:string,v:any){this.headers[k]=v},status(n:number){this.statusCode=n;return this},json(body:any){this.body=body;return this}};await handler(req,res);return res;}
await test('admin create accepts null image/action and logs the actual write',async()=>{const res=await api(admin,'notifications','POST',{action:'create',title:'hello',message:'body',target:user.id,image_url:null,action_url:null});assert.equal(res.statusCode,200);assert.ok(res.body.notification.id);assert.equal(auditEntries.at(-1).action,'notification_create');assert.equal(auditEntries.at(-1).details.notificationId,res.body.notification.id)});
await test('unknown individual recipient is rejected',async()=>assert.equal((await api(admin,'notifications','POST',{action:'create',title:'x',message:'y',target:'moliya_user_tg_999'})).statusCode,404));
await test('invalid audiences and executable links rejected',()=>{for(const payload of [{target:'everyone-typo'},{action_url:'javascript:alert(1)'},{image_url:'data:image/png;base64,a'},{action_url:'//evil.example'},{title:'   '},{message:'x'.repeat(4001)}])assert.throws(()=>notificationPayload({title:'ok',message:'ok',...payload}))});
await test('missing admin authentication cannot create',async()=>assert.equal((await api(admin,'notifications','POST',{action:'create',title:'x',message:'y'},false)).statusCode,401));
await test('missing update/delete target never reports success or creates audit',async()=>{const before=auditEntries.length;for(const action of ['update','delete']){const res=await api(admin,'notifications','POST',{action,id:'00000000-0000-0000-0000-000000000000',title:'new'});assert.equal(res.statusCode,404)}assert.equal(auditEntries.length,before)});
await test('admin update/delete persist actual changes and server audit',async()=>{const created=await api(admin,'notifications','POST',{action:'create',title:'old',message:'body'});const id=created.body.notification.id;const changed=await api(admin,'notifications','POST',{action:'update',id,title:'new'});assert.equal(changed.body.notification.title,'new');assert.equal((await api(admin,'notifications','POST',{action:'delete',id})).body.success,true);assert.deepEqual(auditEntries.slice(-3).map(x=>x.action),['notification_create','notification_update','notification_delete']);assert.equal((await db.query('SELECT * FROM app_notifications WHERE id=$1',[id])).rows.length,0)});
await test('browser cannot forge audit records',async()=>{const before=auditEntries.length;assert.equal((await api(admin,'admin-audit-logs','POST',{action:'grant_vip',targetUserId:user.id})).statusCode,405);assert.equal(auditEntries.length,before)});
await db.exec('TRUNCATE app_notifications');
for(const target of ['all','telegram','web','vip','free',user.id,'moliya_user_tg_456'])await db.query('INSERT INTO app_notifications(title,message,target) VALUES ($1,$1,$1)',[target]);
await test('server audience ignores forged userId and premium parameters',async()=>{const res=await api(auth,'notifications','GET');assert.equal(res.statusCode,200);assert.deepEqual(new Set(res.body.map((n:any)=>n.target)),new Set(['all','telegram','free',user.id]));assert.equal(res.headers['Cache-Control'],'private, no-store')});
await test('expired premium uses free audience',async()=>{user={...user,is_premium:true,premium_expires_at:'2000-01-01'};const rows=await userNotifications(user,'web');assert.ok(rows.some(x=>x.target==='free'));assert.ok(!rows.some(x=>x.target==='vip'))});
await test('active premium uses vip audience from database',async()=>{user={...user,is_premium:true,premium_expires_at:'2099-01-01'};const rows=await userNotifications(user,'telegram');assert.ok(rows.some(x=>x.target==='vip'));assert.ok(!rows.some(x=>x.target==='free'))});
await test('unauthenticated and expired sessions cannot read',async()=>{assert.equal((await api(auth,'notifications','GET',{},false)).statusCode,401);user.onboarding.session_expires_at='2000-01-01';assert.equal((await api(auth,'notifications','GET')).statusCode,401);user.onboarding.session_expires_at='2099-01-01'});
await test('unverified users cannot read',async()=>{const proof=user.bot_verification;user.bot_verification=null;assert.equal((await api(auth,'notifications','GET')).statusCode,403);user.bot_verification=proof});
await test('audience filtering precedes the page limit',async()=>{for(let i=0;i<40;i++)await db.query("INSERT INTO app_notifications(title,message,target) VALUES ('other','other','moliya_user_tg_456')");assert.ok((await userNotifications(user,'telegram')).some(x=>x.target===user.id))});
await test('inactive records and unsafe legacy URLs are not exposed as links',async()=>{await db.query("INSERT INTO app_notifications(title,message,target,is_active,action_url) VALUES ('hidden','x','all',false,NULL),('unsafe','x','all',true,'javascript:alert(1)')");const rows=await userNotifications(user,'telegram');assert.ok(!rows.some(x=>x.title==='hidden'));assert.equal(rows.find(x=>x.title==='unsafe')?.action_url,null)});
await test('database errors cannot become fake admin success or leak details',async()=>{failure=true;try{const res=await api(admin,'notifications','POST',{action:'create',title:'x',message:'y'});assert.equal(res.statusCode,503);assert.ok(!JSON.stringify(res.body).includes('private SQL'))}finally{failure=false}});
const adminRoot=new URL(existsSync(new URL('../../Admin-Dashboard/',import.meta.url))?'../../Admin-Dashboard/':'../../Admin-Dashboard/',import.meta.url);
const {sendAppNotification,deleteAppNotification}=await import(new URL('src/services/notificationService.js',adminRoot).href);
await test('admin browser failures do not fall back to database or another host',async()=>{let calls=0;globalThis.fetch=async()=>{calls++;return {ok:false,status:503,json:async()=>({error:'NOTIFICATIONS_UNAVAILABLE'})} as any};await assert.rejects(sendAppNotification({title:'test',message:'body',imageUrl:null,actionUrl:null}));assert.equal(calls,1);await assert.rejects(deleteAppNotification('id'));assert.equal(calls,2)});

const {fetchUserNotifications}=await import('../src/services/appNotificationService.js');
let storedToken=token;(globalThis as any).localStorage={getItem:(key:string)=>key==='moliya_session_token'?storedToken:null,setItem:(key:string,value:string)=>{if(key==='moliya_session_token')storedToken=value},removeItem:(key:string)=>{if(key==='moliya_session_token')storedToken=''}};
await test('app uses authenticated notification API only',async()=>{
 globalThis.fetch=async(url:any,options:any)=>{assert.equal(url,'/api/auth?action=notifications&platform=telegram');assert.equal(options.headers.Authorization,'Bearer '+token);assert.equal(options.cache,'no-store');return {ok:true,json:async()=>[{id:'n',title:'x',message:'y',target:user.id}]} as any};
 assert.equal((await fetchUserNotifications({userId:user.id,isTelegram:true}))[0].id,'n');
});
await test('logout discards an old in-flight notification response',async()=>{
 let release:any;globalThis.fetch=()=>new Promise(resolve=>{release=resolve}) as any;
 const pending=fetchUserNotifications({userId:user.id,isTelegram:true});storedToken='';
 release({ok:true,json:async()=>[{id:'private-old',title:'private',message:'private'}]});
 assert.deepEqual(await pending,[]);
});
console.log(`${count} notification security/delivery checks passed; no live messages sent.`);await db.close();
