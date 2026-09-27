import assert from 'node:assert/strict';
process.env.SUPABASE_URL='http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY='offline';
process.env.ADMIN_SECRET_KEY='offline-admin-secret-long-value';
process.env.CRON_SECRET='offline-independent-cron-secret';
process.env.TELEGRAM_BOT_TOKEN='offline-bot';
const {supabase}=await import('../api/_supabaseClient.js');
const {default:handler}=await import('../api/admin.js');
const verified:any={id:'moliya_user_tg_123',telegram_id:'123',phone:'+998901234567',
 onboarding:{},transactions:[],bot_verification:{telegram_id:'123',phone:'+998901234567',
  phone_source:'telegram_own_contact',phone_verified_at:'2026-01-01',
  consent_source:'telegram_button',consent_version:'v1',consent_accepted_at:'2026-01-01'}};
let users:any[]=[verified,{...verified,id:'moliya_user_tg_456',telegram_id:'456',bot_verification:null},
  {...verified,id:'moliya_user_tg_789',telegram_id:'789',is_blocked:true}];
let notices=0,sends=0;
let dailyEnabled=true;
let enabledSlots=['morning','afternoon','evening'];
const extraEnabled:Record<string,boolean>={quota_exhausted:true,trial_expiry:true,weekly_digest:false,scheduled_weekly_report:false,scheduled_monthly_report:false};
let automationAvailable=true;
const claimed = new Set<string>();
(supabase as any).from=(table:string)=>{
  assert.ok(['users','app_notifications','moliya_reminder_delivery','moliya_automation_rules','moliya_automation_delivery','admin_audit_log'].includes(table));
  let value:any;
  let target='daily_reminder';
  const rule=(id:string)=>({rule_id:id,enabled:id==='daily_reminder'?dailyEnabled:extraEnabled[id],enabled_slots:enabledSlots});
  const q:any={select(){return q},delete(){return q},lt(){return Promise.resolve({error:null})},neq(){return q},in(){return q},eq(field:string,v:string){if(table==='moliya_automation_rules' && field==='rule_id')target=v;return q},order(){return q},range(from:number,to:number){return Promise.resolve({data:users.slice(from,to+1),error:null})},update(input:any){value=input;return q},insert(input:any){value=input;if(table==='app_notifications'){notices++;return Promise.resolve({error:null})}if(table==='admin_audit_log')return Promise.resolve({error:null});if(table==='moliya_automation_delivery'){const key=input.user_id+':'+input.rule_id+':'+input.occurrence;if(claimed.has(key))return Promise.resolve({error:{code:'23505'}});claimed.add(key);return Promise.resolve({error:null})}return q},
    maybeSingle(){if(table==='moliya_automation_rules'){if(value && automationAvailable){if(typeof value.enabled==='boolean'){if(target==='daily_reminder')dailyEnabled=value.enabled;else extraEnabled[target]=value.enabled}if(value.enabled_slots)enabledSlots=value.enabled_slots;}return Promise.resolve(automationAvailable?{data:rule(target),error:null}:{data:null,error:{message:'unavailable'}})}const key=value.user_id+':'+value.local_day;if(claimed.has(key))return Promise.resolve({data:null,error:{code:'23505'}});claimed.add(key);return Promise.resolve({data:{user_id:value.user_id},error:null})},
    then(done:any,fail:any){return Promise.resolve(table==='moliya_automation_rules'?automationAvailable?{data:['daily_reminder',...Object.keys(extraEnabled)].map(rule),error:null}:{data:null,error:{message:'unavailable'}}:{data:users,error:null}).then(done,fail)}};
  return q;
};
globalThis.fetch=async()=>{sends++;return {json:async()=>({ok:true})} as any};
let serial=0;
async function request(route:string,method='GET',headers:Record<string,string>={},body:any={},query:any={}){
  const req:any={method,query:{route,...query},body,headers:{'x-forwarded-for':'cron-test-'+(++serial),...headers},socket:{remoteAddress:'127.0.0.1'}};
  const res:any={statusCode:200,setHeader(){},status(n:number){this.statusCode=n;return this},json(body:any){this.body=body;return this}};
  await handler(req,res);return res;
}
const cron={'authorization':`Bearer ${process.env.CRON_SECRET}`};
assert.equal((await request('auto-broadcast')).statusCode,401);
assert.equal((await request('auto-broadcast','GET',{'authorization':'Bearer wrong'})).statusCode,401);
assert.equal((await request('verify-session','GET',cron)).statusCode,401);
assert.equal((await request('auto-broadcast','GET',{...cron,origin:'https://untrusted.example'})).statusCode,403);
assert.equal((await request('automation-due','GET',{'authorization':'Bearer wrong'},{},{ruleId:'trial_expiry'})).statusCode,401);
assert.equal((await request('automation-due','GET',cron,{}, {ruleId:'weekly_digest'})).body.enabled,false);
assert.equal(sends,0);assert.equal(notices,0);
automationAvailable=false;
assert.equal((await request('auto-broadcast','GET',cron,{}, {slot:'evening'})).statusCode,503);
assert.equal(sends,0);automationAvailable=true;
assert.equal((await request('automation-rules')).statusCode,401);
assert.equal((await request('scheduled-report-settings')).statusCode,401);
assert.equal((await request('run-scheduled-reports','GET',{'authorization':'Bearer wrong'})).statusCode,401);
assert.equal((await request('run-scheduled-reports','GET',cron)).body.totalEligible,0);
assert.deepEqual(((await request('scheduled-report-settings','GET',{'x-admin-key':process.env.ADMIN_SECRET_KEY!})).body),{success:true,weeklyEnabled:false,monthlyEnabled:false});
assert.equal((await request('scheduled-report-settings','POST',{'x-admin-key':process.env.ADMIN_SECRET_KEY!},{ruleId:'scheduled_weekly_report',enabled:true})).statusCode,200);
assert.equal((await request('scheduled-report-settings','GET',{'x-admin-key':process.env.ADMIN_SECRET_KEY!})).body.weeklyEnabled,true);
assert.equal((await request('scheduled-report-settings','POST',{'x-admin-key':process.env.ADMIN_SECRET_KEY!},{ruleId:'scheduled_weekly_report',enabled:false})).statusCode,200);
assert.equal((await request('scheduled-report-settings','POST',{'x-admin-key':process.env.ADMIN_SECRET_KEY!},{ruleId:'weekly_digest',enabled:true})).statusCode,400);
assert.equal((await request('automation-rules','GET',{'x-admin-key':process.env.ADMIN_SECRET_KEY!})).body.rules.daily_reminder.enabled,true);
const off=await request('automation-rules','POST',{'x-admin-key':process.env.ADMIN_SECRET_KEY!},{ruleId:'daily_reminder',enabled:false});
assert.equal(off.statusCode,200);
assert.equal((await request('auto-broadcast','GET',cron,{}, {slot:'evening'})).body.totalTargeted,0);
assert.equal(sends,0);assert.equal(notices,0);
assert.equal((await request('automation-rules','POST',{'x-admin-key':process.env.ADMIN_SECRET_KEY!},{ruleId:'daily_reminder',enabled:true})).statusCode,200);
assert.equal((await request('automation-rules','POST',{'x-admin-key':process.env.ADMIN_SECRET_KEY!},{ruleId:'daily_reminder',enabledSlots:['evening','evening']})).statusCode,400);
assert.equal((await request('automation-rules','POST',{'x-admin-key':process.env.ADMIN_SECRET_KEY!},{ruleId:'daily_reminder',enabledSlots:['evening','other']})).statusCode,400);
assert.deepEqual((await request('automation-rules','POST',{'x-admin-key':process.env.ADMIN_SECRET_KEY!},{ruleId:'daily_reminder',enabledSlots:['evening']})).body.enabledSlots,['evening']);
assert.equal((await request('auto-broadcast','GET',cron,{}, {slot:'morning'})).body.slotEnabled,false);
assert.equal(sends,0);
const preview=await request('auto-broadcast','POST',{'x-admin-key':process.env.ADMIN_SECRET_KEY!},{action:'preview'});
assert.equal(preview.body.totalTargeted,1);assert.equal(sends,0);assert.equal(notices,0);
const originalUsers=users;
users=Array.from({length:1001},(_,i)=>({...verified,id:`moliya_user_tg_${10000+i}`,telegram_id:String(10000+i),
 bot_verification:{...verified.bot_verification,telegram_id:String(10000+i)}}));
assert.equal((await request('auto-broadcast','POST',{'x-admin-key':process.env.ADMIN_SECRET_KEY!},{action:'preview'})).body.totalTargeted,1001);
assert.equal(sends,0);users=originalUsers;
const run=await request('auto-broadcast','GET',cron,{}, {slot:'evening'});
assert.equal(run.statusCode,200);
assert.equal(run.body.totalTargeted,1);
assert.equal(run.body.sent,1);
assert.equal(sends,1);
assert.equal(notices,1);
const replay=await request('auto-broadcast','GET',cron,{}, {slot:'evening'});
assert.equal(replay.body.skippedDuplicate,1);
assert.equal(sends,1);assert.equal(notices,1);
assert.equal((await request('automation-due','GET',cron,{}, {ruleId:'quota_exhausted'})).statusCode,400);
assert.equal((await request('automation-due','GET',{...cron,origin:'https://untrusted.example'},{},{ruleId:'trial_expiry'})).statusCode,403);
users=[{...verified,trial_ends_at:new Date(Date.now()+3600_000).toISOString()}];
assert.equal((await request('automation-due','POST',{'x-admin-key':process.env.ADMIN_SECRET_KEY!},{ruleId:'trial_expiry',action:'preview'})).body.totalTargeted,1);
assert.equal(sends,1);
const trialRun=await request('automation-due','GET',cron,{}, {ruleId:'trial_expiry'});
assert.equal(trialRun.body.sent,1);assert.equal(sends,2);assert.equal(notices,2);
assert.equal((await request('automation-due','GET',cron,{}, {ruleId:'trial_expiry'})).body.duplicate,1);
assert.equal(sends,2);assert.equal(notices,2);
users=[{...verified,id:'moliya_user_tg_124',telegram_id:'124',
  bot_verification:{...verified.bot_verification,telegram_id:'124'},onboarding:{notifications:{opt1:false}}}];
await request('auto-broadcast','GET',cron,{}, {slot:'evening'});
assert.equal(sends,2);assert.equal(notices,2);
users=[{...verified,bot_verification:null}];
const scheduled=await request('run-scheduled-reports','POST',{'x-admin-key':process.env.ADMIN_SECRET_KEY!});
assert.equal(scheduled.statusCode,200);
assert.equal(scheduled.body.totalEligible,0);
assert.equal(sends,2);
const broadcast=await request('broadcast','POST',{'x-admin-key':process.env.ADMIN_SECRET_KEY!},{message:'test',target:'all'});
assert.equal(broadcast.statusCode,404);
assert.equal(sends,2);
const adminRoot=new URL('../../admin Dashboard Moliya/',import.meta.url);
const client=await import(new URL('src/services/notificationService.js',adminRoot).href);
let routeCalls:any[]=[];
globalThis.fetch=async(url:any,options:any)=>{
  routeCalls.push({url,method:options.method,body:options.body&&JSON.parse(options.body)});
  const data=String(url).includes('scheduled-report-settings')
    ? options.method==='POST'?{success:true,ruleId:JSON.parse(options.body).ruleId,enabled:JSON.parse(options.body).enabled}
      :{success:true,weeklyEnabled:true,monthlyEnabled:false}
    : String(url).includes('automation-rules')
    ? options.method==='POST'?{success:true,ruleId:JSON.parse(options.body).ruleId,enabled:JSON.parse(options.body).enabled,enabledSlots:JSON.parse(options.body).enabledSlots||['evening']}
      :{success:true,rules:Object.fromEntries(['daily_reminder','quota_exhausted','trial_expiry','weekly_digest'].map(id=>[id,{enabled:false,enabledSlots:['evening']}]))}
    : {success:true,appSaved:1,sent:1,failed:0,totalTargeted:1};
  return {ok:true,json:async()=>data} as any;
};
assert.deepEqual(await client.fetchDailyReminderRule(),{enabled:false,enabledSlots:['evening']});
assert.equal(await client.setDailyReminderEnabled(true),true);
assert.deepEqual(await client.setDailyReminderSlots(['evening']),['evening']);
assert.equal(await client.setAutomationRuleEnabled('trial_expiry',true),true);
const clientPreview=await client.previewDailyReminder();assert.equal(clientPreview.totalTargeted,1);
const clientRun=await client.triggerAutomatedBroadcast('daily_reminder',[]);assert.equal(clientRun.telegramSent,1);
assert.deepEqual(routeCalls.map(x=>x.body?.action||x.body?.ruleId||'GET'),['GET','daily_reminder','daily_reminder','trial_expiry','preview','send']);
const reportsClient=await import(new URL('src/services/userService.js',adminRoot).href);
assert.deepEqual(await reportsClient.getAutoTahlilSettings(),{weeklyEnabled:true,monthlyEnabled:false});
assert.deepEqual(await reportsClient.saveAutoTahlilSettings({weeklyEnabled:true,monthlyEnabled:false}),{weeklyEnabled:true,monthlyEnabled:false});
assert.deepEqual(routeCalls.slice(-4).map(x=>x.body?.ruleId||'GET'),['GET','scheduled_weekly_report','scheduled_monthly_report','GET']);
console.log('Cron auth: separate route-only secret, verified recipients, scheduled-report gate and removed legacy broadcast passed.');
