import fs from 'fs';
import path from 'path';

// Load .env
const originalEnvToken = process.env.TELEGRAM_BOT_TOKEN;
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

const REAL_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_KEY = process.env.ADMIN_SECRET_KEY || '9f8a3c4e1b2d5a7f6c8e0b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0a2f';

import adminHandler from '../api/admin.js';
import authHandler from '../api/auth.js';

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
    url: options.url || '/api/admin',
    query: options.query || {},
    headers: {
      'content-type': 'application/json',
      'x-admin-key': ADMIN_KEY,
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

async function runTests() {
  console.log('====================================================');
  console.log('   MOLIYA AI — STAGE P0-E SECURITY TEST SUITE');
  console.log('   Removal of Hardcoded Telegram Bot Token Verification');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(name: string, condition: boolean, details?: string) {
    if (condition) {
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${name} ${details ? `(${details})` : ''}`);
      failed++;
    }
  }

  // --- SECTION 1: Static Code Audit ---
  console.log('--- 1. Static Code Analysis (No Hardcoded Token String) ---');
  const filesToScan = [
    'api/admin.ts',
    'api/auth.ts',
    'api/telegram-webhook.ts',
    'api/_financialReportEngine.ts',
    'api/services/_userAccountService.ts',
    'server.ts',
    'load_test_suite.mjs'
  ];

  const LEAKED_TOKEN_SUBSTRING = '8955141731';
  for (const relPath of filesToScan) {
    const fullPath = path.resolve(process.cwd(), relPath);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const found = content.includes(LEAKED_TOKEN_SUBSTRING);
      assert(`Zero hardcoded bot token in ${relPath}`, !found, `token found in ${relPath}`);
    }
  }

  // --- SECTION 2: Dynamic Fail-Closed Behavior When Env Var Is Unset ---
  console.log('\n--- 2. Fail-Closed When TELEGRAM_BOT_TOKEN Is Unset ---');
  // Temporarily unset TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_BOT_TOKEN;

  {
    const { req, res, getStatusCode, getResponseData } = createMockReqRes({
      url: '/api/admin?route=broadcast',
      query: { route: 'broadcast' },
      body: { message: 'Test message', target: 'all' }
    });
    await adminHandler(req, res);
    assert('Broadcast fails closed (500) when TELEGRAM_BOT_TOKEN is unset', getStatusCode() === 500, `got ${getStatusCode()}`);
    assert('Error message specifically indicates TELEGRAM_BOT_TOKEN is not configured', String(getResponseData()?.error).includes('TELEGRAM_BOT_TOKEN'));
  }

  {
    const { req, res, getStatusCode, getResponseData } = createMockReqRes({
      url: '/api/admin?route=clear-telegram-history',
      query: { route: 'clear-telegram-history' },
      body: { userId: 'some_user', sweepRecent: true }
    });
    await adminHandler(req, res);
    assert('Clear history fails closed (500) when TELEGRAM_BOT_TOKEN is unset', getStatusCode() === 500, `got ${getStatusCode()}`);
    assert('Error indicates TELEGRAM_BOT_TOKEN not configured', String(getResponseData()?.error).includes('TELEGRAM_BOT_TOKEN'));
  }

  {
    const { req, res, getStatusCode } = createMockReqRes({
      method: 'GET',
      url: '/api/admin?route=telegram-file&fileId=xyz123',
      query: { route: 'telegram-file', fileId: 'xyz123' }
    });
    await adminHandler(req, res);
    assert('Telegram file proxy fails closed (500) when TELEGRAM_BOT_TOKEN is unset', getStatusCode() === 500, `got ${getStatusCode()}`);
  }

  {
    const { req, res, getStatusCode } = createMockReqRes({
      method: 'POST',
      url: '/api/admin?route=send-telegram-message',
      query: { route: 'send-telegram-message' },
      body: { telegramId: '12345678', message: 'Hello' }
    });
    await adminHandler(req, res);
    assert('Send telegram message fails closed (500) when TELEGRAM_BOT_TOKEN is unset', getStatusCode() === 500, `got ${getStatusCode()}`);
  }

  {
    const { req, res, getStatusCode } = createMockReqRes({
      url: '/api/admin?route=edit-telegram-message',
      query: { route: 'edit-telegram-message' },
      body: { chatId: '12345', messageId: 99, message: 'New text' }
    });
    await adminHandler(req, res);
    assert('Edit telegram message fails closed (500) when TELEGRAM_BOT_TOKEN is unset', getStatusCode() === 500, `got ${getStatusCode()}`);
  }

  {
    const { req, res, getStatusCode } = createMockReqRes({
      url: '/api/admin?route=delete-telegram-message',
      query: { route: 'delete-telegram-message' },
      body: { chatId: '12345', messageId: 99 }
    });
    await adminHandler(req, res);
    assert('Delete telegram message fails closed (500) when TELEGRAM_BOT_TOKEN is unset', getStatusCode() === 500, `got ${getStatusCode()}`);
  }

  {
    // Mini App auth verification without token
    const { req, res, getStatusCode, getResponseData } = createMockReqRes({
      url: '/api/auth?action=telegram',
      query: { action: 'telegram' },
      headers: {},
      body: { initData: 'query_id=123&user={}&hash=abc' }
    });
    await authHandler(req, res);
    assert('Telegram auth fails (401) when TELEGRAM_BOT_TOKEN is unset', getStatusCode() === 401, `got ${getStatusCode()}`);
  }

  // --- SECTION 3: Normal Operation When TELEGRAM_BOT_TOKEN Is Provided From Env ---
  console.log('\n--- 3. Normal Operation When TELEGRAM_BOT_TOKEN Is In Environment ---');
  process.env.TELEGRAM_BOT_TOKEN = REAL_BOT_TOKEN;

  assert('TELEGRAM_BOT_TOKEN successfully loaded from .env', Boolean(REAL_BOT_TOKEN && REAL_BOT_TOKEN.length > 20));

  console.log('\n====================================================');
  console.log(`   SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(e => {
  console.error('Fatal test error:', e);
  process.exit(1);
});
