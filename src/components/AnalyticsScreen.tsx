import { useState } from 'react'
import { motion } from 'motion/react'
import type { OnboardingResult } from './Onboarding'
import { useFinance, baseTransactions } from '../FinanceContext'

interface Props {
  onboarding?: OnboardingResult | null
  onUpdateOnboarding?: (newData: Partial<OnboardingResult>) => void
}

const translations = {
  uz: {
    title: "Tahlil",
    monthLabel: "Iyul 2026",
    income: "Daromad",
    expense: "Xarajat",
    savings: "Qolgan limit",
    debts: "Qarzlar",
    subIncome: "so'm",
    subExpense: "+33% o'tganga",
    subSavings: "limitdan qolgani",
    subDebts: "to'lanmagan",
    chartTitle: "Daromad vs Xarajat",
    goalTitle: "Xarajat limiti",
    structureTitle: "Xarajat tuzilmasi",
    aiInsightTitle: "AI Tavsiya",
    aiInsightDesc: "Ko'ngil ochar xarajatlaringiz o'tgan oyga nisbatan 18% oshdi. Oylik 200 000 so'm limit qo'yish yiliga 2.4M so'm tejash imkonini beradi.",
    months: ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl'],
    periodDaily: "Kunlik",
    periodWeekly: "Haftalik",
    periodMonthly: "Oylik",
    periodAll: "Butun davr",
    categories: {
      "Oziq-ovqat": "Oziq-ovqat",
      "Transport": "Transport",
      "Ko'ngil ochar": "Ko'ngil ochar",
      "Kommunal": "Kommunal",
      "Boshqa": "Boshqa",
      "Ovqat": "Oziq-ovqat",
      "Kiyim": "Kiyim",
      "Uy": "Uy"
    }
  },
  uz_cyrl: {
    title: "Таҳлил",
    monthLabel: "Июль 2026",
    income: "Даромад",
    expense: "Харажат",
    savings: "Қолган лимит",
    debts: "Қарзлар",
    subIncome: "сўм",
    subExpense: "+33% ўтганга",
    subSavings: "лимитдан қолгани",
    subDebts: "тўланмаган",
    chartTitle: "Даромад vs Харажат",
    goalTitle: "Харажат лимити",
    structureTitle: "Харажат тузилмаси",
    aiInsightTitle: "AI Тавсия",
    aiInsightDesc: "Кўнгил очар харажатларингиз ўтган ойга нисбатан 18% ошди.",
    months: ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл'],
    periodDaily: "Кунлик",
    periodWeekly: "Ҳафталик",
    periodMonthly: "Ойлик",
    periodAll: "Бутун давр",
    categories: {
      "Oziq-ovqat": "Озиқ-овқат",
      "Transport": "Транспорт",
      "Ko'ngil ochar": "Кўнгил очар",
      "Kommunal": "Коммунал",
      "Boshqa": "Бошқа",
      "Ovqat": "Озиқ-овқат",
      "Kiyim": "Кийим",
      "Uy": "Уй"
    }
  },
  ru: {
    title: "Анализ",
    monthLabel: "Июль 2026",
    income: "Доход",
    expense: "Расход",
    savings: "Остаток лимита",
    debts: "Долги",
    subIncome: "сум",
    subExpense: "+33% к прошлому",
    subSavings: "остаток от лимита",
    subDebts: "не оплачено",
    chartTitle: "Доход vs Расход",
    goalTitle: "Лимит расходов",
    structureTitle: "Структура расходов",
    aiInsightTitle: "Совет ИИ",
    aiInsightDesc: "Ваши расходы на развлечения выросли на 18% по сравнению с прошлым месяцем. Установка лимита в 200 000 сум в месяц сэкономит 2.4M сум в год.",
    months: ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл'],
    periodDaily: "День",
    periodWeekly: "Неделя",
    periodMonthly: "Месяц",
    periodAll: "Все время",
    categories: {
      "Oziq-ovqat": "Продукты",
      "Transport": "Транспорт",
      "Ko'ngil ochar": "Развлечения",
      "Kommunal": "Коммунальные",
      "Boshqa": "Другое",
      "Ovqat": "Продукты",
      "Kiyim": "Одежда",
      "Uy": "Жилье"
    }
  },
  en: {
    title: "Analytics",
    monthLabel: "July 2026",
    income: "Income",
    expense: "Expense",
    savings: "Remaining limit",
    debts: "Debts",
    subIncome: "som",
    subExpense: "+33% vs last month",
    subSavings: "left from limit",
    subDebts: "unpaid",
    chartTitle: "Income vs Expense",
    goalTitle: "Expense Limit",
    structureTitle: "Spending Structure",
    aiInsightTitle: "AI Insight",
    aiInsightDesc: "Your entertainment expenses increased by 18% compared to last month. Setting a monthly limit of 200 000 som will save 2.4M som per year.",
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'],
    periodDaily: "Daily",
    periodWeekly: "Weekly",
    periodMonthly: "Monthly",
    periodAll: "All Time",
    categories: {
      "Oziq-ovqat": "Groceries",
      "Transport": "Transport",
      "Ko'ngil ochar": "Entertainment",
      "Kommunal": "Utilities",
      "Boshqa": "Other",
      "Ovqat": "Groceries",
      "Kiyim": "Clothes",
      "Uy": "Housing"
    }
  }
}

const categoryColors: Record<string, string> = {
  'Oziq-ovqat': '#10B981',
  'Transport': '#3B82F6',
  "Ko'ngil ochar": '#F59E0B',
  'Kommunal': '#EF4444',
  'Boshqa': '#8B5CF6',
  'Kiyim': '#EC4899',
  "Sog'liq": '#06B6D4',
  "Ta'lim": '#6366F1',
}
const fallbackPalette = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#6366F1']
function colorFor(cat: string, idx: number) {
  return categoryColors[cat] || fallbackPalette[idx % fallbackPalette.length]
}

const monthAbbrev: Record<string, string[]> = {
  uz: ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'],
  uz_cyrl: ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'],
  ru: ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
}
const weekAbbrev: Record<string, string[]> = {
  uz: ['Dush', 'Sesh', 'Chor', 'Pay', 'Jum', 'Shan', 'Yak'],
  uz_cyrl: ['Душ', 'Сеш', 'Чор', 'Пай', 'Жум', 'Шан', 'Як'],
  ru: ['Пон', 'Вто', 'Сре', 'Чет', 'Пят', 'Суб', 'Вос'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
}

function fmtFull(n: number) {
  return n.toLocaleString('en-US').replace(/,/g, ' ')
}

function parseAmt(tx: { amount: number | string }) {
  return Number(String(tx.amount).replace(/\s/g, '').replace(/,/g, '')) || 0
}

export default function AnalyticsScreen({ onboarding }: Props) {
  const { customTransactions, hasSampleData } = useFinance()
  const initialLang = onboarding?.language || 'uz'
  const lang = (initialLang in translations) ? initialLang : 'uz'
  const t = translations[lang as keyof typeof translations]

  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'all'>('monthly')

  const firstExpense = onboarding?.firstExpense

  // Real, signed transaction list: saved transactions + onboarding's declared first expense
  const allTx = [
    ...customTransactions.map((tx) => ({
      amount: parseAmt(tx),
      type: tx.type,
      category: tx.category,
      date: new Date(tx.date || Date.now()),
    })),
    ...(firstExpense ? [{
      amount: -Math.abs(firstExpense.amount),
      type: 'expense',
      category: firstExpense.category,
      date: new Date(firstExpense.date || Date.now()),
    }] : []),
    ...(hasSampleData ? baseTransactions.map((tx) => ({
      amount: parseAmt(tx),
      type: tx.type as any,
      category: tx.category,
      date: new Date(Date.now() - 3600000 * 2), // 2 hours ago
    })) : []),
  ]

  const now = new Date()
  const monthlyIncomeBase = onboarding?.monthlyIncome || 0
  const monthlyGoalBase = onboarding?.monthlyGoal || 3000000
  const monthlyLimitBase = monthlyIncomeBase > 0 ? (monthlyIncomeBase - monthlyGoalBase) : monthlyGoalBase

  const periodWordDict = {
    daily: { uz: 'bugun', uz_cyrl: 'бугун', ru: 'сегодня', en: 'today' },
    weekly: { uz: 'shu hafta', uz_cyrl: 'шу ҳафта', ru: 'эта неделя', en: 'this week' },
    monthly: { uz: 'shu oy', uz_cyrl: 'шу ой', ru: 'этот месяц', en: 'this month' },
    all: { uz: 'jami', uz_cyrl: 'жами', ru: 'всего', en: 'total' },
  }
  const periodWord = (periodWordDict[period] as Record<string, string>)[lang] || periodWordDict[period].uz

  // Date range + limit for the summary cards
  let rangeStart: Date, rangeEnd: Date, totalLimit: number
  if (period === 'daily') {
    rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    rangeEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
    totalLimit = Math.round(monthlyLimitBase / 30)
  } else if (period === 'weekly') {
    const dow = (now.getDay() + 6) % 7 // Monday = 0
    rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow)
    rangeEnd = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate() + 6, 23, 59, 59, 999)
    totalLimit = Math.round(monthlyLimitBase / 4)
  } else if (period === 'monthly') {
    rangeStart = new Date(now.getFullYear(), now.getMonth(), 1)
    rangeEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
    totalLimit = monthlyLimitBase
  } else {
    rangeStart = new Date(2000, 0, 1)
    rangeEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999)
    totalLimit = monthlyLimitBase * 12
  }

  const txInRange = allTx.filter((tx) => tx.date >= rangeStart && tx.date <= rangeEnd)

  const isExpenseTx = (tx: any) => tx.type === 'expense' || tx.type === 'lending' || (!tx.type && tx.amount < 0);
  const isIncomeTx = (tx: any) => tx.type === 'income' || (!tx.type && tx.amount > 0);

  const summaryIncome = txInRange.filter(isIncomeTx).reduce((s, tx) => s + Math.abs(tx.amount), 0)
  const summaryExpense = txInRange.filter(isExpenseTx).reduce((s, tx) => s + Math.abs(tx.amount), 0)
  const summaryDebts = txInRange.filter((tx) => tx.type === 'debt').reduce((s, tx) => s + Math.abs(tx.amount), 0)
  const summarySavings = totalLimit - summaryExpense

  const subInc = periodWord
  const subExp = periodWord
  const subSav = t.subSavings
  const subDeb = t.subDebts

  // Bar chart: always 7 buckets, sized to the selected period
  const chartLabels: string[] = []
  const chartIncome: number[] = []
  const chartSpend: number[] = []

  const pushBucket = (bStart: Date, bEnd: Date, label: string) => {
    const bucket = allTx.filter((tx) => tx.date >= bStart && tx.date <= bEnd)
    chartLabels.push(label)
    chartIncome.push(bucket.filter(isIncomeTx).reduce((s, tx) => s + Math.abs(tx.amount), 0))
    chartSpend.push(bucket.filter(isExpenseTx).reduce((s, tx) => s + Math.abs(tx.amount), 0))
  }

  if (period === 'daily') {
    for (let i = 0; i < 6; i++) {
      const h = i * 4
      pushBucket(
        new Date(now.getFullYear(), now.getMonth(), now.getDate(), h),
        new Date(now.getFullYear(), now.getMonth(), now.getDate(), h + 4, 0, 0, -1),
        `${String(h).padStart(2, '0')}:00`
      )
    }
  } else if (period === 'weekly') {
    const labels = weekAbbrev[lang]
    for (let i = 0; i < 7; i++) {
      const d = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate() + i)
      pushBucket(
        new Date(d.getFullYear(), d.getMonth(), d.getDate()),
        new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999),
        labels[i]
      )
    }
  } else if (period === 'monthly') {
    const labels = monthAbbrev[lang]
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      pushBucket(
        new Date(d.getFullYear(), d.getMonth(), 1),
        new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999),
        labels[d.getMonth()]
      )
    }
  } else {
    for (let i = 6; i >= 0; i--) {
      const y = now.getFullYear() - i
      pushBucket(new Date(y, 0, 1), new Date(y, 11, 31, 23, 59, 59, 999), String(y))
    }
  }

  const maxVal = Math.max(1, ...chartSpend, ...chartIncome)

  // Category breakdown from real expense transactions in the selected range
  const catTotals = new Map<string, number>()
  txInRange.filter(isExpenseTx).forEach((tx) => {
    catTotals.set(tx.category, (catTotals.get(tx.category) || 0) + Math.abs(tx.amount))
  })
  const totalCatAmt = Array.from(catTotals.values()).reduce((s, v) => s + v, 0)
  const catsWithPct = Array.from(catTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, amt], i) => ({
      name,
      amt,
      color: colorFor(name, i),
      pct: totalCatAmt > 0 ? Math.round((amt / totalCatAmt) * 100) : 0,
    }))

  const goal = totalLimit
  const goalPct = goal ? Math.min(100, Math.round((summaryExpense / goal) * 100)) : null

  return (
    <div>
      <div style={{ height: 54 }} />

      <div style={{ padding: '4px 20px 16px' }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, color: '#1E1A3C', letterSpacing: -0.5, marginBottom: 2 }}>{t.title}</h2>
        <p style={{ fontSize: 13, color: '#8B82C4' }}>{`${monthAbbrev[lang][now.getMonth()]} ${now.getFullYear()}`}</p>
      </div>

      {/* Period Selection Controls */}
      <div style={{ padding: '0 20px 20px' }}>
        <div style={{
          display: 'flex',
          background: '#F3F1FB',
          borderRadius: 14,
          padding: '4px',
          border: '1.5px solid #E4E2F0',
          gap: 4
        }}>
          {[
            { key: 'daily', label: t.periodDaily },
            { key: 'weekly', label: t.periodWeekly },
            { key: 'monthly', label: t.periodMonthly },
            { key: 'all', label: t.periodAll },
          ].map(p => {
            const active = period === p.key
            return (
              <motion.button
                key={p.key}
                onClick={() => setPeriod(p.key as any)}
                whileTap={{ scale: 0.96 }}
                animate={{ scale: active ? 1 : 0.98 }}
                style={{
                  flex: 1,
                  padding: '8px 4px',
                  borderRadius: 10,
                  border: 'none',
                  background: active ? '#FFFFFF' : 'transparent',
                  color: active ? '#7C3AED' : '#5C548A',
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: 'pointer',
                  transition: 'background 0.2s, color 0.2s',
                  boxShadow: active ? '0 2px 8px rgba(124, 58, 237, 0.12)' : 'none'
                }}
              >
                {p.label}
              </motion.button>
            )
          })}
        </div>
      </div>

      {/* Summary */}
      <div style={{ padding: '0 20px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {[
          { 
            label: t.income, 
            val: summaryIncome > 0 ? fmtFull(summaryIncome) : '—', 
            sub: summaryIncome > 0 ? subInc : (lang === 'uz' ? 'Kiritilmagan' : lang === 'uz_cyrl' ? 'Киритилмаган' : lang === 'ru' ? 'Не указан' : 'Not set'), 
            color: '#16A34A', 
            bg: '#F0FDF4', 
            border: '#DCFCE7' 
          },
          { label: t.expense, val: fmtFull(summaryExpense), sub: subExp, color: '#DC2626', bg: '#FEF2F2', border: '#FEE2E2' },
          { label: t.savings, val: fmtFull(summarySavings), sub: subSav, color: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE' },
          { label: t.debts, val: fmtFull(summaryDebts), sub: subDeb, color: '#D97706', bg: '#FFFBEB', border: '#FDE68A' },
        ].map((c) => (
          <div key={c.label} style={{
            background: c.bg, borderRadius: 18, padding: '16px',
            border: `1.5px solid ${c.border}`,
          }}>
            <p style={{ fontSize: 12, color: '#8B82C4', marginBottom: 8, fontWeight: 500 }}>{c.label}</p>
            <p style={{ fontSize: 24, fontWeight: 700, color: c.color, letterSpacing: -0.5, marginBottom: 2 }}>{c.val}</p>
            <p style={{ fontSize: 11, color: '#B8B0DC' }}>{c.sub}</p>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      <div style={{ padding: '0 20px 20px' }}>
        <div style={{
          background: '#F5F4FA', borderRadius: 20, padding: '20px',
          border: '1.5px solid #E4E2F0',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1E1A3C' }}>{t.chartTitle}</h3>
            <div style={{ display: 'flex', gap: 12 }}>
              {[{ c: '#7C3AED', l: t.income }, { c: '#A78BFA', l: t.expense }].map((x) => (
                <div key={x.l} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: x.c }} />
                  <span style={{ fontSize: 11, color: '#8B82C4' }}>{x.l}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 110 }}>
            {chartLabels.map((m, i) => {
              const currentInc = chartIncome[i] || 0
              const currentExp = chartSpend[i] || 0
              const maxValToUse = maxVal > 0 ? maxVal : 1
              const incH = Math.min(100, Math.max(4, (currentInc / maxValToUse) * 100))
              const expH = Math.min(100, Math.max(4, (currentExp / maxValToUse) * 100))
              const isLatest = i === chartLabels.length - 1

              return (
                <div key={`${m}-${i}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', width: '100%' }}>
                    <div style={{
                      flex: 1, height: `${incH}px`,
                      background: '#7C3AED', borderRadius: '4px 4px 2px 2px', minHeight: 4,
                      opacity: isLatest ? 1 : 0.6,
                    }} />
                    <div style={{
                      flex: 1, height: `${expH}px`,
                      background: '#A78BFA', borderRadius: '4px 4px 2px 2px', minHeight: 4,
                    }} />
                  </div>
                  <span style={{ fontSize: 10, color: isLatest ? '#7C3AED' : '#B8B0DC', fontWeight: isLatest ? 600 : 400 }}>
                    {m}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Goal progress (from onboarding) */}
      {goal !== null && goalPct !== null && (
        <div style={{ padding: '0 20px 20px' }}>
          <div style={{
            background: '#F5F4FA', borderRadius: 20, padding: '18px 20px',
            border: '1.5px solid #E4E2F0',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>🎯</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#1E1A3C' }}>{t.goalTitle}</span>
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#7C3AED' }}>{goalPct}%</span>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: '#EAE8F6', overflow: 'hidden', marginBottom: 10 }}>
              <div style={{ width: `${goalPct}%`, height: '100%', background: '#7C3AED', borderRadius: 4, transition: 'width 0.3s ease' }} />
            </div>
            <p style={{ fontSize: 12, color: '#8B82C4' }}>
              {lang === 'uz' ? 'Sarflangan' : lang === 'uz_cyrl' ? 'Сарфланган' : lang === 'ru' ? 'Израсходовано' : 'Spent'}: {fmtFull(summaryExpense)} / {lang === 'uz' ? 'Limit' : lang === 'uz_cyrl' ? 'Лимит' : lang === 'ru' ? 'Лимит' : 'Limit'}: {fmtFull(goal)} {lang === 'uz' ? "so'm" : lang === 'uz_cyrl' ? "сўм" : lang === 'ru' ? 'сум' : 'som'}
            </p>
          </div>
        </div>
      )}

      {/* Categories */}
      <div style={{ padding: '0 20px 24px' }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1E1A3C', marginBottom: 14 }}>{t.structureTitle}</h3>

        <div style={{ height: 8, borderRadius: 4, display: 'flex', overflow: 'hidden', marginBottom: 18 }}>
          {catsWithPct.map((c) => (
            <div key={c.name} style={{ width: `${c.pct}%`, background: c.color }} />
          ))}
        </div>

        <div style={{
          background: '#F5F4FA', borderRadius: 20, border: '1.5px solid #E4E2F0', overflow: 'hidden',
        }}>
          {catsWithPct.map((c, i) => {
            const catLabel = t.categories[c.name as keyof typeof t.categories] || c.name
            return (
              <div key={c.name} style={{
                display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px',
                borderBottom: i < catsWithPct.length - 1 ? '1px solid #E4E2F0' : 'none',
              }}>
                <div style={{ width: 10, height: 10, borderRadius: 3, background: c.color, flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 14, color: '#1E1A3C', fontWeight: 500 }}>{catLabel}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#1E1A3C' }}>
                  {fmtFull(c.amt)}
                </span>
                <span style={{ fontSize: 12, color: '#8B82C4', width: 34, textAlign: 'right' }}>{c.pct}%</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* AI insight */}
      <div style={{ padding: '0 20px 32px' }}>
        <div style={{
          background: '#F5F4FA', borderRadius: 18, padding: '18px',
          border: '1.5px solid #E4E2F0',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8, background: '#DDD9F6',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
            }}>💡</div>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#5B21B6' }}>{t.aiInsightTitle}</span>
          </div>
          <p style={{ fontSize: 13, color: '#5B21B6', lineHeight: 1.65, opacity: 0.85 }}>
            {catsWithPct.length > 0 
              ? (lang === 'uz' 
                  ? `Eng ko'p xarajat amaldagi davrda "${catsWithPct[0].name}" kategoriyasiga to'g'ri keldi (${catsWithPct[0].pct}%). Ushbu yo'nalishda me'yorni saqlash moliyaviy barqarorlikni ta'minlaydi.`
                  : lang === 'uz_cyrl'
                  ? `Энг кўп харажат амалдаги даврда "${catsWithPct[0].name}" категориясига тўғри келди (${catsWithPct[0].pct}%). Ушбу йўналишда меъёрни сақлаш молиявий барқарорликни таъминлайди.`
                  : lang === 'ru'
                  ? `Наибольшие расходы за выбранный период приходятся на категорию "${catsWithPct[0].name}" (${catsWithPct[0].pct}%). Контроль этих расходов поможет сберечь бюджет.`
                  : `Largest spending in this period was in "${catsWithPct[0].name}" (${catsWithPct[0].pct}%). Monitoring this category helps keep your budget balanced.`)
              : t.aiInsightDesc}
          </p>
        </div>
      </div>
    </div>
  )
}

