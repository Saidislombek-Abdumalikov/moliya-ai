import fs from 'fs';
import path from 'path';

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

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_KEY = process.env.ADMIN_SECRET_KEY || '';

import webhookHandler from '../api/telegram-webhook.js';
import authHandler from '../api/auth.js';
import adminHandler from '../api/admin.js';
import crypto from 'crypto';

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
    url: options.url || '/api/telegram-webhook',
    query: options.query || {},
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': process.env.TELEGRAM_WEBHOOK_SECRET || '',
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

function createValidInitData(user: any, token: string) {
  const userJson = JSON.stringify(user);
  const authDate = Math.floor(Date.now() / 1000).toString();
  const params: Record<string, string> = {
    auth_date: authDate,
    query_id: 'AAHdF6IQAAAAAN0XohD9w7d_',
    user: userJson
  };
  const keys = Object.keys(params).sort();
  const dataCheckString = keys.map(k => `${k}=${params[k]}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const searchParams = new URLSearchParams(params);
  searchParams.set('hash', hash);
  return searchParams.toString();
}

async function runTests() {
  console.log('====================================================');
  console.log('   MOLIYA AI — STAGE P0-F TELEGRAM FLOWS & ROTATION');
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

  // 1. Telegram Bot Connectivity & API Check
  console.log('--- 1. Telegram Bot Identity & Connectivity ---');
  assert('TELEGRAM_BOT_TOKEN exists in server environment', Boolean(BOT_TOKEN && BOT_TOKEN.length > 20));

  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
    const data = await res.json();
    assert('Telegram getMe responds ok: true', Boolean(data.ok));
    assert('Bot username matches @moliya_v2bot', data.result?.username === 'moliya_v2bot', `got ${data.result?.username}`);
  } catch (err: any) {
    assert('Telegram getMe reachable', false, err.message);
  }

  // 2. Webhook /start Command Processing
  console.log('\n--- 2. Webhook /start Command Processing ---');
  {
    const mockUpdate = {
      update_id: 100001,
      message: {
        message_id: 1,
        from: { id: 999901, first_name: 'Test', username: 'testuser' },
        chat: { id: 999901, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: '/start'
      }
    };

    const { req, res, getStatusCode, getResponseData } = createMockReqRes({
      body: mockUpdate
    });
    await webhookHandler(req, res);
    assert('Webhook handles /start update with HTTP 200', getStatusCode() === 200, `got ${getStatusCode()}`);
    assert('Webhook triggers oferta or acknowledges update', getResponseData()?.status === 'oferta_required' || getResponseData()?.status === 'ok' || Boolean(getResponseData()?.ok));
  }

  // 3. Webhook Financial Transaction Input Processing
  console.log('\n--- 3. Webhook Financial Transaction Input Processing ---');
  {
    // Update user to have accepted oferta and phone so transaction processing can proceed
    const { supabase } = await import('../api/_supabaseClient.js');
    await supabase.from('users').update({
      phone: '+998901234567',
      onboarding: {
        completed: true,
        oferta_accepted: true,
        phone: '+998901234567',
        registration_status: 'completed',
        language: 'uz'
      }
    }).eq('id', 'moliya_user_tg_999901');

    const mockExpenseUpdate = {
      update_id: 100002,
      message: {
        message_id: 2,
        from: { id: 999901, first_name: 'Test', username: 'testuser' },
        chat: { id: 999901, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: 'Tushlik 35000 som'
      }
    };

    const { req, res, getStatusCode, getResponseData } = createMockReqRes({
      body: mockExpenseUpdate
    });
    await webhookHandler(req, res);
    assert('Webhook processes financial expense text with HTTP 200', getStatusCode() === 200, `got ${getStatusCode()}`);
    assert('Webhook response returns ok / status: ok', getResponseData()?.status === 'ok' || Boolean(getResponseData()?.ok), `data: ${JSON.stringify(getResponseData())}`);
  }

  // 4. Mini App Cryptographic Authentication Flow
  console.log('\n--- 4. Mini App Cryptographic Authentication Flow ---');
  {
    const testTgUser = { id: 999901, first_name: 'Test User', username: 'testuser' };
    const validInitData = createValidInitData(testTgUser, BOT_TOKEN);

    const { req, res, getStatusCode, getResponseData } = createMockReqRes({
      url: '/api/auth?action=telegram',
      query: { action: 'telegram' },
      body: { initData: validInitData }
    });
    await authHandler(req, res);
    assert('Mini App initData verification succeeds with HTTP 200', getStatusCode() === 200, `got ${getStatusCode()}`);
    assert('Mini App session created with canonical user ID', getResponseData()?.userId === 'moliya_user_tg_999901', `got ${getResponseData()?.userId}`);
    assert('Response contains valid onboarding profile', Boolean(getResponseData()?.onboarding));
  }

  // 5. Admin API Telegram Messaging & Broadcast
  console.log('\n--- 5. Admin API Messaging Readiness ---');
  {
    const { req, res, getStatusCode } = createMockReqRes({
      url: '/api/admin?route=send-telegram-message',
      query: { route: 'send-telegram-message' },
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { message: '' } // missing message
    });
    await adminHandler(req, res);
    assert('Admin send-telegram-message validates input (HTTP 400 for empty message)', getStatusCode() === 400, `got ${getStatusCode()}`);
  }

  // 6. Webhook Info Status
  console.log('\n--- 6. Webhook Info Check ---');
  try {
    const whRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
    const whData = await whRes.json();
    assert('Webhook info returns ok: true', Boolean(whData.ok));
    assert('Webhook points to production Vercel URL', String(whData.result?.url).includes('moliya-ai-pi.vercel.app/api/telegram-webhook'));
  } catch (err: any) {
    assert('Webhook info check failed', false, err.message);
  }

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
