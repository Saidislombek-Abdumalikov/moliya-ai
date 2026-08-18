/**
 * Utility functions for communicating with Telegram, native Android apps, and web containers.
 */

const BOT_USERNAME = 'moliya_v2bot';

/**
 * Checks if the current app is running in a native wrapper (Capacitor, Cordova, WebView, or standalone PWA)
 */
export function isNativePlatform(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    (window as any).Capacitor?.isNativePlatform?.() ||
    (window as any).AndroidBridge ||
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone
  );
}

/**
 * Safely opens an external URL in the default browser / external app
 */
export function openExternalUrl(url: string): void {
  try {
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer') || (window.location.href = url);
    }
  } catch {
    if (typeof window !== 'undefined') {
      window.location.href = url;
    }
  }
}

/**
 * Opens the Telegram bot with an optional start parameter (e.g. 'apk', 'app', 'req_xxx').
 * Attempts deep linking via tg:// first on mobile/native, falling back to https://t.me/
 */
export function openTelegramBot(startParam: string = 'apk'): void {
  const cleanParam = startParam.trim();
  const deepLink = cleanParam 
    ? `tg://resolve?domain=${BOT_USERNAME}&start=${cleanParam}`
    : `tg://resolve?domain=${BOT_USERNAME}`;
  
  const webLink = cleanParam
    ? `https://t.me/${BOT_USERNAME}?start=${cleanParam}`
    : `https://t.me/${BOT_USERNAME}`;

  if (isNativePlatform()) {
    try {
      window.location.href = deepLink;
      return;
    } catch {
      openExternalUrl(webLink);
      return;
    }
  }

  const isMobile = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  if (isMobile) {
    try {
      window.location.href = deepLink;
      setTimeout(() => {
        if (document.hasFocus() || document.visibilityState === 'visible') {
          window.location.href = webLink;
        }
      }, 1500);
    } catch {
      window.location.href = webLink;
    }
  } else {
    window.open(webLink, '_blank', 'noopener,noreferrer');
  }
}
