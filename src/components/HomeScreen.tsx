import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'

import type { OnboardingResult } from './Onboarding'
import { useFinance, baseTransactions, Transaction } from '../FinanceContext'
import BankCard from './BankCard'

interface Props {
  onboarding?: OnboardingResult | null
  onUpdateOnboarding?: (newData: Partial<OnboardingResult>) => void
}

const translations = {
  uz: {
    welcome: "Assalomu alaykum 👋",
    userName: "Jasur Toshmatov",
    totalBalance: "UMUMIY BALANS",
    currency: "so'm",
    income: "DAROMAD",
    expense: "XARAJAT",
    cardLabel: "KARTA",
    goalLabel: "Oylik xarajat limiti",
    perMonth: "so'm",
    quickActions: {
      send: "Jo'natish",
      receive: "Olish",
      topup: "To'ldirish",
      more: "Boshqa"
    },
    savedThisMonth: "Limitdan qolgani",
    debts: "Qarzlar",
    lent: "Berilgan",
    recentTransactions: "So'nggi operatsiyalar",
    viewAll: "Barchasi",
    firstExpenseLabel: "Birinchi xarajat",
    categories: {
      "Oziq-ovqat": "Oziq-ovqat",
      "Daromad": "Daromad",
      "Ko'ngil ochar": "Ko'ngil ochar",
      "Transport": "Transport",
      "Kommunal": "Kommunal",
      "Boshqa": "Boshqa",
      "Ovqat": "Oziq-ovqat",
      "Kiyim": "Kiyim-kechak",
      "Uy": "Uy / Kommunal"
    },
    transactionNames: {
      "Korzinka": "Korzinka",
      "Maosh": "Maosh",
      "Netflix": "Netflix",
      "Uber": "Uber",
      "Apelsin": "Apelsin",
      "Birinchi xarajat": "Birinchi xarajat"
    },
    premiumTitle: "Premium Tarif",
    premiumSubtitle: "Cheksiz imkoniyatlarga ega bo'ling",
    premiumStatus: "Premium faol",
    premiumBenefits: [
      "Cheksiz AI savol-javoblari",
      "Kengaytirilgan oylik hisobotlar",
      "Kategoriya va maqsadlarni sozlash",
      "Avtomatik keshbek va bonuslar"
    ],
    premiumActiveBtn: "Faollashtirilgan",
    notificationsTitle: "Bildirishnomalar",
    notificationsEmpty: "Sizda yangi bildirishnomalar yo'q",
    notiMaosh: "Oylik maosh muvaffaqiyatli qabul qilindi!",
    notiCashback: "Yangi keshbek hisoblandi: +15 000 so'm",
    notiLimit: "Oylik xarajat limitingizning 80% qismiga yetdingiz",
    limitModalTitle: "Limit va tejash kalkulyatori",
    limitModalDesc: "Tejash maqsadingizga erishish uchun xarajat limitingizni hisoblang.",
    incomeLabel: "Oylik daromadingiz",
    savingLabel: "Oylik tejash maqsadi",
    calculatedLimitLabel: "Hisoblangan xarajat limiti",
    dailyLimitLabel: "Kunlik xarajat limiti",
    weeklyLimitLabel: "Haftalik xarajat limiti",
    spendInfo: "Ushbu limitga amal qilsangiz, ko'zlagan miqdoringizni muvaffaqiyatli tejay olasiz.",
    saveBtn: "Saqlash",
    cancelBtn: "Bekor qilish",
    savingGoalText: "Tejash maqsadi",
    incomeText: "Daromad"
  },
  uz_cyrl: {
    welcome: "Ассалому алайкум 👋",
    userName: "Жасур Тошматов",
    totalBalance: "УМУМИЙ БАЛАНС",
    currency: "сўм",
    income: "ДАРОМАД",
    expense: "ХАРАЖАТ",
    cardLabel: "КАРТА",
    goalLabel: "Ойлик харажат лимити",
    perMonth: "сўм",
    quickActions: {
      send: "Жўнатиш",
      receive: "Олиш",
      topup: "Тўлдириш",
      more: "Бошқа"
    },
    savedThisMonth: "Лимитдан қолгани",
    debts: "Қарзлар",
    lent: "Берилган",
    recentTransactions: "Сўнгги операциялар",
    viewAll: "Барчаси",
    firstExpenseLabel: "Биринчи харажат",
    categories: {
      "Oziq-ovqat": "Озиқ-овқат",
      "Daromad": "Даромад",
      "Ko'ngil ochar": "Кўнгил очар",
      "Transport": "Транспорт",
      "Kommunal": "Коммунал",
      "Boshqa": "Бошқа",
      "Ovqat": "Озиқ-овқат",
      "Kiyim": "Кийим-кечак",
      "Uy": "Уй / Коммунал"
    },
    transactionNames: {
      "Korzinka": "Корзинка",
      "Maosh": "Маош",
      "Netflix": "Netflix",
      "Uber": "Uber",
      "Apelsin": "Апельсин",
      "Birinchi xarajat": "Биринчи харажат"
    },
    premiumTitle: "Премиум Тариф",
    premiumSubtitle: "Чексиз имкониятларга эга бўлинг",
    premiumStatus: "Премиум фаол",
    premiumBenefits: [
      "Чексиз AI савол-жавоблари",
      "Кенгайтирилган ойлик ҳисоботлар",
      "Категория ва мақсадларни созлаш",
      "Автоматик кешбек ва бонуслар"
    ],
    premiumActiveBtn: "Фаоллаштирилган",
    notificationsTitle: "Билдиришномалар",
    notificationsEmpty: "Сизда янги билдиришномалар йўқ",
    notiMaosh: "Ойлик маош муваффақиятли қабул қилинди!",
    notiCashback: "Янги кешбек ҳисобланди: +15 000 сўм",
    notiLimit: "Ойлик харажат лимитингизнинг 80% қисмига етдингиз",
    limitModalTitle: "Лимит ва тежаш калькулятори",
    limitModalDesc: "Тежаш мақсадингизга эришиш учун харажат лимитингизни ҳисобланг.",
    incomeLabel: "Ойлик даромадингиз",
    savingLabel: "Ойлик тежаш мақсади",
    calculatedLimitLabel: "Ҳисобланган харажат лимити",
    dailyLimitLabel: "Кунлик харажат лимити",
    weeklyLimitLabel: "Ҳафталик харажат лимити",
    spendInfo: "Ушбу лимитга амал қилсангиз, кўзлаган миқдорингизни муваффақиятли тежай оласиз.",
    saveBtn: "Сақлаш",
    cancelBtn: "Бекор қилиш",
    savingGoalText: "Тежаш мақсади",
    incomeText: "Даромад"
  },
  ru: {
    welcome: "Здравствуйте 👋",
    userName: "Жасур Тошматов",
    totalBalance: "ОБЩИЙ БАЛАНС",
    currency: "сум",
    income: "ДОХОД",
    expense: "РАСХОД",
    cardLabel: "КАРТА",
    goalLabel: "Ежемесячный лимит расходов",
    perMonth: "сум",
    quickActions: {
      send: "Отправить",
      receive: "Получить",
      topup: "Пополнить",
      more: "Другое"
    },
    savedThisMonth: "Сэкономлено",
    debts: "Долги",
    lent: "Одолжено",
    recentTransactions: "Последние операции",
    viewAll: "Все",
    firstExpenseLabel: "Первый расход",
    categories: {
      "Oziq-ovqat": "Продукты",
      "Daromad": "Доход",
      "Ko'ngil ochar": "Развлечения",
      "Transport": "Транспорт",
      "Kommunal": "Коммунальные",
      "Boshqa": "Другое",
      "Ovqat": "Продукты",
      "Kiyim": "Одежда",
      "Uy": "Жилье / ЖКХ"
    },
    transactionNames: {
      "Korzinka": "Корзинка",
      "Maosh": "Зарплата",
      "Netflix": "Netflix",
      "Uber": "Убер",
      "Apelsin": "Апельсин",
      "Birinchi xarajat": "Первый расход"
    },
    premiumTitle: "Премиум Тариф",
    premiumSubtitle: "Получите безграничные возможности",
    premiumStatus: "Премиум активен",
    premiumBenefits: [
      "Безлимитные вопросы ИИ",
      "Расширенные ежемесячные отчеты",
      "Настройка категорий и целей",
      "Автоматический кэшбэк и бонусы"
    ],
    premiumActiveBtn: "Активировано",
    notificationsTitle: "Уведомления",
    notificationsEmpty: "У вас нет новых уведомлений",
    notiMaosh: "Ежемесячная зарплата успешно получена!",
    notiCashback: "Начислен новый кэшбэк: +15 000 сум",
    notiLimit: "Вы израсходовали 80% от вашего месячного лимита",
    limitModalTitle: "Калькулятор лимита и сбережений",
    limitModalDesc: "Рассчитайте свой лимит расходов для достижения цели сбережений.",
    incomeLabel: "Ваш ежемесячный доход",
    savingLabel: "Ежемесячная цель сбережений",
    calculatedLimitLabel: "Расчетный лимит расходов",
    dailyLimitLabel: "Дневной лимит расходов",
    weeklyLimitLabel: "Недельный лимит расходов",
    spendInfo: "Соблюдая этот лимит, вы сможете накопить запланированную сумму.",
    saveBtn: "Сохранить",
    cancelBtn: "Отмена",
    savingGoalText: "Цель сбережений",
    incomeText: "Доход"
  },
  en: {
    welcome: "Welcome 👋",
    userName: "Jasur Toshmatov",
    totalBalance: "TOTAL BALANCE",
    currency: "som",
    income: "INCOME",
    expense: "EXPENSE",
    cardLabel: "CARD",
    goalLabel: "Monthly expense limit",
    perMonth: "som",
    quickActions: {
      send: "Send",
      receive: "Receive",
      topup: "Top up",
      more: "More"
    },
    savedThisMonth: "Saved this month",
    debts: "Debts",
    lent: "Lent",
    recentTransactions: "Recent transactions",
    viewAll: "All",
    firstExpenseLabel: "First expense",
    categories: {
      "Oziq-ovqat": "Groceries",
      "Daromad": "Income",
      "Ko'ngil ochar": "Entertainment",
      "Transport": "Transport",
      "Kommunal": "Utilities",
      "Boshqa": "Other",
      "Ovqat": "Groceries",
      "Kiyim": "Clothes",
      "Uy": "Housing / Rent"
    },
    transactionNames: {
      "Korzinka": "Korzinka",
      "Maosh": "Salary",
      "Netflix": "Netflix",
      "Uber": "Uber",
      "Apelsin": "Apelsin",
      "Birinchi xarajat": "First expense"
    },
    premiumTitle: "Premium Plan",
    premiumSubtitle: "Get unlimited financial powers",
    premiumStatus: "Premium Active",
    premiumBenefits: [
      "Unlimited AI financial assistant questions",
      "Advanced monthly reports and insights",
      "Custom categories and saving targets",
      "Automatic cashbacks and bonuses"
    ],
    premiumActiveBtn: "Activated",
    notificationsTitle: "Notifications",
    notificationsEmpty: "You have no new notifications",
    notiMaosh: "Monthly salary successfully received!",
    notiCashback: "New cashback credited: +15 000 som",
    notiLimit: "You reached 80% of your monthly expense limit",
    limitModalTitle: "Limit & Savings Calculator",
    limitModalDesc: "Calculate your spending limit to achieve your saving target.",
    incomeLabel: "Your Monthly Income",
    savingLabel: "Monthly Saving Target",
    calculatedLimitLabel: "Calculated Spending Limit",
    dailyLimitLabel: "Daily Spending Limit",
    weeklyLimitLabel: "Weekly Spending Limit",
    spendInfo: "By following this limit, you will successfully save your target amount.",
    saveBtn: "Save",
    cancelBtn: "Cancel",
    savingGoalText: "Saving target",
    incomeText: "Income"
  }
}

const categoryEmoji: Record<string, string> = {
  'Oziq-ovqat': '🛒',
  'Ovqat': '🍽️',
  'Transport': '🚗',
  "Ko'ngil ochar": '🎬',
  'Kiyim': '👕',
  'Kommunal': '💡',
  "Sog'liq": '💊',
  "Ta'lim": '📚',
  'Boshqa': '✨',
  'Maosh': '💼',
  'Freelance': '💻',
  'Biznes': '📈',
  'Investitsiya': '📊',
  "Sovg'a": '🎁',
  "Do'st": '🤝',
  'Bank': '🏦',
  'Oila': '🏠',
  'Hamkasb': '👥',
  'Uy': '🏠',
}

function fmt(n: number) {
  const abs = Math.abs(n)
  const s = n < 0 ? '-' : ''
  return `${s}${abs.toLocaleString('en-US').replace(/,/g, ' ')}`
}

function fmtFull(n: number) {
  return n.toLocaleString('en-US').replace(/,/g, ' ')
}

export default function HomeScreen({ onboarding, onUpdateOnboarding }: Props) {
  const { 
    onboarding: contextOnboarding, 
    customTransactions, 
    cards, 
    saveCards, 
    deleteTransaction, 
    addTransaction, 
    deletedTxIds, 
    hasSampleData,
    announcements,
    activeAnnouncementPopup,
    dismissAnnouncementPopup,
    hasNewAnnouncements,
    markAnnouncementsRead
  } = useFinance()
  const currentOnboarding = onboarding || contextOnboarding
  const initialLang = currentOnboarding?.language || 'uz'
  const lang = (initialLang in translations) ? initialLang : 'uz'
  const t = translations[lang as keyof typeof translations]

  const [showWalletsModal, setShowWalletsModal] = useState(false)
  const [showAddCard, setShowAddCard] = useState(false)
  const [deleteConfirmTx, setDeleteConfirmTx] = useState<any>(null)
  const [deleteConfirmCard, setDeleteConfirmCard] = useState<string | null>(null)
  const [editTx, setEditTx] = useState<any>(null)
  const [newCardNumber, setNewCardNumber] = useState('')
  const [newCardBank, setNewCardBank] = useState('')
  const [newCardBalance, setNewCardBalance] = useState('')
  const [newCardHolder, setNewCardHolder] = useState('')
  const [newCardBrand, setNewCardBrand] = useState<'uzcard' | 'humo' | 'visa' | 'mastercard'>('uzcard')
  const [editingCardId, setEditingCardId] = useState<string | null>(null)

  // Search & Filter states
  const [showSearchFilter, setShowSearchFilter] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('all')



  const handleAddCardSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newCardNumber || !newCardBank) return

    const cleanNum = newCardNumber.replace(/\s/g, '')
    
    if (cleanNum.length !== 16) {
      alert(lang === 'uz' ? "Karta raqamini to'liq kiritishingiz kerak (16 ta raqam)." : lang === 'uz_cyrl' ? "Карта рақамини тўлиқ киритишингиз керак (16 та рақам)." : lang === 'ru' ? "Необходимо ввести полный номер карты (16 цифр)." : "You must enter the full card number (16 digits).")
      return
    }

    const balanceValue = Number(newCardBalance.replace(/\D/g, '') || 0)

    if (editingCardId) {
      const currentBalance = getCardBalance(editingCardId)
      const difference = balanceValue - currentBalance

      const updated = cards.map(c => c.id === editingCardId ? {
        ...c,
        bank: newCardBank,
        number: newCardNumber,
        name: newCardHolder.toUpperCase() || 'JASUR TOSHMATOV',
        brand: newCardBrand,
        balance: c.balance // preserve existing initial balance
      } : c)
      saveCards(updated)

      if (difference !== 0) {
        addTransaction({
          id: Date.now(),
          type: difference > 0 ? 'income' : 'expense',
          amount: difference,
          category: difference > 0 ? 'Daromad' : 'Boshqa',
          note: lang === 'uz' ? "Karta balansi to'g'irlandi" : lang === 'uz_cyrl' ? "Карта баланси тўғирланди" : lang === 'ru' ? "Баланс карты скорректирован" : "Card balance adjusted",
          date: new Date().toISOString(),
          cardId: editingCardId
        })
      }
    } else {
      const newCardId = Date.now().toString()
      const newCard = {
        id: newCardId,
        bank: newCardBank,
        number: newCardNumber,
        name: newCardHolder.toUpperCase() || 'JASUR TOSHMATOV',
        balance: '0',
        brand: newCardBrand
      }
      const updated = [...cards, newCard]
      saveCards(updated)

      if (balanceValue > 0) {
        addTransaction({
          id: Date.now(),
          type: 'income',
          amount: balanceValue,
          category: 'Daromad',
          note: lang === 'uz' ? 'Karta qo\'shildi (boshlang\'ich balans)' : lang === 'uz_cyrl' ? 'Карта қўшилди (бошланғич баланс)' : lang === 'ru' ? 'Карта добавлена (начальный баланс)' : 'Card added (initial balance)',
          date: new Date().toISOString(),
          cardId: newCardId
        })
      }
    }

    setNewCardNumber('')
    setNewCardBank('')
    setNewCardBalance('')
    setNewCardHolder('')
    setNewCardBrand('uzcard')
    setEditingCardId(null)
    setShowAddCard(false)
  }

  const [showPremium, setShowPremium] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)

  // States for limit calculator modal
  const [showLimitModal, setShowLimitModal] = useState(false)
  const [selectedTx, setSelectedTx] = useState<any>(null)
  const [modalIncome, setModalIncome] = useState(onboarding?.monthlyIncome || 0)
  const [modalGoal, setModalGoal] = useState(onboarding?.monthlyGoal || 3000000)
  const [isDirectLimit, setIsDirectLimit] = useState(!onboarding?.monthlyIncome)

  const handleOpenLimitModal = () => {
    const hasIncome = !!onboarding?.monthlyIncome
    setModalIncome(onboarding?.monthlyIncome || 0)
    setModalGoal(onboarding?.monthlyGoal || 3000000)
    setIsDirectLimit(!hasIncome)
    setShowLimitModal(true)
  }

  
  const formatTxTime = (dateStr?: string) => {
    const bugunStr = lang === 'uz' ? 'Bugun' : lang === 'uz_cyrl' ? 'Бугун' : lang === 'ru' ? 'Сегодня' : 'Today';
    if (!dateStr) return bugunStr;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return bugunStr;
    const now = new Date();
    const isToday = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    
    if (isToday) {
      return bugunStr + ', ' + d.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    
    return d.toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'uz-UZ', { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'uz-UZ', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  const firstExpense = onboarding?.firstExpense

  const mappedCustom = customTransactions.map((t, idx) => {
    const cleanAmt = Number(String(t.amount).replace(/\s/g, '').replace(/,/g, '')) || 0
    const isNegative = cleanAmt < 0
    return {
      id: t.id || `custom-${idx}`,
      type: t.type,
      name: t.title || t.debtWho || t.note || t.category,
      category: t.category,
      amount: cleanAmt,
      time: formatTxTime(t.date || new Date().toISOString()),
      emoji: categoryEmoji[t.category] || (t.type === 'expense' ? '🛒' : t.type === 'income' ? '💼' : t.type === 'debt' ? '⟳' : '⟲'),
      color: isNegative ? '#FEF2F2' : '#F0FDF4',
      dot: isNegative ? '#DC2626' : '#16A34A',
      note: t.note,
      isCustom: true,
      date: t.date,
      cardId: t.cardId,
    }
  })

  const transactions = [
    ...mappedCustom,
    ...(firstExpense ? [
      {
        id: 'first-expense-0',
        type: 'expense',
        name: 'Birinchi xarajat',
        category: firstExpense.category,
        amount: -firstExpense.amount,
        time: formatTxTime(firstExpense.date || new Date().toISOString()),
        emoji: categoryEmoji[firstExpense.category] ?? '✨',
        color: '#FEF2F2',
        dot: '#DC2626',
        isCustom: true,
        date: firstExpense.date || new Date().toISOString(),
      }
    ] : []),
    ...(hasSampleData ? baseTransactions.map(t => ({ ...t, isCustom: true, date: new Date(Date.now() - 3600000 * 2).toISOString(), time: formatTxTime(new Date(Date.now() - 3600000 * 2).toISOString()) })) : []),
  ].filter(t => !deletedTxIds?.includes(String(t.id)))

  const now = new Date()
  const upcomingTransactions = transactions.filter(t => t.date && new Date(t.date) > now).sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime())
  const pastTransactions = transactions.filter(t => !t.date || new Date(t.date) <= now)

  const getTxTime = (tx: typeof transactions[0]) => {
    if (tx.date) {
      const d = new Date(tx.date)
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }
    return tx.time || ''
  }

  const getGroupDate = (tx: typeof transactions[0]) => {
    const bugunStr = lang === 'uz' ? 'Bugun' : lang === 'uz_cyrl' ? 'Бугун' : lang === 'ru' ? 'Сегодня' : 'Today';
    if (tx.date) {
      const d = new Date(tx.date)
      const monthsUz = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr']
      const monthsUzCyrl = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
      const monthsRu = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
      const monthsEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      const months = lang === 'uz_cyrl' ? monthsUzCyrl : lang === 'ru' ? monthsRu : lang === 'en' ? monthsEn : monthsUz;
      return `${d.getDate()}-${months[d.getMonth()]}`
    }
    return bugunStr
  }

  const sortedPastTransactions = [...pastTransactions].sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
  
  const filteredPastTransactions = sortedPastTransactions.filter(tx => {
    const txNote = (tx as any).note || (tx as any).name || ''
    const matchesSearch = !searchQuery || txNote.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = selectedCategoryFilter === 'all' || tx.category === selectedCategoryFilter
    return matchesSearch && matchesCategory
  })

  const pastGroupsArray = Object.entries(filteredPastTransactions.reduce((acc, tx) => {
    const key = getGroupDate(tx)
    if (!acc[key]) acc[key] = []
    acc[key].push(tx)
    return acc
  }, {} as Record<string, typeof transactions>))

  const getCardBalance = (cardId: string) => {
    const c = cards.find(x => x.id === cardId)
    if (!c) return 0
    const initial = Number(String(c.balance).replace(/\s/g, '').replace(/,/g, '')) || 0
    const cardTxs = pastTransactions.filter(t => (t as Transaction).cardId === cardId)
    const cardIncome = cardTxs.filter(t => Number(t.amount) > 0).reduce((acc, t) => acc + Number(t.amount), 0)
    const cardExpense = cardTxs.filter(t => Number(t.amount) < 0).reduce((acc, t) => acc + Math.abs(Number(t.amount)), 0)
    return initial + cardIncome - cardExpense
  }
  const totalExpense = pastTransactions.filter((t) => Number(t.amount) < 0).reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0)
  const totalIncome = pastTransactions.filter((t) => Number(t.amount) > 0).reduce((sum, t) => sum + Number(t.amount), 0)
  const initialCash = onboarding?.baseBalance || 0
  const cardsTotal = cards.reduce((sum, c) => {
    const val = Number(String(c.balance).replace(/\s/g, '').replace(/,/g, '')) || 0
    return sum + val
  }, 0)
  const baseBalance = initialCash + cardsTotal + totalIncome - totalExpense

  return (
    <div>
      <div style={{ height: 54 }} />

      {/* Header */}
      <div style={{ padding: '16px 20px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img 
            src="/logo.png" 
            alt="Moliya AI" 
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              objectFit: 'cover',
              boxShadow: '0 3px 10px rgba(124, 58, 237, 0.25)',
              border: '1.5px solid rgba(124, 58, 237, 0.18)',
              overflow: 'hidden',
              display: 'block'
            }} 
          />
          <span style={{ fontSize: 19, fontWeight: 800, color: '#1E1A3C', letterSpacing: -0.4 }}>Moliya AI</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => setShowPremium(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'linear-gradient(135deg, #FDF4FF 0%, #F5F3FF 100%)',
              border: '1.5px solid #F3E8FF',
              borderRadius: 14,
              padding: '8px 12px',
              cursor: 'pointer',
              fontWeight: 700,
              color: '#7C3AED',
              fontSize: 12,
              fontFamily: 'inherit',
              boxShadow: '0 2px 8px rgba(124, 58, 237, 0.04)',
              transition: 'all 0.2s ease',
            }}
          >
            <span>👑</span>
            <span>Premium</span>
          </button>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => {
                setShowNotifications(true)
                markAnnouncementsRead()
              }}
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                background: '#F6F5FA',
                border: '1.5px solid #E4E1F4',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(124, 58, 237, 0.03)',
                transition: 'all 0.2s ease',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
              </svg>
            </button>
            {hasNewAnnouncements && (
              <div style={{
                position: 'absolute',
                top: -2,
                right: -2,
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: '#EF4444',
                border: '2px solid #FFFFFF',
              }} />
            )}
          </div>
        </div>
      </div>

      {/* Balance card */}
      <div id="home_cards_section" style={{ padding: '0 20px 20px' }}>
        <div
          onClick={() => setShowWalletsModal(true)}
          style={{
            background: '#7C3AED',
            borderRadius: 22,
            padding: '24px 22px',
            position: 'relative',
            overflow: 'hidden',
            cursor: 'pointer',
            transition: 'transform 0.15s ease, box-shadow 0.15s ease',
            boxShadow: '0 10px 20px rgba(124, 58, 237, 0.2)',
          }}
          onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.98)' }}
          onMouseUp={(e) => { e.currentTarget.style.transform = 'none' }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'none' }}
        >
          {/* Subtle pattern */}
          <div style={{
            position: 'absolute', top: -40, right: -40, width: 140, height: 140,
            borderRadius: '50%', background: 'rgba(255,255,255,0.07)',
          }} />
          <div style={{
            position: 'absolute', bottom: -20, left: 40, width: 90, height: 90,
            borderRadius: '50%', background: 'rgba(255,255,255,0.05)',
          }} />

          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', marginBottom: 6, fontWeight: 500 }}>
            {t.totalBalance}
          </p>
          <h1 style={{ fontSize: 34, fontWeight: 700, color: '#fff', letterSpacing: -1, marginBottom: 22 }}>
            {fmtFull(baseBalance)} <span style={{ fontSize: 17, fontWeight: 500 }}>{t.currency}</span>
          </h1>

          <div style={{ display: 'flex', gap: 20 }}>
            <div>
              <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', marginBottom: 3 }}>{t.income}</p>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{fmt(totalIncome)}</p>
            </div>
            <div style={{ width: 1, background: 'rgba(255,255,255,0.15)' }} />
            <div>
              <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', marginBottom: 3 }}>{t.expense}</p>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#FCA5A5' }}>{fmt(-totalExpense)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Goal card (from onboarding) */}
      {onboarding && (() => {
        const isDirect = !onboarding.monthlyIncome;
        const spendLimit = isDirect 
          ? (onboarding.monthlyGoal || 7000000) 
          : ((onboarding.monthlyIncome || 10000000) - (onboarding.monthlyGoal || 3000000));
        const remainingLimit = spendLimit - totalExpense;
        const limitPct = Math.min(100, Math.max(0, Math.round((totalExpense / spendLimit) * 100)));
        const isOverLimit = remainingLimit < 0;

        return (
          <div style={{ padding: '0 20px 20px' }}>
            <div 
              onClick={handleOpenLimitModal}
              id="home_limit_section"
              style={{
                background: 'linear-gradient(135deg, #FAF9FD 0%, #F4F0FF 100%)',
                borderRadius: 20,
                padding: '18px 20px',
                border: '1.5px solid #E6DFFF',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                cursor: 'pointer',
                transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: '0 4px 14px rgba(124, 58, 237, 0.04)',
              }}
              onMouseEnter={(e) => { 
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 6px 20px rgba(124, 58, 237, 0.08)';
                e.currentTarget.style.borderColor = '#D8CFFF';
              }}
              onMouseLeave={(e) => { 
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 14px rgba(124, 58, 237, 0.04)';
                e.currentTarget.style.borderColor = '#E6DFFF';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 12, background: isOverLimit ? '#FEF2F2' : '#ECEAF6',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0,
                  boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.02)'
                }}>
                  {isOverLimit ? '⚠️' : '🎯'}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <p style={{ fontSize: 12, color: '#8B82C4', fontWeight: 600, letterSpacing: -0.1 }}>
                      {t.goalLabel}
                    </p>
                    <span style={{ 
                      fontSize: 11, 
                      fontWeight: 700, 
                      color: isOverLimit ? '#EF4444' : '#7C3AED',
                      background: isOverLimit ? '#FEE2E2' : '#EFEFFA',
                      padding: '2px 8px',
                      borderRadius: 20
                    }}>
                      {limitPct}%
                    </span>
                  </div>
                  <p style={{ fontSize: 16, fontWeight: 800, color: isOverLimit ? '#EF4444' : '#4C1D95', marginTop: 1 }}>
                    {isOverLimit ? (
                      lang === 'uz' ? `Limit oshib ketdi: ${fmtFull(Math.abs(remainingLimit))} ${t.currency}` :
                      lang === 'uz_cyrl' ? `Лимит ошиб кетди: ${fmtFull(Math.abs(remainingLimit))} ${t.currency}` :
                      lang === 'ru' ? `Лимит превышен: ${fmtFull(Math.abs(remainingLimit))} ${t.currency}` :
                      `Limit exceeded: ${fmtFull(Math.abs(remainingLimit))} ${t.currency}`
                    ) : (
                      lang === 'uz' ? `${fmtFull(remainingLimit)} ${t.currency} qoldi` :
                      lang === 'uz_cyrl' ? `${fmtFull(remainingLimit)} ${t.currency} қолди` :
                      lang === 'ru' ? `Осталось: ${fmtFull(remainingLimit)} ${t.currency}` :
                      `${fmtFull(remainingLimit)} ${t.currency} left`
                    )}
                  </p>
                </div>
                <div style={{
                  width: 26, height: 26, borderRadius: 8, background: '#FFFFFF',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7C3AED', fontSize: 12,
                  boxShadow: '0 2px 6px rgba(0,0,0,0.04)', border: '1px solid #ECE9F8'
                }}>
                  ✏️
                </div>
              </div>

              {/* Sleek Progress Bar */}
              <div style={{ width: '100%' }}>
                <div style={{ 
                  height: 8, 
                  borderRadius: 6, 
                  background: '#EAE6F8', 
                  overflow: 'hidden', 
                  position: 'relative',
                  boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)'
                }}>
                  <div style={{ 
                    width: `${limitPct}%`, 
                    height: '100%', 
                    background: isOverLimit ? 'linear-gradient(90deg, #EF4444, #F87171)' : 'linear-gradient(90deg, #7C3AED, #9333EA)', 
                    borderRadius: 6, 
                    transition: 'width 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
                  }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                  <p style={{ fontSize: 10.5, color: '#9B92D4', fontWeight: 500 }}>
                    {lang === 'uz' ? 'Sarflandi' : lang === 'uz_cyrl' ? 'Сарфланди' : lang === 'ru' ? 'Потрачено' : 'Spent'}: <span style={{ fontWeight: 600, color: '#6B5FA8' }}>{fmtFull(totalExpense)} {t.currency}</span>
                  </p>
                  <p style={{ fontSize: 10.5, color: '#9B92D4', fontWeight: 500 }}>
                    {isDirect ? (
                      lang === 'uz' ? 'Jami limit' : lang === 'uz_cyrl' ? 'Жами лимит' : lang === 'ru' ? 'Общий лимит' : 'Total limit'
                    ) : (
                      lang === 'uz' ? 'Oylik maqsad' : lang === 'uz_cyrl' ? 'Ойлик мақсад' : lang === 'ru' ? 'Месячная цель' : 'Monthly goal'
                    )}: <span style={{ fontWeight: 600, color: '#6B5FA8' }}>{fmtFull(spendLimit)} {t.currency}</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Upcoming Transactions (Kutilayotgan xarajatlar) */}
      {upcomingTransactions.length > 0 && (
        <div style={{ padding: '0 20px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1E1A3C', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>🕒</span>
              {lang === 'uz' ? 'Kutilayotgan xarajatlar' : lang === 'uz_cyrl' ? 'Кутилаётган харажатлар' : lang === 'ru' ? 'Ожидаемые расходы' : 'Upcoming Expenses'}
              <span style={{ fontSize: 11, background: '#7C3AED', color: 'white', borderRadius: '12px', padding: '2px 8px', fontWeight: 600 }}>
                {upcomingTransactions.length}
              </span>
            </h3>
          </div>
          <div
            style={{
              background: '#F0EEFC',
              borderRadius: 20,
              border: '1.5px dashed #CBBFF2',
              overflow: 'hidden',
            }}
          >
            {upcomingTransactions.map((tx: any, i) => {
              const nameProp = tx.name || tx.note || 'Operatsiya'
              const rawName = t.transactionNames[nameProp as keyof typeof t.transactionNames] || nameProp; const txName = rawName.length > 25 ? rawName.slice(0, 25) + '...' : rawName;
              const txCat = t.categories[tx.category as keyof typeof t.categories] || tx.category
              return (
                <motion.div
                  key={tx.id}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setSelectedTx(tx)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '14px 16px',
                    borderBottom: i < upcomingTransactions.length - 1 ? '1px dashed #CBBFF2' : 'none',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{
                    width: 42, height: 42, borderRadius: 13, background: tx.color || '#E8E5F8',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, flexShrink: 0,
                  }}>
                    {tx.emoji || '💳'}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                      <p style={{ fontSize: 15, fontWeight: 600, color: '#1E1A3C' }}>{txName}</p>
                      <p style={{ fontSize: 15, fontWeight: 700, color: Number(tx.amount) > 0 ? '#16A34A' : '#DC2626' }}>
                        {fmt(Number(tx.amount))} {t.currency}
                      </p>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <p style={{ fontSize: 12, color: '#8B82C4', fontWeight: 500 }}>{txCat}</p>
                      <p style={{ fontSize: 11, color: '#7C3AED', fontWeight: 600 }}>
                        {getGroupDate(tx)} {getTxTime(tx)}
                      </p>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {/* Transactions */}
      <div id="home_tx_section" style={{ padding: '0 20px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1E1A3C' }}>{t.recentTransactions}</h3>
          <button 
            onClick={() => setShowSearchFilter(!showSearchFilter)}
            style={{
              background: 'none', border: 'none', fontSize: 13, color: '#7C3AED',
              fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
            }}
          >
            {showSearchFilter ? (lang === 'uz' ? 'Yopish' : lang === 'uz_cyrl' ? 'Ёпиш' : lang === 'ru' ? 'Скрыть' : 'Close') : t.viewAll}
          </button>
        </div>

        {/* Search & Category Filter Bar */}
        {showSearchFilter && (
          <div style={{ marginBottom: 16 }}>
            {/* Search Input */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: '#F5F4FA', borderRadius: 14, padding: '10px 14px',
              border: '1.5px solid #E4E2F0', marginBottom: 10
            }}>
              <span style={{ fontSize: 14, color: '#8B82C4' }}>🔍</span>
              <input
                type="text"
                placeholder={lang === 'uz' ? "Tranzaksiyalarni qidirish..." : lang === 'uz_cyrl' ? "Транзакцияларни қидириш..." : lang === 'ru' ? "Поиск транзакций..." : "Search transactions..."}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  flex: 1, background: 'none', border: 'none', outline: 'none',
                  fontSize: 13, fontWeight: 500, color: '#1E1A3C', fontFamily: 'inherit'
                }}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} style={{ background: 'none', border: 'none', fontSize: 14, color: '#8B82C4', cursor: 'pointer' }}>✕</button>
              )}
            </div>

            {/* Category filter pills */}
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
              {['all', 'Oziq-ovqat', 'Transport', "Ko'ngil ochar", 'Kommunal', 'Daromad', 'Boshqa'].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategoryFilter(cat)}
                  style={{
                    padding: '5px 12px', borderRadius: 20, border: '1px solid',
                    borderColor: selectedCategoryFilter === cat ? '#7C3AED' : '#E4E2F0',
                    background: selectedCategoryFilter === cat ? '#7C3AED' : '#FFFFFF',
                    color: selectedCategoryFilter === cat ? '#FFFFFF' : '#5C548A',
                    fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                    fontFamily: 'inherit'
                  }}
                >
                  {cat === 'all' ? (lang === 'uz' ? 'Barchasi' : lang === 'uz_cyrl' ? 'Барчаси' : lang === 'ru' ? 'Все' : 'All') : cat}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {pastGroupsArray.map(([dateLabel, txs]) => (
            <div key={dateLabel}>
              <h4 style={{ fontSize: 13, fontWeight: 600, color: '#8B82C4', marginBottom: 8, paddingLeft: 4 }}>
                {dateLabel}
              </h4>
              <div
                style={{
                  background: '#F5F4FA',
                  borderRadius: 20,
                  border: '1.5px solid #E4E2F0',
                  overflow: 'hidden',
                }}
              >
                {txs.map((tx: any, i) => {
                  const nameProp = tx.name || tx.note || 'Operatsiya'
                  const rawName = t.transactionNames[nameProp as keyof typeof t.transactionNames] || nameProp; const txName = rawName.length > 25 ? rawName.slice(0, 25) + '...' : rawName;
                  const txCat = t.categories[tx.category as keyof typeof t.categories] || tx.category
                  
                  return (
                    <motion.div
                      key={tx.id}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setSelectedTx(tx)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 14,
                        padding: '14px 16px',
                        borderBottom: i < txs.length - 1 ? '1px solid #E4E2F0' : 'none',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{
                        width: 42, height: 42, borderRadius: 13, background: tx.color || '#E8E5F8',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 18, flexShrink: 0,
                      }}>
                        {tx.emoji || '💳'}
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: 14, fontWeight: 600, color: '#1E1A3C', marginBottom: 2 }}>{txName}</p>
                        <p style={{ fontSize: 12, color: '#8B82C4' }}>{getTxTime(tx)}</p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ fontSize: 14, fontWeight: 700, color: Number(tx.amount) > 0 ? '#16A34A' : '#1E1A3C' }}>
                          {fmt(Number(tx.amount))}
                        </p>
                        <p style={{ fontSize: 11, color: '#B8B0DC' }}>{txCat}</p>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      
      {/* Premium Modal */}
      <AnimatePresence>
        {showPremium && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPremium(false)}
              style={{
                position: 'absolute', inset: 0,
                background: 'rgba(30, 26, 60, 0.45)', backdropFilter: 'blur(4px)'
              }}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={0.5}
              onDragEnd={(_: any, info: any) => {
                if (info.offset.y > 100) setShowPremium(false)
              }}
              transition={{ type: 'spring', damping: 26, stiffness: 220 }}
              style={{
                position: 'relative',
                background: '#FFFFFF', width: '100%', maxWidth: 440,
                borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: '16px 20px 40px',
                boxShadow: '0 -10px 40px rgba(0,0,0,0.15)',
                maxHeight: '90dvh', overflowY: 'auto', zIndex: 1001
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ width: 28 }} />
                <div style={{ width: 40, height: 4, background: '#E8E3F8', borderRadius: 2, cursor: 'grab' }} />
                <button
                  onClick={() => setShowPremium(false)}
                  style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: '#F5F4FA', border: 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, color: '#5C548A', cursor: 'pointer', fontWeight: 700
                  }}
                >
                  ✕
                </button>
              </div>

              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1E1A3C', marginBottom: 16 }}>
                {t.premiumTitle}
              </h3>

              <div style={{
                background: 'linear-gradient(135deg, #7C3AED 0%, #C084FC 100%)',
                borderRadius: 20, padding: '22px 20px', color: '#FFFFFF',
                position: 'relative', overflow: 'hidden', marginBottom: 24,
                boxShadow: '0 8px 24px rgba(124, 58, 237, 0.2)'
              }}>
                <div style={{
                  position: 'absolute', top: -30, right: -30, width: 120, height: 120,
                  borderRadius: '50%', background: 'rgba(255, 255, 255, 0.1)'
                }} />
                <span style={{
                  background: 'rgba(255, 255, 255, 0.2)', fontSize: 11, fontWeight: 700,
                  padding: '4px 8px', borderRadius: 20, display: 'inline-block', marginBottom: 12,
                  textTransform: 'uppercase', letterSpacing: 0.5
                }}>
                  {t.premiumStatus}
                </span>
                <h4 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>{t.premiumSubtitle}</h4>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 30 }}>
                {t.premiumBenefits.map((b: string, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: '50%', background: '#F5F3FF',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                    }}>
                      <span style={{ color: '#7C3AED', fontSize: 12, fontWeight: 700 }}>✓</span>
                    </div>
                    <span style={{ fontSize: 14, color: '#4B456D', fontWeight: 500 }}>{b}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={() => setShowPremium(false)}
                style={{
                  width: '100%', padding: '15px', borderRadius: 16, border: 'none',
                  background: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)',
                  color: '#FFFFFF', fontSize: 15, fontWeight: 700, cursor: 'pointer',
                  fontFamily: 'inherit', boxShadow: '0 4px 16px rgba(124, 58, 237, 0.25)'
                }}
              >
                {t.premiumActiveBtn}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Notifications Modal */}
      <AnimatePresence>
        {showNotifications && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowNotifications(false)}
              style={{
                position: 'absolute', inset: 0,
                background: 'rgba(30, 26, 60, 0.45)', backdropFilter: 'blur(4px)'
              }}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={0.5}
              onDragEnd={(_: any, info: any) => {
                if (info.offset.y > 100) setShowNotifications(false)
              }}
              transition={{ type: 'spring', damping: 26, stiffness: 220 }}
              style={{
                position: 'relative',
                background: '#FFFFFF', width: '100%', maxWidth: 440,
                borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: '16px 20px 40px',
                boxShadow: '0 -10px 40px rgba(0,0,0,0.15)',
                maxHeight: '90dvh', overflowY: 'auto', zIndex: 1001
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ width: 28 }} />
                <div style={{ width: 40, height: 4, background: '#E8E3F8', borderRadius: 2, cursor: 'grab' }} />
                <button
                  onClick={() => setShowNotifications(false)}
                  style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: '#F5F4FA', border: 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, color: '#5C548A', cursor: 'pointer', fontWeight: 700
                  }}
                >
                  ✕
                </button>
              </div>

              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1E1A3C', marginBottom: 18 }}>
                {t.notificationsTitle}
              </h3>

              {announcements.length === 0 ? (
                <div style={{ padding: '36px 16px', textAlign: 'center' }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: '50%',
                    background: '#F5F3FF', color: '#7C3AED',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 26, margin: '0 auto 14px'
                  }}>
                    🔔
                  </div>
                  <p style={{ fontSize: 15, fontWeight: 700, color: '#1E1A3C', marginBottom: 6 }}>
                    {t.notificationsEmpty}
                  </p>
                  <p style={{ fontSize: 12.5, color: '#8B82C4', lineHeight: 1.4 }}>
                    {(lang === 'uz' || lang === 'uz_cyrl')
                      ? (lang === 'uz_cyrl' ? 'Тизим хабарлари ва эслатмалар шу ерда кўринади' : "Tizim xabarlari va eslatmalar shu yerda ko'rinadi")
                      : lang === 'ru'
                      ? 'Системные сообщения и напоминания появятся здесь'
                      : 'System notifications and reminders will appear here'}
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {announcements.map((not, idx) => (
                    <div key={not.id || idx} style={{
                      display: 'flex', flexDirection: 'column', gap: 10, padding: '16px', borderRadius: 16,
                      background: '#F9F8FF', border: '1px solid #F3F0FF'
                    }}>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                        <div style={{
                          width: 38, height: 38, borderRadius: 12, background: '#F5F3FF',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 18, flexShrink: 0
                        }}>
                          {not.emoji || '📢'}
                        </div>
                        <div style={{ flex: 1 }}>
                          <p style={{ fontSize: 14, fontWeight: 700, color: '#1E1A3C', marginBottom: 4, lineHeight: 1.3 }}>
                            {not.title}
                          </p>
                          <p style={{ fontSize: 13, color: '#5C548A', lineHeight: 1.45, marginBottom: 4 }}>
                            {not.message}
                          </p>
                          {not.created_at && (
                            <p style={{ fontSize: 11, color: '#B8B0DC' }}>
                              {new Date(not.created_at).toLocaleDateString('uz-UZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </p>
                          )}
                        </div>
                      </div>

                      {not.image_url && (
                        <img
                          src={not.image_url}
                          alt={not.title}
                          style={{ width: '100%', borderRadius: 12, maxHeight: 180, objectFit: 'cover', marginTop: 4 }}
                        />
                      )}

                      {not.action_url && (
                        <button
                          onClick={() => window.open(not.action_url, '_blank')}
                          style={{
                            padding: '8px 14px', borderRadius: 10, border: 'none',
                            background: '#7C3AED', color: '#FFFFFF', fontSize: 12.5, fontWeight: 600,
                            cursor: 'pointer', alignSelf: 'flex-start', marginTop: 2
                          }}
                        >
                          {lang === 'uz' ? "Batafsil ko'rish 🔗" : lang === 'ru' ? 'Подробнее 🔗' : 'View Details 🔗'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Limit & Savings Calculator Modal */}
      <AnimatePresence>
        {showLimitModal && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowLimitModal(false)}
              style={{
                position: 'absolute', inset: 0,
                background: 'rgba(30, 26, 60, 0.45)', backdropFilter: 'blur(4px)'
              }}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={0.5}
              onDragEnd={(_: any, info: any) => {
                if (info.offset.y > 100) setShowLimitModal(false)
              }}
              transition={{ type: 'spring', damping: 26, stiffness: 220 }}
              style={{
                position: 'relative',
                background: '#FFFFFF', width: '100%', maxWidth: 440,
                borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: '16px 20px 32px',
                boxShadow: '0 -10px 40px rgba(0,0,0,0.15)',
                maxHeight: '90dvh', overflowY: 'auto', zIndex: 1001
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ width: 28 }} />
                <div style={{ width: 40, height: 4, background: '#E8E3F8', borderRadius: 2, cursor: 'grab' }} />
                <button
                  onClick={() => setShowLimitModal(false)}
                  style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: '#F5F4FA', border: 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, color: '#5C548A', cursor: 'pointer', fontWeight: 700
                  }}
                >
                  ✕
                </button>
              </div>

              <h3 style={{ fontSize: 18, fontWeight: 800, color: '#1E1A3C', marginBottom: 12 }}>
                {t.limitModalTitle}
              </h3>
              
              <p style={{ fontSize: 12, color: '#8B82C4', lineHeight: 1.5, marginBottom: 16 }}>
                {t.limitModalDesc}
              </p>

              {/* Tab Selection */}
              <div style={{
                display: 'flex',
                background: '#F5F4FA',
                padding: 4,
                borderRadius: 14,
                marginBottom: 20,
                border: '1px solid #E4E2F0'
              }}>
                <button
                  type="button"
                  onClick={() => setIsDirectLimit(true)}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: 'none',
                    background: isDirectLimit ? '#FFFFFF' : 'transparent',
                    color: isDirectLimit ? '#7C3AED' : '#5C548A',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    boxShadow: isDirectLimit ? '0 2px 6px rgba(124,58,237,0.06)' : 'none',
                    transition: 'all 0.2s ease'
                  }}
                >
                  {lang === 'uz' ? 'Oddiy limit' : lang === 'uz_cyrl' ? 'Оддий лимит' : lang === 'ru' ? 'Простой лимит' : 'Direct Limit'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsDirectLimit(false)}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: 'none',
                    background: !isDirectLimit ? '#FFFFFF' : 'transparent',
                    color: !isDirectLimit ? '#7C3AED' : '#5C548A',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    boxShadow: !isDirectLimit ? '0 2px 6px rgba(124,58,237,0.06)' : 'none',
                    transition: 'all 0.2s ease'
                  }}
                >
                  {lang === 'uz' ? 'Kalkulyator' : lang === 'uz_cyrl' ? 'Калькулятор' : lang === 'ru' ? 'Калькулятор' : 'Calculator'}
                </button>
              </div>

              {isDirectLimit ? (
                /* Direct Limit Setting */
                <div style={{ marginBottom: 20 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#5C548A', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                    {lang === 'uz' ? 'Oylik xarajat limiti' : lang === 'uz_cyrl' ? 'Ойлик харажат лимити' : lang === 'ru' ? 'Ежемесячный лимит расходов' : 'Monthly Spending Limit'}
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="tel"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={modalGoal ? modalGoal.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : ''}
                      onChange={(e) => setModalGoal(Math.max(0, parseInt(e.target.value.replace(/\D/g, '')) || 0))}
                      style={{
                        width: '100%', padding: '12px 16px', borderRadius: 12,
                        border: '1.5px solid #E4E2F0', fontFamily: 'inherit', fontSize: 15,
                        fontWeight: 600, color: '#1E1A3C', outline: 'none', background: '#F9F8FC'
                      }}
                    />
                    <span style={{ position: 'absolute', right: 16, top: 12, fontSize: 14, fontWeight: 600, color: '#8B82C4' }}>
                      {t.currency}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, overflowX: 'auto', paddingBottom: 2 }}>
                    {[1000000, 3000000, 5000000, 7000000, 10000000].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setModalGoal(val)}
                        style={{
                          padding: '4px 10px', fontSize: 11, fontWeight: 600,
                          borderRadius: 20, border: '1px solid #E4E2F0',
                          background: modalGoal === val ? '#7C3AED' : '#FFFFFF',
                          color: modalGoal === val ? '#FFFFFF' : '#5C548A',
                          cursor: 'pointer', whiteSpace: 'nowrap'
                        }}
                      >
                        {fmtFull(val)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                /* Calculated Limit mode */
                <>
                  {/* Income field */}
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#5C548A', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                      {t.incomeLabel}
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type="tel"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={modalIncome ? modalIncome.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : ''}
                        onChange={(e) => setModalIncome(Math.max(0, parseInt(e.target.value.replace(/\D/g, '')) || 0))}
                        style={{
                          width: '100%', padding: '12px 16px', borderRadius: 12,
                          border: '1.5px solid #E4E2F0', fontFamily: 'inherit', fontSize: 15,
                          fontWeight: 600, color: '#1E1A3C', outline: 'none', background: '#F9F8FC'
                        }}
                      />
                      <span style={{ position: 'absolute', right: 16, top: 12, fontSize: 14, fontWeight: 600, color: '#8B82C4' }}>
                        {t.currency}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, overflowX: 'auto', paddingBottom: 2 }}>
                      {[5000000, 10000000, 15000000, 20000000].map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setModalIncome(val)}
                          style={{
                            padding: '4px 10px', fontSize: 11, fontWeight: 600,
                            borderRadius: 20, border: '1px solid #E4E2F0',
                            background: modalIncome === val ? '#7C3AED' : '#FFFFFF',
                            color: modalIncome === val ? '#FFFFFF' : '#5C548A',
                            cursor: 'pointer', whiteSpace: 'nowrap'
                          }}
                        >
                          {fmtFull(val)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Saving field */}
                  <div style={{ marginBottom: 24 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#5C548A', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                      {t.savingLabel}
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type="tel"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={modalGoal ? modalGoal.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : ''}
                        onChange={(e) => setModalGoal(Math.max(0, parseInt(e.target.value.replace(/\D/g, '')) || 0))}
                        style={{
                          width: '100%', padding: '12px 16px', borderRadius: 12,
                          border: '1.5px solid #E4E2F0', fontFamily: 'inherit', fontSize: 15,
                          fontWeight: 600, color: '#1E1A3C', outline: 'none', background: '#F9F8FC'
                        }}
                      />
                      <span style={{ position: 'absolute', right: 16, top: 12, fontSize: 14, fontWeight: 600, color: '#8B82C4' }}>
                        {t.currency}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, overflowX: 'auto', paddingBottom: 2 }}>
                      {[1000000, 2000000, 3000000, 5000000].map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setModalGoal(val)}
                          style={{
                            padding: '4px 10px', fontSize: 11, fontWeight: 600,
                            borderRadius: 20, border: '1px solid #E4E2F0',
                            background: modalGoal === val ? '#7C3AED' : '#FFFFFF',
                            color: modalGoal === val ? '#FFFFFF' : '#5C548A',
                            cursor: 'pointer', whiteSpace: 'nowrap'
                          }}
                        >
                          {fmtFull(val)}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Results */}
              <div style={{
                background: '#F5F4FA', borderRadius: 16, padding: '16px',
                border: '1.5px solid #E4E2F0', marginBottom: 24
              }}>
                <h4 style={{ fontSize: 12, fontWeight: 700, color: '#8B82C4', textTransform: 'uppercase', marginBottom: 12 }}>
                  {isDirectLimit 
                    ? (lang === 'uz' ? 'Belgilangan limit tafsiloti' : lang === 'uz_cyrl' ? 'Белгиланган лимит тафсилоти' : lang === 'ru' ? 'Детали установленного лимита' : 'Configured Limit Details')
                    : t.calculatedLimitLabel
                  }
                </h4>
                
                {(() => {
                  const limitVal = isDirectLimit ? modalGoal : Math.max(0, modalIncome - modalGoal);
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {/* Monthly */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 13, color: '#5C548A', fontWeight: 500 }}>
                          {lang === 'uz' ? 'Oylik limit' : lang === 'uz_cyrl' ? 'Ойлик лимит' : lang === 'ru' ? 'Месячный лимит' : 'Monthly Limit'}
                        </span>
                        <span style={{ fontSize: 15, fontWeight: 700, color: '#7C3AED' }}>
                          {fmtFull(limitVal)} {t.currency}
                        </span>
                      </div>

                      {/* Weekly */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 13, color: '#5C548A', fontWeight: 500 }}>
                          {t.weeklyLimitLabel}
                        </span>
                        <span style={{ fontSize: 14, fontWeight: 600, color: '#1E1A3C' }}>
                          {fmtFull(Math.round(limitVal / 4))} {t.currency}
                        </span>
                      </div>

                      {/* Daily */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 13, color: '#5C548A', fontWeight: 500 }}>
                          {t.dailyLimitLabel}
                        </span>
                        <span style={{ fontSize: 14, fontWeight: 600, color: '#1E1A3C' }}>
                          {fmtFull(Math.round(limitVal / 30))} {t.currency}
                        </span>
                      </div>
                    </div>
                  );
                })()}

                <p style={{ fontSize: 11, color: '#9B92D4', lineHeight: 1.4, marginTop: 12, borderTop: '1px solid #EAE8F6', paddingTop: 10 }}>
                  {t.spendInfo}
                </p>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  onClick={() => setShowLimitModal(false)}
                  style={{
                    flex: 1, padding: 14,
                    background: '#F5F4FA', color: '#1E1A3C',
                    border: 'none', borderRadius: 14,
                    fontSize: 15, fontWeight: 600, cursor: 'pointer'
                  }}
                >
                  {lang === 'uz' ? 'Bekor qilish' : lang === 'uz_cyrl' ? 'Бекор қилиш' : lang === 'ru' ? 'Отмена' : 'Cancel'}
                </button>
                <button
                  onClick={async () => {
                    if (onUpdateOnboarding) {
                      onUpdateOnboarding(
                        isDirectLimit
                          ? { monthlyGoal: modalGoal, monthlyIncome: undefined }
                          : { monthlyIncome: modalIncome, monthlyGoal: modalGoal }
                      )
                    }
                    setShowLimitModal(false);
                  }}
                  style={{
                    flex: 1, padding: 14,
                    background: '#7C3AED', color: '#fff',
                    border: 'none', borderRadius: 14,
                    fontSize: 15, fontWeight: 600, cursor: 'pointer'
                  }}
                >
                  {lang === 'uz' ? 'Saqlash' : lang === 'uz_cyrl' ? 'Сақлаш' : lang === 'ru' ? 'Сохранить' : 'Save'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

        {/* Wallets Modal */}
        <AnimatePresence>
          {showWalletsModal && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 99998, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowWalletsModal(false)}
                style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(0,0,0,0.4)',
                  backdropFilter: 'blur(4px)'
                }}
              />
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                drag="y"
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={0.5}
                onDragEnd={(_: any, info: any) => {
                  if (info.offset.y > 100) setShowWalletsModal(false)
                }}
                transition={{ type: 'spring', damping: 26, stiffness: 220 }}
                style={{
                  position: 'relative',
                  background: '#fff',
                  width: '100%', maxWidth: 440,
                  borderTopLeftRadius: 28,
                  borderTopRightRadius: 28,
                  padding: '16px 24px 40px',
                  maxHeight: '85vh',
                  overflowY: 'auto'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ width: 28 }} />
                  <div style={{ width: 40, height: 4, background: '#E8E3F8', borderRadius: 2, cursor: 'grab' }} />
                  <button
                    onClick={() => setShowWalletsModal(false)}
                    style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: '#F5F4FA', border: 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, color: '#5C548A', cursor: 'pointer', fontWeight: 700
                    }}
                  >
                    ✕
                  </button>
                </div>

                <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1E1A3C', marginBottom: 16 }}>
                  {lang === 'uz' ? 'Hamyonlar' : lang === 'uz_cyrl' ? 'Ҳамёнлар' : lang === 'ru' ? 'Кошельки' : 'Wallets'}
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {cards.map((c, i) => (
                    <BankCard 
                      key={i}
                      id={c.id}
                      bank={c.bank}
                      number={c.number}
                      name={c.name}
                      brand={c.brand || 'uzcard'}
                      balance={getCardBalance(c.id)}
                      currency={t.currency}
                      editLabel={lang === 'uz' ? 'Tahrirlash' : lang === 'uz_cyrl' ? 'Таҳрирлаш' : lang === 'ru' ? 'Изменить' : 'Edit'}
                      deleteLabel={lang === 'uz' ? 'O\'chirish' : lang === 'uz_cyrl' ? 'Ўчириш' : lang === 'ru' ? 'Удалить' : 'Delete'}
                      onEdit={() => {
                        setEditingCardId(c.id)
                        setNewCardBank(c.bank)
                        setNewCardNumber(c.number)
                        setNewCardHolder(c.name)
                        setNewCardBalance(c.balance.toString())
                        setShowWalletsModal(false)
                        setShowAddCard(true)
                      }}
                      onDelete={() => {
                        setDeleteConfirmCard(c.id)
                      }}
                    />
                  ))}
                </div>

                <button
                  onClick={async () => { setShowWalletsModal(false); setShowAddCard(true); }}
                  style={{
                    width: '100%', padding: 16, marginTop: 24,
                    background: '#F0EEFC', color: '#7C3AED',
                    border: 'none', borderRadius: 16,
                    fontSize: 15, fontWeight: 600, cursor: 'pointer'
                  }}
                >
                  {lang === 'uz' ? '+ Karta qo\'shish' : lang === 'uz_cyrl' ? '+ Карта қўшиш' : lang === 'ru' ? '+ Добавить карту' : '+ Add Card'}
                </button>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Add Card Modal */}
        <AnimatePresence>
          {showAddCard && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowAddCard(false)}
                style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(0,0,0,0.4)',
                  backdropFilter: 'blur(4px)'
                }}
              />
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                drag="y"
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={0.5}
                onDragEnd={(_: any, info: any) => {
                  if (info.offset.y > 100) setShowAddCard(false)
                }}
                transition={{ type: 'spring', damping: 26, stiffness: 220 }}
                style={{
                  position: 'relative',
                  background: '#fff',
                  width: '100%', maxWidth: 440,
                  borderTopLeftRadius: 28,
                  borderTopRightRadius: 28,
                  padding: '16px 24px 40px',
                  maxHeight: '90vh',
                  overflowY: 'auto'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div style={{ width: 28 }} />
                  <div style={{ width: 40, height: 4, background: '#E8E3F8', borderRadius: 2, cursor: 'grab' }} />
                  <button
                    onClick={() => setShowAddCard(false)}
                    style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: '#F5F4FA', border: 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, color: '#5C548A', cursor: 'pointer', fontWeight: 700
                    }}
                  >
                    ✕
                  </button>
                </div>

                <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1E1A3C', marginBottom: 20 }}>
                  {lang === 'uz' ? 'Yangi karta qo\'shish' : lang === 'uz_cyrl' ? 'Янги карта қўшиш' : lang === 'ru' ? 'Добавить новую карту' : 'Add New Card'}
                </h3>

                <form onSubmit={handleAddCardSubmit}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, color: '#8B82C4', marginBottom: 6, display: 'block' }}>{lang === 'uz' ? 'Bank nomi' : lang === 'uz_cyrl' ? 'Банк номи' : lang === 'ru' ? 'Название банка' : 'Bank name'}</label>
                      <input
                        type="text" required
                        value={newCardBank} onChange={(e) => setNewCardBank(e.target.value)}
                        style={{ width: '100%', padding: '14px 16px', borderRadius: 14, border: '1.5px solid #E4E2F0', fontSize: 15, fontWeight: 500, color: '#1E1A3C' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, color: '#8B82C4', marginBottom: 6, display: 'block' }}>{lang === 'uz' ? 'Karta raqami' : lang === 'uz_cyrl' ? 'Карта рақами' : lang === 'ru' ? 'Номер карты' : 'Card number'}</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        required maxLength={19}
                        value={newCardNumber}
                        onChange={(e) => {
                          let v = e.target.value.replace(/\D/g, '')
                          if (v.length > 16) v = v.slice(0, 16)
                          let formatted = v.match(/.{1,4}/g)?.join(' ') || v
                          setNewCardNumber(formatted)
                          if (v.length >= 4) {
                            if (v.startsWith('8600')) setNewCardBrand('uzcard')
                            else if (v.startsWith('9860')) setNewCardBrand('humo')
                            else if (v.startsWith('4')) setNewCardBrand('visa')
                            else if (v.startsWith('5')) setNewCardBrand('mastercard')
                          }
                        }}
                        style={{ width: '100%', padding: '14px 16px', borderRadius: 14, border: '1.5px solid #E4E2F0', fontSize: 15, fontWeight: 500, color: '#1E1A3C' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, color: '#8B82C4', marginBottom: 6, display: 'block' }}>{lang === 'uz' ? 'Karta Turi (Rang)' : lang === 'uz_cyrl' ? 'Карта тури (Ранг)' : lang === 'ru' ? 'Тип карты (Цвет)' : 'Card Type (Color)'}</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {[
                          { id: 'uzcard', label: 'Uzcard', bg: 'linear-gradient(135deg, #1A2980 0%, #26D0CE 100%)' },
                          { id: 'humo', label: 'Humo', bg: 'linear-gradient(135deg, #FF416C 0%, #FF4B2B 100%)' },
                          { id: 'visa', label: 'Visa', bg: 'linear-gradient(135deg, #141E30 0%, #243B55 100%)' },
                          { id: 'mastercard', label: 'Mastercard', bg: 'linear-gradient(135deg, #FFB75E 0%, #ED8F03 100%)' }
                        ].map(brand => (
                          <button
                            key={brand.id}
                            type="button"
                            onClick={() => setNewCardBrand(brand.id as any)}
                            style={{
                              flex: 1, padding: '8px 4px', borderRadius: 10,
                              background: newCardBrand === brand.id ? brand.bg : '#F4F3FA',
                              color: newCardBrand === brand.id ? '#FFFFFF' : '#6E6893',
                              border: newCardBrand === brand.id ? 'none' : '1.5px solid #E4E2F0',
                              fontSize: 11, fontWeight: 600, cursor: 'pointer'
                            }}
                          >
                            {brand.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, color: '#8B82C4', marginBottom: 6, display: 'block' }}>{lang === 'uz' ? 'Karta egasi' : lang === 'uz_cyrl' ? 'Карта эгаси' : lang === 'ru' ? 'Владелец карты' : 'Cardholder'}</label>
                      <input
                        type="text" required
                        value={newCardHolder} onChange={(e) => setNewCardHolder(e.target.value)}
                        style={{ width: '100%', padding: '14px 16px', borderRadius: 14, border: '1.5px solid #E4E2F0', fontSize: 15, fontWeight: 500, color: '#1E1A3C', textTransform: 'uppercase' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, color: '#8B82C4', marginBottom: 6, display: 'block' }}>{lang === 'uz' ? 'Balans (so\'m)' : lang === 'uz_cyrl' ? 'Баланс (сўм)' : lang === 'ru' ? 'Баланс (сум)' : 'Balance (som)'}</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        required
                        value={newCardBalance ? Number(newCardBalance.replace(/\D/g, '')).toLocaleString('en-US').replace(/,/g, ' ') : ''}
                        onChange={(e) => setNewCardBalance(e.target.value.replace(/\D/g, ''))}
                        style={{ width: '100%', padding: '14px 16px', borderRadius: 14, border: '1.5px solid #E4E2F0', fontSize: 15, fontWeight: 500, color: '#1E1A3C' }}
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    style={{
                      width: '100%', padding: 16, marginTop: 32,
                      background: '#1E1A3C', color: '#fff',
                      border: 'none', borderRadius: 16,
                      fontSize: 15, fontWeight: 600, cursor: 'pointer'
                    }}
                  >
                    {lang === 'uz' ? 'Saqlash' : lang === 'uz_cyrl' ? 'Сақлаш' : lang === 'ru' ? 'Сохранить' : 'Save'}
                  </button>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Selected Tx Modal */}
        <AnimatePresence>
          {selectedTx && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setSelectedTx(null)}
                style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(0,0,0,0.4)',
                  backdropFilter: 'blur(4px)'
                }}
              />
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                drag="y"
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={0.5}
                onDragEnd={(_: any, info: any) => {
                  if (info.offset.y > 100) setSelectedTx(null)
                }}
                transition={{ type: 'spring', damping: 26, stiffness: 220 }}
                style={{
                  position: 'relative',
                  background: '#fff',
                  width: '100%', maxWidth: 440,
                  borderTopLeftRadius: 28,
                  borderTopRightRadius: 28,
                  padding: '16px 24px 40px',
                  maxHeight: '90vh', overflowY: 'auto'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ width: 28 }} />
                  <div style={{ width: 40, height: 4, background: '#E8E3F8', borderRadius: 2, cursor: 'grab' }} />
                  <button
                    onClick={() => setSelectedTx(null)}
                    style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: '#F5F4FA', border: 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, color: '#5C548A', cursor: 'pointer', fontWeight: 700
                    }}
                  >
                    ✕
                  </button>
                </div>

                <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1E1A3C', wordBreak: 'break-word', marginBottom: 16 }}>
                  {t.transactionNames[selectedTx.name as keyof typeof t.transactionNames] || selectedTx.name}
                </h3>

                <div style={{ background: '#F8F7FC', borderRadius: 16, padding: 16, marginBottom: 24 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span style={{ color: '#8B82C4', fontSize: 14 }}>{lang === 'uz' ? 'Summa' : lang === 'uz_cyrl' ? 'Сумма' : lang === 'ru' ? 'Сумма' : 'Amount'}</span>
                    <span style={{ fontWeight: 700, fontSize: 16, color: selectedTx.amount > 0 ? '#16A34A' : '#1E1A3C' }}>
                      {fmt(selectedTx.amount)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span style={{ color: '#8B82C4', fontSize: 14 }}>{lang === 'uz' ? 'Vaqti' : lang === 'uz_cyrl' ? 'Вақти' : lang === 'ru' ? 'Время' : 'Time'}</span>
                    <span style={{ color: '#1E1A3C', fontSize: 14, fontWeight: 500 }}>
                      {getGroupDate(selectedTx)} {getTxTime(selectedTx)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: selectedTx.note ? 12 : 0 }}>
                    <span style={{ color: '#8B82C4', fontSize: 14 }}>{lang === 'uz' ? 'Kategoriya' : lang === 'uz_cyrl' ? 'Категория' : lang === 'ru' ? 'Категория' : 'Category'}</span>
                    <span style={{ color: '#1E1A3C', fontSize: 14, fontWeight: 500 }}>
                      {t.categories[selectedTx.category as keyof typeof t.categories] || selectedTx.category}
                    </span>
                  </div>
                  {selectedTx.note && selectedTx.note !== selectedTx.name && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#8B82C4', fontSize: 14 }}>{lang === 'uz' ? 'Izoh' : lang === 'uz_cyrl' ? 'Изоҳ' : lang === 'ru' ? 'Примечание' : 'Note'}</span>
                      <span style={{ color: '#1E1A3C', fontSize: 14, fontWeight: 500, textAlign: 'right', maxWidth: '60%' }}>
                        {selectedTx.note}
                      </span>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setSelectedTx(null)}
                    style={{
                      flex: 1, minWidth: '40%', padding: 16,
                      background: '#F5F4FA', color: '#1E1A3C',
                      border: 'none', borderRadius: 16,
                      fontSize: 15, fontWeight: 600, cursor: 'pointer'
                    }}
                  >
                    {lang === 'uz' ? 'Yopish' : lang === 'uz_cyrl' ? 'Ёпиш' : lang === 'ru' ? 'Закрыть' : 'Close'}
                  </button>
                  {selectedTx.isCustom && (
                    <button
                      onClick={async () => { setEditTx(selectedTx); setSelectedTx(null); }}
                      style={{
                        flex: 1, minWidth: '40%', padding: 16,
                        background: '#F0EEFC', color: '#7C3AED',
                        border: 'none', borderRadius: 16,
                        fontSize: 15, fontWeight: 600, cursor: 'pointer'
                      }}
                    >
                      {lang === 'uz' ? 'Tahrirlash' : lang === 'uz_cyrl' ? 'Таҳрирлаш' : lang === 'ru' ? 'Изменить' : 'Edit'}
                    </button>
                  )}
                  {selectedTx.isCustom && (
                    <button
                      onClick={async () => { setDeleteConfirmTx(selectedTx); setSelectedTx(null); }}
                      style={{
                        flex: 1, minWidth: '100%', padding: 16,
                        background: '#FEF2F2', color: '#DC2626',
                        border: 'none', borderRadius: 16,
                        fontSize: 15, fontWeight: 600, cursor: 'pointer'
                      }}
                    >
                      {lang === 'uz' ? 'O\'chirish' : lang === 'uz_cyrl' ? 'Ўчириш' : lang === 'ru' ? 'Удалить' : 'Delete'}
                    </button>
                  )}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Delete Confirmation Modal */}
        <AnimatePresence>
          {deleteConfirmTx && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setDeleteConfirmTx(null)}
                style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(0,0,0,0.4)',
                  backdropFilter: 'blur(4px)'
                }}
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                style={{
                  position: 'relative',
                  background: '#fff',
                  borderRadius: 24,
                  padding: 24,
                  width: '90%',
                  maxWidth: 400,
                  boxShadow: '0 20px 40px rgba(0,0,0,0.1)'
                }}
              >
                <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1E1A3C', marginBottom: 12 }}>
                  {lang === 'uz' ? "O'chirishni tasdiqlaysizmi?" : lang === 'uz_cyrl' ? "Ўчиришни тасдиқлайсизми?" : lang === 'ru' ? "Подтвердите удаление" : "Confirm Delete"}
                </h3>
                <p style={{ fontSize: 15, color: '#8B82C4', marginBottom: 24 }}>
                  {lang === 'uz' ? "Ushbu xarajatni o'chirib yubormoqchimisiz? Bu amalni ortga qaytarib bo'lmaydi." : lang === 'uz_cyrl' ? "Ушбу харажатни ўчириб юбормоқчимисиз? Бу амални ортга қайтариб бўлмайди." : lang === 'ru' ? "Вы действительно хотите удалить эту операцию? Это действие нельзя отменить." : "Are you sure you want to delete this transaction? This action cannot be undone."}
                </p>
                <div style={{ display: 'flex', gap: 12 }}>
                  <button
                    onClick={() => setDeleteConfirmTx(null)}
                    style={{
                      flex: 1, padding: 14,
                      background: '#F5F4FA', color: '#1E1A3C',
                      border: 'none', borderRadius: 14,
                      fontSize: 15, fontWeight: 600, cursor: 'pointer'
                    }}
                  >
                    {lang === 'uz' ? 'Bekor qilish' : lang === 'uz_cyrl' ? 'Бекор қилиш' : lang === 'ru' ? 'Отмена' : 'Cancel'}
                  </button>
                  <button
                    onClick={() => {
                      setDeleteConfirmTx(null);
                      deleteTransaction(deleteConfirmTx.id).catch(e => console.error(e));
                    }}
                    style={{
                      flex: 1, padding: 14,
                      background: '#DC2626', color: '#fff',
                      border: 'none', borderRadius: 14,
                      fontSize: 15, fontWeight: 600, cursor: 'pointer'
                    }}
                  >
                    {lang === 'uz' ? 'O\'chirish' : lang === 'uz_cyrl' ? 'Ўчириш' : lang === 'ru' ? 'Удалить' : 'Delete'}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Delete Card Confirmation Modal */}
        <AnimatePresence>
          {deleteConfirmCard && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setDeleteConfirmCard(null)}
                style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(0,0,0,0.4)',
                  backdropFilter: 'blur(4px)'
                }}
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                style={{
                  position: 'relative',
                  background: '#fff',
                  borderRadius: 24,
                  padding: 24,
                  width: '90%',
                  maxWidth: 400,
                  boxShadow: '0 20px 40px rgba(0,0,0,0.1)'
                }}
              >
                <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1E1A3C', marginBottom: 12 }}>
                  {lang === 'uz' ? "Kartani o'chirishni tasdiqlaysizmi?" : lang === 'uz_cyrl' ? "Картани ўчиришни тасдиқлайсизми?" : lang === 'ru' ? "Подтвердите удаление карты" : "Confirm Card Delete"}
                </h3>
                <p style={{ fontSize: 15, color: '#8B82C4', marginBottom: 24 }}>
                  {lang === 'uz' ? "Rostdan ham ushbu kartani o'chirmoqchimisiz? Bu amalni ortga qaytarib bo'lmaydi." : lang === 'uz_cyrl' ? "Ростдан ҳам ушбу картани ўчирмоқчимисиз? Бу амални ортга қайтариб бўлмайди." : lang === 'ru' ? "Вы действительно хотите удалить эту карту? Это действие нельзя отменить." : "Are you sure you want to delete this card? This action cannot be undone."}
                </p>
                <div style={{ display: 'flex', gap: 12 }}>
                  <button
                    onClick={() => setDeleteConfirmCard(null)}
                    style={{
                      flex: 1, padding: 14,
                      background: '#F5F4FA', color: '#1E1A3C',
                      border: 'none', borderRadius: 14,
                      fontSize: 15, fontWeight: 600, cursor: 'pointer'
                    }}
                  >
                    {lang === 'uz' ? 'Bekor qilish' : lang === 'uz_cyrl' ? 'Бекор қилиш' : lang === 'ru' ? 'Отмена' : 'Cancel'}
                  </button>
                  <button
                    onClick={() => {
                      const c = cards.find(x => x.id === deleteConfirmCard)
                      if (c) {
                        const currentBal = getCardBalance(c.id)
                        if (currentBal !== 0) {
                          addTransaction({
                            id: Date.now(),
                            type: currentBal > 0 ? 'income' : 'expense',
                            amount: Math.abs(currentBal),
                            category: currentBal > 0 ? 'Daromad' : 'Boshqa',
                            note: lang === 'uz'
                              ? `Karta o'chirildi (balans saqlandi: ${c.bank})`
                              : lang === 'uz_cyrl'
                              ? `Карта ўчирилди (баланс сақланди: ${c.bank})`
                              : lang === 'ru'
                              ? `Карта удалена (баланс сохранён: ${c.bank})`
                              : `Card removed (balance kept: ${c.bank})`,
                            date: new Date().toISOString(),
                            cardId: undefined,
                          })
                        }
                      }

                      saveCards(cards.filter(card => card.id !== deleteConfirmCard))
                      setDeleteConfirmCard(null);
                    }}
                    style={{
                      flex: 1, padding: 14,
                      background: '#DC2626', color: '#fff',
                      border: 'none', borderRadius: 14,
                      fontSize: 15, fontWeight: 600, cursor: 'pointer'
                    }}
                  >
                    {lang === 'uz' ? 'O\'chirish' : lang === 'uz_cyrl' ? 'Ўчириш' : lang === 'ru' ? 'Удалить' : 'Delete'}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

  
      {/* Real-time Incoming Announcement Popup */}
      <AnimatePresence>
        {activeAnnouncementPopup && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={dismissAnnouncementPopup}
              style={{ position: 'absolute', inset: 0, background: 'rgba(30, 26, 60, 0.6)', backdropFilter: 'blur(4px)' }}
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              style={{
                position: 'relative', background: '#FFFFFF', width: '100%', maxWidth: 360,
                borderRadius: 24, padding: 20, boxShadow: '0 20px 50px rgba(0,0,0,0.25)', zIndex: 1201
              }}
            >
              <button
                onClick={dismissAnnouncementPopup}
                style={{
                  position: 'absolute', top: 14, right: 14, width: 28, height: 28, borderRadius: '50%',
                  background: '#F5F4FA', border: 'none', fontSize: 13, fontWeight: 700, color: '#5C548A', cursor: 'pointer'
                }}
              >
                ✕
              </button>

              {activeAnnouncementPopup.image_url && (
                <img
                  src={activeAnnouncementPopup.image_url}
                  alt={activeAnnouncementPopup.title}
                  style={{ width: '100%', borderRadius: 16, maxHeight: 160, objectFit: 'cover', marginBottom: 14 }}
                />
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 20 }}>{activeAnnouncementPopup.emoji || '📢'}</span>
                <h4 style={{ fontSize: 17, fontWeight: 700, color: '#1E1A3C', margin: 0 }}>
                  {activeAnnouncementPopup.title}
                </h4>
              </div>

              <p style={{ fontSize: 13.5, color: '#5C548A', lineHeight: 1.5, marginBottom: 16 }}>
                {activeAnnouncementPopup.message}
              </p>

              <div style={{ display: 'flex', gap: 10 }}>
                {activeAnnouncementPopup.action_url && (
                  <button
                    onClick={() => {
                      window.open(activeAnnouncementPopup.action_url, '_blank')
                      dismissAnnouncementPopup()
                    }}
                    style={{
                      flex: 1, padding: '12px', borderRadius: 12, border: 'none',
                      background: '#7C3AED', color: '#FFFFFF', fontSize: 13, fontWeight: 700, cursor: 'pointer'
                    }}
                  >
                    {lang === 'uz' ? "Ochish" : lang === 'ru' ? 'Открыть' : 'Open'}
                  </button>
                )}
                <button
                  onClick={dismissAnnouncementPopup}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 12,
                    border: '1.5px solid #E4E1F4', background: '#FAF9FD', color: '#5C548A',
                    fontSize: 13, fontWeight: 600, cursor: 'pointer'
                  }}
                >
                  {lang === 'uz' ? "Tushunarli" : lang === 'ru' ? 'Понятно' : 'Dismiss'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

            {/* Edit Transaction Modal */}
        <AnimatePresence>
          {editTx && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setEditTx(null)}
                style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(15, 12, 41, 0.45)',
                  backdropFilter: 'blur(4px)'
                }}
              />
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                drag="y"
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={0.5}
                onDragEnd={(_: any, info: any) => {
                  if (info.offset.y > 100) setEditTx(null)
                }}
                transition={{ type: 'spring', damping: 26, stiffness: 220 }}
                style={{
                  position: 'relative',
                  background: '#fff',
                  borderTopLeftRadius: 28,
                  borderTopRightRadius: 28,
                  padding: '16px 24px 32px',
                  width: '100%',
                  maxWidth: 440,
                  boxShadow: '0 -10px 40px rgba(0,0,0,0.15)',
                  zIndex: 100000
                }}
              >
                {/* Header Handle Bar with Close Button */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div style={{ width: 28 }} />
                  <div style={{ width: 40, height: 4, background: '#E8E3F8', borderRadius: 2, cursor: 'grab' }} />
                  <button
                    onClick={() => setEditTx(null)}
                    style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: '#F5F4FA', border: 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, color: '#5C548A', cursor: 'pointer', fontWeight: 700
                    }}
                  >
                    ✕
                  </button>
                </div>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1E1A3C', marginBottom: 20 }}>
                  {lang === 'uz' ? 'Tahrirlash' : lang === 'uz_cyrl' ? 'Таҳрирлаш' : lang === 'ru' ? 'Изменить' : 'Edit'}
                </h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#8B82C4', marginBottom: 6, display: 'block' }}>
                      {lang === 'uz' ? 'Summa' : lang === 'uz_cyrl' ? 'Сумма' : lang === 'ru' ? 'Сумма' : 'Amount'}
                    </label>
                    <input
                      type="tel"
                      inputMode="numeric"
                      value={Math.abs(editTx.amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}
                      onChange={(e) => setEditTx({...editTx, amount: (editTx.amount < 0 ? -1 : 1) * (parseInt(e.target.value.replace(/\D/g, '')) || 0)})}
                      style={{
                        width: '100%', padding: '14px 16px',
                        borderRadius: 14, border: '1.5px solid #E4E2F0',
                        fontSize: 16, fontWeight: 600, color: '#1E1A3C'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#8B82C4', marginBottom: 6, display: 'block' }}>
                      {lang === 'uz' ? 'Izoh' : lang === 'uz_cyrl' ? 'Изоҳ' : lang === 'ru' ? 'Примечание' : 'Note'}
                    </label>
                    <input
                      type="text"
                      value={editTx.note || ''}
                      onChange={(e) => setEditTx({...editTx, note: e.target.value})}
                      style={{
                        width: '100%', padding: '14px 16px',
                        borderRadius: 14, border: '1.5px solid #E4E2F0',
                        fontSize: 16, fontWeight: 500, color: '#1E1A3C'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#8B82C4', marginBottom: 6, display: 'block' }}>
                      {lang === 'uz' ? 'Sana' : lang === 'uz_cyrl' ? 'Сана' : lang === 'ru' ? 'Дата' : 'Date'}
                    </label>
                    <input
                      type="datetime-local"
                      value={editTx.date ? new Date(new Date(editTx.date).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}
                      onChange={(e) => setEditTx({...editTx, date: e.target.value ? new Date(e.target.value).toISOString() : editTx.date})}
                      style={{
                        width: '100%', padding: '14px 16px',
                        borderRadius: 14, border: '1.5px solid #E4E2F0',
                        fontSize: 16, fontWeight: 500, color: '#1E1A3C'
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                  <button
                    onClick={() => setEditTx(null)}
                    style={{
                      flex: 1, padding: 14,
                      background: '#F5F4FA', color: '#1E1A3C',
                      border: 'none', borderRadius: 14,
                      fontSize: 15, fontWeight: 600, cursor: 'pointer'
                    }}
                  >
                    {lang === 'uz' ? 'Bekor qilish' : lang === 'uz_cyrl' ? 'Бекор қилиш' : lang === 'ru' ? 'Отмена' : 'Cancel'}
                  </button>
                  <button
                    onClick={async () => {
                      // Extract only valid Transaction fields before saving
                      await addTransaction({
                        id: editTx.id,
                        type: editTx.type,
                        amount: editTx.amount,
                        note: editTx.note || editTx.category,
                        category: editTx.category,
                        date: editTx.date,
                        cardId: editTx.cardId,
                        title: editTx.title,
                        debtWho: editTx.debtWho,
                      });
                      setEditTx(null);
                    }}
                    style={{
                      flex: 1, padding: 14,
                      background: '#7C3AED', color: '#fff',
                      border: 'none', borderRadius: 14,
                      fontSize: 15, fontWeight: 600, cursor: 'pointer'
                    }}
                  >
                    {lang === 'uz' ? 'Saqlash' : lang === 'uz_cyrl' ? 'Сақлаш' : lang === 'ru' ? 'Сохранить' : 'Save'}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
    </div>
  )
}
