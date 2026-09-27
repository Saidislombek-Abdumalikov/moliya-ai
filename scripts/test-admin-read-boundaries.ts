import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
process.env.SUPABASE_URL='http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY='offline';
process.env.ADMIN_SECRET_KEY='offline-read-admin-key';
const {supabase}=await import('../api/_supabaseClient.js');
const {default:handler}=await import('../api/admin.js');
const uid='moliya_user_tg_123';
const rows:any[]=[
  {id:uid,telegram_id:'123',name:'Ali',phone:'+998901234567',updated_at:'2026-09-25',onboarding:{session_token:'NEVER_SHOW_SESSION',bot_messages:[{id:'voice_1',message_id:1,type:'voice',direction:'user_to_bot',metadata:{file_id:'file_1',duration:4},timestamp:'2026-09-25'}],ai_reports:[{id:'report_1',generatedAt:'2026-09-25'}]},device_info:{secret:'NEVER_SHOW_DEVICE'},transactions:[{amount:4500}]},
  {id:'exchange_safe1',updated_at:'2026-09-24',device_info:{token:'NEVER_SHOW_EXCHANGE'}},
  {id:'admin_session_state',updated_at:'2026-09-24',device_info:{active_sid:'NEVER_SHOW_ADMIN'}}
];
let deletes=0,failed=false;
(supabase as any).from=(table:string)=>{
  let field='',value:any,remove=false,ids:string[]=[],max=1000,from=0,to=499;
  const q:any={select(){return q},order(){return q},range(a:number,b:number){from=a;to=b;return q},
    limit(n:number){max=n;return q},not(){return q},eq(k:string,v:any){field=k;value=v;return q},
    in(_k:string,arr:string[]){ids=arr;return q},delete(){remove=true;return q},insert(){return {error:null}},
    async maybeSingle(){if(failed)return {data:null,error:{message:'PRIVATE_DB_ERROR'}};return {data:rows.find(r=>r[field]===value)||null,error:null}},
    then(resolve:any,reject:any){
      if(failed)return Promise.resolve({data:null,error:{message:'PRIVATE_DB_ERROR'}}).then(resolve,reject);
      if(table==='users'&&remove){const removed=rows.filter(r=>ids.includes(r.id));for(const r of removed)rows.splice(rows.indexOf(r),1);deletes+=removed.length;return Promise.resolve({data:removed.map(r=>({id:r.id})),error:null}).then(resolve,reject)}
      const result=table==='users'?[...rows].sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at))).slice(from,to+1):
        table==='admin_audit_log'?[{id:'audit_1',action:'TEST'}]:[];
      return Promise.resolve({data:result.slice(0,max),error:null}).then(resolve,reject);
    }
  };return q;
};
async function api(route:string,method='GET',body:any=null,key='offline-read-admin-key'){
  const req:any={method,query:{route},body,headers:key?{'x-admin-key':key}:{},socket:{remoteAddress:'127.0.0.1'}};
  const res:any={statusCode:200,headers:{},setHeader(k:string,v:any){this.headers[k]=v},status(n:number){this.statusCode=n;return this},json(v:any){this.body=v;return this}};
  await handler(req,res);return res;
}
assert.equal((await api('login-records','GET',null,'')).statusCode,401);
const listing=await api('login-records');assert.equal(listing.statusCode,200);
assert.deepEqual(listing.body.records.map((r:any)=>r.id),[uid,'exchange_safe1']);
assert.ok(!JSON.stringify(listing.body).includes('NEVER_SHOW'));
assert.ok(!JSON.stringify(listing.body).includes('4500'));
assert.equal(listing.headers['Cache-Control'],'private, no-store');
assert.equal((await api('login-records','POST',{action:'delete',ids:[uid]})).statusCode,400);
assert.equal(deletes,0);
assert.equal((await api('login-records','POST',{action:'delete',ids:['exchange_safe1']})).body.deleted,1);
assert.equal(rows.some(r=>r.id===uid),true);
const messages=await api('bot-messages','POST',{userId:uid});assert.equal(messages.body.messages[0].fileDownloadUrl.includes('file_1'),true);
const reports=await api('reports','POST',{userId:uid});assert.equal(reports.body.reports[0].id,'report_1');
assert.equal((await api('generate-report','POST',{userId:'admin_session_state'})).statusCode,400);
assert.equal((await api('generate-report','POST',{userId:uid,type:'yearly'})).statusCode,400);
const audit=await api('admin-audit-logs');assert.equal(audit.body.logs[0].id,'audit_1');
assert.equal((await api('admin-audit-logs','POST',{action:'EDIT_POLICY',details:{value:'ok'}})).statusCode,405);
failed=true;
assert.equal((await api('login-records')).statusCode,503);
assert.ok(!JSON.stringify((await api('login-records')).body).includes('PRIVATE_DB_ERROR'));
failed=false;

const root=new URL(existsSync(new URL('../../Admin-Dashboard/',import.meta.url))?'../../Admin-Dashboard/':'../../admin Dashboard Moliya/',import.meta.url);
const client=await import(new URL('src/services/userService.js',root).href);
const calls:any[]=[];
globalThis.fetch=async(url:any,opts:any)=>{
  calls.push([url,opts]);assert.equal(opts.credentials,'include');
  const route=new URL(String(url),'https://test.invalid').searchParams.get('route')!;
  const response=route==='generate-report'?{statusCode:200,body:JSON.parse(opts.body).userId==='all'?{success:true,total:1,generated:1,sentCount:0,failedCount:0,reports:[{id:'r'}]}:{success:true,report:{id:'r'}}}:
    await api(route,opts.method,opts.body?JSON.parse(opts.body):null);
  return {ok:response.statusCode<400,status:response.statusCode,json:async()=>response.body} as any;
};
assert.equal((await client.getAllRawLoginRecords())[0]._raw.onboarding,undefined);
assert.equal((await client.fetchUserFiles(uid,'123'))[0].fileId,'file_1');
assert.equal((await client.fetchAiReports(uid))[0].id,'report_1');
assert.equal((await client.fetchAdminAuditLogs())[0].id,'audit_1');
assert.equal((await client.generateAiFinancialReport(uid)).report.id,'r');
assert.equal((await client.generateAllUsersIndividualReports()).generated,1);
assert.equal(calls.filter(([url])=>String(url).includes('generate-report')).length,2);
await assert.rejects(client.fetchUserFiles(uid,'456'),/RECIPIENT_MISMATCH/);
globalThis.fetch=async()=>({ok:false,status:503,json:async()=>({error:'REPORTS_UNAVAILABLE'})}) as any;
await assert.rejects(client.fetchAiReports(),/REPORTS_UNAVAILABLE/);
console.log('Admin read boundaries: sanitized login records, safe deletion, reports/files/audit API, and failure handling passed.');
