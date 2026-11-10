import {readMoneyInput,formatMoneyInput} from '../../shared/moneyInput';
import {aiPopupStyle,aiPopupTransition} from './aiPopupStyle';
import {createPortal} from 'react-dom';
import {AnimatePresence,motion} from 'motion/react';
import {useEffect,useState,useRef} from 'react';
import {useFinance} from '../FinanceContext';
import SwipeSheet from './SwipeSheet';
import {cleanPlannedPayments,editedPaymentAnchor,nextPayment,paymentIcons,paymentIconKey,paymentRecordId,paymentReminderKind,nextUnseenPaymentReminder,tomorrowDay,type PlannedPayment} from '../../shared/plannedPayments';
import {tashkentDay} from '../../shared/reminderPolicy';
export default function UpcomingPayments(){
 const {onboarding,updateOnboarding,addTransaction,customTransactions,cards,userId}=useFinance();
  const lang = onboarding?.language || "uz"
  const words = {
    uz: [
      "Kutilayotgan xarajatlar",
      "Qo‘shish",
      "Nomi",
      "Summa",
      "Sana",
      "Bir martalik",
      "Har hafta",
      "Har oy",
      "Saqlash",
      "To‘ladim",
      "Xarajat sifatida saqlansinmi?",
      "Tasdiqlash",
      "Bekor qilish",
      "Hozircha reja yo‘q",
      "Muddati kelgan",
      "O‘chirish",
      "Saqlanmadi. Qayta urinib ko‘ring.",
    ],
    uz_cyrl: [
      "Кутилаётган харажатлар",
      "Қўшиш",
      "Номи",
      "Сумма",
      "Сана",
      "Бир марталик",
      "Ҳар ҳафта",
      "Ҳар ой",
      "Сақлаш",
      "Тўладим",
      "Харажат сифатида сақлансинми?",
      "Тасдиқлаш",
      "Бекор қилиш",
      "Ҳозирча режа йўқ",
      "Муддати келган",
      "Ўчириш",
      "Сақланмади. Қайта уриниб кўринг.",
    ],
    ru: [
      "Предстоящие расходы",
      "Добавить",
      "Название",
      "Сумма",
      "Дата",
      "Один раз",
      "Еженедельно",
      "Ежемесячно",
      "Сохранить",
      "Оплачено",
      "Записать как расход?",
      "Подтвердить",
      "Отмена",
      "Пока нет планов",
      "Срок наступил",
      "Удалить",
      "Не сохранено. Повторите попытку.",
    ],
    en: [
      "Upcoming expenses",
      "Add",
      "Name",
      "Amount",
      "Date",
      "Once",
      "Weekly",
      "Monthly",
      "Save",
      "Paid",
      "Record this expense?",
      "Confirm",
      "Cancel",
      "No planned payments",
      "Due",
      "Delete",
      "Not saved. Please retry.",
    ],
  }[lang]

 const plans=cleanPlannedPayments(onboarding?.planned_payments).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
 const saving=useRef(false);
 const newPlanId=useRef('');
 const seenNotices=useRef(new Set<string>());
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [selected,setSelected]=useState<string|null>(null),[editing,setEditing]=useState(false),[paying,setPaying]=useState(false),[deleting,setDeleting]=useState(false);
 const [notice,setNotice]=useState(false),[today,setToday]=useState(tashkentDay(new Date()));
 const [title,setTitle]=useState(''),[amount,setAmount]=useState(''),[date,setDate]=useState(today),[time,setTime]=useState(''),[repeat,setRepeat]=useState<PlannedPayment['repeat']>('none'),[icon,setIcon]=useState('other'),[cardId,setCardId]=useState('cash');
 const plan=plans.find(p=>p.id===selected);
 const occurrencePaid=!!plan&&customTransactions.some(t=>String(t.id)===paymentRecordId(plan));
 const open=selected!==null||editing;
 useEffect(()=>{const update=()=>setToday(tashkentDay(new Date()));const timer=setInterval(update,60000);window.addEventListener('focus',update);return()=>{clearInterval(timer);window.removeEventListener('focus',update);};},[]);
 useEffect(()=>{const url=new URL(location.href);const id=url.searchParams.get('paymentId');if(id){setSelected(id);url.searchParams.delete('paymentId');history.replaceState({},'',url.pathname+url.search+url.hash);}},[]);
 useEffect(()=>{
   if(open||!userId||onboarding?.notifications?.opt1===false)return;
   const noticeKey=(p:PlannedPayment)=>`moliya_plan_notice_${userId}_${paymentReminderKind(p,today,customTransactions)==='early'?'early':today}_${p.id}_${p.dueDate}`;
   const due=nextUnseenPaymentReminder(plans,today,customTransactions,p=>{try{return sessionStorage.getItem(noticeKey(p))==='1';}catch{return seenNotices.current.has(noticeKey(p));}});
   if(!due)return;
   seenNotices.current.add(noticeKey(due));
   try{sessionStorage.setItem(noticeKey(due),'1');}catch{}
   setSelected(due.id);setNotice(true);
 },[today,userId,open,JSON.stringify(plans),customTransactions]);
 const close=()=>{if(saving.current)return;setSelected(null);setEditing(false);setPaying(false);setDeleting(false);setNotice(false);setError('');};
 const save=async(updated:PlannedPayment[])=>{await updateOnboarding({planned_payments:updated});};
 const run=async(fn:()=>Promise<void>)=>{if(saving.current)return;saving.current=true;setBusy(true);setError('');try{await fn();}catch(e){setError((e as Error).message==='PLAN_ADVANCE_FAILED'?'Xarajat saqlandi. Rejani yangilash yakunlanmadi — Saqlashni qayta bosing; xarajat takrorlanmaydi.':words[16]);}finally{saving.current=false;setBusy(false);}};
 const edit=(p?:PlannedPayment)=>{if(saving.current)return;newPlanId.current=p?.id||crypto.randomUUID();setDeleting(false);setPaying(false);setSelected(p?.id||null);setTitle(p?.title||'');setAmount(p?String(p.amount):'');setDate(p?.dueDate||today);setTime(p?.time||'');setRepeat(p?.repeat||'none');setIcon(p?.icon||'other');setEditing(true);setNotice(false);setError('');};
 const paid=async()=>{
   if(!plan)return;
   const id=paymentRecordId(plan);
   if(!customTransactions.some(t=>String(t.id)===id))await addTransaction({id,type:'expense',amount:plan.amount,note:plan.title,title:plan.title,category:'Boshqa',cardId,date:today});
   const next=nextPayment(plan);
   try{await save(plans.flatMap(p=>p.id===plan.id?(next?[next]:[]):[p]));}catch{throw Error('PLAN_ADVANCE_FAILED');}
   setSelected(null);setPaying(false);setNotice(false);
 };
 const notPaid=async()=>{if(!plan)return;await save(plans.map(p=>p.id===plan.id?{...p,snoozedUntil:tomorrowDay(today)}:p));setSelected(null);setNotice(false);};
 return <section className="upcoming-calm">
   <div className="calm-header"><h3>{words[0]}</h3><motion.button whileTap={{scale:.9}} className="calm-icon" aria-label={words[1]} onClick={()=>edit()}>＋</motion.button></div>
   {!plans.length&&<p className="calm-empty">{words[13]}</p>}
   {plans.map(p=><motion.button key={p.id} whileTap={{scale:.98}} className="calm-row" onClick={()=>{if(saving.current)return;setSelected(p.id);setDeleting(false);setPaying(false);setEditing(false);setNotice(false);setError('');}}>
     <span className="payment-glyph" aria-hidden="true">{paymentIcons[paymentIconKey(p.icon)]}</span><span className="payment-copy"><strong>{p.title}</strong><small>{p.dueDate}{p.time?' · '+p.time:''}</small></span><b>{p.amount.toLocaleString('en-US').replace(/,/g,' ')} <small>so‘m</small></b>
   </motion.button>)}
   {createPortal(<AnimatePresence>{open&&<motion.div className="finance-popup-overlay" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={close}>
     <SwipeSheet className="ai-restored-sheet ai-debt-fields" scrollBody locked={busy} onDismiss={()=>{if(saving.current)return;if(deleting){setDeleting(false);return;}if(paying){setPaying(false);return;}if(editing&&selected){setEditing(false);return;}close();}} onClick={e=>e.stopPropagation()} initial={{y:'100%'}} animate={{y:0}} exit={{y:'100%'}} transition={aiPopupTransition} style={aiPopupStyle}
       footer={editing?<button className="finance-popup-primary" form="planned-payment-form" type="submit" disabled={busy}>{words[8]}</button>:paying?<button className="finance-popup-primary" disabled={busy} onClick={()=>void run(paid)}>{words[8]}</button>:undefined}>
       <h3 className="calm-heading">{editing?words[0]:plan?.title||words[13]}</h3>
       {editing?<form id="planned-payment-form" onSubmit={e=>{e.preventDefault();void run(async()=>{
         const p=cleanPlannedPayments([{id:selected||newPlanId.current,title,amount:readMoneyInput(amount),dueDate:date,time,repeat,icon,createdDay:plan?.createdDay||today,anchorDay:editedPaymentAnchor(plan,date,repeat),...(plan?.dueDate===date?{snoozedUntil:plan.snoozedUntil}:{})}])[0];
         if(!p||(!selected&&plans.length>=100))throw Error('INVALID_PLAN');
         await save(selected?plans.map(x=>x.id===selected?p:x):[...plans,p]);setEditing(false);setSelected(null);
       });}}>
         <label>{words[2]}<input required value={title} maxLength={100} onChange={e=>setTitle(e.target.value)}/></label>
         <label>{words[3]}<input required inputMode="decimal" value={formatMoneyInput(amount)} onChange={e=>setAmount(formatMoneyInput(e.target.value))}/></label>
         <div className="finance-fields-row"><label>{words[4]}<input required type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Vaqt (ixtiyoriy)<input type="time" value={time} onChange={e=>setTime(e.target.value)}/></label></div>
         <div className="finance-fields-row"><label>Takrorlanish<select value={repeat} onChange={e=>setRepeat(e.target.value as PlannedPayment['repeat'])}>{(['none','weekly','monthly'] as const).map((v,i)=><option key={v} value={v}>{words[5+i]}</option>)}</select></label><label>Belgi<select value={icon} onChange={e=>setIcon(e.target.value)}>{Object.entries(paymentIcons).map(([key,emoji])=><option key={key} value={key}>{emoji}</option>)}</select></label></div>
       </form>:plan?<>
         <div className="calm-hero"><span className="payment-glyph">{paymentIcons[paymentIconKey(plan.icon)]}</span><h2>{plan.amount.toLocaleString()} <small>so‘m</small></h2><p>{plan.dueDate}{plan.time?' · '+plan.time:''}</p></div>
         {paying?<><p className="calm-note">{words[10]}</p><select aria-label="Hisob" value={cardId} onChange={e=>setCardId(e.target.value)}><option value="cash">Naqd</option>{cards.map(c=><option key={c.id} value={c.id}>{c.bank} · {c.number.slice(-4)}</option>)}</select></>:<>
           {!deleting&&(plan.dueDate<=today||notice)&&!occurrencePaid?<div className="calm-subsection"><p>{plan.dueDate<=today?'To‘lov amalga oshdimi?':'🔔 To‘lov kuni yaqinlashmoqda. To‘lov amalga oshdimi?'}</p><div className="calm-actions"><button className="calm-action" disabled={busy} onClick={()=>{setCardId('cash');setPaying(true);}}>✅ To‘ladim</button><button className="calm-action" disabled={busy} onClick={()=>void run(notPaid)}>Hali to‘lamadim</button></div></div>:null}
           {!deleting&&<div className="calm-actions">{occurrencePaid?<button className="calm-action" disabled={busy} onClick={()=>void run(paid)}>✅ To‘lov saqlangan — rejani yangilash</button>:<button className="calm-action" disabled={busy} onClick={()=>edit(plan)}>Tahrirlash</button>}<button className="calm-action calm-danger" disabled={busy} onClick={()=>setDeleting(true)}>{words[15]}</button></div>}
           {deleting&&<div className="calm-subsection"><p>Reja o‘chirilsinmi?</p><div className="calm-actions"><button className="calm-action" disabled={busy} onClick={()=>setDeleting(false)}>{words[12]}</button><button className="calm-action calm-danger" disabled={busy} onClick={()=>void run(async()=>{await save(plans.filter(p=>p.id!==plan.id));setSelected(null);setDeleting(false);})}>{words[15]}</button></div></div>}
         </>}
       </>:<p role="status" className="calm-empty">Reja topilmadi yoki boshqa qurilmada o‘chirilgan. <button className="calm-action" onClick={close}>Yopish</button></p>}
       {error&&<p role="alert" className="calm-error">{error}</p>}
     </SwipeSheet>
   </motion.div>}</AnimatePresence>,document.body)}
 </section>;
}
