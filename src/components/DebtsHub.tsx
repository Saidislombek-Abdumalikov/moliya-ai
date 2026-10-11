import {aiPopupStyle,aiPopupTransition} from './aiPopupStyle';
import {createPortal} from 'react-dom';
import {debtPersonLabel} from '../../shared/debtPeople';
import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import SwipeSheet from "./SwipeSheet"
import { useFinance, type Transaction } from "../FinanceContext"
import {
  isDebt,
  debtBalances,
  personKey,
  debtRank,
  dueDebts,
  localDay,
  validDay,
} from "../../shared/debts"
import { readMoneyInput, formatMoneyInput } from "../../shared/moneyInput"
const money = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 2 }).replace(/,/g, " ")
const input = {
  width: "100%",
  padding: "16px 20px",
  borderRadius: 20,
  border: "1px solid rgba(124,58,237,.15)",
  margin: "6px 0 12px",
  background: "linear-gradient(145deg,#FFFFFF,#F8F7FC)",
  color: "#4B456D",
  boxShadow:"inset 0 2px 6px #7C3AED08,0 4px 16px #7C3AED0F",
  font: "inherit",
} as const
export default function DebtsHub() {
  const { customTransactions: all, userId, onboarding, debtAction, deleteTransaction } = useFinance()
  const balances=useMemo(()=>debtBalances(all),[all]);
  const remaining=(t:Transaction)=>balances.get(String(t.id))||0;
  const [open, setOpen] = useState(false),
    [tab, setTab] = useState("debt"),
    [closed, setClosed] = useState(false),
    [search, setSearch] = useState("")
  const [person, setPerson] = useState<string | null>(null),
    [selected, setSelected] = useState<string | null>(null)
  const [amount, setAmount] = useState(""),
    [name, setName] = useState(""),
    [personId, setPersonId] = useState(""),
    [due, setDue] = useState("")
  const [relationship,setRelationship]=useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [notice, setNotice] = useState(false)
  const [editing,setEditing]=useState(false),[searching,setSearching]=useState(false),[deleting,setDeleting]=useState(false);
  const busyRef = useRef(false)
  const paymentAttempt = useRef<{ key: string; id: string } | null>(null)
  const [today, setToday] = useState(localDay())
  useEffect(() => {
    const update = () => setToday(localDay())
    const timer = setInterval(update, 60000)
    window.addEventListener("focus", update)
    return () => {
      clearInterval(timer)
      window.removeEventListener("focus", update)
    }
  }, [])
  const debts = all.filter(isDebt),
    reminders = dueDebts(all, today)
  useEffect(() => {
    if (!userId || !reminders.length || onboarding?.notifications?.opt1===false) return
    const key = "moliya_debt_popup_" + userId + "_" + today
    const signature = reminders
      .map((t) => t.id + ":" + t.debtDueDate)
      .sort()
      .join("|")
    try {
      if (sessionStorage.getItem(key) === signature) return
      sessionStorage.setItem(key, signature)
    } catch {}
    setNotice(true)
  }, [
    userId,
    today,
    onboarding?.notifications?.opt1,
    reminders.map((t) => t.id + ":" + t.debtDueDate).join("|"),
  ])
  useEffect(() => {
    const url = new URL(location.href)
    if (url.searchParams.get("debts") === "1") {
      setOpen(true)
      const id = url.searchParams.get("debtId")
      if (id) setSelected(id)
      url.searchParams.delete("debts")
      url.searchParams.delete("debtId")
      history.replaceState({}, "", url.pathname + url.search + url.hash)
    }
  }, [])
  const tx = all.find((t) => String(t.id) === selected && isDebt(t))
  useEffect(() => {
    setEditing(false);setDeleting(false);
    if (tx) {
      setName(tx.debtWho || ""); setRelationship(tx.debtRelationship||"")
      setPersonId(tx.debtPersonId || "person_" + crypto.randomUUID())
      setDue(tx.debtDueDate || "")
      setAmount("")
      setError("")
      setSuccess("")
      paymentAttempt.current = null
    }
  }, [selected, !!tx])
  const filtered = debts
    .filter(
      (t) =>
        t.type === tab &&
        (closed ? remaining(t) === 0 : remaining(t) > 0) &&
        `${t.debtWho || ""} ${t.note || ""} ${t.title || ""}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) => debtRank(a, today).localeCompare(debtRank(b, today)))
  const groups = Array.from(new Set(filtered.map(personKey))).map((key) => ({
    key,
    items: filtered.filter((t) => personKey(t) === key),
  }))
  const close = () => {
    if (!busyRef.current) {
      setOpen(false)
      setPerson(null)
      setSelected(null)
      setError("")
      setDeleting(false);setEditing(false);setSearch("");setSearching(false);
    }
  }
  const run = async (fn: () => Promise<void>, message = "Saqlandi") => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError("")
    setSuccess("")
    try {
      await fn()
      setSuccess(message)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  const pay = (value: number) => {
    if (!tx) return
    const key = String(tx.id) + ":" + value
    if (paymentAttempt.current?.key !== key)
      paymentAttempt.current = { key, id: "pay_" + crypto.randomUUID() }
    void run(async () => {
      await debtAction(tx, "pay", {
        amount: value,
        paymentId: paymentAttempt.current!.id,
      })
      paymentAttempt.current = null
      setAmount("")
    }, "To‘lov saqlandi")
  }
  const status = (t: Transaction) =>
    !t.debtDueDate
      ? "Sana belgilanmagan"
      : t.debtDueDate < today
        ? "Muddati o‘tgan · " + t.debtDueDate
        : t.debtDueDate === today
          ? "Bugun"
          : t.debtDueDate
  const dismissNotices = () =>
    void run(async () => {
      for (const t of reminders) await debtAction(t, "dismiss")
      setNotice(false)
    }, "")
  const back=()=>{if(busyRef.current)return;if(deleting){setDeleting(false);return;}if(editing){setEditing(false);return;}if(selected){if(person&&filtered.filter(t=>personKey(t)===person).length<=1)setPerson(null);setSelected(null);return;}if(person){setPerson(null);return;}close();};

  return <>
    <motion.button className="home-summary-card debt-summary" whileTap={{scale:.98}} onClick={()=>setOpen(true)}>
      <span className="summary-title">Qarz / Haqqim <span>↗</span></span>
      {(['debt','lending'] as const).map(kind=><span key={kind} className="debt-summary-line"><span className="summary-caption">{kind==='debt'?'Qarzlarim':'Haqqim'}</span><strong className="summary-money">{money(debts.filter(t=>t.type===kind).reduce((sum,t)=>sum+remaining(t),0))} <small>so‘m</small></strong></span>)}
    </motion.button>
    {createPortal(<><AnimatePresence>{notice&&!open&&reminders.length>0&&<motion.div className="finance-popup-overlay" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={dismissNotices}>
      <SwipeSheet className="ai-restored-sheet ai-debt-fields" scrollBody onDismiss={dismissNotices} locked={busy} style={aiPopupStyle} transition={aiPopupTransition} onClick={e=>e.stopPropagation()} initial={{y:'100%'}} animate={{y:0}} exit={{y:'100%'}}>
        <h3 className="calm-heading">🔔 Qarz eslatmasi</h3>
        {reminders.map(t=><button className="calm-row" key={t.id} onClick={()=>{setSelected(String(t.id));setTab(t.type);setOpen(true);setNotice(false);}}><span><strong>{t.debtWho||'Nomsiz'}</strong><small>{status(t)}</small></span><b>{money(remaining(t))} so‘m</b></button>)}
        <button className="calm-action" disabled={busy} onClick={dismissNotices}>Keyinroq</button>
      </SwipeSheet>
    </motion.div>}</AnimatePresence>
    <AnimatePresence>{open&&<motion.div className="finance-popup-overlay" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={close}>
      <SwipeSheet scrollBody className="ai-restored-sheet ai-debt-fields" onDismiss={back} locked={busy} style={aiPopupStyle} transition={aiPopupTransition} onClick={e=>e.stopPropagation()} initial={{y:'100%'}} animate={{y:0}} exit={{y:'100%'}}
        footer={tx&&editing?<button className="finance-popup-primary" disabled={busy||!name.trim()||!!due&&!validDay(due)} onClick={()=>void run(async()=>{await debtAction(tx,'edit',{personName:name.trim(),relationship,personId,dueDate:due||null});setEditing(false);})}>Saqlash</button>:undefined}>
        <div className="calm-header"><h3>{tx?tx.debtWho||'Nomsiz':person?filtered.find(t=>personKey(t)===person)?.debtWho:'Qarz / Haqqim'}</h3>{!tx&&!person&&<button className="calm-icon" aria-label="Qidirish" aria-expanded={searching} onClick={()=>{setSearching(v=>!v);setSearch('');}}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg></button>}</div>
        {error&&<p role="alert" className="calm-error">{error}</p>}{success&&<p role="status" className="calm-success">{success}</p>}
        {tx?<>
          <div className="calm-hero"><small>{tx.type==='debt'?'Qarz qoldig‘i':'Olinadigan summa'}</small><h2>{money(remaining(tx))} <small>so‘m</small></h2><p>{status(tx)}</p></div>
          {editing?<>
            <div className="finance-fields-row"><label>Ism<input style={input} value={name} maxLength={100} onChange={e=>setName(e.target.value)}/></label><label>Qaytarish sanasi<input style={input} type="date" value={due} onChange={e=>setDue(e.target.value)}/></label></div>
            <button className="calm-action" aria-pressed={!due} onClick={()=>setDue('')}>Hali kelishilmagan {!due?'✓':''}</button>
            {remaining(tx)>0&&<div className="calm-subsection"><label>Qaytarilgan summa<input style={input} inputMode="decimal" value={amount} onChange={e=>setAmount(formatMoneyInput(e.target.value))}/></label><div className="calm-actions"><button className="calm-action" disabled={busy||readMoneyInput(amount)===null} onClick={()=>pay(readMoneyInput(amount)!)}>Qisman qaytarildi</button><button className="calm-action" disabled={busy} onClick={()=>pay(remaining(tx))}>To‘liq qaytarildi</button></div></div>}
          </>:<>
            {tx.note&&<p className="calm-note">{tx.note}</p>}
            <small className="calm-muted">{String(tx.date).slice(0,10)} · Boshlang‘ich {money(Math.abs(Number(tx.amount)))} so‘m</small>
            <div className="calm-actions">{!deleting&&<><button className="calm-action" disabled={busy} onClick={()=>setEditing(true)}>Tahrirlash</button><button className="calm-action calm-danger" disabled={busy||all.some(p=>p.debtPaymentFor===String(tx.id))} onClick={()=>setDeleting(true)}>O‘chirish</button></>}</div>{!deleting&&all.some(p=>p.debtPaymentFor===String(tx.id))&&<p className="calm-muted">Qaytarish yozuvlari bor qarzni o‘chirib bo‘lmaydi. To‘lovlar tarixi quyida saqlanadi.</p>}
            {deleting&&<div className="calm-subsection"><p>Bu yozuv o‘chirilsinmi?</p><div className="calm-actions"><button className="calm-action" disabled={busy} onClick={()=>setDeleting(false)}>Bekor qilish</button><button className="calm-action calm-danger" disabled={busy} onClick={()=>void run(async()=>{if(all.some(p=>p.debtPaymentFor===String(tx.id)))throw Error('To‘lovlari bor qarzni o‘chirib bo‘lmaydi.');if(!await deleteTransaction(tx.id))throw Error('O‘chirilmadi');setSelected(null);setPerson(null);setDeleting(false);},'')}>O‘chirish</button></div></div>}
            {all.some(p=>p.debtPaymentFor===String(tx.id))&&<details className="calm-subsection"><summary>To‘lovlar tarixi</summary>{all.filter(p=>p.debtPaymentFor===String(tx.id)).map(p=><p key={p.id}>{String(p.date).slice(0,10)} · {money(Math.abs(Number(p.amount)))} so‘m</p>)}</details>}
          </>}
        </>:<>
          {!person&&<><div className="calm-segments">{['debt','lending'].map(t=><button key={t} aria-pressed={tab===t} onClick={()=>setTab(t)}>{t==='debt'?'Qarzlarim':'Haqqim'}</button>)}</div>{searching&&<input aria-label="Qarz qidirish" autoFocus style={input} placeholder="Ism yoki izoh" value={search} onChange={e=>setSearch(e.target.value)}/>}<button className="calm-text" aria-pressed={closed} onClick={()=>setClosed(v=>!v)}>{closed?'Faol qarzlar':'Yopilganlar tarixi'}</button></>}
          {!filtered.length&&<p className="calm-empty">Hozircha yozuv yo‘q</p>}
          {person?filtered.filter(t=>personKey(t)===person).map(t=><motion.button whileTap={{scale:.98}} className="calm-row" key={t.id} onClick={()=>setSelected(String(t.id))}><span><strong>{t.title||'Qarz'}</strong><small>{status(t)}</small></span><b>{money(remaining(t))} so‘m</b></motion.button>):groups.map(g=><motion.button whileTap={{scale:.98}} className="calm-row" key={g.key} onClick={()=>{setPerson(g.key);if(g.items.length===1)setSelected(String(g.items[0].id));}}><span><strong>{debtPersonLabel(g.items[0].debtWho,g.items[0].debtRelationship)}</strong><small>{g.items.length} ta · {status(g.items[0])}</small></span><b>{money(g.items.reduce((sum,t)=>sum+remaining(t),0))} so‘m</b></motion.button>)}
        </>}
      </SwipeSheet>
    </motion.div>}</AnimatePresence></>,document.body)}
  </>;
}
