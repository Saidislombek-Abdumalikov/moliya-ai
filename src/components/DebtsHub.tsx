import {debtRelationships,debtPersonLabel} from '../../shared/debtPeople';
import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import SwipeSheet from "./SwipeSheet"
import { useFinance, type Transaction } from "../FinanceContext"
import {
  isDebt,
  debtRemaining,
  personKey,
  debtRank,
  dueDebts,
  localDay,
  validDay,
  reminderPromise,
} from "../../shared/debts"
import { readMoneyInput, formatMoneyInput } from "../../shared/moneyInput"
const money = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 2 }).replace(/,/g, " ")
const button = {
  border: 0,
  borderRadius: 12,
  padding: "12px 14px",
  background: "#F3EEFF",
  color: "#6D28D9",
  cursor: "pointer",
  fontWeight: 600,
} as const
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
  const { customTransactions: all, userId, debtAction } = useFinance()
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
    if (!userId || !reminders.length) return
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
  const people = useMemo(
    () =>
      Array.from(
        new Map(
          debts
            .filter((t) => t.debtPersonId)
            .map((t) => [t.debtPersonId!, t.debtWho || "Nomsiz"]),
        ).entries(),
      ),
    [all],
  )
  const filtered = debts
    .filter(
      (t) =>
        t.type === tab &&
        (closed ? debtRemaining(t, all) === 0 : debtRemaining(t, all) > 0) &&
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
    if (!busy) {
      setOpen(false)
      setPerson(null)
      setSelected(null)
      setError("")
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
  return (
    <>
      <motion.button className="home-summary-card debt-summary" whileTap={{scale:0.98}} onClick={()=>setOpen(true)}>
        <span className="summary-title">Qarz / Haqqim <span>↗</span></span>
        {(['debt','lending'] as const).map(kind=><span key={kind} className="debt-summary-line">
          <span className="summary-caption">{kind==='debt'?'Qarzlarim':'Haqqim'}</span>
          <strong className="summary-money" style={{color:kind==='debt'?'#7C3AED':'#4C1D95'}}>{money(debts.filter(t=>t.type===kind).reduce((sum,t)=>sum+debtRemaining(t,all),0))} <small>so‘m</small></strong>
        </span>)}
      </motion.button>
      <AnimatePresence>
        {notice && !open && reminders.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 1100,
              background: "#100A2980",
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
            }}
          >
            <SwipeSheet className="ai-restored-sheet"
              footer={tx ? (                  <button
                    disabled={busy || !name.trim() || (!!due && !validDay(due))}
                    style={{
                      ...button,
                      width: "100%",
                      background: "#7C3AED",
                      color: "#fff",
                      marginBottom: 0,
                    }}
                    onClick={() =>
                      void run(
                        () =>
                          debtAction(tx, "edit", {
                            personName: name.trim(),
                            relationship,
                            personId,
                            dueDate: due || null,
                          }),
                        due
                          ? reminderPromise(due, String(tx.date).slice(0, 10))
                          : "Sanasiz saqlandi",
                      )
                    }
                  >
                    O‘zgarishlarni saqlash
                  </button>) : undefined}
              transition={{type:'spring',damping:26,stiffness:220}}
              onDismiss={dismissNotices}
              locked={busy}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              style={{
                background: "#fff",
                width: "100%",
                maxWidth: 440,
                padding: 20,
                borderRadius: "28px 28px 0 0",
                boxShadow:"0 -10px 40px #00000026",
                maxHeight: "80dvh",
                overflowY: "auto",
              }}
            >
              <h3 style={{ fontWeight: 700, marginBottom: 12 }}>
                Qarz eslatmalari
              </h3>
              {reminders.map((t) => (
                <button
                  key={t.id}
                  style={{
                    ...button,
                    width: "100%",
                    textAlign: "left",
                    marginBottom: 8,
                  }}
                  onClick={() => {
                    setSelected(String(t.id))
                    setTab(t.type)
                    setOpen(true)
                    setNotice(false)
                  }}
                >
                  {t.type === "debt" ? "Qaytarasiz" : "Qaytarib olasiz"} ·{" "}
                  {t.debtWho || "Nomsiz"}
                  <br />
                  {money(debtRemaining(t, all))} so‘m · {status(t)}
                </button>
              ))}
              {error && <p role="alert">{error}</p>}
              <button
                disabled={busy}
                style={{ ...button, width: "100%", marginTop: 8 }}
                onClick={dismissNotices}
              >
                {busy ? "Kutilmoqda…" : "Keyinroq"}
              </button>
            </SwipeSheet>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 1050,
              background: "#100A2980",
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
            }}
          >
            <SwipeSheet className="ai-restored-sheet"
              footer={tx ? (                  <button
                    disabled={busy || !name.trim() || (!!due && !validDay(due))}
                    style={{
                      ...button,
                      width: "100%",
                      background: "#7C3AED",
                      color: "#fff",
                      marginBottom: 0,
                    }}
                    onClick={() =>
                      void run(
                        () =>
                          debtAction(tx, "edit", {
                            personName: name.trim(),
                            relationship,
                            personId,
                            dueDate: due || null,
                          }),
                        due
                          ? reminderPromise(due, String(tx.date).slice(0, 10))
                          : "Sanasiz saqlandi",
                      )
                    }
                  >
                    O‘zgarishlarni saqlash
                  </button>) : undefined}
              transition={{type:'spring',damping:26,stiffness:220}}
              onDismiss={close}
              locked={busy}
              scrollBody
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "#fff",
                color: "#1E1A3C",
                width: "100%",
                maxWidth: "var(--app-max-width,440px)",
                padding: "16px 20px max(16px, env(safe-area-inset-bottom))",
                borderRadius: "28px 28px 0 0",
                boxShadow:"0 -10px 40px #00000026",
                maxHeight: "90dvh",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 16,
                }}
              >
                <button
                  style={button}
                  disabled={busy}
                  onClick={() => {
                    if (selected) {
                      setSelected(null)
                      setError("")
                    } else if (person) setPerson(null)
                    else close()
                  }}
                >
                  Ro‘yxat
                </button>
                <strong>
                  {tx
                    ? tx.debtWho || "Qarz"
                    : person
                      ? filtered.find((t) => personKey(t) === person)
                          ?.debtWho || "Nomsiz"
                      : "Qarzlar"}
                </strong>
                <button style={button} onClick={close} disabled={busy}>
                  ✕
                </button>
              </div>
              {error && (
                <p role="alert" style={{ color: "#DC2626", marginBottom: 12 }}>
                  {error}
                </p>
              )}
              {success && (
                <p role="status" style={{ color: "#15803D", marginBottom: 12 }}>
                  {success}
                </p>
              )}
              {tx ? (
                <>
                  <p>
                    {tx.type === "debt" ? "Qarz oldim" : "Qarz berdim"} ·{" "}
                    {String(tx.date).slice(0, 10)}
                  </p>
                  <h2
                    style={{ fontSize: 24, fontWeight: 700, margin: "10px 0" }}
                  >
                    Qoldiq: {money(debtRemaining(tx, all))} so‘m
                  </h2>
                  <p style={{ fontSize: 13, marginBottom: 12 }}>
                    Boshlang‘ich: {money(Math.abs(Number(tx.amount)))} so‘m ·{" "}
                    {status(tx)}
                  </p>
                  <p style={{ marginBottom: 12 }}>{tx.note}</p>
                  {debtRemaining(tx, all) > 0 && (
                    <>
                      <label>
                        Qaytarilgan summa
                        <input
                          aria-label="Qaytarilgan summa"
                          style={input}
                          inputMode="decimal"
                          value={amount}
                          onChange={(e) =>
                            setAmount(formatMoneyInput(e.target.value))
                          }
                        />
                      </label>
                      <div
                        style={{ display: "flex", gap: 8, marginBottom: 20 }}
                      >
                        <button
                          style={button}
                          disabled={busy || readMoneyInput(amount) === null}
                          onClick={() => pay(readMoneyInput(amount)!)}
                        >
                          Qisman {tx.type === "debt" ? "qaytardim" : "oldim"}
                        </button>
                        <button
                          style={{
                            ...button,
                            background: "#7C3AED",
                            color: "#fff",
                          }}
                          disabled={busy}
                          onClick={() => pay(debtRemaining(tx, all))}
                        >
                          To‘liq {tx.type === "debt" ? "qaytardim" : "oldim"}
                        </button>
                      </div>
                    </>
                  )}
                  <div className="finance-fields-row">
                  <label>
                    Odam
                    <select
                      style={input}
                      value={
                        people.some(([id]) => id === personId) ? personId : ""
                      }
                      onChange={(e) => {
                        const id = e.target.value
                        setPersonId(id || "person_" + crypto.randomUUID()); setRelationship(debts.find(t=>t.debtPersonId===id)?.debtRelationship||"")
                        if (id)
                          setName(people.find(([p]) => p === id)?.[1] || "")
                      }}
                    >
                      <option value="">Yangi / alohida odam</option>
                      {people.map(([id, n]) => (
                        <option value={id} key={id}>
                          {debtPersonLabel(n,debts.find(t=>t.debtPersonId===id)?.debtRelationship)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>Munosabat<select aria-label="Munosabat" style={input} value={relationship} onChange={e=>setRelationship(e.target.value)}><option value="">Tanlanmagan</option>{Object.entries(debtRelationships).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
                  </div>
                  <div className="finance-fields-row"><label>Ism
                  <input
                    aria-label="Ism"
                    style={input}
                    value={name}
                    maxLength={100}
                    placeholder="Ism"
                    onChange={(e) => setName(e.target.value)}
                  />

                  </label><label>
                    Qaytarish sanasi
                    <input
                      aria-label="Qaytarish sanasi"
                      type="date"
                      style={input}
                      value={due}
                      onChange={(e) => setDue(e.target.value)}
                    />
                  </label>
                  </div>
                  <button style={{...button,background:!due?'#DDD6FE':button.background}} aria-pressed={!due} onClick={() => setDue("")}>
                    Hali kelishilmagan
                  </button>
                  <p style={{ fontSize: 12, margin: "10px 0" }}>
                    {reminderPromise(due, String(tx.date).slice(0, 10))}
                  </p>

                  <strong>To‘lovlar tarixi</strong>
                  {all
                    .filter((p) => p.debtPaymentFor === String(tx.id))
                    .map((p) => (
                      <p
                        key={p.id}
                        style={{
                          padding: "10px 0",
                          borderBottom: "1px solid #F1EDF8",
                        }}
                      >
                        {String(p.date).slice(0, 10)} ·{" "}
                        {money(Math.abs(Number(p.amount)))} so‘m
                      </p>
                    ))}
                </>
              ) : (
                <>
                  {!person && (
                    <>
                      <div
                        style={{ display: "flex", gap: 8, marginBottom: 12 }}
                      >
                        {["debt", "lending"].map((t) => (
                          <button
                            style={{
                              ...button,
                              background: tab === t ? "#7C3AED" : "#F3EEFF",
                              color: tab === t ? "#fff" : "#6D28D9",
                              flex: 1,
                            }}
                            key={t}
                            onClick={() => setTab(t)}
                          >
                            {t === "debt" ? "Qarzlarim" : "Haqdorligim"}
                          </button>
                        ))}
                      </div>
                      <input
                        aria-label="Qarz qidirish"
                        style={input}
                        placeholder="Ism yoki izoh bo‘yicha qidirish"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                      <label style={{ display: "block", marginBottom: 16 }}>
                        <input
                          type="checkbox"
                          checked={closed}
                          onChange={(e) => setClosed(e.target.checked)}
                        />{" "}
                        Yopilganlar tarixi
                      </label>
                    </>
                  )}
                  {!filtered.length && (
                    <p
                      style={{
                        padding: 20,
                        textAlign: "center",
                        color: "#766E9E",
                      }}
                    >
                      Hozircha yozuv yo‘q. AI tugmasidan qarz qo‘shing.
                    </p>
                  )}
                  {person
                    ? filtered
                        .filter((t) => personKey(t) === person)
                        .map((t) => (
                          <button
                            key={t.id}
                            style={{
                              ...button,
                              display: "block",
                              width: "100%",
                              textAlign: "left",
                              marginBottom: 10,
                            }}
                            onClick={() => setSelected(String(t.id))}
                          >
                            <strong>{money(debtRemaining(t, all))} so‘m</strong>
                            <p>{status(t)}</p>
                            <small>{t.note}</small>
                          </button>
                        ))
                    : groups.map((g) => (
                        <button
                          key={g.key}
                          style={{
                            ...button,
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            marginBottom: 10,
                            padding: 16,
                          }}
                          onClick={() => setPerson(g.key)}
                        >
                          <strong>
                            {debtPersonLabel(g.items[0].debtWho,g.items[0].debtRelationship)} · {g.items.length}{" "}
                            ta
                          </strong>
                          <p>
                            {money(
                              g.items.reduce(
                                (sum, t) => sum + debtRemaining(t, all),
                                0,
                              ),
                            )}{" "}
                            so‘m
                          </p>
                          <small>{status(g.items[0])}</small>
                        </button>
                      ))}
                </>
              )}
            </SwipeSheet>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
