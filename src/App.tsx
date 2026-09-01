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
type Stage = 'onboarding' | 'app'

export default function App() {
  const { onboarding, updateOnboarding, setHasSampleData, logout, isAuthReady, userId, authError } = useFinance()

  const getInitialStage = (): Stage => {
    try {
      const isOnboarded = localStorage.getItem('user_onboarding_completed_v1') === 'true'
      const isLoggedIn = localStorage.getItem('user_logged_in_v1') === 'true'
      if (isOnboarded || isLoggedIn) {
        return 'app'
      }
      return 'onboarding'
    } catch {
      return 'onboarding'
    }
  }

  const [showTour, setShowTour] = useState(false)
  const [stage, setStage] = useState<Stage>(getInitialStage)
  const [activeScreen, setActiveScreen] = useState<Screen>('home')

  // ═══════════════════════════════════════════════════════════
  // ALL HOOKS MUST BE BEFORE ANY CONDITIONAL RETURNS
  // React requires hooks to be called in the same order every render.
  // Placing useEffect after if/return causes "Rendered more hooks" crash.
  // ═══════════════════════════════════════════════════════════

  // Determine stage ONLY after auth check completes
  useEffect(() => {
    if (!isAuthReady) return

    const isOnboarded = localStorage.getItem('user_onboarding_completed_v1') === 'true'
    const isLoggedIn = Boolean(userId || localStorage.getItem('user_logged_in_v1') === 'true')

    if (isOnboarded || isLoggedIn) {
      setStage('app')
    } else {
      setStage('onboarding')
    }
  }, [isAuthReady, userId])

  // Trigger tour on first visit to main page
  useEffect(() => {
    const tourSeen = localStorage.getItem('user_tour_completed_v2')
    if (!tourSeen && stage === 'app') {
      setShowTour(true)
    }
  }, [stage])

  // Auto-transition to app/onboarding when user gets authenticated or logs out
  useEffect(() => {
    const checkLoggedIn = () => {
      const isOnboarded = localStorage.getItem('user_onboarding_completed_v1') === 'true'
      const isLoggedIn = localStorage.getItem('user_logged_in_v1') === 'true'
      if (isOnboarded || isLoggedIn) {
        setStage('app')
      } else if (isAuthReady) {
        setStage('onboarding')
      }
    }
    window.addEventListener('storage', checkLoggedIn)
    window.addEventListener('user_logged_in_updated', checkLoggedIn)
    return () => {
      window.removeEventListener('storage', checkLoggedIn)
      window.removeEventListener('user_logged_in_updated', checkLoggedIn)
    }
  }, [isAuthReady])

  // If onboarding is null and user is authenticated, set clean defaults
  useEffect(() => {
    if (stage === 'app' && !onboarding) {
      updateOnboarding({
        name: '',
        phone: '',
        telegram: '',
        language: 'uz',
        monthlyIncome: 0,
        monthlyGoal: 0,
        isPremium: false
      })
    }
  }, [stage, onboarding, updateOnboarding])

  // Telegram Mini App viewport initialization & auto-expand
  // CRITICAL: This MUST be before conditional returns to avoid hooks violation
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

  // ═══════════════════════════════════════════════════════════
  // CONDITIONAL RENDERS — all hooks are above this line
  // ═══════════════════════════════════════════════════════════


  if (authError) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0F172A] text-white p-6 text-center select-none">
        <div className="w-20 h-20 mb-6 rounded-3xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-3xl shadow-xl shadow-indigo-500/10">
          🔒
        </div>
        <h2 className="text-xl font-bold text-slate-100 mb-2">Kirish talab etiladi</h2>
        <p className="text-slate-400 text-sm max-w-xs leading-relaxed mb-6">
          {authError}
        </p>
        <button
          onClick={() => {
            const tg = (window as any).Telegram?.WebApp;
            if (tg?.close) {
              tg.close();
            } else {
              window.location.href = 'https://t.me/MoliyaAI_Bot';
            }
          }}
          className="px-6 py-3.5 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-bold text-sm shadow-lg shadow-indigo-500/25 active:scale-95 transition"
        >
          Telegram Botga Qaytish ✈️
        </button>
      </div>
    );
  }

  if (stage === 'onboarding') {
    return (
      <Onboarding
        onComplete={(result) => {
          updateOnboarding(result)
          setHasSampleData(false)
          localStorage.setItem('user_onboarding_completed_v1', 'true')
          window.dispatchEvent(new Event('user_logged_in_updated'))
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
                const tg = (window as any).Telegram?.WebApp;
                if (tg?.close) {
                  tg.close();
                } else {
                  window.location.href = 'https://t.me/MoliyaAI_Bot';
                }
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
