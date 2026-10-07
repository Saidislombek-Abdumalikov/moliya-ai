import { AnimatePresence, motion } from 'motion/react'
import { useState, useRef } from "react"
import { useFinance } from "../FinanceContext"
import SwipeSheet from "./SwipeSheet"
import {
  cleanPlannedPayments,
  editedPaymentAnchor,
  nextPayment,
  type PlannedPayment,
} from "../../shared/plannedPayments"
import { tashkentDay } from "../../shared/reminderPolicy"
export default function UpcomingPayments() {
  const {
    onboarding,
    updateOnboarding,
    addTransaction,
    customTransactions,
    cards,
  } = useFinance()
  const saving = useRef(false)
  const [cardId, setCardId] = useState("cash")
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
  const plans = cleanPlannedPayments(onboarding?.planned_payments).sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate),
  )
  const [open, setOpen] = useState(false),
    [pay, setPay] = useState<PlannedPayment | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("")
  const [editId, setEditId] = useState<string | null>(null)
  const [title, setTitle] = useState(""),
    [amount, setAmount] = useState(""),
    [date, setDate] = useState(tashkentDay(new Date())),
    [repeat, setRepeat] = useState<PlannedPayment["repeat"]>("none")
  const save = async (updated: PlannedPayment[]) => {
    await updateOnboarding({ planned_payments: updated })
  }
  const run = async (fn: () => Promise<void>) => {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setError("")
    try {
      await fn()
    } catch {
      setError(words[16])
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  if (!plans.length && !open && !pay) return null
  return (
    <section
      style={{
        margin: "0 20px 24px",
        padding: 16,
        borderRadius: 20,
        background: "linear-gradient(135deg,#FAF9FD,#F4F0FF)",
        border: "1.5px solid #E6DFFF",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <h3 style={{ fontSize: 15, color: "#1E1A3C" }}>{words[0]}</h3>
        <button
          className="planned-button"
          onClick={() => {
            setError("")
            setEditId(null)
            setTitle("")
            setAmount("")
            setDate(tashkentDay(new Date()))
            setRepeat("none")
            setOpen(true)
          }}
        >
          {words[1]}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!plans.length && (
        <p style={{ fontSize: 12, color: "#64748B", marginTop: 12 }}>
          {words[13]}
        </p>
      )}
      {plans.map((p) => (
        <div
          key={p.id}
          style={{
            paddingTop: 12,
            marginTop: 10,
            borderTop: "1px solid #E6DFFF",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <strong style={{ fontSize: 13, overflowWrap: "anywhere" }}>
              {p.repeat==='monthly'?'🔁':p.repeat==='weekly'?'📅':'🧾'} {p.title}
            </strong>
            <span style={{ fontSize: 13, whiteSpace: "nowrap" }}>
              {p.amount.toLocaleString("en-US").replace(/,/g, " ")} so‘m
            </span>
          </div>
          <div
            style={{
              fontSize: 12,
              marginTop: 4,
              color:
                p.dueDate <= tashkentDay(new Date()) ? "#B45309" : "#64748B",
            }}
          >
            {p.dueDate} ·{" "}
            {words[p.repeat === "none" ? 5 : p.repeat === "weekly" ? 6 : 7]}{" "}
            {p.dueDate <= tashkentDay(new Date()) ? " · " + words[14] : ""}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              disabled={busy}
              className="planned-button"
              onClick={() => {
                setError("")
                setCardId("cash")
                setPay(p)
              }}
            >
              {words[9]}
            </button>
            <button
              className="planned-button"
              disabled={busy}
              onClick={() => {
                setError("")
                setEditId(p.id)
                setTitle(p.title)
                setAmount(String(p.amount))
                setDate(p.dueDate)
                setRepeat(p.repeat)
                setOpen(true)
              }}
            >
              {lang === "en"
                ? "Edit"
                : lang === "ru"
                  ? "Изменить"
                  : lang === "uz_cyrl"
                    ? "Таҳрирлаш"
                    : "Tahrirlash"}
            </button>
            <button
              disabled={busy}
              className="planned-button"
              onClick={() =>
                run(() => save(plans.filter((x) => x.id !== p.id)))
              }
            >
              {words[15]}
            </button>
          </div>
        </div>
      ))}
      <AnimatePresence>{(open || pay) && (
        <motion.div className="finance-popup-overlay" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={()=>{if(!busy){setOpen(false);setPay(null)}}}>
          <SwipeSheet
            className="ai-restored-sheet ai-debt-fields"
            initial={{y:'100%'}} animate={{y:0}} exit={{y:'100%'}} transition={{type:'spring',damping:26,stiffness:220}}
            onClick={e=>e.stopPropagation()}
            footer={pay ? (                <button
                  disabled={busy}
                  className="finance-popup-primary"
                  onClick={() =>
                    run(async () => {
                      const id = `planned_${pay.id}_${pay.dueDate}`
                      if (!customTransactions.some((t) => String(t.id) === id))
                        await addTransaction({
                          id,
                          type: "expense",
                          amount: pay.amount,
                          note: pay.title,
                          category: "Boshqa",
                          cardId,
                          date: tashkentDay(new Date()),
                        })
                      const next = nextPayment(pay)
                      await save(
                        plans.flatMap((p) =>
                          p.id === pay.id ? (next ? [next] : []) : [p],
                        ),
                      )
                      setPay(null)
                    })
                  }
                >
                  {words[11]}
                </button>) : <button disabled={busy} className="finance-popup-primary" type="submit" form="planned-payment-form">{words[8]}</button>}
            locked={busy}
            onDismiss={() => {
              setOpen(false)
              setPay(null)
            }}
            style={{
              background: "white",
              borderRadius: "28px 28px 0 0",
              padding: "16px 20px max(12px, env(safe-area-inset-bottom))",
              width: "100%",
              maxWidth: "var(--app-max-width,440px)",
              maxHeight: "92dvh",
              boxShadow:"0 -10px 40px #00000026",
            }}
            scrollBody
          >
            <div className="finance-popup-heading"><h3>{pay?'✅':'🗓️'} {pay?words[10]:words[0]}</h3><button className="finance-popup-close" disabled={busy} aria-label={words[12]} onClick={()=>{setOpen(false);setPay(null)}}>✕</button></div>
            {pay ? (
              <>

                <p style={{ margin: "14px 0" }}>
                  {pay.title} — {pay.amount.toLocaleString()} so‘m
                </p>
                <select
                  aria-label={lang === "en" ? "Account" : "Hisob"}
                  value={cardId}
                  onChange={(e) => setCardId(e.target.value)}
                >
                  <option value="cash">
                    {lang === "en"
                      ? "Cash"
                      : lang === "ru"
                        ? "Наличные"
                        : lang === "uz_cyrl"
                          ? "Нақд"
                          : "Naqd"}
                  </option>
                  {cards.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.bank} · {c.number.slice(-4)}
                    </option>
                  ))}
                </select>

              </>
            ) : (
              <form id="planned-payment-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  run(async () => {
                    const p = cleanPlannedPayments([
                      {
                        id: editId || crypto.randomUUID(),
                        title,
                        amount: Number(amount),
                        dueDate: date,
                        repeat,
                        anchorDay: editedPaymentAnchor(plans.find(p=>p.id===editId),date,repeat),
                      },
                    ])[0]
                    if (!p || (!editId && plans.length >= 100))
                      throw new Error("INVALID_PLAN")
                    await save(
                      editId
                        ? plans.map((x) => (x.id === editId ? p : x))
                        : [...plans, p],
                    )
                    setOpen(false)
                    setTitle("")
                    setAmount("")
                  })
                }}
              >

                <label>
                  {words[2]}
                  <input
                    required
                    maxLength={100}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <label>
                  {words[3]}
                  <input
                    required
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    max="1000000000000000"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <div className="finance-fields-row">
                <label>
                  {words[4]}
                  <input
                    required
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
                <label>{words[repeat==='none'?5:repeat==='weekly'?6:7]}<select
                  aria-label={words[5]}
                  value={repeat}
                  onChange={(e) =>
                    setRepeat(e.target.value as PlannedPayment["repeat"])
                  }
                >
                  {(["none", "weekly", "monthly"] as const).map((v, i) => (
                    <option key={v} value={v}>
                      {words[5 + i]}
                    </option>
                  ))}
                </select>
                </label></div>


              </form>
            )}
            {error && <p role="alert">{error}</p>}

          </SwipeSheet>
        </motion.div>
      )}</AnimatePresence>
    </section>
  )
}
