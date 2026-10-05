import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import QRCode from 'qrcode';
import { useFinance } from '../FinanceContext';
import { telegramBotLink } from '../telegramLinks';

export default function WebLoginScreen() {
  const { startTelegramLogin, resumeTelegramLogin, cancelTelegramLogin, userId, authError } = useFinance();
  const stopPolling = useRef<(() => void) | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(() => {
    const saved = localStorage.getItem('moliya_pending_request_id');
    const savedTime = localStorage.getItem('moliya_pending_request_time');
    if (saved && savedTime && Date.now() - parseInt(savedTime, 10) > 5 * 60 * 1000) {
      localStorage.removeItem('moliya_pending_request_id');
      localStorage.removeItem('moliya_pending_request_time');
      return null;
    }
    return saved;
  });
  const [loginError, setLoginError] = useState<string | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);

  useEffect(() => {
    // Resume waiting ONLY if there's a recent pending request (less than 5 minutes old)
    const pending = localStorage.getItem('moliya_pending_request_id');
    const savedTime = localStorage.getItem('moliya_pending_request_time');
    if (pending && savedTime) {
      const isExpired = Date.now() - parseInt(savedTime, 10) > 5 * 60 * 1000;
      if (isExpired) {
        localStorage.removeItem('moliya_pending_request_id');
        localStorage.removeItem('moliya_pending_request_time');
        setIsLoggingIn(false);
        setCurrentRequestId(null);
      } else {
        setIsLoggingIn(true);
        setCurrentRequestId(pending);
      }
    }
  }, []);

  // A mobile return or page reload must resume checking the saved request.
  useEffect(() => {
    if (!currentRequestId) return;
    const stop = resumeTelegramLogin(currentRequestId,
      () => setIsLoggingIn(false),
      () => { setCurrentRequestId(null); setIsLoggingIn(false); });
    stopPolling.current = stop;
    return () => { stop(); if (stopPolling.current === stop) stopPolling.current = null; };
  // The request ID controls the polling lifetime; the context callback is recreated on render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRequestId]);

  // Generate QR code locally on client side to preserve privacy and eliminate third-party leaks
  useEffect(() => {
    if (!currentRequestId) {
      setQrCodeDataUrl(null);
      return;
    }

    const botWebUrl = telegramBotLink(`req_${currentRequestId}`);
    let isCancelled = false;

    QRCode.toDataURL(botWebUrl, {
      width: 220,
      margin: 1,
      color: {
        dark: '#7C3AED',
        light: '#FAF8FE',
      },
    })
      .then((url) => {
        if (!isCancelled) {
          setQrCodeDataUrl(url);
        }
      })
      .catch((err) => {
        console.error('[WEB_LOGIN] Failed to generate local QR code:', err);
      });

    return () => {
      isCancelled = true;
    };
  }, [currentRequestId]);

  const handleStartLogin = async () => {
    try {
      setLoginError(null);
      setIsLoggingIn(true);
      const res = await startTelegramLogin();
      if (res?.requestId) {
        setCurrentRequestId(res.requestId);
      }
    } catch (err: any) {
      console.error('[WEB_LOGIN] Error initiating login:', err);
      setLoginError('Kirish jarayonida xatolik yuz berdi. Iltimos, qayta urinib ko\'ring.');
      setIsLoggingIn(false);
    }
  };

  const handleCancelLogin = async () => {
    if (!currentRequestId) return;
    try {
      await cancelTelegramLogin(currentRequestId);
      stopPolling.current?.();
      localStorage.removeItem('moliya_pending_request_id');
      localStorage.removeItem('moliya_pending_request_time');
      setIsLoggingIn(false);
      setCurrentRequestId(null);
      setQrCodeDataUrl(null);
    } catch (error) { setLoginError((error as Error).message); }
  };

  const botDeepLink = currentRequestId
    ? telegramBotLink(`req_${currentRequestId}`)
    : telegramBotLink('open');

  if (userId) return null;

  return (
    <div
      style={{
        position: 'relative',
        minHeight: '100dvh',
        width: '100%',
        maxWidth: 430,
        margin: '0 auto',
        background: '#FAF8FE',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 20px',
        boxSizing: 'border-box',
        fontFamily: "var(--font-sans, 'Plus Jakarta Sans', sans-serif)",
      }}
    >
      <AnimatePresence mode="wait">
        {!isLoggingIn ? (
          // ── IDLE / WELCOME STATE ────────────────────────────────────
          <motion.div
            key="idle"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.25 }}
            className="w-full flex flex-col items-center text-center"
          >
            {/* App Logo */}
            <div className="relative mb-5">
              <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-[#7C3AED] via-[#6D28D9] to-[#4C1D95] flex items-center justify-center text-4xl shadow-xl shadow-purple-500/25 border-2 border-white/60">
                💎
              </div>
              <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-emerald-500 border-2 border-white flex items-center justify-center text-white text-xs shadow-md">
                ✓
              </div>
            </div>

            {/* Title & Subtitle */}
            <h1 className="text-2xl font-black text-[#1A1538] tracking-tight mb-2">
              Moliya AI
            </h1>
            <p className="text-sm text-[#766E9E] max-w-xs leading-relaxed mb-6">
              Davom etish uchun Telegram orqali kiring.
            </p>

            {(loginError || authError) && <p role="alert" className="mb-4 text-sm text-rose-700">{loginError || authError}</p>}

            {/* Primary Action: Telegram Login */}
            <div className="w-full flex flex-col gap-3">
              <button
                onClick={handleStartLogin}
                className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] text-white font-bold text-base shadow-lg shadow-purple-500/25 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Telegram orqali kirish</span>
                <span className="text-lg">🚀</span>
              </button>
            </div>


          </motion.div>
        ) : (
          // ── AUTHENTICATING / POLLING STATE ──────────────────────────
          <motion.div
            key="authenticating"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.25 }}
            className="w-full flex flex-col items-center text-center"
          >
            {/* Spinning Indicator */}
            <div className="relative mb-5 flex items-center justify-center">
              <div className="w-20 h-20 rounded-full border-4 border-[#DDD6FE] border-t-[#7C3AED] animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center text-2xl">
                ✈️
              </div>
            </div>

            <h2 className="text-xl font-bold text-[#1A1538] mb-1">
              Telegramda tasdiqlash kutilmoqda
            </h2>
            <p className="text-xs text-[#766E9E] max-w-xs leading-relaxed mb-6">
              Botda <span className="font-semibold text-[#7C3AED]">"Boshlash" (Start)</span> tugmasini bosing va shu oynaga qayting.
            </p>

            {/* QR Code for Desktop Users */}
            {qrCodeDataUrl && (
              <div className="hidden sm:flex flex-col items-center bg-white p-4 rounded-2xl border border-[#ECE7F6] shadow-sm mb-5">
                <img
                  src={qrCodeDataUrl}
                  alt="Telegram Login QR Code"
                  className="w-40 h-40 rounded-xl"
                />
                <p className="text-[11px] text-[#766E9E] mt-2 font-medium">
                  Kamerangiz orqali skanerlang
                </p>
              </div>
            )}

            {loginError && <p role="alert" className="mb-3 text-sm text-rose-700">{loginError}</p>}
            {/* Action Buttons */}
            <div className="w-full flex flex-col gap-2.5 max-w-xs">
              <a
                href={botDeepLink}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3 px-4 rounded-xl bg-[#7C3AED] text-white font-bold text-sm shadow-md shadow-purple-500/20 active:scale-95 transition flex items-center justify-center gap-2"
              >
                <span>Telegram botni ochish</span>
                <span>↗</span>
              </a>

              <button
                onClick={handleCancelLogin}
                className="w-full py-2.5 px-4 rounded-xl bg-transparent text-[#766E9E] font-medium text-xs hover:bg-[#F4EFFC] active:scale-95 transition cursor-pointer"
              >
                Bekor qilish
              </button>
            </div>

            <div className="mt-6 flex items-center gap-2 text-emerald-600 text-xs font-semibold bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-200/60 animate-pulse">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>Tasdiqlash kutilmoqda</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
