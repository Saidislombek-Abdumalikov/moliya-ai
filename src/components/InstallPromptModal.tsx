import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { isTelegramMiniApp } from '../FinanceContext'

export default function InstallPromptModal() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [showModal, setShowModal] = useState(false)
  const [isInstalled, setIsInstalled] = useState(false)
  const [isIosDevice, setIsIosDevice] = useState(false)

  useEffect(() => {
    // 1. Strictly never run inside Telegram Mini App
    if (isTelegramMiniApp()) return

    // 2. Check if already running in standalone mode or previously installed
    const standaloneMode =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true ||
      localStorage.getItem('pwa_installed') === 'true'

    if (standaloneMode) {
      setIsInstalled(true)
      return
    }

    // Check if device is iOS (Safari)
    const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) && !(window as any).MSStream
    setIsIosDevice(isIos)

    const dismissedAt = localStorage.getItem('pwa_prompt_dismissed_at')
    const hasDismissedRecently = dismissedAt && (Date.now() - parseInt(dismissedAt, 10)) < 24 * 3600 * 1000

    if (isIos && !hasDismissedRecently) {
      // On iOS Safari, show the iOS Add to Home Screen prompt after 2 seconds
      const timer = setTimeout(() => {
        setShowModal(true)
      }, 2000)
      return () => clearTimeout(timer)
    }

    // 3. Listen for native browser PWA install event (Android / Chrome)
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e)

      if (!hasDismissedRecently) {
        setShowModal(true)
      }
    }

    window.addEventListener('beforeinstallprompt', handler)

    // Window event for manual trigger if requested
    const manualOpenHandler = () => {
      setShowModal(true)
    }
    window.addEventListener('open_install_prompt', manualOpenHandler)

    // Listen for successful install event
    const appInstalledHandler = () => {
      localStorage.setItem('pwa_installed', 'true')
      setShowModal(false)
      setDeferredPrompt(null)
    }
    window.addEventListener('appinstalled', appInstalledHandler)

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('open_install_prompt', manualOpenHandler)
      window.removeEventListener('appinstalled', appInstalledHandler)
    }
  }, [deferredPrompt])

  // If inside Telegram Mini App or already installed, render nothing
  if (isTelegramMiniApp() || isInstalled) return null

  // 1-Tap native installation directly to screen (for Android / Chromium)
  const handleInstallClick = async () => {
    if (deferredPrompt) {
      try {
        deferredPrompt.prompt()
        const { outcome } = await deferredPrompt.userChoice
        if (outcome === 'accepted') {
          localStorage.setItem('pwa_installed', 'true')
        }
      } catch (err) {
        console.error('[PWA] Error launching install prompt:', err)
      }
      setShowModal(false)
      setDeferredPrompt(null)
    }
  }

  const handleDismiss = () => {
    setShowModal(false)
    localStorage.setItem('pwa_prompt_dismissed_at', String(Date.now()))
  }

  if (!showModal) return null
  if (!isIosDevice && !deferredPrompt) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 70, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 70, scale: 0.95 }}
        transition={{ type: 'spring', damping: 24, stiffness: 300 }}
        style={{
          position: 'fixed',
          bottom: 80,
          left: 16,
          right: 16,
          zIndex: 9998,
          maxWidth: 400,
          margin: '0 auto',
          background: 'linear-gradient(135deg, #1E1B4B 0%, #312E81 100%)',
          color: '#FFFFFF',
          borderRadius: 20,
          padding: '12px 14px',
          boxShadow: '0 16px 36px rgba(49, 46, 129, 0.45), 0 4px 12px rgba(0, 0, 0, 0.2)',
          border: '1.5px solid rgba(199, 210, 254, 0.25)',
          display: 'flex',
          flexDirection: isIosDevice ? 'column' : 'row',
          alignItems: isIosDevice ? 'stretch' : 'center',
          justifyContent: 'space-between',
          gap: 10,
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                background: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                flexShrink: 0,
                boxShadow: '0 4px 12px rgba(124, 58, 237, 0.4)',
                border: '1.5px solid rgba(255, 255, 255, 0.2)'
              }}
            >
              📲
            </div>
            <div style={{ minWidth: 0 }}>
              <h4 style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 800, color: '#FFFFFF' }}>
                {isIosDevice ? "iPhone ekranga qo'shish" : "Ekranga yuklab olish"}
              </h4>
              <p style={{ margin: 0, fontSize: 11, color: '#C7D2FE', lineHeight: 1.3 }}>
                {isIosDevice
                  ? "Safari orqali qulay va tezkor kirish"
                  : "Tezkor kirish uchun ilovani o'rnating"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleDismiss}
            style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.12)',
              border: 'none',
              color: '#E0E7FF',
              fontSize: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              flexShrink: 0
            }}
          >
            ✕
          </button>
        </div>

        {isIosDevice ? (
          <div style={{
            background: 'rgba(255, 255, 255, 0.08)',
            borderRadius: 12,
            padding: '8px 12px',
            fontSize: 11.5,
            color: '#E0E7FF',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 2
          }}>
            <span style={{ fontSize: 16 }}>⎋</span>
            <span>
              Safari'da pastdagi <b>Ulashish (Share)</b> tugmasini bosing va <b>"Asosiy ekranga qo'shish" (+)</b> ni tanlang.
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 'auto' }}>
            <button
              type="button"
              onClick={handleInstallClick}
              style={{
                padding: '7px 14px',
                background: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)',
                color: '#FFFFFF',
                fontWeight: 800,
                fontSize: 12,
                borderRadius: 12,
                border: '1px solid rgba(255, 255, 255, 0.3)',
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(124, 58, 237, 0.4)',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}
            >
              <span>O'rnatish</span>
              <span>↓</span>
            </button>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
