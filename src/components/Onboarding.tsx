import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useFinance } from '../FinanceContext'
import PrivacyPolicyModal from './PrivacyPolicyModal'

export interface OnboardingResult {
  language: 'uz' | 'uz_cyrl' | 'ru' | 'en'
  monthlyGoal: number
  firstExpense: { amount: number; category: string; date?: string } | null
  monthlyIncome?: number
  baseBalance?: number
  name?: string
  phone?: string
  telegram?: string
  telegramId?: string
  isPremium?: boolean
  isVip?: boolean
  premiumExpiresAt?: string | null
  unlimitedAi?: boolean
  trialEndsAt?: string | null
  completed?: boolean
  tour_completed?: boolean
  notifications?: { opt1: boolean; opt2: boolean; opt3: boolean }
  registration_status?: string
  oferta_accepted?: boolean
  privacy_consent?: {
    accepted: boolean
    accepted_at: string
    policy_version: string
  }
}

interface Props {
  onComplete: (result: OnboardingResult) => void
}

type Step = 'language' | 'oferta' | 'phone' | 'goal' | 'ready'

const languages: { code: 'uz' | 'uz_cyrl' | 'ru' | 'en'; label: string; tag: string }[] = [
  { code: 'uz', label: "O'zbekcha", tag: '🇺🇿' },
  { code: 'ru', label: 'Русский', tag: '🇷🇺' },
  { code: 'en', label: 'English', tag: '🇺🇸' },
]

const uzbekScriptTypes: { code: 'uz' | 'uz_cyrl'; label: string; sublabel: string }[] = [
  { code: 'uz', label: 'Lotin', sublabel: 'A B C D' },
  { code: 'uz_cyrl', label: 'Кирилл', sublabel: 'А Б В Г' },
]

const translations = {
  uz: {
    selectLanguage: "Ilova tilini tanlang",
    selectLangSub: "Barcha hisob-kitoblar va AI siz tanlagan tilda ishlaydi",
    continueBtn: "Davom etish →",
    ofertaTitle: "Ommaviy Oferta & Xavfsizlik",
    ofertaSub: "Moliya AI xizmatlaridan foydalanish uchun rasmiy oferta shartlarini qabul qiling",
    ofertaPoint1: "Barcha moliyaviy ma'lumotlaringiz shifrlangan va xavfsiz saqlanadi",
    ofertaPoint2: "Ma'lumotlaringiz uchinchi shaxslarga aslo taqdim etilmaydi",
    ofertaPoint3: "Sun'iy intellekt faqat sizning hisob-kitoblaringizni yuritish uchun xizmat qiladi",
    readFullOferta: "To'liq Ofertani o'qish ↗",
    acceptOfertaLabel: "Ommaviy oferta va Maxfiylik siyosatiga to'liq roziman",
    phoneTitle: "Telefon raqamingizni kiriting",
    phoneSub: "Hisobingizni faollashtirish va qurilmalaringizni ulash uchun raqamingizni tasdiqlang",
    phoneLabel: "Telefon raqam",
    phonePlaceholder: "90 123 45 67",
    phoneBenefitTitle: "1 Kunlik Cheksiz VIP Premium!",
    phoneBenefitSub: "Telefon raqamingiz tasdiqlangach, darhol barcha AI imkoniyatlari bepul va cheksiz ochiladi.",
    phoneError: "Iltimos, 9 xonali to'g'ri telefon raqam kiriting",
    setGoalTitle: "Moliyaviy maqsadingiz",
    setGoalSub: "Har oy qancha mablag' tejashni rejalashtiryapsiz?",
    starter: "Boshlang'ich",
    recommended: "Tavsiya etiladi",
    intensive: "Intensiv",
    perMonth: "so'm / oyiga",
    customGoal: "O'zim kiritaman",
    otherAmount: "Boshqa summa",
    enterAmount: "Summani kiriting",
    saveGoalBtn: "Maqsadni saqlash →",
    readyTitle: "Hisobingiz faollashtirildi!",
    readySub: "Moliya AI sizning shaxsiy moliyaviy barqarorligingiz yo'lida doimo yordamchi bo'ladi.",
    readyAction: "Ilovani Boshlash 🚀",
  },
  uz_cyrl: {
    selectLanguage: "Илова тилини танланг",
    selectLangSub: "Барча ҳисоб-китоблар ва AI сиз танлаган тилда ишлайди",
    continueBtn: "Давом этиш →",
    ofertaTitle: "Оммавий Оферта & Хавфсизлик",
    ofertaSub: "Moliya AI хизматларидан фойдаланиш учун расмий оферта шартларини қабул қилинг",
    ofertaPoint1: "Барча молиявий маълумотларингиз шифрланган ва хавфсиз сақланади",
    ofertaPoint2: "Маълумотларингиз учинчи шахсларга асло тақдим этилмайди",
    ofertaPoint3: "Сунъий интеллект фақат сизнинг ҳисоб-китобларингизни юритиш учун хизмат қилади",
    readFullOferta: "Тўлиқ Офертани ўқиш ↗",
    acceptOfertaLabel: "Оммавий оферта ва Махфийлик сиёсатига тўлиқ розиман",
    phoneTitle: "Телефон рақамингизни киритинг",
    phoneSub: "Ҳисобингизни фаоллаштириш ва қурилмаларингизни улаш учун рақамингизни тасдиқланг",
    phoneLabel: "Телефон рақам",
    phonePlaceholder: "90 123 45 67",
    phoneBenefitTitle: "1 Кунлик Чексиз VIP Premium!",
    phoneBenefitSub: "Телефон рақамингиз тасдиқлангач, дарҳол барча AI имкониятлари бепул ва чексиз очилади.",
    phoneError: "Илтимос, 9 хонали тўғри телефон рақам киритинг",
    setGoalTitle: "Молиявий мақсадингиз",
    setGoalSub: "Ҳар ой қанча маблағ тежашни режалаштиряпсиз?",
    starter: "Бошланғич",
    recommended: "Тавсия этилади",
    intensive: "Интенсив",
    perMonth: "сўм / ойига",
    customGoal: "Ўзим киритаман",
    otherAmount: "Бошқа сумма",
    enterAmount: "Суммани киритинг",
    saveGoalBtn: "Мақсадни сақлаш →",
    readyTitle: "Ҳисобингиз фаоллаштирилди!",
    readySub: "Moliya AI сизнинг шахсий молиявий барқарорлигингиз йўлида доимо ёрдамчи бўлади.",
    readyAction: "Дастурни Бошлаш 🚀",
  },
  ru: {
    selectLanguage: "Выберите язык приложения",
    selectLangSub: "Все расчеты и ИИ-помощник будут работать на выбранном языке",
    continueBtn: "Продолжить →",
    ofertaTitle: "Публичная Оферта & Безопасность",
    ofertaSub: "Для использования сервиса Moliya AI примите условия официальной оферты",
    ofertaPoint1: "Все ваши финансовые данные зашифрованы и надежно защищены",
    ofertaPoint2: "Ваши данные никогда не передаются третьим лицам",
    ofertaPoint3: "Искусственный интеллект используется исключительно для ведения ваших финансов",
    readFullOferta: "Читать полную Оферту ↗",
    acceptOfertaLabel: "Я полностью согласен с условиями Оферты и Политики конфиденциальности",
    phoneTitle: "Введите номер телефона",
    phoneSub: "Подтвердите номер для активации аккаунта и синхронизации устройств",
    phoneLabel: "Номер телефона",
    phonePlaceholder: "90 123 45 67",
    phoneBenefitTitle: "1 День Безлимитного VIP Premium!",
    phoneBenefitSub: "После подтверждения номера вы сразу получаете 24 часа неограниченного ИИ-доступа.",
    phoneError: "Пожалуйста, введите корректный 9-значный номер телефона",
    setGoalTitle: "Ваша финансовая цель",
    setGoalSub: "Сколько средств вы планируете сберегать каждый месяц?",
    starter: "Базовая",
    recommended: "Рекомендуемая",
    intensive: "Интенсивная",
    perMonth: "сум / месяц",
    customGoal: "Введу свою сумму",
    otherAmount: "Другая сумма",
    enterAmount: "Введите сумму",
    saveGoalBtn: "Сохранить цель →",
    readyTitle: "Аккаунт активирован!",
    readySub: "Moliya AI станет вашим надежным партнером на пути к финансовой стабильности.",
    readyAction: "Запустить приложение 🚀",
  },
  en: {
    selectLanguage: "Select App Language",
    selectLangSub: "All calculations and AI will operate in your selected language",
    continueBtn: "Continue →",
    ofertaTitle: "Public Offer & Privacy",
    ofertaSub: "Please accept the official terms of service to start using Moliya AI",
    ofertaPoint1: "All your financial records are securely encrypted and protected",
    ofertaPoint2: "Your data is never shared with third parties",
    ofertaPoint3: "Artificial Intelligence works solely for your private budgeting",
    readFullOferta: "Read full Public Offer ↗",
    acceptOfertaLabel: "I agree to the Public Offer & Privacy Policy terms",
    phoneTitle: "Enter your phone number",
    phoneSub: "Verify your phone number to activate your account and link devices",
    phoneLabel: "Phone number",
    phonePlaceholder: "90 123 45 67",
    phoneBenefitTitle: "1-Day Unlimited VIP Premium!",
    phoneBenefitSub: "Upon verifying your phone number, you get 24 hours of unlimited AI features completely free.",
    phoneError: "Please enter a valid 9-digit phone number",
    setGoalTitle: "Your monthly savings goal",
    setGoalSub: "How much would you like to save each month?",
    starter: "Starter",
    recommended: "Recommended",
    intensive: "Intensive",
    perMonth: "UZS / month",
    customGoal: "Custom amount",
    otherAmount: "Other amount",
    enterAmount: "Enter amount",
    saveGoalBtn: "Save goal →",
    readyTitle: "Account Activated!",
    readySub: "Moliya AI is ready to help you achieve financial discipline and peace of mind.",
    readyAction: "Launch App 🚀",
  }
}

const goalOptions = [
  { amount: 1000000, labelKey: 'starter', icon: '🌱' },
  { amount: 3000000, labelKey: 'recommended', icon: '⭐', isPopular: true },
  { amount: 5000000, labelKey: 'intensive', icon: '🚀' },
]

export default function Onboarding({ onComplete }: Props) {
  const { onboarding, updateOnboarding } = useFinance()
  const [step, setStep] = useState<Step>('language')
  const [language, setLanguage] = useState<'uz' | 'uz_cyrl' | 'ru' | 'en'>(
    onboarding?.language || 'uz'
  )

  // Oferta acceptance state
  const [ofertaAccepted, setOfertaAccepted] = useState(
    Boolean(onboarding?.oferta_accepted || (onboarding as any)?.privacy_consent?.accepted)
  )
  const [showPolicy, setShowPolicy] = useState(false)
  const [policyTab, setPolicyTab] = useState<'privacy' | 'terms'>('terms')

  // Phone number state
  const initialPhoneDigits = (onboarding?.phone || '').replace(/\D/g, '').replace(/^998/, '').slice(0, 9)
  const [phoneDigits, setPhoneDigits] = useState(initialPhoneDigits)
  const [phoneError, setPhoneError] = useState('')

  // Savings goal state
  const [selectedGoal, setSelectedGoal] = useState<number>(3000000)
  const [customGoalInput, setCustomGoalInput] = useState('')
  const [isCustomGoal, setIsCustomGoal] = useState(false)

  const t = translations[language] || translations.uz

  const stepsList: Step[] = ['language', 'oferta', 'phone', 'goal', 'ready']
  const currentStepIndex = stepsList.indexOf(step) + 1

  // Format phone display: 90 123 45 67
  const formatPhoneInput = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 9)
    setPhoneDigits(digits)
    if (phoneError) setPhoneError('')
  }

  const getFormattedPhoneDisplay = () => {
    let res = ''
    if (phoneDigits.length > 0) res += phoneDigits.slice(0, 2)
    if (phoneDigits.length > 2) res += ' ' + phoneDigits.slice(2, 5)
    if (phoneDigits.length > 5) res += ' ' + phoneDigits.slice(5, 7)
    if (phoneDigits.length > 7) res += ' ' + phoneDigits.slice(7, 9)
    return res
  }

  const goNext = () => {
    if (step === 'oferta') {
      if (!ofertaAccepted) {
        setOfertaAccepted(true)
      }
    }

    if (step === 'phone') {
      if (phoneDigits.length !== 9) {
        setPhoneError(t.phoneError)
        return
      }
    }

    const nextIdx = stepsList.indexOf(step) + 1
    if (nextIdx < stepsList.length) {
      setStep(stepsList[nextIdx])
    } else {
      finish()
    }
  }

  const goBack = () => {
    const prevIdx = stepsList.indexOf(step) - 1
    if (prevIdx >= 0) {
      setStep(stepsList[prevIdx])
    }
  }

  const finish = () => {
    const goal = isCustomGoal
      ? parseInt(customGoalInput.replace(/\D/g, ''), 10) || 3000000
      : selectedGoal

    const formattedFullPhone = `+998${phoneDigits}`

    const result: OnboardingResult = {
      language,
      monthlyGoal: goal,
      firstExpense: null,
      monthlyIncome: 0,
      baseBalance: 0,
      name: onboarding?.name || '',
      phone: formattedFullPhone,
      telegram: onboarding?.telegram || '',
      telegramId: onboarding?.telegramId || '',
      isPremium: true,
      completed: true,
      registration_status: 'completed',
      oferta_accepted: true,
      privacy_consent: {
        accepted: true,
        accepted_at: new Date().toISOString(),
        policy_version: '1.0'
      }
    }

    const userId = onboarding?.telegramId ? `moliya_user_tg_${onboarding.telegramId}` : localStorage.getItem('user_id_v1')
    if (userId) {
      localStorage.setItem(`user_onboarding_completed_${userId}`, 'true')
    }
    localStorage.setItem('user_onboarding_completed_v1', 'true')

    updateOnboarding(result).catch(() => {})
    onComplete(result)
  }

  return (
    <div
      className="app-container"
      style={{
        position: 'relative',
        minHeight: '100dvh',
        width: '100%',
        maxWidth: 'var(--app-max-width, 430px)',
        margin: '0 auto',
        background: '#FAF8FE',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '24px 20px 32px',
        boxSizing: 'border-box',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      {/* Top Navigation & Progress Segmented Bar */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          {currentStepIndex > 1 ? (
            <button
              onClick={goBack}
              style={{
                width: 36, height: 36, borderRadius: 12, border: '1.5px solid #E8E3F8',
                background: '#FFFFFF', color: '#1E1A3C', fontSize: 16, fontWeight: 700,
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}
            >
              ←
            </button>
          ) : <div style={{ width: 36 }} />}

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 24, height: 24, borderRadius: 8,
              background: 'linear-gradient(135deg, #7C3AED, #5B21B6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#FFFFFF', fontSize: 12, fontWeight: 800
            }}>
              M
            </div>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#1E1A3C' }}>Moliya AI</span>
          </div>

          <span style={{ fontSize: 12, fontWeight: 600, color: '#8B82C4' }}>
            {currentStepIndex} / {stepsList.length}
          </span>
        </div>

        {/* Segmented Progress Indicators */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24 }}>
          {stepsList.map((s, idx) => (
            <div
              key={s}
              style={{
                flex: 1, height: 4, borderRadius: 2,
                background: idx < currentStepIndex ? '#7C3AED' : '#E8E3F8',
                transition: 'background 0.3s ease'
              }}
            />
          ))}
        </div>
      </div>

      {/* Main Step Cards */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <AnimatePresence mode="wait">
          {/* ── STEP 1: Til Tanlash (Language Selection) ── */}
          {step === 'language' && (
            <motion.div
              key="language"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              <div style={{ textAlign: 'center', marginBottom: 4 }}>
                <div style={{
                  width: 56, height: 56, borderRadius: 20, margin: '0 auto 12px',
                  background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.12) 0%, rgba(91, 33, 182, 0.12) 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26
                }}>
                  🌐
                </div>
                <h1 style={{ fontSize: 21, fontWeight: 700, color: '#1E1A3C', letterSpacing: -0.3, margin: '0 0 4px' }}>
                  {t.selectLanguage}
                </h1>
                <p style={{ fontSize: 13, color: '#8B82C4', margin: 0 }}>
                  {t.selectLangSub}
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {languages.map((l) => {
                  const isSelected = language === l.code || (l.code === 'uz' && language === 'uz_cyrl')
                  return (
                    <div key={l.code} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <button
                        onClick={() => {
                          if (l.code === 'uz') {
                            setLanguage('uz')
                          } else {
                            setLanguage(l.code)
                          }
                        }}
                        style={{
                          width: '100%', padding: '15px 16px', borderRadius: 16,
                          border: isSelected ? '1.5px solid #7C3AED' : '1.5px solid #E8E3F8',
                          background: isSelected ? '#F3EEFF' : '#FFFFFF',
                          cursor: 'pointer', fontFamily: 'inherit',
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          boxShadow: isSelected ? '0 4px 12px rgba(124, 58, 237, 0.12)' : '0 2px 6px rgba(0,0,0,0.02)',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 22 }}>{l.tag}</span>
                          <span style={{ fontSize: 15, fontWeight: 700, color: isSelected ? '#7C3AED' : '#1E1A3C' }}>
                            {l.label}
                          </span>
                        </div>
                        {isSelected && (
                          <div style={{
                            width: 20, height: 20, borderRadius: 10, background: '#7C3AED',
                            color: '#FFFFFF', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center'
                          }}>
                            ✓
                          </div>
                        )}
                      </button>

                      {/* Uzbek script sub-selector (Lotin vs Кирилл) */}
                      {l.code === 'uz' && isSelected && (
                        <div style={{ display: 'flex', gap: 8, paddingLeft: 12 }}>
                          {uzbekScriptTypes.map((st) => (
                            <button
                              key={st.code}
                              onClick={(e) => {
                                e.stopPropagation()
                                setLanguage(st.code)
                              }}
                              style={{
                                flex: 1, padding: '8px 10px', borderRadius: 12,
                                border: language === st.code ? '1.5px solid #7C3AED' : '1.5px solid #E8E3F8',
                                background: language === st.code ? '#FFFFFF' : '#FAF8FE',
                                color: language === st.code ? '#7C3AED' : '#8B82C4',
                                fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
                              }}
                            >
                              <span>{st.label}</span>
                              <span style={{ fontSize: 10, opacity: 0.7 }}>({st.sublabel})</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </motion.div>
          )}

          {/* ── STEP 2: Ommaviy Oferta & Xavfsizlik ── */}
          {step === 'oferta' && (
            <motion.div
              key="oferta"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              <div style={{ textAlign: 'center', marginBottom: 4 }}>
                <div style={{
                  width: 56, height: 56, borderRadius: 20, margin: '0 auto 12px',
                  background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, rgba(5, 150, 105, 0.12) 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26
                }}>
                  🛡️
                </div>
                <h1 style={{ fontSize: 21, fontWeight: 700, color: '#1E1A3C', letterSpacing: -0.3, margin: '0 0 4px' }}>
                  {t.ofertaTitle}
                </h1>
                <p style={{ fontSize: 13, color: '#8B82C4', margin: 0, lineHeight: 1.4 }}>
                  {t.ofertaSub}
                </p>
              </div>

              {/* Guarantees Box */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{
                  padding: '13px 14px', borderRadius: 16, background: '#FFFFFF',
                  border: '1.5px solid #E8E3F8', display: 'flex', alignItems: 'flex-start', gap: 10,
                  boxShadow: '0 2px 8px rgba(124, 58, 237, 0.04)'
                }}>
                  <span style={{ fontSize: 18, marginTop: 1 }}>🔒</span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: '#1E1A3C', lineHeight: 1.4 }}>
                    {t.ofertaPoint1}
                  </span>
                </div>
                <div style={{
                  padding: '13px 14px', borderRadius: 16, background: '#FFFFFF',
                  border: '1.5px solid #E8E3F8', display: 'flex', alignItems: 'flex-start', gap: 10,
                  boxShadow: '0 2px 8px rgba(124, 58, 237, 0.04)'
                }}>
                  <span style={{ fontSize: 18, marginTop: 1 }}>👥</span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: '#1E1A3C', lineHeight: 1.4 }}>
                    {t.ofertaPoint2}
                  </span>
                </div>
                <div style={{
                  padding: '13px 14px', borderRadius: 16, background: '#FFFFFF',
                  border: '1.5px solid #E8E3F8', display: 'flex', alignItems: 'flex-start', gap: 10,
                  boxShadow: '0 2px 8px rgba(124, 58, 237, 0.04)'
                }}>
                  <span style={{ fontSize: 18, marginTop: 1 }}>🤖</span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: '#1E1A3C', lineHeight: 1.4 }}>
                    {t.ofertaPoint3}
                  </span>
                </div>
              </div>

              {/* Link to view modal */}
              <div style={{ textAlign: 'center', marginTop: 2 }}>
                <button
                  type="button"
                  onClick={() => { setPolicyTab('terms'); setShowPolicy(true); }}
                  style={{
                    background: 'none', border: 'none', color: '#7C3AED',
                    fontSize: 12.5, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline'
                  }}
                >
                  {t.readFullOferta}
                </button>
              </div>

              {/* Acceptance Consent Box */}
              <div
                onClick={() => setOfertaAccepted(!ofertaAccepted)}
                style={{
                  padding: '14px 16px', borderRadius: 16,
                  border: ofertaAccepted ? '2px solid #7C3AED' : '1.5px solid #E8E3F8',
                  background: ofertaAccepted ? '#F5F0FF' : '#FFFFFF',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
                  boxShadow: ofertaAccepted ? '0 4px 12px rgba(124, 58, 237, 0.12)' : 'none',
                  transition: 'all 0.2s ease'
                }}
              >
                <div style={{
                  width: 22, height: 22, borderRadius: 6,
                  border: ofertaAccepted ? '2px solid #7C3AED' : '2px solid #CBD5E1',
                  background: ofertaAccepted ? '#7C3AED' : '#FFFFFF',
                  color: '#FFFFFF', fontSize: 13, fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                }}>
                  {ofertaAccepted ? '✓' : ''}
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#1E1A3C', lineHeight: 1.3 }}>
                  {t.acceptOfertaLabel}
                </span>
              </div>
            </motion.div>
          )}

          {/* ── STEP 3: Telefon Raqam (Phone Number Input) ── */}
          {step === 'phone' && (
            <motion.div
              key="phone"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              <div style={{ textAlign: 'center', marginBottom: 4 }}>
                <div style={{
                  width: 56, height: 56, borderRadius: 20, margin: '0 auto 12px',
                  background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.12) 0%, rgba(91, 33, 182, 0.12) 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26
                }}>
                  📱
                </div>
                <h1 style={{ fontSize: 21, fontWeight: 700, color: '#1E1A3C', letterSpacing: -0.3, margin: '0 0 4px' }}>
                  {t.phoneTitle}
                </h1>
                <p style={{ fontSize: 13, color: '#8B82C4', margin: 0, lineHeight: 1.4 }}>
                  {t.phoneSub}
                </p>
              </div>

              {/* Phone Input Box with fixed +998 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {t.phoneLabel}
                </label>
                <div style={{
                  display: 'flex', alignItems: 'center', background: '#FFFFFF',
                  border: phoneError ? '2px solid #EF4444' : '2px solid #7C3AED',
                  borderRadius: 16, padding: '4px 14px',
                  boxShadow: '0 4px 16px rgba(124, 58, 237, 0.08)'
                }}>
                  <span style={{ fontSize: 16, fontWeight: 800, color: '#7C3AED', marginRight: 8 }}>
                    🇺🇿 +998
                  </span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    autoFocus
                    value={getFormattedPhoneDisplay()}
                    onChange={(e) => formatPhoneInput(e.target.value)}
                    placeholder={t.phonePlaceholder}
                    style={{
                      flex: 1, border: 'none', outline: 'none', background: 'transparent',
                      fontSize: 17, fontWeight: 700, color: '#1E1A3C', padding: '12px 0',
                      letterSpacing: '0.04em'
                    }}
                  />
                  {phoneDigits.length === 9 && (
                    <span style={{ color: '#10B981', fontSize: 18, fontWeight: 800 }}>✓</span>
                  )}
                </div>
                {phoneError && (
                  <span style={{ fontSize: 12, color: '#EF4444', fontWeight: 600, marginTop: 2 }}>
                    {phoneError}
                  </span>
                )}
              </div>

              {/* VIP Trial Benefit Card */}
              <div style={{
                marginTop: 6, padding: '14px 16px', borderRadius: 16,
                background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.1) 0%, rgba(217, 119, 6, 0.06) 100%)',
                border: '1.5px solid rgba(245, 158, 11, 0.3)', display: 'flex', alignItems: 'flex-start', gap: 10
              }}>
                <span style={{ fontSize: 20 }}>🎁</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#B45309', marginBottom: 2 }}>
                    {t.phoneBenefitTitle}
                  </div>
                  <div style={{ fontSize: 11.5, color: '#92400E', lineHeight: 1.4 }}>
                    {t.phoneBenefitSub}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── STEP 4: Savings Goal (Optional) ── */}
          {step === 'goal' && (
            <motion.div
              key="goal"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              <div style={{ textAlign: 'center', marginBottom: 4 }}>
                <h1 style={{ fontSize: 21, fontWeight: 700, color: '#1E1A3C', letterSpacing: -0.3, margin: '0 0 4px' }}>
                  {t.setGoalTitle}
                </h1>
                <p style={{ fontSize: 13, color: '#8B82C4', margin: 0 }}>
                  {t.setGoalSub}
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {goalOptions.map((opt) => {
                  const isSelected = !isCustomGoal && selectedGoal === opt.amount
                  return (
                    <button
                      key={opt.amount}
                      onClick={() => {
                        setSelectedGoal(opt.amount)
                        setIsCustomGoal(false)
                      }}
                      style={{
                        width: '100%', padding: '14px 16px', borderRadius: 16,
                        border: isSelected ? '1.5px solid #7C3AED' : '1.5px solid #E8E3F8',
                        background: isSelected ? '#F3EEFF' : '#FFFFFF',
                        cursor: 'pointer', fontFamily: 'inherit',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        boxShadow: isSelected ? '0 4px 12px rgba(124, 58, 237, 0.12)' : '0 2px 6px rgba(0,0,0,0.02)',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 20 }}>{opt.icon}</span>
                        <div style={{ textAlign: 'left' }}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: isSelected ? '#7C3AED' : '#1E1A3C' }}>
                            {opt.amount.toLocaleString()} {t.perMonth}
                          </div>
                          <div style={{ fontSize: 11, color: '#8B82C4' }}>
                            {(t as any)[opt.labelKey]}
                          </div>
                        </div>
                      </div>
                      {opt.isPopular && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 8,
                          background: '#7C3AED', color: '#FFFFFF'
                        }}>
                          TOP
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </motion.div>
          )}

          {/* ── STEP 5: Ready / All Set ── */}
          {step === 'ready' && (
            <motion.div
              key="ready"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}
            >
              <div style={{
                width: 80, height: 80, borderRadius: 28,
                background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 12px 32px rgba(16, 185, 129, 0.3)', color: '#FFFFFF', fontSize: 36
              }}>
                ✨
              </div>

              <div>
                <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1E1A3C', margin: '0 0 6px' }}>
                  {t.readyTitle}
                </h1>
                <p style={{ fontSize: 13.5, color: '#64748B', lineHeight: 1.5, margin: 0, maxWidth: 300 }}>
                  {t.readySub}
                </p>
              </div>

              <div style={{
                width: '100%', padding: '14px 16px', borderRadius: 16,
                background: '#FFFFFF', border: '1.5px solid #E8E3F8', textAlign: 'left',
                display: 'flex', flexDirection: 'column', gap: 8
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: '#8B82C4' }}>Raqam:</span>
                  <span style={{ fontWeight: 700, color: '#1E1A3C' }}>+998 {getFormattedPhoneDisplay()}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: '#8B82C4' }}>Holat:</span>
                  <span style={{ fontWeight: 700, color: '#10B981' }}>✅ Faollashtirilgan</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: '#8B82C4' }}>Tarif:</span>
                  <span style={{ fontWeight: 700, color: '#7C3AED' }}>⭐ 1 Kunlik VIP Sinov</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom Action Button */}
      <div style={{ paddingTop: 16 }}>
        <button
          onClick={goNext}
          style={{
            width: '100%', padding: '15px', borderRadius: 16, border: 'none',
            background: 'linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)',
            color: '#FFFFFF', fontSize: 15, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit',
            boxShadow: '0 6px 20px rgba(124, 58, 237, 0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            transition: 'transform 0.1s ease',
          }}
        >
          <span>{step === 'ready' ? t.readyAction : (step === 'goal' ? t.saveGoalBtn : t.continueBtn)}</span>
        </button>

        {/* Public Offer Link */}
        <p
          style={{
            textAlign: 'center',
            fontSize: 11,
            color: '#8B82C4',
            margin: '10px 0 0',
            lineHeight: 1.4
          }}
        >
          Moliya AI xizmatlaridan foydalanish rasmiy{' '}
          <span
            onClick={() => { setPolicyTab('terms'); setShowPolicy(true); }}
            style={{ textDecoration: 'underline', color: '#7C3AED', fontWeight: 600, cursor: 'pointer' }}
          >
            Ommaviy oferta
          </span>{' '}
          shartlariga asoslangan
        </p>
      </div>

      {/* Privacy Policy and Oferta Modal */}
      <PrivacyPolicyModal
        isOpen={showPolicy}
        onClose={() => setShowPolicy(false)}
        lang={language}
        initialTab={policyTab}
      />
    </div>
  )
}
