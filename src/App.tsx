import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import Onboarding from './components/Onboarding'
import HomeScreen from './components/HomeScreen'
import CalendarScreen from './components/CalendarScreen'
import AnalyticsScreen from './components/AnalyticsScreen'
import ProfileScreen from './components/ProfileScreen'
import AdminScreen from './components/AdminScreen'
import BottomNav from './components/BottomNav'
import AIButton from './components/AIButton'
import PinLockScreen from './components/PinLockScreen'
import AppTour from './components/AppTour'
import { useFinance } from './FinanceContext'

import InstallPromptModal from './components/InstallPromptModal'

export type Screen = 'home' | 'calendar' | 'analytics' | 'profile' | 'admin'
type Stage = 'onboarding' | 'app'

export default function App() {
  const { onboarding, updateOnboarding, security, setHasSampleData } = useFinance()

  const [showTour, setShowTour] = useState(false)

  // Set initial stage based on login persistence
  const [stage, setStage] = useState<Stage>(() => {
    const savedLoggedIn = localStorage.getItem('user_logged_in_v1')
    if (savedLoggedIn === 'true') {
      return 'app'
    }
    return 'onboarding'
  })

  const [activeScreen, setActiveScreen] = useState<Screen>(() => {
    if (window.location.pathname === '/admin') {
      return 'admin'
    }
    return 'home'
  })

  // Set lock state if PIN security is enabled
  const [isLocked, setIsLocked] = useState(() => {
    const savedSec = localStorage.getItem('user_security_v1')
    if (savedSec) {
      try {
        const parsed = JSON.parse(savedSec)
        return !!parsed.pinEnabled && !!parsed.pinCode
      } catch {
        return false
      }
    }
    return false
  })

  // Trigger tour on first visit to main page
  useEffect(() => {
    const tourSeen = localStorage.getItem('user_tour_completed_v2')
    if (!tourSeen) {
      setShowTour(true)
    }
  }, [])

  // Auto-transition to app when user gets authenticated via Session, URL parameter, or Telegram Polling
  useEffect(() => {
    const checkLoggedIn = () => {
      const isLoggedIn = localStorage.getItem('user_logged_in_v1') === 'true'
      if (isLoggedIn) {
        setStage('app')
      }
    }
    checkLoggedIn()
    window.addEventListener('storage', checkLoggedIn)
    window.addEventListener('user_logged_in_updated', checkLoggedIn)
    return () => {
      window.removeEventListener('storage', checkLoggedIn)
      window.removeEventListener('user_logged_in_updated', checkLoggedIn)
    }
  }, [onboarding])

  // If onboarding is null, set clean defaults
  useEffect(() => {
    if (!onboarding) {
      updateOnboarding({
        name: 'Foydalanuvchi',
        phone: '+998 90 123 45 67',
        telegram: '@moliya_user',
        language: 'uz',
        monthlyIncome: 0,
        monthlyGoal: 0,
        isPremium: false
      })
    }
  }, [onboarding, updateOnboarding])

  if (stage === 'onboarding') {
    return (
      <Onboarding
        onComplete={(result) => {
          updateOnboarding(result)
          setHasSampleData(false)
          localStorage.setItem('user_logged_in_v1', 'true')
          setStage('app')
          const pinEnabled = security ? security.pinEnabled : false
          setIsLocked(!!pinEnabled)
          setShowTour(true)
        }}
      />
    )
  }

  if (isLocked) {
    return (
      <PinLockScreen
        language={onboarding?.language || 'uz'}
        onUnlock={() => setIsLocked(false)}
        onReset={() => {
          localStorage.removeItem('user_logged_in_v1')
          localStorage.removeItem('user_onboarding_v1')
          setStage('onboarding')
          setIsLocked(false)
        }}
      />
    )
  }

  // Telegram Mini App viewport initialization & auto-expand
  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      try {
        if (typeof tg.ready === 'function') tg.ready();
        if (typeof tg.expand === 'function') tg.expand();
        if (typeof tg.enableClosingConfirmation === 'function') tg.enableClosingConfirmation();
      } catch (e) {
        console.error('Telegram WebApp init error:', e);
      }
    }
  }, []);

  return (
    <div
      style={{
        position: 'relative',
        minHeight: '100dvh',
        width: '100%',
        maxWidth: 430,
        margin: '0 auto',
        background: '#FAF8FE',
        paddingBottom: 95,
        boxSizing: 'border-box',
      }}
    >
      <InstallPromptModal />

      <AnimatePresence mode="wait">
        <motion.div
          key={activeScreen}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          style={{ width: '100%' }}
        >
          {activeScreen === 'home' && <HomeScreen onboarding={onboarding} onUpdateOnboarding={updateOnboarding} />}
          {activeScreen === 'calendar' && <CalendarScreen onboarding={onboarding} />}
          {activeScreen === 'analytics' && <AnalyticsScreen onboarding={onboarding} onUpdateOnboarding={updateOnboarding} />}
          {activeScreen === 'admin' && <AdminScreen onboarding={onboarding} />}
          {activeScreen === 'profile' && (
            <ProfileScreen
              onLogout={() => {
                localStorage.removeItem('user_logged_in_v1')
                localStorage.removeItem('user_onboarding_v1')
                setStage('onboarding')
                setIsLocked(false)
              }}
              onboarding={onboarding}
              onUpdateOnboarding={updateOnboarding}
              onClearData={() => {
                setStage('onboarding')
                setActiveScreen('home')
                setIsLocked(false)
              }}
              onStartTour={() => setShowTour(true)}
            />
          )}
        </motion.div>
      </AnimatePresence>

      <BottomNav active={activeScreen} onChange={setActiveScreen} language={onboarding?.language} />
      <AIButton visible={activeScreen !== 'profile' && activeScreen !== 'admin'} language={onboarding?.language || 'uz'} />
      <InstallPromptModal />
      <AppTour 
        isOpen={showTour} 
        onClose={() => setShowTour(false)} 
        language={onboarding?.language || 'uz'}
        onNavigateScreen={setActiveScreen}
      />
    </div>
  )
}
