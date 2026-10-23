import {tashkentDay} from '../../shared/reminderPolicy.js';
import { parseSafeDate } from "../_uzbekFinancialNormalizer.js"
import { createHash } from "node:crypto"
import { supabase } from "../_supabaseClient.js"
import { eligibleUser } from "../_userPolicy.js"
import { parseAssistant } from "../_assistantParser.js"
import {
  assistantActionIssue,
  normalizeAssistantReply,
} from "../../shared/assistant.js"
import { cleanPlannedPayments } from "../../shared/plannedPayments.js"
import { updateProfileSnapshot } from "./_profileWriteService.js"
import { saveBotMessageTransactions } from "./_botDraftService.js"
const escape = (s: unknown) =>
  String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
async function userFor(id: string) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error || !eligibleUser(data)) throw Error("ACCOUNT_NOT_ELIGIBLE")
  return data
}
export async function botAssistant(
  userId: string,
  chatId: number | string,
  messageId: number,
  input: { text?: string; audio?: Buffer },
  appUrl: string,
) {
  const user = await userFor(userId)
  const previous = user.onboarding?.assistant_pending
  const history =
    previous?.waiting && previous.expires > Date.now() ? previous.history : []
  const id = createHash("sha256")
    .update(`assistant:${userId}:${chatId}:${messageId}`)
    .digest("hex")
    .slice(0, 32)
  const reply =
    previous?.id === id && previous.expires > Date.now()
      ? normalizeAssistantReply(previous.reply)
      : await parseAssistant({ ...input, history }, user)
  const labels: Record<string, string> = {
    expense: "Xarajat",
    income: "Daromad",
    debt: "Qarz oldim",
    lending: "Qarz berdim",
    payment: "Rejali to‘lov",
    repayment: "Qarz qaytarish",
  }
  const typeIcons: Record<string, string> = {
    expense: "💸",
    income: "💰",
    debt: "📥",
    lending: "📤",
    payment: "🗓",
    repayment: "🔄",
  }
  const catIcons: Record<string, string> = {
    "Oziq-ovqat": "🍔",
    Transport: "🚕",
    Kiyim: "👕",
    Kommunal: "💡",
    "Sog'liq": "💊",
    "Ta'lim": "📚",
    "Ko'ngil ochar": "🎮",
    Maosh: "💼",
    Freelance: "💻",
    Biznes: "📈",
    "Sovg'a": "🎁",
    Investitsiya: "📊",
    Boshqa: "📦",
  }
  const preview = reply.actions
    .map(
      (a) =>
        `${typeIcons[a.kind] || "📌"} ${labels[a.kind]}: ${a.title.slice(0, 40)} — ${a.amount ?? "?"} ${a.currency}${
          a.kind === "payment"
            ? ` · ${
                a.repeat === "monthly"
                  ? "har oy"
                  : a.repeat === "weekly"
                    ? "har hafta"
                    : "bir marta"
              } · ${a.date || "sana kerak"}`
            : ""
        }`,
    )
    .join("\n")
  const complete =
    reply.actions.length > 0 &&
    !reply.question &&
    reply.actions.every((a) => !assistantActionIssue(a))
  if (
    complete &&
    reply.actions.every((a) =>
      ["expense", "income", "debt", "lending"].includes(a.kind),
    )
  ) {
    const staged = await saveBotMessageTransactions(
      userId,
      chatId,
      messageId,
      reply.actions.map((a) => ({
        type: a.kind,
        amount: a.amount,
        category: a.category,
        note: a.note || reply.transcription || a.title,
        title: a.title,
        ...parseSafeDate(a.date),
        ...(a.time?{time:a.time}:{}),
        cardId: a.cardId || "cash",
        ...(["debt", "lending"].includes(a.kind)
          ? {
              debtWho: a.person,
              debtPersonId: "person_" + id + "_" + reply.actions.indexOf(a),
              debtDueDate: a.dueDate,
              debtDateConfirmed: true,
            }
          : {}),
      })),
    )
    // Clear only the conversation that produced this draft; profile conflicts remain visible.
    if (previous) {
      try{
        const fresh = await userFor(userId);
        await updateProfileSnapshot(userId, fresh, {onboarding: {...fresh.onboarding,assistant_pending:null}});
      }catch{/* The financial write has already committed. */}
    }
    const savedId=staged.transactions?.[0]?.id;
    const link=new URL(appUrl);if(savedId)link.searchParams.set('editTransaction',savedId);
    const saved=staged.transactions?.[0];
    const catName=saved?.category || 'Boshqa';
    const catEmoji=catIcons[catName] || '🏷';
    const kindEmoji=typeIcons[saved?.type] || '💸';
    const noteText=String(saved?.title || saved?.note || '').slice(0,140);
    const loanLine=(saved?.type==='debt'||saved?.type==='lending')&&saved?.debtWho
      ? `\n🤝 <b>${escape(saved.debtWho)}</b>${saved.debtDueDate ? ` · ⏳ ${escape(saved.debtDueDate)}` : ''}`
      : '';
    const receipt=staged.replayed ? '✅ <b>Bu xabar avval saqlangan.</b>' : saved ?
      `✅ <b>Muvaffaqiyatli saqlandi!</b>\n<blockquote>${kindEmoji} <b>${Math.abs(Number(saved.amount)).toLocaleString('uz-UZ')} so‘m</b> · ${catEmoji} ${escape(catName)}\n📝 ${escape(noteText)}${loanLine}\n📅 ${escape(saved.date || '')}${saved.time?' · ⏰ '+escape(saved.time):''}</blockquote>` : '✅ <b>Saqlandi!</b>';
    return {text:receipt,keyboard:{inline_keyboard:[[{text:'✏️ Tahrirlash',web_app:{url:link.href}},{text:'🌐 Web',url:link.href}]]}};
  }
  if(complete && reply.actions.every(a=>a.kind==='payment')){
    const applyPlan = async (snap: any) => {
      const plans=cleanPlannedPayments(snap.onboarding?.planned_payments);
      const a=reply.actions[0],planId=`assistant_${id}_0`;
      if(!plans.some(p=>p.id===planId)){
        if(plans.length>=100)throw Error('PLAN_LIMIT');
        plans.push({id:planId,title:a.title,amount:a.amount!,dueDate:a.date!,time:a.time||undefined,icon:a.icon,repeat:a.repeat,anchorDay:Number(a.date!.slice(8)),createdDay:tashkentDay(new Date())});
      }
      await updateProfileSnapshot(userId,snap,{onboarding:{...snap.onboarding,planned_payments:plans,assistant_pending:null}});
      return a;
    };
    let a;
    try { a = await applyPlan(user); } catch (err: any) {
      if (err?.message === 'PROFILE_CHANGED') a = await applyPlan(await userFor(userId));
      else throw err;
    }
    const planId=`assistant_${id}_0`;
    const link=new URL(appUrl);link.searchParams.set('paymentId',planId);
    return {text:`🗓 <b>Reja saqlandi!</b>\n<blockquote>📌 <b>${escape(a.title)}</b> — <b>${a.amount} so‘m</b>\n📅 ${a.date}${a.time?' · ⏰ '+a.time:''} · 🔔 Eslataman</blockquote>`,keyboard:{inline_keyboard:[[{text:'📱 Rejani ochish',web_app:{url:link.href}},{text:'🌐 Web',url:link.href}]]}};
  }

  const pending = {
    id,
    reply,
    history: [
      ...(history || []),
      { role: "user", content: input.text || reply.transcription },
      { role: "assistant", content: JSON.stringify(reply) },
    ].slice(-8),
    waiting: !!reply.question,
    expires: Date.now() + 30 * 60 * 1000,
  }
  try {
    await updateProfileSnapshot(userId, user, {
      onboarding: { ...user.onboarding, assistant_pending: pending },
    })
  } catch (err: any) {
    if (err?.message === "PROFILE_CHANGED") {
      const fresh = await userFor(userId)
      await updateProfileSnapshot(userId, fresh, {
        onboarding: { ...fresh.onboarding, assistant_pending: pending },
      })
    } else throw err
  }
  const link = new URL(appUrl)
  link.searchParams.set("assistant", id)
  const buttons: any[][] = []
  if (complete && reply.actions.every((a) => a.kind === "payment"))
    buttons.push([
      { text: "✅ Rejani saqlash", callback_data: "asok_" + id },
      { text: "❌ Bekor qilish", callback_data: "asno_" + id },
    ])
  if (reply.actions.length)
    buttons.push(
      [
        {
          text: "📱 Tekshirish va tahrirlash",
          web_app: { url: link.toString() },
        },
      ],
      [{ text: "🌐 Webda ochish", url: link.toString() }],
    )
  const rawMsg = /saqla(?:dim|ndi|b)|kirit(?:dim|ildi)|yozib\s+qo|qayd\s+(?:qil|et)|\b(?:saved|recorded|logged)\b|сохран|записал/i.test(reply.message)
    ? '⚠️ Hozircha hech narsa saqlanmadi.'
    : reply.message ? `💬 ${reply.message}` : '';
  const questionLine = reply.question || (reply.actions.length ? reply.actions.map(assistantActionIssue).find(Boolean) : "");
  const message = [
    rawMsg,
    preview ? `📋 ${preview}` : "",
    questionLine ? `❓ ${questionLine}` : "",
    reply.actions.some((a) => a.currency !== "UZS")
      ? "💱 Valyuta kursini ilovada kiriting va tasdiqlang."
      : reply.actions.some((a) => a.kind === "repayment")
        ? "🤝 Qarzni ilovada tekshiring va tasdiqlang."
        : "",
  ]
    .filter(Boolean)
    .join("\n\n")
  return {
    text: escape(message || "💬 Nimani qayd qilmoqchisiz?"),
    keyboard: buttons.length ? { inline_keyboard: buttons } : undefined,
  }
}
export async function resolveAssistantPlan(
  userId: string,
  id: string,
  confirm: boolean,
) {
  const user = await userFor(userId),
    pending = user.onboarding?.assistant_pending
  if (!pending || pending.id !== id || pending.expires < Date.now())
    return "Yozuv eskirgan yoki avval tasdiqlangan."
  let plans = cleanPlannedPayments(user.onboarding?.planned_payments)
  if (confirm) {
    const reply = normalizeAssistantReply(pending.reply)
    if (
      !reply.actions.length ||
      reply.question ||
      reply.actions.some((a) => a.kind !== "payment" || assistantActionIssue(a))
    )
      throw Error("INVALID_PLAN_DRAFT")
    reply.actions.forEach((a, i) => {
      const planId = `assistant_${id}_${i}`
      if (!plans.some((p) => p.id === planId))
        plans.push({
          id: planId,
          title: a.title,
          amount: a.amount!,
          dueDate: a.date!,
          repeat: a.repeat,
          time:a.time||undefined,icon:a.icon,createdDay:tashkentDay(new Date()),
          anchorDay: Number(a.date!.slice(8)),
        })
    })
    if (plans.length > 100) throw Error("PLAN_LIMIT")
  }
  await updateProfileSnapshot(userId, user, {
    onboarding: {
      ...user.onboarding,
      planned_payments: plans,
      assistant_pending: null,
    },
  })
  return confirm
    ? "✅ Reja saqlandi. Balansdan pul yechilmadi."
    : "❌ Bekor qilindi."
}
