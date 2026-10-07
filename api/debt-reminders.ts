import {deliverPlannedReminder} from './services/_plannedReminderService.js';
import {cleanPlannedPayments,paymentReminderKind} from '../shared/plannedPayments.js';
import {logBotMessage} from './services/_telegramMessageService.js';
import crypto from "node:crypto"
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { supabase } from "./_supabaseClient.js"
import { eligibleUser } from "./_userPolicy.js"
import { applySecurityHeaders } from "./_securityHeaders.js"
import {
  isDebt,
  debtRemaining,
  localDay,
  validDay,
  daysBetween,
  type DebtRecord,
} from "../shared/debts.js"

export function deliveryKind(
  tx: DebtRecord,
  today: string,
): "early" | "due" | null {
  if (!validDay(tx.debtDueDate)) return null
  if (tx.debtDueDate <= today) return "due" // Catch up after a scheduler outage, once per due date.
  const start = String(tx.date || "").slice(0, 10)
  return validDay(start) &&
    daysBetween(start, tx.debtDueDate) > 3 &&
    daysBetween(today, tx.debtDueDate) <= 3
    ? "early"
    : null
}
export async function deliverDebtReminder(
  user: any,
  tx: DebtRecord,
  today: string,
) {
  const all = Array.isArray(user.transactions) ? user.transactions : []
  const kind = deliveryKind(tx, today),
    remaining = debtRemaining(tx, all)
  if (!eligibleUser(user) || !isDebt(tx) || !kind || remaining <= 0)
    return "skipped"
  // Restriction tombstones may exist independently of the user row.
  const { data: restriction, error: restrictionError } = await supabase
    .from("users")
    .select("onboarding")
    .eq("id", "restricted_tg_" + user.telegram_id)
    .maybeSingle()
  if (restrictionError) return "failed"
  if (restriction && restriction.onboarding?.is_blocked !== false)
    return "skipped"
  const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim()
  if (!token) return "failed"
  const key = {
    user_id: user.id,
    tx_id: String(tx.id),
    due_date: tx.debtDueDate,
    kind,
  }
  const { error } = await supabase.from("moliya_debt_delivery").insert(key)
  if (error?.code === "23505") return "duplicate"
  if (error) return "failed"
  const status = (value: string) =>
    supabase.from("moliya_debt_delivery").update({ status: value }).match(key)
  const direction =
    tx.type === "debt" ? "Qaytarishingiz kerak" : "Qaytarib olishingiz kerak"
  const when =
    kind === "early"
      ? `${daysBetween(today, tx.debtDueDate!)} kun qoldi`
      : tx.debtDueDate === today
        ? "Bugun"
        : "Muddati o‘tgan"
  let attempted = false
  const release = () =>
    supabase.from("moliya_debt_delivery").delete().match(key)
  try {
    // Re-read before delivery so settled/deleted/rescheduled debts are not sent from an old page snapshot.
    const { data: fresh, error: freshError } = await supabase
      .from("users")
      .select("*")
      .eq("id", user.id)
      .maybeSingle()
    const current = fresh?.transactions?.find(
      (t: DebtRecord) => String(t.id) === String(tx.id),
    )
    if (freshError) throw new Error("STORE_UNAVAILABLE")
    if (
      !fresh ||
      !eligibleUser(fresh) ||
      !current ||
      current.debtDueDate !== tx.debtDueDate ||
      debtRemaining(current, fresh.transactions) <= 0
    ) {
      await status("skipped")
      return "skipped"
    }
    const currentAmount = debtRemaining(current, fresh.transactions)
      .toLocaleString("en-US", { maximumFractionDigits: 2 })
      .replace(/,/g, " ")
    const currentMessage = `🔔 ${when}\n${direction}: ${String(current.debtWho || "Nomsiz").slice(0, 100)}\n${currentAmount} so‘m\nQaytarish sanasi: ${current.debtDueDate}`
    const url = new URL(
      process.env.APP_URL || "https://moliya-ai-pi.vercel.app",
    )
    url.searchParams.set("debts", "1")
    url.searchParams.set("debtId", String(tx.id))
    attempted = true
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          chat_id: String(user.telegram_id),
          text: currentMessage,
          reply_markup: {
            inline_keyboard: [
              [{ text: "Qarzlar", web_app: { url: url.href } }],
            ],
          },
        }),
      },
    )
    const result = await response.json()
    if (!result.ok) {
      if (result.error_code === 429 || result.error_code >= 500) await release()
      else await status("rejected")
      return "failed"
    }
    if(Number.isSafeInteger(result.result?.message_id)) await logBotMessage(user.id,{id:'debt_'+result.result.message_id,message_id:result.result.message_id,chat_id:user.telegram_id,direction:'bot_to_user',sender:'bot',type:'bot_response',text:currentMessage,timestamp:new Date().toISOString()});
    await status("sent")
    await supabase
      .from("app_notifications")
      .insert({
        title: "🔔 Qarz eslatmasi",
        message: currentMessage,
        target: user.id,
        is_active: true,
        created_at: new Date().toISOString(),
      })
    return "sent"
  } catch {
    if (attempted) await status("unknown")
    else await release()
    return "failed"
  } // Never blindly resend a possibly delivered message.
}
export default async function handler(req: VercelRequest, res: VercelResponse) {
  applySecurityHeaders(res)
  if (req.method !== "GET")
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" })
  const secret = (process.env.CRON_SECRET || "").trim(),
    given = Buffer.from(
      typeof req.headers.authorization === "string"
        ? req.headers.authorization
        : "",
    ),
    expected = Buffer.from("Bearer " + secret)
  if (
    secret.length < 16 ||
    given.length !== expected.length ||
    !crypto.timingSafeEqual(given, expected)
  )
    return res.status(401).json({ error: "UNAUTHORIZED" })
  const today = localDay(),
    deadline = Date.now() + 50000
  let offset = 0
  const counts = { sent: 0, duplicate: 0, skipped: 0, failed: 0 }
  try {
    while (Date.now() < deadline) {
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .like("id", "moliya_user_tg_%")
        .order("id")
        .range(offset, offset + 49)
      if (error) throw new Error("STORE_UNAVAILABLE")
      for (const user of data || []) {
        const plans=cleanPlannedPayments(user.onboarding?.planned_payments).filter(p=>paymentReminderKind(p,today,user.transactions||[]));
        for(let i=0;i<plans.length;i+=5){
          if(Date.now()>=deadline)return res.status(503).json({error:'REMINDERS_INCOMPLETE',...counts});
          const results=await Promise.all(plans.slice(i,i+5).map(p=>deliverPlannedReminder(user,p,today)));
          for(const result of results)counts[result]++;
        }
        const debts = (user.transactions || []).filter(
          (t: DebtRecord) =>
            isDebt(t) &&
            deliveryKind(t, today) &&
            debtRemaining(t, user.transactions) > 0,
        )
        for (let i = 0; i < debts.length; i += 5) {
          if (Date.now() >= deadline)
            return res
              .status(503)
              .json({ error: "REMINDERS_INCOMPLETE", ...counts })
          const results = await Promise.all(
            debts
              .slice(i, i + 5)
              .map((t: DebtRecord) => deliverDebtReminder(user, t, today)),
          )
          for (const result of results)
            counts[(result as keyof typeof counts)]++
        }
      }
      if (!data || data.length < 50)
        return res.status(counts.failed ? 503 : 200).json(counts)
      offset += 50
    }
    return res.status(503).json({ error: "REMINDERS_INCOMPLETE", ...counts })
  } catch {
    return res.status(503).json({ error: "REMINDERS_UNAVAILABLE", ...counts })
  }
}
