import { registrationReady, tourDone, tourKey } from './clientSession'
import { telegramBotLink } from './telegramLinks'
import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import Onboarding from './components/Onboarding'
import HomeScreen from './components/HomeScreen'
import BottomNav from './components/BottomNav'
import { useFinance, isTelegramMiniApp, isValidPhoneNumber } from './FinanceContext'
import InstallPromptModal from './components/InstallPromptModal'
import OfflineStatusBanner from './components/OfflineStatusBanner'
import { configureTelegramViewport, keepTelegramSwipesDisabled, waitForTelegramSdk } from './telegramViewport'

const CalendarScreen = lazy(() => import('./components/CalendarScreen'))
const AnalyticsScreen = lazy(() => import('./components/AnalyticsScreen'))
const ProfileScreen = lazy(() => import('./components/ProfileScreen'))
const AppTour = lazy(() => import('./components/AppTour'))
const AIButton = lazy(() => import('./components/AIButton'))
const WebLoginScreen = lazy(() => import('./components/WebLoginScreen'))

export type Screen = 'home' | 'calendar' | 'analytics' | 'profile'

export default function App() {
  const { onboarding, updateOnboarding, logout, isAuthReady, userId, authError } = useFinance()

  const [showTour, setShowTour] = useState(false);
  const dismissedTourFor = useRef<string | null>(null);
  const [activeScreen, setActiveScreen] = useState<Screen>('home');
  const [authWaitTimeout, setAuthWaitTimeout] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setAuthWaitTimeout(true);
    }, 16000);
    return () => clearTimeout(timer);
  }, []);

  // ═══════════════════════════════════════════════════════════
  // ALL HOOKS MUST BE BEFORE ANY CONDITIONAL RETURNS
  // React requires hooks to be called in the same order every render.
  // Placing useEffect after if/return causes "Rendered more hooks" crash.
  // ═══════════════════════════════════════════════════════════

  // Bot verification comes from the authenticated server response, never a local flag.
  const registered = registrationReady(userId, onboarding,
    Boolean(onboarding?.phone && isValidPhoneNumber(onboarding.phone)));

  useEffect(() => {
    setShowTour(registered && !!userId && dismissedTourFor.current !== userId &&
      !tourDone(localStorage, userId, onboarding?.tour_completed === true));
  }, [registered, userId, onboarding?.tour_completed]);

  // Telegram Mini App viewport initialization & auto-expand
  // CRITICAL: This MUST be before conditional returns to avoid hooks violation
  useEffect(() => {
    let active = true;
    let removeSwipeGuard = () => {};
    void waitForTelegramSdk(() => (window as any).Telegram?.WebApp).then(tg => {
      if (active && tg?.initData) {
        configureTelegramViewport(tg);
        removeSwipeGuard = keepTelegramSwipesDisabled(tg);
      }
    });
    return () => { active = false; removeSwipeGuard(); };
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
        <button onClick={() => window.location.reload()} className="mb-4 px-5 py-2 rounded-xl border border-purple-200 text-purple-700">
          Qayta yuklash
        </button>
        <button
          onClick={() => {
            const tg = (window as any).Telegram?.WebApp;
            if (tg?.close) {
              tg.close();
            } else {
              window.location.href = telegramBotLink();
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
    return <Suspense fallback={<div className="min-h-dvh bg-[#FAF8FE]" />}><WebLoginScreen /></Suspense>;
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

  if (!registered) return <Onboarding />

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
          <Suspense fallback={<div className="flex justify-center pt-12 text-sm text-[#64748B]">{
            onboarding?.language === 'uz_cyrl' ? 'Юкланмоқда…' :
            onboarding?.language === 'ru' ? 'Загрузка…' :
            onboarding?.language === 'en' ? 'Loading…' : 'Yuklanmoqda…'
          }</div>}>
            {activeScreen === 'home' && <HomeScreen onboarding={onboarding} onUpdateOnboarding={updateOnboarding} />}
            {activeScreen === 'calendar' && <CalendarScreen onboarding={onboarding} />}
            {activeScreen === 'analytics' && <AnalyticsScreen onboarding={onboarding} onUpdateOnboarding={updateOnboarding} />}
            {activeScreen === 'profile' && (
              <ProfileScreen
                onLogout={() => {
                  logout()
                  setActiveScreen('home')
                }}
                onboarding={onboarding}
                onUpdateOnboarding={updateOnboarding}
                onClearData={() => {
                  logout()
                  setActiveScreen('home')
                  const tg = (window as any).Telegram?.WebApp;
                  if (tg?.close) {
                    tg.close();
                  } else {
                    window.location.href = telegramBotLink();
                  }
                }}
                onStartTour={() => setShowTour(true)}
              />
            )}
          </Suspense>
        </motion.div>
      </AnimatePresence>

      <BottomNav active={activeScreen} onChange={setActiveScreen} language={onboarding?.language} />
      <Suspense fallback={null}><AIButton visible={activeScreen !== 'profile'} language={onboarding?.language || 'uz'} /></Suspense>
      {!isTelegramMiniApp() && <InstallPromptModal />}
      {showTour && <Suspense fallback={null}><AppTour
        isOpen={showTour} 
        onClose={() => {
          setShowTour(false);
          if (userId) {
            dismissedTourFor.current = userId;
            localStorage.setItem(tourKey(userId), 'true');
          }
          // Keep dismissal on this device even when preference sync is offline.
          void updateOnboarding({ tour_completed: true }).catch(() => {});
        }} 
        language={onboarding?.language || 'uz'}
        onNavigateScreen={setActiveScreen}
      /></Suspense>}
    </div>
  )
}
