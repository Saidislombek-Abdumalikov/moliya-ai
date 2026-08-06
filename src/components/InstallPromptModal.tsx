import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'

export default function InstallPromptModal() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [showModal, setShowModal] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    // Check if app is already running in standalone mode (installed on home screen)
    if (window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone) {
      setIsStandalone(true)
      return
    }

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e)
      const dismissed = localStorage.getItem('pwa_prompt_dismissed')
      if (!dismissed) {
        setShowModal(true)
      }
    }

    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === 'accepted') {
        setShowModal(false)
      }
      setDeferredPrompt(null)
    } else {
      // Fallback instructions for iOS Safari
      alert("Ilovani ekranga qo'shish uchun:\n\n1. Brauzer menyusidan 'Ulashish' (Share) tugmasini bosing.\n2. 'Bosh ekranga qo'shish' (Add to Home Screen) tanlang. 📲")
    }
  }

  const handleDismiss = () => {
    setShowModal(false)
    localStorage.setItem('pwa_prompt_dismissed', 'true')
  }

  if (isStandalone || !showModal) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 50 }}
        className="fixed bottom-20 left-4 right-4 z-50 p-4 bg-gradient-to-r from-purple-900 to-indigo-900 text-white rounded-2xl shadow-2xl border border-purple-500/30 flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-purple-600 flex items-center justify-center font-bold text-lg shadow-lg">
            📲
          </div>
          <div>
            <h4 className="font-semibold text-sm">Ekranga qo'shish</h4>
            <p className="text-xs text-purple-200">Ilovani brauzersiz, to'g'ridan-to'g'ri ekrandan oching!</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleInstallClick}
            className="px-3 py-2 bg-white text-purple-950 font-bold text-xs rounded-xl shadow hover:bg-purple-50 transition active:scale-95"
          >
            O'rnatish
          </button>
          <button
            onClick={handleDismiss}
            className="text-purple-300 hover:text-white text-xs p-1"
          >
            ✕
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
