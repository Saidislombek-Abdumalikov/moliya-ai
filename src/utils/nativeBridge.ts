/**
 * Utility functions for communicating with Telegram, native Android apps, and web containers.
 */

const BOT_USERNAME = 'moliya_v2bot';

/**
 * Opens the Telegram bot with an optional start parameter (e.g. 'apk', 'app', 'req_xxx').
 * Attempts deep linking via tg:// first, falling back to https://t.me/
 */
export function openTelegramBot(startParam: string = 'apk'): void {
  const cleanParam = startParam.trim();
  const deepLink = cleanParam 
    ? `tg://resolve?domain=${BOT_USERNAME}&start=${cleanParam}`
    : `tg://resolve?domain=${BOT_USERNAME}`;
  
  const webLink = cleanParam
    ? `https://t.me/${BOT_USERNAME}?start=${cleanParam}`
    : `https://t.me/${BOT_USERNAME}`;

  const isMobile = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  if (isMobile) {
    try {
      // Try native deep link first
      window.location.href = deepLink;
      
      // Fallback timer if deep link doesn't trigger app switch within 1.5s
      setTimeout(() => {
        if (document.hasFocus() || document.visibilityState === 'visible') {
          window.open(webLink, '_blank') || (window.location.href = webLink);
        }
      }, 1500);
    } catch {
      window.location.href = webLink;
    }
  } else {
    // Desktop: Open web link in new tab
    const link = document.createElement('a');
    link.href = webLink;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
