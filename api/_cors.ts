/**
 * MOLIYA AI — CENTRALIZED CORS POLICY & ORIGIN VALIDATOR
 * Prevents unauthorized cross-origin access and eliminates wildcard Access-Control-Allow-Origin: *
 */

// Trusted Origins for standard user-facing API routes
export const DEFAULT_ALLOWED_ORIGINS = [
  'https://moliya-ai-pi.vercel.app',
  'https://moliya-ai.vercel.app',
  'https://web.telegram.org',
  'https://telegram.org',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:8443',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:8443'
];

/**
 * Resolves the full list of allowed origins from environment and defaults.
 */
export function getAllowedOrigins(extraEnvVar?: string): string[] {
  const envList = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

  const specificEnvList = extraEnvVar && process.env[extraEnvVar]
    ? process.env[extraEnvVar]!.split(',').map(o => o.trim()).filter(Boolean)
    : [];

  // User-app origins must never implicitly become trusted admin origins.
  if (extraEnvVar === 'ADMIN_ALLOWED_ORIGINS') return Array.from(new Set(specificEnvList));
  return Array.from(new Set([...DEFAULT_ALLOWED_ORIGINS, ...envList, ...specificEnvList]));
}

/**
 * Validates whether an incoming origin header matches the allowed whitelist.
 */
export function isOriginAllowed(origin: string | undefined | null, extraEnvVar?: string): boolean {
  if (!origin || typeof origin !== 'string') return false;
  const cleanOrigin = origin.trim().toLowerCase().replace(/\/+$/, '');
  const allowed = getAllowedOrigins(extraEnvVar).map(o => o.toLowerCase().replace(/\/+$/, ''));
  return allowed.includes(cleanOrigin);
}

export interface CorsOptions {
  allowedMethods?: string;
  allowedHeaders?: string;
  allowCredentials?: boolean;
  adminOnly?: boolean;
}

/**
 * Handles CORS headers and preflight (OPTIONS) requests safely.
 * Returns true if the request was an OPTIONS preflight and has been handled/ended.
 */
export function handleCors(req: any, res: any, options: CorsOptions = {}): boolean {
  const origin = req.headers?.origin || req.headers?.Origin;
  const methods = options.allowedMethods || 'GET,POST,OPTIONS';
  const headers = options.allowedHeaders || 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, x-session-token, x-admin-key';
  const allowCredentials = options.allowCredentials !== false;
  if (options.adminOnly && origin !== undefined && typeof origin !== 'string') {
    res.status(403).json({error:'INVALID_ORIGIN'}); return true;
  }

  res.setHeader('Vary', 'Origin');

  if (origin && typeof origin === 'string') {
    const extraEnv = options.adminOnly ? 'ADMIN_ALLOWED_ORIGINS' : undefined;
    if (isOriginAllowed(origin, extraEnv)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      if (allowCredentials) {
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
    } else {
      // Disallowed Origin: Do NOT reflect origin and do NOT send wildcard
      if (options.adminOnly) {
        res.status(403).json({ error: 'CORS policy violation: origin not allowed for administrative API' });
        return true;
      }
    }
  }

  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', headers);

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }

  return false;
}
