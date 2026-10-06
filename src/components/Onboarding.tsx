import { useState, useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { useFinance, isValidPhoneNumber } from '../FinanceContext'
import { telegramBotLink, telegramBotDeepLink } from '../telegramLinks'

export interface OnboardingResult {
  assistant_draft?: {id:string;reply:import('../../shared/assistant').AssistantReply}|null
  voice_auto_send?: boolean
  remember_categories?: boolean
  category_preferences?: import('../../shared/assistant').CategoryPreference[]
  planned_payments?: import('../../shared/plannedPayments').PlannedPayment[]
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
  account_created_at?: string
  tour_completed?: boolean
  notifications?: { opt1: boolean; opt2: boolean; opt3: boolean; reminderFrequency?: 'daily' | 'weekly' | 'off'; reminderSlot?: 'morning' | 'afternoon' | 'evening' }
  registration_status?: string
  oferta_accepted?: boolean
  privacy_consent?: {
    accepted: boolean
    accepted_at: string
    policy_version: string
  }
}

const translations = {
  uz: {
    appTitle: "Moliya AI",
    badge: "Bot orqali faollashtirish",
    titleBoth: "Ro'yxatdan o'tishni yakunlang",
    subBoth: "Moliya AI xizmatlaridan foydalanish uchun rasmiy Telegram botimiz orqali ro'yxatdan o'tish talab etiladi.",
    titlePhone: "Telefon raqamingizni tasdiqlang",
    subPhone: "Hisobingizni to'liq faollashtirish uchun Telegram botda telefon raqamingizni yuboring.",
    titleOferta: "Foydalanish shartlariga rozilik",
    subOferta: "Davom etish uchun Telegram botda Ommaviy oferta shartlariga rozilik bildiring.",
    ofertaLabel: "Ommaviy oferta va shartlar",
    phoneLabel: "Shaxsiy telefon raqami",
    done: "Tasdiqlangan",
    pending: "Kutilmoqda (Botda)",
    benefitTitle: "7 Kunlik Cheksiz VIP Premium!",
    benefitSub: "Botda tasdiqlash yakunlangach, barcha AI imkoniyatlari darhol ishga tushadi.",
    continueBtn: "Telegram botda davom etish ✈️",
    checkBtn: "Holatni tekshirish 🔄",
    checking: "Tekshirilmoqda...",
    notYetVerified: "Botda tasdiqlash hali yakunlanmagan. Iltimos, avval botdagi ko'rsatmalarni bajaring.",
    securityNotice: "Barcha ma'lumotlaringiz shifrlangan va xavfsiz saqlanadi."
  },
  uz_cyrl: {
    appTitle: "Moliya AI",
    badge: "Бот орқали фаоллаштириш",
    titleBoth: "Рўйхатдан ўтишни якунланг",
    subBoth: "Moliya AI хизматларидан фойдаланиш учун расмий Telegram ботимиз орқали рўйхатдан ўтинг.",
    titlePhone: "Телефон рақамингизни тасдиқланг",
    subPhone: "Ҳисобингизни тўлиқ фаоллаштириш учун Telegram ботда телефон рақамингизни юборинг.",
    titleOferta: "Фойдаланиш шартларига розилик",
    subOferta: "Давом этиш учун Telegram ботда Оммавий оферта шартларига розилик билдиринг.",
    ofertaLabel: "Оммавий оферта ва шартлар",
    phoneLabel: "Шахсий телефон рақами",
    done: "Тасдиқланган",
    pending: "Кутилмоқда (Ботда)",
    benefitTitle: "7 Кунлик Чексиз VIP Premium!",
    benefitSub: "Ботда тасдиқлаш якунлангач, барча AI имкониятлари дарҳол ишга тушади.",
    continueBtn: "Telegram ботда давом этиш ✈️",
    checkBtn: "Ҳолатни текшириш 🔄",
    checking: "Текширилмоқда...",
    notYetVerified: "Ботда тасдиқлаш ҳали якунланмаган. Илтимос, аввал ботдаги кўрсатмаларни бажаринг.",
    securityNotice: "Барча маълумотларингиз шифрланган ва хавфсиз сақланади."
  },
  ru: {
    appTitle: "Moliya AI",
    badge: "Активация через бота",
    titleBoth: "Завершите регистрацию",
    subBoth: "Для использования сервиса Moliya AI завершите регистрацию в официальном Telegram-боте.",
    titlePhone: "Подтвердите номер телефона",
    subPhone: "Для полной активации профиля отправьте ваш номер телефона в Telegram-боте.",
    titleOferta: "Согласие с условиями оферты",
    subOferta: "Для продолжения примите условия Публичной оферты в Telegram-боте.",
    ofertaLabel: "Публичная оферта",
    phoneLabel: "Номер телефона",
    done: "Подтверждено",
    pending: "Ожидается (в боте)",
    benefitTitle: "7 Дней Безлимитного VIP Premium!",
    benefitSub: "После завершения в боте вам сразу откроются все функции искусственного интеллекта.",
    continueBtn: "Продолжить в Telegram боте ✈️",
    checkBtn: "Проверить статус 🔄",
    checking: "Проверка...",
    notYetVerified: "Регистрация в боте еще не завершена. Пожалуйста, выполните указания в боте.",
    securityNotice: "Все ваши данные зашифрованы и надежно защищены."
  },
  en: {
    appTitle: "Moliya AI",
    badge: "Bot-Verified Activation",
    titleBoth: "Complete Your Registration",
    subBoth: "To start using Moliya AI, please complete registration in our official Telegram bot.",
    titlePhone: "Confirm Your Phone Number",
    subPhone: "To activate your account, please send your phone number in the Telegram bot.",
    titleOferta: "Terms of Service Agreement",
    subOferta: "Please agree to the Public Offer terms in the Telegram bot to continue.",
    ofertaLabel: "Public Offer & Terms",
    phoneLabel: "Verified Phone Number",
    done: "Verified",
    pending: "Pending (in Bot)",
    benefitTitle: "7-Day Unlimited VIP Premium!",
    benefitSub: "Once verified in the bot, all AI financial capabilities unlock immediately.",
    continueBtn: "Continue in Telegram Bot ✈️",
    checkBtn: "Check Status 🔄",
    checking: "Checking...",
    notYetVerified: "Verification in the bot is still pending. Please complete the instructions in the bot.",
    securityNotice: "All your data is encrypted and securely stored."
  }
}

export default function Onboarding() {
  const { onboarding, refreshUserData } = useFinance()
  const [isChecking, setIsChecking] = useState(false)
  const [checkFeedback, setCheckFeedback] = useState<string | null>(null)

  const language = (onboarding?.language as 'uz' | 'uz_cyrl' | 'ru' | 'en') || 'uz'
  const t = translations[language] || translations.uz

  const hasValidPhone = Boolean(onboarding?.phone && isValidPhoneNumber(onboarding.phone))
  const hasAcceptedOferta = Boolean(
    onboarding?.oferta_accepted === true ||
    (onboarding as any)?.privacy_consent?.accepted === true
  )

  const handleOpenTelegramBot = () => {
    const botUrl = telegramBotLink('verify')
    const tgDeepLink = telegramBotDeepLink('verify')
    const tg = (window as any).Telegram?.WebApp

    if (tg?.openTelegramLink) {
      tg.openTelegramLink(botUrl)
    } else {
      const isMobile = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
      if (isMobile) {
        window.location.href = tgDeepLink
      } else {
        window.open(botUrl, '_blank', 'noopener,noreferrer')
      }
    }
  }

  const checkStatus = async () => {
    if (isChecking) return
    setIsChecking(true)
    setCheckFeedback(null)
    try {
      const freshUser = await refreshUserData()
      if (!freshUser) return
      if (freshUser?.onboarding?.completed === true) return
      setCheckFeedback(t.notYetVerified)
    } catch (err) {
      console.warn('[ONBOARDING] Status check error:', err)
      setCheckFeedback(t.notYetVerified)
    } finally {
      setIsChecking(false)
    }
  }

  // Returning from bot verification refreshes the existing screen without a reload.
  const refreshRef = useRef(refreshUserData);
  refreshRef.current = refreshUserData;
  useEffect(() => {
    let busy=false;
    const check=async()=>{if(busy||document.visibilityState==='hidden')return;busy=true;try{await refreshRef.current();}catch{}finally{busy=false;}};
    window.addEventListener('focus',check);
    document.addEventListener('visibilitychange',check);
    const timer=setInterval(check,4000);
    void check();
    return()=>{clearInterval(timer);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check);};
  }, []);

  // Determine title and description based on what requirement is missing
  let title = t.titleBoth
  let sub = t.subBoth
  if (!hasValidPhone && hasAcceptedOferta) {
    title = t.titlePhone
    sub = t.subPhone
  } else if (hasValidPhone && !hasAcceptedOferta) {
    title = t.titleOferta
    sub = t.subOferta
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
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 20px',
        boxSizing: 'border-box',
        fontFamily: "var(--font-sans, 'Plus Jakarta Sans', sans-serif)"
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full flex flex-col items-center text-center"
      >
        {/* App Logo & Verification Badge */}
        <div className="relative mb-5">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-[#7C3AED] via-[#6D28D9] to-[#4C1D95] flex items-center justify-center text-4xl shadow-xl shadow-purple-500/25 border-2 border-white/60">
            🔒
          </div>
          <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-amber-500 border-2 border-white flex items-center justify-center text-white text-xs shadow-md">
            ⏳
          </div>
        </div>

        {/* Status Badge */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-100 text-[#7C3AED] text-xs font-bold mb-3">
          <span>✈️</span>
          <span>{t.badge}</span>
        </div>

        {/* Dynamic Title & Subtitle */}
        <h1 className="text-xl font-black text-[#1A1538] tracking-tight mb-2">
          {title}
        </h1>
        <p className="text-xs text-[#766E9E] max-w-xs leading-relaxed mb-5">
          {sub}
        </p>

        {/* Status Checklist Card (authoritative values from bot) */}
        <div className="w-full bg-white rounded-2xl border border-[#ECE7F6] p-4 mb-4 shadow-sm text-left flex flex-col gap-3">
          {/* Oferta Status */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="text-base">{hasAcceptedOferta ? '📄' : '⏳'}</span>
              <span className="text-xs font-bold text-[#1A1538]">{t.ofertaLabel}</span>
            </div>
            <span
              className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                hasAcceptedOferta
                  ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                  : 'bg-amber-50 text-amber-600 border border-amber-200'
              }`}
            >
              {hasAcceptedOferta ? t.done : t.pending}
            </span>
          </div>

          <div className="h-px bg-[#F1EDF8] w-full" />

          {/* Phone Status */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="text-base">{hasValidPhone ? '📱' : '⏳'}</span>
              <span className="text-xs font-bold text-[#1A1538]">{t.phoneLabel}</span>
            </div>
            <span
              className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                hasValidPhone
                  ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                  : 'bg-amber-50 text-amber-600 border border-amber-200'
              }`}
            >
              {hasValidPhone ? t.done : t.pending}
            </span>
          </div>
        </div>

        {/* VIP Premium Benefit Notice */}
        <div className="w-full bg-gradient-to-r from-amber-50 to-orange-50 rounded-2xl border border-amber-200/70 p-3.5 mb-5 shadow-sm text-left flex items-start gap-3">
          <span className="text-xl mt-0.5">🎁</span>
          <div>
            <p className="text-xs font-bold text-amber-900 mb-0.5">{t.benefitTitle}</p>
            <p className="text-[11px] text-amber-800/80 leading-normal">{t.benefitSub}</p>
          </div>
        </div>

        {checkFeedback && (
          <div className="w-full mb-4 p-3 rounded-xl bg-purple-50 border border-purple-200 text-purple-800 text-xs font-medium">
            {checkFeedback}
          </div>
        )}

        {/* Primary Action Button: Continue in Telegram Bot */}
        <div className="w-full flex flex-col gap-2.5">
          <button
            type="button"
            onClick={handleOpenTelegramBot}
            className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] text-white font-bold text-sm shadow-lg shadow-purple-500/25 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <span>{t.continueBtn}</span>
          </button>

          {/* Secondary Action: Refresh / Check Verification Status */}
          <button
            type="button"
            onClick={checkStatus}
            disabled={isChecking}
            className="w-full py-2.5 px-4 rounded-xl bg-white border border-[#E4E1F4] text-[#7C3AED] font-bold text-xs shadow-sm hover:bg-[#FAF8FE] active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {isChecking ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
                <span>{t.checking}</span>
              </>
            ) : (
              <span>{t.checkBtn}</span>
            )}
          </button>
        </div>

        <p className="text-[11px] text-[#94A3B8] mt-6 max-w-xs leading-normal">
          🔒 {t.securityNotice}
        </p>
      </motion.div>
    </div>
  )
}
