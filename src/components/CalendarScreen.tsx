import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import type { OnboardingResult } from './Onboarding'
import { useFinance, baseTransactions } from '../FinanceContext'

interface Props {
  onboarding?: OnboardingResult | null
}

const translations = {
  uz: {
    title: "Taqvim",
    subtitle: "Kundalik operatsiyalar tahlili",
    noTransactions: "Ushbu kunda operatsiyalar mavjud emas",
    addTransaction: "Yangi operatsiya qo'shish",
    selectedDateTransactions: "Tanlangan kundagi operatsiyalar",
    amountLabel: "Summa",
    categoryLabel: "Kategoriya",
    nameLabel: "Nomi",
    typeLabel: "Turi",
    income: "Daromad",
    expense: "Xarajat",
    save: "Saqlash",
    cancel: "Bekor qilish",
    daysOfWeek: ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'],
    monthName: "Iyul 2026",
    viewMonth: "Oy",
    viewAgenda: "Kun tartibi",
    statIn: "Kirim",
    statOut: "Chiqim",
    statNet: "Jami",
    filterAll: "Barchasi",
    filterIn: "Kirim",
    filterOut: "Chiqim",
    categories: {
      "Oziq-ovqat": "Oziq-ovqat",
      "Transport": "Transport",
      "Ko'ngil ochar": "Ko'ngil ochar",
      "Kommunal": "Kommunal",
      "Boshqa": "Boshqa",
      "Daromad": "Daromad"
    }
  },
  uz_cyrl: {
    title: "Тақвим",
    subtitle: "Кундалик операциялар таҳлили",
    noTransactions: "Ушбу кунда операциялар мавжуд эмас",
    addTransaction: "Янги операция қўшиш",
    selectedDateTransactions: "Танланган кундаги операциялар",
    amountLabel: "Сумма",
    categoryLabel: "Категория",
    nameLabel: "Номи",
    typeLabel: "Тури",
    income: "Даромад",
    expense: "Харажат",
    save: "Сақлаш",
    cancel: "Бекор қилиш",
    daysOfWeek: ['Ду', 'Се', 'Чор', 'Пай', 'Жум', 'Шан', 'Як'],
    monthName: "Июль 2026",
    viewMonth: "Ой",
    viewAgenda: "Кун тартиби",
    statIn: "Кирим",
    statOut: "Чиқим",
    statNet: "Жами",
    filterAll: "Барчаси",
    filterIn: "Кирим",
    filterOut: "Чиқим",
    categories: {
      "Oziq-ovqat": "Озиқ-овқат",
      "Transport": "Транспорт",
      "Ko'ngil ochar": "Кўнгил очар",
      "Kommunal": "Коммунал",
      "Boshqa": "Бошқа",
      "Daromad": "Даромад"
    }
  },
  ru: {
    title: "Календарь",
    subtitle: "Анализ ежедневных операций",
    noTransactions: "В этот день операций не было",
    addTransaction: "Добавить операцию",
    selectedDateTransactions: "Операции за выбранный день",
    amountLabel: "Сумма",
    categoryLabel: "Категория",
    nameLabel: "Название",
    typeLabel: "Тип",
    income: "Доход",
    expense: "Расход",
    save: "Сохранить",
    cancel: "Отмена",
    daysOfWeek: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
    monthName: "Июль 2026",
    viewMonth: "Месяц",
    viewAgenda: "Повестка дня",
    statIn: "Доход",
    statOut: "Расход",
    statNet: "Итого",
    filterAll: "Все",
    filterIn: "Доход",
    filterOut: "Расход",
    categories: {
      "Oziq-ovqat": "Продукты",
      "Transport": "Транспорт",
      "Ko'ngil ochar": "Развлечения",
      "Kommunal": "Коммунальные",
      "Boshqa": "Другое",
      "Daromad": "Доход"
    }
  },
  en: {
    title: "Calendar",
    subtitle: "Daily operations analysis",
    noTransactions: "No operations on this day",
    addTransaction: "Add operation",
    selectedDateTransactions: "Operations on selected date",
    amountLabel: "Amount",
    categoryLabel: "Category",
    nameLabel: "Name",
    typeLabel: "Type",
    income: "Income",
    expense: "Expense",
    save: "Save",
    cancel: "Cancel",
    daysOfWeek: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
    monthName: "July 2026",
    viewMonth: "Month",
    viewAgenda: "Agenda",
    statIn: "In",
    statOut: "Out",
    statNet: "Net",
    filterAll: "All",
    filterIn: "In",
    filterOut: "Out",
    categories: {
      "Oziq-ovqat": "Groceries",
      "Transport": "Transport",
      "Ko'ngil ochar": "Entertainment",
      "Kommunal": "Utilities",
      "Boshqa": "Other",
      "Daromad": "Income"
    }
  }
}

interface Transaction {
  id: string | number
  name: string
  category: string
  amount: number
  day: number
  month: number
  year: number
  emoji: string
  color: string
  dot: string
}

const monthNames: Record<string, string[]> = {
  uz: ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentyabr", "Oktyabr", "Noyabr", "Dekabr"],
  uz_cyrl: ["Январ", "Феврал", "Март", "Апрел", "Май", "Июн", "Июл", "Август", "Сентябр", "Октябр", "Ноябр", "Декабр"],
  ru: ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
}

export default function CalendarScreen({ onboarding }: Props) {
  const { onboarding: contextOnboarding, customTransactions, setDateRange, hasSampleData } = useFinance()
  const currentOnboarding = onboarding || contextOnboarding
  const initialLang = currentOnboarding?.language || 'uz'
  const lang = (initialLang in translations) ? initialLang : 'uz'
  const t = translations[lang as keyof typeof translations]
  const fmt = (n: number) => n.toLocaleString('uz-UZ')

  const loadAllTransactions = () => {
    const list: Transaction[] = []
    const now = new Date()
    
    if (hasSampleData) {
      baseTransactions.forEach((t: any) => {
        list.push({
          ...t,
          day: now.getDate(),
          month: now.getMonth() + 1,
          year: now.getFullYear()
        })
      })
    }

    if (currentOnboarding?.firstExpense) {
      const fDate = new Date(currentOnboarding.firstExpense.date || Date.now())
      list.push({
        id: 'tx-onboard',
        name: 'Birinchi xarajat',
        category: currentOnboarding.firstExpense.category,
        amount: -currentOnboarding.firstExpense.amount,
        day: fDate.getDate(),
        month: fDate.getMonth() + 1,
        year: fDate.getFullYear(),
        emoji: '✨',
        color: '#FEF2F2',
        dot: '#DC2626'
      })
    }

    // Load custom transactions from context
    customTransactions.forEach((t: any, idx: number) => {
      const cleanAmt = Number(String(t.amount).replace(/\s/g, '').replace(/,/g, '')) || 0
      const isNegative = cleanAmt < 0
      let d = t.day
      let m = t.month
      let y = t.year
      if (!d || !m || !y) {
        const now = new Date()
        const str = String(t.date || '').trim()
        if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
          const [yStr, mStr, dStr] = str.slice(0, 10).split('-')
          y = parseInt(yStr, 10)
          m = parseInt(mStr, 10)
          d = parseInt(dStr, 10)
        } else {
          const parsed = new Date(str || Date.now())
          if (!isNaN(parsed.getTime())) {
            y = parsed.getFullYear()
            m = parsed.getMonth() + 1
            d = parsed.getDate()
          } else {
            y = now.getFullYear()
            m = now.getMonth() + 1
            d = now.getDate()
          }
        }
      }
      list.push({
        id: t.id || `custom-${idx}`,
        name: t.note || t.category,
        category: t.category,
        amount: cleanAmt,
        day: d,
        month: m,
        year: y,
        emoji: t.type === 'expense' ? '🛒' : t.type === 'income' ? '💼' : t.type === 'debt' ? '⟳' : '⟲',
        color: isNegative ? '#FEF2F2' : '#F0FDF4',
        dot: isNegative ? '#DC2626' : '#16A34A'
      })
    })

    return list
  }

  // Setup initial transactions including onboarding firstExpense if it exists
  const [transactions, setTransactions] = useState<Transaction[]>(() => loadAllTransactions())

  useEffect(() => {
    setTransactions(loadAllTransactions())
  }, [customTransactions, currentOnboarding])

  // Calendar Year & Month navigation
  const [currentYear, setCurrentYear] = useState<number>(new Date().getFullYear())
  const [currentMonth, setCurrentMonth] = useState<number>(new Date().getMonth() + 1) // 1-indexed for display and logic
  const [dragDirection, setDragDirection] = useState<number>(1)
  const [selectedDay, setSelectedDay] = useState<number>(new Date().getDate())
  const [viewType, setViewType] = useState<'month' | 'agenda'>('month')
  const [filterType, setFilterType] = useState<'all' | 'in' | 'out'>('all')
  useEffect(() => {
    const start = new Date(currentYear, currentMonth - 1, 1)
    const end = new Date(currentYear, currentMonth, 0, 23, 59, 59, 999)
    setDateRange({ start, end })
  }, [currentYear, currentMonth, setDateRange])

  const prevMonth = () => {
    setDragDirection(-1)
    if (currentMonth === 1) {
      setCurrentMonth(12)
      setCurrentYear(prev => prev - 1)
    } else {
      setCurrentMonth(prev => prev - 1)
    }
  }

  const nextMonth = () => {
    setDragDirection(1)
    if (currentMonth === 12) {
      setCurrentMonth(1)
      setCurrentYear(prev => prev + 1)
    } else {
      setCurrentMonth(prev => prev + 1)
    }
  }

  // Get start day offset and total days dynamically
  const getMonthData = (year: number, month: number) => {
    const firstDay = new Date(year, month - 1, 1)
    const totalDays = new Date(year, month, 0).getDate()
    const jsDay = firstDay.getDay()
    const offset = jsDay === 0 ? 6 : jsDay - 1
    return { totalDays, offset }
  }

  const { totalDays, offset } = getMonthData(currentYear, currentMonth)

  const gridCells = []
  for (let i = 0; i < offset; i++) {
    gridCells.push(null)
  }
  for (let i = 1; i <= totalDays; i++) {
    gridCells.push(i)
  }

  // Filter transactions for current month and year
  const currentMonthTransactions = transactions.filter(tx => {
    return tx.month === currentMonth && (tx.year === currentYear || !tx.year)
  })

  const isExpenseTx = (tx: any) => tx.type === 'expense' || tx.type === 'lending' || (!tx.type && tx.amount < 0);
  const isIncomeTx = (tx: any) => tx.type === 'income' || (!tx.type && tx.amount > 0);

  // Calculate In, Out, Net stats
  const monthIncome = currentMonthTransactions.filter(isIncomeTx).reduce((sum, tx) => sum + Math.abs(tx.amount), 0)
  const monthExpense = currentMonthTransactions.filter(isExpenseTx).reduce((sum, tx) => sum + Math.abs(tx.amount), 0)
  const monthNet = monthIncome - monthExpense

  // Selected date transactions filtered by In / Out
  const rawDayTransactions = transactions.filter(tx => {
    return tx.day === selectedDay && tx.month === currentMonth && (tx.year === currentYear || !tx.year)
  })

  const dayTransactions = rawDayTransactions.filter(tx => {
    if (filterType === 'in') return isIncomeTx(tx)
    if (filterType === 'out') return isExpenseTx(tx)
    return true
  })

  // Agenda list of transactions for entire month
  const agendaTransactions = currentMonthTransactions.filter(tx => {
    if (filterType === 'in') return isIncomeTx(tx)
    if (filterType === 'out') return isExpenseTx(tx)
    return true
  }).sort((a, b) => b.day - a.day)

  return (
    <div style={{ position: 'relative' }} id="calendar-screen-container">
      <div style={{ height: 54 }} />

      {/* Header (No p tag, h2 in middle) */}
      <div style={{ padding: '8px 20px 16px', display: 'flex', justifyContent: 'center', alignItems: 'center' }} id="calendar-title-header">
        <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1E1A3C', letterSpacing: -0.5, textAlign: 'center' }}>
          {t.title}
        </h2>
      </div>

      {/* Date Navigation Picker: < June 2026 > */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px', marginBottom: 16 }} id="calendar-month-picker">
        <button
          onClick={prevMonth}
          style={{
            width: 36, height: 36, borderRadius: 12, background: '#F6F5FA', border: '1.5px solid #E4E1F4',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            fontSize: 16, fontWeight: 700, color: '#7C3AED', boxShadow: '0 2px 6px rgba(124, 58, 237, 0.04)'
          }}
        >
          ‹
        </button>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#1E1A3C', letterSpacing: -0.2 }}>
          {monthNames[lang][currentMonth - 1]} {currentYear}
        </span>
        <button
          onClick={nextMonth}
          style={{
            width: 36, height: 36, borderRadius: 12, background: '#F6F5FA', border: '1.5px solid #E4E1F4',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            fontSize: 16, fontWeight: 700, color: '#7C3AED', boxShadow: '0 2px 6px rgba(124, 58, 237, 0.04)'
          }}
        >
          ›
        </button>
      </div>

      {/* Month / Agenda Chooser */}
      <div style={{ display: 'flex', gap: 8, padding: '0 20px', marginBottom: 16 }} id="calendar-view-chooser">
        <button
          onClick={() => setViewType('month')}
          style={{
            flex: 1, padding: '10px', borderRadius: 12,
            border: viewType === 'month' ? '1.5px solid #7C3AED' : '1.5px solid #E4E1F4',
            background: viewType === 'month' ? '#7C3AED' : '#F4F3FA',
            color: viewType === 'month' ? '#FFFFFF' : '#7C3AED',
            fontWeight: 700, fontSize: 13, cursor: 'pointer', transition: 'all 0.15s ease'
          }}
        >
          {t.viewMonth}
        </button>
        <button
          onClick={() => setViewType('agenda')}
          style={{
            flex: 1, padding: '10px', borderRadius: 12,
            border: viewType === 'agenda' ? '1.5px solid #7C3AED' : '1.5px solid #E4E1F4',
            background: viewType === 'agenda' ? '#7C3AED' : '#F4F3FA',
            color: viewType === 'agenda' ? '#FFFFFF' : '#7C3AED',
            fontWeight: 700, fontSize: 13, cursor: 'pointer', transition: 'all 0.15s ease'
          }}
        >
          {t.viewAgenda}
        </button>
      </div>

      {/* Month Stats Summary: In - Kirim, Out - chiqim, Net - Jami */}
      <div style={{ display: 'flex', gap: 10, padding: '0 20px', marginBottom: 16 }} id="calendar-month-stats">
        <div style={{ flex: 1, background: '#F0FDF4', borderRadius: 14, padding: '10px 12px', border: '1.5px solid #DCFCE7' }}>
          <p style={{ fontSize: 10, color: '#16A34A', fontWeight: 600, marginBottom: 2 }}>{t.statIn}</p>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#15803D' }}>{fmt(monthIncome)}</p>
        </div>
        <div style={{ flex: 1, background: '#FEF2F2', borderRadius: 14, padding: '10px 12px', border: '1.5px solid #FEE2E2' }}>
          <p style={{ fontSize: 10, color: '#DC2626', fontWeight: 600, marginBottom: 2 }}>{t.statOut}</p>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#B91C1C' }}>{fmt(-monthExpense)}</p>
        </div>
        <div style={{ flex: 1, background: monthNet >= 0 ? '#EFF6FF' : '#FFF7ED', borderRadius: 14, padding: '10px 12px', border: monthNet >= 0 ? '1.5px solid #DBEAFE' : '1.5px solid #FFEDD5' }}>
          <p style={{ fontSize: 10, color: monthNet >= 0 ? '#2563EB' : '#EA580C', fontWeight: 600, marginBottom: 2 }}>{t.statNet}</p>
          <p style={{ fontSize: 13, fontWeight: 700, color: monthNet >= 0 ? '#1D4ED8' : '#C2410C' }}>{fmt(monthNet)}</p>
        </div>
      </div>

      {/* Filters: All, In , Out */}
      <div style={{ display: 'flex', gap: 8, padding: '0 20px', marginBottom: 16 }} id="calendar-transaction-filters">
        <button
          onClick={() => setFilterType('all')}
          style={{
            flex: 1, padding: '8px', borderRadius: 12, border: '1.5px solid #E4E1F4',
            background: filterType === 'all' ? '#1E1A3C' : '#F6F5FA',
            color: filterType === 'all' ? '#FFFFFF' : '#4B456D',
            fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s'
          }}
        >
          {t.filterAll}
        </button>
        <button
          onClick={() => setFilterType('in')}
          style={{
            flex: 1, padding: '8px', borderRadius: 12, border: '1.5px solid #DCFCE7',
            background: filterType === 'in' ? '#16A34A' : '#F0FDF4',
            color: filterType === 'in' ? '#FFFFFF' : '#16A34A',
            fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s'
          }}
        >
          {t.filterIn}
        </button>
        <button
          onClick={() => setFilterType('out')}
          style={{
            flex: 1, padding: '8px', borderRadius: 12, border: '1.5px solid #FEE2E2',
            background: filterType === 'out' ? '#DC2626' : '#FEF2F2',
            color: filterType === 'out' ? '#FFFFFF' : '#DC2626',
            fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s'
          }}
        >
          {t.filterOut}
        </button>
      </div>

      {/* Calendar widget (Only shown when Month view is active) */}
      {viewType === 'month' ? (
        <motion.div
          key={`${currentYear}-${currentMonth}`}
          initial={{ opacity: 0, x: dragDirection * 120, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: -dragDirection * 120, scale: 0.98 }}
          transition={{ type: 'spring', damping: 25, stiffness: 220 }}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.2}
          onDragEnd={(_: any, info: any) => {
            if (info.offset.x < -40) {
              setDragDirection(1)
              nextMonth()
            } else if (info.offset.x > 40) {
              setDragDirection(-1)
              prevMonth()
            }
          }}
          style={{ padding: '0 20px 20px', cursor: 'grab' }}
          id="calendar-month-view-grid"
        >
          <div style={{
            background: '#F5F4FA', borderRadius: 24, padding: '20px',
            border: '1.5px solid #E4E2F0', boxShadow: '0 4px 20px rgba(124, 58, 237, 0.03)'
          }}>
            {/* Days of Week */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginBottom: 10, textAlign: 'center' }}>
              {t.daysOfWeek.map(day => (
                <span key={day} style={{ fontSize: 11, fontWeight: 600, color: '#B8B0DC' }}>{day}</span>
              ))}
            </div>

            {/* Days grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
              {gridCells.map((day, idx) => {
                if (day === null) {
                  return <div key={`empty-${idx}`} />
                }

                const isSelected = selectedDay === day
                
                // Get transactions for this specific day of the current month
                const dayTxs = transactions.filter(tx => {
                  const txMonth = tx.month || (new Date().getMonth() + 1)
                  const txYear = tx.year || new Date().getFullYear()
                  return tx.day === day && txMonth === currentMonth && txYear === currentYear
                })

                return (
                  <div
                    key={`day-${day}`}
                    onClick={() => setSelectedDay(day)}
                    style={{
                      height: 44,
                      borderRadius: 12,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      position: 'relative',
                      cursor: 'pointer',
                      background: isSelected ? '#7C3AED' : 'transparent',
                      border: isSelected ? 'none' : '1px solid transparent',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span style={{
                      fontSize: 14,
                      fontWeight: isSelected ? 700 : 500,
                      color: isSelected ? '#FFFFFF' : '#1E1A3C'
                    }}>
                      {day}
                    </span>

                    {/* Transaction indicator dots (maybe 1, 2, or 3 dots depending on transactions count) */}
                    {dayTxs.length > 0 && (
                      <div style={{ display: 'flex', gap: 2, position: 'absolute', bottom: 4, justifyContent: 'center' }}>
                        {dayTxs.slice(0, 3).map((tx, dotIdx) => (
                          <div
                            key={dotIdx}
                            style={{
                              width: 4,
                              height: 4,
                              borderRadius: '50%',
                              background: isSelected ? '#FFFFFF' : (tx.amount > 0 ? '#16A34A' : '#DC2626')
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </motion.div>
      ) : null}

      {/* Selected Date Header and List OR Agenda List */}
      <div style={{ padding: '0 20px 80px' }} id="calendar-transactions-list">
        {viewType === 'month' ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1E1A3C' }}>
                {selectedDay} {monthNames[lang][currentMonth - 1]}
              </h3>
            </div>

            {dayTransactions.length === 0 ? (
              <div style={{
                background: '#F5F4FA', borderRadius: 20, padding: '32px 20px',
                border: '1.5px solid #E4E2F0', textAlign: 'center'
              }}>
                <span style={{ fontSize: 32, display: 'block', marginBottom: 10 }}>📅</span>
                <p style={{ fontSize: 13, color: '#8B82C4' }}>{t.noTransactions}</p>
              </div>
            ) : (
              <div style={{
                background: '#F5F4FA',
                borderRadius: 20,
                border: '1.5px solid #E4E2F0',
                overflow: 'hidden'
              }}>
                {dayTransactions.map((tx, idx) => {
                  const txCatLabel = t.categories[tx.category as keyof typeof t.categories] || tx.category
                  return (
                    <div
                      key={tx.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 14,
                        padding: '14px 16px',
                        borderBottom: idx < dayTransactions.length - 1 ? '1px solid #E4E2F0' : 'none',
                      }}
                    >
                      <div style={{
                        width: 42, height: 42, borderRadius: 13, background: tx.color,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 18, flexShrink: 0,
                      }}>
                        {tx.emoji}
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: 14, fontWeight: 600, color: '#1E1A3C', marginBottom: 2 }}>{tx.name}</p>
                        <p style={{ fontSize: 11, color: '#B8B0DC' }}>{txCatLabel}</p>
                      </div>
                      <div>
                        <p style={{ fontSize: 14, fontWeight: 700, color: tx.amount > 0 ? '#16A34A' : '#1E1A3C' }}>
                          {fmt(tx.amount)}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        ) : (
          // Agenda View list
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1E1A3C' }}>
                {t.viewAgenda}
              </h3>
            </div>

            {agendaTransactions.length === 0 ? (
              <div style={{
                background: '#F5F4FA', borderRadius: 20, padding: '32px 20px',
                border: '1.5px solid #E4E2F0', textAlign: 'center'
              }}>
                <span style={{ fontSize: 32, display: 'block', marginBottom: 10 }}>📖</span>
                <p style={{ fontSize: 13, color: '#8B82C4' }}>{t.noTransactions}</p>
              </div>
            ) : (
              <div style={{
                background: '#F5F4FA',
                borderRadius: 20,
                border: '1.5px solid #E4E2F0',
                overflow: 'hidden'
              }}>
                {agendaTransactions.map((tx, idx) => {
                  const txCatLabel = t.categories[tx.category as keyof typeof t.categories] || tx.category
                  return (
                    <div
                      key={tx.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 14,
                        padding: '14px 16px',
                        borderBottom: idx < agendaTransactions.length - 1 ? '1px solid #E4E2F0' : 'none',
                      }}
                    >
                      <div style={{
                        width: 32, height: 32, borderRadius: 10, background: '#EDE9FE',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700, color: '#7C3AED', flexShrink: 0
                      }}>
                        {tx.day}
                      </div>
                      <div style={{
                        width: 42, height: 42, borderRadius: 13, background: tx.color,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 18, flexShrink: 0,
                      }}>
                        {tx.emoji}
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: 14, fontWeight: 600, color: '#1E1A3C', marginBottom: 2 }}>{tx.name}</p>
                        <p style={{ fontSize: 11, color: '#B8B0DC' }}>{txCatLabel}</p>
                      </div>
                      <div>
                        <p style={{ fontSize: 14, fontWeight: 700, color: tx.amount > 0 ? '#16A34A' : '#1E1A3C' }}>
                          {fmt(tx.amount)}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
