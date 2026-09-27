#!/usr/bin/env node
/**
 * MOLIYA AI — SECURE TELEGRAM WEBHOOK SETUP UTILITY
 * 
 * Safely configures the Telegram Bot Webhook without exposing or storing secrets.
 * Reads TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET from environment variables
 * or prompts securely at runtime.
 * 
 * Flow:
 * 1. Validates bot token via getMe
 * 2. Checks current webhook status via getWebhookInfo
 * 3. Deletes existing webhook via deleteWebhook
 * 4. Sets new webhook with secret_token (NO restrictive allowed_updates)
 * 5. Verifies active webhook configuration via getWebhookInfo
 */

import readline from 'readline';

function maskToken(token) {
  if (!token || token.length < 10) return '••••••••••••';
  const parts = token.split(':');
  if (parts.length === 2) {
    return `${parts[0]}:••••••••••••${parts[1].slice(-4)}`;
  }
  return '••••••••••••' + token.slice(-4);
}

function maskSecret(secret) {
  if (!secret || secret.length < 8) return '••••••••••••';
  return `${secret.slice(0, 4)}••••••••${secret.slice(-4)}`;
}

async function promptInput(promptText) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => {
    rl.question(promptText, answer => {
      rl.close();
      resolve((answer || '').trim());
    });
  });
}

async function callTelegramApi(token, method, body = null) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const options = {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  };
  try {
    const res = await fetch(url, options);
    return await res.json();
  } catch (err) {
    const safeMsg = String(err?.message || 'Network error').replace(/bot[0-9]+:[A-Za-z0-9_-]+/gi, 'bot[PROTECTED_TOKEN]');
    return { ok: false, description: safeMsg };
  }
}

async function runSetup() {
  console.log('====================================================');
  console.log('    MOLIYA AI — TELEGRAM WEBHOOK CONFIGURATION     ');
  console.log('====================================================\n');

  // 1. Resolve Token
  let token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) {
    token = await promptInput('Enter TELEGRAM_BOT_TOKEN (input will not be saved to disk): ');
  }

  if (!token) {
    console.error('❌ Error: TELEGRAM_BOT_TOKEN is required.');
    process.exit(1);
  }

  console.log(`\n[1/5] 🔍 Verifying bot token: ${maskToken(token)}...`);
  const meResult = await callTelegramApi(token, 'getMe');
  if (!meResult.ok || !meResult.result?.id) {
    console.error(`❌ Token verification failed: ${meResult.description || 'Invalid token'}`);
    process.exit(1);
  }
  console.log(`  ✅ Bot verified: ${meResult.result.first_name} (@${meResult.result.username}) [ID: ${meResult.result.id}]`);

  // 2. Inspect current webhook
  console.log('\n[2/5] 📡 Checking existing webhook status...');
  const currentInfo = await callTelegramApi(token, 'getWebhookInfo');
  if (currentInfo.ok) {
    console.log(`  ℹ️ Current Webhook URL: ${currentInfo.result.url || '(none)'}`);
    console.log(`  ℹ️ Pending updates: ${currentInfo.result.pending_update_count || 0}`);
    if (currentInfo.result.last_error_message) {
      console.log(`  ⚠️ Last error: ${currentInfo.result.last_error_message}`);
    }
  }

  // 3. Resolve Secret Token & Webhook URL
  let webhookSecret = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  if (!webhookSecret) {
    webhookSecret = await promptInput('Enter TELEGRAM_WEBHOOK_SECRET: ');
  }

  if (!webhookSecret || webhookSecret.length < 16) {
    console.error('❌ Error: TELEGRAM_WEBHOOK_SECRET must be at least 16 characters [A-Za-z0-9_-].');
    process.exit(1);
  }

  const defaultUrl = process.env.APP_URL 
    ? `${process.env.APP_URL.replace(/\/+$/, '')}/api/telegram-webhook`
    : 'https://moliya-ai-pi.vercel.app/api/telegram-webhook';

  let targetUrl = process.env.WEBHOOK_URL || '';
  if (!targetUrl) {
    const inputUrl = await promptInput(`Enter Webhook URL [default: ${defaultUrl}]: `);
    targetUrl = inputUrl || defaultUrl;
  }

  // 4. Delete old webhook cleanly
  console.log('\n[3/5] 🗑️ Deleting old webhook registration...');
  const delResult = await callTelegramApi(token, 'deleteWebhook', { drop_pending_updates: false });
  if (delResult.ok) {
    console.log('  ✅ Previous webhook deleted cleanly.');
  } else {
    console.warn(`  ⚠️ Delete webhook response: ${delResult.description}`);
  }

  // 5. Register new webhook with secret_token
  // IMPORTANT (Phase 10): Do NOT set a restrictive allowed_updates list.
  // Omitting allowed_updates ensures all update types (message, edited_message, callback_query, etc.) are received.
  console.log(`\n[4/5] 🚀 Registering new webhook:`);
  console.log(`  📍 Endpoint: ${targetUrl}`);
  console.log(`  🔐 Secret Token: ${maskSecret(webhookSecret)}`);

  const setResult = await callTelegramApi(token, 'setWebhook', {
    url: targetUrl,
    max_connections: 40,
    secret_token: webhookSecret
  });

  if (!setResult.ok) {
    console.error(`❌ Failed to set webhook: ${setResult.description}`);
    process.exit(1);
  }
  console.log('  ✅ Webhook successfully registered with Telegram!');

  // 6. Verify webhook configuration
  console.log('\n[5/5] 🔎 Verifying active webhook registration...');
  const verifyResult = await callTelegramApi(token, 'getWebhookInfo');
  if (verifyResult.ok && verifyResult.result?.url === targetUrl) {
    console.log('  ✅ Webhook verified successfully!');
    console.log(`  📍 Active URL: ${verifyResult.result.url}`);
    console.log(`  🔒 Custom Certificate: ${verifyResult.result.has_custom_certificate ? 'Yes' : 'No (Using public SSL)'}`);
    console.log(`  ⏳ Pending Updates: ${verifyResult.result.pending_update_count}`);
  } else {
    console.warn('  ⚠️ Verification check unexpected response:', verifyResult);
  }

  console.log('\n====================================================');
  console.log('   🎉 TELEGRAM WEBHOOK SETUP COMPLETED SAFELY!      ');
  console.log('====================================================\n');
}

runSetup().catch(err => {
  console.error('Fatal error running webhook setup:', err.message);
  process.exit(1);
});
