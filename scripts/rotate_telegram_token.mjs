import fs from 'fs';
import path from 'path';

function maskToken(token) {
  if (!token || token.length < 10) return '••••••••••••';
  const parts = token.split(':');
  if (parts.length === 2) {
    return `${parts[0]}:••••••••••••${parts[1].slice(-4)}`;
  }
  return '••••••••••••' + token.slice(-4);
}

async function validateTelegramBotToken(token) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await res.json();
    if (data.ok && data.result?.id) {
      return { ok: true, bot: data.result };
    }
    return { ok: false, error: data.description || 'Invalid token response' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function getWebhookInfo(token) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function setWebhook(token, url, secretToken = null) {
  try {
    const body = {
      url,
      max_connections: 40,
      allowed_updates: ['message', 'callback_query']
    };
    if (secretToken) {
      body.secret_token = secretToken;
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function rotateTelegramBotToken(newToken, options = {}) {
  const cleanToken = String(newToken || '').trim();
  if (!cleanToken) {
    console.error('❌ Error: No new Telegram bot token provided.');
    console.log('Usage: node scripts/rotate_telegram_token.mjs <NEW_TOKEN> [--set-webhook]');
    process.exit(1);
  }

  console.log('====================================================');
  console.log('   MOLIYA AI — TELEGRAM BOT TOKEN ROTATION UTILITY');
  console.log('====================================================\n');

  console.log(`🔍 Validating new token: ${maskToken(cleanToken)}...`);
  const valResult = await validateTelegramBotToken(cleanToken);

  if (!valResult.ok) {
    console.error(`❌ Validation failed: ${valResult.error}`);
    console.error('The token was rejected by the Telegram API. Aborting rotation.');
    process.exit(1);
  }

  const bot = valResult.bot;
  console.log(`✅ Token verified successfully!`);
  console.log(`   Bot Name: ${bot.first_name}`);
  console.log(`   Bot Username: @${bot.username}`);
  console.log(`   Bot ID: ${bot.id}`);

  // Update .env file
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    let envContent = fs.readFileSync(envPath, 'utf8');
    const tokenRegex = /^TELEGRAM_BOT_TOKEN=.*$/m;
    if (tokenRegex.test(envContent)) {
      envContent = envContent.replace(tokenRegex, `TELEGRAM_BOT_TOKEN=${cleanToken}`);
    } else {
      envContent += `\nTELEGRAM_BOT_TOKEN=${cleanToken}\n`;
    }
    fs.writeFileSync(envPath, envContent, 'utf8');
    console.log(`\n✅ Updated TELEGRAM_BOT_TOKEN in .env with new token: ${maskToken(cleanToken)}`);
  } else {
    console.warn(`⚠️ Warning: .env file not found at ${envPath}`);
  }

  // Check or re-register webhook
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || null;
  const webhookUrl = options.webhookUrl || (process.env.APP_URL ? `${process.env.APP_URL}/api/telegram-webhook` : 'https://moliya-ai-pi.vercel.app/api/telegram-webhook');
  console.log(`\n📡 Checking webhook registration...`);
  const whInfo = await getWebhookInfo(cleanToken);

  if (whInfo.ok && whInfo.result?.url) {
    console.log(`   Active Webhook URL: ${whInfo.result.url}`);
    console.log(`   Pending Updates: ${whInfo.result.pending_update_count}`);
  }

  if (options.setWebhook || !whInfo.result?.url) {
    console.log(`   Registering webhook: ${webhookUrl}...`);
    const setWhResult = await setWebhook(cleanToken, webhookUrl, webhookSecret);
    if (setWhResult.ok) {
      console.log(`✅ Webhook set successfully to: ${webhookUrl}${webhookSecret ? ' (with secret_token)' : ''}`);
    } else {
      console.warn(`⚠️ Webhook set warning: ${setWhResult.description || setWhResult.error}`);
    }
  }

  console.log('\n====================================================');
  console.log('   TELEGRAM BOT TOKEN ROTATION COMPLETED SAFELY');
  console.log('====================================================\n');
  return { success: true, bot };
}

// CLI execution
const args = process.argv.slice(2);
const newTokenArg = args.find(a => !a.startsWith('--'));
const setWebhookArg = args.includes('--set-webhook');

if (newTokenArg) {
  rotateTelegramBotToken(newTokenArg, { setWebhook: setWebhookArg }).catch(err => {
    console.error('Fatal rotation error:', err);
    process.exit(1);
  });
}

export { rotateTelegramBotToken, validateTelegramBotToken, maskToken };
