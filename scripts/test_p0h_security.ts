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
    method: options.method || 'GET',
    url: options.url || '/api/auth/sync-data',
    query: options.query || {},
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

function generateValidTelegramInitData(userObj: Record<string, any>, botToken: string): string {
  const authDate = Math.floor(Date.now() / 1000).toString();
  const userJson = JSON.stringify(userObj);

  const params = new URLSearchParams();
  params.set('auth_date', authDate);
  params.set('query_id', 'AAEAAQAAAAAA');
  params.set('user', userJson);

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();

  const pairs: string[] = [];
  params.forEach((val, key) => {
    pairs.push(`${key}=${val}`);
  });
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);

  return params.toString();
}

async function runTests() {
  console.log('====================================================');
  console.log('  STAGE P0-H: VERIFICATION TEST SUITE');
  console.log('  Testing Authenticated Sync, Anti-IDOR, Admin & RLS');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${testName} - ${detail || 'Assertion failed'}`);
      failed++;
    }
  }

  const testUserA = { id: 77710001, first_name: 'Alice', username: 'alice_p0h' };
  const testUserB = { id: 77720002, first_name: 'Bob', username: 'bob_p0h' };
  const validInitDataA = generateValidTelegramInitData(testUserA, BOT_TOKEN);
  const validInitDataB = generateValidTelegramInitData(testUserB, BOT_TOKEN);

  // Setup: Create test user A in Supabase
  const testUserIdA = `moliya_user_tg_${testUserA.id}`;
  const testUserIdB = `moliya_user_tg_${testUserB.id}`;

  await supabase.from('users').upsert({
    id: testUserIdA,
    name: 'Alice P0H Test',
    telegram_id: String(testUserA.id),
    is_premium: false,
    ai_limit: 10,
    cards: [{ id: 'card-1', name: 'Uzcard', balance: 500000 }],
    transactions: [{ id: 'tx-1', amount: 20000, type: 'expense', category: 'Oziq-ovqat' }]
  });

  // ----------------------------------------------------
  // TEST 1: Unauthenticated GET /api/auth/sync-data -> 401
  // ----------------------------------------------------
  {
    const { req, res, getStatusCode } = createMockReqRes({
      method: 'GET',
      url: '/api/auth/sync-data',
      query: { action: 'sync-data' }
    });
    await authHandler(req, res);
    assert(getStatusCode() === 401, 'Unauthenticated sync-data GET returns 401 Unauthorized');
  }

  // ----------------------------------------------------
  // TEST 2: Unauthenticated POST /api/auth/sync-data -> 401
  // ----------------------------------------------------
  {
    const { req, res, getStatusCode } = createMockReqRes({
      method: 'POST',
      url: '/api/auth/sync-data',
      query: { action: 'sync-data' },
      body: { cards: [{ id: 'card-hack' }] }
    });
    await authHandler(req, res);
    assert(getStatusCode() === 401, 'Unauthenticated sync-data POST returns 401 Unauthorized');
  }

  // ----------------------------------------------------
  // TEST 3: Tampered Telegram initData -> 401
  // ----------------------------------------------------
  {
    const tamperedInitData = validInitDataA.replace('hash=', 'hash=deadbeef00000000');
    const { req, res, getStatusCode } = createMockReqRes({
      method: 'GET',
      url: '/api/auth/sync-data',
      query: { action: 'sync-data' },
      headers: { 'x-telegram-init-data': tamperedInitData }
    });
    await authHandler(req, res);
    assert(getStatusCode() === 401, 'Tampered Telegram initData returns 401 Unauthorized');
  }

  // ----------------------------------------------------
  // TEST 4: Valid Telegram initData sync-data GET
  // ----------------------------------------------------
  {
    const { req, res, getStatusCode, getResponseData } = createMockReqRes({
      method: 'GET',
      url: '/api/auth/sync-data',
      query: { action: 'sync-data' },
      headers: { 'x-telegram-init-data': validInitDataA }
    });
    await authHandler(req, res);
    const data = getResponseData();
    assert(
      getStatusCode() === 200 && data?.success === true && data?.user?.id === testUserIdA,
      'Valid Telegram initData sync-data GET returns authenticated user data',
      `Got status ${getStatusCode()}, user: ${JSON.stringify(data?.user?.id)}`
    );
  }

  // ----------------------------------------------------
  // TEST 5: Valid Telegram initData sync-data POST (Save Cards & Tx)
  // ----------------------------------------------------
  {
    const newCards = [{ id: 'card-updated', name: 'Humo New', balance: 1200000 }];
    const newTxs = [{ id: 'tx-updated', amount: 45000, type: 'expense', category: 'Kino' }];

    const { req, res, getStatusCode, getResponseData } = createMockReqRes({
      method: 'POST',
      url: '/api/auth/sync-data',
      query: { action: 'sync-data' },
      headers: { 'x-telegram-init-data': validInitDataA },
      body: { cards: newCards, transactions: newTxs }
    });
    await authHandler(req, res);
    const data = getResponseData();
    assert(
      getStatusCode() === 200 && data?.success === true && data?.user?.cards?.[0]?.id === 'card-updated',
      'Valid Telegram initData sync-data POST updates user financial state'
    );
  }

  // ----------------------------------------------------
  // TEST 6: IDOR attempt on sync-data POST (User A targeting User B)
  // ----------------------------------------------------
  {
    const { req, res, getStatusCode, getResponseData } = createMockReqRes({
      method: 'POST',
      url: '/api/auth/sync-data',
      query: { action: 'sync-data' },
      headers: { 'x-telegram-init-data': validInitDataA },
      body: {
        userId: testUserIdB, // Attacking User B
        cards: [{ id: 'card-malicious', balance: 0 }]
      }
    });
    await authHandler(req, res);
    const data = getResponseData();
    assert(
      getStatusCode() === 403,
      'IDOR attempt passing target userId of another user returns 403 Forbidden',
      `Got status ${getStatusCode()}`
    );
  }

  // ----------------------------------------------------
  // TEST 7: Privilege escalation attempt stripped (is_premium, ai_limit)
  // ----------------------------------------------------
  {
    const { req, res, getStatusCode, getResponseData } = createMockReqRes({
      method: 'POST',
      url: '/api/auth/sync-data',
      query: { action: 'sync-data' },
      headers: { 'x-telegram-init-data': validInitDataA },
      body: {
        is_premium: true,
        ai_limit: 999999,
        is_blocked: false,
        cards: [{ id: 'card-safe', balance: 100 }]
      }
    });
    await authHandler(req, res);
    const data = getResponseData();

    // Verify in database that is_premium was NOT changed to true
    const { data: dbUser } = await supabase.from('users').select('is_premium, ai_limit').eq('id', testUserIdA).single();
    assert(
      getStatusCode() === 200 && dbUser?.is_premium === false && dbUser?.ai_limit === 10,
      'Privilege escalation fields (is_premium, ai_limit) in sync-data are stripped and ignored',
      `dbUser is_premium=${dbUser?.is_premium}, ai_limit=${dbUser?.ai_limit}`
    );
  }

  // ----------------------------------------------------
  // TEST 8: Web App session token sync
  // ----------------------------------------------------
  {
    const testSessionToken = 'sess_test_p0h_' + crypto.randomBytes(16).toString('hex');
    // Store valid session token on user A
    await supabase.from('users').update({
      onboarding: {
        session_token: testSessionToken,
        session_expires_at: new Date(Date.now() + 86400000).toISOString()
      }
    }).eq('id', testUserIdA);

    const { req, res, getStatusCode, getResponseData } = createMockReqRes({
      method: 'GET',
      url: '/api/auth/sync-data',
      query: { action: 'sync-data' },
      headers: { authorization: `Bearer ${testSessionToken}` }
    });
    await authHandler(req, res);
    const data = getResponseData();
    assert(
      getStatusCode() === 200 && data?.success === true && data?.user?.id === testUserIdA,
      'Valid Web App session token sync-data GET returns authenticated user data'
    );
  }

  // ----------------------------------------------------
  // TEST 9: Unauthenticated wipe-data -> 401
  // ----------------------------------------------------
  {
    const { req, res, getStatusCode } = createMockReqRes({
      method: 'POST',
      url: '/api/auth/wipe-data',
      query: { action: 'wipe-data' }
    });
    await authHandler(req, res);
    assert(getStatusCode() === 401, 'Unauthenticated wipe-data returns 401 Unauthorized');
  }

  // ----------------------------------------------------
  // TEST 10: Authenticated user self-wipe clears cards & tx
  // ----------------------------------------------------
  {
    const { req, res, getStatusCode, getResponseData } = createMockReqRes({
      method: 'POST',
      url: '/api/auth/wipe-data',
      query: { action: 'wipe-data' },
      headers: { 'x-telegram-init-data': validInitDataA }
    });
    await authHandler(req, res);
    const data = getResponseData();

    const { data: wipedUser } = await supabase.from('users').select('cards, transactions').eq('id', testUserIdA).single();
    assert(
      getStatusCode() === 200 &&
      data?.success === true &&
      Array.isArray(wipedUser?.cards) && wipedUser.cards.length === 0 &&
      Array.isArray(wipedUser?.transactions) && wipedUser.transactions.length === 0,
      'Authenticated self-wipe clears cards and transactions for the caller'
    );
  }

  // ----------------------------------------------------
  // TEST 11: Admin API users route rejects invalid keys
  // ----------------------------------------------------
  {
    const { req, res, getStatusCode } = createMockReqRes({
      method: 'GET',
      url: '/api/admin?route=users',
      query: { route: 'users' },
      headers: { 'x-admin-key': 'wrong_key_1234567890' }
    });
    await adminHandler(req, res);
    assert(getStatusCode() === 401, 'Admin API rejects wrong admin key with 401 Unauthorized');
  }

  // ----------------------------------------------------
  // TEST 12: Admin API users route succeeds with valid key
  // ----------------------------------------------------
  {
    const { req, res, getStatusCode, getResponseData } = createMockReqRes({
      method: 'GET',
      url: '/api/admin?route=users',
      query: { route: 'users' },
      headers: { 'x-admin-key': ADMIN_KEY }
    });
    await adminHandler(req, res);
    const data = getResponseData();
    assert(
      getStatusCode() === 200 && data?.success === true && Array.isArray(data?.users),
      'Admin API with valid key successfully fetches users list'
    );
  }

  // ----------------------------------------------------
  // TEST 13: Admin API notifications route succeeds with valid key
  // ----------------------------------------------------
  {
    const { req, res, getStatusCode, getResponseData } = createMockReqRes({
      method: 'GET',
      url: '/api/admin?route=notifications',
      query: { route: 'notifications' },
      headers: { 'x-admin-key': ADMIN_KEY }
    });
    await adminHandler(req, res);
    const data = getResponseData();
    assert(
      getStatusCode() === 200 && Array.isArray(data),
      'Admin API with valid key successfully fetches notifications'
    );
  }

  // Cleanup: remove test users
  await supabase.from('users').delete().or(`id.eq.${testUserIdA},id.eq.${testUserIdB}`);

  console.log('\n====================================================');
  console.log(`  SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
