/**
 * _financialReportEngine.ts — Deterministic Financial Analysis & AI Advisory Engine
 * 
 * 1. Mathematically calculates income, expenses, category breakdown, top expenses,
 *    savings rate, and daily averages in deterministic code (NO MATH HALLUCINATION).
 * 2. Prompts Google Gemini (via _aiRouter) to interpret the facts and produce 3-5
 *    high-quality, actionable financial recommendations in natural Uzbek.
 * 3. Persists generated reports in Supabase with duplicate prevention.
 */

import { executeAiQuery } from './_aiRouter.js';
import { supabase } from './_supabaseClient.js';

export interface ReportMetrics {
  totalIncome: number;
  totalExpense: number;
  netBalance: number;
  savingsRate: number; // percentage (e.g. 25%)
  avgDailyExpense: number;
  transactionCount: number;
  incomeCount: number;
  expenseCount: number;
  topCategories: Array<{ category: string; amount: number; percentage: number }>;
  largestExpenses: Array<{ id: string | number; note: string; category: string; amount: number; date: string }>;
  currency: string;
}

export interface GeneratedFinancialReport {
  id: string;
  userId: string;
  userName: string;
  type: 'weekly' | 'monthly';
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  generatedAt: string;
  metrics: ReportMetrics;
  aiAnalysis: {
    summary: string;
    recommendations: string[];
    keyTip: string;
    rawText: string;
  };
  sentToTelegram?: boolean;
}

/**
 * Format currency nicely in Uzbek so'm
 */
export function formatUzbekCurrency(amount: number): string {
  return `${Math.round(amount).toLocaleString('uz-UZ')} so'm`;
}

/**
 * Calculate deterministic financial metrics from user transactions
 */
export function calculateFinancialMetrics(
  transactions: any[],
  startDate: Date,
  endDate: Date
): ReportMetrics {
  const startMs = startDate.getTime();
  const endMs = endDate.getTime();

  let totalIncome = 0;
  let totalExpense = 0;
  let incomeCount = 0;
  let expenseCount = 0;

  const categoryMap = new Map<string, number>();
  const expenseList: Array<{ id: string | number; note: string; category: string; amount: number; date: string }> = [];

  for (const tx of transactions) {
    if (!tx || !tx.date) continue;
    const txDate = new Date(tx.date);
    const txMs = txDate.getTime();
    if (isNaN(txMs) || txMs < startMs || txMs > endMs) continue;

    const amount = Math.abs(Number(tx.amount) || 0);
    const type = String(tx.type || '').toLowerCase();
    const category = String(tx.category || "Boshqa").trim();
    const note = String(tx.note || tx.title || category).trim();

    if (type === 'income') {
      totalIncome += amount;
      incomeCount++;
    } else {
      // Default to expense
      totalExpense += amount;
      expenseCount++;
      categoryMap.set(category, (categoryMap.get(category) || 0) + amount);
      expenseList.push({
        id: tx.id || Math.random().toString(36).slice(2),
        note,
        category,
        amount,
        date: tx.date
      });
    }
  }

  const netBalance = totalIncome - totalExpense;
  const savingsRate = totalIncome > 0 ? Math.max(0, Math.round(((totalIncome - totalExpense) / totalIncome) * 100)) : 0;

  const daysCount = Math.max(1, Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1);
  const avgDailyExpense = Math.round(totalExpense / daysCount);

  // Sort top categories
  const topCategories = Array.from(categoryMap.entries())
    .map(([category, amount]) => ({
      category,
      amount,
      percentage: totalExpense > 0 ? Math.round((amount / totalExpense) * 100) : 0
    }))
    .sort((a, b) => b.amount - a.amount);

  // Top 5 largest expenses
  const largestExpenses = expenseList
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  return {
    totalIncome,
    totalExpense,
    netBalance,
    savingsRate,
    avgDailyExpense,
    transactionCount: incomeCount + expenseCount,
    incomeCount,
    expenseCount,
    topCategories,
    largestExpenses,
    currency: "so'm"
  };
}

/**
 * Prompt Gemini to interpret pre-calculated facts and generate 3-5 Uzbek recommendations
 */
export async function generateAiFinancialAdvice(
  userName: string,
  type: 'weekly' | 'monthly',
  periodLabel: string,
  metrics: ReportMetrics
): Promise<{ summary: string; recommendations: string[]; keyTip: string; rawText: string }> {
  // Format deterministic data payload for the AI
  const factsJson = {
    userName,
    reportType: type === 'weekly' ? 'Haftalik moliyaviy tahlil' : 'Oylik moliyaviy tahlil',
    period: periodLabel,
    totalIncome: `${formatUzbekCurrency(metrics.totalIncome)} (${metrics.incomeCount} ta daromad)`,
    totalExpense: `${formatUzbekCurrency(metrics.totalExpense)} (${metrics.expenseCount} ta xarajat)`,
    netBalance: `${formatUzbekCurrency(metrics.netBalance)} (${metrics.netBalance >= 0 ? 'Foyda / Jamg\'arma' : 'Kechikish / Kamomad'})`,
    savingsRate: `${metrics.savingsRate}%`,
    avgDailyExpense: formatUzbekCurrency(metrics.avgDailyExpense),
    topCategories: metrics.topCategories.slice(0, 6).map(c => `${c.category}: ${formatUzbekCurrency(c.amount)} (${c.percentage}%)`),
    largestExpenses: metrics.largestExpenses.map(e => `${e.note} (${e.category}): ${formatUzbekCurrency(e.amount)}`)
  };

  const systemInstruction = `Siz Moliya AI ning professional va samimiy moliyaviy tahlilchisiz.
Quyidagi barcha moliyaviy raqamlar server tomonidan hisoblangan va 100% aniq.
Sizning vazifangiz: Hech qanday raqamlarni O'ZGARTIRMASDAN yoki O'ZINGIZDAN TO'QIMASDAN, faqat shu faktlar asosida o'zbek tilida (lotin alifbosida) yuqori darajadagi tushunarli tahlil va 3-5 ta amaliy maslahat berish.

Javobni aniq JSON formatida qaytaring:
{
  "summary": "1 ta yoki 2 ta jumla bilan davr xulosasi (samimiy va ruhlantiruvchi)",
  "recommendations": [
    "1-amaliy tavsiya (masalan, eng katta xarajat kategoriyasini optimallashtirish bo'yicha)",
    "2-amaliy tavsiya (jamg'arma yoki kunlik o'rtacha xarajat bo'yicha)",
    "3-amaliy tavsiya (keyingi hafta/oy byudjetini rejalashtirish bo'yicha)"
  ],
  "keyTip": "Bitta muhim oltin moliyaviy qoida yoki maslahat"
}`;

  const userPrompt = `Foydalanuvchi ma'lumotlari va hisoblangan faktlar:
${JSON.stringify(factsJson, null, 2)}

Iltimos, yuqoridagi faktlar asosida JSON formatida tahlil va maslahatlarni bering.`;

  try {
    const aiResponse = await executeAiQuery(userPrompt, systemInstruction, {
      temperature: 0.3,
      response_mime_type: "application/json"
    });

    const rawText = aiResponse?.text || '';
    let parsed: any = null;

    try {
      // Clean possible markdown code fences
      const cleanJson = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      parsed = JSON.parse(cleanJson);
    } catch {
      // Fallback parser if JSON was slightly malformed
      parsed = {
        summary: `Sizning ${periodLabel} bo'yicha umumiy xarajatlaringiz ${formatUzbekCurrency(metrics.totalExpense)} ni tashkil qildi.`,
        recommendations: [
          `Eng katta xarajatlaringiz (${metrics.topCategories[0]?.category || 'asosiy xarajatlar'}) bo'yicha kundalik limit belgilang.`,
          `Kunlik o'rtacha sarf-xarajatingiz ${formatUzbekCurrency(metrics.avgDailyExpense)} ni tashkil qilmoqda, buni 10-15% ga tejash mumkin.`,
          `Kelgusi davr uchun daromadlaringizdan kamida 10-20% jamg'arma ajratishni rejalashtiring.`
        ],
        keyTip: `Kichik xarajatlar ham oy oxirida katta summaga aylanadi. Har bir xarajatni qayd etib boring!`
      };
    }

    return {
      summary: parsed.summary || "Moliyaviy ko'rsatkichlaringiz hisoblandi.",
      recommendations: Array.isArray(parsed.recommendations) && parsed.recommendations.length > 0
        ? parsed.recommendations
        : ["Xarajatlarni toifalarga bo'lib nazorat qilishni davom eting."],
      keyTip: parsed.keyTip || "Moliyaviy intizom — barqarorlik garovidir.",
      rawText
    };
  } catch (err: any) {
    console.error('[REPORT ENGINE] AI generation failed, using rule-based fallback:', err?.message);
    return {
      summary: `${periodLabel} davomida jami ${formatUzbekCurrency(metrics.totalExpense)} xarajat va ${formatUzbekCurrency(metrics.totalIncome)} daromad qayd etildi.`,
      recommendations: [
        metrics.topCategories.length > 0
          ? `Asosiy xarajat qismi "${metrics.topCategories[0].category}" (${metrics.topCategories[0].percentage}%) sohasiga to'g'ri keldi. Bu yo'nalishda me'yorni belgilang.`
          : `Xarajatlaringizni toifalarga bo'lib yuritishni tavsiya etamiz.`,
        `Kunlik o'rtacha xarajatingiz ${formatUzbekCurrency(metrics.avgDailyExpense)} bo'ldi.`,
        metrics.netBalance >= 0
          ? `Sizda ${formatUzbekCurrency(metrics.netBalance)} ijobiy qoldiq mavjud. Buni xavfsizlik yostig'iga yo'naltiring.`
          : `Xarajatlaringiz daromaddan oshdi, kelasi haftada rejalashtirilmagan xaridlarni cheklang.`
      ],
      keyTip: `Moliyaviy erkinlik daromad miqdorida emas, balki sarf-xarajat intizomidadir!`,
      rawText: 'Fallback rule-based generation'
    };
  }
}

/**
 * Format report into clean HTML for Telegram message
 */
export function formatReportForTelegram(report: GeneratedFinancialReport): string {
  const m = report.metrics;
  const isPositive = m.netBalance >= 0;
  const balanceEmoji = isPositive ? '📈' : '📉';
  const miniAppTelegramUrl = process.env.TELEGRAM_MINI_APP_URL || 'https://t.me/moliya_ai_bot/app';

  let text = `📊 <b>Moliya AI — ${report.periodLabel}</b>\n`;
  text += `👤 <b>Foydalanuvchi:</b> ${report.userName}\n\n`;

  text += `<blockquote>`;
  text += `💰 <b>Daromad:</b> ${formatUzbekCurrency(m.totalIncome)}\n`;
  text += `💸 <b>Xarajat:</b> ${formatUzbekCurrency(m.totalExpense)}\n`;
  text += `${balanceEmoji} <b>Sof qoldiq:</b> ${m.netBalance > 0 ? '+' : ''}${formatUzbekCurrency(m.netBalance)}\n`;
  if (m.totalIncome > 0) {
    text += `💎 <b>Jamg'arma darajasi:</b> ${m.savingsRate}%\n`;
  }
  text += `📅 <b>Kunlik o'rtacha xarajat:</b> ${formatUzbekCurrency(m.avgDailyExpense)}`;
  text += `</blockquote>\n\n`;

  if (m.topCategories.length > 0) {
    text += `🏷️ <b>Asosiy xarajat toifalari:</b>\n`;
    text += `<blockquote>`;
    m.topCategories.slice(0, 4).forEach((c, idx) => {
      text += `${idx + 1}. ${c.category}: <b>${formatUzbekCurrency(c.amount)}</b> (${c.percentage}%)\n`;
    });
    text += `</blockquote>\n\n`;
  }

  text += `💡 <b>AI Moliyaviy Xulosa:</b>\n`;
  text += `<blockquote>${report.aiAnalysis.summary}</blockquote>\n\n`;

  if (report.aiAnalysis.recommendations && report.aiAnalysis.recommendations.length > 0) {
    text += `🎯 <b>Amaliy Tavsiyalar:</b>\n`;
    text += `<blockquote expandable>`;
    report.aiAnalysis.recommendations.forEach((rec, idx) => {
      text += `${idx + 1}. ${rec}\n`;
    });
    text += `</blockquote>\n\n`;
  }

  if (report.aiAnalysis.keyTip) {
    text += `✨ <b>Oltin Maslahat:</b>\n`;
    text += `<blockquote>💡 <i>"${report.aiAnalysis.keyTip}"</i></blockquote>\n\n`;
  }

  text += `📱 <b>Moliya Mini App:</b> <i>Barcha daromad, xarajat, qarzlar va grafiklar 1 ta qulay ekranda!</i>\n`;
  text += `👉 <a href="${miniAppTelegramUrl}">Mini Appda to'liq hisobotni ochish</a>`;

  return text;
}

/**
 * Main function: generate report for a user, save to DB, and optionally send to Telegram
 */
export async function generateAndSaveUserReport(
  userId: string,
  type: 'weekly' | 'monthly',
  options?: {
    force?: boolean;
    sendTelegram?: boolean;
    startDate?: string;
    endDate?: string;
  }
): Promise<{ success: boolean; report?: GeneratedFinancialReport; error?: string; alreadyExisted?: boolean }> {
  try {
    // 1. Fetch user data
    const { data: user, error: fetchErr } = await supabase
      .from('users')
      .select('id, name, telegram, telegram_id, transactions, onboarding')
      .eq('id', userId)
      .maybeSingle();

    if (fetchErr || !user) {
      return { success: false, error: fetchErr?.message || 'User not found' };
    }

    const userName = user.name || user.onboarding?.name || user.telegram || 'Foydalanuvchi';
    const now = new Date();

    let startDate: Date;
    let endDate: Date;
    let periodLabel: string;

    if (options?.startDate && options?.endDate) {
      startDate = new Date(options.startDate);
      endDate = new Date(options.endDate);
      periodLabel = `${type === 'weekly' ? 'Haftalik' : 'Oylik'} hisobot (${startDate.toLocaleDateString('uz-UZ')} - ${endDate.toLocaleDateString('uz-UZ')})`;
    } else if (type === 'weekly') {
      // Past 7 days
      endDate = new Date(now);
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      periodLabel = `Haftalik moliyaviy hisobot (${startDate.toLocaleDateString('uz-UZ')} - ${endDate.toLocaleDateString('uz-UZ')})`;
    } else {
      // Past 30 days
      endDate = new Date(now);
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      periodLabel = `Oylik moliyaviy hisobot (${startDate.toLocaleDateString('uz-UZ')} - ${endDate.toLocaleDateString('uz-UZ')})`;
    }

    // 2. Duplicate prevention check
    const existingReports: GeneratedFinancialReport[] = Array.isArray(user.onboarding?.ai_reports)
      ? user.onboarding.ai_reports
      : [];

    const periodStartIso = startDate.toISOString().slice(0, 10);
    const periodEndIso = endDate.toISOString().slice(0, 10);

    if (!options?.force) {
      const recentMatch = existingReports.find(
        r => r.type === type &&
          r.periodStart.slice(0, 10) === periodStartIso &&
          r.periodEnd.slice(0, 10) === periodEndIso
      );
      if (recentMatch) {
        return { success: true, report: recentMatch, alreadyExisted: true };
      }
    }

    // 3. Compute deterministic metrics
    const txList = Array.isArray(user.transactions) ? user.transactions : [];
    const metrics = calculateFinancialMetrics(txList, startDate, endDate);

    // 4. Generate AI Advice
    const aiAnalysis = await generateAiFinancialAdvice(userName, type, periodLabel, metrics);

    // 5. Construct report object
    const report: GeneratedFinancialReport = {
      id: `rep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      userId,
      userName,
      type,
      periodStart: startDate.toISOString(),
      periodEnd: endDate.toISOString(),
      periodLabel,
      generatedAt: new Date().toISOString(),
      metrics,
      aiAnalysis
    };

    // 6. Optional Telegram delivery
    if (options?.sendTelegram) {
      const token = process.env.TELEGRAM_BOT_TOKEN || '8955141731:AAGILXzT69Vity8ZFi-H8XeZc_H6_BFaS8Y';
      const tgId = user.telegram_id || user.onboarding?.telegramId || (userId.startsWith('moliya_user_tg_') ? userId.replace('moliya_user_tg_', '') : null);

      if (token && tgId && tgId !== '—') {
        const messageHtml = formatReportForTelegram(report);
        const appUrl = process.env.APP_URL || 'https://moliya-ai-pi.vercel.app';
        try {
          const sendRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: String(tgId),
              text: messageHtml,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: "📊 To'liq hisobotni Mini Appda ko'rish", web_app: { url: appUrl } }]
                ]
              }
            })
          });
          const sendData = await sendRes.json();
          if (sendData.ok) {
            report.sentToTelegram = true;
          }
        } catch (e: any) {
          console.warn('[REPORT ENGINE] Telegram delivery failed:', e?.message);
        }
      }
    }

    // 7. Persist to Supabase
    // A) Store in user's onboarding.ai_reports array (keep latest 20)
    const updatedReports = [report, ...existingReports.filter(r => r.id !== report.id)].slice(0, 20);
    const updatedOnboarding = {
      ...(user.onboarding || {}),
      ai_reports: updatedReports,
      last_report_generated_at: new Date().toISOString()
    };

    await supabase
      .from('users')
      .update({
        onboarding: updatedOnboarding,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    return { success: true, report };
  } catch (err: any) {
    console.error('[REPORT ENGINE] Error generating financial report:', err);
    return { success: false, error: err?.message || 'Failed to generate report' };
  }
}
