import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
const sql = await readFile(new URL('../migrations/13-reminder-delivery.sql', import.meta.url), 'utf8');
await db.exec(sql);
await db.exec(sql);
const automationSql = await readFile(new URL('../migrations/14-automation-controls.sql', import.meta.url), 'utf8');
await db.exec(automationSql);
await db.exec(automationSql);
assert.equal((await db.query<{enabled:boolean}>('SELECT enabled FROM public.moliya_automation_rules WHERE rule_id=$1',['daily_reminder'])).rows[0].enabled,true);
await db.query('UPDATE public.moliya_automation_rules SET enabled=false WHERE rule_id=$1',['daily_reminder']);
await db.exec(automationSql);
assert.equal((await db.query<{enabled:boolean}>('SELECT enabled FROM public.moliya_automation_rules WHERE rule_id=$1',['daily_reminder'])).rows[0].enabled,false);
const ruleRows=(await db.query<{rule_id:string}>('SELECT rule_id FROM public.moliya_automation_rules ORDER BY rule_id')).rows.map(r=>r.rule_id);
assert.deepEqual(ruleRows,['daily_reminder','quota_exhausted','trial_expiry','weekly_digest']);
await db.query('UPDATE public.moliya_automation_rules SET enabled=true WHERE rule_id=$1',['weekly_digest']);
await db.exec(automationSql);
assert.equal((await db.query<{enabled:boolean}>('SELECT enabled FROM public.moliya_automation_rules WHERE rule_id=$1',['weekly_digest'])).rows[0].enabled,true);
const extraClaim=(id:string,rule:string,occurrence:string)=>db.query(
  'INSERT INTO public.moliya_automation_delivery(user_id,rule_id,occurrence) VALUES ($1,$2,$3)',[id,rule,occurrence]);
await extraClaim('moliya_user_tg_123','quota_exhausted','2026-09-26');
await assert.rejects(extraClaim('moliya_user_tg_123','quota_exhausted','2026-09-26'),/duplicate key/);
await assert.rejects(extraClaim('moliya_user_tg_123','unknown','2026-09-26'),/check constraint/);
const claim = (id: string, day: string) => db.query(
  'INSERT INTO public.moliya_reminder_delivery(user_id,local_day) VALUES ($1,$2) RETURNING user_id', [id, day]);
await claim('moliya_user_tg_123', '2026-09-26');
await assert.rejects(claim('moliya_user_tg_123', '2026-09-26'), /duplicate key/);
await claim('moliya_user_tg_123', '2026-09-27');
await claim('moliya_user_tg_456', '2026-09-26');
await assert.rejects(claim('invalid', '2026-09-26'), /check constraint/);
for (const role of ['anon', 'authenticated']) {
  await db.exec(`SET ROLE ${role}`);
  try {
    await assert.rejects(db.query('SELECT * FROM public.moliya_reminder_delivery'), /permission denied/);
    await assert.rejects(claim('moliya_user_tg_999', '2026-09-26'), /permission denied/);
    await assert.rejects(db.query('SELECT * FROM public.moliya_automation_rules'), /permission denied/);
    await assert.rejects(db.query('SELECT * FROM public.moliya_automation_delivery'), /permission denied/);
    await assert.rejects(extraClaim('moliya_user_tg_999','trial_expiry','2026-09-26'), /permission denied/);
    await assert.rejects(db.query("UPDATE public.moliya_automation_rules SET enabled=true WHERE rule_id='daily_reminder'"), /permission denied/);
  } finally { await db.exec('RESET ROLE'); }
}
await db.close();
console.log('Reminder SQL uniqueness, valid IDs, repeat migration and role permissions passed.');
