import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import LoginScreen from './components/LoginScreen'
import Onboarding from './components/Onboarding'
import HomeScreen from './components/HomeScreen'
import CalendarScreen from './components/CalendarScreen'
import AnalyticsScreen from './components/AnalyticsScreen'
import ProfileScreen from './components/ProfileScreen'
import PinLockScreen from './components/PinLockScreen'
import BottomNav from './components/BottomNav'
import AIButton from './components/AIButton'
import AppTour from './components/AppTour'
import { useFinance } from './FinanceContext'
import { App as CapacitorApp } from '@capacitor/app'
import { initNativeFeatures, isNativePlatform } from './utils/nativeBridge'

import InstallPromptModal from './components/InstallPromptModal'
import OfflineStatusBanner from './components/OfflineStatusBanner'

export type Screen = 'home' | 'calendar' | 'analytics' | 'profile'
type Stage = 'loading' | 'login' | 'onboarding' | 'app'

export default function App() {
  const { onboarding, updateOnboarding, setHasSampleData, logout, isAuthReady, userId } = useFinance()

  const getInitialStage = (): Stage => {
    try {
      const isLoggedIn = localStorage.getItem('user_logged_in_v1') === 'true'
      if (isLoggedIn) {
        const isOnboarded = localStorage.getItem('user_onboarding_completed_v1') === 'true'
        return isOnboarded ? 'app' : 'onboarding'
      }
      const hasPreOnboarded = localStorage.getItem('user_onboarding_pre_completed_v1') === 'true'
      const hasCompleted = localStorage.getItem('user_onboarding_completed_v1') === 'true'
      if (!hasPreOnboarded && !hasCompleted) {
        return 'onboarding'
      }
      return 'login'
    } catch {
      return 'login'
    }
  }

  const [showTour, setShowTour] = useState(false)
  const [stage, setStage] = useState<Stage>(getInitialStage)
  const [activeScreen, setActiveScreen] = useState<Screen>('home')
  const [isPinLocked, setIsPinLocked] = useState<boolean>(() => {
    try {
      const s = localStorage.getItem('user_security_v1')
      return s ? JSON.parse(s).pinEnabled === true : false
    } catch {
      return false
    }
  })

  // ═══════════════════════════════════════════════════════════
  // ALL HOOKS MUST BE BEFORE ANY CONDITIONAL RETURNS
  // React requires hooks to be called in the same order every render.
  // Placing useEffect after if/return causes "Rendered more hooks" crash.
  // ═══════════════════════════════════════════════════════════

  // Initialize native Android features (Status bar color, Splash screen auto-hide)
  useEffect(() => {
    initNativeFeatures()
  }, [])

  // Failsafe timeout for loading stage: never stay stuck loading > 2.5s
  useEffect(() => {
    if (stage !== 'loading') return
    const timer = setTimeout(() => {
      setStage(getInitialStage())
    }, 2500)
    return () => clearTimeout(timer)
  }, [stage])

  // Android hardware back button navigation handling
  useEffect(() => {
    if (!isNativePlatform()) return

    let lastBackPress = 0

    const backHandlerPromise = CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      // 1. If tour is open, close it first
      if (showTour) {
        setShowTour(false)
        return
      }

      // 2. If inside app and on a sub-screen, return to home
      if (stage === 'app' && activeScreen !== 'home') {
        setActiveScreen('home')
        return
      }

      // 3. Double tap back button within 2 seconds to exit app
      const now = Date.now()
      if (now - lastBackPress < 2000) {
        CapacitorApp.exitApp()
      } else {
        lastBackPress = now
        if (canGoBack) {
          window.history.back()
        }
      }
    })

    return () => {
      backHandlerPromise.then((handler) => handler.remove())
    }
  }, [showTour, stage, activeScreen])

  // Determine stage ONLY after auth check completes
  useEffect(() => {
    if (!isAuthReady) return

    const isLoggedIn = Boolean(userId || localStorage.getItem('user_logged_in_v1') === 'true')
    if (isLoggedIn) {
      const isOnboardingCompleted = Boolean(
        onboarding?.completed ||
        localStorage.getItem('user_onboarding_completed_v1') === 'true'
      )
      if (isOnboardingCompleted) {
        setStage('app')
      } else {
        setStage('onboarding')
      }
    } else {
      const hasPreOnboarded = localStorage.getItem('user_onboarding_pre_completed_v1') === 'true'
      const hasCompleted = localStorage.getItem('user_onboarding_completed_v1') === 'true'
      if (!hasPreOnboarded && !hasCompleted) {
        setStage('onboarding')
      } else {
        setStage('login')
      }
    }
  }, [isAuthReady, userId, onboarding])

  // Trigger tour on first visit to main page
  useEffect(() => {
    const tourSeen = localStorage.getItem('user_tour_completed_v2')
    if (!tourSeen && stage === 'app') {
      setShowTour(true)
    }
  }, [stage])

  // Auto-transition when storage or custom auth events change
  useEffect(() => {
    const checkLoggedIn = () => {
      const isLoggedIn = localStorage.getItem('user_logged_in_v1') === 'true'
      if (isLoggedIn) {
        const isOnboardingCompleted = localStorage.getItem('user_onboarding_completed_v1') === 'true'
        if (isOnboardingCompleted) {
          setStage('app')
        } else {
          setStage('onboarding')
        }
      } else if (isAuthReady) {
        const hasPreOnboarded = localStorage.getItem('user_onboarding_pre_completed_v1') === 'true'
        const hasCompleted = localStorage.getItem('user_onboarding_completed_v1') === 'true'
        if (!hasPreOnboarded && !hasCompleted) {
          setStage('onboarding')
        } else {
          setStage('login')
        }
      }
    }
    window.addEventListener('storage', checkLoggedIn)
    window.addEventListener('user_logged_in_updated', checkLoggedIn)
    return () => {
      window.removeEventListener('storage', checkLoggedIn)
      window.removeEventListener('user_logged_in_updated', checkLoggedIn)
    }
  }, [isAuthReady])

  // Telegram Mini App viewport initialization & auto-expand
  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp
    if (tg) {
      try {
        if (typeof tg.ready === 'function') tg.ready()
        if (typeof tg.expand === 'function') tg.expand()
        if (typeof tg.enableClosingConfirmation === 'function') tg.enableClosingConfirmation()
      } catch (e) {
        console.error('Telegram WebApp init error:', e)
      }
    }
  }, [])

  // ═══════════════════════════════════════════════════════════
  // CONDITIONAL RENDERS — all hooks are above this line
  // ═══════════════════════════════════════════════════════════

  if (stage === 'loading') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100dvh',
          width: '100%',
          maxWidth: 430,
          margin: '0 auto',
          background: '#FAF8FE',
        }}
      >
        <div style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          border: '4px solid #E5E7EB',
          borderTopColor: '#7C3AED',
          animation: 'spin 0.8s linear infinite',
        }} />
        <p style={{
          marginTop: 16,
          fontSize: 15,
          color: '#6B7280',
          fontWeight: 500,
        }}>
          Yuklanmoqda...
        </p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (stage === 'onboarding') {
    return (
      <Onboarding
        onComplete={(result) => {
          localStorage.setItem('user_onboarding_pre_completed_v1', 'true')
          if (userId) {
            updateOnboarding({ ...result, completed: true })
            localStorage.setItem('user_onboarding_completed_v1', 'true')
            setHasSampleData(false)
            setStage('app')
            setShowTour(true)
          } else {
            // Pre-login onboarding complete -> save selected language/goal & proceed to Telegram verification
            updateOnboarding({ ...result })
            setStage('login')
          }
        }}
      />
    )
  }

  if (stage === 'login') {
    return (
      <LoginScreen
        onLoginSuccess={(_isNewUser) => {
          localStorage.setItem('user_onboarding_pre_completed_v1', 'true')
          localStorage.setItem('user_onboarding_completed_v1', 'true')
          updateOnboarding({ completed: true })
          setHasSampleData(false)
          setStage('app')
          setShowTour(true)
        }}
      />
    )
  }

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
      <OfflineStatusBanner />
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
          {activeScreen === 'profile' && (
            <ProfileScreen
              onLogout={() => {
                logout()
                localStorage.removeItem('user_onboarding_completed_v1')
                setStage('login')
                setActiveScreen('home')
              }}
              onboarding={onboarding}
              onUpdateOnboarding={updateOnboarding}
              onClearData={() => {
                logout()
                localStorage.removeItem('user_onboarding_completed_v1')
                setStage('login')
                setActiveScreen('home')
              }}
              onStartTour={() => setShowTour(true)}
            />
          )}
        </motion.div>
      </AnimatePresence>

      <BottomNav active={activeScreen} onChange={setActiveScreen} language={onboarding?.language} />
      <AIButton visible={activeScreen !== 'profile'} language={onboarding?.language || 'uz'} />
      <InstallPromptModal />
      <AppTour 
        isOpen={showTour} 
        onClose={() => setShowTour(false)} 
        language={onboarding?.language || 'uz'}
        onNavigateScreen={setActiveScreen}
      />

      {isPinLocked && (
        <PinLockScreen
          language={onboarding?.language || 'uz'}
          onUnlock={() => setIsPinLocked(false)}
          onReset={() => {
            if (window.confirm(onboarding?.language === 'ru' ? "Сбросить PIN-код и войти заново?" : "PIN-kodni qayta tiklash uchun tizimdan chiqib, Telegram orqali qayta kirasizmi?")) {
              setIsPinLocked(false)
              logout()
              localStorage.removeItem('user_onboarding_completed_v1')
              setStage('login')
            }
          }}
        />
      )}
    </div>
  )
}
