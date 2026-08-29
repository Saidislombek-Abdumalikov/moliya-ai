const BOT_USERNAME = 'moliya_v2bot'
export const PRODUCTION_API_URL = 'https://moliya-ai-pi.vercel.app'

/**
 * Returns true if running inside standalone PWA container
 */
export function isNativePlatform(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((window.navigator as any).standalone)
  )
}

/**
 * Returns current platform ('web')
 */
export function getPlatform(): string {
  return 'web'
}

/**
 * Resolves API URL correctly for Web and Telegram Mini App
 */
export function getApiUrl(path: string): string {
  if (!path.startsWith('/')) {
    path = '/' + path
  }

  // Server-side or non-browser environment
  if (typeof window === 'undefined') {
    return `${PRODUCTION_API_URL}${path}`
  }

  return path
}

/**
 * Native features initializer stub for Web / Telegram Mini App
 */
export async function initNativeFeatures(): Promise<void> {
  // No-op for Web & Telegram Mini App
}

/**
 * Safely opens an external link (e.g. Telegram login, support, policies)
 */
export async function openExternalUrl(url: string, target: '_blank' | '_self' = '_blank'): Promise<void> {
  if (url.startsWith('tg://') || url.startsWith('tel:') || url.startsWith('mailto:')) {
    window.location.href = url
    return
  }

  if (target === '_blank') {
    window.open(url, '_blank', 'noopener,noreferrer')
  } else {
    window.location.href = url
  }
}

/**
 * Opens the Telegram Bot directly with fallback to https://t.me
 */
export function openTelegramBot(startParam: string = 'web'): void {
  const cleanParam = startParam.trim()
  const deepLink = cleanParam
    ? `tg://resolve?domain=${BOT_USERNAME}&start=${cleanParam}`
    : `tg://resolve?domain=${BOT_USERNAME}`

  const webLink = cleanParam
    ? `https://t.me/${BOT_USERNAME}?start=${cleanParam}`
    : `https://t.me/${BOT_USERNAME}`

  const isMobile = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  if (isMobile) {
    try {
      window.location.href = deepLink
      setTimeout(() => {
        if (document.hasFocus() || document.visibilityState === 'visible') {
          window.location.href = webLink
        }
      }, 1500)
    } catch {
      window.location.href = webLink
    }
  } else {
    window.open(webLink, '_blank', 'noopener,noreferrer')
  }
}

