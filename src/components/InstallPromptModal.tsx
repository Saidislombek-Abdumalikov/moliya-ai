import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'

export default function InstallPromptModal() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [showModal, setShowModal] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)
  const [isIos, setIsIos] = useState(false)
  const [isTelegramWebview, setIsTelegramWebview] = useState(false)
  const [showIosGuide, setShowIosGuide] = useState(false)

  useEffect(() => {
    // Check if app is already running in standalone mode (installed on home screen)
    const standaloneMode = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true
    if (standaloneMode) {
      setIsStandalone(true)
      return
    }

    const ua = navigator.userAgent || ''
    const iosDevice = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream
    setIsIos(iosDevice)

    const isTgBrowser = ua.includes('Telegram') || (window as any).TelegramWebview
    setIsTelegramWebview(Boolean(isTgBrowser))

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e)
      setShowModal(true)
    }

    window.addEventListener('beforeinstallprompt', handler)

    // Also auto-show prompt for mobile browser visitors who haven't dismissed it today
    const dismissedAt = localStorage.getItem('pwa_prompt_dismissed_at')
    const hasDismissedRecently = dismissedAt && (Date.now() - parseInt(dismissedAt, 10)) < 24 * 3600 * 1000

    if (!hasDismissedRecently) {
      const timer = setTimeout(() => {
        setShowModal(true)
      }, 1500)
      return () => {
        clearTimeout(timer)
        window.removeEventListener('beforeinstallprompt', handler)
      }
    }

    const manualOpenHandler = () => setShowModal(true)
    window.addEventListener('open_install_prompt', manualOpenHandler)

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('open_install_prompt', manualOpenHandler)
    }
  }, [])

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === 'accepted') {
        setShowModal(false)
      }
      setDeferredPrompt(null)
    } else if (isIos) {
      setShowIosGuide(true)
    } else if (isTelegramWebview) {
      // Guide to open in real browser
      alert("Telegram ichki brauzerida ilovani ekranga o'rnatib bo'lmaydi.\n\nIltimos, yuqori o'ng burchakdagi 3 nuqtani bosing va 'Chrome/Safari da ochish' (Open in Browser) ni tanlang.")
    } else {
      alert("Ilovani ekranga o'rnatish uchun:\n\n1. Brauzeringizning o'ng yuqori qismidagi 3 nuqtani bosing.\n2. 'Ilovani o'rnatish' (Install App) yoki 'Bosh ekranga qo'shish' ni tanlang. 📲")
    }
  }

  const handleDismiss = () => {
    setShowModal(false)
    setShowIosGuide(false)
    localStorage.setItem('pwa_prompt_dismissed_at', String(Date.now()))
  }

  if (isStandalone) return null

  return (
    <>
      {/* 1. Main Floating Capsule Banner */}
      <AnimatePresence>
        {showModal && !showIosGuide && (
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
                  Telegramga kirmasdan, to'g'ridan-to'g'ri ekrandan oching!
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <button
                type="button"
                onClick={handleInstallClick}
                style={{
                  padding: '7px 13px',
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
        )}
      </AnimatePresence>

      {/* 2. iOS Safari Step-by-Step Bottom Sheet */}
      <AnimatePresence>
        {showIosGuide && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 9999,
              background: 'rgba(15, 23, 42, 0.6)',
              backdropFilter: 'blur(6px)',
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
              padding: '0 12px 16px'
            }}
            onClick={handleDismiss}
          >
            <motion.div
              initial={{ y: 200, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 200, opacity: 0 }}
              style={{
                width: '100%',
                maxWidth: 420,
                background: '#FFFFFF',
                borderRadius: 24,
                padding: '24px 20px',
                color: '#1E1B4B',
                boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
                display: 'flex',
                flexDirection: 'column',
                gap: 16
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 24 }}>🍏</span>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#1E1B4B' }}>
                      iPhone Bosh ekraniga qo'shish
                    </h3>
                    <p style={{ margin: 0, fontSize: 11.5, color: '#64748B' }}>
                      Ilovani to'liq ekranda ishlatish uchun 3 ta oddiy qadam:
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleDismiss}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: '#F1F5F9',
                    border: 'none',
                    fontSize: 12,
                    color: '#64748B',
                    cursor: 'pointer'
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Steps List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 14, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: '#EDE9FE', color: '#7C3AED', fontWeight: 800, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    1
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1E293B' }}>
                    Pastdagi <b>«Ulashish» [ ↑ ]</b> (Share) tugmasini bosing
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 14, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: '#EDE9FE', color: '#7C3AED', fontWeight: 800, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    2
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1E293B' }}>
                    Menyudan <b>«Bosh ekranga qo'shish» [ ＋ ]</b> ni tanlang
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 14, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: '#EDE9FE', color: '#7C3AED', fontWeight: 800, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    3
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1E293B' }}>
                    O'ng yuqoridagi <b>«Qo'shish» (Add)</b> tugmasini bosing
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleDismiss}
                style={{
                  width: '100%',
                  padding: '13px',
                  borderRadius: 14,
                  border: 'none',
                  background: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)',
                  color: '#FFFFFF',
                  fontWeight: 800,
                  fontSize: 14,
                  cursor: 'pointer'
                }}
              >
                Tushundim, rahmat 👍
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}
