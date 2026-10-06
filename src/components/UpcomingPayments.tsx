import { useState, useRef } from "react"
import { useFinance } from "../FinanceContext"
import SwipeSheet from "./SwipeSheet"
import {
  cleanPlannedPayments,
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
  return (
    <section
      style={{
        margin: "0 20px 24px",
        padding: 16,
        borderRadius: 20,
        background: "#F0FDFA",
        border: "1px solid #CCFBF1",
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
        <h3 style={{ fontSize: 15, color: "#134E4A" }}>{words[0]}</h3>
        <button
          className="planned-button"
          onClick={() => {
            setError("")
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
            borderTop: "1px solid #CCFBF1",
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
              {p.title}
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
      {(open || pay) && (
        <div className="planned-overlay">
          <SwipeSheet
            locked={busy}
            onDismiss={() => {
              setOpen(false)
              setPay(null)
            }}
            style={{
              background: "white",
              borderRadius: 24,
              padding: 20,
              width: "100%",
              maxWidth: 430,
              maxHeight: "85dvh",
            }}
            scrollBody
          >
            {pay ? (
              <>
                <h3>{words[10]}</h3>
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
                <button
                  disabled={busy}
                  className="planned-button"
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
                </button>
              </>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  run(async () => {
                    const p = cleanPlannedPayments([
                      {
                        id: crypto.randomUUID(),
                        title,
                        amount: Number(amount),
                        dueDate: date,
                        repeat,
                      },
                    ])[0]
                    if (!p || plans.length >= 100)
                      throw new Error("INVALID_PLAN")
                    await save([...plans, p])
                    setOpen(false)
                    setTitle("")
                    setAmount("")
                  })
                }}
              >
                <h3>{words[0]}</h3>
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
                <label>
                  {words[4]}
                  <input
                    required
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
                <select
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
                <button
                  disabled={busy}
                  className="planned-button"
                  type="submit"
                >
                  {words[8]}
                </button>
              </form>
            )}
            {error && <p role="alert">{error}</p>}
            <button
              disabled={busy}
              className="planned-button"
              onClick={() => {
                setOpen(false)
                setPay(null)
              }}
            >
              {words[12]}
            </button>
          </SwipeSheet>
        </div>
      )}
    </section>
  )
}
