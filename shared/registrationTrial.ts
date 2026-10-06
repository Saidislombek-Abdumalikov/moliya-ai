// The free trial is tied to the original account creation time, never login time.
export function registrationTrialEnd(
  user: any,
  nowMs = Date.now(),
): string | null {
  const value =
    user?.created_at ||
    user?.account_created_at ||
    user?.onboarding?.account_created_at
  const start = typeof value === "string" ? Date.parse(value) : NaN
  return Number.isFinite(start) && start <= nowMs
    ? new Date(start + 7 * 86400000).toISOString()
    : null
}

// Preserve explicit service/admin trial grants in addition to the universal window.
// Nested legacy privilege fields never grant an extension.
export function effectiveTrialEnd(user: any, nowMs = Date.now()): string | null {
  const registration = registrationTrialEnd(user, nowMs);
  const explicit = !user?.is_premium && !user?.is_vip && user?.is_trial !== false && user?.onboarding?.is_trial !== false
    ? Date.parse(user?.trial_ends_at || user?.trialEndsAt || '') : NaN;
  const end = Math.max(Date.parse(registration || '') || 0, Number.isFinite(explicit) ? explicit : 0);
  return end > 0 ? new Date(end).toISOString() : null;
}
