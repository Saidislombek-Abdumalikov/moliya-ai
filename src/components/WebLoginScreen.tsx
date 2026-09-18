import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useFinance } from '../FinanceContext';

export default function WebLoginScreen() {
  const { startTelegramLogin, userId } = useFinance();
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(() => {
    return localStorage.getItem('moliya_pending_request_id');
  });
  const [loginError, setLoginError] = useState<string | null>(null);

  // If already logged in, this screen won't be rendered anyway, but keep safety guard
  if (userId) return null;

  useEffect(() => {
    // Resume waiting if there's already a pending request
    const pending = localStorage.getItem('moliya_pending_request_id');
    if (pending) {
      setIsLoggingIn(true);
      setCurrentRequestId(pending);
    }
  }, []);

  const handleStartLogin = async () => {
    try {
      setLoginError(null);
      setIsLoggingIn(true);
      const res = await startTelegramLogin(() => {
        setIsLoggingIn(false);
      });
      if (res?.requestId) {
        setCurrentRequestId(res.requestId);
      }
    } catch (err: any) {
      console.error('[WEB_LOGIN] Error initiating login:', err);
      setLoginError('Kirish jarayonida xatolik yuz berdi. Iltimos, qayta urinib ko\'ring.');
      setIsLoggingIn(false);
    }
  };

  const handleCancelLogin = () => {
    localStorage.removeItem('moliya_pending_request_id');
    setIsLoggingIn(false);
    setCurrentRequestId(null);
  };

  const botDeepLink = currentRequestId
    ? `tg://resolve?domain=moliya_v2bot&start=req_${currentRequestId}`
    : 'https://t.me/moliya_v2bot?start=open';

  const botWebUrl = currentRequestId
    ? `https://t.me/moliya_v2bot?start=req_${currentRequestId}`
    : 'https://t.me/moliya_v2bot?start=open';

  // High-res QR code link using universal QR image generator
  const qrCodeUrl = currentRequestId
    ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(botWebUrl)}&color=7C3AED&bgcolor=FAF8FE`
    : null;

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
              Shaxsiy va oilaviy byudjetingizni sun'iy intellekt bilan aqlli va oson boshqaring.
            </p>

            {/* Features Highlight Card */}
            <div className="w-full bg-white rounded-2xl border border-[#ECE7F6] p-4 mb-6 shadow-sm text-left flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-[#F4EFFC] text-[#7C3AED] flex items-center justify-center font-bold text-sm">
                  ⚡️
                </div>
                <div className="flex-1">
                  <p className="text-xs font-bold text-[#1A1538]">Tezkor AI yozuv</p>
                  <p className="text-[11px] text-[#766E9E]">"400$ tushlik" yoki ovozli xabar — 1 soniyada</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-[#F4EFFC] text-[#7C3AED] flex items-center justify-center font-bold text-sm">
                  💳
                </div>
                <div className="flex-1">
                  <p className="text-xs font-bold text-[#1A1538]">Kartalar va Balans</p>
                  <p className="text-[11px] text-[#766E9E]">Barcha xarajatlar va hisobotlar yagona joyda</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-[#F4EFFC] text-[#7C3AED] flex items-center justify-center font-bold text-sm">
                  🔒
                </div>
                <div className="flex-1">
                  <p className="text-xs font-bold text-[#1A1538]">100% Xavfsiz Sinxronizatsiya</p>
                  <p className="text-[11px] text-[#766E9E]">Telegram hisobingiz bilan shifrlangan himoya</p>
                </div>
              </div>
            </div>

            {loginError && (
              <div className="w-full mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                {loginError}
              </div>
            )}

            {/* Primary Action: Telegram Login */}
            <div className="w-full flex flex-col gap-3">
              <button
                onClick={handleStartLogin}
                className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] text-white font-bold text-base shadow-lg shadow-purple-500/25 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Telegram orqali xavfsiz kirish</span>
                <span className="text-lg">🚀</span>
              </button>
            </div>

            <p className="text-[11px] text-[#94A3B8] mt-6 max-w-xs leading-normal">
              🔒 Ruxsatsiz yoki soxta hisob yaratish bloklangan. Ma'lumotlaringiz faqat rasmiy Telegram botimiz orqali himoyalanadi.
            </p>
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
              Telegram botimiz ochildi. Profilingizni ochish uchun botda <span className="font-semibold text-[#7C3AED]">"Boshlash" (Start)</span> tugmasini bosing.
            </p>

            {/* QR Code for Desktop Users */}
            {qrCodeUrl && (
              <div className="hidden sm:flex flex-col items-center bg-white p-4 rounded-2xl border border-[#ECE7F6] shadow-sm mb-5">
                <img
                  src={qrCodeUrl}
                  alt="Telegram Login QR Code"
                  className="w-40 h-40 rounded-xl"
                />
                <p className="text-[11px] text-[#766E9E] mt-2 font-medium">
                  Kamerangiz orqali skanerlang
                </p>
              </div>
            )}

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
              <span>Sinxronizatsiya faol</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
