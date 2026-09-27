import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { dueScheduledReports } from '../shared/scheduledReports.js'

const due = dueScheduledReports(new Date('2026-09-27T15:20:00Z'))
assert.deepEqual(due.map(r => r.type), ['weekly'])
assert.equal(due[0].startDate, '2026-09-20T19:00:00.000Z')
assert.equal(due[0].endDate, '2026-09-27T18:59:59.999Z')
assert.deepEqual(dueScheduledReports(new Date('2026-05-31T15:20:00Z')).map(r => r.type), ['weekly','monthly'])
assert.deepEqual(dueScheduledReports(new Date('2026-05-30T15:20:00Z')), [])
assert.deepEqual(dueScheduledReports(new Date('2026-05-31T18:59:00Z')).map(r => r.type), ['weekly','monthly'])
assert.deepEqual(dueScheduledReports(new Date('2026-05-31T19:01:00Z')), [])
const db = new PGlite()
try {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
    CREATE TABLE moliya_automation_rules(rule_id text PRIMARY KEY CHECK(rule_id IN ('daily_reminder','quota_exhausted','trial_expiry','weekly_digest')),enabled boolean NOT NULL,enabled_slots text[] NOT NULL DEFAULT '{}',updated_at timestamptz DEFAULT now());
    INSERT INTO moliya_automation_rules(rule_id,enabled) VALUES ('daily_reminder',true);`)
  const sql = await readFile(new URL('../migrations/16-scheduled-reports.sql', import.meta.url),'utf8')
  await db.exec(sql)
  await db.exec(sql)
  const rows = (await db.query<{rule_id:string;enabled:boolean}>('SELECT rule_id,enabled FROM moliya_automation_rules ORDER BY rule_id')).rows
  assert.equal(rows.length, 3)
  assert.equal(rows.find(r=>r.rule_id==='scheduled_weekly_report')?.enabled,false)
  assert.equal(rows.find(r=>r.rule_id==='scheduled_monthly_report')?.enabled,false)
  await assert.rejects(db.query("INSERT INTO moliya_automation_rules(rule_id,enabled) VALUES ('unknown',true)"))
  const grants = (await db.query<{role:string;allowed:boolean}>("SELECT role,has_table_privilege(role,'moliya_automation_rules','UPDATE') allowed FROM (VALUES ('anon'),('authenticated')) t(role)")).rows
  assert.ok(grants.every(row=>!row.allowed))
} finally { await db.close() }
console.log('Scheduled report day, period and migration checks passed; no live reports sent.')
