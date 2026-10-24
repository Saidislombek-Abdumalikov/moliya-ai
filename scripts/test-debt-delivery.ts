import assert from "node:assert/strict"
process.env.SUPABASE_URL = "http://127.0.0.1:54321"
process.env.SUPABASE_SERVICE_ROLE_KEY = "offline-test"
process.env.TELEGRAM_BOT_TOKEN = "offline-test"
const { supabase } = await import("../api/_supabaseClient.js")
const {installFakeBotMessages:__ifb}=await import('./_fakeBotMessages.js');const botStore=__ifb(supabase);
const {
  deliverDebtReminder,
  deliveryKind,
  default: handler,
} = await import("../api/debt-reminders.js")
const loan = {
  id: "loan",
  type: "debt",
  amount: 100000,
  date: "2026-10-01",
  debtDueDate: "2026-10-08",
  debtWho: "Ali <test>",
}
const user = {
  id: "moliya_user_tg_123",
  telegram_id: "123",
  phone: "+998901234567",
  bot_verification: {
    telegram_id: "123",
    phone: "+998901234567",
    phone_source: "telegram_own_contact",
    phone_verified_at: "2026-01-01",
    consent_source: "telegram_button",
    consent_version: "1",
    consent_accepted_at: "2026-01-01",
  },
  transactions: [loan],
  onboarding: {},
}
let fresh: any = user,
  restricted = false,
  calls = 0,
  notifications = 0,
  mode = "ok"
const claims = new Map<string, any>()
;(supabase as any).from = (table: string) => {
  let op = "select",
    payload: any,
    filters: any = {}
  const q: any = {
    select() {
      return q
    },
    eq(k: string, v: any) {
      filters[k] = v
      return q
    },
    is(k: string, v: any) { filters[k]=v; return q },
    match(v: any) {
      filters = v
      return q
    },
    insert(v: any) {
      op = "insert"
      payload = v
      return q
    },
    update(v: any) {
      op = "update"
      payload = v
      return q
    },
    delete() {
      op = "delete"
      return q
    },
    async maybeSingle() {
      if(op==="update" && table==="users")Object.assign(fresh,payload);
      return {
        data: String(filters.id).startsWith("restricted_")
          ? restricted
            ? { onboarding: { is_blocked: true } }
            : null
          : fresh,
        error: null,
      }
    },
    then(resolve: any, reject: any) {
      return Promise.resolve()
        .then(() => {
          if (table === "app_notifications") {
            notifications++
            return { error: null }
          }
          const k = JSON.stringify(op === "insert" ? payload : filters)
          if (op === "insert") {
            if (claims.has(k)) return { error: { code: "23505" } }
            claims.set(k, { status: "claimed" })
          }
          if (op === "update") claims.set(k, payload)
          if (op === "delete") claims.delete(k)
          return { error: null }
        })
        .then(resolve, reject)
    },
  }
  return q
}
globalThis.fetch = async (_url: any, init: any) => {
  calls++
  const body = JSON.parse(init.body)
  assert.equal(body.chat_id, "123")
  assert.equal(body.parse_mode, undefined)
  assert.match(body.text, /100 000/)
  if (mode === "timeout") throw new Error("timeout")
  return new Response(
    JSON.stringify(
      mode === "rate"
        ? { ok: false, error_code: 429 }
        : { ok: true, result: { message_id: 1 } },
    ),
  )
}
assert.equal(deliveryKind(loan, "2026-10-06"), "early")
assert.equal(deliveryKind(loan, "2026-10-09"), "due")
assert.equal(await deliverDebtReminder(user, loan, "2026-10-05"), "sent")
assert.equal(notifications, 1)
assert.equal(await deliverDebtReminder(user, loan, "2026-10-05"), "duplicate")
assert.equal(calls, 1)
assert.equal(await deliverDebtReminder(user, loan, "2026-10-08"), "sent")
assert.equal(calls, 2)
claims.clear()
restricted = true
assert.equal(await deliverDebtReminder(user, loan, "2026-10-08"), "skipped")
restricted = false
fresh = { ...user, transactions: [] }
assert.equal(await deliverDebtReminder(user, loan, "2026-10-08"), "skipped")
assert.equal(calls, 2)
claims.clear()
fresh = {
  ...user,
  transactions: [
    loan,
    { id: "paid", type: "expense", amount: -100000, debtPaymentFor: "loan" },
  ],
}
assert.equal(await deliverDebtReminder(user, loan, "2026-10-08"), "skipped")
assert.equal(calls, 2)
claims.clear()
fresh = user
mode = "rate"
assert.equal(await deliverDebtReminder(user, loan, "2026-10-08"), "failed")
assert.equal(claims.size, 0)
mode = "ok"
assert.equal(await deliverDebtReminder(user, loan, "2026-10-08"), "sent")
claims.clear()
mode = "timeout"
assert.equal(await deliverDebtReminder(user, loan, "2026-10-08"), "failed")
assert.equal(await deliverDebtReminder(user, loan, "2026-10-08"), "duplicate")
const res: any = {
  statusCode: 200,
  setHeader() {},
  status(n: number) {
    this.statusCode = n
    return this
  },
  json(v: any) {
    return v
  },
}
await handler({ method: "GET", headers: {}, query: {} } as any, res)
assert.equal(res.statusCode, 401)
console.log(
  "Mock-only debt delivery: early/due/catch-up, duplicate suppression, settled/deleted/restricted, safe retry, uncertain delivery and cron authentication passed",
)
