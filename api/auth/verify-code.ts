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
 * Verifies 6-digit OTP code requested by Android APK or manual code flow.
 * Checks expiry, deletes OTP immediately (single-use), links or creates moliya_user_tg_{id},
 * and returns Supabase Auth tokens + full profile.
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
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown-ip';

  if (!checkRateLimit(clientIp)) {
    return res.status(429).json({
      success: false,
      error: "Juda ko'p xato urinishlar qilindi. Iltimos, 5 daqiqadan so'ng qayta urinib ko'ring."
    });
  }

  try {
    const { code } = req.body || {};
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ success: false, error: "Tasdiqlash kodi kiritilmadi" });
    }

    const cleanCode = code.trim().replace(/\D/g, '');
    if (cleanCode.length !== 6) {
      return res.status(400).json({ success: false, error: "Kod 6 ta raqamdan iborat bo'lishi kerak" });
    }

    // 1. Look up the OTP record in Supabase users table
    const otpId = `otp_${cleanCode}`;
    const { data: otpDoc, error: lookupError } = await supabase
      .from('users')
      .select('*')
      .eq('id', otpId)
      .maybeSingle();

    if (lookupError || !otpDoc) {
      return res.status(400).json({ success: false, error: "Tasdiqlash kodi noto'g'ri yoki eskirgan" });
    }

    // 2. Check 10-minute expiry
    if (otpDoc.session_expires_at && new Date(otpDoc.session_expires_at).getTime() < Date.now()) {
      await supabase.from('users').delete().eq('id', otpId);
      return res.status(400).json({ success: false, error: "Tasdiqlash kodining amal qilish muddati tugagan" });
    }

    const tgId = String(otpDoc.telegram_id || otpDoc.login_request_id || '');
    if (!tgId) {
      await supabase.from('users').delete().eq('id', otpId);
      return res.status(400).json({ success: false, error: "Kod ma'lumotlarida xatolik yuz berdi" });
    }

    // 3. Immediately delete OTP record (single-use)
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
    const sessionToken = existingUser?.session_token || ('sess_' + randomHex);

    const tgName = otpDoc.name || existingUser?.name || 'Telegram Foydalanuvchi';
    const tgUsername = otpDoc.telegram || existingUser?.telegram || '@moliya_user';
    const userPhone = otpDoc.phone || existingUser?.phone || existingUser?.onboarding?.phone || '';

    let updatedOnboarding: any;
    let userCards: any[] = [];
    let userTransactions: any[] = [];
    let isPremium = false;

    if (existingUser) {
      updatedOnboarding = {
        ...(existingUser.onboarding || {}),
        completed: true,
        language: existingUser.language || existingUser.onboarding?.language || userPhone ? 'uz' : 'uz',
        name: tgName,
        phone: userPhone || existingUser.phone || '',
        telegram: tgUsername,
        telegramId: tgId,
      };
      userCards = Array.isArray(existingUser.cards) ? existingUser.cards : [];
      userTransactions = Array.isArray(existingUser.transactions) ? existingUser.transactions : [];
      isPremium = Boolean(existingUser.is_premium);

      await supabase.from('users').update({
        name: tgName,
        telegram: tgUsername,
        telegram_id: tgId,
        phone: userPhone || existingUser.phone || null,
        session_token: sessionToken,
        session_expires_at: expiresAt,
        onboarding: updatedOnboarding,
        updated_at: now.toISOString()
      }).eq('id', userId);
    } else {
      updatedOnboarding = {
        completed: true,
        language: 'uz',
        name: tgName,
        phone: userPhone,
        telegram: tgUsername,
        telegramId: tgId,
        monthlyGoal: 1000000,
        monthlyIncome: 0,
        isPremium: false,
        budgets: {}
      };

      await supabase.from('users').insert({
        id: userId,
        name: tgName,
        telegram: tgUsername,
        telegram_id: tgId,
        phone: userPhone || null,
        language: 'uz',
        is_premium: false,
        session_token: sessionToken,
        session_expires_at: expiresAt,
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
      onboarding: updatedOnboarding,
      cards: userCards,
      transactions: userTransactions,
      isPremium
    });
  } catch (error: any) {
    console.error('[VERIFY-CODE] Error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Serverda xatolik yuz berdi' });
  }
}
