const PRODUCTION_API_URL = 'https://moliya-ai-pi.vercel.app';

/**
 * Returns the fully-qualified API URL for standalone Android APK / Capacitor / Cordova,
 * while preserving standard relative URLs for Web App and Telegram Mini App.
 */
export function getApiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;

  // Server-side or non-browser environment
  if (typeof window === 'undefined') {
    return `${PRODUCTION_API_URL}${cleanPath}`;
  }

  const { protocol, hostname } = window.location;

  // 1. Explicit native platform flags (Capacitor, Cordova, Android WebView, custom schemes)
  const isCapacitor = Boolean((window as any).Capacitor?.isNativePlatform?.());
  const isAndroidBridge = Boolean((window as any).AndroidBridge);
  const isCustomScheme = protocol === 'capacitor:' || protocol === 'ionic:' || protocol === 'file:';

  if (isCapacitor || isAndroidBridge || isCustomScheme) {
    return `${PRODUCTION_API_URL}${cleanPath}`;
  }

  // 2. Standalone mobile WebView bundle running on localhost
  const isMobileUserAgent = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobileUserAgent && (hostname === 'localhost' || hostname === '127.0.0.1')) {
    return `${PRODUCTION_API_URL}${cleanPath}`;
  }

  // 3. Standard Web App and Telegram Mini App running in browser/Vercel
  return cleanPath;
}
