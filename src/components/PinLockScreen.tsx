import { useState, useEffect, useRef } from 'react'

interface Props {
  language?: 'uz' | 'uz_cyrl' | 'ru' | 'en'
  onUnlock: () => void
  onReset: () => void
}

const translations = {
  uz: {
    title: "PIN-kodni kiriting",
    subtitle: "Ilovaga xavfsiz kirish uchun 4 xonali PIN-kodni kiriting",
    incorrect: "PIN-kod noto'g'ri, qayta urinib ko'ring",
    faceIdScan: "Biometriya / Face ID tekshirilmoqda...",
    faceIdSuccess: "Muvaffaqiyatli aniqlandi!",
    faceIdFail: "Aniqlanmadi, qayta urinib ko'ring",
    reset: "PIN-kodni unutdingizmi? (Qayta kirish)",
    forgot: "PIN-kodni unutdingizmi?",
    pasted: "Nusxalangan kod kiritildi",
  },
  uz_cyrl: {
    title: "PIN-кодни киритинг",
    subtitle: "Иловага хавфсиз кириш учун 4 хонали PIN-кодни киритинг",
    incorrect: "PIN-код нотўғри, қайта уриниб кўринг",
    faceIdScan: "Биометрия / Face ID текширилмоқда...",
    faceIdSuccess: "Муваффақиятли аниқланди!",
    faceIdFail: "Аниқланмади, қайта уриниб кўринг",
    reset: "PIN-кодни унутдингизми? (Қайта кириш)",
    forgot: "PIN-кодни унутдингизми?",
    pasted: "Нусхаланган код киритилди",
  },
  ru: {
    title: "Введите PIN-код",
    subtitle: "Введите 4-значный PIN-код для безопасного входа",
    incorrect: "Неверный PIN-код, попробуйте еще раз",
    faceIdScan: "Проверка биометрии / Face ID...",
    faceIdSuccess: "Успешно распознано!",
    faceIdFail: "Не распознано, попробуйте еще раз",
    reset: "Забыли PIN-код? (Сброс через Telegram)",
    forgot: "Забыли PIN-код?",
    pasted: "Вставлен скопированный код",
  },
  en: {
    title: "Enter PIN Code",
    subtitle: "Enter the 4-digit PIN code for secure access",
    incorrect: "Incorrect PIN code, please try again",
    faceIdScan: "Verifying biometrics / Face ID...",
    faceIdSuccess: "Successfully recognized!",
    faceIdFail: "Not recognized, please try again",
    reset: "Forgot PIN code? (Reset via Telegram)",
    forgot: "Forgot PIN code?",
    pasted: "Pasted code inserted",
  }
}

export default function PinLockScreen({ language = 'uz', onUnlock, onReset }: Props) {
  const t = translations[language] || translations.uz
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)
  const [faceScanning, setFaceScanning] = useState(false)
  const [shake, setShake] = useState(false)
  const hiddenInputRef = useRef<HTMLInputElement | null>(null)

  // Load user security preferences
  const getSecurityPrefs = () => {
    try {
      const saved = localStorage.getItem('user_security_v1')
      return saved ? JSON.parse(saved) : { pinEnabled: false, faceIdEnabled: false, pinCode: '' }
    } catch {
      return { pinEnabled: false, faceIdEnabled: false, pinCode: '' }
    }
  }

  const prefs = getSecurityPrefs()
  const correctPin = prefs.pinCode || '2580'
  const isFaceIdEnabled = !!prefs.pinEnabled && prefs.faceIdEnabled !== false

  // Trigger auto Face ID / Biometric check simulation if enabled
  useEffect(() => {
    if (isFaceIdEnabled) {
      const timer = setTimeout(() => {
        handleFaceIdAuth()
      }, 700)
      return () => clearTimeout(timer)
    }
  }, [])

  // Auto-focus hidden input for physical keyboard / clipboard paste support
  useEffect(() => {
    hiddenInputRef.current?.focus()
  }, [])

  // Handle global paste event
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text') || ''
      const digits = text.replace(/\D/g, '').slice(0, 4)
      if (digits.length === 4) {
        verifyPin(digits)
      } else if (digits.length > 0) {
        setPin(digits)
      }
    }

    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [correctPin])

  // Handle global keyboard typing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        handleKeyPress(e.key)
      } else if (e.key === 'Backspace') {
        handleBackspace()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pin, error, faceScanning, correctPin])

  const verifyPin = (inputPin: string) => {
    setPin(inputPin)
    if (inputPin === correctPin) {
      setError(false)
      setTimeout(() => {
        onUnlock()
      }, 150)
    } else {
      setTimeout(() => {
        setShake(true)
        setError(true)
        setPin('')
        setTimeout(() => setShake(false), 500)
      }, 200)
    }
  }

  const handleKeyPress = (num: string) => {
    if (pin.length >= 4 || faceScanning) return

    let currentPin = pin
    if (error) {
      setError(false)
      currentPin = ''
    }

    const nextPin = currentPin + num
    setPin(nextPin)

    if (nextPin.length === 4) {
      verifyPin(nextPin)
    }
  }

  const handleBackspace = () => {
    if (faceScanning) return
    if (error) {
      setError(false)
      setPin('')
      return
    }
    if (pin.length === 0) return
    setPin(pin.slice(0, -1))
  }

  const handleFaceIdAuth = () => {
    if (faceScanning) return
    setFaceScanning(true)
    setError(false)

    // Simulate standard biometric feedback
    setTimeout(() => {
      setFaceScanning(false)
      onUnlock()
    }, 1500)
  }

  return (
    <div
      onClick={() => hiddenInputRef.current?.focus()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: '#FFFFFF',
        maxWidth: 430,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '50px 24px 36px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        boxSizing: 'border-box'
      }}
    >
      {/* Hidden input for receiving paste and hardware numpad keystrokes */}
      <input
        ref={hiddenInputRef}
        type="tel"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={4}
        value={pin}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 4)
          if (digits.length === 4) {
            verifyPin(digits)
          } else {
            setPin(digits)
          }
        }}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1 }}
      />

      {/* Top Header */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 10 }}>
        <img
          src="/logo.png"
          alt="Moliya AI"
          style={{
            width: 68,
            height: 68,
            borderRadius: 20,
            objectFit: 'cover',
            boxShadow: '0 10px 28px rgba(124, 58, 237, 0.25)',
            border: '2px solid rgba(124, 58, 237, 0.15)',
            overflow: 'hidden',
            marginBottom: 20,
            display: 'block'
          }}
        />

        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1E1A3C', marginBottom: 8, letterSpacing: -0.4 }}>
          {t.title}
        </h2>
        <p style={{ fontSize: 13.5, color: '#8B82C4', textAlign: 'center', padding: '0 16px', lineHeight: 1.45 }}>
          {t.subtitle}
        </p>

        {/* 4 Pin Indicator Dots with Shake animation */}
        <div
          style={{
            display: 'flex',
            gap: 16,
            justifyContent: 'center',
            margin: '28px 0 14px',
            transform: shake ? 'translateX(0)' : undefined,
            animation: shake ? 'shake_dots 0.4s ease' : undefined,
          }}
        >
          {[0, 1, 2, 3].map((i) => {
            const active = pin.length > i
            return (
              <div
                key={i}
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  border: `2px solid ${error ? '#DC2626' : '#7C3AED'}`,
                  background: error ? '#DC2626' : active ? '#7C3AED' : 'transparent',
                  transition: 'all 0.15s ease',
                  transform: active ? 'scale(1.15)' : 'scale(1)',
                }}
              />
            )
          })}
        </div>

        {/* Dynamic Error or Scan State Message */}
        <div style={{ height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {error && (
            <p style={{ fontSize: 13, fontWeight: 600, color: '#DC2626', animation: 'fadeIn 0.2s' }}>
              ⚠️ {t.incorrect}
            </p>
          )}
          {faceScanning && (
            <p style={{ fontSize: 13, fontWeight: 600, color: '#7C3AED', animation: 'pulseText 1s infinite alternate' }}>
              👤 {t.faceIdScan}
            </p>
          )}
        </div>
      </div>

      {/* Grid Keypad */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', padding: '0 8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}>
          {['1', '2', '3'].map((n) => (
            <button
              key={n}
              onClick={(e) => { e.stopPropagation(); handleKeyPress(n) }}
              style={keyStyles}
            >
              {n}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}>
          {['4', '5', '6'].map((n) => (
            <button
              key={n}
              onClick={(e) => { e.stopPropagation(); handleKeyPress(n) }}
              style={keyStyles}
            >
              {n}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}>
          {['7', '8', '9'].map((n) => (
            <button
              key={n}
              onClick={(e) => { e.stopPropagation(); handleKeyPress(n) }}
              style={keyStyles}
            >
              {n}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center' }}>
          {/* Face ID trigger or spacer */}
          {isFaceIdEnabled ? (
            <button
              onClick={(e) => { e.stopPropagation(); handleFaceIdAuth() }}
              style={{
                ...keyStyles,
                background: 'transparent',
                border: 'none',
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
                <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
                <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                <line x1="9" y1="9" x2="9.01" y2="9" />
                <line x1="15" y1="9" x2="15.01" y2="9" />
                <line x1="12" y1="9" x2="12" y2="13" />
              </svg>
            </button>
          ) : (
            <div style={{ flex: 1, minHeight: 60 }} />
          )}

          <button
            onClick={(e) => { e.stopPropagation(); handleKeyPress('0') }}
            style={keyStyles}
          >
            0
          </button>

          {/* Backspace */}
          <button
            onClick={(e) => { e.stopPropagation(); handleBackspace() }}
            style={{
              ...keyStyles,
              background: 'transparent',
              border: 'none',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
              <line x1="18" y1="9" x2="12" y2="15" />
              <line x1="12" y1="9" x2="18" y2="15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Reset PIN Trigger */}
      <div style={{ textAlign: 'center', marginTop: 12 }}>
        <button
          onClick={(e) => { e.stopPropagation(); onReset() }}
          style={{
            background: 'none',
            border: 'none',
            color: '#8B82C4',
            fontSize: 12.5,
            fontWeight: 500,
            cursor: 'pointer',
            textDecoration: 'underline',
            fontFamily: 'inherit',
            padding: '6px 12px'
          }}
        >
          {t.reset}
        </button>
      </div>

      {/* Face ID Scanning Animated Overlay */}
      {faceScanning && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(26, 21, 48, 0.95)',
            zIndex: 10000,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#FFFFFF',
          }}
        >
          {/* Scanning Box */}
          <div style={{ position: 'relative', width: 190, height: 190, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, width: 24, height: 24, borderTop: '4px solid #7C3AED', borderLeft: '4px solid #7C3AED', borderRadius: '4px 0 0 0' }} />
            <div style={{ position: 'absolute', top: 0, right: 0, width: 24, height: 24, borderTop: '4px solid #7C3AED', borderRight: '4px solid #7C3AED', borderRadius: '0 4px 0 0' }} />
            <div style={{ position: 'absolute', bottom: 0, left: 0, width: 24, height: 24, borderBottom: '4px solid #7C3AED', borderLeft: '4px solid #7C3AED', borderRadius: '0 0 0 4px' }} />
            <div style={{ position: 'absolute', bottom: 0, right: 0, width: 24, height: 24, borderBottom: '4px solid #7C3AED', borderRight: '4px solid #7C3AED', borderRadius: '0 0 4px 0' }} />

            <div
              style={{
                position: 'absolute',
                left: 12,
                right: 12,
                height: 3,
                background: 'linear-gradient(90deg, rgba(124,58,237,0) 0%, #7C3AED 50%, rgba(124,58,237,0) 100%)',
                boxShadow: '0 0 12px #7C3AED',
                animation: 'scanLine 2s linear infinite',
              }}
            />

            <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="1.5" style={{ animation: 'pulseIcon 1.5s ease-in-out infinite alternate' }}>
              <path d="M8 3H5a2 2 0 0 0-2 2v3" />
              <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
              <path d="M3 16v3a2 2 0 0 0 2 2h3" />
              <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
              <path d="M8 14s1.5 2 4 2 4-2 4-2" />
              <line x1="9" y1="9" x2="9.01" y2="9" />
              <line x1="15" y1="9" x2="15.01" y2="9" />
              <line x1="12" y1="9" x2="12" y2="13" />
            </svg>
          </div>

          <p style={{ marginTop: 26, fontSize: 15, fontWeight: 600, letterSpacing: 0.3, color: '#A78BFA' }}>
            {t.faceIdScan}
          </p>
        </div>
      )}

      {/* Embedded local CSS Animations */}
      <style>{`
        @keyframes shake_dots {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-8px); }
          40%, 80% { transform: translateX(8px); }
        }
        @keyframes scanLine {
          0% { top: 12px; }
          50% { top: 178px; }
          100% { top: 12px; }
        }
        @keyframes pulseIcon {
          0% { transform: scale(0.96); opacity: 0.85; }
          100% { transform: scale(1.04); opacity: 1; }
        }
        @keyframes pulseText {
          0% { opacity: 0.6; }
          100% { opacity: 1; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

const keyStyles: React.CSSProperties = {
  flex: 1,
  minHeight: 60,
  borderRadius: 18,
  border: '1.5px solid #F0EDFA',
  background: '#FAF9FE',
  fontSize: 22,
  fontWeight: 700,
  color: '#1E1A3C',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'all 0.1s ease',
  fontFamily: 'inherit',
}
