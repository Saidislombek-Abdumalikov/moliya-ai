import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { SplashScreen } from '@capacitor/splash-screen'
import { Browser } from '@capacitor/browser'

const BOT_USERNAME = 'moliya_v2bot'
export const PRODUCTION_API_URL = 'https://moliya-ai-pi.vercel.app'

/**
 * Returns true if running inside a native iOS or Android Capacitor wrapper or standalone web container
 */
export function isNativePlatform(): boolean {
  if (typeof window === 'undefined') return false
  return (
    Capacitor.isNativePlatform() ||
    Boolean((window as any).AndroidBridge) ||
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((window.navigator as any).standalone)
  )
}

/**
 * Returns the current platform ('android', 'ios', or 'web')
 */
export function getPlatform(): string {
  return Capacitor.getPlatform()
}

/**
 * Resolves API URL correctly both for Web (relative) and Native Android WebView (absolute)
 */
export function getApiUrl(path: string): string {
  if (!path.startsWith('/')) {
    path = '/' + path
  }

  // Server-side or non-browser environment
  if (typeof window === 'undefined') {
    return `${PRODUCTION_API_URL}${path}`
  }

  const { protocol, hostname } = window.location

  // 1. Explicit native platform flags (Capacitor, Cordova, Android WebView, custom schemes)
  const isCap = Boolean((window as any).Capacitor?.isNativePlatform?.()) || Capacitor.isNativePlatform()
  const isAndroidBridge = Boolean((window as any).AndroidBridge)
  const isCustomScheme = protocol === 'capacitor:' || protocol === 'ionic:' || protocol === 'file:'

  if (isCap || isAndroidBridge || isCustomScheme) {
    return `${PRODUCTION_API_URL}${path}`
  }

  // 2. Standalone mobile WebView bundle running on localhost
  const isMobileUserAgent = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  if (isMobileUserAgent && (hostname === 'localhost' || hostname === '127.0.0.1')) {
    return `${PRODUCTION_API_URL}${path}`
  }

  // 3. Standard Web App and Telegram Mini App running in browser/Vercel
  return path
}

/**
 * Initializes native Android / iOS features (Status Bar, Splash Screen)
 */
export async function initNativeFeatures(): Promise<void> {
  if (!isNativePlatform()) return

  try {
    // Style status bar with light background and dark icons
    await StatusBar.setStyle({ style: Style.Dark })
    await StatusBar.setBackgroundColor({ color: '#FAF8FE' })
    await StatusBar.setOverlaysWebView({ overlay: false })
  } catch (err) {
    console.warn('[NativeBridge] StatusBar error:', err)
  }

  try {
    // Hide splash screen smoothly after app initializes
    await SplashScreen.hide({ fadeOutDuration: 300 })
  } catch (err) {
    console.warn('[NativeBridge] SplashScreen error:', err)
  }
}

/**
 * Safely opens an external link (e.g. Telegram login, support, policies)
 */
export async function openExternalUrl(url: string, target: '_blank' | '_self' = '_blank'): Promise<void> {
  if (isNativePlatform()) {
    try {
      if (url.startsWith('tg://') || url.startsWith('tel:') || url.startsWith('mailto:')) {
        window.location.href = url
        return
      }

      await Browser.open({
        url,
        windowName: target,
        presentationStyle: 'popover',
        toolbarColor: '#7C3AED',
      })
      return
    } catch (e) {
      console.warn('[NativeBridge] Browser plugin error, fallback to window.open:', e)
    }
  }

  // Web fallback
  if (target === '_blank') {
    window.open(url, '_blank', 'noopener,noreferrer')
  } else {
    window.location.href = url
  }
}

/**
 * Opens the Telegram Bot directly via native deep link (tg://) with fallback to https://t.me
 */
export function openTelegramBot(startParam: string = 'apk'): void {
  const cleanParam = startParam.trim()
  const deepLink = cleanParam
    ? `tg://resolve?domain=${BOT_USERNAME}&start=${cleanParam}`
    : `tg://resolve?domain=${BOT_USERNAME}`

  const webLink = cleanParam
    ? `https://t.me/${BOT_USERNAME}?start=${cleanParam}`
    : `https://t.me/${BOT_USERNAME}`

  if (isNativePlatform()) {
    try {
      window.location.href = deepLink
      return
    } catch {
      openExternalUrl(webLink)
      return
    }
  }

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
