import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'offline';
process.env.ADMIN_SECRET_KEY = 'offline-legal-admin-key';
const { supabase } = await import('../api/_supabaseClient.js');
const { default: admin } = await import('../api/admin.js');
const { default: auth } = await import('../api/auth.js');
const { loadAiParserGuidance } = await import('../api/_aiParserGuidance.js');
const { buildUzbekFinancialAiPrompt } = await import('../api/_uzbekFinancialNormalizer.js');

let onboarding: any = { session_token: 'SECRET_SESSION', ai_prompt: 'SECRET_PROMPT',
  oferta_text: 'Old offer', privacy_policy: 'Old privacy' };
let writes = 0, failRead = false, failWrite = false;
let resetCalls = 0, failReset = false;
(supabase as any).rpc = async (fn: string) => {
  assert.equal(fn, 'moliya_reset_free_ai_overrides'); resetCalls++;
  return failReset ? { data: null, error: { message: 'PRIVATE_DB_ERROR' } } : { data: 2, error: null };
};
(supabase as any).from = (table: string) => {
  if (table === 'admin_audit_log') return { insert(rows: any[]) {
    assert.ok(['UPDATE_APP_SETTINGS', 'RESET_FREE_AI_OVERRIDES'].includes(rows[0].action)); return { error: null };
  } };
  assert.equal(table, 'users');
  let id = '';
  const q: any = {
    select(columns: string) { assert.equal(columns, 'onboarding'); return q; },
    eq(field: string, value: string) { assert.equal(field, 'id'); id = value; return q; },
    async maybeSingle() {
      assert.equal(id, 'system_app_settings');
      return failRead ? { data: null, error: { message: 'PRIVATE_DB_ERROR' } } :
        { data: { onboarding }, error: null };
    },
    upsert(row: any) {
      assert.equal(row.id, 'system_app_settings');
      if (failWrite) return { error: { message: 'PRIVATE_DB_ERROR' } };
      onboarding = row.onboarding; writes++;
      return { error: null };
    }
  };
  return q;
};

async function call(handler: any, action: string, method = 'GET', body: any = null, adminKey = '') {
  const req: any = { method, query: handler === admin ? { route: action } : { action }, body,
    url: `/api/${handler === admin ? 'admin' : 'auth'}?${action}`,
    headers: adminKey ? { 'x-admin-key': adminKey } : {}, socket: { remoteAddress: '127.0.0.1' } };
  const res: any = { statusCode: 200, headers: {}, setHeader(k: string, v: any) { this.headers[k] = v; },
    status(n: number) { this.statusCode = n; return this; }, json(v: any) { this.body = v; return this; } };
  await handler(req, res); return res;
}

const publicText = await call(auth, 'legal');
assert.equal(publicText.statusCode, 200);
assert.deepEqual(Object.keys(publicText.body).sort(), ['oferta_text', 'privacy_policy', 'success']);
assert.equal(publicText.body.oferta_text, 'Old offer');
assert.ok(!JSON.stringify(publicText.body).includes('SECRET_'));
assert.equal((await call(auth, 'legal', 'POST', { oferta_text: 'Hacked' })).statusCode, 405);
assert.equal((await call(admin, 'app-settings', 'POST', { oferta_text: 'Hacked' })).statusCode, 401);
assert.equal(writes, 0);
const key = 'offline-legal-admin-key';
assert.equal((await call(admin, 'app-settings', 'POST', { oferta_text: '' }, key)).statusCode, 400);
assert.equal((await call(admin, 'app-settings', 'POST', { oferta_text: 'A', privacy_policy: 'B' }, key)).statusCode, 400);
assert.equal((await call(admin, 'app-settings', 'POST', { default_ai_quota: '2' }, key)).statusCode, 400);
assert.equal((await call(admin, 'app-settings', 'POST', { default_ai_quota: 0 }, key)).statusCode, 400);
assert.equal((await call(admin, 'app-settings', 'POST', { default_ai_quota: 501 }, key)).statusCode, 400);
assert.equal((await call(admin, 'app-settings', 'POST', { ai_parser_guidance: 7 }, key)).statusCode, 400);
assert.equal((await call(admin, 'app-settings', 'POST', { ai_parser_guidance: 'x'.repeat(2001) }, key)).statusCode, 400);
const saved = await call(admin, 'app-settings', 'POST', { oferta_text: '  New offer  ' }, key);
assert.equal(saved.statusCode, 200);
assert.equal(writes, 1);
assert.equal(onboarding.oferta_text, 'New offer');
assert.equal(onboarding.privacy_policy, 'Old privacy');
assert.equal(onboarding.session_token, 'SECRET_SESSION');
assert.equal((await call(auth, 'legal')).body.oferta_text, 'New offer');
assert.equal((await call(admin, 'app-settings', 'POST', { default_ai_quota: 2 }, key)).statusCode, 200);
assert.equal(onboarding.default_ai_quota, 2);
assert.equal((await call(admin, 'app-settings', 'GET', null, key)).body.default_ai_quota, 2);
assert.equal((await call(auth, 'legal')).body.default_ai_quota, undefined);
assert.equal(await loadAiParserGuidance(), '');
const hint = "'metro' so‘zini Transport toifasiga ajrating";
assert.equal((await call(admin, 'app-settings', 'POST', { ai_parser_guidance: hint }, key)).statusCode, 200);
assert.equal(await loadAiParserGuidance(), hint);
assert.equal((await call(admin, 'app-settings', 'GET', null, key)).body.ai_parser_guidance, hint);
assert.equal((await call(auth, 'legal')).body.ai_parser_guidance, undefined);
const prompt = buildUzbekFinancialAiPrompt('metro 10 ming', undefined, await loadAiParserGuidance());
assert.ok(prompt.includes(hint));
assert.ok(prompt.indexOf(hint) < prompt.indexOf('CRITICAL SECURITY DIRECTIVE'));
assert.ok(prompt.includes('Never invent, estimate or infer a missing amount'));
assert.equal((await call(admin, 'app-settings', 'POST', { ai_parser_guidance: '' }, key)).statusCode, 200);
assert.equal(await loadAiParserGuidance(), '');
assert.equal((await call(admin, 'free-ai-quota', 'POST', { action: 'reset_overrides' })).statusCode, 401);
assert.equal(resetCalls, 0);
assert.equal((await call(admin, 'free-ai-quota', 'POST', { action: 'wrong' }, key)).statusCode, 400);
assert.equal((await call(admin, 'free-ai-quota', 'POST', { action: 'reset_overrides' }, key)).body.usersChanged, 2);
assert.equal(resetCalls, 1);
failReset = true;
assert.equal((await call(admin, 'free-ai-quota', 'POST', { action: 'reset_overrides' }, key)).statusCode, 503);
failReset = false;
failWrite = true;
const rejected = await call(admin, 'app-settings', 'POST', { privacy_policy: 'New privacy' }, key);
assert.equal(rejected.statusCode, 500);
assert.equal(writes, 4);
assert.ok(!JSON.stringify(rejected.body).includes('PRIVATE_DB_ERROR'));
failWrite = false; failRead = true;
assert.equal((await call(auth, 'legal')).statusCode, 503);
assert.equal((await call(admin, 'app-settings', 'POST', { oferta_text: 'B' }, key)).statusCode, 503);

const adminClient = readFileSync(new URL('../../admin Dashboard Moliya/src/components/PrivacyPolicyTab.jsx', import.meta.url), 'utf8');
const userClient = readFileSync(new URL('../src/components/PrivacyPolicyModal.tsx', import.meta.url), 'utf8');
assert.ok(!adminClient.includes("from '../supabase'"));
assert.ok(!userClient.includes("from '../supabase'"));
assert.ok(adminClient.includes("await callAdminApi('app-settings', 'POST'"));
const settingsClient = readFileSync(new URL('../../admin Dashboard Moliya/src/components/SettingsTab.jsx', import.meta.url), 'utf8');
const appParser = readFileSync(new URL('../api/parse-expense.ts', import.meta.url), 'utf8');
const botParser = readFileSync(new URL('../api/telegram-webhook.ts', import.meta.url), 'utf8');
assert.ok(appParser.includes('await loadAiParserGuidance()'));
assert.ok(botParser.includes('await loadAiParserGuidance()'));
assert.ok(settingsClient.includes("callAdminApi('free-ai-quota', 'POST'"));
assert.ok(settingsClient.includes("callAdminApi('app-settings', 'POST', { ai_parser_guidance:"));
assert.ok(!settingsClient.includes("moliya_ai_system_prompt"));
assert.ok(!settingsClient.includes(".upsert({\n          id: 'system_app_settings'"));
assert.ok(!settingsClient.includes(".update({ ai_limit: defaultAiQuota"));
assert.ok(!settingsClient.includes("moliya_system_default_ai_quota"));
assert.ok(userClient.includes("fetch('/api/auth?action=legal'"));
console.log('App settings: legal field isolation, admin quota/parser guidance, validation, persistence errors, and API clients passed.');
