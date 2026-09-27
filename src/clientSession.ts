export const SESSION_KEY = 'moliya_session_token';
const LEGACY_SESSION_KEY = 'user_session_token_v1';
export function readSessionToken(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = localStorage) {
  const current = storage.getItem(SESSION_KEY);
  const legacy = storage.getItem(LEGACY_SESSION_KEY);
  const token = current || legacy;
  if (!current && legacy) storage.setItem(SESSION_KEY, legacy);
  if (legacy) storage.removeItem(LEGACY_SESSION_KEY);
  return token;
}
export function saveSessionToken(token: string) {
  localStorage.setItem(SESSION_KEY, token);
  localStorage.removeItem(LEGACY_SESSION_KEY);
}
export function clearSessionToken() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(LEGACY_SESSION_KEY);
}

// Tour dismissal is a presentation preference, never an authorization signal.
export function tourKey(userId: string) { return `user_tour_completed_v3_${userId}`; }
export function tourDone(storage: Pick<Storage, 'getItem'>, userId: string, serverDone: boolean) {
  return serverDone || storage.getItem(tourKey(userId)) === 'true';
}

export function registrationReady(userId: string | null, onboarding: {
  completed?: boolean; oferta_accepted?: boolean; phone?: string
} | null, validPhone: boolean): boolean {
  return Boolean(userId && onboarding?.completed === true && onboarding.oferta_accepted === true && validPhone);
}

export function authRequest(initData: string | undefined, code: string | null, token: string | null) {
  // A reusable Mini App button must not depend on an old single-use web code.
  if (initData) return { action: 'telegram', body: { initData } };
  if (token) return { action: 'validate-session', body: { sessionToken: token } };
  if (code) return { action: 'exchange-code', body: { code } };
  return null;
}

export async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(input, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

// React effect replay must not consume a single-use login code twice.
export function onceAsync<T>(operation: () => Promise<T>) {
  let pending: Promise<T> | undefined;
  return () => pending ??= operation();
}
