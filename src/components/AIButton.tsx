import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useFinance } from '../FinanceContext'
import { parseAITransaction } from '../utils/aiParser'
import { getApiUrl } from '../utils/apiUrl'

type EntryType = 'expense' | 'income' | 'debt' | 'lending'

interface Entry {
  type: EntryType
  amount: string
  note: string
  category: string
  title?: string
  debtWho?: string
  date?: string
  cardId?: string
  toCardId?: string
}

const typeConfig: Record<EntryType, { label: string; color: string; bg: string; icon: string }> = {
  expense: { label: 'Xarajat', color: '#DC2626', bg: '#FEF2F2', icon: '↑' },
  income: { label: 'Daromad', color: '#16A34A', bg: '#F0FDF4', icon: '↓' },
  debt: { label: 'Qarz oldim', color: '#D97706', bg: '#FFFBEB', icon: '⟳' },
  lending: { label: 'Qarz berdim', color: '#7C3AED', bg: '#F5F3FF', icon: '⟲' },
}

const categories: Record<EntryType, string[]> = {
  expense: ['Oziq-ovqat', 'Transport', "Ko'ngil ochar", 'Kiyim', 'Kommunal', 'Sog\'liq', 'Ta\'lim', 'Boshqa'],
  income: ['Maosh', 'Freelance', 'Biznes', 'Investitsiya', 'Sovg\'a', 'Boshqa'],
  debt: ['Do\'st', 'Bank', 'Oila', 'Boshqa'],
  lending: ['Do\'st', 'Hamkasb', 'Oila', 'Boshqa'],
}

const voicePrompts: Record<EntryType, string> = {
  expense: "Qancha xarajat qildingiz va nima uchun?",
  income: "Qancha daromad oldingiz?",
  debt: "Kimdan qancha qarz oldingiz?",
  lending: "Kimga qancha pul berdingiz?",
}

export interface AiResponseData {
  success: boolean
  response?: string
  parsed?: {
    type?: EntryType
    amount?: string
    category?: string
    note?: string
    title?: string
    debtWho?: string
    date?: string
    cardId?: string
  }
  usage?: {
    used: number
    limit: number | null
    remaining: number
    isPremium: boolean
  }
  error?: string
  message?: string
}

export async function requestAiAssistant(
  userId: string | undefined,
  prompt: string,
  imageBase64: string | null = null
): Promise<AiResponseData | null> {
  try {
    const response = await fetch(getApiUrl('/api/ai-router'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userId || undefined,
        prompt: prompt,
        queryType: imageBase64 ? 'receipt' : 'text',
        imageBase64: imageBase64
      })
    })

    const data = await response.json()

    // 1. User Quota Limit Reached
    if (response.status === 403 && data.error === 'AI_LIMIT_REACHED') {
      throw new Error(data.message || 'AI Limitingiz tugadi. Davom etish uchun VIP Premium obunasini faollashtiring!')
    }

    // 2. All AI Provider Keys Temporarily Busy
    if (response.status === 503) {
      throw new Error(data.message || "AI xizmati hozirda band. Iltimos, 1 daqiqadan so'ng qayta urinib ko'ring.")
    }

    if (!response.ok) {
      throw new Error(data.error || 'AI request failed')
    }

    return data
  } catch (error: any) {
    console.error('[AI_ROUTER_CLIENT] Error:', error)
    throw error
  }
}

async function parseAIText(text: string, cardsList: any[] = [], userId?: string): Promise<{ type: EntryType; amount: string; category: string; note: string; title?: string; debtWho?: string; date?: string; cardId?: string }> {
  try {
    const data = await requestAiAssistant(userId, text, null)
    if (data && data.parsed && data.parsed.amount) {
      return {
        type: data.parsed.type || 'expense',
        amount: data.parsed.amount,
        category: data.parsed.category || 'Boshqa',
        note: data.parsed.note || text,
        title: data.parsed.title,
        debtWho: data.parsed.debtWho,
        date: data.parsed.date,
        cardId: data.parsed.cardId
      }
    }
  } catch (err: any) {
    if (err.message && (err.message.includes('tugadi') || err.message.includes('Premium') || err.message.includes('band'))) {
      throw err
    }
    // Fall back to local NLP parser if offline
  }

  const parsed = parseAITransaction(text, cardsList)
  return parsed
}

export default function AIButton({ visible = true, language = 'uz' }: { visible?: boolean; language?: 'uz' | 'uz_cyrl' | 'ru' | 'en' }) {
  const { addTransaction, hasSampleData, setHasSampleData, cards, userId, userSubscription } = useFinance()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'type' | 'form' | 'voice' | 'done' | 'removeSamples'>('type')
  const [selectedType, setSelectedType] = useState<EntryType>('expense')
  const [recording, setRecording] = useState(false)
  const [entry, setEntry] = useState<Entry>({ type: 'expense', amount: '', note: '', category: '' })
  const [saved, setSaved] = useState(false)
  const [aiText, setAiText] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [aiError, setAiError] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recognitionRef = useRef<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (isProcessing) return // Guard against double-submit

    setIsProcessing(true)
    setAiError('')
    try {
      const reader = new FileReader()
      reader.onerror = () => {
        setAiError(language === 'uz' ? "Faylni o'qishda xatolik" : language === 'uz_cyrl' ? "Файлни ўқишда хатолик" : language === 'ru' ? 'Ошибка чтения файла' : 'File reading error')
        setIsProcessing(false)
      }
      reader.onload = async () => {
        const base64Data = reader.result as string
        try {
          const aiData = await requestAiAssistant(userId || undefined, 'Receipt scan', base64Data)
          let parsed = aiData?.parsed

          if (!parsed || !parsed.amount) {
            setAiError(language === 'uz' ? "Chekdan ma'lumot topilmadi, iltimos qaytadan urinib ko'ring" : language === 'uz_cyrl' ? "Чекдан маълумот топилмади" : language === 'ru' ? 'Данные не найдены на чеке' : 'No data found on receipt')
            setIsProcessing(false)
            return
          }

          setSelectedType(parsed.type || 'expense')
          const localISOTime = (new Date(Date.now() - new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16)
          setEntry(prev => ({
            ...prev,
            type: parsed.type || 'expense',
            amount: parsed.amount || '0',
            note: parsed.note || 'Chek xarajati',
            category: parsed.category || 'Oziq-ovqat',
            title: parsed.title || 'Chek xarajati',
            date: parsed.date || localISOTime,
            cardId: prev.cardId || 'cash',
          }))
          setStep('form')
        } catch (err: any) {
          setAiError(err.message || 'Chekni skanerlashda xatolik yuz berdi')
        } finally {
          setIsProcessing(false)
        }
      }
      reader.readAsDataURL(file)
    } catch (err: any) {
      console.error('File reading error:', err)
      setIsProcessing(false)
    }
  }

  if (!visible) return null

  const openModal = () => {
    setStep('type')
    const localISOTime = (new Date(Date.now() - new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16)
    setEntry({ type: 'expense', amount: '', note: '', category: '', date: localISOTime, cardId: 'cash' })
    setAiText('')
    setAiError('')
    setSaved(false)
    setIsProcessing(false)
    setOpen(true)
  }

  const closeModal = () => {
    setOpen(false)
    setRecording(false)
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch (_) {}
      recognitionRef.current = null
    }
    if (timerRef.current) clearTimeout(timerRef.current)
  }

  const selectType = (t: EntryType) => {
    setSelectedType(t)
    setEntry((e) => ({ ...e, type: t, category: categories[t][0] }))
    setStep('form')
  }


  const handleAiTextSubmit = async () => {
    if (!aiText.trim()) return
    if (isProcessing) return // Guard against double-submit

    setIsProcessing(true)
    setAiError('')
    try {
      const parsed = await parseAIText(aiText, cards, userId || undefined)
      setSelectedType(parsed.type)
      const localISOTime = (new Date(Date.now() - new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16)
      setEntry(prev => ({
        ...prev,
        type: parsed.type,
        amount: parsed.amount,
        note: parsed.note,
        category: parsed.category,
        title: parsed.title,
        debtWho: parsed.debtWho,
        date: parsed.date || localISOTime,
        cardId: parsed.cardId || prev.cardId || 'cash',
      }))
      setStep('form')
    } catch (e: any) {
      console.error(e)
      // Display backend quota/provider error messages directly instead of generic error
      const msg = e?.message || ''
      if (msg.includes('tugadi') || msg.includes('Premium') || msg.includes('band') || msg.includes('limit') || msg.includes('Limit')) {
        setAiError(msg)
      } else {
        setAiError(language === 'uz' ? "Tushunmadim, qayta urinib ko'ring" : language === 'uz_cyrl' ? "Тушунмадим, қайта уриниб кўринг" : language === 'ru' ? 'Не удалось распознать, попробуйте снова' : "Couldn't parse that, try again")
      }
    } finally {
      setIsProcessing(false)
    }
  }

  const stopVoice = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
    }
    setRecording(false)
  }

  const startVoice = async () => {
    if (isProcessing || recording) return // Guard against double-submit

    setStep('voice')
    setRecording(true)

    // Request audio stream upfront so browser remembers microphone permission persistently
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach(t => t.stop())
        localStorage.setItem('mic_perm_granted', 'true')
      } catch (micErr) {
        console.warn('Microphone permission stream warning:', micErr)
      }
    }

    try {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      if (!SpeechRecognition) throw new Error("No speech API")
      
      const rec = new SpeechRecognition()
      rec.lang = (language === 'uz' || language === 'uz_cyrl') ? 'uz-UZ' : language === 'ru' ? 'ru-RU' : 'en-US'
      rec.interimResults = false
      rec.maxAlternatives = 1

      rec.onresult = async (event: any) => {
        const resultText = event.results[0][0].transcript
        setRecording(false)
        setIsProcessing(true)

        try {
          const parsed = await parseAIText(resultText, cards, userId || undefined)
          setSelectedType(parsed.type)
          const localISOTime = (new Date(Date.now() - new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16)
          setEntry(prev => ({
            ...prev,
            type: parsed.type,
            amount: parsed.amount,
            note: parsed.note || resultText,
            category: parsed.category,
            title: parsed.title,
            debtWho: parsed.debtWho,
            date: parsed.date || localISOTime,
            cardId: parsed.cardId || prev.cardId || 'cash',
          }))
          setStep('form')
        } catch (e: any) {
          console.error(e)
          setAiText(resultText)
          // Display backend quota/provider error messages directly
          const msg = e?.message || ''
          if (msg.includes('tugadi') || msg.includes('Premium') || msg.includes('band') || msg.includes('limit') || msg.includes('Limit')) {
            setAiError(msg)
          } else {
            setAiError(language === 'uz' ? "Tushunmadim, qayta urinib ko'ring" : language === 'uz_cyrl' ? "Тушунмадим, қайта уриниб кўринг" : language === 'ru' ? 'Не удалось распознать, попробуйте снова' : "Couldn't parse that, try again")
          }
          setStep('type')
        } finally {
          setIsProcessing(false)
        }
      }

      rec.onerror = (e: any) => {
        console.error("Speech recognition error:", e)
        stopVoice()
        setIsProcessing(false)
        setStep('type')
        setAiError(
          (language === 'uz' || language === 'uz_cyrl')
            ? (language === 'uz_cyrl'
                ? "Овозни таниш бу браузерда ишламади. Илтимос, матн билан ёзинг ёки Telegram Bot-ga овозли хабар юборинг 🎙️"
                : "Ovozni tanish bu brauzerda ishlamadi. Iltimos, matn bilan yozing yoki Telegram Bot-ga ovozli xabar yuboring 🎙️")
            : language === 'ru'
            ? 'Распознавание речи не сработало. Введите текст или отправьте голосовое боту 🎙️'
            : 'Speech recognition did not work. Please type or send a voice message to Telegram Bot 🎙️'
        )
      }

      rec.onend = () => {
        setRecording(false)
      }

      recognitionRef.current = rec
      rec.start()
    } catch (e) {
      console.error(e)
      setRecording(false)
      setIsProcessing(false)
      setStep('type')
      setAiError(
        (language === 'uz' || language === 'uz_cyrl')
          ? (language === 'uz_cyrl'
              ? "Овозни таниш бу браузерда қўллаб-қувватланмайди. Илтимос, матн билан ёзинг ёки Telegram Bot-ga овозли хабар юборинг 🎙️"
              : "Ovozni tanish bu brauzerda qo'llab-quvvatlanmaydi. Iltimos, matn bilan yozing yoki Telegram Bot-ga ovozli xabar yuboring 🎙️")
          : language === 'ru'
          ? 'Распознавание речи не поддерживается. Введите текст или отправьте голосовое боту 🎙️'
          : 'Speech recognition is not supported. Please type text or send a voice message to Telegram Bot 🎙️'
      )
    }
  }


  const handleSave = () => {
    if (saved) return // Guard against double-tap creating duplicate transactions
    // Save transaction to context and Firestore
    let finalDate = new Date().toISOString()
    if (entry.date) {
      try {
        finalDate = new Date(entry.date).toISOString()
      } catch (e) {
        console.error('Invalid date format, using fallback', e)
      }
    }

    let numAmount = Number(String(entry.amount).replace(/[^\d]/g, '')) || 0
    const now = Date.now()

    if (entry.type === 'expense' || entry.type === 'lending') {
      numAmount = -Math.abs(numAmount)
    } else {
      numAmount = Math.abs(numAmount)
    }

    const customTx = {
      id: now,
      type: entry.type,
      amount: numAmount,
      note: entry.note || entry.category,
      category: entry.category,
      title: entry.title,
      debtWho: entry.debtWho,
      date: finalDate,
      cardId: entry.cardId === 'cash' ? undefined : entry.cardId,
    }
    
    addTransaction(customTx)

    if (hasSampleData) {
      setHasSampleData(false)
    }

    setSaved(true)
    setTimeout(() => {
      closeModal()
    }, 1200)
  }

  const cfg = typeConfig[selectedType]

  return (
    <>
      {/* Floating button */}
      <motion.button
        id="ai_floating_button"
        onClick={openModal}
        drag
        dragConstraints={{ top: -75, bottom: 75, left: -75, right: 75 }}
        dragElastic={0.15}
        dragMomentum={false}
        whileDrag={{ scale: 1.08, cursor: 'grabbing' }}
        whileTap={{ scale: 0.92 }}
        className="gpu-layer"
        style={{
          position: 'fixed',
          bottom: 130,
          left: 'min(calc(50% + 75px), calc(100vw - 110px))',
          width: 56,
          height: 56,
          borderRadius: 18,
          background: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)',
          color: '#ffffff',
          border: 'none',
          cursor: 'grab',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 200,
          boxShadow: '0 8px 24px rgba(124,58,237,0.4)',
          touchAction: 'none',
        }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
          <path d="M12 5V19M5 12H19" stroke="white" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </motion.button>

      {/* Modal overlay */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeModal}
            className="gpu-layer"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(15, 12, 41, 0.45)',
              WebkitBackdropFilter: 'blur(4px)',
              backdropFilter: 'blur(4px)',
              zIndex: 300,
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
            }}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.5 }}
              onDragEnd={(_, info) => {
                if (info.offset.y > 100) closeModal()
              }}
              transition={{ type: 'spring', damping: 26, stiffness: 220 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                maxWidth: 440,
                maxHeight: '85vh',
                overflowY: 'auto',
                background: '#FFFFFF',
                borderRadius: '28px 28px 0 0',
                padding: '16px 20px calc(48px + env(safe-area-inset-bottom, 24px))',
                boxShadow: '0 -10px 40px rgba(0,0,0,0.15)',
                position: 'relative',
              }}
            >
              {/* Header Handle Bar with Close Button */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ width: 28 }} />
                <div style={{ width: 40, height: 4, background: '#E8E3F8', borderRadius: 2, cursor: 'grab' }} />
                <button
                  onClick={closeModal}
                  style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: '#F5F4FA', border: 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, color: '#5C548A', cursor: 'pointer', fontWeight: 700
                  }}
                >
                  ✕
                </button>
              </div>

            {/* Saved state */}
            {saved && (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{
                  width: 64, height: 64, borderRadius: 20, background: '#F0FDF4',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 12px', fontSize: 28,
                }}>✓</div>
                <p style={{ fontSize: 17, fontWeight: 600, color: '#16A34A' }}>{language === 'uz' ? 'Saqlandi!' : language === 'uz_cyrl' ? 'Сақланди!' : language === 'ru' ? 'Сохранено!' : 'Saved!'}</p>
              </div>
            )}

            {/* Processing state */}
            {isProcessing && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 0', minHeight: 250 }}>
                {/* Glowing pulsating AI circle */}
                <div style={{ position: 'relative', width: 90, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
                  <motion.div
                    animate={{
                      scale: [1, 1.25, 1],
                      opacity: [0.3, 0.6, 0.3],
                    }}
                    transition={{
                      repeat: Infinity,
                      duration: 2,
                      ease: "easeInOut"
                    }}
                    style={{
                      position: 'absolute',
                      width: 90,
                      height: 90,
                      borderRadius: '50%',
                      background: 'radial-gradient(circle, rgba(124,58,237,0.3) 0%, rgba(124,58,237,0) 70%)',
                    }}
                  />
                  <motion.div
                    animate={{
                      scale: [1, 1.12, 1],
                    }}
                    transition={{
                      repeat: Infinity,
                      duration: 1.5,
                      ease: "easeInOut"
                    }}
                    style={{
                      width: 54,
                      height: 54,
                      borderRadius: 18,
                      background: '#7C3AED',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 8px 24px rgba(124,58,237,0.4)',
                    }}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                      <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M2 17L12 22L22 17" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M2 12L12 17L22 12" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </motion.div>
                </div>

                <motion.p
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                  style={{ fontSize: 16, fontWeight: 600, color: '#1E1A3C', marginBottom: 6 }}
                >
                  {language === 'uz' ? "AI qayta ishlayapti..." : language === 'uz_cyrl' ? "AI қайта ишлаяпти..." : language === 'ru' ? "ИИ обрабатывает..." : "AI processing..."}
                </motion.p>
                <p style={{ fontSize: 13, color: '#8B82C4', textAlign: 'center', maxWidth: 280 }}>
                  {language === 'uz' ? "Matningiz tahlil qilinmoqda va xarajat aniqlanmoqda" : language === 'uz_cyrl' ? "Матнингиз таҳлил қилинмоқда ва харажат аниқланмоқда" : language === 'ru' ? "Ваш текст анализируется для определения транзакции" : "Analyzing your text to parse transaction details"}
                </p>
              </div>
            )}

            {/* Step: type selection */}
            {!saved && !isProcessing && step === 'type' && (
              <>
                <p style={{ fontSize: 18, fontWeight: 700, color: '#1E1A3C', marginBottom: 6 }}>{language === 'uz' ? "Nima qo'shmoqchisiz?" : language === 'uz_cyrl' ? "Нима қўшмоқчисиз?" : language === 'ru' ? "Что хотите добавить?" : "What to add?"}</p>
                <p style={{ fontSize: 13, color: '#8B82C4', marginBottom: 20 }}>{language === 'uz' ? "Turini tanlang yoki ovoz bilan ayting" : language === 'uz_cyrl' ? "Турини танланг ёки овоз билан айтинг" : language === 'ru' ? "Выберите тип или скажите голосом" : "Select type or use voice"}</p>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
                  {(Object.keys(typeConfig) as EntryType[]).map((t) => {
                    const c = typeConfig[t]
                    return (
                      <button
                        key={t}
                        onClick={() => selectType(t)}
                        style={{
                          padding: '18px 16px',
                          borderRadius: 16,
                          border: `1.5px solid ${c.color}22`,
                          background: c.bg,
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          gap: 8,
                          textAlign: 'left',
                        }}
                      >
                        <span style={{ fontSize: 22, color: c.color, fontWeight: 700 }}>{c.icon}</span>
                        <span style={{ fontSize: 15, fontWeight: 600, color: '#1E1A3C' }}>{c.label}</span>
                      </button>
                    )
                  })}
                </div>

                {/* AI Text Input section */}
                <div style={{ marginBottom: 18 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#8B82C4', textTransform: 'uppercase', marginBottom: 8, letterSpacing: 0.6 }}>
                    {isProcessing ? (
                      <motion.span animate={{ opacity: [0.5, 1, 0.5] }} transition={{ repeat: Infinity, duration: 1.5 }}>
                        {language === 'uz' ? "AI QAYTA ISHLAYAPTI..." : language === 'uz_cyrl' ? "AI ҚАЙТА ИШЛАЯПТИ..." : language === 'ru' ? "ОБРАБОТКА ИИ..." : "AI PROCESSING..."}
                      </motion.span>
                    ) : (
                      language === 'uz' ? 'AI GA MATN BILAN YOZING' : language === 'uz_cyrl' ? 'AI ГА МАТН БИЛАН ЁЗИНГ' : language === 'ru' ? 'НАПИСАТЬ ТЕКСТОМ ДЛЯ ИИ' : 'WRITE TO AI'
                    )}
                  </p>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      background: '#F7F5FF',
                      border: '1.5px solid #DDD6FE',
                      borderRadius: 14,
                      padding: '6px 12px',
                    }}
                  >
                    <input
                      type="file"
                      ref={fileInputRef}
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={handleImageSelect}
                    />
                    <button
                      id="btn_upload_receipt_image"
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      title={language === 'uz' ? "Chek yoki rasm yuklash" : "Upload receipt image"}
                      style={{
                        background: '#EDE9FE',
                        color: '#7C3AED',
                        border: 'none',
                        borderRadius: 10,
                        width: 36,
                        height: 36,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        flexShrink: 0,
                        transition: 'all 0.2s',
                      }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    </button>

                    <input
                      id="ai_text_input_field"
                      type="text"
                      placeholder={
                        language === 'uz' ? 'Masalan: tushlikka 45000 som' :
                        language === 'uz_cyrl' ? 'Масалан: тушликка 45000 сўм' :
                        language === 'ru' ? 'Например: 500 рублей на такси' :
                        'e.g. spent 15 dollars on dinner'
                      }
                      value={aiText}
                      onChange={(e) => setAiText(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAiTextSubmit()}
                      style={{
                        flex: 1,
                        background: 'none',
                        border: 'none',
                        outline: 'none',
                        fontSize: 14,
                        color: '#1E1A3C',
                        fontFamily: 'inherit',
                        padding: '8px 0',
                      }}
                    />
                    <button
                      id="btn_submit_ai_text"
                      onClick={handleAiTextSubmit}
                      disabled={!aiText.trim()}
                      style={{
                        background: aiText.trim() ? '#7C3AED' : '#E8E3F8',
                        color: '#FFFFFF',
                        border: 'none',
                        borderRadius: 10,
                        width: 36,
                        height: 36,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: aiText.trim() ? 'pointer' : 'default',
                        transition: 'background 0.2s',
                        flexShrink: 0,
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="22" y1="2" x2="11" y2="13" />
                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                      </svg>
                    </button>
                  </div>
                  {aiError && (
                    <p style={{ fontSize: 12, color: '#DC2626', marginTop: 6 }}>{aiError}</p>
                  )}
                </div>

                {/* Voice shortcut */}
                <button
                  onClick={() => { setSelectedType('expense'); setStep('voice'); startVoice() }}
                  style={{
                    width: '100%',
                    padding: '14px',
                    borderRadius: 14,
                    border: '1.5px solid #E8E3F8',
                    background: '#F7F5FF',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    color: '#7C3AED',
                    fontSize: 14,
                    fontWeight: 600,
                    fontFamily: 'inherit',
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <rect x="6" y="1" width="6" height="10" rx="3" fill="#7C3AED" fillOpacity="0.8" />
                    <path d="M3 9C3 12.3 5.7 15 9 15C12.3 15 15 12.3 15 9" stroke="#7C3AED" strokeWidth="1.5" strokeLinecap="round" />
                    <line x1="9" y1="15" x2="9" y2="17" stroke="#7C3AED" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  {language === 'uz' ? 'Ovoz bilan kiriting' : language === 'uz_cyrl' ? 'Овоз билан киритинг' : language === 'ru' ? 'Голосовой ввод' : 'Voice input'}
                </button>
              </>
            )}

            {/* Step: voice recording */}
            {!saved && !isProcessing && step === 'voice' && (
              <div style={{ textAlign: 'center', padding: '10px 0 20px' }}>
                <p style={{ fontSize: 16, fontWeight: 600, color: '#1E1A3C', marginBottom: 6 }}>
                  {voicePrompts[selectedType]}
                </p>
                <p style={{ fontSize: 13, color: '#8B82C4', marginBottom: 32 }}>{language === 'uz' ? 'Gapiring, eshityapman...' : language === 'uz_cyrl' ? 'Гапиринг, эшитяпман...' : language === 'ru' ? 'Говорите, я слушаю...' : 'Speak, I am listening...'}</p>

                {/* Smooth Mic animation */}
                <div style={{ position: 'relative', width: 96, height: 96, margin: '0 auto 24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {recording && (
                    <motion.div
                      animate={{ scale: [1, 1.35, 1], opacity: [0.2, 0.5, 0.2] }}
                      transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                      style={{
                        position: 'absolute', inset: -10, borderRadius: '50%',
                        background: '#7C3AED', zIndex: 1
                      }}
                    />
                  )}
                  <motion.div
                    animate={recording ? { scale: [1, 1.06, 1] } : {}}
                    transition={{ repeat: Infinity, duration: 1.2, ease: "easeInOut" }}
                    style={{
                      width: 96, height: 96, borderRadius: '50%',
                      background: recording ? '#7C3AED' : '#EDE9FE',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      zIndex: 2, position: 'relative',
                      boxShadow: recording ? '0 8px 24px rgba(124,58,237,0.4)' : 'none'
                    }}
                  >
                    <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                      <rect x="12" y="2" width="12" height="20" rx="6" fill={recording ? 'white' : '#7C3AED'} fillOpacity="0.9" />
                      <path d="M6 18C6 24.6 11.4 30 18 30C24.6 30 30 24.6 30 18" stroke={recording ? 'white' : '#7C3AED'} strokeWidth="2.5" strokeLinecap="round" />
                      <line x1="18" y1="30" x2="18" y2="34" stroke={recording ? 'white' : '#7C3AED'} strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                  </motion.div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, height: 24 }}>
                  {[16, 24, 18, 26, 14].map((h, i) => (
                    <motion.div
                      key={i}
                      animate={recording ? { height: [10, h, 10] } : { height: 10 }}
                      transition={{ repeat: Infinity, duration: 0.8, delay: i * 0.12, ease: "easeInOut" }}
                      style={{
                        width: 4,
                        borderRadius: 2,
                        background: '#7C3AED',
                        opacity: recording ? 1 : 0.3,
                      }}
                    />
                  ))}
                </div>

                <button onClick={() => { setRecording(false); setStep('type') }} style={{
                  marginTop: 28, padding: '10px 24px', borderRadius: 12,
                  border: '1px solid #E8E3F8', background: 'transparent',
                  color: '#8B82C4', fontSize: 14, fontFamily: 'inherit', cursor: 'pointer',
                }}>
                  {language === 'uz' ? 'Bekor qilish' : language === 'uz_cyrl' ? 'Бекор қилиш' : language === 'ru' ? 'Отмена' : 'Cancel'}
                </button>
              </div>
            )}

            {/* Step: form */}
            {!saved && !isProcessing && step === 'form' && (
              <>
                {/* Type switcher */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 20, overflowX: 'auto' }}>
                  {(Object.keys(typeConfig) as EntryType[]).map((t) => {
                    const c = typeConfig[t]
                    const active = selectedType === t
                    return (
                      <button
                        key={t}
                        onClick={() => { setSelectedType(t); setEntry((e) => ({ ...e, type: t, category: categories[t][0] })) }}
                        style={{
                          flexShrink: 0,
                          padding: '7px 14px',
                          borderRadius: 20,
                          border: `1.5px solid ${active ? c.color : '#E8E3F8'}`,
                          background: active ? c.bg : 'transparent',
                          color: active ? c.color : '#8B82C4',
                          fontSize: 13,
                          fontWeight: active ? 600 : 400,
                          fontFamily: 'inherit',
                          cursor: 'pointer',
                        }}
                      >
                        {c.label}
                      </button>
                    )
                  })}
                </div>

                <AnimatePresence mode="wait">
                  <motion.div
                    key={selectedType}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.15 }}
                  >
                    {/* Amount */}
                    <div style={{ marginBottom: 14 }}>
                      <label style={{ fontSize: 12, color: '#8B82C4', fontWeight: 500, display: 'block', marginBottom: 6 }}>SUMMA (SO'M)</label>
                  <input
                    type="tel"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="0"
                    value={entry.amount}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/\D/g, '')
                      const fmt = raw.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
                      setEntry((prev) => ({ ...prev, amount: fmt }))
                    }}
                    style={{
                      width: '100%',
                      padding: '14px 16px',
                      borderRadius: 14,
                      border: '1.5px solid #E8E3F8',
                      background: '#F7F5FF',
                      fontSize: 22,
                      fontWeight: 700,
                      color: cfg.color,
                      fontFamily: 'inherit',
                      outline: 'none',
                    }}
                  />
                </div>

                {/* Category */}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 12, color: '#8B82C4', fontWeight: 500, display: 'block', marginBottom: 6 }}>KATEGORIYA</label>
                  <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                    {categories[selectedType].map((cat) => {
                      // Xaritalangan emojilar
                      const categoryEmoji: Record<string, string> = {
                        'Oziq-ovqat': '🍔',
                        'Transport': '🚗',
                        "Ko'ngil ochar": '🎮',
                        'Kiyim': '👕',
                        'Kommunal': '💡',
                        'Sog\'liq': '💊',
                        'Ta\'lim': '📚',
                        'Maosh': '💼',
                        'Freelance': '💻',
                        'Biznes': '📈',
                        'Investitsiya': '🏦',
                        'Sovg\'a': '🎁',
                        'Boshqa': '📦',
                        'Do\'st': '🤝',
                        'Bank': '🏦',
                        'Oila': '👨‍👩‍👧‍👦',
                        'Hamkasb': '👥'
                      }
                      const emoji = categoryEmoji[cat] || '✨'
                      
                      return (
                        <button
                          key={cat}
                          onClick={() => setEntry((e) => ({ ...e, category: cat }))}
                          style={{
                            flexShrink: 0,
                            padding: '7px 12px',
                            borderRadius: 10,
                            border: `1.5px solid ${entry.category === cat ? cfg.color : '#E8E3F8'}`,
                            background: entry.category === cat ? cfg.bg : 'transparent',
                            color: entry.category === cat ? cfg.color : '#8B82C4',
                            fontSize: 13,
                            fontFamily: 'inherit',
                            cursor: 'pointer',
                            fontWeight: entry.category === cat ? 600 : 400,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6
                          }}
                        >
                          <span>{emoji}</span>
                          <span>{cat}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Account Selection */}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 12, color: '#8B82C4', fontWeight: 500, display: 'block', marginBottom: 6 }}>
                    HISOBNI TANLANG
                  </label>
                  <select
                    value={entry.cardId || 'cash'}
                    onChange={(e) => setEntry((prev) => ({ ...prev, cardId: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '16px 20px',
                      borderRadius: 20,
                      border: '1px solid rgba(124, 58, 237, 0.15)',
                      background: 'linear-gradient(145deg, #FFFFFF, #F8F7FC)',
                      boxShadow: 'inset 0 2px 6px rgba(124, 58, 237, 0.03), 0 4px 16px rgba(124, 58, 237, 0.06)',
                      fontSize: 15,
                      fontWeight: 600,
                      color: '#4B456D',
                      fontFamily: 'inherit',
                      outline: 'none',
                      appearance: 'none',
                    }}
                  >
                    <option value="cash">Naqd pul (Umumiy balans)</option>
                    {cards.map(c => (
                      <option key={c.id} value={c.id}>{c.bank} ({c.number.slice(-4)})</option>
                    ))}
                  </select>
                </div>

                {/* Date Selection */}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 12, color: '#8B82C4', fontWeight: 500, display: 'block', marginBottom: 6 }}>SANA VA VAQT</label>
                  <input
                    type="datetime-local"
                    value={entry.date || ''}
                    onChange={(e) => setEntry((prev) => ({ ...prev, date: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '16px 20px',
                      borderRadius: 20,
                      border: '1px solid rgba(124, 58, 237, 0.15)',
                      background: 'linear-gradient(145deg, #FFFFFF, #F8F7FC)',
                      boxShadow: 'inset 0 2px 6px rgba(124, 58, 237, 0.03), 0 4px 16px rgba(124, 58, 237, 0.06)',
                      fontSize: 15,
                      fontWeight: 600,
                      color: '#4B456D',
                      fontFamily: 'inherit',
                      outline: 'none',
                      transition: 'all 0.3s ease',
                    }}
                    onFocus={(e) => {
                      e.target.style.boxShadow = 'inset 0 2px 6px rgba(124, 58, 237, 0.03), 0 0 0 3px rgba(124, 58, 237, 0.2)';
                      e.target.style.border = '1px solid rgba(124, 58, 237, 0.4)';
                    }}
                    onBlur={(e) => {
                      e.target.style.boxShadow = 'inset 0 2px 6px rgba(124, 58, 237, 0.03), 0 4px 16px rgba(124, 58, 237, 0.06)';
                      e.target.style.border = '1px solid rgba(124, 58, 237, 0.15)';
                    }}
                  />
                </div>

                {/* Note */}
                <div style={{ marginBottom: 20 }}>
                  <label style={{ fontSize: 12, color: '#8B82C4', fontWeight: 500, display: 'block', marginBottom: 6 }}>IZOH</label>
                  <input
                    type="text"
                    placeholder="Ixtiyoriy..."
                    value={entry.note}
                    onChange={(e) => setEntry((prev) => ({ ...prev, note: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '16px 20px',
                      borderRadius: 20,
                      border: '1px solid rgba(124, 58, 237, 0.15)',
                      background: 'linear-gradient(145deg, #FFFFFF, #F8F7FC)',
                      boxShadow: 'inset 0 2px 6px rgba(124, 58, 237, 0.03), 0 4px 16px rgba(124, 58, 237, 0.06)',
                      fontSize: 15,
                      fontWeight: 600,
                      color: '#4B456D',
                      fontFamily: 'inherit',
                      outline: 'none',
                      transition: 'all 0.3s ease',
                    }}
                    onFocus={(e) => {
                      e.target.style.boxShadow = 'inset 0 2px 6px rgba(124, 58, 237, 0.03), 0 0 0 3px rgba(124, 58, 237, 0.2)';
                      e.target.style.border = '1px solid rgba(124, 58, 237, 0.4)';
                    }}
                    onBlur={(e) => {
                      e.target.style.boxShadow = 'inset 0 2px 6px rgba(124, 58, 237, 0.03), 0 4px 16px rgba(124, 58, 237, 0.06)';
                      e.target.style.border = '1px solid rgba(124, 58, 237, 0.15)';
                    }}
                  />
                </div>

                <div style={{ display: 'flex', gap: 10, paddingTop: 8, paddingBottom: 24 }}>
                  <button
                    onClick={startVoice}
                    style={{
                      width: 48, height: 48, borderRadius: 14, flexShrink: 0,
                      border: '1.5px solid #E8E3F8', background: '#F7F5FF',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                      <rect x="6" y="1" width="6" height="10" rx="3" fill="#7C3AED" fillOpacity="0.8" />
                      <path d="M3 9C3 12.3 5.7 15 9 15C12.3 15 15 12.3 15 9" stroke="#7C3AED" strokeWidth="1.5" strokeLinecap="round" />
                      <line x1="9" y1="15" x2="9" y2="17" stroke="#7C3AED" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={!entry.amount}
                    style={{
                      flex: 1, padding: '14px',
                      borderRadius: 14, border: 'none',
                      background: entry.amount ? '#7C3AED' : '#EDE9FE',
                      color: entry.amount ? '#fff' : '#8B82C4',
                      fontSize: 15, fontWeight: 600, fontFamily: 'inherit',
                      cursor: entry.amount ? 'pointer' : 'default',
                      boxShadow: entry.amount ? '0 4px 16px rgba(124, 58, 237, 0.3)' : 'none',
                    }}
                  >
                    {language === 'uz' ? 'Saqlash' : language === 'uz_cyrl' ? 'Сақлаш' : language === 'ru' ? 'Сохранить' : 'Save'}
                  </button>
                </div>
                  </motion.div>
                </AnimatePresence>
              </>
            )}

            {step === 'removeSamples' && (
              <div style={{ padding: '10px 0', textAlign: 'center' }}>
                <div style={{ fontSize: 40, marginBottom: 16 }}>🧹</div>
                <h3 style={{ fontSize: 20, fontWeight: 700, color: '#1E1A3C', marginBottom: 8 }}>
                  Namuna ma'lumotlari o'chirilsinmi?
                </h3>
                <p style={{ fontSize: 14, color: '#8B82C4', marginBottom: 24, lineHeight: 1.5 }}>
                  Siz o'zingizning birinchi tranzaksiyangizni qo'shdingiz! Dasturni o'rganish uchun kiritilgan barcha namuna ma'lumotlarini o'chirib yuboraylikmi?
                </p>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    onClick={() => {
                      setHasSampleData(false)
                      setSaved(true)
                      setTimeout(() => closeModal(), 1200)
                    }}
                    style={{
                      flex: 1, padding: 14, background: '#DC2626', color: '#fff',
                      border: 'none', borderRadius: 14, fontSize: 15, fontWeight: 600, cursor: 'pointer'
                    }}
                  >
                    Ha, o'chirish
                  </button>
                  <button
                    onClick={() => {
                      setSaved(true)
                      setTimeout(() => closeModal(), 1200)
                    }}
                    style={{
                      flex: 1, padding: 14, background: '#F5F4FA', color: '#1E1A3C',
                      border: 'none', borderRadius: 14, fontSize: 15, fontWeight: 600, cursor: 'pointer'
                    }}
                  >
                    Yo'q, qolsin
                  </button>
                </div>
              </div>
            )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        @keyframes ripple {
          0% { transform: scale(1); opacity: 1; }
          100% { transform: scale(1.5); opacity: 0; }
        }
        @keyframes wave {
          0%, 100% { height: 12px; }
          50% { height: 28px; }
        }
      `}</style>
    </>
  )
}
