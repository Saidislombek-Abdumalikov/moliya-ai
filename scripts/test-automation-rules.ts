import assert from 'node:assert/strict';
process.env.SUPABASE_URL='http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY='offline';
process.env.TELEGRAM_BOT_TOKEN='offline-bot';
const {supabase}=await import('../api/_supabaseClient.js');
const {checkAndRecordAiUsage}=await import('../api/_aiQuotaHelper.js');
const {dueAutomationUsers,cleanupAutomationClaims}=await import('../api/_automation.js');
const verified:any={id:'moliya_user_tg_123',telegram_id:'123',phone:'+998901234567',onboarding:{},
 bot_verification:{telegram_id:'123',phone:'+998901234567',phone_source:'telegram_own_contact',
 phone_verified_at:'2026-01-01',consent_source:'telegram_button',consent_version:'v1',consent_accepted_at:'2026-01-01'}};
let enabled=true,claims=0,notices=0,sends=0;
const cleanup:Array<[string,string,string]>=[];
const keys=new Set<string>();
(supabase as any).rpc=async()=>({data:{allowed:false,isPremium:false,isTrial:false,limit:2,usedCount:2,code:'QUOTA_EXCEEDED'},error:null});
(supabase as any).from=(table:string)=>{
 const q:any={select(){return q},eq(){return q},delete(){return q},lt(field:string,value:string){cleanup.push([table,field,value]);return Promise.resolve({error:null})},maybeSingle(){return Promise.resolve({data:table==='users'?verified:{enabled},error:null})},
  insert(value:any){if(table==='moliya_automation_delivery'){
    claims++;const key=`${value.user_id}:${value.rule_id}:${value.occurrence}`;
    if(keys.has(key))return Promise.resolve({error:{code:'23505'}});
    keys.add(key);return Promise.resolve({error:null});
   }
   if(table==='app_notifications'){notices++;return Promise.resolve({error:null})}
   throw new Error('unexpected insert');
  }};
 return q;
};
globalThis.fetch=async()=>{sends++;return {json:async()=>({ok:true})} as any};
const id=verified.id;
assert.equal((await checkAndRecordAiUsage(id,'text','','telegram_bot')).code,'QUOTA_EXCEEDED');
assert.equal(notices,1);assert.equal(sends,0);
await checkAndRecordAiUsage(id,'text','','mini_app');
assert.equal(notices,1);assert.equal(sends,0);
enabled=false;
await checkAndRecordAiUsage('moliya_user_tg_456','text','','mini_app');
assert.equal(claims,2);assert.equal(notices,1);

const sunday=new Date('2026-09-27T15:00:00.000Z'); // 20:00 Tashkent
const trial={...verified,trial_ends_at:new Date(sunday.getTime()+3600_000).toISOString()};
assert.equal(dueAutomationUsers([trial,{...trial,bot_verification:null}],'trial_expiry',sunday).length,1);
assert.equal(dueAutomationUsers([{...trial,is_premium:true}],'trial_expiry',sunday).length,0);
assert.equal(dueAutomationUsers([{...trial,is_premium:true,premium_expires_at:trial.trial_ends_at}],'trial_expiry',sunday).length,1);
assert.equal(dueAutomationUsers([{...trial,is_premium:true,premium_expires_at:new Date(sunday.getTime()+30*86400_000).toISOString()}],'trial_expiry',sunday).length,0);
assert.equal(dueAutomationUsers([{...verified,transactions:[{date:'2026-09-26',type:'expense',amount:30000}]}],
 'weekly_digest',sunday).length,1);
assert.equal(dueAutomationUsers([verified],'weekly_digest',sunday).length,0);
assert.equal(dueAutomationUsers([{...verified,onboarding:{notifications:{opt2:false}},transactions:[{date:'2026-09-26',type:'expense',amount:30000}]}],'weekly_digest',sunday).length,0);
assert.match(dueAutomationUsers([{...verified,language:'en',transactions:[{date:'2026-09-26',type:'expense',amount:30000}]}],'weekly_digest',sunday)[0].message || '',/expenses: 30,000 UZS/);
assert.equal(dueAutomationUsers([verified],'weekly_digest',new Date('2026-09-28T15:00:00Z')).length,0);
await cleanupAutomationClaims(new Date('2026-09-27T15:00:00Z'));
assert.deepEqual(cleanup.map(([table,field])=>[table,field]),[
 ['moliya_reminder_delivery','local_day'],['moliya_automation_delivery','created_at']
]);
console.log('Quota event notification, deduplication, opt-out and due rule selection passed.');
