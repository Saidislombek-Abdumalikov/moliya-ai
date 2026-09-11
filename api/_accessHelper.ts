/**
 * _accessHelper.ts — Single source of truth for user access/entitlement logic.
 * 
 * Every part of the system (auth, AI quota, admin panel) MUST use this
 * function to determine what access level a user currently has.
 * 
 * Priority chain (highest → lowest):
 *   1. Account blocked  → BLOCKED
 *   2. AI blocked       → AI_BLOCKED
 *   3. Unlimited AI     → UNLIMITED
 *   4. VIP active       → VIP
 *   5. Trial active     → TRIAL
 *   6. Otherwise        → EXPIRED (free tier)
 */

export type AccessLevel = 'BLOCKED' | 'AI_BLOCKED' | 'UNLIMITED' | 'VIP' | 'TRIAL' | 'EXPIRED';

export interface EffectiveAccessResult {
  level: AccessLevel;
  label: string;
  canUseApp: boolean;
  canUseAi: boolean;
  aiLimit: number | null;   // null = unlimited
  isPremium: boolean;
}

const ACCESS_LABELS: Record<AccessLevel, string> = {
  BLOCKED: 'Account Blocked',
  AI_BLOCKED: 'AI Blocked',
  UNLIMITED: 'Unlimited AI',
  VIP: 'VIP',
  TRIAL: 'Free Trial',
  EXPIRED: 'Expired',
};

const FREE_TIER_DAILY_LIMIT = 20;

/**
 * Calculate the effective access level for a user.
 * 
 * @param user - A user record from Supabase `users` table. Can have any shape
 *               as long as it contains the relevant fields.
 * @returns The computed access state.
 */
export function effectiveAccess(user: any): EffectiveAccessResult {
  if (!user) {
    return {
      level: 'EXPIRED',
      label: ACCESS_LABELS.EXPIRED,
      canUseApp: false,
      canUseAi: false,
      aiLimit: FREE_TIER_DAILY_LIMIT,
      isPremium: false,
    };
  }

  // ── 1. Account blocked ──────────────────────────────────────
  const isBlocked = Boolean(
    user.is_blocked ||
    user.onboarding?.is_blocked ||
    user.device_info?.is_blocked
  );
  if (isBlocked) {
    return {
      level: 'BLOCKED',
      label: ACCESS_LABELS.BLOCKED,
      canUseApp: false,
      canUseAi: false,
      aiLimit: 0,
      isPremium: false,
    };
  }

  // ── 2. AI blocked (admin-set) ───────────────────────────────
  const isAiBlocked = Boolean(user.ai_blocked);
  if (isAiBlocked) {
    return {
      level: 'AI_BLOCKED',
      label: ACCESS_LABELS.AI_BLOCKED,
      canUseApp: true,
      canUseAi: false,
      aiLimit: 0,
      isPremium: false,
    };
  }

  // ── 3. Unlimited AI (admin-granted, independent of VIP) ─────
  const isUnlimitedAi = Boolean(user.unlimited_ai);
  if (isUnlimitedAi) {
    return {
      level: 'UNLIMITED',
      label: ACCESS_LABELS.UNLIMITED,
      canUseApp: true,
      canUseAi: true,
      aiLimit: null,
      isPremium: true,
    };
  }

  // ── 4. VIP (is_premium with valid expiration or no expiration) ──
  const isPremium = Boolean(user.is_premium);
  if (isPremium) {
    const expiresAt = user.premium_expires_at;
    // No expiration = lifetime VIP
    if (!expiresAt) {
      return {
        level: 'VIP',
        label: ACCESS_LABELS.VIP,
        canUseApp: true,
        canUseAi: true,
        aiLimit: null,
        isPremium: true,
      };
    }
    // Has expiration — check if still valid
    const expiresMs = new Date(expiresAt).getTime();
    if (expiresMs > Date.now()) {
      return {
        level: 'VIP',
        label: ACCESS_LABELS.VIP,
        canUseApp: true,
        canUseAi: true,
        aiLimit: null,
        isPremium: true,
      };
    }
    // VIP expired — fall through to trial/expired check
  }

  // ── 5. Trial (within 24h of account creation) ───────────────
  const trialEnd =
    user.premium_expires_at ||
    user.trial_ends_at ||
    user.onboarding?.trial_ends_at ||
    user.onboarding?.premium_expires_at;

  if (trialEnd) {
    const trialEndMs = new Date(trialEnd).getTime();
    if (trialEndMs > Date.now()) {
      return {
        level: 'TRIAL',
        label: ACCESS_LABELS.TRIAL,
        canUseApp: true,
        canUseAi: true,
        aiLimit: null,
        isPremium: true,  // Trial gets unlimited during trial period
      };
    }
  }

  // ── 6. Check for admin-set custom ai_limit ──────────────────
  // If admin explicitly set ai_limit to 0 or -1, treat as unlimited
  if (user.ai_limit === 0 || user.ai_limit === -1) {
    return {
      level: 'EXPIRED',
      label: ACCESS_LABELS.EXPIRED,
      canUseApp: true,
      canUseAi: true,
      aiLimit: null,  // Admin override: unlimited
      isPremium: false,
    };
  }

  // ── 7. Expired / Free tier ──────────────────────────────────
  const customLimit = user.ai_limit && user.ai_limit > 0 ? user.ai_limit : FREE_TIER_DAILY_LIMIT;
  return {
    level: 'EXPIRED',
    label: ACCESS_LABELS.EXPIRED,
    canUseApp: true,
    canUseAi: true,
    aiLimit: customLimit,
    isPremium: false,
  };
}

/**
 * Determine account status (separate from AI access).
 */
export function accountStatus(user: any): 'Active' | 'Restricted' | 'Blocked' | 'Deleted' {
  if (!user) return 'Deleted';
  if (Boolean(user.is_blocked || user.onboarding?.is_blocked || user.device_info?.is_blocked)) return 'Blocked';
  if (Boolean(user.is_restricted || user.onboarding?.is_restricted)) return 'Restricted';
  if (Boolean(user.is_deleted || user.onboarding?.is_deleted || user.account_status === 'deleted')) return 'Deleted';
  return 'Active';
}
