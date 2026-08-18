import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import Onboarding from './components/Onboarding'
import HomeScreen from './components/HomeScreen'
import CalendarScreen from './components/CalendarScreen'
import AnalyticsScreen from './components/AnalyticsScreen'
import ProfileScreen from './components/ProfileScreen'
import BottomNav from './components/BottomNav'
import AIButton from './components/AIButton'
import AppTour from './components/AppTour'
import { useFinance } from './FinanceContext'

import InstallPromptModal from './components/InstallPromptModal'
import OfflineStatusBanner from './components/OfflineStatusBanner'

export type Screen = 'home' | 'calendar' | 'analytics' | 'profile'
type Stage = 'loading' | 'onboarding' | 'app'

export default function App() {
  const { onboarding, updateOnboarding, setHasSampleData, logout, isAuthReady, userId } = useFinance()

  const [showTour, setShowTour] = useState(false)

  // Stage is determined AFTER auth is ready — no more race conditions
  const [stage, setStage] = useState<Stage>('loading')

  const [activeScreen, setActiveScreen] = useState<Screen>('home')

  // Determine stage ONLY after auth check completes
  useEffect(() => {
    if (!isAuthReady) return

    if (userId || localStorage.getItem('user_logged_in_v1') === 'true') {
      setStage('app')
    } else {
      setStage('onboarding')
    }
  }, [isAuthReady, userId])

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
    window.addEventListener('storage', checkLoggedIn)
    window.addEventListener('user_logged_in_updated', checkLoggedIn)
    return () => {
      window.removeEventListener('storage', checkLoggedIn)
      window.removeEventListener('user_logged_in_updated', checkLoggedIn)
    }
  }, [])

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

  // Loading screen while auth is being checked — prevents flash of onboarding
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
          updateOnboarding(result)
          setHasSampleData(false)
          localStorage.setItem('user_logged_in_v1', 'true')
          setStage('app')
          setShowTour(true)
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
                setStage('onboarding')
                setActiveScreen('home')
              }}
              onboarding={onboarding}
              onUpdateOnboarding={updateOnboarding}
              onClearData={() => {
                logout()
                setStage('onboarding')
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
    </div>
  )
}
