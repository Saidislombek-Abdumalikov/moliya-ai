import { useState, useRef, useEffect } from 'react'
import { motion } from 'motion/react'
import { useFinance } from '../FinanceContext'
import { openTelegramBot, isNativePlatform } from '../utils/nativeBridge'

interface Props {
  onLoginSuccess: (isNewUser: boolean) => void
}

export default function LoginScreen({ onLoginSuccess }: Props) {
  const { verifyTelegramCode, startTelegramLogin } = useFinance()

  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', ''])
  const [otpError, setOtpError] = useState<string | null>(null)
  const [isVerifyingOtp, setIsVerifyingOtp] = useState<boolean>(false)
  const [isWaitingWebAuth, setIsWaitingWebAuth] = useState<boolean>(false)
  const [timerSeconds, setTimerSeconds] = useState<number | null>(null)
  const otpInputsRef = useRef<(HTMLInputElement | null)[]>([])

  // Live OTP expiration countdown timer (10 minutes matching backend lifetime)
  useEffect(() => {
    if (timerSeconds === null || timerSeconds <= 0) return

    const interval = setInterval(() => {
      setTimerSeconds((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [timerSeconds])

  const formatTimer = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  const handleOtpChange = (index: number, value: string) => {
    if (otpError) setOtpError(null)
    const digit = value.replace(/\D/g, '').slice(-1)
    const newDigits = [...otpDigits]
    newDigits[index] = digit
    setOtpDigits(newDigits)

    if (digit && index < 5) {
      otpInputsRef.current[index + 1]?.focus()
    }

    const fullCode = newDigits.join('')
    if (fullCode.length === 6 && !newDigits.includes('')) {
      submitOtpCode(fullCode)
    }
  }

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpInputsRef.current[index - 1]?.focus()
    }
  }

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!pasted) return
    const newDigits = ['', '', '', '', '', '']
    for (let i = 0; i < pasted.length; i++) {
      newDigits[i] = pasted[i]
    }
    setOtpDigits(newDigits)
    const nextFocusIdx = Math.min(pasted.length, 5)
    otpInputsRef.current[nextFocusIdx]?.focus()
    if (pasted.length === 6) {
      submitOtpCode(pasted)
    }
  }

  const submitOtpCode = async (code: string) => {
    if (code.length !== 6) {
      setOtpError("Kod 6 ta raqamdan iborat bo'lishi kerak.")
      return
    }
    setIsVerifyingOtp(true)
    setOtpError(null)
    try {
      const result = await verifyTelegramCode(code)
      if (result.success) {
        onLoginSuccess(Boolean(result.isNewUser))
      } else {
        setOtpError(result.error || "Kiritilgan kod noto'g'ri. Qayta urinib ko'ring.")
      }
    } catch (err: any) {
      setOtpError(err.message || "Server bilan bog'lanishda xatolik yuz berdi.")
    } finally {
      setIsVerifyingOtp(false)
    }
  }

  const handleGetCode = () => {
    if (otpError) setOtpError(null)
    setOtpDigits(['', '', '', '', '', ''])
    // Start 10-minute real expiration timer
    setTimerSeconds(600)
    openTelegramBot('apk')
    setTimeout(() => {
      otpInputsRef.current[0]?.focus()
    }, 500)
  }

  const handleWebInstantLogin = async () => {
    setIsWaitingWebAuth(true)
    setOtpError(null)
    try {
      await startTelegramLogin(() => {
        onLoginSuccess(false)
      })
    } catch (e: any) {
      console.error('Error during web instant login:', e)
      setIsWaitingWebAuth(false)
    }
  }

  const fullOtp = otpDigits.join('')
  const isExpired = timerSeconds === 0

  return (
    <div
      style={{
        minHeight: '100dvh',
        maxWidth: 430,
        margin: '0 auto',
        background: 'linear-gradient(180deg, #F7F5FF 0%, #EFEBFF 100%)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '24px 20px',
        boxSizing: 'border-box'
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        style={{
          background: '#FFFFFF',
          borderRadius: 24,
          padding: '28px 22px',
          boxShadow: '0 12px 36px rgba(124, 58, 237, 0.12)',
          border: '1px solid rgba(124, 58, 237, 0.1)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center'
        }}
      >
        {/* Brand Logo */}
        <div style={{ marginBottom: 14 }}>
          <img
            src="/logo.png"
            alt="Moliya AI"
            style={{
              width: 72,
              height: 72,
              borderRadius: 20,
              objectFit: 'cover',
              boxShadow: '0 8px 24px rgba(124, 58, 237, 0.25)',
              border: '2px solid rgba(124, 58, 237, 0.15)',
              display: 'block'
            }}
          />
        </div>

        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1E1A3C', margin: '0 0 4px', letterSpacing: -0.5 }}>
          Moliya AI
        </h1>
        <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 20px', lineHeight: 1.4 }}>
          Pulingizni oson va aqlli boshqaring
        </p>

        {/* Single Unified Action: Telegram Code Request */}
        <button
          onClick={handleGetCode}
          style={{
            width: '100%',
            padding: '14px 18px',
            borderRadius: 16,
            border: 'none',
            background: isExpired
              ? 'linear-gradient(135deg, #DC2626 0%, #B91C1C 100%)'
              : 'linear-gradient(135deg, #0088CC 0%, #0077B5 100%)',
            color: '#FFFFFF',
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            boxShadow: isExpired
              ? '0 6px 20px rgba(220, 38, 38, 0.3)'
              : '0 6px 20px rgba(0, 136, 204, 0.3)',
            marginBottom: 16,
            transition: 'all 0.15s ease',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .37z" />
          </svg>
          {isExpired
            ? "🔄 Yangi kod olish (Telegram)"
            : timerSeconds !== null
            ? "📱 Telegram botga o'tish"
            : "Telegram orqali kod olish"}
        </button>

        {/* Live Expiration Timer Display */}
        {timerSeconds !== null && (
          <div style={{ marginBottom: 14 }}>
            {isExpired ? (
              <span style={{ fontSize: 12.5, fontWeight: 700, color: '#DC2626' }}>
                ⚠️ Kod muddati tugadi. Yangi kod oling.
              </span>
            ) : (
              <span style={{ fontSize: 12.5, fontWeight: 600, color: '#6B7280' }}>
                ⏳ Kod amal qilish muddati: <b style={{ color: '#7C3AED' }}>{formatTimer(timerSeconds)}</b>
              </span>
            )}
          </div>
        )}

        {/* 6-digit Code Input Section */}
        <div style={{ width: '100%', marginBottom: 18 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#374151', margin: '0 0 10px', textAlign: 'center' }}>
            6 xonali tasdiqlash kodini kiriting:
          </p>

          <div
            style={{
              display: 'flex',
              gap: 8,
              justifyContent: 'center',
              direction: 'ltr',
            }}
            onPaste={handleOtpPaste}
          >
            {otpDigits.map((digit, idx) => (
              <input
                key={idx}
                ref={(el) => { otpInputsRef.current[idx] = el }}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                maxLength={1}
                value={digit}
                onChange={(e) => handleOtpChange(idx, e.target.value)}
                onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                style={{
                  width: 44,
                  height: 52,
                  borderRadius: 12,
                  border: otpError ? '2px solid #EF4444' : digit ? '2px solid #7C3AED' : '1.5px solid #E5E7EB',
                  background: digit ? '#F5F3FF' : '#F9FAFB',
                  fontSize: 22,
                  fontWeight: 800,
                  color: '#1E1A3C',
                  textAlign: 'center',
                  outline: 'none',
                  transition: 'all 0.15s ease',
                  boxShadow: digit ? '0 2px 8px rgba(124, 58, 237, 0.15)' : 'none',
                }}
              />
            ))}
          </div>

          {/* Error Message */}
          {otpError && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                marginTop: 10,
                fontSize: 12.5,
                color: '#DC2626',
                fontWeight: 600,
                textAlign: 'center',
                background: '#FEF2F2',
                padding: '8px 12px',
                borderRadius: 10,
                border: '1px solid #FEE2E2',
              }}
            >
              ⚠️ {otpError}
            </motion.div>
          )}
        </div>

        {/* Submit Verification Button */}
        <button
          onClick={() => submitOtpCode(fullOtp)}
          disabled={fullOtp.length !== 6 || isVerifyingOtp || isExpired}
          style={{
            width: '100%',
            padding: '14px 18px',
            borderRadius: 16,
            border: 'none',
            background: fullOtp.length === 6 && !isVerifyingOtp && !isExpired
              ? 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)'
              : '#E5E7EB',
            color: fullOtp.length === 6 && !isVerifyingOtp && !isExpired ? '#FFFFFF' : '#9CA3AF',
            fontSize: 15,
            fontWeight: 700,
            cursor: fullOtp.length === 6 && !isVerifyingOtp && !isExpired ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            boxShadow: fullOtp.length === 6 && !isExpired ? '0 6px 20px rgba(124, 58, 237, 0.25)' : 'none',
            transition: 'all 0.15s ease',
            marginBottom: 8,
          }}
        >
          {isVerifyingOtp ? (
            <span>Tekshirilmoqda...</span>
          ) : (
            <span>Tasdiqlash va kirish →</span>
          )}
        </button>

        {/* Web browser instant QR / automatic fallback */}
        {!isNativePlatform() && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #F3F4F6', width: '100%' }}>
            <button
              onClick={handleWebInstantLogin}
              disabled={isWaitingWebAuth}
              style={{
                background: 'none',
                border: 'none',
                color: '#6B7280',
                fontSize: 12.5,
                fontWeight: 500,
                cursor: 'pointer',
                padding: '4px 8px',
              }}
            >
              {isWaitingWebAuth ? '⏳ Telegram tasdiqlanishi kutilmoqda...' : "🌐 Brauzerda avtomatik kirish"}
            </button>
          </div>
        )}
      </motion.div>
    </div>
  )
}
