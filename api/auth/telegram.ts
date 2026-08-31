import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { supabase } from '../_supabaseClient.js';
import { createSupabaseAuthSession } from '../_authHelper.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

function verifyTelegramInitData(initData: string, botToken: string): { isValid: boolean; user?: any } {
  if (!botToken || !initData) {
    return { isValid: false };
  }
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return { isValid: false };

    params.delete("hash");

    const keys = Array.from(params.keys()).sort();
    const dataCheckString = keys
      .map((key) => `${key}=${params.get(key)}`)
      .join("\n");

    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(botToken)
      .digest();

    const computedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    const isValid = computedHash === hash;
    let user = null;
    if (isValid) {
      const userJson = params.get("user");
      if (userJson) {
        user = JSON.parse(userJson);
      }
    }
    return { isValid, user };
  } catch (e) {
    console.error("Error verifying Telegram initData:", e);
    return { isValid: false };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { initData, initDataUnsafe } = req.body || {};

    let tgUser: any = null;

    if (initData && BOT_TOKEN) {
      const verification = verifyTelegramInitData(initData, BOT_TOKEN);
      if (verification.isValid && verification.user) {
        tgUser = verification.user;
      }
    }

    // initDataUnsafe bypass removed for security — require valid HMAC signature

    if (!tgUser || !tgUser.id) {
      return res.status(400).json({ error: "Invalid Telegram authentication data" });
    }

    const tgId = String(tgUser.id);
    const userId = `moliya_user_tg_${tgId}`;

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 24 * 3600 * 1000).toISOString();
    const randomHex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
    const sessionToken = 'sess_' + randomHex;

    const tgName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || 'Telegram Foydalanuvchi';
    const tgUsername = tgUser.username ? '@' + tgUser.username : '@moliya_user';

    // 1. Fetch existing user from Supabase
    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    const updatedOnboarding = {
      ...(existingUser?.onboarding || {}),
      completed: true,
      language: existingUser?.language || tgUser.language_code || 'uz',
      name: tgName,
      phone: existingUser?.phone || '',
      telegram: tgUsername,
      telegramId: tgId,
    };

    // 2. Upsert user in Supabase
    await supabase.from('users').upsert({
      id: userId,
      name: tgName,
      telegram: tgUsername,
      telegram_id: tgId,
      phone: existingUser?.phone || null,
      language: updatedOnboarding.language,
      is_premium: existingUser?.is_premium || false,
      session_token: sessionToken,
      session_expires_at: expiresAt,
      onboarding: updatedOnboarding,
      updated_at: now.toISOString()
    }, { onConflict: 'id' });

    // 3. Create real Supabase Auth session
    const authSession = await createSupabaseAuthSession(tgId, { name: tgName, telegram: tgUsername });

    return res.status(200).json({
      userId,
      sessionToken,
      // Real Supabase Auth tokens
      access_token: authSession?.access_token || null,
      refresh_token: authSession?.refresh_token || null,
      onboarding: updatedOnboarding,
      cards: existingUser?.cards || [],
      transactions: existingUser?.transactions || [],
      isPremium: existingUser?.is_premium || false
    });
  } catch (error: any) {
    console.error('Error in /api/auth/telegram:', error);
    return res.status(500).json({ error: error.message });
  }
}
