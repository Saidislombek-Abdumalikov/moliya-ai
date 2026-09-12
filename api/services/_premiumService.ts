import { supabase } from '../_supabaseClient.js';

export interface PremiumStatus {
  isPremium: boolean;
  expiresAt: string | null;
  isLifetime: boolean;
  remainingDays: number | null;
  formattedExpiry: string;
}

/**
 * Format ISO date into human-readable Uzbek text.
 */
export function formatUzbekExpiryDate(isoDate?: string | null): string {
  if (!isoDate) return "Cheksiz / Doimiy (Lifetime)";
  try {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return String(isoDate);
    const months = [
      'yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
      'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'
    ];
    const day = d.getDate();
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${day}-${month}, ${year} ${hours}:${mins}`;
  } catch {
    return String(isoDate);
  }
}

/**
 * Check whether a user's subscription is active and calculate remaining days.
 */
export async function getPremiumStatus(userId: string): Promise<PremiumStatus> {
  if (!userId) throw new Error('userId is required for getPremiumStatus');

  const { data: user, error } = await supabase
    .from('users')
    .select('is_premium, premium_expires_at, onboarding')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error(`[PremiumService] Error fetching premium status for ${userId}:`, error.message);
    throw error;
  }

  const rawIsPrem = Boolean(user?.is_premium || user?.onboarding?.is_vip);
  const rawExpiresAt = user?.premium_expires_at || user?.onboarding?.premium_expires_at || null;

  if (!rawIsPrem) {
    return {
      isPremium: false,
      expiresAt: null,
      isLifetime: false,
      remainingDays: null,
      formattedExpiry: "Bepul (Standart)"
    };
  }

  if (!rawExpiresAt) {
    // Lifetime / Unlimited
    return {
      isPremium: true,
      expiresAt: null,
      isLifetime: true,
      remainingDays: null,
      formattedExpiry: "Cheksiz / Doimiy (Lifetime)"
    };
  }

  const expiryTime = new Date(rawExpiresAt).getTime();
  const now = Date.now();
  const isExpired = expiryTime <= now;

  if (isExpired) {
    return {
      isPremium: false,
      expiresAt: rawExpiresAt,
      isLifetime: false,
      remainingDays: 0,
      formattedExpiry: "Muddati tugagan"
    };
  }

  const remainingDays = Math.ceil((expiryTime - now) / (1000 * 60 * 60 * 24));
  return {
    isPremium: true,
    expiresAt: rawExpiresAt,
    isLifetime: false,
    remainingDays,
    formattedExpiry: formatUzbekExpiryDate(rawExpiresAt)
  };
}

/**
 * Grant Full Premium to a user with a specific expiration date (or null for Lifetime).
 * 
 * STRICT BOUNDARY:
 * - Modifies ONLY subscription access: is_premium and premium_expires_at.
 * - Does NOT touch financial records (transactions/cards).
 * - Does NOT touch bot messages.
 * - Does NOT block or unblock.
 * - Does NOT affect other users.
 */
export async function grantFullPremium(
  userId: string,
  expiresAt: string | null = null
): Promise<{ success: boolean; userId: string; isPremium: boolean; expiresAt: string | null }> {
  if (!userId) throw new Error('userId is required for grantFullPremium');

  const nowIso = new Date().toISOString();

  // Fetch existing onboarding to preserve other fields
  const { data: user } = await supabase.from('users').select('onboarding').eq('id', userId).maybeSingle();
  const existingOb = user?.onboarding || {};
  const updatedOb = {
    ...existingOb,
    is_vip: true,
    premium_expires_at: expiresAt,
    unlimited_ai: true
  };

  const { error } = await supabase
    .from('users')
    .update({
      is_premium: true,
      premium_expires_at: expiresAt,
      ai_limit: null,
      onboarding: updatedOb,
      updated_at: nowIso
    })
    .eq('id', userId);

  if (error) {
    console.error(`[PremiumService] Error granting premium for ${userId}:`, error.message);
    throw error;
  }

  return {
    success: true,
    userId,
    isPremium: true,
    expiresAt
  };
}

/**
 * Revoke premium from a user.
 */
export async function revokePremium(
  userId: string
): Promise<{ success: boolean; userId: string; isPremium: boolean }> {
  if (!userId) throw new Error('userId is required for revokePremium');

  const nowIso = new Date().toISOString();

  const { data: user } = await supabase.from('users').select('onboarding').eq('id', userId).maybeSingle();
  const existingOb = user?.onboarding || {};
  const updatedOb = {
    ...existingOb,
    is_vip: false,
    premium_expires_at: null,
    unlimited_ai: false
  };

  const { error } = await supabase
    .from('users')
    .update({
      is_premium: false,
      premium_expires_at: null,
      ai_limit: 20,
      onboarding: updatedOb,
      updated_at: nowIso
    })
    .eq('id', userId);

  if (error) {
    console.error(`[PremiumService] Error revoking premium for ${userId}:`, error.message);
    throw error;
  }

  return {
    success: true,
    userId,
    isPremium: false
  };
}
