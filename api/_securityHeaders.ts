/**
 * MOLIYA AI — HTTP SECURITY HEADERS
 * Enforces defensive browser headers across all API endpoints and server responses.
 */

export const SECURITY_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-DNS-Prefetch-Control': 'on',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org https://telegram.org",
    "script-src 'self' 'unsafe-inline' https://telegram.org",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: https: blob:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "media-src 'self' blob:",
    "object-src 'none'"
  ].join('; ')
};

/**
 * Applies defensive security headers to any VercelResponse or Express response object.
 */
export function applySecurityHeaders(res: any): void {
  if (!res || typeof res.setHeader !== 'function') return;

  for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(header, value);
  }
}
