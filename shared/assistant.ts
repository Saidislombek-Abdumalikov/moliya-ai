import {paymentIconKey} from "./plannedPayments.js"
import { validDay } from "./debts.js"
export type AssistantKind = "expense" | "income" | "debt" | "lending" | "payment" | "repayment"
export interface AssistantAction {
  kind: AssistantKind
  amount: number | null
  currency: string
  title: string
  note?: string
  time?: string | null
  icon?: string
  category: string
  date: string | null
  person: string
  dueDate: string | null
  dueUnknown: boolean
  repeat: "none" | "weekly" | "monthly"
  debtId: string
  exchangeRate?: number
  cardId?: string
}
export interface AssistantReply {
  message: string
  question: string
  actions: AssistantAction[]
  transcription: string
}
export interface CategoryPreference {
  phrase: string
  category: string
}
export function cleanCategoryPreferences(value: unknown): CategoryPreference[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(-40)
    .flatMap((x) =>
      typeof x?.phrase === "string" &&
      x.phrase.trim() &&
      typeof x?.category === "string" &&
      x.category.trim()
        ? [
            {
              phrase: x.phrase.trim().toLowerCase().slice(0, 80),
              category: x.category.trim().slice(0, 60),
            },
          ]
        : [],
    )
}
export function normalizeAssistantReply(raw: any): AssistantReply {
  if (!raw || !Array.isArray(raw.actions))
    throw Error("INVALID_AI_RESPONSE")
  if (raw.actions.length > 1) return {
    actions: [],
    message: 'Iltimos, bir safarda faqat bitta tranzaksiya yuboring.',
    question: '',
    transcription: String(raw.transcription || '').slice(0, 4000),
  }
  const actions = raw.actions.map((x: any): AssistantAction => {
    if (
      ![
        "expense",
        "income",
        "debt",
        "lending",
        "payment",
        "repayment",
      ].includes(x?.kind)
    )
      throw Error("INVALID_AI_ACTION")
    return {
      kind: x.kind,
      amount:
        typeof x.amount === "number" &&
        Number.isFinite(x.amount) &&
        x.amount > 0 &&
        x.amount <= 1e12
          ? x.amount
          : null,
      currency:
        typeof x.currency === "string"
          ? x.currency.toUpperCase().slice(0, 8)
          : "",
      title: String(x.title || "").slice(0, 100),
      note: String(raw.transcription || x.note || x.title || '').slice(0, 4000),
      time: x.time == null || x.time === '' ? null : String(x.time).slice(0,20),
      icon: paymentIconKey(x.icon),
      category: String(x.category || "Boshqa").slice(0, 60),
      date: validDay(x.date) ? x.date : null,
      person: String(x.person || "").slice(0, 100),
      // Keep invalid supplied dates invalid across API/client normalization.
      dueDate: x.dueDate == null || x.dueDate === '' ? null : String(x.dueDate).slice(0, 100),
      dueUnknown: (x.dueDate == null || x.dueDate === '') && (x.dueUnknown === true || ['debt','lending'].includes(x.kind)),
      repeat: ["weekly", "monthly"].includes(x.repeat) ? x.repeat : "none",
      debtId: String(x.debtId || "").slice(0, 200),
    }
  })
  return {
    actions,
    message: String(raw.message || "").slice(0, 1000),
    question: String(raw.question || "").slice(0, 500),
    transcription: String(raw.transcription || "").slice(0, 4000),
  }
}
export function actionAmount(action: AssistantAction): number | null {
  if (
    !action.amount ||
    !Number.isFinite(action.amount) ||
    action.amount <= 0 ||
    action.amount > 1e12 ||
    Math.abs(action.amount * 100 - Math.round(action.amount * 100)) > 0.00001
  )
    return null
  if (action.currency === "UZS") return action.amount
  const rate = action.exchangeRate
  if (!action.currency || !rate || !Number.isFinite(rate) || rate <= 0)
    return null
  const amount = Math.round(action.amount * rate * 100) / 100
  return amount > 0 && amount <= 1e12 ? amount : null
}
export function assistantActionIssue(a: AssistantAction): string | null {
  if(a.time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(a.time))return 'Vaqtni aniqlashtiring.';
  if (!a.amount) return "Summani kiriting."
  if (!a.currency) return "Valyutani tanlang."
  if (actionAmount(a) === null) return "So‘mga aylantirish kursini kiriting."
  if (!a.title.trim()) return "Nomi yoki izohini kiriting."
  if (!validDay(a.date))
    return a.kind === "payment" ? "Qaysi sanada to‘lanadi?" : "Sanani kiriting."
  if (
    ["debt", "lending"].includes(a.kind) &&
    (!a.person.trim() || (!validDay(a.dueDate) && !a.dueUnknown))
  )
    return !a.person.trim()
      ? "Kim bilan qarz?"
      : "Qaytarish sanasini tanlang yoki hali kelishilmaganini belgilang."
  if (a.kind === "repayment" && !a.debtId)
    return "Qaysi qarz qaytarilganini tanlang."
  return null
}
