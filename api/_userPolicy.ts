// Security evidence is written only by verified Telegram webhook handlers.
// Legacy onboarding JSON was client-writable and is never identity evidence.
export function accountDenied(user: any): boolean {
  return !user || !/^\d+$/.test(String(user.telegram_id || '')) ||
    user.id !== 'moliya_user_tg_' + String(user.telegram_id) || Boolean(
      user.is_blocked || user.is_restricted || user.is_deleted ||
      user.onboarding?.is_blocked || user.onboarding?.is_restricted || user.onboarding?.is_deleted ||
      user.device_info?.is_blocked || user.device_info?.restricted || user.account_status === 'deleted');
}

export function verifiedPhone(user: any): boolean {
  const proof = user?.bot_verification;
  return Boolean(proof && String(proof.telegram_id) === String(user.telegram_id) &&
    proof.phone === user.phone && /^\+[1-9]\d{7,14}$/.test(proof.phone || '') &&
    proof.phone_source === 'telegram_own_contact' && Number.isFinite(Date.parse(proof.phone_verified_at)));
}

export function acceptedConsent(user: any): boolean {
  const proof = user?.bot_verification;
  return Boolean(proof && String(proof.telegram_id) === String(user.telegram_id) &&
    proof.consent_source === 'telegram_button' && proof.consent_version &&
    Number.isFinite(Date.parse(proof.consent_accepted_at)));
}

export function eligibleUser(user: any): boolean {
  return !accountDenied(user) && verifiedPhone(user) && acceptedConsent(user);
}

export function publicOnboarding(user: any) {
  const ob = user?.onboarding || {};
  return {
    name: user?.name || ob.name || '', language: user?.language || ob.language || 'uz',
    telegramId: String(user?.telegram_id || ''), telegram: user?.telegram || '',
    phone: verifiedPhone(user) ? user.phone : '',
    oferta_accepted: acceptedConsent(user), completed: eligibleUser(user),
    registration_status: eligibleUser(user) ? 'completed' : 'unverified',
    tour_completed: ob.tour_completed === true,
    account_created_at: user.created_at || user.bot_verification?.phone_verified_at || '',
    monthlyGoal: ob.monthlyGoal, monthlyIncome: ob.monthlyIncome,
    notifications: ob.notifications, has_sample_data: ob.has_sample_data === true,
  };
}

export function safePreferences(input: any): Record<string, any> {
  const out: Record<string, any> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  if (typeof input.name === 'string') out.name = input.name.trim().slice(0, 100);
  if (['uz', 'uz_cyrl', 'ru', 'en'].includes(input.language)) out.language = input.language;
  for (const key of ['monthlyGoal', 'monthlyIncome', 'baseBalance']) {
    if (typeof input[key] === 'number' && Number.isFinite(input[key]) && input[key] >= 0 && input[key] <= 1e15) out[key] = input[key];
  }
  for (const key of ['tour_completed', 'has_sample_data']) if (typeof input[key] === 'boolean') out[key] = input[key];
  if (input.notifications && typeof input.notifications === 'object') {
    out.notifications = Object.fromEntries(['opt1', 'opt2', 'opt3'].map(k => [k, input.notifications[k] === true]));
    if (['daily', 'weekly', 'off'].includes(input.notifications.reminderFrequency))
      out.notifications.reminderFrequency = input.notifications.reminderFrequency;
    if (['morning', 'afternoon', 'evening'].includes(input.notifications.reminderSlot))
      out.notifications.reminderSlot = input.notifications.reminderSlot;
  }
  return out;
}
