import {aiPopupStyle,aiPopupTransition} from './aiPopupStyle';
import {localTransactionDate} from '../../shared/transactionDate';
import AssistantReview from './AssistantReview';
import {normalizeAssistantReply,cleanCategoryPreferences,type AssistantReply} from '../../shared/assistant';
import {debtPersonLabel} from '../../shared/debtPeople';
import {debtPrincipalText,validDay,reminderPromise} from '../../shared/debts';
import {prepareSilenceMonitor} from '../voiceSilence';
import SwipeSheet from './SwipeSheet';
import {prepareRecordingCue,triggerVoiceHaptic,playStopRecordingCue} from '../recordingCue';
import {readMoneyInput,formatMoneyInput} from '../../shared/moneyInput';
import {prepareReceiptImage} from '../receiptImage';
import {recordedWav,blobDataUrl} from '../audioRecorder';
import {transactionParts,TRANSACTION_CLARIFICATION} from '../../shared/amountEvidence';
import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { useFinance, getClientAuthHeaders } from '../FinanceContext'
import { aiButtonCopy, aiCategoryLabel } from './aiButtonCopy'

type EntryType = 'expense' | 'income' | 'debt' | 'lending'

interface Entry {
  type: EntryType
  amount: string
  note: string
  category: string
  title?: string
  debtDueDate?: string | null
  debtDateConfirmed?: boolean
  debtRelationship?: string
  debtPersonId?: string
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

// HTTP 429 can mean temporary request throttling, not an exhausted daily quota.
export async function ai429Code(response: Response): Promise<string> {
  const data = await response.json().catch(() => ({}))
  return ['QUOTA_EXCEEDED', 'quota_exceeded'].includes(data.error || data.code)
    ? 'AI_QUOTA' : 'AI_RATE_LIMIT'
}

export async function parseAIText(text: string, cardsList: any[] = [], userId?: string): Promise<{ type: EntryType; amount: string; category: string; note: string; title?: string; debtWho?: string; debtDueDate?:string|null; debtDateConfirmed?:boolean; date?: string; cardId?: string }> {
  if (transactionParts(debtPrincipalText(text))?.length !== 1) throw new Error(TRANSACTION_CLARIFICATION)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 40000)
  let res: Response
  try {
    res = await fetch('/api/parse-expense', {
      method: 'POST',
      headers: getClientAuthHeaders(),
      body: JSON.stringify({ text, cards: cardsList, userId }),
      signal: controller.signal
    })
  } finally { clearTimeout(timeoutId) }

  if (res.status === 401) throw new Error('SESSION_REQUIRED');
  if (res.status === 403) throw new Error('ACCOUNT_RESTRICTED');
  if (res.status >= 500) {const failure=await res.json().catch(()=>({}));throw new Error(failure.error==='AI_NOT_CONFIGURED'?'AI_NOT_CONFIGURED':'AI_SERVICE_UNAVAILABLE');}
  if (res.status === 422) throw new Error(TRANSACTION_CLARIFICATION)
  if (res.status === 429) {
    throw new Error(await ai429Code(res))
  }
  if (res.ok) {
    const data = await res.json()
    if (['expense', 'income', 'debt', 'lending'].includes(data.type) && readMoneyInput(data.amount) !== null && typeof data.category === 'string' && data.category.trim()) {
      return {
        type: data.type,
        amount: String(data.amount),
        category: data.category,
        note: data.note || text,
        title: data.title || text.slice(0, 80),
        debtWho: data.debtWho,
        debtDueDate:data.debtDueDate,
        debtDateConfirmed:data.debtDateConfirmed,
        date: data.date,
        cardId: data.cardId || 'cash'
      }
    }
  }
  throw new Error('AI orqali tahlil qilib bo‘lmadi. Ma’lumotni qo‘lda kiriting.')
}

export default function AIButton({ visible = true, language = 'uz' }: { visible?: boolean; language?: 'uz' | 'uz_cyrl' | 'ru' | 'en' }) {
  const copy = aiButtonCopy(language)
  const sessionMessage = ({uz:'Sessiya tugagan. Bot orqali qayta kiring.',uz_cyrl:'Сессия тугаган. Бот орқали қайта киринг.',ru:'Сессия истекла. Войдите через бота снова.',en:'Session expired. Sign in through the bot again.'})[language];
  const serviceMessage = ({uz:'AI xizmatidan javob kelmadi. Birozdan so‘ng qayta urinib ko‘ring.',uz_cyrl:'AI хизматидан жавоб келмади. Бироздан сўнг қайта уриниб кўринг.',ru:'Сервис ИИ не ответил. Попробуйте немного позже.',en:'The AI service did not respond. Please try again shortly.'})[language];
  const restrictedMessage = ({uz:'Hisobga kirish cheklangan. Botdagi tasdiqlarni tekshiring.',uz_cyrl:'Ҳисобга кириш чекланган. Ботдаги тасдиқларни текширинг.',ru:'Доступ ограничен. Проверьте подтверждения в боте.',en:'Access restricted. Check your verification in the bot.'})[language];
  const typeIndex = (type: EntryType) => (Object.keys(typeConfig) as EntryType[]).indexOf(type)
  const { addTransaction, hasSampleData, setHasSampleData, cards, userId,customTransactions,onboarding } = useFinance()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'type' | 'form' | 'voice' | 'done' | 'removeSamples' | 'assistant'>('type')
  const [assistantReply,setAssistantReply]=useState<AssistantReply|null>(null);
  const [assistantHistory,setAssistantHistory]=useState<Array<{role:string;content:string}>>([]);
  const [assistantDraftId,setAssistantDraftId]=useState<string|undefined>();
  const openedDraft=useRef('');
  const saveId=useRef<string>('');
  const closeAfterSave=useRef<ReturnType<typeof setTimeout>|null>(null);
  const savingRef=useRef(false);
  const [reviewKey,setReviewKey]=useState(0);
  const [assistantFooterHost,setAssistantFooterHost]=useState<HTMLDivElement|null>(null);
  const [selectedType, setSelectedType] = useState<EntryType>('expense')
  const reducedMotion=useReducedMotion();
  const [voiceStarting,setVoiceStarting]=useState(false);
  const autoSend=onboarding?.voice_auto_send === true;
  const autoSendRef=useRef(autoSend);
  useEffect(()=>{autoSendRef.current=autoSend},[autoSend]);
  const silenceMonitor=useRef<ReturnType<typeof prepareSilenceMonitor>|null>(null);
  const [autoAvailable,setAutoAvailable]=useState(true);
  const [recording, setRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  useEffect(() => {
    if (!recording) { setRecordingSeconds(0); return; }
    const id = setInterval(() => setRecordingSeconds(sec => sec + 1), 1000);
    return () => clearInterval(id);
  }, [recording])
  const [entry, setEntry] = useState<Entry>({ type: 'expense', amount: '', note: '', category: '' })
  const [saved, setSaved] = useState(false)
  const [aiText, setAiText] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [aiError, setAiError] = useState('')
  const [tipIndex, setTipIndex] = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const voiceTypeOverride = useRef<EntryType|null>(null)
  const voiceGeneration = useRef(0)
  const requestRef = useRef<AbortController | null>(null)
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
    if (!file || isProcessing) return
    const generation=voiceGeneration.current
    const controller=new AbortController();requestRef.current=controller
    const timeout=setTimeout(()=>controller.abort(),45000)

    setIsProcessing(true)
    setAiError('')
    try {
      const base64Data = await prepareReceiptImage(file)
      if(generation!==voiceGeneration.current)return
      {
        try {
          const res = await fetch('/api/parse-receipt', {
            method: 'POST',
            headers: getClientAuthHeaders(),
            body: JSON.stringify({ base64Image: base64Data, mimeType: 'image/jpeg', userId }),
            signal: controller.signal
          })

          if(generation!==voiceGeneration.current)return
          if (res.status === 401 || res.status === 403) {
            setAiError(res.status === 401 ? sessionMessage : restrictedMessage);
            setStep('form'); return;
          }
          if (res.status >= 500) {setAiError(serviceMessage);setStep('form');return;}
          if (res.status === 429) {
            const code=await ai429Code(res);
            if(generation!==voiceGeneration.current)return
            setAiError(code === 'AI_QUOTA' ? copy.quota : copy.throttle);
            setStep('form');
            return;
          }

          let parsed: any = null
          if (res.ok) {
            parsed = await res.json()
          }

          if(generation!==voiceGeneration.current)return
          if (!parsed || !parsed.amount) {
            setAiError(copy.receiptFailed);
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
          if(generation!==voiceGeneration.current)return
          console.error(err)
          setAiError(err?.name === 'TimeoutError' || err?.name === 'AbortError' ? serviceMessage : copy.receiptFailed)
          setStep('form')
        } finally {
          if(generation===voiceGeneration.current)setIsProcessing(false)
        }
      }

    } catch (err) {
      if(generation!==voiceGeneration.current)return
      setAiError(copy.receiptFailed)
      setStep('form')
      setIsProcessing(false)
    } finally { clearTimeout(timeout);if(requestRef.current===controller)requestRef.current=null;e.target.value='' }
  }

  useEffect(() => () => {
    silenceMonitor.current?.stop();silenceMonitor.current=null;
    voiceGeneration.current++
    if(closeAfterSave.current)clearTimeout(closeAfterSave.current);
    requestRef.current?.abort()
    if(timerRef.current)clearTimeout(timerRef.current)
    if(recorderRef.current?.state==='recording')recorderRef.current.stop()
    streamRef.current?.getTracks().forEach(track=>track.stop())
  }, [])

  const showAssistant = (reply: AssistantReply) => {
    setAssistantReply(reply);setReviewKey(k=>k+1);
    const a=reply.actions[0];
    if(!a){setAiError(reply.question||reply.message);setStep('type');return;}
    if(a.currency==='UZS' && ['expense','income','debt','lending'].includes(a.kind)){
      const type=a.kind as EntryType;
      setSelectedType(type);
      setEntry({type,amount:a.amount===null?'':String(a.amount),category:a.category,title:a.title,note:a.note||reply.transcription||a.title,date:a.date? a.date+'T'+(a.time||new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tashkent',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date())):'',cardId:a.cardId||'cash',debtWho:a.person,debtDueDate:a.dueDate,debtDateConfirmed:!!a.dueDate||a.dueUnknown});
      setAiError(reply.question);setStep('form');
    }else setStep('assistant');
  };

  useEffect(()=>{
    const draft=onboarding?.assistant_draft;
    const wanted=new URLSearchParams(location.search).get('assistant');
    if(!draft||draft.id!==wanted||openedDraft.current===draft.id)return;
    openedDraft.current=draft.id;setAssistantDraftId(draft.id);showAssistant(normalizeAssistantReply(draft.reply));setAssistantHistory([{role:'assistant',content:JSON.stringify(draft.reply)}]);setSaved(false);setOpen(true);
  },[onboarding?.assistant_draft?.id]);
  const finishAssistant=()=>{
    if(assistantDraftId)void fetch('/api/auth/sync-data',{method:'POST',headers:getClientAuthHeaders(),body:JSON.stringify({clearAssistantDraft:assistantDraftId})}).catch(()=>{});
    setSaved(true);setStep('done');
  };

  if (!visible) return null

  const openModal = () => {
    if(closeAfterSave.current)clearTimeout(closeAfterSave.current);
    saveId.current='ai_'+crypto.randomUUID();voiceTypeOverride.current=null;setSelectedType('expense');
    setAssistantDraftId(undefined);setAssistantReply(null);setAssistantHistory([]);
    setStep('type')
    const localISOTime = (new Date(Date.now() - new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16)
    setEntry({ type: 'expense', amount: '', note: '', category: '', date: localISOTime, cardId: 'cash' })
    setAiText('')
    setAiError('')
    setSaved(false)
    setOpen(true)
  }

  const closeModal = () => {
    if(isSaving)return;
    if(closeAfterSave.current)clearTimeout(closeAfterSave.current);
    stopVoice()
    setOpen(false)
    setRecording(false)
    if (timerRef.current) clearTimeout(timerRef.current)
  }

  const selectType = (t: EntryType) => {
    setAssistantReply(null);setAiError('');
    setSelectedType(t)
    setEntry((e) => ({ ...e, type: t, category: categories[t][0], ...(['debt','lending'].includes(t)&&!e.debtDueDate?{debtDateConfirmed:true}:{}) }))
    setStep('form')
  }

  const requestAssistant=async(text:string)=>{
    if(!text.trim()||isProcessing)return;
    setIsProcessing(true);setAiError('');
    const generation=voiceGeneration.current;
    const controller=new AbortController();requestRef.current=controller;
    const timeout=setTimeout(()=>controller.abort(),45000);
    try{
      const response=await fetch('/api/parse-expense',{method:'POST',headers:getClientAuthHeaders(),signal:controller.signal,body:JSON.stringify({mode:'assistant',text,userId,language:onboarding?.language,history:assistantHistory})});
      if(response.status===401)throw Error('SESSION_REQUIRED');
      if(response.status===403)throw Error('ACCOUNT_RESTRICTED');
      if(response.status===429)throw Error(await ai429Code(response));
      if(!response.ok)throw Error('AI_SERVICE_UNAVAILABLE');
      const reply=normalizeAssistantReply(await response.json());
      if(generation!==voiceGeneration.current)return;
      showAssistant(reply);
      setAssistantHistory(h=>[...h,{role:'user',content:text},{role:'assistant',content:JSON.stringify(reply)}].slice(-8));
    }catch(e:any){if(generation!==voiceGeneration.current)return;setAiError(e.message==='SESSION_REQUIRED'?sessionMessage:e.message==='ACCOUNT_RESTRICTED'?restrictedMessage:e.message==='AI_QUOTA'?copy.quota:e.message==='AI_RATE_LIMIT'?copy.throttle:serviceMessage);}
    finally{clearTimeout(timeout);if(generation===voiceGeneration.current)setIsProcessing(false);}
  };
  const handleAiTextSubmit=()=>requestAssistant(aiText);

  const stopVoice = () => {
    silenceMonitor.current?.stop();silenceMonitor.current=null;
    voiceGeneration.current++
    if(timerRef.current)clearTimeout(timerRef.current)
    requestRef.current?.abort()
    const rec=recorderRef.current
    if(rec && rec.state!=='inactive')rec.stop()
    recorderRef.current=null
    streamRef.current?.getTracks().forEach(track=>track.stop())
    streamRef.current=null
    isStartingVoiceRef.current=false
    setVoiceStarting(false)
    setRecording(false)
    setIsProcessing(false)
  }

  const finishVoice = () => {
    silenceMonitor.current?.stop();silenceMonitor.current=null;
    if(timerRef.current)clearTimeout(timerRef.current)
    const rec=recorderRef.current
    if(rec?.state==='recording')rec.stop()
  }

  const startVoice = async () => {
    if(isStartingVoiceRef.current || recording || isProcessing)return
    isStartingVoiceRef.current=true
    setVoiceStarting(true)
    const cue=prepareRecordingCue()
    const monitor=prepareSilenceMonitor()
    silenceMonitor.current=monitor
    setAutoAvailable(true)
    voiceTypeOverride.current=null;
    const generation=++voiceGeneration.current
    setAiError('')
    try{
      if(!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder==='undefined')throw new Error('MIC_UNSUPPORTED')
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false})
      if(generation!==voiceGeneration.current){monitor.stop();stream.getTracks().forEach(t=>t.stop());return}
      streamRef.current=stream
      const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported(type))
      const rec=new MediaRecorder(stream,mime?{mimeType:mime}:{})
      recorderRef.current=rec
      const chunks:Blob[]=[]
      rec.ondataavailable=event=>{if(event.data.size)chunks.push(event.data)}
      rec.onerror=()=>{
        stopVoice();setStep('type');setAiError(copy.parseFailed)
      }
      rec.onstop=async()=>{
        monitor.stop()
        stream.getTracks().forEach(track=>track.stop())
        if(generation!==voiceGeneration.current)return
        recorderRef.current=null;streamRef.current=null
        if(timerRef.current)clearTimeout(timerRef.current)
        triggerVoiceHaptic('stop');playStopRecordingCue();
        setRecording(false);setIsProcessing(true)
        const controller=new AbortController();requestRef.current=controller
        const timeout=setTimeout(()=>controller.abort(),45000)
        try{
          const wav=await recordedWav(new Blob(chunks,{type:rec.mimeType}))
          if(generation!==voiceGeneration.current)return
          const dataUrl=await blobDataUrl(wav)
          const response=await fetch('/api/parse-expense',{
            method:'POST',headers:getClientAuthHeaders(),signal:controller.signal,
            body:JSON.stringify({mode:'assistant',base64Audio:dataUrl.split(',')[1],userId,language:onboarding?.language,history:assistantHistory})
          })
          if(generation!==voiceGeneration.current)return
          if(response.status===401)throw new Error('SESSION_REQUIRED')
          if(response.status===403)throw new Error('ACCOUNT_RESTRICTED')
          if(response.status===429)throw new Error(await ai429Code(response))
          if(response.status>=500)throw new Error('AI_SERVICE_UNAVAILABLE')
          if(!response.ok)throw new Error('AUDIO_UNCLEAR')
          const reply=normalizeAssistantReply(await response.json());
          if(generation!==voiceGeneration.current)return;
          if(voiceTypeOverride.current&&reply.actions.length===1&&['expense','income','debt','lending'].includes(reply.actions[0].kind))reply.actions[0].kind=voiceTypeOverride.current;
          showAssistant(reply);setAiText(reply.transcription);
          setAssistantHistory(h=>[...h,{role:'user',content:reply.transcription},{role:'assistant',content:JSON.stringify(reply)}].slice(-8));
        }catch(error:any){
          if(generation!==voiceGeneration.current)return
          setEntry(prev=>({...prev,amount:''}))
          setAiError(error.message==='SESSION_REQUIRED'?sessionMessage:error.message==='ACCOUNT_RESTRICTED'?restrictedMessage:error.message==='AI_QUOTA'?copy.quota:error.message==='AI_RATE_LIMIT'?copy.throttle:error.message==='AI_SERVICE_UNAVAILABLE' || error.name==='AbortError'?serviceMessage:copy.clarify)
          setStep('form')
        }finally{
          clearTimeout(timeout)
          if(generation===voiceGeneration.current){setIsProcessing(false);requestRef.current=null}
        }
      }
      triggerVoiceHaptic('start');
      void cue.play().catch(()=>{})
      if(generation!==voiceGeneration.current){monitor.stop();stream.getTracks().forEach(t=>t.stop());return}
      rec.start(1000)
      setStep('voice');setRecording(true)
      setAutoAvailable(monitor.start(stream,()=>autoSendRef.current,()=>{if(generation===voiceGeneration.current && rec.state==='recording')rec.stop();}))
      timerRef.current=setTimeout(()=>{if(rec.state==='recording')rec.stop()},45000)
    }catch(error:any){
      monitor.stop()
      if(generation!==voiceGeneration.current)return
      streamRef.current?.getTracks().forEach(t=>t.stop());streamRef.current=null
      setStep('type');setRecording(false)
      setAiError(error.name==='NotAllowedError'
        ? ({uz:'🎙 Mikrofon uchun ruxsat bering: brauzer yoki Telegram sozlamalarini tekshiring.',uz_cyrl:'🎙 Микрофонга рухсат беринг: браузер ёки Telegram созламаларини текширинг.',ru:'🎙 Разрешите доступ к микрофону в настройках браузера или Telegram.',en:'🎙 Allow microphone access in your browser or Telegram settings.'})[language]
        : ({uz:'🎙 Mikrofonni ochib bo‘lmadi. Ilovani yangilang va yana urinib ko‘ring.',uz_cyrl:'🎙 Микрофонни очиб бўлмади. Иловaни янгиланг ва яна уриниб кўринг.',ru:'🎙 Не удалось открыть микрофон. Обновите приложение и повторите.',en:'🎙 Could not open the microphone. Update the app and try again.'})[language])
    }finally{cue.close();if(generation===voiceGeneration.current){isStartingVoiceRef.current=false;setVoiceStarting(false)}}
  }

  const handleSave = async () => {
    if(savingRef.current || isSaving || saved)return;
    // Preserve the calendar day/time selected in the form; the DB stores these literally.
    const finalDate = localTransactionDate(entry.date);
    if(!finalDate){setAiError('Sanani kiriting.');return;}
    let numAmount = readMoneyInput(entry.amount)
    if(numAmount===null){setAiError(copy.clarify);return}
    if(['debt','lending'].includes(entry.type)){
      if(!entry.debtWho?.trim()){setAiError('Kim bilan qarz? Ismni kiriting.');return;}
      if(!entry.debtDateConfirmed || (entry.debtDueDate && !validDay(entry.debtDueDate))){setAiError('Qaytarish sanasini tanlang yoki “Hali kelishilmagan”ni bosing.');return;}
    }
    if(!saveId.current)saveId.current='ai_'+crypto.randomUUID();
    const now = assistantDraftId ? 'assistant_'+assistantDraftId+'_0' : saveId.current

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
      debtWho: entry.debtWho?.trim(),
      ...(['debt','lending'].includes(entry.type)?{debtDueDate:entry.debtDueDate||null,debtDateConfirmed:true,debtRelationship:({"Do'st":'friend','Do‘st':'friend',Oila:'family',Bank:'bank',Hamkasb:'colleague',Boshqa:'other'} as Record<string,string>)[entry.category]||entry.debtRelationship||'' ,debtPersonId:entry.debtPersonId||'person_'+now}:{}),
      date: finalDate,
      cardId: entry.cardId === 'cash' ? undefined : entry.cardId,
    }
    
    savingRef.current=true
    setIsSaving(true)
    setAiError('')
    try {
      // 1. Authoritative backend/Supabase persistence must complete BEFORE success
      if(!customTransactions.some(t=>String(t.id)===String(customTx.id)))await addTransaction(customTx)

      void (async()=>{
      const original=assistantReply?.actions[0];
      if(original && onboarding?.remember_categories && original.category!==entry.category && entry.category.trim()){
        const phrase=original.title.trim().toLowerCase();
        if(phrase)try{await fetch('/api/auth/sync-data',{method:'POST',headers:getClientAuthHeaders(),body:JSON.stringify({onboarding:{category_preferences:cleanCategoryPreferences([...(onboarding.category_preferences||[]).filter(p=>p.phrase!==phrase),{phrase,category:entry.category}])}})});window.dispatchEvent(new Event('user_sync_requested'));}catch{/* The confirmed transaction must not be retried for a preference failure. */}
      }
      if (hasSampleData) {
        try{await setHasSampleData(false)}catch{/* Financial write already succeeded; sample cleanup is optional. */}
      }

      })().catch(()=>{});

      // 2. Database confirmed success: show celebratory card and auto-dismiss
      if(assistantDraftId)void fetch('/api/auth/sync-data',{method:'POST',headers:getClientAuthHeaders(),body:JSON.stringify({clearAssistantDraft:assistantDraftId})}).catch(()=>{});
      setSaved(true)
      closeAfterSave.current=setTimeout(() => {
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
      savingRef.current=false
      setIsSaving(false)
    }
  }


  const cfg = typeConfig[selectedType]

  return (
    <>
      {/* Floating button */}
      <motion.button
        id="ai_floating_button"
        aria-label="AI"
        animate={{scale:1}}
        transition={{duration:0.15}}
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
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 4cm)',
          right: 'calc(max(0px, (100vw - var(--app-max-width, 430px)) / 2) + 2cm)' ,
          width: 56,
          height: 56,
          borderRadius: 18,
          background: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)',
          color: '#ffffff',
          border: 'none',
          cursor: 'grab',
          userSelect: 'none', WebkitUserSelect: 'none',
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
            <SwipeSheet className="ai-restored-sheet" onDismiss={closeModal} locked={isProcessing || isSaving || recording || voiceStarting}
              scrollBody
              footer={!saved && !isProcessing && step==='form' ? (<div style={{ display: 'flex', gap: 10, paddingTop: 0, paddingBottom: 0 }}>
                  <button
                    disabled={voiceStarting || isSaving}
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
                    id="ai_save_transaction"
                    disabled={readMoneyInput(entry.amount)===null || isSaving}
                    style={{
                      flex: 1, padding: '14px',
                      borderRadius: 14, border: 'none',
                      background: (readMoneyInput(entry.amount)===null || isSaving) ? '#EDE9FE' : '#7C3AED',
                      color: (readMoneyInput(entry.amount)===null || isSaving) ? '#8B82C4' : '#fff',
                      fontSize: 15, fontWeight: 600, fontFamily: 'inherit',
                      cursor: (readMoneyInput(entry.amount)===null || isSaving) ? 'default' : 'pointer',
                      boxShadow: (readMoneyInput(entry.amount)!==null && !isSaving) ? '0 4px 16px rgba(124, 58, 237, 0.3)' : 'none',
                    }}
                  >
                    {isSaving
                      ? (language === 'uz' ? 'Saqlanmoqda...' : language === 'uz_cyrl' ? 'Сақланмоқда...' : language === 'ru' ? 'Сохранение...' : 'Saving...')
                      : (language === 'uz' ? 'Saqlash' : language === 'uz_cyrl' ? 'Сақлаш' : language === 'ru' ? 'Сохранить' : 'Save')}
                  </button>
                </div>) : !saved && !isProcessing && step==='assistant' ? <div ref={setAssistantFooterHost}/> : undefined}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={aiPopupTransition}
              onClick={(e) => e.stopPropagation()}
              style={aiPopupStyle}
            >
              {/* Header Handle Bar with Close Button */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ width: 28 }} />
                <div />
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
            {saved && ['debt','lending'].includes(entry.type) && <p role="status" style={{textAlign:'center',color:'#6D28D9',padding:12}}>{reminderPromise(entry.debtDueDate,String(entry.date||'').slice(0,10))}</p>}
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
                    {entry.type === 'income' || entry.type === 'debt' ? '+' : '-'}{(readMoneyInput(entry.amount) || 0).toLocaleString('uz-UZ').replace(/,/g, ' ')} so'm
                  </span>
                  {entry.category && (
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#5C548A' }}>
                      • {aiCategoryLabel(language, entry.category)}
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
                      {copy.tips[tipIndex]}
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
                        <span style={{ fontSize: 15, fontWeight: 600, color: '#1E1A3C' }}>{copy.types[typeIndex(t)]}</span>
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
                        flex: 1, minWidth: 0,
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
                <motion.button
                  disabled={voiceStarting}
                  animate={{scale:1,opacity:1}}
                  transition={{duration:0.15}}
                  whileTap={{scale:0.94}}
                  aria-busy={voiceStarting}
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
                </motion.button>
              </>
            )}

            {/* Step: voice recording */}
            {!saved && !isProcessing && step === 'voice' && (
              <div style={{ textAlign: 'center', padding: '10px 0 20px' }}>
                {/* Live AI Recording Status Pill + Timer */}
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 999, background: '#FEF2F2', border: '1px solid #FECACA', marginBottom: 12 }}>
                  <motion.span
                    animate={recording ? { scale: [1, 1.35, 1], opacity: [1, 0.35, 1] } : {}}
                    transition={{ repeat: Infinity, duration: 1 }}
                    style={{ width: 9, height: 9, borderRadius: '50%', background: '#EF4444', display: 'inline-block', boxShadow: '0 0 8px rgba(239,68,68,0.65)' }}
                  />
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#DC2626', letterSpacing: 0.4 }}>
                    {language === 'uz' ? 'AI OVOZ YOZMOQDA' : language === 'uz_cyrl' ? 'AI ОВОЗ ЁЗМОҚДА' : language === 'ru' ? 'ИИ ЗАПИСЫВАЕТ ГОЛОС' : 'AI RECORDING'}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: '#991B1B', fontVariantNumeric: 'tabular-nums' }}>
                    {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:{String(recordingSeconds % 60).padStart(2, '0')}
                  </span>
                </div>

                <p style={{ fontSize: 16, fontWeight: 600, color: '#1E1A3C', marginBottom: 4 }}>
                  {copy.voice[typeIndex(selectedType)]}
                </p>
                <p style={{ fontSize: 13, color: '#8B82C4', marginBottom: 28 }}>
                  {autoSend
                    ? (language === 'uz' ? 'Gapiring — 1 soniya jimlikdan so‘ng AI avtomatik tahlil qiladi ✨' : language === 'uz_cyrl' ? 'Гапиринг — 1 сония жимликдан сўнг AI автоматик таҳлил қилади ✨' : language === 'ru' ? 'Говорите — через 1 сек тишины ИИ автоматически разберёт ✨' : 'Speak — AI auto-analyzes after 1s of silence ✨')
                    : (language === 'uz' ? 'Gapiring, AI eshityapti...' : language === 'uz_cyrl' ? 'Гапиринг, AI эшитяпти...' : language === 'ru' ? 'Говорите, ИИ слушает...' : 'Speak, AI is listening...')}
                </p>

                {autoSend && !autoAvailable && <p role="status" style={{fontSize:12,color:'#766E9E'}}>{({uz:'Avtomatik to‘xtash ishlamadi. Tugmani bosing.',uz_cyrl:'Автоматик тўхташ ишламади. Тугмани босинг.',ru:'Автостоп недоступен. Нажмите кнопку.',en:'Auto-stop unavailable. Use the stop button.'})[language]}</p>}
                {/* Dual-ring sonar wave + vibrating Mic animation */}
                <div style={{ position: 'relative', width: 108, height: 108, margin: '0 auto 24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {recording && (
                    <>
                      <motion.div
                        animate={{ scale: [1, 1.55, 1], opacity: [0.12, 0.35, 0.12] }}
                        transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
                        style={{
                          position: 'absolute', inset: -16, borderRadius: '50%',
                          background: 'radial-gradient(circle, rgba(124,58,237,0.35) 0%, rgba(124,58,237,0) 75%)', zIndex: 0
                        }}
                      />
                      <motion.div
                        animate={{ scale: [1, 1.32, 1], opacity: [0.22, 0.55, 0.22] }}
                        transition={{ repeat: Infinity, duration: 1.3, ease: "easeInOut" }}
                        style={{
                          position: 'absolute', inset: -8, borderRadius: '50%',
                          background: '#7C3AED', zIndex: 1
                        }}
                      />
                    </>
                  )}
                  <motion.div
                    animate={recording && !reducedMotion ? { scale: [1, 1.08, 0.98, 1.06, 1] } : {}}
                    transition={{ repeat: Infinity, duration: 1.1, ease: "easeInOut" }}
                    style={{
                      width: 96, height: 96, borderRadius: '50%',
                      background: recording ? 'linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)' : '#EDE9FE',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      zIndex: 2, position: 'relative',
                      boxShadow: recording ? '0 10px 28px rgba(124,58,237,0.45)' : 'none'
                    }}
                  >
                    <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                      <rect x="12" y="2" width="12" height="20" rx="6" fill={recording ? 'white' : '#7C3AED'} fillOpacity="0.95" />
                      <path d="M6 18C6 24.6 11.4 30 18 30C24.6 30 30 24.6 30 18" stroke={recording ? 'white' : '#7C3AED'} strokeWidth="2.5" strokeLinecap="round" />
                      <line x1="18" y1="30" x2="18" y2="34" stroke={recording ? 'white' : '#7C3AED'} strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                  </motion.div>
                </div>

                {/* 9-bar dynamic AI voice waveform */}
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 5, height: 32 }}>
                  {[12, 22, 30, 18, 32, 20, 28, 16, 12].map((h, i) => (
                    <motion.div
                      key={i}
                      animate={recording && !reducedMotion ? { height: [8, h, 10, Math.max(12, h - 6), 8] } : { height: 8 }}
                      transition={{ repeat: Infinity, duration: 0.75, delay: i * 0.08, ease: "easeInOut" }}
                      style={{
                        width: 4.5,
                        borderRadius: 999,
                        background: i % 2 === 0 ? '#7C3AED' : '#9333EA',
                        opacity: recording ? 1 : 0.3,
                      }}
                    />
                  ))}
                </div>

                <button onClick={finishVoice} disabled={!recording} style={{display:'block',margin:'24px auto 0',padding:'12px 24px',borderRadius:12,border:0,background:'#7C3AED',color:'white',cursor:'pointer'}}>
                  {({uz:'To‘xtatish va tahlil qilish',uz_cyrl:'Тўхтатиш ва таҳлил қилиш',ru:'Остановить и разобрать',en:'Stop and analyze'})[language]}
                </button>
                <button onClick={() => { stopVoice(); setStep('type') }} style={{
                  marginTop: 28, padding: '10px 24px', borderRadius: 12,
                  border: '1px solid #E8E3F8', background: 'transparent',
                  color: '#8B82C4', fontSize: 14, fontFamily: 'inherit', cursor: 'pointer',
                }}>
                  {language === 'uz' ? 'Bekor qilish' : language === 'uz_cyrl' ? 'Бекор қилиш' : language === 'ru' ? 'Отмена' : 'Cancel'}
                </button>
              </div>
            )}

            {!saved&&!isProcessing&&step==='assistant'&&assistantReply&&<>
              <AssistantReview key={reviewKey} draftId={assistantDraftId} reply={assistantReply} onAsk={(text,actions)=>requestAssistant(text+'\nFormadagi joriy ma’lumotlar: '+JSON.stringify(actions))} onBusy={setIsSaving} onDone={finishAssistant} footerHost={assistantFooterHost}/>
              {aiError&&<p role="alert" style={{color:'#DC2626'}}>{aiError}</p>}
            </>}
            {/* Step: form */}
            {!saved && !isProcessing && step === 'form' && (
              <>
                {/* Type switcher */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
                  {(Object.keys(typeConfig) as EntryType[]).map((t) => {
                    const c = typeConfig[t]
                    const active = selectedType === t
                    return (
                      <button
                        key={t}
                        onClick={() => { setSelectedType(t); setEntry((e) => ({ ...e, type: t, category: categories[t][0], ...(['debt','lending'].includes(t)&&!e.debtDueDate?{debtDateConfirmed:true}:{}) })) }}
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
                        {copy.types[typeIndex(t)]}
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
                      <label style={{ fontSize: 12, color: '#8B82C4', fontWeight: 500, display: 'block', marginBottom: 6 }}>{copy.amount}</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    value={formatMoneyInput(entry.amount)}
                    onChange={(e) => {
                      const raw=e.target.value.replace(/[\u00a0\u202f]/g,' ')
                      if(/^[\d ]*(?:[.,]\d{0,2})?$/.test(raw)) {
                        const input=e.target;
                        const before=raw.slice(0,input.selectionStart ?? raw.length).replace(/ /g,'').length;
                        const formatted=formatMoneyInput(raw);
                        setEntry(prev=>({...prev,amount:formatted}));
                        requestAnimationFrame(()=>{
                          let index=0,count=0;
                          while(index<formatted.length && count<before){if(formatted[index]!==' ')count++;index++;}
                          if(document.activeElement===input)input.setSelectionRange(index,index);
                        });
                      }
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

              {['debt','lending'].includes(entry.type)&&<div className="ai-debt-fields finance-fields-row">
                <label>Ism<input aria-label="Qarzdagi odam ismi" list="ai-debt-people" maxLength={100} placeholder="Ali" value={entry.debtWho||''} onChange={e=>{const name=e.target.value;const matches=Array.from(new Map(customTransactions.filter(t=>t.debtWho===name&&t.debtPersonId).map(t=>[t.debtPersonId!,t])).values());const person=matches.length===1?matches[0]:undefined;setEntry(v=>({...v,debtWho:name,debtPersonId:person?.debtPersonId,debtRelationship:person?.debtRelationship||''}))}}/><datalist id="ai-debt-people">{Array.from(new Map(customTransactions.filter(t=>t.debtWho).map(t=>[t.debtWho!,t])).values()).map(t=><option key={t.debtWho} value={t.debtWho}>{debtPersonLabel(t.debtWho,t.debtRelationship)}</option>)}</datalist></label>
                <div><label>Qaytarish sanasi<input aria-label="Qaytarish sanasi" type="date" value={entry.debtDueDate||''} onChange={e=>setEntry(v=>({...v,debtDueDate:e.target.value||null,debtDateConfirmed:true}))}/></label><button className="ai-debt-unknown" aria-pressed={!entry.debtDueDate} onClick={()=>setEntry(v=>({...v,debtDueDate:null,debtDateConfirmed:true}))} style={{width:'100%',padding:'7px 8px',marginBottom:10,background:!entry.debtDueDate?'#DDD6FE':undefined}}>Hali kelishilmagan {!entry.debtDueDate?'✓':''}</button></div>
              </div>}

                {/* Category */}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 12, color: '#8B82C4', fontWeight: 500, display: 'block', marginBottom: 6 }}>{copy.category}</label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingBottom: 4 }}>
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
                          <span>{aiCategoryLabel(language, cat)}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="finance-fields-row">
                {/* Account Selection */}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 12, color: '#8B82C4', fontWeight: 500, display: 'block', marginBottom: 4 }}>
                    {copy.account}
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
                    <option value="cash">{copy.cash}</option>
                    {cards.map(c => (
                      <option key={c.id} value={c.id}>{c.bank} ({c.number.slice(-4)})</option>
                    ))}
                  </select>
                </div>

                {/* Date Selection */}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 12, color: '#8B82C4', fontWeight: 500, display: 'block', marginBottom: 6 }}>{copy.date}</label>
                  <input
                    type="datetime-local"
                    value={localTransactionDate(entry.date)||''}
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

                </div>
                {/* Note */}
                <div style={{ marginBottom: 20 }}>
                  <label style={{ fontSize: 12, color: '#8B82C4', fontWeight: 500, display: 'block', marginBottom: 6 }}>{copy.note}</label>
                  <textarea
                    rows={2}
                    maxLength={4000}
                    placeholder={copy.optional}
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
                  {copy.samplesTitle}
                </h3>
                <p style={{ fontSize: 14, color: '#8B82C4', marginBottom: 24, lineHeight: 1.5 }}>
                  {copy.samplesBody}
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
                    {copy.samplesYes}
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
                    {copy.samplesNo}
                  </button>
                </div>
              </div>
            )}
            </SwipeSheet>
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
