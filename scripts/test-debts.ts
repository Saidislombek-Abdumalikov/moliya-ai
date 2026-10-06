import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { PGlite } from "@electric-sql/pglite"
import {
  debtRemaining,
  reminderKind,
  debtDueFromText,
  debtPrincipalText,
  dueDebts,
  personKey,
} from "../shared/debts.js"
import { financialTotals, financialKind } from "../shared/financialTotals.js"
const loan = {
  id: "loan",
  type: "debt",
  amount: 100000,
  date: "2026-10-01",
  debtDueDate: "2026-10-08",
  debtWho: "Ali",
}
assert.equal(reminderKind(loan, "2026-10-05"), "early")
for (const n of [1, 2, 3])
  assert.equal(
    reminderKind({ ...loan, date: `2026-10-0${8 - n}` }, "2026-10-05"),
    null,
  )
assert.equal(reminderKind(loan, "2026-10-08"), "due")
assert.equal(
  debtDueFromText("Alidan qarz oldim, ertaga qaytaraman", "2026-10-05"),
  "2026-10-06",
)
assert.equal(debtDueFromText("indin qaytaraman", "2026-10-05"), "2026-10-07")
assert.equal(
  debtDueFromText("bir oydan keyin qaytaraman", "2026-01-31"),
  "2026-02-28",
)
assert.equal(debtDueFromText("hali kelishilmagan", "2026-10-05"), null)
assert.equal(
  debtPrincipalText("Alidan 100 ming qarz oldim, ertaga qaytaraman"),
  "Alidan 100 ming qarz oldim",
)
const multiple =
  "Alidan 100 ming qarz oldim, 20 ming ishlatdim, ertaga qaytaraman"
assert.equal(debtPrincipalText(multiple), multiple)
assert.notEqual(personKey(loan), personKey({ ...loan, id: "other" }))
const payment = {
  id: "pay_12345678901",
  type: "expense",
  amount: -40000,
  debtPaymentFor: "loan",
}
assert.equal(debtRemaining(loan, [loan, payment]), 60000)
assert.equal(financialTotals([loan, payment]).cashFlow, 60000)
assert.equal(financialTotals([loan, payment]).expense, 0)
assert.equal(financialKind(payment), null)
assert.equal(
  dueDebts([loan, { ...payment, amount: -100000 }], "2026-10-08").length,
  0,
)
assert.equal(
  dueDebts([{ ...loan, debtDismissed: "2026-10-08:2026-10-08" }], "2026-10-08")
    .length,
  0,
)
const db = new PGlite()
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE public.users(id text PRIMARY KEY, telegram_id text, phone text, onboarding jsonb DEFAULT '{}', device_info jsonb DEFAULT '{}', bot_verification jsonb, is_blocked boolean DEFAULT false, is_restricted boolean DEFAULT false, is_deleted boolean DEFAULT false, account_status text, transactions jsonb DEFAULT '[]',cards jsonb DEFAULT '[]',updated_at timestamptz);`)
for (const file of [
  "03-financial-writes",
  "04-atomic-card-operations",
  "06-financial-eligibility",
  "07-session-financial-writes",
  "08-destructive-user-actions",
  "17-debts",
  "19-debt-relationships",
  "21-repayment-details",
]) {
  const sql = await readFile(
    new URL("../migrations/" + file + ".sql", import.meta.url),
    "utf8",
  )
  await db.exec(sql)
  if (file === "17-debts") await db.exec(sql)
}
const uid = "moliya_user_tg_123",
  token = "sess_" + "a".repeat(48)
await db.query(
  "INSERT INTO users(id,telegram_id,phone,bot_verification,onboarding,transactions) VALUES ($1,$2,$3,$4,$5,$6)",
  [
    uid,
    "123",
    "+998901234567",
    JSON.stringify({
      telegram_id: "123",
      phone: "+998901234567",
      phone_source: "telegram_own_contact",
      phone_verified_at: "2026-01-01",
      consent_source: "telegram_button",
      consent_version: "1",
      consent_accepted_at: "2026-01-01",
    }),
    JSON.stringify({ session_token: token, session_expires_at: "2099-01-01" }),
    JSON.stringify([loan]),
  ],
)
const action = async (
  op: string,
  payload: any,
  expected: any = loan,
  credential = token,
) =>
  (
    await db.query<any>(
      "SELECT public.moliya_debt_action($1,$2,$3,$4,$5::jsonb,$6::jsonb) AS r",
      [
        uid,
        credential,
        "loan",
        op,
        JSON.stringify(payload),
        JSON.stringify(expected),
      ],
    )
  ).rows[0].r
const write = async (op: string, payload: any, expected: any = null) =>
  (
    await db.query<any>(
      "SELECT public.moliya_financial_write($1,$2,$3::jsonb,$4::jsonb) AS r",
      [uid, op, JSON.stringify(payload), JSON.stringify(expected)],
    )
  ).rows[0].r
assert.equal(
  (await action("pay", { amount: 40000, paymentId: payment.id }, loan, "wrong"))
    .success,
  false,
)
let paid = await action("pay", { amount: 40000, paymentId: payment.id })
assert.equal(paid.success, true)
assert.equal(debtRemaining(loan, paid.transactions), 60000)
assert.equal(
  (await action("pay", { amount: 40000, paymentId: payment.id })).transactions
    .length,
  2,
)
assert.equal(
  (await action("pay", { amount: 50000, paymentId: payment.id })).statusCode,
  409,
)
assert.equal(
  (await action("pay", { amount: 60001, paymentId: "pay_overpayment1" }))
    .success,
  false,
)
assert.equal(
  (await action("pay", { amount: -1, paymentId: "pay_negative001" })).success,
  false,
)
for (const op of ["put_transaction", "append_transactions"])
  assert.equal(
    (await write(op, op === "append_transactions" ? [payment] : payment)).code,
    "USE_DEBT_ACTION",
  )
assert.equal(
  (await write("save_cards_atomic", { cards: [], transactions: [payment] }, {}))
    .code,
  "USE_DEBT_ACTION",
)
assert.equal(
  (await write("delete_transaction", { id: "loan" }, loan)).code,
  "DEBT_HAS_PAYMENTS",
)
assert.equal(
  (await write("put_transaction", { ...loan, amount: 1 }, loan)).code,
  "DEBT_HAS_PAYMENTS",
)
const results = await Promise.all([
  action("pay", { amount: 60000, paymentId: "pay_concurrent01" }),
  action("pay", { amount: 60000, paymentId: "pay_concurrent02" }),
])
assert.equal(results.filter((r) => r.success).length, 1)
assert.equal(
  (
    await action("edit", {
      dueDate: "2026-02-30",
      personName: "Ali",
      personId: "ali",
    })
  ).success,
  false,
)
assert.equal((await action('edit',{dueDate:null,personName:'Ali',personId:'ali',relationship:'invalid'})).success,false);
const edit = await action("edit", {
  dueDate: "2026-10-10",
  personName: "Ali",
  personId: "ali",
  relationship: "friend",
})
assert.equal(edit.success, true)
assert.equal(edit.transactions.find((t:any)=>t.id==='loan').debtRelationship,'friend')
assert.equal(
  (await action("edit", { dueDate: null, personName: "Ali", personId: "ali" }))
    .statusCode,
  409,
)
const current = edit.transactions.find((t: any) => t.id === "loan")
assert.equal(
  (
    await action(
      "edit",
      { dueDate: null, personName: "Ali", personId: "ali" },
      current,
    )
  ).success,
  true,
)
for (const role of ["anon", "authenticated"]) {
  await db.exec("SET ROLE " + role)
  await assert.rejects(action("pay", {}), /permission denied/)
  await db.exec("RESET ROLE")
}
await db.query('UPDATE users SET transactions=$1,cards=$2',[JSON.stringify([loan]),JSON.stringify([{id:'card-test'}])]);
const dated=await action('pay',{paymentId:'pay_dated_payment_123',amount:100,date:'2026-09-30',cardId:'card-test'});
assert.equal(dated.success,true);
const datedPayment=dated.transactions.find((t:any)=>t.id==='pay_dated_payment_123');
assert.equal(datedPayment.date,'2026-09-30');assert.equal(datedPayment.day,30);assert.equal(datedPayment.month,9);assert.equal(datedPayment.cardId,'card-test');
assert.equal((await action('pay',{paymentId:'pay_invalid_card_123',amount:100,cardId:'foreign-card'})).success,false);
assert.equal((await action('pay',{paymentId:'pay_invalid_date_123',amount:100,date:'2026-02-30'})).success,false);
await db.exec("UPDATE users SET is_blocked=true")
assert.equal((await action("pay", {})).success, false)
await db.close()
console.log(
  "Debt dates, cashflow, repayment concurrency, idempotency, session restrictions and migration replay: passed",
)
