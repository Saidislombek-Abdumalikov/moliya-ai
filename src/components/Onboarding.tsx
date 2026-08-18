import { useState } from 'react'
import { motion } from 'motion/react'

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
  completed?: boolean
  notifications?: { opt1: boolean; opt2: boolean; opt3: boolean }
}

interface Props {
  onComplete: (result: OnboardingResult) => void
}

type Step = 'language' | 'goal' | 'ai'

const languages: { code: 'uz' | 'uz_cyrl' | 'ru' | 'en'; label: string; tag: string }[] = [
  { code: 'uz', label: "O'zbekcha", tag: '🇺🇿' },
  { code: 'ru', label: 'Русский', tag: '🇷🇺' },
  { code: 'en', label: 'English', tag: '🇺🇸' },
]

const uzbekScriptTypes: { code: 'uz' | 'uz_cyrl'; label: string; sublabel: string }[] = [
  { code: 'uz', label: 'Lotin', sublabel: "A B C D" },
  { code: 'uz_cyrl', label: 'Кирилл', sublabel: "А Б В Г" },
]

const translations = {
  uz: {
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
    startApp: "Boshlash 🚀",
  },
  uz_cyrl: {
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
    startApp: "Бошлаш 🚀",
  },
  ru: {
    selectLanguage: "Выберите язык",
    selectLangSub: "Пожалуйста, выберите язык приложения",
    setGoalTitle: "Финансовая цель",
    setGoalSub: "Сколько вы планируете экономить каждый месяц?",
    starter: "Начальный",
    recommended: "Рекомендуется",
    intensive: "Интенсивный",
    perMonth: "сум / месяц",
    customGoal: "Ввести вручную",
    otherAmount: "Другая сумма",
    enterAmount: "Введите сумму",
    saveGoalBtn: "Сохранить цель →",
    continueBtn: "Продолжить →",
    askAiTitle: "Задайте вопрос о финансах",
    askAiSub: "Искусственный интеллект проанализирует расходы и даст полезные советы.",
    aiQuestions: [
      "Куда уходят мои деньги?",
      "Сколько я могу сэкономить в месяц?",
      "Моя самая крупная категория расходов?"
    ],
    startApp: "Начать 🚀",
  },
  en: {
    selectLanguage: "Select Language",
    selectLangSub: "Please select your preferred language",
    setGoalTitle: "Financial Goal",
    setGoalSub: "How much do you plan to save each month?",
    starter: "Starter",
    recommended: "Recommended",
    intensive: "Intensive",
    perMonth: "UZS / month",
    customGoal: "Set custom goal",
    otherAmount: "Other amount",
    enterAmount: "Enter amount",
    saveGoalBtn: "Save goal →",
    continueBtn: "Continue →",
    askAiTitle: "Ask about your money",
    askAiSub: "Artificial intelligence analyzes your expenses and gives smart financial advice.",
    aiQuestions: [
      "Where is my money going?",
      "How much can I save monthly?",
      "What is my highest spending category?"
    ],
    startApp: "Get Started 🚀",
  },
}

const goalOptions = [
  { key: 'starter', value: 500000, recommended: false },
  { key: 'recommended', value: 1000000, recommended: true },
  { key: 'intensive', value: 2000000, recommended: false },
]

const aiQuestionsIcons = ['📊', '💡', '🏷️']

const fmtMoney = (val: number) => val.toLocaleString('en-US').replace(/,/g, ' ')

export default function Onboarding({ onComplete }: Props) {
  const [step, setStep] = useState<Step>('language')
  const [language, setLanguage] = useState<'uz' | 'uz_cyrl' | 'ru' | 'en'>('uz')
  const [goal, setGoal] = useState<number>(1000000)
  const [customGoal, setCustomGoal] = useState('')
  const [useCustomGoal, setUseCustomGoal] = useState(false)

  const t = translations[language] || translations.uz
  const steps: Step[] = ['language', 'goal', 'ai']
  const stepIndex = steps.indexOf(step)
  const progressPct = Math.round(((stepIndex + 1) / steps.length) * 100)
  const finalGoal = useCustomGoal ? Number(customGoal.replace(/\D/g, '')) || 0 : goal

  const goNext = () => {
    if (step === 'language') setStep('goal')
    else if (step === 'goal') setStep('ai')
    else if (step === 'ai') finish()
  }

  const goBack = () => {
    if (step === 'goal') setStep('language')
    else if (step === 'ai') setStep('goal')
  }

  const finish = () => {
    onComplete({
      language,
      monthlyGoal: finalGoal,
      firstExpense: null,
    })
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        maxWidth: 430,
        margin: '0 auto',
        background: 'linear-gradient(180deg, #F7F5FF 0%, #EFEBFF 100%)',
        display: 'flex',
        flexDirection: 'column',
        padding: '0 20px 24px',
        boxSizing: 'border-box'
      }}
    >
      {/* Top bar */}
      <div style={{ padding: '16px 0 8px', display: 'flex', alignItems: 'center', gap: 14 }}>
        {step !== 'language' && (
          <button
            onClick={goBack}
            style={{
              width: 32, height: 32, borderRadius: 12, border: 'none',
              background: 'rgba(255,255,255,0.6)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8L10 13" stroke="#5B21B6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.7)', overflow: 'hidden' }}>
          <div
            style={{
              width: `${progressPct}%`, height: '100%', borderRadius: 3,
              background: 'linear-gradient(90deg, #7C3AED, #A855F7)',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#7C3AED', width: 34, textAlign: 'right' }}>
          {stepIndex + 1}/{steps.length}
        </span>
      </div>

      {/* Main step content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '12px 0' }}>
        {/* STEP 1: Select Language */}
        {step === 'language' && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              <img
                src="/logo.png"
                alt="Moliya AI"
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 20,
                  objectFit: 'cover',
                  boxShadow: '0 10px 28px rgba(124, 58, 237, 0.3)',
                  border: '2px solid rgba(124, 58, 237, 0.2)',
                  display: 'block'
                }}
              />
            </div>

            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1E1A3C', textAlign: 'center', letterSpacing: -0.4, marginBottom: 2 }}>
              Moliya AI
            </h1>
            <p style={{ fontSize: 13, color: '#8B82C4', textAlign: 'center', marginBottom: 20 }}>
              {t.selectLangSub}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {languages.map((l) => {
                const isUzbek = l.code === 'uz'
                const isUzbekSelected = language === 'uz' || language === 'uz_cyrl'
                const active = isUzbek ? isUzbekSelected : language === l.code
                return (
                  <div key={l.code}>
                    <button
                      onClick={() => {
                        if (isUzbek) {
                          if (!isUzbekSelected) {
                            setLanguage('uz')
                            localStorage.setItem('user_selected_language_v1', 'uz')
                          }
                        } else {
                          setLanguage(l.code)
                          localStorage.setItem('user_selected_language_v1', l.code)
                        }
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '14px 18px', borderRadius: 16, width: '100%',
                        border: active ? '1.5px solid #7C3AED' : '1px solid #E8E3F8',
                        background: '#FFFFFF',
                        boxShadow: active ? '0 4px 16px rgba(124, 58, 237, 0.12)' : 'none',
                        cursor: 'pointer', fontFamily: 'inherit',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 22 }}>{l.tag}</span>
                        <span style={{ fontSize: 15, fontWeight: 600, color: '#1E1A3C' }}>
                          {l.label}
                        </span>
                      </div>

                      <div style={{
                        width: 20, height: 20, borderRadius: '50%',
                        border: active ? 'none' : '1.5px solid #DDD6FE',
                        background: active ? '#7C3AED' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {active && (
                          <svg width="10" height="10" viewBox="0 0 11 11" fill="none">
                            <path d="M2 5.5L4.5 8L9.5 3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                    </button>

                    {/* Uzbek script type sub-options */}
                    {isUzbek && isUzbekSelected && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 8, paddingLeft: 8 }}>
                        {uzbekScriptTypes.map((st) => {
                          const stActive = language === st.code
                          return (
                            <button
                              key={st.code}
                              onClick={() => { setLanguage(st.code); localStorage.setItem('user_selected_language_v1', st.code); }}
                              style={{
                                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                                gap: 4, padding: '10px 8px', borderRadius: 12,
                                border: stActive ? '1.5px solid #7C3AED' : '1px solid #E8E3F8',
                                background: stActive ? '#F5F3FF' : '#FFFFFF',
                                cursor: 'pointer', fontFamily: 'inherit',
                              }}
                            >
                              <span style={{ fontSize: 13, fontWeight: 700, color: stActive ? '#7C3AED' : '#1E1A3C' }}>
                                {st.label}
                              </span>
                              <span style={{ fontSize: 10, color: '#8B82C4', letterSpacing: 1 }}>
                                {st.sublabel}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </motion.div>
        )}

        {/* STEP 2: Financial Goal */}
        {step === 'goal' && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1E1A3C', textAlign: 'center', letterSpacing: -0.3, marginBottom: 4, lineHeight: 1.25 }}>
              {t.setGoalTitle}
            </h1>
            <p style={{ fontSize: 13, color: '#8B82C4', textAlign: 'center', marginBottom: 14 }}>
              {t.setGoalSub}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {goalOptions.map((g) => {
                const active = !useCustomGoal && goal === g.value
                return (
                  <button
                    key={g.key}
                    onClick={() => { setGoal(g.value); setUseCustomGoal(false) }}
                    style={{
                      textAlign: 'left', padding: '12px 16px', borderRadius: 16,
                      border: active ? '1.5px solid #7C3AED' : '1px solid #E8E3F8',
                      background: '#FFFFFF',
                      boxShadow: active ? '0 4px 16px rgba(124,58,237,0.12)' : 'none',
                      cursor: 'pointer', fontFamily: 'inherit', position: 'relative',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 6,
                        background: g.recommended ? '#EDE9FE' : '#F3F0FF',
                        color: g.recommended ? '#7C3AED' : '#8B82C4',
                      }}>
                        {g.key === 'starter' ? t.starter : g.key === 'recommended' ? t.recommended : t.intensive}
                      </span>
                      <div style={{
                        width: 20, height: 20, borderRadius: '50%',
                        border: active ? 'none' : '1.5px solid #DDD6FE',
                        background: active ? '#7C3AED' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        {active && (
                          <svg width="10" height="10" viewBox="0 0 11 11" fill="none">
                            <path d="M2 5.5L4.5 8L9.5 3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                    </div>
                    <p style={{ fontSize: 20, fontWeight: 700, color: active ? '#7C3AED' : '#1E1A3C', marginTop: 4, letterSpacing: -0.5 }}>
                      {fmtMoney(g.value)} <span style={{ fontSize: 12, fontWeight: 500, color: '#8B82C4' }}>{t.perMonth}</span>
                    </p>
                  </button>
                )
              })}

              <button
                onClick={() => setUseCustomGoal(true)}
                style={{
                  textAlign: 'left', padding: '12px 16px', borderRadius: 16,
                  border: useCustomGoal ? '1.5px solid #7C3AED' : '1.5px dashed #C4BDE8',
                  background: useCustomGoal ? '#FFFFFF' : 'transparent',
                  cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                }}
              >
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: '#1E1A3C', marginBottom: 2 }}>{t.customGoal}</p>
                  {useCustomGoal ? (
                    <input
                      autoFocus
                      type="tel"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder={t.enterAmount}
                      value={customGoal ? Number(customGoal).toLocaleString('en-US').replace(/,/g, ' ') : ''}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setCustomGoal(e.target.value.replace(/\D/g, ''))}
                      style={{
                        fontSize: 13, color: '#7C3AED', fontFamily: 'inherit',
                        border: 'none', outline: 'none', background: 'transparent', width: '100%', padding: 0,
                      }}
                    />
                  ) : (
                    <p style={{ fontSize: 12, color: '#8B82C4' }}>{t.otherAmount}</p>
                  )}
                </div>
                <div style={{
                  width: 28, height: 28, borderRadius: 8, background: '#F7F5FF',
                  border: '1px solid #E8E3F8', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', flexShrink: 0,
                }}>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <path d="M11 2L14 5L5.5 13.5L2 14L2.5 10.5L11 2Z" stroke="#7C3AED" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </button>
            </div>
          </motion.div>
        )}

        {/* STEP 3: AI Feature Overview */}
        {step === 'ai' && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}
          >
            <div style={{
              width: 56, height: 56, borderRadius: 20,
              background: 'linear-gradient(135deg, #7C3AED 0%, #A855F7 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 8px 24px rgba(124,58,237,0.3)', marginBottom: 8,
            }}>
              <span style={{ fontSize: 26 }}>✨</span>
            </div>

            <h1 style={{ fontSize: 21, fontWeight: 700, color: '#1E1A3C', textAlign: 'center', letterSpacing: -0.3, marginBottom: 2 }}>
              {t.askAiTitle}
            </h1>
            <p style={{ fontSize: 12, color: '#8B82C4', textAlign: 'center', marginBottom: 14, maxWidth: 300, lineHeight: 1.35 }}>
              {t.askAiSub}
            </p>

            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {t.aiQuestions.map((q, idx) => (
                <div
                  key={q}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 14px', borderRadius: 14,
                    background: '#FFFFFF', border: '1px solid #E8E3F8',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
                  }}
                >
                  <span style={{ fontSize: 18 }}>{aiQuestionsIcons[idx]}</span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#1E1A3C' }}>{q}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>

      {/* Bottom Action Button */}
      <button
        onClick={goNext}
        style={{
          width: '100%',
          padding: '15px 18px',
          borderRadius: 16,
          border: 'none',
          background: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)',
          color: '#FFFFFF',
          fontSize: 15,
          fontWeight: 700,
          cursor: 'pointer',
          fontFamily: 'inherit',
          boxShadow: '0 6px 20px rgba(124, 58, 237, 0.35)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          marginTop: 'auto',
        }}
      >
        <span>{step === 'ai' ? t.startApp : t.continueBtn}</span>
      </button>
    </div>
  )
}
