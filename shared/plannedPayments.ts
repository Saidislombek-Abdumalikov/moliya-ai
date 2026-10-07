import {validDay,daysBetween} from './debts.js';
export interface PlannedPayment {
  id: string
  title: string
  amount: number
  dueDate: string
  repeat: "none" | "weekly" | "monthly"
  time?: string
  icon?: string
  createdDay?: string
  snoozedUntil?: string
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
        ...(typeof p.time==='string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(p.time)?{time:p.time}:{}),
        icon:paymentIconKey(p.icon),
        ...(validDay(p.createdDay)?{createdDay:p.createdDay}:{}),
        ...(validDay(p.snoozedUntil)?{snoozedUntil:p.snoozedUntil}:{}),
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
  return { ...p, dueDate: d.toISOString().slice(0, 10), snoozedUntil: undefined }
}

// Preserve a monthly anchor after February/short-month clamping when editing other fields.
export function editedPaymentAnchor(previous: PlannedPayment | undefined, dueDate: string, repeat: PlannedPayment['repeat']): number | undefined {
  return previous?.repeat === 'monthly' && repeat === 'monthly' && previous.dueDate === dueDate
    ? previous.anchorDay : undefined;
}

export const paymentIcons:Record<string,string>={wifi:'📶',phone:'📱',home:'🏠',utilities:'💡',transport:'🚕',education:'📚',health:'💊',subscription:'🔁',other:'🧾'};
export function paymentIconKey(value:unknown):string {return typeof value==='string' && Object.prototype.hasOwnProperty.call(paymentIcons,value)?value:'other';}
export function paymentRecordId(p:PlannedPayment):string{return `planned_${p.id}_${p.dueDate}`;}
export function paymentReminderKind(p:PlannedPayment,today:string,transactions:{id?:string|number}[]):'early'|'due'|null {
  if(transactions.some(t=>String(t.id)===paymentRecordId(p)) || (p.snoozedUntil && p.snoozedUntil>today))return null;
  if(p.dueDate<=today)return 'due';
  return daysBetween(today,p.dueDate)<=3 && (!p.createdDay || daysBetween(p.createdDay,p.dueDate)>3)?'early':null;
}
export function tomorrowDay(today:string):string {const d=new Date(today+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);}

export function nextUnseenPaymentReminder(plans:PlannedPayment[],today:string,transactions:{id?:string|number}[],wasSeen:(p:PlannedPayment)=>boolean):PlannedPayment|undefined {
  return plans.find(p=>paymentReminderKind(p,today,transactions)!==null&&!wasSeen(p));
}
