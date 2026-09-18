import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { isTelegramMiniApp } from '../FinanceContext'

export default function InstallPromptModal() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [showModal, setShowModal] = useState(false)
  const [isInstalled, setIsInstalled] = useState(false)

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

    // 3. Listen for native browser PWA install event
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e)

      // Only show if not dismissed recently (within 24 hours)
      const dismissedAt = localStorage.getItem('pwa_prompt_dismissed_at')
      const hasDismissedRecently = dismissedAt && (Date.now() - parseInt(dismissedAt, 10)) < 24 * 3600 * 1000
      if (!hasDismissedRecently) {
        setShowModal(true)
      }
    }

    window.addEventListener('beforeinstallprompt', handler)

    // Window event for manual trigger if requested
    const manualOpenHandler = () => {
      if (deferredPrompt) setShowModal(true)
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

  // 1-Tap native installation directly to screen — NO alerts, NO multi-step guides
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

  if (!showModal || !deferredPrompt) return null

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
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 20,
              flexShrink: 0,
              boxShadow: '0 4px 12px rgba(124, 58, 237, 0.4)',
              border: '1.5px solid rgba(255, 255, 255, 0.2)'
            }}
          >
            📲
          </div>
          <div style={{ minWidth: 0 }}>
            <h4 style={{ margin: '0 0 2px', fontSize: 13.5, fontWeight: 800, color: '#FFFFFF' }}>
              Ekranga yuklab olish
            </h4>
            <p style={{ margin: 0, fontSize: 11, color: '#C7D2FE', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Tezkor kirish uchun ilovani o'rnating
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
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
              padding: 0
            }}
          >
            ✕
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
