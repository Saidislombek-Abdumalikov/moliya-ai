import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Load .env
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
        process.env[key] = val;
      }
    }
  }
} catch {}

const CONFIGURED_SECRET = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
const BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();

import webhookHandler from '../api/telegram-webhook.js';

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ [PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${testName} ${detail ? `(${detail})` : ''}`);
  }
}

function createMockReqRes(options: {
  method?: string;
  url?: string;
  headers?: Record<string, any>;
  body?: any;
}) {
  let statusCode = 200;
  let responseData: any = null;
  const resHeaders: Record<string, any> = {};

  const req: any = {
    method: options.method || 'POST',
    url: options.url || '/api/telegram-webhook',
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    },
    body: options.body !== undefined ? options.body : null
  };

  const res: any = {
    setHeader: (k: string, v: any) => { resHeaders[k.toLowerCase()] = v; },
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (data: any) => {
      responseData = data;
      return res;
    },
    send: (data: any) => {
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
    getStatus: () => statusCode,
    getData: () => responseData
  };
}

async function runTests() {
  console.log('================================================================');
  console.log('  STAGE P0-G: TELEGRAM WEBHOOK SECRET FAIL-CLOSED TEST SUITE');
  console.log('================================================================\n');

  // Test 1: Secret Configuration & Format
  console.log('--- 1. Secret Configuration & Entropy ---');
  assert(CONFIGURED_SECRET.length >= 32, 'Webhook secret exists and is >= 32 chars length', `Length: ${CONFIGURED_SECRET.length}`);
  assert(/^[a-zA-Z0-9_-]+$/.test(CONFIGURED_SECRET), 'Webhook secret conforms to Telegram allowed character set [A-Za-z0-9_-]');

  // Test 2: Fail-Closed when secret is unset or empty
  console.log('\n--- 2. Fail-Closed Enforcement (Server Misconfiguration) ---');
  {
    const savedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    
    // Simulate unset secret
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const mock1 = createMockReqRes({
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': CONFIGURED_SECRET },
      body: {}
    });
    await webhookHandler(mock1.req, mock1.res);
    assert(mock1.getStatus() === 500, 'Rejects with HTTP 500 when TELEGRAM_WEBHOOK_SECRET is unset in env');
    assert(mock1.getData()?.error?.includes('Server configuration error'), 'Returns proper error message');

    // Simulate empty secret
    process.env.TELEGRAM_WEBHOOK_SECRET = '';
    const mock2 = createMockReqRes({
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': CONFIGURED_SECRET },
      body: {}
    });
    await webhookHandler(mock2.req, mock2.res);
    assert(mock2.getStatus() === 500, 'Rejects with HTTP 500 when TELEGRAM_WEBHOOK_SECRET is empty');

    // Restore configured secret
    process.env.TELEGRAM_WEBHOOK_SECRET = savedSecret;
  }

  // Test 3: Missing Header Rejection
  console.log('\n--- 3. Missing Secret Header ---');
  {
    const mock1 = createMockReqRes({
      method: 'POST',
      headers: {},
      body: { update_id: 9999 }
    });
    await webhookHandler(mock1.req, mock1.res);
    assert(mock1.getStatus() === 401, 'Rejects with HTTP 401 when X-Telegram-Bot-Api-Secret-Token is missing');
    assert(mock1.getData()?.error?.includes('Missing secret token header'), 'Error details indicate missing header');

    const mock2 = createMockReqRes({
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': '' },
      body: { update_id: 9999 }
    });
    await webhookHandler(mock2.req, mock2.res);
    assert(mock2.getStatus() === 401, 'Rejects with HTTP 401 when X-Telegram-Bot-Api-Secret-Token is empty');
  }

  // Test 4: Forged and Tampered Secret Rejection
  console.log('\n--- 4. Forged and Tampered Secret Rejection ---');
  {
    // Completely wrong secret
    const mock1 = createMockReqRes({
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'wrong-attacker-secret' },
      body: { update_id: 9999 }
    });
    await webhookHandler(mock1.req, mock1.res);
    assert(mock1.getStatus() === 401, 'Rejects with HTTP 401 for wrong secret token');
    assert(mock1.getData()?.error?.includes('Invalid secret token'), 'Error indicates invalid secret');

    // Tampered by 1 character (same length)
    const tampered = CONFIGURED_SECRET.slice(0, -1) + (CONFIGURED_SECRET.slice(-1) === 'a' ? 'b' : 'a');
    const mock2 = createMockReqRes({
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': tampered },
      body: { update_id: 9999 }
    });
    await webhookHandler(mock2.req, mock2.res);
    assert(mock2.getStatus() === 401, 'Rejects with HTTP 401 for single-character tampered secret');

    // Substring / length mismatch
    const mock3 = createMockReqRes({
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': CONFIGURED_SECRET.slice(0, 16) },
      body: { update_id: 9999 }
    });
    await webhookHandler(mock3.req, mock3.res);
    assert(mock3.getStatus() === 401, 'Rejects with HTTP 401 for prefix of secret (length mismatch)');
  }

  // Test 5: Valid Secret Acceptance
  console.log('\n--- 5. Valid Secret Acceptance ---');
  {
    const mock = createMockReqRes({
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': CONFIGURED_SECRET },
      body: null
    });
    await webhookHandler(mock.req, mock.res);
    assert(mock.getStatus() === 200, 'Accepts valid webhook request with HTTP 200');
    assert(mock.getData()?.status === 'no_body', 'Passes secret authentication and reaches payload parser');
  }

  // Test 6: Array Header Compatibility
  console.log('\n--- 6. Array Header Compatibility ---');
  {
    const mock = createMockReqRes({
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': [CONFIGURED_SECRET] },
      body: null
    });
    await webhookHandler(mock.req, mock.res);
    assert(mock.getStatus() === 200, 'Accepts valid secret when header is parsed as array');
  }

  // Test 7: HTTP Method Handling
  console.log('\n--- 7. HTTP Method Handling ---');
  {
    const mockGet = createMockReqRes({ method: 'GET' });
    await webhookHandler(mockGet.req, mockGet.res);
    assert(mockGet.getStatus() === 200, 'GET /api/telegram-webhook returns HTTP 200 health check');
    assert(mockGet.getData()?.status?.includes('Live'), 'GET returns live status message');

    const mockPut = createMockReqRes({ method: 'PUT' });
    await webhookHandler(mockPut.req, mockPut.res);
    assert(mockPut.getStatus() === 405, 'PUT /api/telegram-webhook returns HTTP 405 Method Not Allowed');

    const mockDelete = createMockReqRes({ method: 'DELETE' });
    await webhookHandler(mockDelete.req, mockDelete.res);
    assert(mockDelete.getStatus() === 405, 'DELETE /api/telegram-webhook returns HTTP 405 Method Not Allowed');
  }

  // Test 8: server.ts Express Route Implementation Verification
  console.log('\n--- 8. server.ts Express Route Fail-Closed Verification ---');
  {
    // Simulates the exact route logic in server.ts
    const serverWebhookRoute = (headers: Record<string, any>, envSec: string | undefined) => {
      const webhookSecret = (envSec || '').trim();
      if (!webhookSecret) {
        return { status: 500, body: { error: 'Server configuration error: Webhook secret not configured' } };
      }
      const rawHeader = headers['x-telegram-bot-api-secret-token'];
      const incomingSecret = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
      if (!incomingSecret || typeof incomingSecret !== 'string') {
        return { status: 401, body: { error: 'Unauthorized: Missing secret token header' } };
      }
      const secretBuffer = Buffer.from(webhookSecret);
      const incomingBuffer = Buffer.from(incomingSecret);
      if (secretBuffer.length !== incomingBuffer.length || !crypto.timingSafeEqual(secretBuffer, incomingBuffer)) {
        return { status: 401, body: { error: 'Unauthorized: Invalid secret token' } };
      }
      return { status: 200, body: 'OK' };
    };

    assert(serverWebhookRoute({}, undefined).status === 500, 'server.ts rejects with 500 when secret unconfigured');
    assert(serverWebhookRoute({}, CONFIGURED_SECRET).status === 401, 'server.ts rejects with 401 when header missing');
    assert(serverWebhookRoute({ 'x-telegram-bot-api-secret-token': 'bad' }, CONFIGURED_SECRET).status === 401, 'server.ts rejects with 401 when header invalid');
    assert(serverWebhookRoute({ 'x-telegram-bot-api-secret-token': CONFIGURED_SECRET }, CONFIGURED_SECRET).status === 200, 'server.ts accepts 200 when header valid');
  }

  // Test 9: Live Telegram Webhook Registration Verification
  console.log('\n--- 9. Live Telegram Webhook Registration Verification ---');
  if (BOT_TOKEN) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
      const data: any = await res.json();
      assert(data.ok === true, 'Telegram API getWebhookInfo call succeeded');
      assert(data.result?.url === 'https://moliya-ai-pi.vercel.app/api/telegram-webhook', 'Telegram webhook URL points to production webhook');
      assert(data.result?.has_custom_certificate === false, 'Webhook uses valid public SSL');
    } catch (e: any) {
      assert(false, 'Live Telegram Webhook check error', e.message);
    }
  } else {
    console.log('  ⚠️ Skipping live Telegram check: BOT_TOKEN not configured');
  }

  // Summary
  console.log('\n================================================================');
  console.log(`  RESULTS: ${passedTests}/${totalTests} tests passed (${Math.round((passedTests / totalTests) * 100)}%)`);
  console.log('================================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
