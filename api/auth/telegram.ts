import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../_firebaseClient';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8955141731:AAGzuBXoKmZii5t_bJcwbJA0Q92gYrFaGnw";

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
    const { initData } = req.body || {};
    if (!initData) {
      return res.status(400).json({ error: 'Missing initData' });
    }

    const verification = verifyTelegramInitData(initData, BOT_TOKEN);
    if (!verification.isValid || !verification.user?.id) {
      return res.status(401).json({ error: 'Invalid Telegram initData signature' });
    }

    const tgUser = verification.user;
    const userId = `moliya_user_tg_${tgUser.id}`;

    // Create 60-day Session Token
    const sessionToken = 'sess_' + crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 24 * 3600 * 1000).toISOString();

    const sessionData = {
      sessionToken,
      userId,
      createdAt: now.toISOString(),
      expiresAt,
    };

    // Save session in permitted moliya_user_ document path
    await setDoc(doc(db, 'users', `moliya_user_sess_${sessionToken}`), sessionData);

    const tgName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || 'Telegram Foydalanuvchi';
    const tgUsername = tgUser.username ? '@' + tgUser.username : '@moliya_user';

    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);
    const existingData = userSnap.exists() ? userSnap.data() : {};

    const updatedOnboarding = {
      ...(existingData?.onboarding || {}),
      completed: true,
      language: existingData?.onboarding?.language || 'uz',
      name: tgName,
      telegram: tgUsername,
      telegramId: String(tgUser.id),
      phone: existingData?.phone || existingData?.onboarding?.phone || '',
    };

    await setDoc(userRef, {
      userId,
      telegramId: String(tgUser.id),
      name: tgName,
      telegram: tgUsername,
      onboarding: updatedOnboarding,
      updatedAt: now.toISOString(),
    }, { merge: true });

    return res.status(200).json({
      success: true,
      userId,
      sessionToken,
      onboarding: updatedOnboarding,
      user: tgUser,
    });
  } catch (error: any) {
    console.error('Telegram authentication error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
