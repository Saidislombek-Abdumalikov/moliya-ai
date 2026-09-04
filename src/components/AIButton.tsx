import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useFinance } from '../FinanceContext'

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

async function parseAIText(text: string, cardsList: any[] = [], userId?: string): Promise<{ type: EntryType; amount: string; category: string; note: string; title?: string; debtWho?: string; date?: string; cardId?: string }> {
  const res = await fetch('/api/parse-expense', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, cards: cardsList, userId })
  });
  
  if (res.status === 429) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.message || '⚠️ Bugungi bepul AI limitingiz tugadi. Xarajatlarni ilovada qo\'lda kiritish mutlaqo bepul va cheksiz!');
  }

  if (res.ok) {
    const data = await res.json();
    if (data.amount && data.category) {
      return { type: data.type || 'expense', amount: data.amount, category: data.category, note: data.note || text, title: data.title, debtWho: data.debtWho, date: data.date, cardId: data.cardId };
    }
  }

  throw new Error('AI orqali tahlil qilib bo\'lmadi. Iltimos, pastdagi maydonlarni qo\'lda to\'ldiring.');
}

export default function AIButton({ visible = true, language = 'uz' }: { visible?: boolean; language?: 'uz' | 'uz_cyrl' | 'ru' | 'en' }) {
  const { addTransaction, hasSampleData, setHasSampleData, cards, onboarding, userId } = useFinance()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'type' | 'form' | 'voice' | 'done' | 'removeSamples'>('type')
  const [selectedType, setSelectedType] = useState<EntryType>('expense')
  const [recording, setRecording] = useState(false)
  const [entry, setEntry] = useState<Entry>({ type: 'expense', amount: '', note: '', category: '' })
  const [saved, setSaved] = useState(false)
  const [aiText, setAiText] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [aiError, setAiError] = useState('')
  const [tipIndex, setTipIndex] = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recognitionRef = useRef<any>(null)
  const isStartingVoiceRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isProcessing) return
    const interval = setInterval(() => {
      setTipIndex(prev => (prev + 1) % 4)
    }, 2200)
    return () => clearInterval(interval)
  }, [isProcessing])

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!checkAndDeductAIQuery()) return

    setIsProcessing(true)
    setAiError('')
    try {
      const reader = new FileReader()
      reader.onload = async () => {
        const base64Data = reader.result as string
        try {
          const res = await fetch('/api/parse-receipt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base64Image: base64Data, mimeType: file.type, userId })
          })

          if (res.status === 429) {
            const errData = await res.json().catch(() => ({}));
            setAiError(errData.message || '⚠️ Bugungi bepul AI chek skanerlash limitingiz tugadi. Xarajatni pastdagi forma orqali qo\'lda kiritishingiz mumkin!');
            setStep('form');
            return;
          }

          let parsed: any = null
          if (res.ok) {
            parsed = await res.json()
          }

          if (!parsed || !parsed.amount) {
            setAiError("Chekni aniqlab bo'lmadi. Iltimos, xarajatni qo'lda kiriting.");
            setStep('form')
            return
          }

          setSelectedType(parsed.type || 'expense')
          const localISOTime = (new Date(Date.now() - new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16)
          setEntry(prev => ({
            ...prev,
            type: parsed.type || 'expense',
            amount: parsed.amount || '0',
            note: parsed.note || '',
            category: parsed.category || 'Boshqa',
            title: parsed.title || '',
            date: parsed.date || localISOTime,
            cardId: prev.cardId || 'cash',
          }))
          setStep('form')
        } catch (err: any) {
          console.error(err)
          setAiError(err?.message || (language === 'uz' ? "Rasmni aniqlab bo'lmadi, qo'lda kiriting" : "Couldn't read receipt image"))
          setStep('form')
        } finally {
          setIsProcessing(false)
        }
      }
      reader.readAsDataURL(file)
    } catch (err) {
      console.error(err)
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
    setOpen(true)
  }

  const closeModal = () => {
    stopVoice()
    setOpen(false)
    setRecording(false)
    if (timerRef.current) clearTimeout(timerRef.current)
  }

  const selectType = (t: EntryType) => {
    setSelectedType(t)
    setEntry((e) => ({ ...e, type: t, category: categories[t][0] }))
    setStep('form')
  }

  const AI_FREE_LIMIT = 20

  const checkAndDeductAIQuery = (): boolean => {
    if (onboarding?.isPremium) return true
    
    // Check if daily quota reached in onboarding state
    const obAny = onboarding as any
    if (obAny?.aiLimit && obAny.aiLimit > 0 && (obAny?.aiQueryCount || 0) >= obAny.aiLimit) {
      setAiError(
        (language === 'uz' || language === 'uz_cyrl')
          ? `⚠️ Bugungi bepul AI limitingiz tugadi. Xarajatlarni qo'lda kiritish mutlaqo bepul va cheksiz! Cheksiz AI uchun VIP Premium oling.`
          : `Daily AI limit reached. Manual entry is completely free and unlimited!`
      );
      setStep('form');
      return false;
    }

    const now = new Date()
    const dayKey = `ai_query_count_${now.getFullYear()}_${now.getMonth() + 1}_${now.getDate()}`
    const currentCount = parseInt(localStorage.getItem(dayKey) || '0', 10)
    if (currentCount >= AI_FREE_LIMIT) {
      setAiError(
        (language === 'uz' || language === 'uz_cyrl')
          ? `⚠️ Bugungi bepul AI limitingiz (${AI_FREE_LIMIT} ta) tugadi. Xarajatlarni qo'lda kiritish mutlaqo bepul va cheksiz!`
          : `Daily limit of ${AI_FREE_LIMIT} AI queries reached. Manual entry is completely free!`
      )
      setStep('form');
      return false
    }
    localStorage.setItem(dayKey, (currentCount + 1).toString())
    return true
  }

  const handleAiTextSubmit = async () => {
    if (!aiText.trim()) return

    if (!checkAndDeductAIQuery()) return

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
      const errTxt = e?.message || '';
      setAiError(errTxt || (language === 'uz' ? "Tushunmadim, iltimos qo'lda kiriting" : "Couldn't parse that, please enter manually"));
      setStep('form');
    } finally {
      setIsProcessing(false)
    }
  }

  const getMicPermissionStatus = async (): Promise<'granted' | 'denied' | 'prompt'> => {
    // 1. Query browser permission API if supported
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      try {
        const result = await navigator.permissions.query({ name: 'microphone' as PermissionName })
        if (result.state === 'granted') {
          localStorage.setItem('mic_perm_granted', 'true')
          return 'granted'
        }
        if (result.state === 'denied') {
          localStorage.removeItem('mic_perm_granted')
          return 'denied'
        }
        return result.state
      } catch {
        // Some environments (iOS Safari, older WebViews) throw on microphone query
      }
    }

    // 2. Check cached permission flag
    if (localStorage.getItem('mic_perm_granted') === 'true') {
      return 'granted'
    }

    return 'prompt'
  }

  const stopVoice = () => {
    if (recognitionRef.current) {
      try {
        if (typeof recognitionRef.current.abort === 'function') {
          recognitionRef.current.abort()
        } else if (typeof recognitionRef.current.stop === 'function') {
          recognitionRef.current.stop()
        }
      } catch {}
      recognitionRef.current = null
    }
    setRecording(false)
    isStartingVoiceRef.current = false
  }

  const startVoice = async () => {
    // Prevent duplicate calls, rapid clicking, and race conditions
    if (isStartingVoiceRef.current || recording) {
      return
    }
    isStartingVoiceRef.current = true

    try {
      if (!checkAndDeductAIQuery()) {
        setStep('type')
        return
      }

      // Check if Web Speech API is supported before any permissions
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      if (!SpeechRecognition) {
        throw new Error("SPEECH_NOT_SUPPORTED")
      }

      // Step 1: Check if permission is already granted or denied
      const permStatus = await getMicPermissionStatus()

      if (permStatus === 'denied') {
        setRecording(false)
        setStep('type')
        setAiError(
          (language === 'uz' || language === 'uz_cyrl')
            ? (language === 'uz_cyrl'
                ? "Микрофон рухсати берилмаган. Илтимос, браузер ёки Telegram созламаларидан микрофонга рухсат беринг 🎙️"
                : "Mikrofon ruxsati berilmagan. Iltimos, brauzer yoki Telegram sozlamalaridan mikrofonga ruxsat bering 🎙️")
            : language === 'ru'
            ? 'Доступ к микрофону запрещен. Пожалуйста, разрешите доступ к микрофону в настройках 🎙️'
            : 'Microphone permission denied. Please allow microphone access in your settings 🎙️'
        )
        return
      }

      // Step 2: If permission has NOT yet been granted ('prompt'), request ONCE via native getUserMedia.
      // If already 'granted', SKIP getUserMedia completely to prevent double prompts!
      if (permStatus !== 'granted') {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            stream.getTracks().forEach(t => t.stop())
            localStorage.setItem('mic_perm_granted', 'true')
          } catch (micErr: any) {
            console.warn('Microphone permission denied by user/browser:', micErr)
            localStorage.removeItem('mic_perm_granted')
            setRecording(false)
            setStep('type')
            setAiError(
              (language === 'uz' || language === 'uz_cyrl')
                ? (language === 'uz_cyrl'
                    ? "Микрофон рухсати берилмаган. Илтимос, браузер ёки Telegram созламаларидан микрофонга рухсат беринг 🎙️"
                    : "Mikrofon ruxsati berilmagan. Iltimos, brauzer yoki Telegram sozlamalaridan mikrofonga ruxsat bering 🎙️")
                : language === 'ru'
                ? 'Доступ к микрофону запрещен. Пожалуйста, разрешите доступ к микрофону в настройках 🎙️'
                : 'Microphone permission denied. Please allow microphone access in your settings 🎙️'
            )
            return
          }
        }
      }

      // Step 3: Clean up any previous speech recognition instance
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort ? recognitionRef.current.abort() : recognitionRef.current.stop()
        } catch {}
        recognitionRef.current = null
      }

      // Step 4: Start recording immediately
      setStep('voice')
      setRecording(true)

      const rec = new SpeechRecognition()
      rec.lang = (language === 'uz' || language === 'uz_cyrl') ? 'uz-UZ' : language === 'ru' ? 'ru-RU' : 'en-US'
      rec.interimResults = false
      rec.maxAlternatives = 1

      rec.onresult = async (event: any) => {
        const resultText = event.results[0][0].transcript
        setRecording(false)
        setIsProcessing(true)
        setAiError('')

        try {
          const parsed = await parseAIText(resultText, cards, userId || undefined)
          const localISOTime = (new Date(Date.now() - new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16)
          setEntry(prev => ({
            ...prev,
            type: parsed.type,
            amount: parsed.amount,
            note: resultText,
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
          setEntry(prev => ({
            ...prev,
            note: resultText
          }))
          setAiError(e?.message || (language === 'uz' ? "Tushunmadim, iltimos pastda tekshirib tasdiqlang" : language === 'uz_cyrl' ? "Тушунмадим, илтимос пастда текшириб тасдиқланг" : language === 'ru' ? 'Не удалось распознать, пожалуйста, проверьте ниже' : "Couldn't parse that, please verify below"))
          setStep('form')
        } finally {
          setIsProcessing(false)
        }
      }

      rec.onerror = (e: any) => {
        console.error("Speech recognition error:", e)
        stopVoice()
        setStep('type')
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          localStorage.removeItem('mic_perm_granted')
          setAiError(
            (language === 'uz' || language === 'uz_cyrl')
              ? (language === 'uz_cyrl'
                  ? "Микрофон рухсати берилмаган. Илтимос, браузер ёки Telegram созламаларидан микрофонга рухсат беринг 🎙️"
                  : "Mikrofon ruxsati berilmagan. Iltimos, brauzer yoki Telegram sozlamalaridan mikrofonga ruxsat bering 🎙️")
              : language === 'ru'
              ? 'Доступ к микрофону запрещен. Пожалуйста, разрешите доступ к микрофону в настройках 🎙️'
              : 'Microphone permission denied. Please allow microphone access in your settings 🎙️'
          )
        } else {
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
      }

      rec.onend = () => {
        setRecording(false)
        isStartingVoiceRef.current = false
      }

      recognitionRef.current = rec
      rec.start()
    } catch (e: any) {
      console.error("Voice start error:", e)
      setRecording(false)
      setStep('type')
      if (e?.message === 'SPEECH_NOT_SUPPORTED') {
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
    } finally {
      isStartingVoiceRef.current = false
    }
  }


  const handleSave = async () => {
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
    
    setIsSaving(true)
    setAiError('')
    try {
      // 1. Authoritative backend/Supabase persistence must complete BEFORE success
      await addTransaction(customTx)

      if (hasSampleData) {
        await setHasSampleData(false)
      }

      // 2. Database confirmed success: show celebratory card and auto-dismiss
      setSaved(true)
      setTimeout(() => {
        closeModal()
      }, 2400)
    } catch (saveErr: any) {
      console.error('[AIButton] Failed to save transaction to database:', saveErr)
      setAiError(
        (language === 'uz' || language === 'uz_cyrl')
          ? (language === 'uz_cyrl'
              ? "Маълумотлар базасига сақлашда хатолик юз берди. Илтимос, қайта уриниб кўринг."
              : "Ma'lumotlar bazasiga saqlashda xatolik yuz berdi. Iltimos, qayta urinib ko'ring.")
          : language === 'ru'
          ? "Ошибка сохранения в базу данных. Пожалуйста, попробуйте снова."
          : "Error saving to database. Please try again."
      )
    } finally {
      setIsSaving(false)
    }
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
            onClick={() => {
              if (!isProcessing && !isSaving) closeModal()
            }}
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
                if (!isProcessing && !isSaving && info.offset.y > 100) closeModal()
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

            {/* Celebratory Post-Transaction Marketing Card */}
            {saved && (
              <motion.div
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'spring', damping: 20 }}
                style={{ textAlign: 'center', padding: '16px 8px 12px' }}
              >
                {/* Glowing Celebratory Badge */}
                <div style={{ position: 'relative', width: 76, height: 76, margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <motion.div
                    animate={{ scale: [1, 1.35, 1], opacity: [0.35, 0.75, 0.35] }}
                    transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                    style={{
                      position: 'absolute',
                      width: 76,
                      height: 76,
                      borderRadius: '50%',
                      background: entry.type === 'income'
                        ? 'radial-gradient(circle, rgba(22,163,74,0.35) 0%, rgba(22,163,74,0) 70%)'
                        : 'radial-gradient(circle, rgba(124,58,237,0.35) 0%, rgba(124,58,237,0) 70%)',
                    }}
                  />
                  <div style={{
                    width: 58,
                    height: 58,
                    borderRadius: 20,
                    background: entry.type === 'income'
                      ? 'linear-gradient(135deg, #22C55E 0%, #16A34A 100%)'
                      : 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: entry.type === 'income'
                      ? '0 8px 24px rgba(22,163,74,0.35)'
                      : '0 8px 24px rgba(124,58,237,0.35)',
                    color: '#ffffff',
                    fontSize: 28,
                    fontWeight: 800,
                  }}>
                    ✓
                  </div>
                </div>

                <h3 style={{ fontSize: 20, fontWeight: 800, color: '#1E1A3C', marginBottom: 6 }}>
                  {language === 'uz' ? 'Muvaffaqiyatli saqlandi! 🎉' : language === 'uz_cyrl' ? 'Муваффақиятли сақланди! 🎉' : language === 'ru' ? 'Успешно сохранено! 🎉' : 'Successfully Saved! 🎉'}
                </h3>

                {/* Amount & Category Pill */}
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  background: entry.type === 'income' ? '#F0FDF4' : '#FEF2F2',
                  border: `1px solid ${entry.type === 'income' ? '#DCFCE7' : '#FEE2E2'}`,
                  borderRadius: 20,
                  padding: '6px 16px',
                  margin: '6px auto 14px',
                }}>
                  <span style={{
                    fontSize: 16,
                    fontWeight: 800,
                    color: entry.type === 'income' ? '#16A34A' : '#DC2626',
                  }}>
                    {entry.type === 'income' ? '+' : '-'}{Number(String(entry.amount).replace(/[^\d]/g, '') || 0).toLocaleString('uz-UZ').replace(/,/g, ' ')} so'm
                  </span>
                  {entry.category && (
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#5C548A' }}>
                      • {entry.category}
                    </span>
                  )}
                </div>

                {/* Engaging Marketing Motivation Card */}
                <div style={{
                  background: 'linear-gradient(135deg, #F8F7FF 0%, #F5F3FF 100%)',
                  border: '1px solid #EDE9FE',
                  borderRadius: 16,
                  padding: '14px 16px',
                  marginBottom: 16,
                  textAlign: 'left'
                }}>
                  <p style={{ fontSize: 13, color: '#6D28D9', fontWeight: 600, lineHeight: 1.45, margin: 0 }}>
                    ✨ {language === 'uz'
                      ? "Moliyaviy intizom — kelajak boyligingiz! Balansingiz va diagrammalar yangilandi."
                      : language === 'uz_cyrl'
                      ? "Молиявий интизом — келажак бойлигингиз! Балансингиз ва диаграммалар янгиланди."
                      : language === 'ru'
                      ? "Финансовая дисциплина — ключ к богатству! Баланс и графики обновлены."
                      : "Financial discipline is the path to wealth! Your balance and charts have been updated."}
                  </p>
                </div>

                {/* Instant CTA Button */}
                <button
                  onClick={closeModal}
                  style={{
                    width: '100%',
                    padding: '14px 20px',
                    borderRadius: 16,
                    border: 'none',
                    background: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)',
                    color: '#ffffff',
                    fontSize: 15,
                    fontWeight: 700,
                    cursor: 'pointer',
                    boxShadow: '0 4px 14px rgba(124,58,237,0.35)',
                  }}
                >
                  {language === 'uz' ? "Balansni ko'rish 🚀" : language === 'uz_cyrl' ? "Балансни кўриш 🚀" : language === 'ru' ? "Смотреть баланс 🚀" : "View Balance 🚀"}
                </button>
              </motion.div>
            )}

            {/* Processing state with dynamic rotating tips */}
            {isProcessing && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '30px 10px', minHeight: 270 }}>
                {/* Glowing pulsating AI circle */}
                <div style={{ position: 'relative', width: 90, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
                  <motion.div
                    animate={{
                      scale: [1, 1.3, 1],
                      opacity: [0.3, 0.7, 0.3],
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
                      background: 'radial-gradient(circle, rgba(124,58,237,0.35) 0%, rgba(124,58,237,0) 70%)',
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
                      width: 56,
                      height: 56,
                      borderRadius: 18,
                      background: 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 8px 24px rgba(124,58,237,0.45)',
                    }}
                  >
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                      <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M2 17L12 22L22 17" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M2 12L12 17L22 12" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </motion.div>
                </div>

                <motion.p
                  animate={{ opacity: [0.6, 1, 0.6] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                  style={{ fontSize: 17, fontWeight: 700, color: '#1E1A3C', marginBottom: 6 }}
                >
                  {language === 'uz' ? "AI tahlil qilmoqda..." : language === 'uz_cyrl' ? "AI таҳлил қилмоқда..." : language === 'ru' ? "ИИ анализирует..." : "AI analyzing..."}
                </motion.p>
                <p style={{ fontSize: 13, color: '#8B82C4', textAlign: 'center', maxWidth: 300, marginBottom: 16 }}>
                  {language === 'uz' ? "Summa, toifa va ma'lumotlar aniqlanmoqda" : language === 'uz_cyrl' ? "Сумма, тоифа ва маълумотлар аниқланмоқда" : language === 'ru' ? "Определение суммы, категории и деталей" : "Extracting amount, category, and details"}
                </p>

                {/* Rotating engaging marketing/wisdom tip */}
                <div style={{
                  background: '#F7F5FF',
                  border: '1px solid #DDD6FE',
                  borderRadius: 14,
                  padding: '10px 14px',
                  maxWidth: 320,
                  textAlign: 'center',
                  minHeight: 52,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <AnimatePresence mode="wait">
                    <motion.p
                      key={tipIndex}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      transition={{ duration: 0.25 }}
                      style={{ fontSize: 12, color: '#6D28D9', fontWeight: 600, margin: 0, lineHeight: 1.4 }}
                    >
                      {[
                        language === 'uz' ? "💡 Har kuni xarajatlarni yozib borish — moliyaviy erkinlik sari eng katta qadam!" : "💡 Recording daily expenses is the greatest step toward financial freedom!",
                        language === 'uz' ? "⚡ Moliya AI cheklar va xabarlarni 1 soniyada avtomatik toifalarga ajratadi" : "⚡ Moliya AI categorizes receipts and messages in 1 second",
                        language === 'uz' ? "🎯 Oylik limitingizni belgilang va orzuingizdagi maqsadga 2 barobar tezroq erishing" : "🎯 Set your monthly limit and reach your goals twice as fast",
                        language === 'uz' ? "👑 VIP Premium bilan cheksiz AI va chuqur tahlillarga ega bo'ling" : "👑 Enjoy unlimited AI and deep analytics with VIP Premium"
                      ][tipIndex]}
                    </motion.p>
                  </AnimatePresence>
                </div>
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
                  onClick={() => { setSelectedType('expense'); startVoice() }}
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

                <button onClick={() => { stopVoice(); setStep('type') }} style={{
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
                    value={(() => {
                      const now = new Date();
                      const pad = (n: number) => String(n).padStart(2, '0');
                      const fallback = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
                      if (!entry.date) return fallback;
                      const str = String(entry.date).trim();
                      if (str.includes('T') && str.length >= 16) return str.slice(0, 16);
                      if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return `${str}T12:00`;
                      const d = new Date(str);
                      if (!isNaN(d.getTime())) {
                        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                      }
                      return fallback;
                    })()}
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
                    disabled={!entry.amount || isSaving}
                    style={{
                      flex: 1, padding: '14px',
                      borderRadius: 14, border: 'none',
                      background: (!entry.amount || isSaving) ? '#EDE9FE' : '#7C3AED',
                      color: (!entry.amount || isSaving) ? '#8B82C4' : '#fff',
                      fontSize: 15, fontWeight: 600, fontFamily: 'inherit',
                      cursor: (!entry.amount || isSaving) ? 'default' : 'pointer',
                      boxShadow: (entry.amount && !isSaving) ? '0 4px 16px rgba(124, 58, 237, 0.3)' : 'none',
                    }}
                  >
                    {isSaving
                      ? (language === 'uz' ? 'Saqlanmoqda...' : language === 'uz_cyrl' ? 'Сақланмоқда...' : language === 'ru' ? 'Сохранение...' : 'Saving...')
                      : (language === 'uz' ? 'Saqlash' : language === 'uz_cyrl' ? 'Сақлаш' : language === 'ru' ? 'Сохранить' : 'Save')}
                  </button>
                </div>
                {aiError && (
                  <p style={{ fontSize: 13, color: '#DC2626', marginTop: -14, marginBottom: 16, textAlign: 'center' }}>{aiError}</p>
                )}
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
