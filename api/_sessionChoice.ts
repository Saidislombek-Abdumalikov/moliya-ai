// A signed Telegram launch can join the user's active session. Rotating the
// token on every Mini App opening would log an already open web view out.
export function activeSessionToken(onboarding: any, now = Date.now()): string | null {
  const token = onboarding?.session_token;
  const expires = Date.parse(onboarding?.session_expires_at || '');
  return typeof token === 'string' && /^sess_[a-zA-Z0-9_-]{16,128}$/.test(token)
    && Number.isFinite(expires) && expires > now ? token : null;
}
