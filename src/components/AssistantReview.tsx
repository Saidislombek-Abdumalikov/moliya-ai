import { useState, useRef } from "react"
import { useFinance } from "../FinanceContext"
import {
  assistantActionIssue,
  actionAmount,
  cleanCategoryPreferences,
  type AssistantReply,
  type AssistantAction,
} from "../../shared/assistant"
import { cleanPlannedPayments } from "../../shared/plannedPayments"
import { isDebt, debtRemaining } from "../../shared/debts"
export default function AssistantReview({
  reply,
  onAsk,
  onDone,
  onBusy,
  draftId,
}: {
  draftId?: string
  reply: AssistantReply
  onAsk: (text: string, actions: AssistantAction[]) => void
  onDone: () => void
  onBusy: (busy: boolean) => void
}) {
  const {
    cards,
    customTransactions,
    onboarding,
    addTransaction,
    updateOnboarding,
    debtAction,
  } = useFinance()
  const [actions, setActions] = useState(reply.actions),
    [answer, setAnswer] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState<number[]>([])
  const ids = useRef(reply.actions.map(() => crypto.randomUUID())),
    completed = useRef(new Set<number>()),
    saving = useRef(false)
  const actionId = (i: number) =>
    draftId ? `assistant_${draftId}_${i}` : "ai_" + ids.current[i]
  const labels: Record<string, string> = {
    expense: "Xarajat",
    income: "Daromad",
    debt: "Qarz oldim",
    lending: "Qarz berdim",
    payment: "Rejali to‘lov",
    repayment: "Qarz qaytarildi",
  }
  const patch = (i: number, data: Partial<AssistantAction>) =>
    setActions((a) => a.map((v, n) => (n === i ? { ...v, ...data } : v)))
  const save = async () => {
    if (saving.current) return
    for (const a of actions) {
      const issue = assistantActionIssue(a)
      if (issue) {
        setError(issue)
        return
      }
    }
    saving.current = true
    setBusy(true)
    onBusy(true)
    setError("")
    try {
      const pendingPlans = actions
        .map((a, i) => ({ a, i }))
        .filter(({ a, i }) => a.kind === "payment" && !completed.current.has(i))
      if (pendingPlans.length) {
        let plans = cleanPlannedPayments(onboarding?.planned_payments)
        for (const { a, i } of pendingPlans) {
          const id = actionId(i)
          if (plans.some((p) => p.id === id)) continue
          plans = plans.concat({
            id,
            title: a.title,
            amount: actionAmount(a)!,
            dueDate: a.date!,
            repeat: a.repeat,
            anchorDay: Number(a.date!.slice(8)),
          })
        }
        if (plans.length > 100) throw Error("Rejalar soni 100 tadan oshmasin.")
        await updateOnboarding({ planned_payments: plans })
        pendingPlans.forEach(({ i }) => completed.current.add(i))
        setDone([...completed.current])
      }
      for (let i = 0; i < actions.length; i++) {
        if (completed.current.has(i)) continue
        const a = actions[i],
          amount = actionAmount(a)!,
          id = actionId(i)
        const currencyNote =
          a.currency === "UZS"
            ? ""
            : ` (${a.amount} ${a.currency} × ${a.exchangeRate} UZS; foydalanuvchi kiritgan kurs)`
        if (a.kind === "payment") continue
        if (a.kind === "repayment") {
          const debt = customTransactions.find(
            (t) => String(t.id) === a.debtId && isDebt(t),
          )
          if (!debt) throw Error("Qarz topilmadi. Qayta tanlang.")
          if (amount > debtRemaining(debt, customTransactions))
            throw Error("Summa qolgan qarzdan oshmasin.")
          await debtAction(debt, "pay", {
            amount,
            date: a.date,
            cardId: a.cardId || "cash",
            paymentId: "pay_" + (draftId ? draftId + "_" + i : ids.current[i]),
          })
        } else {
          if (customTransactions.some((t) => String(t.id) === id)) {
            completed.current.add(i)
            setDone([...completed.current])
            continue
          }
          await addTransaction({
            id,
            type: a.kind,
            amount,
            note: a.title + currencyNote,
            title: a.title,
            category: a.category,
            date: a.date!,
            cardId: a.cardId || "cash",
            ...(["debt", "lending"].includes(a.kind)
              ? {
                  debtWho: a.person,
                  debtPersonId: "person_" + ids.current[i],
                  debtDueDate: a.dueDate,
                  debtDateConfirmed: true,
                }
              : {}),
          })
        }
        completed.current.add(i)
        setDone([...completed.current])
      }
      if (onboarding?.remember_categories) {
        let preferences = cleanCategoryPreferences(
          onboarding.category_preferences,
        )
        actions.forEach((a, i) => {
          if (a.category !== reply.actions[i].category && a.title.trim()) {
            const phrase = reply.actions[i].title.toLowerCase()
            preferences = preferences
              .filter((p) => p.phrase !== phrase)
              .concat({ phrase, category: a.category })
          }
        })
        // Learning is optional; a settings error never retries already committed money records.
        await updateOnboarding({
          category_preferences: preferences.slice(-40),
        }).catch(() => {})
      }
      onDone()
    } catch (e: any) {
      setError(
        (completed.current.size
          ? `${completed.current.size}/${actions.length} ta saqlandi. `
          : "") + (e?.message || "Saqlanmadi. Qayta urinib ko‘ring."),
      )
    } finally {
      saving.current = false
      setBusy(false)
      onBusy(false)
    }
  }
  return (
    <div className="ai-debt-fields">
      {reply.message && (
        <p
          style={{
            fontSize: 14,
            color: "#4B456D",
            marginBottom: 14,
            whiteSpace: "pre-wrap",
          }}
        >
          {reply.message}
        </p>
      )}
      {reply.question && (
        <p
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "#6D28D9",
            marginBottom: 14,
          }}
        >
          {reply.question}
        </p>
      )}
      {actions.map((a, i) => (
        <fieldset
          key={ids.current[i]}
          disabled={busy || done.includes(i)}
          style={{
            border: "1px solid #E8E3F8",
            borderRadius: 20,
            padding: 16,
            marginBottom: 16,
            minWidth: 0,
          }}
        >
          <legend style={{ fontSize: 13, color: "#7C3AED" }}>
            {i + 1}. {labels[a.kind]} {done.includes(i) ? "✓ Saqlandi" : ""}
          </legend>
          <label>
            Amal
            <select
              value={a.kind}
              onChange={(e) =>
                patch(i, { kind: e.target.value as AssistantAction["kind"] })
              }
            >
              {Object.entries(labels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Nomi / izoh
            <input
              value={a.title}
              onChange={(e) => patch(i, { title: e.target.value })}
              maxLength={100}
            />
          </label>
          <label>
            Summa
            <input
              inputMode="decimal"
              type="number"
              min="0.01"
              step="0.01"
              value={a.amount ?? ""}
              onChange={(e) =>
                patch(i, {
                  amount: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
          </label>
          <label>
            Valyuta
            <select
              value={a.currency}
              onChange={(e) =>
                patch(i, { currency: e.target.value, exchangeRate: undefined })
              }
            >
              <option value="">Tanlang</option>
              {[
                "UZS",
                "USD",
                "EUR",
                "RUB",
                "GBP",
                "KZT",
                ...(!["UZS", "USD", "EUR", "RUB", "GBP", "KZT", ""].includes(
                  a.currency,
                )
                  ? [a.currency]
                  : []),
              ].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          {a.currency && a.currency !== "UZS" && (
            <>
              <label>
                1 {a.currency} uchun kurs (so‘m)
                <input
                  inputMode="decimal"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={a.exchangeRate ?? ""}
                  onChange={(e) =>
                    patch(i, { exchangeRate: Number(e.target.value) })
                  }
                />
              </label>
              <p style={{ fontSize: 12, color: "#766E9E", marginBottom: 12 }}>
                Siz kiritgan kurs · {actionAmount(a)?.toLocaleString() || "—"}{" "}
                so‘m.{" "}
                {a.kind === "payment"
                  ? "Reja shu so‘m summasida saqlanadi."
                  : ""}
              </p>
            </>
          )}
          <label>
            {a.kind === "payment" ? "Keyingi to‘lov sanasi" : "Sana"}
            <input
              type="date"
              value={a.date || ""}
              onChange={(e) => patch(i, { date: e.target.value })}
            />
          </label>
          {a.kind === "payment" && (
            <label>
              Takrorlanish
              <select
                value={a.repeat}
                onChange={(e) =>
                  patch(i, {
                    repeat: e.target.value as AssistantAction["repeat"],
                  })
                }
              >
                <option value="none">Bir marta</option>
                <option value="weekly">Har hafta</option>
                <option value="monthly">Har oy</option>
              </select>
            </label>
          )}
          {["debt", "lending"].includes(a.kind) && (
            <>
              <label>
                Kim bilan?
                <input
                  value={a.person}
                  onChange={(e) => patch(i, { person: e.target.value })}
                />
              </label>
              <label>
                Qaytarish sanasi
                <input
                  type="date"
                  value={a.dueDate || ""}
                  onChange={(e) =>
                    patch(i, { dueDate: e.target.value, dueUnknown: false })
                  }
                />
              </label>
              <button
                className="ai-debt-unknown"
                aria-pressed={a.dueUnknown}
                onClick={() =>
                  patch(i, { dueDate: null, dueUnknown: !a.dueUnknown })
                }
              >
                Hali kelishilmagan {a.dueUnknown ? "✓" : ""}
              </button>
            </>
          )}
          {a.kind === "repayment" && (
            <label>
              Qaysi qarz?
              <select
                value={a.debtId}
                onChange={(e) => patch(i, { debtId: e.target.value })}
              >
                <option value="">Tanlang</option>
                {customTransactions
                  .filter(isDebt)
                  .filter((t) => debtRemaining(t, customTransactions) > 0)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.debtWho} · {t.type === "debt" ? "Qarzlarim" : "Haqqim"}{" "}
                      · {debtRemaining(t, customTransactions).toLocaleString()}{" "}
                      so‘m
                    </option>
                  ))}
              </select>
            </label>
          )}
          {!["payment", "repayment"].includes(a.kind) && (
            <label>
              Kategoriya
              <input
                value={a.category}
                onChange={(e) => patch(i, { category: e.target.value })}
              />
            </label>
          )}
          {a.kind !== "payment" && (
            <label>
              Hisob
              <select
                value={a.cardId || "cash"}
                onChange={(e) => patch(i, { cardId: e.target.value })}
              >
                <option value="cash">Naqd</option>
                {cards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.bank} ({c.number.slice(-4)})
                  </option>
                ))}
              </select>
            </label>
          )}
        </fieldset>
      ))}
      {!done.length && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (answer.trim()) onAsk(answer, actions)
          }}
        >
          <label>
            {reply.question ? "Javobingiz" : "Aniqlashtirish yoki boshqa savol"}
            <input
              disabled={busy}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Yozing..."
            />
          </label>
          <button className="ai-debt-unknown" disabled={busy || !answer.trim()}>
            Yuborish
          </button>
        </form>
      )}
      {error && (
        <p
          role="alert"
          style={{ color: "#DC2626", fontSize: 13, marginBottom: 12 }}
        >
          {error}
        </p>
      )}
      {!!actions.length && (
        <button
          onClick={save}
          disabled={busy}
          style={{
            width: "100%",
            padding: 15,
            border: 0,
            borderRadius: 14,
            background: "#7C3AED",
            color: "white",
            font: "inherit",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {busy ? "Saqlanmoqda…" : "Tasdiqlash"}
        </button>
      )}
    </div>
  )
}
