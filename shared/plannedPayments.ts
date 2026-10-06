export interface PlannedPayment {
  id: string
  title: string
  amount: number
  dueDate: string
  repeat: "none" | "weekly" | "monthly"
  anchorDay?: number
}
export function cleanPlannedPayments(value: unknown): PlannedPayment[] {
  if (!Array.isArray(value)) return []
  const ids = new Set<string>()
  return value.slice(0, 100).flatMap((p) => {
    if (
      !p ||
      typeof p.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(p.id) ||
      ids.has(p.id) ||
      typeof p.title !== "string" ||
      !p.title.trim() ||
      typeof p.amount !== "number" ||
      !Number.isFinite(p.amount) ||
      p.amount <= 0 ||
      p.amount > 1e15 ||
      typeof p.dueDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(p.dueDate)
    )
      return []
    const time = Date.parse(p.dueDate + "T00:00:00Z")
    if (
      !Number.isFinite(time) ||
      new Date(time).toISOString().slice(0, 10) !== p.dueDate ||
      !["none", "weekly", "monthly"].includes(p.repeat)
    )
      return []
    ids.add(p.id)
    return [
      {
        id: p.id,
        title: p.title.trim().slice(0, 100),
        amount: p.amount,
        dueDate: p.dueDate,
        repeat: p.repeat,
        anchorDay:
          Number.isInteger(p.anchorDay) && p.anchorDay >= 1 && p.anchorDay <= 31
            ? p.anchorDay
            : Number(p.dueDate.slice(8, 10)),
      },
    ]
  })
}
export function nextPayment(p: PlannedPayment): PlannedPayment | null {
  if (p.repeat === "none") return null
  const d = new Date(p.dueDate + "T00:00:00Z")
  if (p.repeat === "weekly") d.setUTCDate(d.getUTCDate() + 7)
  else {
    const day = p.anchorDay || d.getUTCDate()
    d.setUTCDate(1)
    d.setUTCMonth(d.getUTCMonth() + 1)
    const last = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
    ).getUTCDate()
    d.setUTCDate(Math.min(day, last))
  }
  return { ...p, dueDate: d.toISOString().slice(0, 10) }
}
