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
export function tourKey(userId: string, generation = '', surface = 'web') {
  return `user_tour_completed_v4_${userId}_${generation}_${surface}`;
}
export function tourDone(storage: Pick<Storage, 'getItem'>, userId: string, _serverDone: boolean, generation = '', surface = 'web') {
  // A tour completed in Mini App must not suppress the first tour in a new browser.
  return storage.getItem(tourKey(userId, generation, surface)) === 'true';
}

// Retry only reusable authentication operations; never replay a single-use web code.
export async function reusableAuthRequest(action: string, body: unknown, pause = (ms:number)=>new Promise<void>(r=>setTimeout(r,ms))) {
  for (let attempt=0;;attempt++) {
    try {
      const response=await fetchWithTimeout('/api/auth/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},10000);
      if (attempt<2 && (response.status===409 || response.status>=500)) {await pause(400*(attempt+1));continue;}
      return response;
    } catch (error) {if(attempt>=2)throw error;await pause(400*(attempt+1));}
  }
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

export function shouldRenewTelegramSession(action:string,status:number,data:any,initData:string) {
 return action==='validate-session' && !!initData && (status===401 || (status===200 && data?.valid===false));
}
