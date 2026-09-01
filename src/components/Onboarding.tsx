import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useFinance } from '../FinanceContext'

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
  notifications?: { opt1: boolean; opt2: boolean; opt3: boolean }
  registration_status?: string
}

interface Props {
  onComplete: (result: OnboardingResult) => void
}

type Step = 'welcome' | 'language' | 'goal' | 'ai_ask' | 'ai_nlp' | 'trial' | 'ready'

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
    welcomeTitle: "Moliya AI ga xush kelibsiz!",
    welcomeSub: "Shaxsiy moliyangizni sun'iy intellekt yordamida oson, tezkor va professional nazorat qiling.",
    welcomeFeat1: "Ovozli va matnli xarajatlarni avtomatik qayd qilish",
    welcomeFeat2: "To'liq oylik va yillik aqlli hisobotlar",
    welcomeFeat3: "1 kunlik cheksiz Premium va AI imkoniyati",
    selectLanguage: "Tilni tanlang",
    selectLangSub: "Iltimos, dastur tilini tanlang",
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
    continueBtn: "Davom etish →",
    askAiTitle: "Pulingiz haqida savol bering",
    askAiSub: "Sun'iy intellekt xarajatlaringizni tahlil qilib, aqlli maslahatlar beradi.",
    aiQuestions: [
      "Pulim qayerga ketyapti?",
      "Oyiga qancha tejay olaman?",
      "Eng ko'p sarflagan kategoriyam?"
    ],
    aiPulseBadge: "✨ AI Yordamchi",
    aiNlpTitle: "Tabiiy tilda AI tahlil",
    aiNlpSub: "Oddiy so'zlar bilan yozsangiz yoki ovoz yuborsangiz yetarli",
    aiNlpEx1Label: "Siz yozasiz:",
    aiNlpEx1Text: "«Taksiga 25 000 so'm»",
    aiNlpEx1Res: "🚕 Transport • 25 000 so'm",
    aiNlpEx2Label: "Siz yozasiz:",
    aiNlpEx2Text: "«14 mln maosh tushdi»",
    aiNlpEx2Res: "💼 Maosh • 14 000 000 so'm",
    trialBadge: "Maxsus Sovg'a",
    trialTitle: "1 Kunlik Cheksiz Premium",
    trialSub: "Yangi foydalanuvchimiz bo'lganingiz uchun 24 soat davomida barcha AI imkoniyatlari mutlaqo bepul va cheksiz berildi!",
    trialItem1: "⚡ Cheksiz AI so'rovlar (5 ta chegarasisiz)",
    trialItem2: "📊 To'liq tahlil va chek skanerlash",
    trialItem3: "⏳ Sinovdan so'ng: kuniga 5 ta bepul AI so'rovi",
    readyTitle: "Boshlashga tayyorsiz!",
    readySub: "Moliya AI sizning moliyaviy barqarorligingiz va oqilona tejamkorligingiz yo'lida doimo yordamchi bo'ladi.",
    readyAction: "Dasturni Boshlash 🚀",
  },
  uz_cyrl: {
    welcomeTitle: "Moliya AI га хуш келибсиз!",
    welcomeSub: "Шахсий молиянгизни сунъий интеллект ёрдамида осон, тезкор ва профессионал назорат қилинг.",
    welcomeFeat1: "Овозли ва матнли харажатларни автоматик қайд қилиш",
    welcomeFeat2: "Тўлиқ ойлик ва йиллик ақлли ҳисоботлар",
    welcomeFeat3: "1 кунлик чексиз Premium ва AI имконияти",
    selectLanguage: "Тилни танланг",
    selectLangSub: "Илтимос, дастур тилини танланг",
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
    continueBtn: "Давом этиш →",
    askAiTitle: "Пулингиз ҳақида савол беринг",
    askAiSub: "Сунъий интеллект харажатларингизни таҳлил қилиб, ақлли маслаҳатлар беради.",
    aiQuestions: [
      "Пулим қаерга кетяпти?",
      "Ойига қанча тежай оламан?",
      "Энг кўп сарфлаган категоришам?"
    ],
    aiPulseBadge: "✨ AI Ёрдамчи",
    aiNlpTitle: "Табиий тилда AI таҳлил",
    aiNlpSub: "Оддий сўзлар билан ёзсангиз ёки овоз юборсангиз етарли",
    aiNlpEx1Label: "Сиз ёзасиз:",
    aiNlpEx1Text: "«Таксига 25 000 сўм»",
    aiNlpEx1Res: "🚕 Транспорт • 25 000 сўм",
    aiNlpEx2Label: "Сиз ёзасиз:",
    aiNlpEx2Text: "«14 млн маош тушди»",
    aiNlpEx2Res: "💼 Маош • 14 000 000 сўм",
    trialBadge: "Махсус Совға",
    trialTitle: "1 Кунлик Чексиз Premium",
    trialSub: "Янги фойдаланувчимиз бўлганингиз учун 24 соат давомида барча AI имкониятлари мутлақо бепул ва чексиз берилди!",
    trialItem1: "⚡ Чексиз AI сўровлар (5 та чегарасисиз)",
    trialItem2: "📊 Тўлиқ таҳлил ва чек сканерлаш",
    trialItem3: "⏳ Синовдан сўнг: кунига 5 та бепул AI сўрови",
    readyTitle: "Бошлашга тайёрсиз!",
    readySub: "Moliya AI сизнинг молиявий барқарорлигингиз ва оқилона тежамкорлигингиз йўлида доимо ёрдамчи бўлади.",
    readyAction: "Дастурни Бошлаш 🚀",
  },
  ru: {
    welcomeTitle: "Добро пожаловать в Moliya AI!",
    welcomeSub: "Управляйте личными финансами легко, быстро и профессионально с помощью искусственного интеллекта.",
    welcomeFeat1: "Автоматический учет расходов голосом и текстом",
    welcomeFeat2: "Полные ежемесячные и годовые умные отчеты",
    welcomeFeat3: "1 день безлимитного Premium и AI бесплатно",
    selectLanguage: "Выберите язык",
    selectLangSub: "Пожалуйста, выберите язык приложения",
    setGoalTitle: "Финансовая цель",
    setGoalSub: "Сколько вы планируете экономить каждый месяц?",
    starter: "Начальный",
    recommended: "Рекомендуемый",
    intensive: "Интенсивный",
    perMonth: "сум / месяц",
    customGoal: "Ввести вручную",
    otherAmount: "Другая сумма",
    enterAmount: "Введите сумму",
    saveGoalBtn: "Сохранить цель →",
    continueBtn: "Продолжить →",
    askAiTitle: "Задайте вопрос о деньгах",
    askAiSub: "Искусственный интеллект проанализирует ваши расходы и даст умные советы.",
    aiQuestions: [
      "Куда уходят мои деньги?",
      "Сколько я могу сэкономить в месяц?",
      "Моя самая затратная категория?"
    ],
    aiPulseBadge: "✨ ИИ Помощник",
    aiNlpTitle: "ИИ анализ на естественном языке",
    aiNlpSub: "Просто напишите или отправьте голосовое сообщение",
    aiNlpEx1Label: "Вы говорите:",
    aiNlpEx1Text: "«Такси 25 000 сум»",
    aiNlpEx1Res: "🚕 Транспорт • 25 000 сум",
    aiNlpEx2Label: "Вы говорите:",
    aiNlpEx2Text: "«Зарплата 14 млн»",
    aiNlpEx2Res: "💼 Зарплата • 14 000 000 сум",
    trialBadge: "Специальный Подарок",
    trialTitle: "1 День Безлимитного Premium",
    trialSub: "Как новому пользователю, вам предоставлен 24-часовой бесплатный и безлимитный доступ ко всем функциям ИИ!",
    trialItem1: "⚡ Безлимитные запросы ИИ (без ограничения 5/день)",
    trialItem2: "📊 Полная аналитика и сканирование чеков",
    trialItem3: "⏳ После теста: 5 бесплатных ИИ запросов в день",
    readyTitle: "Все готово к старту!",
    readySub: "Moliya AI станет вашим надежным помощником на пути к финансовой стабильности.",
    readyAction: "Запустить Приложение 🚀",
  },
  en: {
    welcomeTitle: "Welcome to Moliya AI!",
    welcomeSub: "Manage your personal finances effortlessly, swiftly, and professionally with Artificial Intelligence.",
    welcomeFeat1: "Automatic expense tracking via voice & text",
    welcomeFeat2: "Comprehensive monthly & annual smart analytics",
    welcomeFeat3: "1-Day Unlimited Premium & AI Trial included",
    selectLanguage: "Choose Language",
    selectLangSub: "Please select your preferred language",
    setGoalTitle: "Your Savings Goal",
    setGoalSub: "How much would you like to save each month?",
    starter: "Starter",
    recommended: "Recommended",
    intensive: "Intensive",
    perMonth: "UZS / month",
    customGoal: "Custom Amount",
    otherAmount: "Other Amount",
    enterAmount: "Enter amount",
    saveGoalBtn: "Save Goal →",
    continueBtn: "Continue →",
    askAiTitle: "Ask AI About Your Money",
    askAiSub: "Artificial Intelligence analyzes your finances and delivers smart insights.",
    aiQuestions: [
      "Where does my money go?",
      "How much can I save monthly?",
      "What is my top spending category?"
    ],
    aiPulseBadge: "✨ AI Assistant",
    aiNlpTitle: "Natural Language AI Tracking",
    aiNlpSub: "Simply type or speak naturally to record expenses",
    aiNlpEx1Label: "You say:",
    aiNlpEx1Text: "“Taxi 25,000 UZS”",
    aiNlpEx1Res: "🚕 Transport • 25,000 UZS",
    aiNlpEx2Label: "You say:",
    aiNlpEx2Text: "“Salary 14 mln”",
    aiNlpEx2Res: "💼 Salary • 14,000,000 UZS",
    trialBadge: "Special Welcome Gift",
    trialTitle: "1-Day Unlimited Premium Trial",
    trialSub: "As a new user, you receive 24 hours of unlimited AI queries and VIP features completely free!",
    trialItem1: "⚡ Unlimited AI queries (no 5/day limit)",
    trialItem2: "📊 Full reports & receipt scanner",
    trialItem3: "⏳ After trial: 5 free AI queries daily",
    readyTitle: "You're All Set!",
    readySub: "Moliya AI will accompany you every step towards financial peace of mind.",
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
  const [step, setStep] = useState<Step>('welcome')
  const [language, setLanguage] = useState<'uz' | 'uz_cyrl' | 'ru' | 'en'>(
    onboarding?.language || 'uz'
  )
  const [selectedGoal, setSelectedGoal] = useState<number>(3000000)
  const [customGoalInput, setCustomGoalInput] = useState('')
  const [isCustomGoal, setIsCustomGoal] = useState(false)
  const [selectedAiQuestion, setSelectedAiQuestion] = useState<number | null>(null)

  const t = translations[language] || translations.uz

  const stepsList: Step[] = ['welcome', 'language', 'goal', 'ai_ask', 'ai_nlp', 'trial', 'ready']
  const currentStepIndex = stepsList.indexOf(step) + 1

  const goNext = () => {
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

    const result: OnboardingResult = {
      language,
      monthlyGoal: goal,
      firstExpense: null,
      monthlyIncome: 0,
      baseBalance: 0,
      name: onboarding?.name || '',
      phone: onboarding?.phone || '',
      telegram: onboarding?.telegram || '',
      telegramId: onboarding?.telegramId || '',
      isPremium: true
    }

    localStorage.setItem('user_onboarding_completed_v1', 'true')
    updateOnboarding(result).catch(() => {})
    onComplete(result)
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

      {/* Main Step Cards (Original Design & Palette) */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <AnimatePresence mode="wait">
          {/* ── STEP 1: Welcome (Moliya AI Imkoniyatlari) ── */}
          {step === 'welcome' && (
            <motion.div
              key="welcome"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}
            >
              <div style={{
                width: 72, height: 72, borderRadius: 24,
                background: 'linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 32, boxShadow: '0 8px 24px rgba(124, 58, 237, 0.3)'
              }}>
                ✨
              </div>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1E1A3C', letterSpacing: -0.4, margin: 0 }}>
                {t.welcomeTitle}
              </h1>
              <p style={{ fontSize: 13, color: '#8B82C4', lineHeight: 1.5, margin: 0, maxWidth: 320 }}>
                {t.welcomeSub}
              </p>

              <div style={{ width: '100%', marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
                <div style={{
                  padding: '12px 14px', borderRadius: 16, background: '#FFFFFF',
                  border: '1.5px solid #E8E3F8', display: 'flex', alignItems: 'center', gap: 10,
                  boxShadow: '0 2px 8px rgba(124, 58, 237, 0.04)'
                }}>
                  <span style={{ fontSize: 18 }}>🎙️</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#1E1A3C' }}>{t.welcomeFeat1}</span>
                </div>
                <div style={{
                  padding: '12px 14px', borderRadius: 16, background: '#FFFFFF',
                  border: '1.5px solid #E8E3F8', display: 'flex', alignItems: 'center', gap: 10,
                  boxShadow: '0 2px 8px rgba(124, 58, 237, 0.04)'
                }}>
                  <span style={{ fontSize: 18 }}>📈</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#1E1A3C' }}>{t.welcomeFeat2}</span>
                </div>
                <div style={{
                  padding: '12px 14px', borderRadius: 16, background: '#FFFFFF',
                  border: '1.5px solid #E8E3F8', display: 'flex', alignItems: 'center', gap: 10,
                  boxShadow: '0 2px 8px rgba(124, 58, 237, 0.04)'
                }}>
                  <span style={{ fontSize: 18 }}>👑</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#7C3AED' }}>{t.welcomeFeat3}</span>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── STEP 2: Language Selection (Original) ── */}
          {step === 'language' && (
            <motion.div
              key="language"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              <div style={{ textAlign: 'center', marginBottom: 4 }}>
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

          {/* ── STEP 3: Moliyaviy Maqsadingiz (Original) ── */}
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 22 }}>{opt.icon}</span>
                        <div style={{ textAlign: 'left' }}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: isSelected ? '#7C3AED' : '#1E1A3C' }}>
                            {opt.amount.toLocaleString('en-US').replace(/,/g, ' ')} {t.perMonth}
                          </div>
                          <div style={{ fontSize: 11, color: '#8B82C4', fontWeight: 600 }}>
                            {t[opt.labelKey as keyof typeof t] as string}
                          </div>
                        </div>
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
                  )
                })}

                {/* Custom Goal Option */}
                <button
                  onClick={() => setIsCustomGoal(true)}
                  style={{
                    width: '100%', padding: '14px 16px', borderRadius: 16,
                    border: isCustomGoal ? '1.5px solid #7C3AED' : '1.5px solid #E8E3F8',
                    background: isCustomGoal ? '#F3EEFF' : '#FFFFFF',
                    cursor: 'pointer', fontFamily: 'inherit',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    boxShadow: isCustomGoal ? '0 4px 12px rgba(124, 58, 237, 0.12)' : '0 2px 6px rgba(0,0,0,0.02)',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 22 }}>✏️</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: isCustomGoal ? '#7C3AED' : '#1E1A3C' }}>
                      {t.customGoal}
                    </span>
                  </div>
                  {isCustomGoal && (
                    <div style={{
                      width: 20, height: 20, borderRadius: 10, background: '#7C3AED',
                      color: '#FFFFFF', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      ✓
                    </div>
                  )}
                </button>

                {isCustomGoal && (
                  <input
                    type="number"
                    placeholder={t.enterAmount}
                    value={customGoalInput}
                    onChange={(e) => setCustomGoalInput(e.target.value)}
                    autoFocus
                    style={{
                      width: '100%', padding: '12px 16px', borderRadius: 14,
                      border: '1.5px solid #7C3AED', background: '#FFFFFF',
                      fontSize: 14, fontWeight: 700, color: '#1E1A3C',
                      outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit'
                    }}
                  />
                )}
              </div>
            </motion.div>
          )}

          {/* ── STEP 4: Pulingiz Haqida Savol Bering (Original) ── */}
          {step === 'ai_ask' && (
            <motion.div
              key="ai_ask"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'center' }}
            >
              <div style={{
                width: 64, height: 64, borderRadius: 22,
                background: 'linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 8px 24px rgba(124, 58, 237, 0.35)', margin: '0 auto'
              }}>
                <span style={{ fontSize: 28 }}>🤖</span>
              </div>

              <div>
                <h1 style={{ fontSize: 21, fontWeight: 700, color: '#1E1A3C', letterSpacing: -0.3, margin: '0 0 4px' }}>
                  {t.askAiTitle}
                </h1>
                <p style={{ fontSize: 13, color: '#8B82C4', lineHeight: 1.4, margin: 0 }}>
                  {t.askAiSub}
                </p>
              </div>

              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                {t.aiQuestions.map((q, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedAiQuestion(idx)}
                    style={{
                      width: '100%', padding: '13px 16px', borderRadius: 16,
                      border: selectedAiQuestion === idx ? '1.5px solid #7C3AED' : '1.5px solid #E8E3F8',
                      background: selectedAiQuestion === idx ? '#F3EEFF' : '#FFFFFF',
                      color: selectedAiQuestion === idx ? '#7C3AED' : '#1E1A3C',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                      textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.02)', transition: 'all 0.2s ease'
                    }}
                  >
                    <span>💬 {q}</span>
                    <span style={{ color: '#7C3AED', fontWeight: 700 }}>→</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* ── STEP 5: Tabiiy Tilda Yozish (New) ── */}
          {step === 'ai_nlp' && (
            <motion.div
              key="ai_nlp"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'center' }}
            >
              <div style={{
                width: 64, height: 64, borderRadius: 22,
                background: 'linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 8px 24px rgba(124, 58, 237, 0.35)', margin: '0 auto'
              }}>
                <span style={{ fontSize: 28 }}>💬</span>
              </div>

              <div>
                <h1 style={{ fontSize: 21, fontWeight: 700, color: '#1E1A3C', letterSpacing: -0.3, margin: '0 0 4px' }}>
                  {t.aiNlpTitle}
                </h1>
                <p style={{ fontSize: 13, color: '#8B82C4', lineHeight: 1.4, margin: 0 }}>
                  {t.aiNlpSub}
                </p>
              </div>

              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
                <div style={{
                  padding: '14px', borderRadius: 16, background: '#FFFFFF',
                  border: '1.5px solid #E8E3F8', boxShadow: '0 2px 8px rgba(124, 58, 237, 0.04)'
                }}>
                  <div style={{ fontSize: 11, color: '#8B82C4', fontWeight: 600, marginBottom: 2 }}>
                    {t.aiNlpEx1Label}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1E1A3C', marginBottom: 8 }}>
                    {t.aiNlpEx1Text}
                  </div>
                  <div style={{
                    paddingTop: 8, borderTop: '1px solid #F3EEFF',
                    fontSize: 12, fontWeight: 700, color: '#7C3AED', display: 'flex', alignItems: 'center', gap: 6
                  }}>
                    {t.aiNlpEx1Res}
                  </div>
                </div>

                <div style={{
                  padding: '14px', borderRadius: 16, background: '#FFFFFF',
                  border: '1.5px solid #E8E3F8', boxShadow: '0 2px 8px rgba(124, 58, 237, 0.04)'
                }}>
                  <div style={{ fontSize: 11, color: '#8B82C4', fontWeight: 600, marginBottom: 2 }}>
                    {t.aiNlpEx2Label}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1E1A3C', marginBottom: 8 }}>
                    {t.aiNlpEx2Text}
                  </div>
                  <div style={{
                    paddingTop: 8, borderTop: '1px solid #F3EEFF',
                    fontSize: 12, fontWeight: 700, color: '#10B981', display: 'flex', alignItems: 'center', gap: 6
                  }}>
                    {t.aiNlpEx2Res}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── STEP 6: 1 Kunlik Cheksiz Premium Sinovi (New) ── */}
          {step === 'trial' && (
            <motion.div
              key="trial"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'center', alignItems: 'center' }}
            >
              <div style={{
                width: 72, height: 72, borderRadius: 24,
                background: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 8px 24px rgba(245, 158, 11, 0.35)', fontSize: 32
              }}>
                👑
              </div>

              <div>
                <span style={{
                  display: 'inline-block', padding: '4px 10px', borderRadius: 20,
                  background: '#FEF3C7', color: '#B45309', fontSize: 11, fontWeight: 800,
                  textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6
                }}>
                  {t.trialBadge}
                </span>
                <h1 style={{ fontSize: 21, fontWeight: 800, color: '#1E1A3C', letterSpacing: -0.3, margin: '0 0 4px' }}>
                  {t.trialTitle}
                </h1>
                <p style={{ fontSize: 13, color: '#8B82C4', lineHeight: 1.4, margin: 0, maxWidth: 320 }}>
                  {t.trialSub}
                </p>
              </div>

              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
                <div style={{
                  padding: '12px 14px', borderRadius: 16, background: '#FFFFFF',
                  border: '1.5px solid #E8E3F8', fontSize: 13, fontWeight: 600, color: '#1E1A3C'
                }}>
                  {t.trialItem1}
                </div>
                <div style={{
                  padding: '12px 14px', borderRadius: 16, background: '#FFFFFF',
                  border: '1.5px solid #E8E3F8', fontSize: 13, fontWeight: 600, color: '#1E1A3C'
                }}>
                  {t.trialItem2}
                </div>
                <div style={{
                  padding: '12px 14px', borderRadius: 16, background: '#FFFFFF',
                  border: '1.5px solid #E8E3F8', fontSize: 12, fontWeight: 500, color: '#8B82C4'
                }}>
                  {t.trialItem3}
                </div>
              </div>
            </motion.div>
          )}

          {/* ── STEP 7: Boshlashga Tayyorsiz! (New) ── */}
          {step === 'ready' && (
            <motion.div
              key="ready"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'center', alignItems: 'center' }}
            >
              <div style={{
                width: 72, height: 72, borderRadius: 24,
                background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 8px 24px rgba(16, 185, 129, 0.35)', fontSize: 34
              }}>
                🚀
              </div>

              <div>
                <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1E1A3C', letterSpacing: -0.3, margin: '0 0 6px' }}>
                  {t.readyTitle}
                </h1>
                <p style={{ fontSize: 13, color: '#8B82C4', lineHeight: 1.5, margin: 0, maxWidth: 320 }}>
                  {t.readySub}
                </p>
              </div>

              <div style={{
                width: '100%', padding: '16px', borderRadius: 18,
                background: '#ECFDF5', border: '1.5px solid #A7F3D0',
                color: '#065F46', fontSize: 13, fontWeight: 600, textAlign: 'center'
              }}>
                ✨ Birinchi xarajatingizni birgalikda kiritamiz!
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom Action Button (Original Purple Gradient) */}
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
      </div>
    </div>
  )
}
