import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'

export default function OfflineStatusBanner() {
  const [isOnline, setIsOnline] = useState(() => typeof navigator !== 'undefined' ? navigator.onLine : true)
  const [showRestoredNotice, setShowRestoredNotice] = useState(false)

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      setShowRestoredNotice(true)
      const timer = setTimeout(() => setShowRestoredNotice(false), 3500)
      return () => clearTimeout(timer)
    }

    const handleOffline = () => {
      setIsOnline(false)
      setShowRestoredNotice(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return (
    <AnimatePresence>
      {!isOnline && (
        <motion.div
          initial={{ opacity: 0, y: -40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -40 }}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 99999,
            background: 'linear-gradient(90deg, #D97706 0%, #B45309 100%)',
            color: '#FFFFFF',
            padding: '8px 16px',
            fontSize: 12,
            fontWeight: 700,
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            boxShadow: '0 4px 12px rgba(180, 83, 9, 0.3)',
          }}
        >
          <span>⚡ Oflayn rejim — Amallaringiz qurilmangizda saqlanmoqda va internet ulanishi bilan sinxronlanadi</span>
        </motion.div>
      )}

      {isOnline && showRestoredNotice && (
        <motion.div
          initial={{ opacity: 0, y: -40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -40 }}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 99999,
            background: 'linear-gradient(90deg, #16A34A 0%, #15803D 100%)',
            color: '#FFFFFF',
            padding: '8px 16px',
            fontSize: 12,
            fontWeight: 700,
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            boxShadow: '0 4px 12px rgba(21, 128, 61, 0.3)',
          }}
        >
          <span>🟢 Internet tiklandi — Ma'lumotlaringiz muvaffaqiyatli sinxronlandi!</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
