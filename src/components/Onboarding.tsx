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

type StepIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export default function Onboarding({ onComplete }: Props) {
  const { onboarding, updateOnboarding } = useFinance()
  const [step, setStep] = useState<StepIndex>(1)
  const [selectedLang, setSelectedLang] = useState<'uz' | 'uz_cyrl' | 'ru' | 'en'>(
    onboarding?.language || 'uz'
  )

  const handleNext = () => {
    if (step < 8) {
      setStep((prev) => (prev + 1) as StepIndex)
    } else {
      handleFinish()
    }
  }

  const handleBack = () => {
    if (step > 1) {
      setStep((prev) => (prev - 1) as StepIndex)
    }
  }

  const handleFinish = () => {
    const result: OnboardingResult = {
      language: selectedLang,
      monthlyGoal: 1000000,
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
    <div className="fixed inset-0 z-50 flex flex-col justify-between bg-[#0F172A] text-white select-none overflow-hidden">
      {/* Background Decorative Gradients */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-96 h-96 bg-emerald-600/15 rounded-full blur-3xl pointer-events-none" />

      {/* Top Header & Progress Dots */}
      <header className="relative z-10 px-6 pt-12 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center font-bold text-sm shadow-lg shadow-indigo-500/25">
            M
          </div>
          <span className="font-bold tracking-tight text-slate-100">Moliya AI</span>
        </div>

        {/* Progress Pills */}
        <div className="flex items-center gap-1.5">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
            <div
              key={s}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                s === step
                  ? 'w-6 bg-indigo-500 shadow-sm shadow-indigo-500/50'
                  : s < step
                  ? 'w-2 bg-indigo-400/60'
                  : 'w-2 bg-slate-700'
              }`}
            />
          ))}
        </div>
      </header>

      {/* Main Step Cards (Animated Transitions) */}
      <main className="relative z-10 flex-1 flex flex-col justify-center px-6 py-4 max-w-md mx-auto w-full">
        <AnimatePresence mode="wait">
          {/* ── STEP 1: Welcome ── */}
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="text-center"
            >
              <div className="w-24 h-24 mx-auto mb-6 rounded-3xl bg-gradient-to-tr from-indigo-500/20 to-violet-500/20 border border-indigo-500/30 flex items-center justify-center text-4xl shadow-xl shadow-indigo-500/10">
                ✨
              </div>
              <h1 className="text-2xl font-bold text-slate-50 mb-3">
                Moliya AI ga xush kelibsiz!
              </h1>
              <p className="text-slate-400 text-sm leading-relaxed mb-6">
                Shaxsiy moliyangizni sun'iy intellekt yordamida oson, tezkor va professional nazorat qiling.
              </p>
              <div className="p-4 rounded-2xl bg-slate-800/60 border border-slate-700/60 text-left text-xs text-slate-300 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-indigo-400 font-bold">✓</span> Ovozli va matnli xarajatlarni avtomatik hisoblash
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-indigo-400 font-bold">✓</span> To'liq oylik va yillik tahlillar
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-indigo-400 font-bold">✓</span> 1 kunlik cheksiz Premium va AI imkoniyati
                </div>
              </div>
            </motion.div>
          )}

          {/* ── STEP 2: Language Selection ── */}
          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
            >
              <div className="text-center mb-6">
                <div className="text-3xl mb-2">🌐</div>
                <h2 className="text-xl font-bold text-slate-50">Dastur tilini tanlang</h2>
                <p className="text-slate-400 text-xs mt-1">O'zingizga qulay tilni tanlang</p>
              </div>

              <div className="space-y-2.5">
                {[
                  { code: 'uz' as const, label: "O'zbekcha (Lotin)", flag: '🇺🇿' },
                  { code: 'uz_cyrl' as const, label: 'Ўзбекча (Кирилл)', flag: '🇺🇿' },
                  { code: 'ru' as const, label: 'Русский', flag: '🇷🇺' },
                  { code: 'en' as const, label: 'English', flag: '🇺🇸' }
                ].map((l) => (
                  <button
                    key={l.code}
                    onClick={() => setSelectedLang(l.code)}
                    className={`w-full p-4 rounded-2xl border transition-all flex items-center justify-between ${
                      selectedLang === l.code
                        ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-lg shadow-indigo-500/10'
                        : 'bg-slate-800/40 border-slate-700/60 text-slate-300 hover:bg-slate-800/70'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{l.flag}</span>
                      <span className="font-semibold text-sm">{l.label}</span>
                    </div>
                    {selectedLang === l.code && (
                      <div className="w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center text-xs">
                        ✓
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* ── STEP 3: What Moliya Does ── */}
          {step === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="text-center"
            >
              <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-3xl">
                💰
              </div>
              <h2 className="text-xl font-bold text-slate-50 mb-3">
                Daromad va xarajatlar nazorati
              </h2>
              <p className="text-slate-400 text-sm leading-relaxed mb-6">
                Har bir sarflangan so'm va kelgan daromadlarni bir joyda xavfsiz tartibga soling.
              </p>
              <div className="grid grid-cols-2 gap-3 text-left">
                <div className="p-3.5 rounded-2xl bg-slate-800/60 border border-slate-700/60">
                  <div className="text-emerald-400 font-bold text-xs mb-1">🟢 Daromadlar</div>
                  <div className="text-slate-300 text-xs">Oylik, biznes, keshbek va sovg'alar</div>
                </div>
                <div className="p-3.5 rounded-2xl bg-slate-800/60 border border-slate-700/60">
                  <div className="text-rose-400 font-bold text-xs mb-1">🔴 Xarajatlar</div>
                  <div className="text-slate-300 text-xs">Bozor, taksi, ovqat, ijara va kiyim</div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── STEP 4: AI Natural Language Tracking ── */}
          {step === 4 && (
            <motion.div
              key="step4"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
            >
              <div className="text-center mb-6">
                <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-2xl">
                  🤖
                </div>
                <h2 className="text-xl font-bold text-slate-50">Tabiiy tilda AI tahlil</h2>
                <p className="text-slate-400 text-xs mt-1">Oddiy so'zlar bilan yozsangiz yetarli</p>
              </div>

              <div className="space-y-3">
                <div className="p-3 rounded-2xl bg-slate-800/70 border border-slate-700 text-xs">
                  <div className="text-slate-400 mb-1">Siz yozasiz:</div>
                  <div className="text-slate-100 font-medium italic">"Bugun taksiga 30 ming sarfladim"</div>
                  <div className="mt-2 pt-2 border-t border-slate-700/80 flex items-center justify-between text-indigo-300">
                    <span>🚕 Transport</span>
                    <span className="font-bold text-slate-100">30 000 so'm</span>
                  </div>
                </div>

                <div className="p-3 rounded-2xl bg-slate-800/70 border border-slate-700 text-xs">
                  <div className="text-slate-400 mb-1">Siz yozasiz:</div>
                  <div className="text-slate-100 font-medium italic">"14 mln maosh tushdi"</div>
                  <div className="mt-2 pt-2 border-t border-slate-700/80 flex items-center justify-between text-emerald-400">
                    <span>💼 Maosh</span>
                    <span className="font-bold text-slate-100">14 000 000 so'm</span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── STEP 5: Dashboard Overview ── */}
          {step === 5 && (
            <motion.div
              key="step5"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="text-center"
            >
              <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center text-3xl">
                📊
              </div>
              <h2 className="text-xl font-bold text-slate-50 mb-3">
                Qulay Dashboard va Tahlillar
              </h2>
              <p className="text-slate-400 text-sm leading-relaxed mb-6">
                Barcha kartalaringiz, oylik hisobotlar va toifalar bo'yicha sarflangan mablag'lar diagrammalarda.
              </p>
              <div className="p-4 rounded-2xl bg-slate-800/60 border border-slate-700/60 text-left text-xs text-slate-300 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-violet-400 font-bold">💳</span> Uzcard, Humo, Visa kartalari
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-violet-400 font-bold">📈</span> Oylik sarf-xarajat statistikasi
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-violet-400 font-bold">📄</span> PDF va Excel hisobotlarni yuklab olish
                </div>
              </div>
            </motion.div>
          )}

          {/* ── STEP 6: Voice Recording ── */}
          {step === 6 && (
            <motion.div
              key="step6"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="text-center"
            >
              <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-tr from-rose-500/20 to-orange-500/20 border border-rose-500/30 flex items-center justify-center text-4xl shadow-xl shadow-rose-500/10">
                🎙
              </div>
              <h2 className="text-xl font-bold text-slate-50 mb-3">
                OvozYozman — Ovoz bilan kiritish
              </h2>
              <p className="text-slate-400 text-sm leading-relaxed mb-6">
                Telegram botda yoki dastur ichida ovozli xabar yuboring — AI bir necha soniyada xarajatni to'g'ri qayd qiladi.
              </p>
              <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 font-medium">
                ⚡ Hech qanday murakkab shakllarsiz — faqat gapiring!
              </div>
            </motion.div>
          )}

          {/* ── STEP 7: 1-Day Unlimited Premium Trial ── */}
          {step === 7 && (
            <motion.div
              key="step7"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="text-center"
            >
              <div className="w-24 h-24 mx-auto mb-6 rounded-3xl bg-gradient-to-tr from-amber-500/20 to-yellow-500/20 border border-amber-500/40 flex items-center justify-center text-4xl shadow-xl shadow-amber-500/15">
                👑
              </div>
              <span className="inline-block px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-bold uppercase tracking-wider mb-2">
                Maxsus Sovg'a
              </span>
              <h2 className="text-xl font-bold text-slate-50 mb-3">
                1 Kunlik Cheksiz Premium Sinovi
              </h2>
              <p className="text-slate-400 text-sm leading-relaxed mb-6">
                Yangi foydalanuvchimiz bo'lganingiz uchun sizga 24 soat davomida barcha AI imkoniyatlari mutlaqo bepul va cheksiz berildi!
              </p>
              <div className="p-3 rounded-2xl bg-slate-800/60 border border-slate-700/60 text-xs text-slate-300 text-left space-y-1.5">
                <div>⚡ <b>Cheksiz AI so'rovlar</b> (kunlik 5 ta cheklovisiz)</div>
                <div>📊 <b>To'liq tahlil va chek skaner</b></div>
                <div>⏳ Sinovdan so'ng: kuniga 5 ta bepul AI so'rovi</div>
              </div>
            </motion.div>
          )}

          {/* ── STEP 8: Ready to Launch! ── */}
          {step === 8 && (
            <motion.div
              key="step8"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="text-center"
            >
              <div className="w-24 h-24 mx-auto mb-6 rounded-3xl bg-gradient-to-tr from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 flex items-center justify-center text-4xl shadow-xl shadow-emerald-500/10">
                🚀
              </div>
              <h2 className="text-2xl font-bold text-slate-50 mb-3">
                Boshlashga tayyorsiz!
              </h2>
              <p className="text-slate-400 text-sm leading-relaxed mb-6">
                Moliya AI sizning moliyaviy barqarorligingiz va oqilona tejamkorligingiz yo'lida doimo yordamchi bo'ladi.
              </p>
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold">
                ✨ Keling, birinchi xarajatingizni birgalikda kiritamiz!
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Bottom Navigation Buttons */}
      <footer className="relative z-10 p-6 flex items-center gap-3 max-w-md mx-auto w-full">
        {step > 1 && (
          <button
            onClick={handleBack}
            className="px-5 py-3.5 rounded-2xl bg-slate-800 border border-slate-700 text-slate-300 font-semibold text-sm hover:bg-slate-700 transition"
          >
            ←
          </button>
        )}
        <button
          onClick={handleNext}
          className="flex-1 py-3.5 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-bold text-sm shadow-lg shadow-indigo-500/25 hover:from-indigo-500 hover:to-violet-500 transition active:scale-[0.98]"
        >
          {step === 8 ? "Dasturni Boshlash 🚀" : "Davom etish →"}
        </button>
      </footer>
    </div>
  )
}
