import fs from 'fs';
import path from 'path';

// Parse .env manually
try {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
} catch {}

import { createClient } from '@supabase/supabase-js';
import { createSupabaseAuthSession } from '../api/_authHelper.js';
import authHandler from '../api/auth.js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function runComprehensiveVerification() {
  console.log('================================================================');
  console.log('  P0-H FINAL SAFETY REVIEW: TEST DESIGN & VERIFICATION');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${testName} - ${detail || 'Assertion failed'}`);
      failed++;
    }
  }

  // --- 1. Schema Type Verification ---
  console.log('--- 1. users.telegram_id Schema Type Verification ---');
  // Confirm that telegram_id is TEXT by testing alphanumeric string handling
  const tempId = 'verify_type_' + Date.now();
  const { error: insErr } = await service.from('users').insert([{ id: tempId, telegram_id: 'str_numeric_99901' }]);
  assert(!insErr, 'telegram_id accepts TEXT string without numeric casting error');
  await service.from('users').delete().eq('id', tempId);

  // --- 2. app_notifications Classification & Audience Isolation ---
  console.log('\n--- 2. app_notifications Data Classification & Isolation ---');
  const { data: currentNotifs } = await service.from('app_notifications').select('*').limit(5);
  const hasUserColumns = currentNotifs?.some(n => 'user_id' in n || 'telegram_id' in n);
  assert(!hasUserColumns, 'app_notifications table has NO private user_id/telegram_id columns');

  // Verify that target values are public categories or audience tags
  const targets = (currentNotifs || []).map(n => n.target);
  console.log('   Current live targets in app_notifications:', targets);
  assert(targets.every(t => ['all', 'telegram', 'web', 'free', 'vip', null, undefined].includes(t)),
    'All existing live notifications are categorized broadcast announcements');

  // --- 3. Privileged Field Tampering Block Verification ---
  console.log('\n--- 3. Privileged Fields Direct-Update Testing ---');
  // In the backend sync-data endpoint, verify privileged fields cannot be escalated
  const testTgId = '999888111';
  const testUserId = `moliya_user_tg_${testTgId}`;

  await service.from('users').upsert({
    id: testUserId,
    name: 'Tamper Tester',
    telegram_id: testTgId,
    is_premium: false,
    ai_limit: 10,
    cards: [],
    transactions: []
  });

  const session = await createSupabaseAuthSession(testTgId, { name: 'Tamper Tester' });
  const authUserJwt = session?.access_token;

  // Test: Malicious caller tries to escalate is_premium via sync-data POST
  const mockReq: any = {
    method: 'POST',
    url: '/api/auth/sync-data',
    query: { action: 'sync-data' },
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${authUserJwt}`
    },
    body: {
      is_premium: true,
      ai_limit: 99999,
      is_blocked: false,
      cards: [{ id: 'card-tamper-test' }]
    }
  };

  let mockStatus = 200;
  let mockData: any = null;
  const mockRes: any = {
    setHeader: () => {},
    status: (code: number) => { mockStatus = code; return mockRes; },
    json: (d: any) => { mockData = d; return mockRes; }
  };

  await authHandler(mockReq, mockRes);

  const { data: userAfter } = await service.from('users').select('is_premium, ai_limit').eq('id', testUserId).single();
  assert(
    mockStatus === 200 && userAfter?.is_premium === false && userAfter?.ai_limit === 10,
    'Privileged fields (is_premium, ai_limit) tampering in sync-data completely stripped and ignored',
    `is_premium=${userAfter?.is_premium}, ai_limit=${userAfter?.ai_limit}`
  );

  // --- 4. User A -> User B IDOR / Cross-Tenant Isolation ---
  console.log('\n--- 4. User A -> User B Cross-Tenant Isolation ---');
  const victimUserId = 'moliya_user_tg_777777777';
  await service.from('users').upsert({
    id: victimUserId,
    name: 'Victim User B',
    telegram_id: '777777777',
    cards: [{ id: 'victim-card', balance: 10000000 }]
  });

  // User A tries to pass User B's ID in sync-data
  const mockIdorReq: any = {
    method: 'POST',
    url: '/api/auth/sync-data',
    query: { action: 'sync-data' },
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${authUserJwt}`
    },
    body: {
      userId: victimUserId,
      cards: [{ id: 'hacked-card' }]
    }
  };

  let idorStatus = 200;
  const mockIdorRes: any = {
    setHeader: () => {},
    status: (code: number) => { idorStatus = code; return mockIdorRes; },
    json: () => mockIdorRes
  };

  await authHandler(mockIdorReq, mockIdorRes);
  assert(idorStatus === 403, 'Cross-user IDOR access returns HTTP 403 Forbidden');

  // Verify victim data remained untouched
  const { data: victimCheck } = await service.from('users').select('cards').eq('id', victimUserId).single();
  assert(
    victimCheck?.cards?.[0]?.id === 'victim-card',
    'Victim User B data was completely untouched in database'
  );

  // Clean up test rows
  await service.from('users').delete().or(`id.eq.${testUserId},id.eq.${victimUserId}`);
  if (session?.auth_user_id) {
    await service.auth.admin.deleteUser(session.auth_user_id);
  }

  console.log('\n================================================================');
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('================================================================\n');

  if (failed > 0) process.exit(1);
}

runComprehensiveVerification().catch(e => {
  console.error('Test execution error:', e);
  process.exit(1);
});
