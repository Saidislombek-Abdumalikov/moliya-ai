import assert from "node:assert/strict"
import {
  normalizeAssistantReply,
  assistantActionIssue,
  actionAmount,
  cleanCategoryPreferences,
} from "../shared/assistant.js"
process.env.SUPABASE_URL = "http://127.0.0.1:54321"
process.env.SUPABASE_SERVICE_ROLE_KEY = "offline"
const { supabase } = await import("../api/_supabaseClient.js")
const { invalidateAiKeysCache } = await import("../api/_aiRouter.js")
const { default: handler } = await import("../api/parse-expense.js")
const { botAssistant, resolveAssistantPlan } = await import(
  "../api/services/_botAssistantService.js"
)
const { safePreferences, publicOnboarding } = await import(
  "../api/_userPolicy.js"
)
const token = "sess_" + "a".repeat(48),
  uid = "moliya_user_tg_123"
const seed = () => ({
  id: uid,
  telegram_id: "123",
  phone: "+998901234567",
  language: "uz",
  transactions: [],
  cards: [],
  onboarding: { session_token: token, session_expires_at: "2099-01-01" },
  device_info: {},
  bot_verification: {
    telegram_id: "123",
    phone: "+998901234567",
    phone_source: "telegram_own_contact",
    phone_verified_at: "2026-01-01",
    consent_source: "telegram_button",
    consent_version: "v1",
    consent_accepted_at: "2026-01-01",
  },
})
let user: any = seed(),
  writes = 0,
  quotaCalls = 0,
  providerCalls = 0,
  providerBodies: any[] = []
const base = {
  kind: "expense",
  amount: 20000,
  currency: "UZS",
  title: "Taksi",
  category: "Transport",
  date: "2026-10-06",
  person: "",
  dueDate: null,
  dueUnknown: false,
  repeat: "none",
  debtId: "",
}
// Missing return dates default to “not agreed”; explicit promises remain intact.
const unknownLoan=normalizeAssistantReply({actions:[{...base,kind:'debt',person:'Ali'}]});
assert.equal(unknownLoan.actions[0].dueUnknown,true);
assert.equal(assistantActionIssue(unknownLoan.actions[0]),null);
const datedLoan=normalizeAssistantReply({actions:[{...base,kind:'lending',person:'Ali',dueDate:'2026-10-08'}]});
assert.equal(datedLoan.actions[0].dueUnknown,false);
assert.equal(datedLoan.actions[0].dueDate,'2026-10-08');
const invalidLoan=normalizeAssistantReply({actions:[{...base,kind:'debt',person:'Ali',dueDate:'invalid'}]});
assert.equal(invalidLoan.actions[0].dueUnknown,false);
assert.match(assistantActionIssue(invalidLoan.actions[0])!,/sanasi/);
for(const reply of [unknownLoan,datedLoan,invalidLoan])assert.deepEqual(normalizeAssistantReply(reply),reply);
const conflictingDate=normalizeAssistantReply({actions:[{...base,kind:'debt',person:'Ali',dueDate:'2026-10-08',dueUnknown:true}]});
assert.equal(conflictingDate.actions[0].dueUnknown,false);
const invalidUnknown=normalizeAssistantReply({actions:[{...base,kind:'debt',person:'Ali',dueDate:'invalid',dueUnknown:true}]});
assert.match(assistantActionIssue(normalizeAssistantReply(invalidUnknown).actions[0])!,/sanasi/);
let modelReply: any = {
  message: "",
  question: "",
  transcription: "",
  actions: [base],
}
;(supabase as any).from = (table: string) => {
  let filters: any[] = [],
    patch: any = null
  const result = () => {
    if (table === "ai_keys")
      return {
        data: [
          {
            id: "test",
            name: "test",
            provider: "google",
            api_key: "offline-key",
            model: "gemini-3.5-flash-lite",
            is_active: true,
          },
        ],
        error: null,
      }
    if (table === "ai_logs") return { data: null, error: null }
    const id = filters.find(([k]) => k === "id")?.[1],
      session = filters.find(([k]) => k === "onboarding->>session_token")?.[1]
    if (id === "system_app_settings" || id?.startsWith("restricted_"))
      return { data: null, error: null }
    if (id !== uid && session !== token) return { data: null, error: null }
    for (const [k, v] of filters) {
      if (
        ["onboarding", "device_info", "bot_verification"].includes(k) &&
        JSON.stringify(user[k]) !== v
      )
        return { data: null, error: null }
    }
    if (patch) {
      writes++
      user = { ...user, ...patch }
    }
    return { data: structuredClone(user), error: null }
  }
  const q: any = {
    select() {
      return q
    },
    like() {
      return q
    },
    eq(k: string, v: any) {
      filters.push([k, v])
      return q
    },
    is(k: string, v: any) {
      filters.push([k, v])
      return q
    },
    update(p: any) {
      patch = p
      return q
    },
    insert() {
      return q
    },
    maybeSingle: async () => result(),
    then(ok: any, bad: any) {
      return Promise.resolve(result()).then(ok, bad)
    },
  }
  return q
}
;(supabase as any).rpc = async (name: string) => {
  assert.equal(name, "moliya_ai_quota")
  quotaCalls++
  return {
    data: {
      allowed: true,
      isPremium: true,
      isTrial: false,
      usedCount: quotaCalls,
      limit: null,
    },
    error: null,
  }
}
globalThis.fetch = async (input: any, options: any) => {
  const req = input instanceof Request ? input : new Request(input, options)
  assert.equal(new URL(req.url).hostname, "generativelanguage.googleapis.com")
  providerCalls++
  providerBodies.push(await req.json())
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: { parts: [{ text: JSON.stringify(modelReply) }] },
          finishReason: "STOP",
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  )
}
let reqId = 0
async function call(body: any, credential = token) {
  const res: any = {
    statusCode: 200,
    setHeader() {},
    status(n: number) {
      this.statusCode = n
      return this
    },
    json(b: any) {
      this.body = b
      return this
    },
    end() {},
  }
  await handler(
    {
      method: "POST",
      headers: {
        authorization: credential ? "Bearer " + credential : "",
        "x-forwarded-for": "offline-" + ++reqId,
      },
      body,
    } as any,
    res,
  )
  return res
}
invalidateAiKeysCache()
modelReply = {
  actions: [
    {
      ...base,
      kind: "debt",
      person: "Ali",
      amount: 100000,
      dueDate: "2026-10-07",
    },
    base,
  ],
  question: "",
  message: "",
}
const multi = await call({
  mode: "assistant",
  text: "Alidan 100 ming oldim, taksiga 20 ming berdim",
})
assert.equal(multi.statusCode, 200)
assert.equal(multi.body.actions.length, 0)
assert.match(multi.body.message, /faqat bitta/)
assert.equal(writes, 0)
assert.equal(providerCalls, 1)
assert.equal(quotaCalls, 1)
modelReply = {
  actions: [
    {
      ...base,
      kind: "payment",
      title: "Wi-Fi",
      amount: 165000,
      repeat: "monthly",
      date: null,
    },
  ],
  question: "Har oyning qaysi sanasida?",
  message: "",
}
const plan = await call({
  mode: "assistant",
  text: "har oy wifi to‘layman 165 ming",
})
assert.equal(plan.body.actions[0].date, null)
assert.match(assistantActionIssue(plan.body.actions[0])!, /sanada/)
modelReply = {
  ...modelReply,
  actions: [{ ...modelReply.actions[0], date: "2026-10-15" }],
  question: "",
}
await call({
  mode: "assistant",
  text: "15-sanada",
  history: [
    { role: "user", content: "har oy wifi 165 ming" },
    { role: "assistant", content: JSON.stringify(plan.body) },
  ],
})
assert.match(JSON.stringify(providerBodies.at(-1)), /har oy wifi 165 ming/)
modelReply = {
  actions: [{ ...base, currency: "USD", amount: 50 }],
  question: "",
  message: "",
}
const dollar = await call({ mode: "assistant", text: "50 dollar ishlatdim" })
assert.equal(dollar.body.actions[0].amount, 50)
assert.equal(actionAmount(dollar.body.actions[0]), null)
assert.equal(
  actionAmount({ ...dollar.body.actions[0], exchangeRate: 12000 }),
  600000,
)
modelReply = {
  actions: [{ ...base, amount: null }],
  question: "Summasi qancha?",
  message: "",
}
const uncertain = await call({ mode: "assistant", text: "nimadir sotib oldim" })
assert.equal(uncertain.statusCode, 200)
assert.equal(uncertain.body.actions[0].amount, null)
assert.match(assistantActionIssue(uncertain.body.actions[0])!, /Summa/)
const before = providerCalls
assert.equal(
  (await call({ mode: "assistant", text: "test" }, "")).statusCode,
  401,
)
assert.equal(
  (
    await call({
      mode: "assistant",
      text: "test",
      userId: "moliya_user_tg_999",
    })
  ).statusCode,
  403,
)
assert.equal(providerCalls, before)
const wav = Buffer.alloc(32)
wav.write("RIFF")
wav.write("WAVE", 8)
modelReply = {
  actions: [base],
  question: "",
  transcription: "taksiga 20 ming",
  message: "",
}
assert.equal(
  (await call({ mode: "assistant", base64Audio: wav.toString("base64") })).body
    .actions[0].amount,
  20000,
)
assert.match(JSON.stringify(providerBodies.at(-1)), /audio\/wav/)
assert.throws(() =>
  normalizeAssistantReply({ actions: [{ kind: "delete_account" }] }),
)
assert.equal(actionAmount({ ...base, amount: -10 } as any), null)
assert.equal(actionAmount({ ...base, amount: 1e15 } as any), null)
assert.deepEqual(
  Object.keys(
    safePreferences({
      voice_auto_send: true,
      is_premium: true,
      assistant_pending: { id: "attacker" },
      category_preferences: [{ phrase: "wifi", category: "Kommunal" }],
    }),
  ).sort(),
  ["category_preferences", "voice_auto_send"],
)
assert.equal(
  cleanCategoryPreferences([{ phrase: " WIFI ", category: "Kommunal" }])[0]
    .phrase,
  "wifi",
)
// Multi-action audio and bot requests never expose a confirmation for any item.
modelReply={actions:[base,{...base,kind:'income',title:'Maosh'}],message:'',question:''};
const audioMulti=await call({mode:'assistant',base64Audio:wav.toString('base64')});
assert.equal(audioMulti.body.actions.length,0);
assert.match(audioMulti.body.message,/faqat bitta/);
const botMulti=await botAssistant(uid,123,17,{text:'taksi 20 ming va maosh 1 million'},'https://example.test');
assert.match(botMulti.text,/faqat bitta/);
assert.doesNotMatch(JSON.stringify(botMulti.keyboard)||'',/txok_|asok_/);
assert.equal(user.transactions.length,0);
assert.equal(user.onboarding.planned_payments,undefined);
// Bot plan staging does not write transactions. Confirmation and replay remain scoped.
modelReply = {
  actions: [
    {
      ...base,
      kind: "payment",
      title: "Wi-Fi",
      amount: 165000,
      date: "2026-10-15",
      repeat: "monthly",
    },
  ],
  question: "",
  message: "",
}
const bot = await botAssistant(
  uid,
  123,
  18,
  { text: "har oy 15 wifi 165 ming" },
  "https://example.test",
)
assert.match(bot.text, /165000/)
assert.equal(user.transactions.length, 0)
assert.equal(user.onboarding.planned_payments.length,1);
assert.equal(user.onboarding.assistant_pending,null);
assert.doesNotMatch(JSON.stringify(bot.keyboard),/asok_|txok_/);
const id=user.onboarding.planned_payments[0].id;
await botAssistant(uid,123,18,{text:'har oy 15 wifi 165 ming'},'https://example.test');
assert.equal(user.onboarding.planned_payments.length,1);
assert.equal(user.transactions.length,0);
user.is_blocked = true
await assert.rejects(
  resolveAssistantPlan(uid, id, true),
  /ACCOUNT_NOT_ELIGIBLE/,
)
console.log(
  "Assistant contract passed: flexible/single-action requests and multi-action rejection, missing amounts/dates, original currency, history, authenticated audio, shared quota, no parser writes, preference isolation, bot plan autosave and replay. Gemini/Telegram were mocked; no live calls.",
)
