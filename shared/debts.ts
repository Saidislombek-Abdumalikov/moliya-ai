export type DebtRecord = {
  id: string | number
  type: string
  amount: number | string
  date?: string
  debtWho?: string
  debtPersonId?: string
  debtDueDate?: string | null
  debtDateConfirmed?: boolean
  debtPaymentFor?: string
  debtDismissed?: string
  [key: string]: any
}
export const isDebt = (t: DebtRecord) =>
  t.type === "debt" || t.type === "lending"
export function localDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}
export function validDay(s: unknown): s is string {
  return (
    typeof s === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s + "T12:00:00Z").toISOString().slice(0, 10) === s
  )
}
export function daysBetween(a: string, b: string) {
  return Math.round(
    (Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000,
  )
}
export function addDays(day: string, n: number) {
  return new Date(Date.parse(day + "T12:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10)
}
export function debtRemaining(t: DebtRecord, all: DebtRecord[]) {
  return Math.max(
    0,
    Math.round(
      (Math.abs(Number(t.amount)) -
        all
          .filter((p) => p.debtPaymentFor === String(t.id))
          .reduce((s, p) => s + Math.abs(Number(p.amount) || 0), 0)) *
        100,
    ) / 100,
  )
}
export function reminderKind(
  t: DebtRecord,
  today = localDay(),
): "early" | "due" | null {
  if (!validDay(t.debtDueDate)) return null
  if (t.debtDueDate === today) return "due"
  const start = String(t.date || "").slice(0, 10)
  return validDay(start) &&
    daysBetween(start, t.debtDueDate) > 3 &&
    daysBetween(today, t.debtDueDate) === 3
    ? "early"
    : null
}
export function debtNoticeKey(t: DebtRecord, today = localDay()) {
  return `${t.debtDueDate}:${today}`
}
export function dueDebts<T extends DebtRecord>(
  all: T[],
  today = localDay(),
): T[] {
  return all.filter(
    (t) =>
      isDebt(t) &&
      debtRemaining(t, all) > 0 &&
      validDay(t.debtDueDate) &&
      (t.debtDueDate <= today || reminderKind(t, today)) &&
      t.debtDismissed !== debtNoticeKey(t, today),
  )
}
export function debtRank(t: DebtRecord, today = localDay()) {
  return !validDay(t.debtDueDate)
    ? "9"
    : t.debtDueDate < today
      ? "0" + t.debtDueDate
      : t.debtDueDate === today
        ? "1"
        : "2" + t.debtDueDate
}
export function personKey(t: DebtRecord) {
  return t.debtPersonId || "legacy:" + String(t.id)
}
// Separate an actual borrowing/lending from a future repayment clause.
export function debtPrincipalText(text: string) {
  const match = text.match(/\bqarz\s+(?:oldim|olganman|berdim|berganman)\b/i)
  if (!match) return text
  const end = match.index! + match[0].length
  const tail = text.slice(end)
  // Strip only a future repayment promise, never another completed operation or negation.
  if (
    /\b(?:emas|yo'q|ishlatdim|sarfladim|oldim|berdim|to'ladim|qaytardim|tushdi|keldi)\b/i.test(
      tail,
    )
  )
    return text
  return /\b(?:qaytaraman|qaytaradi|qaytarishim|to'layman|tolayman)\b/i.test(
    tail,
  )
    ? text.slice(0, end)
    : text
}
export function debtDueFromText(
  text: string,
  today = localDay(),
): string | null {
  const x = text.toLowerCase().replace(/[‘’ʻʼ]/g, "'")
  if (!/qaytar|to'lay|tolay|верн|возврат|repay|pay back|return/i.test(x))
    return null
  const iso = x.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1]
  if (iso && validDay(iso)) return iso
  if (/\bindin\b|day after tomorrow|послезавтра/.test(x))
    return addDays(today, 2)
  if (/\b(ertaga|tomorrow)\b|завтра/.test(x)) return addDays(today, 1)
  if (/\b(bugun|today)\b|сегодня/.test(x)) return today
  const m = x.match(
    /\b(\d+|bir|ikki|uch|to'rt|besh|yetti)\s*(kun|hafta|oy)(?:dan)?\s*(?:keyin|so'ng|ichida)/,
  )
  if (m) {
    const n =
      Number(m[1]) ||
      ({ bir: 1, ikki: 2, uch: 3, "to'rt": 4, besh: 5, yetti: 7 } as any)[m[1]]
    if (n > 0 && n <= 365) {
      if (m[2] !== "oy") return addDays(today, n * (m[2] === "hafta" ? 7 : 1))
      const d = new Date(today + "T12:00:00Z"),
        day = d.getUTCDate()
      d.setUTCDate(1)
      d.setUTCMonth(d.getUTCMonth() + n)
      const last = new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
      ).getUTCDate()
      d.setUTCDate(Math.min(day, last))
      return d.toISOString().slice(0, 10)
    }
  }
  return null
}
export function withDebtDetails<T extends Record<string, any>>(
  tx: T,
  source: string,
): T & Record<string, any> {
  if (!["debt", "lending"].includes(tx.type)) return tx
  const due = validDay(tx.debtDueDate)
    ? tx.debtDueDate
    : debtDueFromText(source)
  return {
    ...tx,
    debtDueDate: due,
    debtDateConfirmed: !!due || tx.debtDateConfirmed === true,
  }
}
export function reminderPromise(
  due: string | null | undefined,
  date = localDay(),
) {
  if (!validDay(due)) return "Qaytarish sanasi hali belgilanmagan."
  return daysBetween(date.slice(0, 10), due) > 3
    ? `${due}: 3 kun oldin va o‘sha kuni eslataman.`
    : `${due} kuni eslataman.`
}
