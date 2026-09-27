import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
process.env.SUPABASE_URL='http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY='offline';
process.env.ADMIN_SECRET_KEY='offline-ai-maintenance-key';
const { supabase } = await import('../api/_supabaseClient.js');
const { default: handler } = await import('../api/admin.js');
const users = Array.from({ length: 501 }, (_, i) => ({
  id: `moliya_user_tg_${i + 100}`, telegram_id: String(i + 100),
  ai_query_count: 9, transactions: [{ amount: 123 }], is_premium: true
}));
users.push({ id: 'moliya_user_tg_9999', telegram_id: 'elsewhere', ai_query_count: 9, transactions: [], is_premium: false });
users.push({ id: 'admin_session_state', telegram_id: null, ai_query_count: 9, transactions: [], is_premium: false });
let logs = [{ id: 1 }, { id: 2 }], writes = 0, failWrite = false;
(supabase as any).from = (table: string) => {
  let update: any, ids: string[] = [], from = 0, to = 499, remove = false;
  const q: any = {
    select() { return q; }, order() { return q; }, range(a: number, b: number) { from=a; to=b; return q; },
    update(value: any) { update=value; return q; }, in(_key: string, value: string[]) { ids=value; return q; },
    delete() { remove=true; return q; }, not() { return q; }, insert() { return { data: null, error: null }; },
    then(resolve: any, reject: any) {
      let result: any;
      if (table === 'users' && update) {
        if (failWrite) result={data:null,error:{message:'private DB error'}};
        else {
          for (const user of users.filter(u => ids.includes(u.id))) Object.assign(user, update);
          writes++; result={data:users.filter(u => ids.includes(u.id)).map(u => ({id:u.id})),error:null};
        }
      } else if (table === 'users') result={data:[...users].sort((a,b)=>a.id.localeCompare(b.id)).slice(from,to+1),error:null};
      else if (table === 'ai_logs' && remove) { logs=[]; writes++; result={data:null,error:null}; }
      else result={data:null,error:null};
      return Promise.resolve(result).then(resolve,reject);
    }
  };
  return q;
};
async function api(route: string, method: string, body: any, key = 'offline-ai-maintenance-key') {
  const req: any={method,query:{route},body,headers:key?{'x-admin-key':key}:{},socket:{remoteAddress:'127.0.0.1'}};
  const res: any={statusCode:200,status(n:number){this.statusCode=n;return this},json(value:any){this.body=value;return this},setHeader(){}};
  await handler(req,res); return res;
}
assert.equal((await api('analytics','POST',{action:'reset'},'')).statusCode,401);
assert.equal((await api('ai-query-counts','POST',{action:'reset_all'},'')).statusCode,401);
assert.equal(writes,0);
assert.equal((await api('ai-query-counts','GET',null)).statusCode,405);
assert.equal((await api('ai-query-counts','POST',{action:'wrong'})).statusCode,400);
const reset=await api('ai-query-counts','POST',{action:'reset_all'});
assert.equal(reset.statusCode,200);
assert.equal(reset.body.usersReset,501);
assert.equal(writes,6); // 501 users in six bounded write batches.
assert.equal(users[0].ai_query_count,0);
assert.equal(users[0].is_premium,true);
assert.deepEqual(users[0].transactions,[{amount:123}]);
assert.equal(users[501].ai_query_count,9); // Mismatched Telegram row excluded.
assert.equal(users[502].ai_query_count,9); // Internal state excluded.
failWrite=true;
const failed=await api('ai-query-counts','POST',{action:'reset_all'});
assert.equal(failed.statusCode,503);
assert.ok(!JSON.stringify(failed.body).includes('private DB'));
failWrite=false;
assert.equal((await api('analytics','POST',{action:'reset'})).statusCode,200);
assert.deepEqual(logs,[]);

const root=new URL(existsSync(new URL('../../Admin-Dashboard/',import.meta.url))?'../../Admin-Dashboard/':'../../Admin-Dashboard/',import.meta.url);
const client=await import(new URL('src/services/userService.js',root).href);
const calls: string[]=[];
globalThis.fetch=async (url:any,opts:any)=>{calls.push(url); assert.equal(opts.credentials,'include');return {ok:true,json:async()=>({success:true})} as any};
await client.clearAllAiLogs(); await client.resetAllUsersAiCount();
assert.deepEqual(calls,['/api/admin?route=analytics','/api/admin?route=ai-query-counts']);
globalThis.fetch=async()=>({ok:false,status:503,json:async()=>({error:'USER_STORE_UNAVAILABLE'})}) as any;
await assert.rejects(client.resetAllUsersAiCount(),/USER_STORE_UNAVAILABLE/);
console.log('Admin AI maintenance: auth, scope, pagination, errors, and client API passed.');
