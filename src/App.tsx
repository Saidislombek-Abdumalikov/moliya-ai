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
import { useFinance, isTelegramMiniApp, isValidPhoneNumber } from './FinanceContext'
import WebLoginScreen from './components/WebLoginScreen'
import InstallPromptModal from './components/InstallPromptModal'
import OfflineStatusBanner from './components/OfflineStatusBanner'

export type Screen = 'home' | 'calendar' | 'analytics' | 'profile'
type Stage = 'onboarding' | 'app'

export default function App() {
  const { onboarding, updateOnboarding, setHasSampleData, logout, isAuthReady, userId, authError } = useFinance()

  const getInitialStage = (): Stage => {
    try {
      const currentUserId = localStorage.getItem('user_id_v1');
      const userKey = currentUserId ? `user_onboarding_completed_${currentUserId}` : 'user_onboarding_completed_v1';
      const isOnboarded = localStorage.getItem(userKey) === 'true';
      if (isOnboarded) {
        return 'app';
      }
      return 'onboarding';
    } catch {
      return 'onboarding';
    }
  };

  const [showTour, setShowTour] = useState(false);
  const [stage, setStage] = useState<Stage>(getInitialStage);
  const [activeScreen, setActiveScreen] = useState<Screen>('home');
  const [authWaitTimeout, setAuthWaitTimeout] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setAuthWaitTimeout(true);
    }, 6000);
    return () => clearTimeout(timer);
  }, []);

  // ═══════════════════════════════════════════════════════════
  // ALL HOOKS MUST BE BEFORE ANY CONDITIONAL RETURNS
  // React requires hooks to be called in the same order every render.
  // Placing useEffect after if/return causes "Rendered more hooks" crash.
  // ═══════════════════════════════════════════════════════════

  // Determine stage ONLY after auth check completes
  useEffect(() => {
    if (!isAuthReady) return;
    
    const currentUserId = userId || localStorage.getItem('user_id_v1');
    const userKey = currentUserId ? `user_onboarding_completed_${currentUserId}` : 'user_onboarding_completed_v1';

    // Strict registration check: requires valid phone, accepted oferta, and completed flag
    const hasValidPhone = Boolean(
      onboarding?.phone && isValidPhoneNumber(onboarding.phone)
    );
    const hasAcceptedOferta = Boolean(
      onboarding?.oferta_accepted === true ||
      (onboarding as any)?.privacy_consent?.accepted === true
    );
    const isDbRegistered = Boolean(hasValidPhone && hasAcceptedOferta && onboarding?.completed === true);

    let isOnboarded = false;
    if (onboarding && (onboarding.phone || onboarding.completed !== undefined)) {
      isOnboarded = isDbRegistered;
      if (!isOnboarded) {
        localStorage.removeItem(userKey);
        localStorage.removeItem('user_onboarding_completed_v1');
      }
    } else {
      isOnboarded = localStorage.getItem(userKey) === 'true';
    }

    if (isOnboarded) {
      setStage('app');
    } else {
      setStage('onboarding');
    }
  }, [isAuthReady, userId, onboarding]);

  // Trigger tour on first visit to main page (DB flag takes priority for fresh registration)
  useEffect(() => {
    if (stage !== 'app') return;
    const tourSeen = localStorage.getItem('user_tour_completed_v2') === 'true';
    const dbTourDone = onboarding?.tour_completed === true;

    // Show tour if user has not completed the tour in DB or locally
    if (onboarding && onboarding.tour_completed !== true) {
      setShowTour(true);
    } else if (!tourSeen && !dbTourDone) {
      setShowTour(true);
    }
  }, [stage, onboarding?.tour_completed]);

  // Auto-transition to app/onboarding when user gets authenticated or logs out
  useEffect(() => {
    const checkLoggedIn = () => {
      const currentUserId = userId || localStorage.getItem('user_id_v1');
      const userKey = currentUserId ? `user_onboarding_completed_${currentUserId}` : 'user_onboarding_completed_v1';

      const hasValidPhone = Boolean(
        onboarding?.phone && isValidPhoneNumber(onboarding.phone)
      );
      const hasAcceptedOferta = Boolean(
        onboarding?.oferta_accepted === true ||
        (onboarding as any)?.privacy_consent?.accepted === true
      );
      const isDbRegistered = Boolean(hasValidPhone && hasAcceptedOferta && onboarding?.completed === true);

      let isOnboarded = false;
      if (onboarding && (onboarding.phone || onboarding.completed !== undefined)) {
        isOnboarded = isDbRegistered;
        if (!isOnboarded) {
          localStorage.removeItem(userKey);
          localStorage.removeItem('user_onboarding_completed_v1');
        }
      } else {
        isOnboarded = localStorage.getItem(userKey) === 'true';
      }

      if (isOnboarded) {
        setStage('app');
      } else if (isAuthReady) {
        setStage('onboarding');
      }
    };
    window.addEventListener('storage', checkLoggedIn);
    window.addEventListener('user_logged_in_updated', checkLoggedIn);
    return () => {
      window.removeEventListener('storage', checkLoggedIn);
      window.removeEventListener('user_logged_in_updated', checkLoggedIn);
    };
  }, [isAuthReady, userId, onboarding]);

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

  // 1. Wait until Telegram WebApp / Auth initialization completes
  if (!isAuthReady) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#FAF8FE] text-[#1E1A3C] p-6 text-center select-none font-sans">
        <div className="w-12 h-12 border-4 border-[#DDD6FE] border-t-[#7C3AED] rounded-full animate-spin mb-4" />
        <p className="text-sm text-[#64748B] font-medium">Moliya AI yuklanmoqda...</p>
        {authWaitTimeout && (
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 rounded-xl bg-white border border-[#DDD6FE] text-[#7C3AED] text-xs font-bold shadow-sm active:scale-95 transition cursor-pointer"
          >
            Qayta yuklash 🔄
          </button>
        )}
      </div>
    );
  }

  // 2. Auth error screen (shown if account is restricted or registration needed)
  if (authError) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#FAF8FE] text-[#1E1A3C] p-6 text-center select-none font-sans">
        <div className="w-20 h-20 mb-5 rounded-3xl bg-purple-50 border border-purple-200 flex items-center justify-center text-3xl shadow-lg shadow-purple-500/10">
          🔒
        </div>
        <h2 className="text-xl font-bold text-[#1A1538] mb-2">Kirish talab etiladi</h2>
        <p className="text-[#64748B] text-sm max-w-xs leading-relaxed mb-6">
          {authError}
        </p>
        <button
          onClick={() => {
            const tg = (window as any).Telegram?.WebApp;
            if (tg?.close) {
              tg.close();
            } else {
              window.location.href = 'https://t.me/moliya_v2bot';
            }
          }}
          className="px-6 py-3.5 rounded-2xl bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] text-white font-bold text-sm shadow-lg shadow-purple-500/25 active:scale-95 transition cursor-pointer"
        >
          Telegram Botga Qaytish ✈️
        </button>
      </div>
    );
  }

  // 3. Web App Authentication Gate: If outside Telegram and user is not authenticated, show WebLoginScreen
  if (!isTelegramMiniApp() && !userId) {
    return <WebLoginScreen />;
  }

  // 4. Telegram Mini App Loading: If inside Telegram Mini App but user ID hasn't loaded yet
  if (isTelegramMiniApp() && !userId) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#FAF8FE] text-[#1E1A3C] p-6 text-center select-none font-sans">
        {authWaitTimeout ? (
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center text-3xl mb-4">
              📱
            </div>
            <h3 className="text-base font-bold text-[#1E1A3C] mb-1">Telegram hisobi yuklanmadi</h3>
            <p className="text-xs text-[#64748B] max-w-xs mb-5">
              Aloqa sifatini tekshiring yoki sahifani qayta yuklang.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-xl bg-[#7C3AED] text-white font-bold text-xs shadow-md active:scale-95 transition cursor-pointer"
            >
              Qayta yuklash 🔄
            </button>
          </div>
        ) : (
          <>
            <div className="w-12 h-12 border-4 border-[#DDD6FE] border-t-[#7C3AED] rounded-full animate-spin mb-4" />
            <p className="text-sm text-[#64748B] font-medium">Telegram hisobi yuklanmoqda...</p>
          </>
        )}
      </div>
    );
  }

  if (stage === 'onboarding') {
    return (
      <Onboarding
        onComplete={(result) => {
          localStorage.setItem('user_onboarding_completed_v1', 'true')
          updateOnboarding(result)
          setHasSampleData(false)
          setStage('app')
          setShowTour(true)
        }}
      />
    )
  }

  return (
    <div
      className="app-container"
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
                  window.location.href = 'https://t.me/moliya_v2bot';
                }
              }}
              onStartTour={() => setShowTour(true)}
            />
          )}
        </motion.div>
      </AnimatePresence>

      <BottomNav active={activeScreen} onChange={setActiveScreen} language={onboarding?.language} />
      <AIButton visible={activeScreen !== 'profile'} language={onboarding?.language || 'uz'} />
      {!isTelegramMiniApp() && <InstallPromptModal />}
      <AppTour 
        isOpen={showTour} 
        onClose={() => {
          setShowTour(false);
          localStorage.setItem('user_tour_completed_v2', 'true');
          updateOnboarding({ tour_completed: true });
        }} 
        language={onboarding?.language || 'uz'}
        onNavigateScreen={setActiveScreen}
      />
    </div>
  )
}
