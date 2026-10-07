import assert from "node:assert/strict"
import { financialInsight } from "../shared/financialAssistant.js"
import { cleanPlannedPayments, nextPayment, editedPaymentAnchor } from "../shared/plannedPayments.js"
import { registrationTrialEnd } from "../shared/registrationTrial.js"
import { effectiveAccess } from "../api/_accessHelper.js"
import { safePreferences, publicOnboarding } from "../api/_userPolicy.js"
const now = new Date("2026-10-05T20:00:00Z") // Oct 6 in Tashkent
const records = [
  { type: "expense", category: "food", amount: 100, date: "2026-09-30" },
  { type: "expense", category: "food", amount: 200, date: "2026-10-06" },
  { type: "expense", category: "old", amount: 5000, date: "2026-09-29" },
  { type: "expense", category: "future", amount: 9000, date: "2026-10-07" },
]
const insight = financialInsight(records, "en", now, "week")
assert.match(insight, /last 7 days/)
assert.match(insight, /300/)
assert.doesNotMatch(insight, /5 000|9 000/)
assert.match(
  financialInsight(records.slice(2), "en", now, "week"),
  /not enough real records/,
)
const p = {
  id: "rent",
  title: " Rent ",
  amount: 100,
  dueDate: "2026-01-31",
  repeat: "monthly" as const,
}
const [clean] = cleanPlannedPayments([
  p,
  { ...p, id: "bad", amount: -1 },
  { ...p, id: "invalid", dueDate: "2026-02-30" },
  p,
])
assert.equal(clean.title, "Rent")
assert.equal(cleanPlannedPayments([p, p]).length, 1)
assert.equal(nextPayment(clean)?.dueDate, "2026-02-28")
assert.equal(nextPayment(nextPayment(clean)!)?.dueDate, "2026-03-31")
assert.equal(
  nextPayment({ ...clean, repeat: "weekly", dueDate: "2026-12-29" })?.dueDate,
  "2027-01-05",
)
assert.equal(nextPayment({ ...clean, repeat: "none" }), null)
const prefs = safePreferences({
  planned_payments: [p],
  isPremium: true,
  account_created_at: new Date().toISOString(),
  phone: "+998901234567",
})
assert.deepEqual(Object.keys(prefs), ["planned_payments"])
assert.equal(publicOnboarding({ onboarding: prefs }).planned_payments.length, 1)
const created = new Date(Date.now() - 6 * 86400000).toISOString()
assert.equal(
  registrationTrialEnd({ created_at: created }),
  new Date(Date.parse(created) + 7 * 86400000).toISOString(),
)
assert.equal(
  effectiveAccess({ created_at: created, is_trial: false }).level,
  "TRIAL",
)
assert.equal(
  effectiveAccess({
    created_at: new Date(Date.now() - 7 * 86400000 - 1).toISOString(),
  }).level,
  "EXPIRED",
)
assert.equal(
  effectiveAccess({
    created_at: created,
    is_premium: true,
    premium_expires_at: "2099-01-01T00:00:00Z",
  }).level,
  "VIP",
)
assert.equal(registrationTrialEnd({ created_at: "invalid" }), null)
assert.equal(registrationTrialEnd({}), null)
console.log(
  "Passed: Tashkent rolling week, exclusion of old/future records, recurring month-end/year rollover, one-off completion, plan validation, preference privilege stripping, trial expiry and paid VIP preservation.",
)

const february=nextPayment(clean)!;
const edited=cleanPlannedPayments([{...february,title:'Edited rent',anchorDay:editedPaymentAnchor(february,february.dueDate,'monthly')}])[0];
assert.equal(nextPayment(edited)?.dueDate,'2026-03-31');
assert.equal(editedPaymentAnchor(february,'2026-02-20','monthly'),undefined);
assert.equal(editedPaymentAnchor(february,february.dueDate,'weekly'),undefined);
