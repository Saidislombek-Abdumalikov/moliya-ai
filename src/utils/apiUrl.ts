const PRODUCTION_API_URL = 'https://moliya-ai-pi.vercel.app';

/**
 * Returns the API URL for Web App and Telegram Mini App.
 */
export function getApiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;

  // Server-side or non-browser environment
  if (typeof window === 'undefined') {
    return `${PRODUCTION_API_URL}${cleanPath}`;
  }

  // Standard Web App and Telegram Mini App running in browser/Vercel
  return cleanPath;
}
