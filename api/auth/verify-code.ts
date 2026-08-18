import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../_supabaseClient.js';
import { createSupabaseAuthSession } from '../_authHelper.js';

// In-memory rate limiting: max 5 failed attempts per 5 minutes per IP
interface RateLimitEntry {
  count: number;
  resetAt: number;
}
const rateLimitMap = new Map<string, RateLimitEntry>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 5 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 5) {
    return false;
  }
  entry.count += 1;
  return true;
}

function resetRateLimit(ip: string) {
  rateLimitMap.delete(ip);
}

/**
 * POST /api/auth/verify-code
 * 
 * Verifies 6-digit OTP code requested by Android APK or manual login.
 * Distinguishes invalid, expired, already used, or rate-limited codes.
 * Single-use: deletes OTP immediately upon successful verification.
 * Associates correctly with moliya_user_tg_{telegram_id}.
 * Preserves existing accounts and distinguishes new vs returning users.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, errorType: 'METHOD_NOT_ALLOWED', error: 'Method Not Allowed' });
  }

  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown-ip';

  if (!checkRateLimit(clientIp)) {
    return res.status(429).json({
      success: false,
      errorType: 'RATE_LIMITED',
      error: "Juda ko'p xato urinishlar qilindi. 5 daqiqadan so'ng qayta urinib ko'ring."
    });
  }

  try {
    const { code } = req.body || {};
    if (!code || typeof code !== 'string') {
      return res.status(400).json({
        success: false,
        errorType: 'INVALID_CODE',
        error: "Kiritilgan kod noto'g'ri. Qayta urinib ko'ring."
      });
    }

    const cleanCode = code.trim().replace(/\D/g, '');
    if (cleanCode.length !== 6) {
      return res.status(400).json({
        success: false,
        errorType: 'INVALID_CODE',
        error: "Kod 6 ta raqamdan iborat bo'lishi kerak."
      });
    }

    // 1. Look up the OTP record in Supabase users table
    const otpId = `otp_${cleanCode}`;
    const { data: otpDoc, error: lookupError } = await supabase
      .from('users')
      .select('*')
      .eq('id', otpId)
      .maybeSingle();

    if (lookupError || !otpDoc) {
      return res.status(400).json({
        success: false,
        errorType: 'INVALID_CODE',
        error: "Kiritilgan kod noto'g'ri yoki eskirgan. Qayta urinib ko'ring."
      });
    }

    // 2. Check 10-minute expiry
    const expiresAtStr = otpDoc.onboarding?.expires_at || otpDoc.session_expires_at;
    if (expiresAtStr && new Date(expiresAtStr).getTime() < Date.now()) {
      await supabase.from('users').delete().eq('id', otpId);
      return res.status(400).json({
        success: false,
        errorType: 'EXPIRED_CODE',
        error: "Kod muddati tugagan. Yangi kod oling."
      });
    }

    const tgId = String(otpDoc.telegram_id || otpDoc.onboarding?.telegram_id || '');
    if (!tgId) {
      await supabase.from('users').delete().eq('id', otpId);
      return res.status(400).json({
        success: false,
        errorType: 'INVALID_CODE',
        error: "Kod ma'lumotlarida xatolik yuz berdi. Yangi kod oling."
      });
    }

    // 3. Immediately delete OTP record (single-use enforcement)
    await supabase.from('users').delete().eq('id', otpId);

    // Successful code -> clear rate limit
    resetRateLimit(clientIp);

    // 4. Identify or create user by moliya_user_tg_{telegram_id}
    const userId = `moliya_user_tg_${tgId}`;
    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 24 * 3600 * 1000).toISOString();
    const randomHex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
    const sessionToken = existingUser?.onboarding?.session_token || ('sess_' + randomHex);

    const tgName = otpDoc.name || existingUser?.name || 'Telegram Foydalanuvchi';
    const tgUsername = otpDoc.telegram || existingUser?.telegram || '@moliya_user';
    const userPhone = otpDoc.phone || existingUser?.phone || existingUser?.onboarding?.phone || '';

    let updatedOnboarding: any;
    let userCards: any[] = [];
    let userTransactions: any[] = [];
    let isPremium = false;
    let isNewUser = false;
    let onboardingCompleted = false;

    if (existingUser) {
      onboardingCompleted = Boolean(existingUser.onboarding?.completed || (existingUser.created_at && existingUser.onboarding));
      updatedOnboarding = {
        ...(existingUser.onboarding || {}),
        name: tgName,
        phone: userPhone || existingUser.phone || '',
        telegram: tgUsername,
        telegramId: tgId,
        language: existingUser.language || existingUser.onboarding?.language || 'uz',
        completed: onboardingCompleted,
        session_token: sessionToken,
        session_expires_at: expiresAt,
      };
      userCards = Array.isArray(existingUser.cards) ? existingUser.cards : [];
      userTransactions = Array.isArray(existingUser.transactions) ? existingUser.transactions : [];
      isPremium = Boolean(existingUser.is_premium);
      isNewUser = false;

      await supabase.from('users').update({
        name: tgName,
        telegram: tgUsername,
        telegram_id: tgId,
        phone: userPhone || existingUser.phone || null,
        onboarding: updatedOnboarding,
        updated_at: now.toISOString()
      }).eq('id', userId);
    } else {
      isNewUser = true;
      onboardingCompleted = false;
      updatedOnboarding = {
        completed: false,
        language: 'uz',
        name: tgName,
        phone: userPhone,
        telegram: tgUsername,
        telegramId: tgId,
        monthlyGoal: 1000000,
        monthlyIncome: 0,
        isPremium: false,
        budgets: {},
        session_token: sessionToken,
        session_expires_at: expiresAt,
      };

      await supabase.from('users').insert({
        id: userId,
        name: tgName,
        telegram: tgUsername,
        telegram_id: tgId,
        phone: userPhone || null,
        language: 'uz',
        is_premium: false,
        onboarding: updatedOnboarding,
        cards: [],
        transactions: [],
        created_at: now.toISOString(),
        updated_at: now.toISOString()
      });
    }

    // 5. Generate Supabase Auth session
    const authSession = await createSupabaseAuthSession(
      tgId,
      { name: tgName, telegram: tgUsername }
    );

    return res.status(200).json({
      success: true,
      userId,
      sessionToken,
      access_token: authSession?.access_token || null,
      refresh_token: authSession?.refresh_token || null,
      isNewUser,
      onboardingCompleted,
      onboarding: updatedOnboarding,
      cards: userCards,
      transactions: userTransactions,
      isPremium,
    });
  } catch (err: any) {
    console.error('[API /api/auth/verify-code] Internal error:', err);
    return res.status(500).json({
      success: false,
      errorType: 'SERVER_ERROR',
      error: "Serverda vaqtinchalik xatolik yuz berdi. Iltimos, qayta urinib ko'ring."
    });
  }
}
