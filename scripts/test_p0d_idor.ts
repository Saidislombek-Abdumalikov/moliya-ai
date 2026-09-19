import fs from 'fs';
import path from 'path';

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
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch {}

import crypto from 'crypto';
import authHandler from '../api/auth.js';
import adminHandler from '../api/admin.js';
import { supabase } from '../api/_supabaseClient.js';

const BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const ADMIN_KEY = process.env.ADMIN_SECRET_KEY || '9f8a3c4e1b2d5a7f6c8e0b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0a2f';

function createMockReqRes(options: {
  method?: string;
  url?: string;
  query?: Record<string, any>;
  headers?: Record<string, any>;
  body?: any;
}) {
  let statusCode = 200;
  let responseData: any = null;
  const headers: Record<string, any> = {};

  const req: any = {
    method: options.method || 'POST',
    url: options.url || '/api/auth?action=delete-account',
    query: options.query || { action: 'delete-account' },
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    },
    body: options.body || {}
  };

  const res: any = {
    setHeader: (k: string, v: any) => { headers[k.toLowerCase()] = v; },
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (data: any) => {
      responseData = data;
      return res;
    },
    end: (data?: any) => {
      if (data) responseData = data;
      return res;
    }
  };

  return {
    req,
    res,
    getStatusCode: () => statusCode,
    getResponseData: () => responseData
  };
}

function createValidTelegramInitData(user: any, botToken: string): string {
  const userJson = JSON.stringify(user);
  const authDate = Math.floor(Date.now() / 1000).toString();
  const params: Record<string, string> = {
    auth_date: authDate,
    query_id: 'AAHdF6IQAAAAAN0XohD9w7d_',
    user: userJson
  };
  const keys = Object.keys(params).sort();
  const dataCheckString = keys.map(k => `${k}=${params[k]}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const searchParams = new URLSearchParams(params);
  searchParams.set('hash', hash);
  return searchParams.toString();
}

async function runTests() {
  console.log('====================================================');
  console.log('   MOLIYA AI — STAGE P0-D SECURITY TEST SUITE');
  console.log('   Secure Delete Account & IDOR Remediation Verification');
  console.log('====================================================\n');

  let passedCount = 0;
  let failedCount = 0;

  function assertTest(name: string, condition: boolean, details?: string) {
    if (condition) {
      console.log(`  ✅ [PASS] ${name}`);
      passedCount++;
    } else {
      console.error(`  ❌ [FAIL] ${name} ${details ? `(${details})` : ''}`);
      failedCount++;
    }
  }

  // --- SECTION 1: Unauthenticated Requests ---
  console.log('--- 1. Unauthenticated Caller Tests (Fail-Closed) ---');
  {
    const { req, res, getStatusCode, getResponseData } = createMockReqRes({
      body: { userId: 'victim_user_123' }
    });
    await authHandler(req, res);
    assertTest('Unauthenticated call with userId fails with 401', getStatusCode() === 401, `got ${getStatusCode()}`);
    assertTest('Error message indicates auth requirement', String(getResponseData()?.error).includes('Unauthorized'));
  }

  {
    const { req, res, getStatusCode } = createMockReqRes({
      body: { telegramId: '12345678' }
    });
    await authHandler(req, res);
    assertTest('Unauthenticated call with telegramId fails with 401', getStatusCode() === 401, `got ${getStatusCode()}`);
  }

  {
    const { req, res, getStatusCode } = createMockReqRes({
      body: {}
    });
    await authHandler(req, res);
    assertTest('Unauthenticated empty body fails with 401', getStatusCode() === 401, `got ${getStatusCode()}`);
  }

  // --- SECTION 2: Invalid Telegram Authentication ---
  console.log('\n--- 2. Invalid Telegram Authentication Tests ---');
  {
    const { req, res, getStatusCode } = createMockReqRes({
      body: {
        initData: 'query_id=AAHdF6IQAAAAAN0XohD9w7d_&user=%7B%22id%22%3A123456%7D&auth_date=1600000000&hash=invalid_hash_signature_xyz'
      }
    });
    await authHandler(req, res);
    assertTest('Forged/invalid Telegram initData fails with 401', getStatusCode() === 401, `got ${getStatusCode()}`);
  }

  // --- SECTION 3: Telegram Mini App IDOR Prevention ---
  console.log('\n--- 3. Telegram Mini App IDOR Prevention Tests ---');
  const userA_tg = { id: 7770001, first_name: 'Attacker A' };
  const userA_initData = createValidTelegramInitData(userA_tg, BOT_TOKEN);

  {
    // Attacker A provides their own valid initData, but supplies Victim B's telegramId
    const { req, res, getStatusCode, getResponseData } = createMockReqRes({
      body: {
        initData: userA_initData,
        telegramId: '7770002' // Victim B's Telegram ID
      }
    });
    await authHandler(req, res);
    assertTest('Telegram user trying to delete different telegramId fails with 403 Forbidden', getStatusCode() === 403, `got ${getStatusCode()}`);
    assertTest('Response contains forbidden error', String(getResponseData()?.error).includes('Forbidden'));
  }

  {
    // Attacker A provides their own valid initData, but supplies Victim B's userId
    const { req, res, getStatusCode } = createMockReqRes({
      body: {
        initData: userA_initData,
        userId: 'moliya_user_tg_7770002' // Victim B's userId
      }
    });
    await authHandler(req, res);
    assertTest('Telegram user trying to delete different userId fails with 403 Forbidden', getStatusCode() === 403, `got ${getStatusCode()}`);
  }

  {
    // Attacker A provides valid initData, but supplies arbitrary victim UUID
    const { req, res, getStatusCode } = createMockReqRes({
      body: {
        initData: userA_initData,
        userId: 'some-random-uuid-target'
      }
    });
    await authHandler(req, res);
    assertTest('Telegram user trying to delete arbitrary UUID user fails with 403 Forbidden', getStatusCode() === 403, `got ${getStatusCode()}`);
  }

  // --- SECTION 4: Web Session Authentication & IDOR ---
  console.log('\n--- 4. Web App Session Authentication & IDOR Prevention Tests ---');
  {
    const { req, res, getStatusCode } = createMockReqRes({
      body: { sessionToken: 'non_existent_token_1234567890' }
    });
    await authHandler(req, res);
    assertTest('Non-existent Web session token fails with 401', getStatusCode() === 401, `got ${getStatusCode()}`);
  }

  {
    const { req, res, getStatusCode } = createMockReqRes({
      headers: { authorization: 'Bearer invalid_bearer_token_12345678' }
    });
    await authHandler(req, res);
    assertTest('Invalid Bearer token fails with 401', getStatusCode() === 401, `got ${getStatusCode()}`);
  }

  // Create temporary test users in Supabase to test legitimate and IDOR Web deletion
  const testWebUserIdA = `test_p0d_web_user_a_${Date.now()}`;
  const testWebTokenA = `test_sess_token_user_a_${crypto.randomBytes(16).toString('hex')}`;
  const testVictimUserIdB = `test_p0d_web_victim_b_${Date.now()}`;

  try {
    // Insert User A and User B
    await supabase.from('users').insert([
      {
        id: testWebUserIdA,
        name: 'Test Web User A',
        onboarding: { session_token: testWebTokenA }
      },
      {
        id: testVictimUserIdB,
        name: 'Test Victim User B',
        onboarding: { session_token: `victim_token_${crypto.randomBytes(16).toString('hex')}` }
      }
    ]);

    // Test Web User A trying to delete Victim User B
    {
      const { req, res, getStatusCode, getResponseData } = createMockReqRes({
        headers: { authorization: `Bearer ${testWebTokenA}` },
        body: {
          sessionToken: testWebTokenA,
          userId: testVictimUserIdB // Attempting IDOR against User B
        }
      });
      await authHandler(req, res);
      assertTest('Web user trying to delete another userId fails with 403 Forbidden', getStatusCode() === 403, `got ${getStatusCode()}`);
      assertTest('Response contains forbidden message', String(getResponseData()?.error).includes('Forbidden'));

      // Verify Victim B is still present in Supabase
      const { data: checkVictim } = await supabase.from('users').select('id').eq('id', testVictimUserIdB).maybeSingle();
      assertTest('Victim User B was NOT deleted from database', Boolean(checkVictim?.id));
    }

    // Test Web User A trying to specify someone else's telegramId
    {
      const { req, res, getStatusCode } = createMockReqRes({
        headers: { authorization: `Bearer ${testWebTokenA}` },
        body: {
          sessionToken: testWebTokenA,
          telegramId: '99999999'
        }
      });
      await authHandler(req, res);
      assertTest('Web user trying to target mismatched telegramId fails with 403 Forbidden', getStatusCode() === 403, `got ${getStatusCode()}`);
    }

    // Test Legitimate Self-Deletion for Web User A
    {
      const { req, res, getStatusCode, getResponseData } = createMockReqRes({
        headers: { authorization: `Bearer ${testWebTokenA}` },
        body: {
          sessionToken: testWebTokenA,
          userId: testWebUserIdA // Matching own userId
        }
      });
      await authHandler(req, res);
      assertTest('Legitimate Web user self-deletion succeeds with 200 OK', getStatusCode() === 200, `got ${getStatusCode()}`);
      assertTest('Response indicates success', Boolean(getResponseData()?.success));

      // Verify User A was deleted from Supabase
      const { data: checkDeletedA } = await supabase.from('users').select('id').eq('id', testWebUserIdA).maybeSingle();
      assertTest('User A record successfully removed from database', checkDeletedA === null);
    }
  } finally {
    // Clean up test users
    await supabase.from('users').delete().or(`id.eq.${testWebUserIdA},id.eq.${testVictimUserIdB}`);
  }

  // --- SECTION 5: Legitimate Telegram Mini App Self-Deletion ---
  console.log('\n--- 5. Legitimate Telegram Mini App Self-Deletion ---');
  const legitTgId = `999888${Math.floor(Math.random() * 1000)}`;
  const legitUserId = `moliya_user_tg_${legitTgId}`;
  const legitTgUser = { id: Number(legitTgId), first_name: 'Legit Mini App User' };
  const legitInitData = createValidTelegramInitData(legitTgUser, BOT_TOKEN);

  try {
    // Insert legit Mini App user
    await supabase.from('users').insert({
      id: legitUserId,
      telegram_id: legitTgId,
      name: 'Legit Mini App User',
      onboarding: { telegramId: legitTgId }
    });

    const { req, res, getStatusCode, getResponseData } = createMockReqRes({
      headers: { 'x-telegram-init-data': legitInitData },
      body: {
        initData: legitInitData,
        telegramId: legitTgId,
        userId: legitUserId
      }
    });
    await authHandler(req, res);
    assertTest('Legitimate Telegram Mini App self-deletion succeeds with 200 OK', getStatusCode() === 200, `got ${getStatusCode()}`);
    assertTest('Mini App deletion response indicates success', Boolean(getResponseData()?.success));

    // Verify removed from database
    const { data: checkDeletedTg } = await supabase.from('users').select('id').eq('id', legitUserId).maybeSingle();
    assertTest('Telegram user record successfully removed from database', checkDeletedTg === null);
  } finally {
    await supabase.from('users').delete().eq('id', legitUserId);
  }

  // --- SECTION 6: Admin Deletion Separation ---
  console.log('\n--- 6. Admin Account Deletion Separation Tests ---');
  {
    // Calling admin endpoint without key
    const { req, res, getStatusCode } = createMockReqRes({
      url: '/api/admin?route=users',
      query: { route: 'users' },
      body: { action: 'delete_account', userId: 'some_user' }
    });
    await adminHandler(req, res);
    assertTest('Admin delete without x-admin-key fails with 401', getStatusCode() === 401, `got ${getStatusCode()}`);
  }

  {
    // Calling admin endpoint with invalid key
    const { req, res, getStatusCode } = createMockReqRes({
      url: '/api/admin?route=users',
      query: { route: 'users' },
      headers: { 'x-admin-key': 'wrong_admin_key_attempt' },
      body: { action: 'delete_account', userId: 'some_user' }
    });
    await adminHandler(req, res);
    assertTest('Admin delete with invalid x-admin-key fails with 401', getStatusCode() === 401, `got ${getStatusCode()}`);
  }

  {
    // Calling admin endpoint with valid x-admin-key
    const testAdminTargetId = `test_p0d_admin_target_${Date.now()}`;
    try {
      await supabase.from('users').insert({
        id: testAdminTargetId,
        name: 'Admin Target User'
      });

      const { req, res, getStatusCode, getResponseData } = createMockReqRes({
        url: '/api/admin?route=users',
        query: { route: 'users' },
        headers: { 'x-admin-key': ADMIN_KEY },
        body: { action: 'delete_account', userId: testAdminTargetId }
      });
      await adminHandler(req, res);
      assertTest('Admin delete with valid x-admin-key succeeds with 200 OK', getStatusCode() === 200, `got ${getStatusCode()}`);
      assertTest('Admin delete action returns success', Boolean(getResponseData()?.success));
    } finally {
      await supabase.from('users').delete().eq('id', testAdminTargetId);
    }
  }

  console.log('\n====================================================');
  console.log(`   SUMMARY: ${passedCount} PASSED | ${failedCount} FAILED`);
  console.log('====================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
