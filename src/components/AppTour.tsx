import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import type { Screen } from '../App'

interface AppTourProps {
  isOpen: boolean
  onClose: () => void
  language?: 'uz' | 'uz_cyrl' | 'ru' | 'en'
  onNavigateScreen?: (screen: Screen) => void
}

interface StepConfig {
  targetId: string
  targetScreen?: Screen
  title: string
  desc: string
  buttonText: string
  tooltipPosition: 'top' | 'bottom'
}

const tourSteps: Record<string, StepConfig[]> = {
  uz: [
    {
      targetId: 'home_cards_section',
      targetScreen: 'home',
      title: '💳 1. Balans va Kartalar',
      desc: "Ushbu joyda barcha kartalaringiz (Uzcard, Humo, Visa) va umumiy balansingiz ko'rinadi. Balansni bosib uni o'zgartirishingiz mumkin!",
      buttonText: "Keyingisi →",
      tooltipPosition: 'bottom'
    },
    {
      targetId: 'home_limit_section',
      targetScreen: 'home',
      title: '🎯 2. Oylik Xarajat Limiti',
      desc: "Oylik daromadingiz va jamg'arma maqsadingiz bo'yicha me'yoriy oylik hamda kunlik xarajat limitini avtomatik hisoblab beradi!",
      buttonText: "Keyingisi →",
      tooltipPosition: 'top'
    },
    {
      targetId: 'home_tx_section',
      targetScreen: 'home',
      title: "📊 3. So'nggi Operatsiyalar",
      desc: "Barcha kiritilgan xarajat va daromadlaringiz vaqti, kategoriyasi hamda summasi bo'yicha tartiblanadi!",
      buttonText: "Keyingisi →",
      tooltipPosition: 'top'
    },
    {
      targetId: 'ai_floating_button',
      targetScreen: 'home',
      title: '✨ 4. AI Yordamchi (+ Tugmasi)',
      desc: "Aqlli AI tugmasi! Ovoz orqali yoki matn bilan yozing — AI avtomatik summa, kategoriya va turini aniqlaydi (masalan: '1 million so'm pul topdim')",
      buttonText: "Keyingisi →",
      tooltipPosition: 'top'
    },
    {
      targetId: 'nav_tab_calendar',
      targetScreen: 'calendar',
      title: "📅 5. Taqvim Bo'limi",
      desc: "Taqvim sahifasida har bir kunlik xarajatlarni oylar bo'yicha siljitib, moliyaviy tarixingizni to'liq ko'rishingiz mumkin!",
      buttonText: "Keyingisi →",
      tooltipPosition: 'top'
    },
    {
      targetId: 'nav_tab_analytics',
      targetScreen: 'analytics',
      title: '📈 6. Tahlil va Diagrammalar',
      desc: "Grafiklar va doiraviy diagrammalar orqali eng ko'p pul sarflangan kategoriyalarni vizual tarzda tahlil qiling!",
      buttonText: "Keyingisi →",
      tooltipPosition: 'top'
    },
    {
      targetId: 'nav_tab_profile',
      targetScreen: 'profile',
      title: "⚙️ 7. Profil va Xavfsizlik",
      desc: "PIN-kod, Face ID xavfsizligi, tilni o'zgartirish va PDF/Excel hisobotlarni yuklab olish profil bo'limida joylashgan!",
      buttonText: "Boshlash! 🚀",
      tooltipPosition: 'top'
    }
  ],
  uz_cyrl: [
    {
      targetId: 'home_cards_section',
      targetScreen: 'home',
      title: '💳 1. Баланс ва Карталар',
      desc: "Ушбу жойда барча карталарингиз (Uzcard, Humo, Visa) ва умумий балансингиз кўринади. Балансни босиб уни ўзгартиришингиз мумкин!",
      buttonText: "Кейингиси →",
      tooltipPosition: 'bottom'
    },
    {
      targetId: 'home_limit_section',
      targetScreen: 'home',
      title: '🎯 2. Ойлик Харажат Лимити',
      desc: "Ойлик даромадингиз ва жамғарма мақсадингиз бўйича меъёрий ойлик ҳамда кунлик харажат лимитини автоматик ҳисоблаб беради!",
      buttonText: "Кейингиси →",
      tooltipPosition: 'top'
    },
    {
      targetId: 'home_tx_section',
      targetScreen: 'home',
      title: '📊 3. Сўнгги Операциялар',
      desc: "Барча киритилган харажат ва даромадларингиз вақти, категорияси ҳамда суммаси бўйича тартибланади!",
      buttonText: "Кейингиси →",
      tooltipPosition: 'top'
    },
    {
      targetId: 'ai_floating_button',
      targetScreen: 'home',
      title: '✨ 4. AI Ёрдамчи (+ Тугмаси)',
      desc: "Ақлли AI тугмаси! Овоз орқали ёки матн билан ёзинг — AI автоматик сумма, категория ва турини аниқлайди",
      buttonText: "Кейингиси →",
      tooltipPosition: 'top'
    },
    {
      targetId: 'nav_tab_calendar',
      targetScreen: 'calendar',
      title: '📅 5. Тақвим Бўлими',
      desc: "Тақвим саҳифасида ҳар бир кунлик харажатларни ойлар бўйича силжитиб, молиявий тарихингизни тўлиқ кўришингиз мумкин!",
      buttonText: "Кейингиси →",
      tooltipPosition: 'top'
    },
    {
      targetId: 'nav_tab_analytics',
      targetScreen: 'analytics',
      title: '📈 6. Таҳлил ва Диаграммалар',
      desc: "Графиклар ва доиравий диаграммалар орқали энг кўп пул сарфланган категорияларни визуал тарзда таҳлил қилинг!",
      buttonText: "Кейингиси →",
      tooltipPosition: 'top'
    },
    {
      targetId: 'nav_tab_profile',
      targetScreen: 'profile',
      title: '⚙️ 7. Профил ва Хавфсизлик',
      desc: "ПИН-код, Face ID хавфсизлиги, тилни ўзгартириш ва PDF/Excel ҳисоботларни юклаб олиш профил бўлимида жойлашган!",
      buttonText: "Бошлаш! 🚀",
      tooltipPosition: 'top'
    }
  ],
  ru: [
    {
      targetId: 'home_cards_section',
      targetScreen: 'home',
      title: '💳 1. Баланс и Карты',
      desc: "Здесь отображается ваш общий баланс и карты. Нажмите на карту или баланс, чтобы изменить данные!",
      buttonText: "Далее →",
      tooltipPosition: 'bottom'
    },
    {
      targetId: 'home_limit_section',
      targetScreen: 'home',
      title: '🎯 2. Лимит Расходов',
      desc: "Автоматический расчет дневного и месячного лимита для достижения вашей финансовой цели!",
      buttonText: "Далее →",
      tooltipPosition: 'top'
    },
    {
      targetId: 'home_tx_section',
      targetScreen: 'home',
      title: '📊 3. Последние Операции',
      desc: "Все сохраненные расходы и доходы фильтруются по дате и категориям!",
      buttonText: "Далее →",
      tooltipPosition: 'top'
    },
    {
      targetId: 'ai_floating_button',
      targetScreen: 'home',
      title: '✨ 4. Кнопка ИИ Помощника (+)',
      desc: "Умный ввод голосом и текстом — ИИ сам рассортирует сумму и категории!",
      buttonText: "Далее →",
      tooltipPosition: 'top'
    },
    {
      targetId: 'nav_tab_calendar',
      targetScreen: 'calendar',
      title: '📅 5. Раздел Календаря',
      desc: "Просматривайте расходы по дням и свайпайте месяцы в интерактивном календаре!",
      buttonText: "Далее →",
      tooltipPosition: 'top'
    },
    {
      targetId: 'nav_tab_analytics',
      targetScreen: 'analytics',
      title: '📈 6. Аналитика и Диаграммы',
      desc: "Наглядные графики и диаграммы покажут распределение ваших трат!",
      buttonText: "Далее →",
      tooltipPosition: 'top'
    },
    {
      targetId: 'nav_tab_profile',
      targetScreen: 'profile',
      title: '⚙️ 7. Профиль и Настройки',
      desc: "Настройки PIN-кода, Face ID, языка и скачивание отчетов PDF/Excel здесь!",
      buttonText: "Начать! 🚀",
      tooltipPosition: 'top'
    }
  ],
  en: [
    {
      targetId: 'home_cards_section',
      targetScreen: 'home',
      title: '💳 1. Total Balance & Cards',
      desc: "View your combined balance and individual cards. Tap balance to edit initial amounts!",
      buttonText: "Next →",
      tooltipPosition: 'bottom'
    },
    {
      targetId: 'home_limit_section',
      targetScreen: 'home',
      title: '🎯 2. Monthly Expense Limit',
      desc: "Calculates daily and monthly spending limits automatically based on your income and saving goals!",
      buttonText: "Next →",
      tooltipPosition: 'top'
    },
    {
      targetId: 'home_tx_section',
      targetScreen: 'home',
      title: '📊 3. Recent Transactions',
      desc: "Your transaction history is chronologically organized with category badges!",
      buttonText: "Next →",
      tooltipPosition: 'top'
    },
    {
      targetId: 'ai_floating_button',
      targetScreen: 'home',
      title: '✨ 4. AI Assistant (+ Button)',
      desc: "Smart voice & text transaction parsing. Just say 'Earned 1 million som'!",
      buttonText: "Next →",
      tooltipPosition: 'top'
    },
    {
      targetId: 'nav_tab_calendar',
      targetScreen: 'calendar',
      title: '📅 5. Calendar Section',
      desc: "Swipe through calendar months to analyze daily spending history!",
      buttonText: "Next →",
      tooltipPosition: 'top'
    },
    {
      targetId: 'nav_tab_analytics',
      targetScreen: 'analytics',
      title: '📈 6. Visual Analytics',
      desc: "Interactive pie charts and period breakdowns for full financial clarity!",
      buttonText: "Next →",
      tooltipPosition: 'top'
    },
    {
      targetId: 'nav_tab_profile',
      targetScreen: 'profile',
      title: '⚙️ 7. Profile & Security',
      desc: "Configure PIN code, Face ID security, change language, and download PDF/Excel reports!",
      buttonText: "Get Started! 🚀",
      tooltipPosition: 'top'
    }
  ]
}

export default function AppTour({ isOpen, onClose, language = 'uz', onNavigateScreen }: AppTourProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)

  const steps = tourSteps[language] || tourSteps.uz
  const step = steps[currentStep]

  // Automatically switch active screen if step requires it
  useEffect(() => {
    if (isOpen && step.targetScreen && onNavigateScreen) {
      onNavigateScreen(step.targetScreen)
    }
  }, [isOpen, currentStep, step.targetScreen, onNavigateScreen])

  // Update bounding rect & smooth scroll into view
  useEffect(() => {
    if (!isOpen) return

    if (step.targetScreen && onNavigateScreen) {
      onNavigateScreen(step.targetScreen)
    }

    const updateRect = () => {
      const el = document.getElementById(step.targetId)
      if (el) {
        setTargetRect(el.getBoundingClientRect())
      } else {
        setTargetRect(null)
      }
    }

    const timer = setTimeout(() => {
      const el = document.getElementById(step.targetId)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      updateRect()
    }, 120)

    const interval = setInterval(updateRect, 250)
    window.addEventListener('resize', updateRect)
    return () => {
      clearTimeout(timer)
      clearInterval(interval)
      window.removeEventListener('resize', updateRect)
    }
  }, [isOpen, currentStep, step.targetId, step.targetScreen])

  if (!isOpen) return null

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(prev => prev + 1)
    } else {
      localStorage.setItem('user_tour_completed_v2', 'true')
      if (onNavigateScreen) onNavigateScreen('home')
      onClose()
      setCurrentStep(0)
    }
  }

  const handleClose = () => {
    localStorage.setItem('user_tour_completed_v2', 'true')
    if (onNavigateScreen) onNavigateScreen('home')
    onClose()
    setCurrentStep(0)
  }

  // Calculate spotlight cutout frame styles
  const spotlightStyle: React.CSSProperties = targetRect ? {
    position: 'fixed',
    top: targetRect.top - 8,
    left: targetRect.left - 8,
    width: targetRect.width + 16,
    height: targetRect.height + 16,
    borderRadius: 24,
    boxShadow: '0 0 0 9999px rgba(10, 8, 25, 0.78), 0 0 35px rgba(124, 58, 237, 0.9)',
    border: '2.5px solid #7C3AED',
    pointerEvents: 'none',
    zIndex: 9998,
    transition: 'all 0.35s cubic-bezier(0.16, 1, 0.3, 1)'
  } : {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 280,
    height: 100,
    borderRadius: 20,
    boxShadow: '0 0 0 9999px rgba(10, 8, 25, 0.78)',
    border: '2px solid #7C3AED',
    pointerEvents: 'none',
    zIndex: 9998
  }

  // Position tooltip outside the target box so it NEVER obscures the feature
  let tooltipTop = 100
  if (targetRect) {
    if (step.tooltipPosition === 'bottom') {
      tooltipTop = Math.min(window.innerHeight - 230, targetRect.bottom + 20)
    } else {
      tooltipTop = Math.max(20, targetRect.top - 240)
    }
  }

  return (
    <AnimatePresence>
      <div style={{ position: 'fixed', inset: 0, zIndex: 9997 }}>
        {/* Spotlight cutout around the targeted UI feature */}
        <div style={spotlightStyle} />

        {/* Pulsing ring animation over target */}
        {targetRect && (
          <div
            style={{
              position: 'fixed',
              top: targetRect.top - 14,
              left: targetRect.left - 14,
              width: targetRect.width + 28,
              height: targetRect.height + 28,
              borderRadius: 28,
              border: '2px solid rgba(124, 58, 237, 0.6)',
              animation: 'tourPulse 1.8s infinite',
              pointerEvents: 'none',
              zIndex: 9998,
            }}
          />
        )}

        {/* Draggable Floating Tooltip Card */}
        <motion.div
          drag
          dragMomentum={false}
          key={currentStep}
          initial={{ opacity: 0, y: step.tooltipPosition === 'top' ? -20 : 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          style={{
            position: 'fixed',
            left: 'calc(50% - 180px)',
            top: `${tooltipTop}px`,
            width: 360,
            maxWidth: 'calc(100vw - 40px)',
            background: '#FFFFFF',
            borderRadius: 24,
            padding: '18px 18px',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.38), 0 0 0 1.5px rgba(124, 58, 237, 0.4)',
            zIndex: 9999,
            cursor: 'grab'
          }}
          whileTap={{ cursor: 'grabbing' }}
        >
          {/* Top Drag Indicator */}
          <div style={{ width: 36, height: 4, borderRadius: 2, background: '#E4E1F4', margin: '0 auto 10px' }} />

          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{
              fontSize: 11, fontWeight: 700, background: '#EDE9FE', color: '#7C3AED',
              padding: '4px 10px', borderRadius: 10, letterSpacing: 0.3
            }}>
              {language === 'uz' ? `QADAM ${currentStep + 1} / ${steps.length} — ✋ Siljitish mumkin` : language === 'uz_cyrl' ? `ҚАДАМ ${currentStep + 1} / ${steps.length} — ✋ Силжитиш мумкин` : language === 'ru' ? `ШАГ ${currentStep + 1} / ${steps.length} — ✋ Можно перемещать` : `STEP ${currentStep + 1} / ${steps.length} — ✋ Draggable`}
            </span>
            <button
              onClick={handleClose}
              style={{
                border: 'none', background: 'transparent', color: '#8B82C4',
                fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
              }}
            >
              {language === 'uz' ? "Yopish ✕" : language === 'uz_cyrl' ? "Ёпиш ✕" : language === 'ru' ? "Закрыть ✕" : "Close ✕"}
            </button>
          </div>

          <h3 style={{ fontSize: 16.5, fontWeight: 800, color: '#1E1A3C', marginBottom: 6, letterSpacing: -0.3 }}>
            {step.title}
          </h3>

          <p style={{ fontSize: 12.5, color: '#5C548A', lineHeight: 1.45, marginBottom: 14 }}>
            {step.desc}
          </p>

          {/* Action button */}
          <button
            onClick={handleNext}
            style={{
              width: '100%', padding: '12px', borderRadius: 16, border: 'none',
              background: 'linear-gradient(135deg, #7C3AED, #5B21B6)',
              color: '#FFFFFF', fontSize: 14, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
              boxShadow: '0 6px 16px rgba(124, 58, 237, 0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
            }}
          >
            <span>{step.buttonText}</span>
          </button>
        </motion.div>
      </div>

      <style>{`
        @keyframes tourPulse {
          0% { transform: scale(0.98); opacity: 0.8; }
          50% { transform: scale(1.04); opacity: 0.2; }
          100% { transform: scale(0.98); opacity: 0.8; }
        }
      `}</style>
    </AnimatePresence>
  )
}
