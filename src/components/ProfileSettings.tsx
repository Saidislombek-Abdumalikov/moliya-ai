import {aiPopupStyle,aiPopupTransition} from './aiPopupStyle';
import {createPortal} from 'react-dom';
import { useState, useRef }  from 'react'
import { motion } from 'motion/react'
import SwipeSheet from './SwipeSheet'
import type { OnboardingResult } from './Onboarding'

const copy = {
  uz: ['Sozlamalar', 'Jimlikdan keyin yuborish', '1 soniya sukutdan keyin audio AI ga yuboriladi. Saqlashni o‘zingiz tasdiqlaysiz.', 'Kategoriyalarimni eslab qolish', 'Siz tasdiqlab o‘zgartirgan kategoriyani keyingi safar taklif qiladi.', 'Sozlama saqlanmadi. Qayta urinib ko‘ring.', 'Yopish'],
  uz_cyrl: ['Созламалар', 'Сукутдан кейин юбориш', '1 сония сукутдан кейин аудио AI га юборилади. Сақлашни ўзингиз тасдиқлайсиз.', 'Категорияларимни эслаб қолиш', 'Сиз тасдиқлаб ўзгартирган категорияни кейинги сафар таклиф қилади.', 'Созлама сақланмади. Қайта уриниб кўринг.', 'Ёпиш'],
  ru: ['Настройки', 'Отправка после тишины', 'Аудио отправляется ИИ после 1 секунды тишины. Сохранение требует вашего подтверждения.', 'Запоминать мои категории', 'Предлагает категории, которые вы изменили и подтвердили.', 'Не удалось сохранить. Попробуйте снова.', 'Закрыть'],
  en: ['Settings', 'Send after silence', 'Audio is sent to AI after 1 second of silence. You still confirm saving.', 'Remember my categories', 'Suggests categories you changed and confirmed previously.', 'Could not save. Please retry.', 'Close'],
}
export default function ProfileSettings({onboarding, onSave, onClose}: {
  onboarding?: OnboardingResult | null
  onSave?: (data: Partial<OnboardingResult>) => void | Promise<void>
  onClose: () => void
}) {
  const t=copy[onboarding?.language || 'uz']
  const [busy,setBusy]=useState(false), [error,setError]=useState('')
  const pending=useRef(false);
  const change=async(key:'voice_auto_send'|'remember_categories')=>{
    if(pending.current || !onSave)return
    pending.current=true
    setBusy(true);setError('')
    try{await onSave({[key]:onboarding?.[key]!==true})}catch{setError(t[5])}finally{pending.current=false;setBusy(false)}
  }
  return createPortal(<motion.div className="finance-popup-overlay" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={()=>{if(!busy)onClose()}}>
    <SwipeSheet className="ai-restored-sheet" onDismiss={onClose} locked={busy} scrollBody initial={{y:'100%'}} animate={{y:0}} exit={{y:'100%'}} transition={aiPopupTransition} onClick={e=>e.stopPropagation()} style={aiPopupStyle}>
      <div className="finance-popup-heading"><h3>⚙️ {t[0]}</h3></div>
      {(['voice_auto_send','remember_categories'] as const).map((key,i)=><label key={key} className="profile-setting-row">
        <span><strong>{t[1+i*2]}</strong><small>{t[2+i*2]}</small></span>
        <span className="voice-auto-switch" style={{position:'relative',display:'inline-flex',flexShrink:0,width:52,height:30}}>
          <input type="checkbox" role="switch" aria-label={t[1+i*2]} disabled={busy || !onSave} checked={onboarding?.[key]===true} onChange={()=>void change(key)} style={{position:'absolute',inset:0,width:'100%',height:'100%',margin:0,opacity:0,zIndex:1,cursor:busy?'wait':'pointer'}}/>
          <span aria-hidden="true" style={{width:52,height:30,borderRadius:30,background:onboarding?.[key]?'#7C3AED':'#DCD7EA',transition:'background 180ms',opacity:busy?.6:1}}><span style={{display:'block',width:24,height:24,margin:3,borderRadius:'50%',background:'#fff',boxShadow:'0 2px 5px #00000020',transform:onboarding?.[key]?'translateX(22px)':'translateX(0)',transition:'transform 180ms'}}/></span>
        </span>
      </label>)}
      {error&&<p role="alert" style={{fontSize:13,color:'#DC2626',marginTop:12}}>{error}</p>}
    </SwipeSheet>
  </motion.div>,document.body)
}
