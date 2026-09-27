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
  if (code) return { action: 'exchange-code', body: { code } };
  if (token) return { action: 'validate-session', body: { sessionToken: token } };
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
