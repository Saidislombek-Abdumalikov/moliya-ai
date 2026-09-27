import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE public.admin_audit_log (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      action text NOT NULL, target_user_id text, details jsonb
    );
    GRANT ALL ON public.admin_audit_log TO PUBLIC;
    GRANT SELECT(details), UPDATE(details) ON public.admin_audit_log TO anon;
    GRANT SELECT(action) ON public.admin_audit_log TO authenticated;
    INSERT INTO public.admin_audit_log(action,details) VALUES ('before', '{"private":true}');`);
  const sql = await readFile(new URL('../migrations/15-private-admin-audit.sql', import.meta.url), 'utf8');
  await db.exec(sql);
  await db.exec(sql);

  const status = (await db.query<{ relrowsecurity: boolean }>(
    "SELECT relrowsecurity FROM pg_class WHERE oid='public.admin_audit_log'::regclass"
  )).rows[0];
  assert.equal(status.relrowsecurity, true);
  for (const role of ['anon', 'authenticated']) {
    const { rows: [rights] } = await db.query<{
      read: boolean; write: boolean; column_read: boolean; column_write: boolean;
    }>(`SELECT has_table_privilege($1,'public.admin_audit_log','SELECT') AS read,
      has_table_privilege($1,'public.admin_audit_log','INSERT') AS write,
      has_any_column_privilege($1,'public.admin_audit_log','SELECT') AS column_read,
      has_any_column_privilege($1,'public.admin_audit_log','UPDATE') AS column_write`, [role]);
    assert.deepEqual(rights, { read: false, write: false, column_read: false, column_write: false });
    await db.exec(`SET ROLE ${role}`);
    try {
      await assert.rejects(db.query('SELECT * FROM public.admin_audit_log'), /permission denied/);
    } finally {
      await db.exec('RESET ROLE');
    }
  }
  assert.equal((await db.query<{ allowed: boolean }>(
    "SELECT has_table_privilege('service_role','public.admin_audit_log','SELECT, INSERT') AS allowed"
  )).rows[0].allowed, true);
  await db.exec("SET ROLE service_role; INSERT INTO public.admin_audit_log(action) VALUES ('after'); RESET ROLE;");
  assert.equal((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM public.admin_audit_log')).rows[0].count, 2);
  console.log('PASS private admin audit RLS, grants, idempotence and server insert');
} finally {
  await db.close();
}
