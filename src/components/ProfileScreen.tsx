import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import type { OnboardingResult } from './Onboarding'
import { useFinance, Transaction } from '../FinanceContext'
import BankCard from './BankCard'

interface Props {
  onLogout: () => void
  onboarding?: OnboardingResult | null
  onUpdateOnboarding?: (newData: Partial<OnboardingResult>) => void
  onClearData?: () => void
  onStartTour?: () => void
}

// Full translations for all interactive screens
const translations = {
  uz: {
    title: 'Profil',
    stats: [
      { val: '3', label: 'Oy jami' },
      { val: '247', label: 'Tranzaksiya' },
      { val: 'Cheksiz', label: 'AI maslahat' },
    ],
    premium: {
      planLabel: 'Joriy tarif',
      planName: 'Bepul',
      planPremium: 'Premium Pro 🌟',
      usage: '10/50 AI savol',
      usagePremium: 'Cheksiz AI yordamchi',
      action: 'Premium →',
      actionPremium: 'Premium faol ✔️'
    },
    menu: {
      hisob: 'HISOB',
      ilova: 'ILOVA',
      items: {
        notifications: 'Bildirishnomalar',
        notificationsSub: 'Hammasi yoqilgan',
        security: 'Xavfsizlik',
        securitySub: 'Face ID, PIN',
        payments: "To'lov usullari",
        paymentsSub: '2 ta karta',
        lang: 'Til',
        langSub: "O'zbek",
        export: 'Hisobot eksport',
        exportSub: 'PDF, Excel',
        help: 'Yordam',
        helpSub: '24/7 tezkor xizmat',
        clearData: 'Ma\'lumotlarimni tozalash',
        clearDataSub: 'Moliyaviy yozuvlarni tozalash (Hisob faol qoladi)',
        deleteAccount: 'Hisobni o\'chirish',
        deleteAccountSub: 'Hisob va barcha ma\'lumotlarni butunlay o\'chirish'
      }
    },
    logout: 'Chiqish',
    editModal: {
      title: 'Profilni tahrirlash',
      nameLabel: 'Ism, Familiya',
      phoneLabel: 'Telefon raqam',
      telegramLabel: 'Telegram foydalanuvchi nomi',
      saveBtn: 'Saqlash',
      cancelBtn: 'Bekor qilish'
    },
    premiumModal: {
      title: 'Premium Pro-ga o\'ting',
      sub: 'Moliyangizni aqlli boshqarish va cheksiz imkoniyatlar kaliti',
      feature1: '🔮 Cheksiz AI yordamchi maslahatlari',
      feature2: '📊 Kengaytirilgan PDF/Excel hisobotlar',
      feature3: '🎯 Cheksiz xarajat limitlari o\'rnatish',
      feature4: '⛔ Reklamasiz va to\'liq xavfsiz interfeys',
      price: '19 000 so\'m / oyiga',
      activateBtn: 'Faollashtirish (Tekin sinov)',
      cancelBtn: 'Yopish',
      successMsg: 'Tabriklaymiz! Siz muvaffaqiyatli Premium tarifiga o\'tdingiz.'
    },
    cardsModal: {
      title: 'Mening kartalarim',
      addCardBtn: 'Yangi karta qo\'shish',
      cardNumber: 'Karta raqami',
      cardHolder: 'Karta egasi',
      cardExpiry: 'Amal qilish muddati (MM/YY)',
      cardBalance: 'Dastlabki balans',
      addBtn: 'Qo\'shish',
      cancelBtn: 'Bekor qilish',
      emptyMsg: 'Hozircha kartalar yo\'q.'
    },
    exportModal: {
      title: 'Hisobotni eksport qilish',
      formatLabel: 'Fayl formati',
      periodLabel: 'Eksport davri',
      periodCurrent: 'Joriy oy',
      periodLast: 'O\'tgan oy',
      periodQuarter: 'Oxirgi 3 oy',
      downloadBtn: 'Yuklab olish',
      generating: 'Fayl tayyorlanmoqda...',
      success: 'Hisobot muvaffaqiyatli yuklab olindi! ✅'
    },
    notifModal: {
      title: 'Bildirishnomalar sozlamalari',
      opt1: 'Xarajatlar haqida ogohlantirish',
      opt2: 'Haftalik moliyaviy tahlil',
      opt3: 'AI aqlli maslahatlari',
      saved: 'Bildirishnomalar sozlamalari saqlandi!'
    },
    securityModal: {
      title: 'Xavfsizlik va PIN kod',
      pinEnable: 'PIN kodni yoqish',
      faceIdEnable: 'Face ID va Biometrika',
      pinSetup: 'PIN kod o\'rnatish',
      enterPin: '4 xonali PIN kiriting',
      saved: 'Xavfsizlik sozlamalari yangilandi!'
    },
    helpModal: {
      title: 'Moliya yordam xizmati',
      sub: 'Sizga yordam berishga tayyormiz. Savol bering:',
      placeholder: 'Xabaringizni yozing...',
      faq1: 'Limitni qanday o\'zgartiraman?',
      faq2: 'Premium nima bera oladi?',
      faq3: 'Tahlil grafiklarni yangilash',
      typing: 'Yordamchi yozmoqda...'
    },
    clearConfirm: {
      title: 'Hisob ma\'lumotlarini tozalash',
      sub: 'Haqiqatan ham barcha hisob ma\'lumotlarini o\'chirmoqchimisiz? Ushbu amal ortga qaytarilmaydi! Barcha pullar, tranzaksiyalar va xavfsizlik PIN-kodlari o\'chib ketadi.',
      confirmBtn: 'Ha, tozalash',
      cancelBtn: 'Bekor qilish'
    }
  },
  uz_cyrl: {
    title: 'Профил',
    stats: [
      { val: '3', label: 'Ой жами' },
      { val: '247', label: 'Транзакция' },
      { val: 'Чексиз', label: 'AI маслаҳат' },
    ],
    premium: {
      planLabel: 'Жорий тариф',
      planName: 'Бепул',
      planPremium: 'Premium Pro 🌟',
      usage: '10/50 AI савол',
      usagePremium: 'Чексиз AI ёрдамчи',
      action: 'Premium →',
      actionPremium: 'Premium фаол ✔️'
    },
    menu: {
      hisob: 'ҲИСОБ',
      ilova: 'ИЛОВА',
      items: {
        notifications: 'Билдиришномалар',
        notificationsSub: 'Ҳаммаси ёқилган',
        security: 'Хавфсизлик',
        securitySub: 'Face ID, ПИН',
        payments: "Тўлов усуллари",
        paymentsSub: '2 та карта',
        lang: 'Тил',
        langSub: "Ўзбек",
        export: 'Ҳисобот экспорт',
        exportSub: 'PDF, Excel',
        help: 'Ёрдам',
        helpSub: '24/7 тезкор хизмат',
        clearData: 'Маълумотларимни тозалаш',
        clearDataSub: 'Молиявий ёзувларни тозалаш (Ҳисоб фаол қолади)',
        deleteAccount: 'Ҳисобни ўчириш',
        deleteAccountSub: 'Ҳисоб ва барча маълумотларни бутунлай ўчириш'
      }
    },
    logout: 'Чиқиш',
    editModal: {
      title: 'Профилни таҳрирлаш',
      nameLabel: 'Исм, Фамилия',
      phoneLabel: 'Телефон рақам',
      telegramLabel: 'Telegram фойдаланувчи номи',
      saveBtn: 'Сақлаш',
      cancelBtn: 'Бекор қилиш'
    },
    premiumModal: {
      title: 'Premium Pro-га ўтинг',
      sub: 'Молиянгизни ақлли бошқариш ва чексиз имкониятлар калити',
      feature1: '🔮 Чексиз AI ёрдамчи маслаҳатлари',
      feature2: '📊 Кенгайтирилган PDF/Excel ҳисоботлар',
      feature3: '🎯 Чексиз харажат лимитлари ўрнатиш',
      feature4: '⛔ Рекламасиз ва тўлиқ хавфсиз интерфейс',
      price: '19 000 сўм / ойига',
      activateBtn: 'Фаоллаштириш (Текин синов)',
      cancelBtn: 'Ёпиш',
      successMsg: 'Табриклаймиз! Сиз муваффақиятли Premium тарифига ўтдингиз.'
    },
    cardsModal: {
      title: 'Менинг карталарим',
      addCardBtn: 'Янги карта қўшиш',
      cardNumber: 'Карта рақами',
      cardHolder: 'Карта эгаси',
      cardExpiry: 'Амал қилиш муддати (ОЙ/ЙИЛ)',
      cardBalance: 'Дастлабки баланс',
      addBtn: 'Қўшиш',
      cancelBtn: 'Бекор қилиш',
      emptyMsg: 'Ҳозирча карталар йўқ.'
    },
    exportModal: {
      title: 'Ҳисоботни экспорт қилиш',
      formatLabel: 'Файл формати',
      periodLabel: 'Экспорт даври',
      periodCurrent: 'Жорий ой',
      periodLast: 'Ўтган ой',
      periodQuarter: 'Охирги 3 ой',
      downloadBtn: 'Юклаб олиш',
      generating: 'Файл тайёрланмоқда...',
      success: 'Ҳисобот муваффақиятли юклаб олинди! ✅'
    },
    notifModal: {
      title: 'Билдиришномалар созламалари',
      opt1: 'Харажатлар ҳақида огоҳлантириш',
      opt2: 'Ҳафталик молиявий таҳлил',
      opt3: 'AI ақлли маслаҳатлари',
      saved: 'Билдиришномалар созламалари сақланди!'
    },
    securityModal: {
      title: 'Хавфсизлик ва ПИН код',
      pinEnable: 'ПИН кодни ёқиш',
      faceIdEnable: 'Face ID ва Биометрика',
      pinSetup: 'ПИН код ўрнатиш',
      enterPin: '4 хонали ПИН киритинг',
      saved: 'Хавфсизлик созламалари янгиланди!'
    },
    helpModal: {
      title: 'Молия ёрдам хизмати',
      sub: 'Сизга ёрдам беришга тайёрмиз. Савол беринг:',
      placeholder: 'Хабарингизни ёзинг...',
      faq1: 'Лимитни қандай ўзгартираман?',
      faq2: 'Premium нима бера олади?',
      faq3: 'Таҳлил графикларни янгилаш',
      typing: 'Ёрдамчи ёзмоқда...'
    },
    clearConfirm: {
      title: 'Ҳисоб маълумотларини тозалаш',
      sub: 'Ҳақиқатан ҳам барча ҳисоб маълумотларини ўчирмоқчимисиз? Ушбу амал ортга қайтарилмайди! Барча пуллар, транзакциялар ва хавфсизлик ПИН-кодлари ўчиб кетади.',
      confirmBtn: 'Ҳа, тозалаш',
      cancelBtn: 'Бекор қилиш'
    }
  },
  ru: {
    title: 'Профиль',
    stats: [
      { val: '3', label: 'Месяца всего' },
      { val: '247', label: 'Транзакций' },
      { val: 'Безлимит', label: 'Советы ИИ' },
    ],
    premium: {
      planLabel: 'Текущий тариф',
      planName: 'Бесплатный',
      planPremium: 'Премиум Pro 🌟',
      usage: '10/50 вопросов ИИ',
      usagePremium: 'Безлимитный ИИ-помощник',
      action: 'Премиум →',
      actionPremium: 'Премиум активен ✔️'
    },
    menu: {
      hisob: 'АККАУНТ',
      ilova: 'ПРИЛОЖЕНИЕ',
      items: {
        notifications: 'Уведомления',
        notificationsSub: 'Все включены',
        security: 'Безопасность',
        securitySub: 'Face ID, PIN',
        payments: 'Способы оплаты',
        paymentsSub: '2 карты',
        lang: 'Язык',
        langSub: 'Русский',
        export: 'Экспорт отчетов',
        exportSub: 'PDF, Excel',
        help: 'Помощь',
        helpSub: 'Поддержка 24/7',
        clearData: 'Очистить мои данные',
        clearDataSub: 'Очистить финансовые записи (Аккаунт останется активен)',
        deleteAccount: 'Удалить аккаунт',
        deleteAccountSub: 'Безвозвратно удалить аккаунт и все данные'
      }
    },
    logout: 'Выйти',
    editModal: {
      title: 'Редактировать профиль',
      nameLabel: 'Имя, Фамилия',
      phoneLabel: 'Номер телефона',
      telegramLabel: 'Имя пользователя Telegram',
      saveBtn: 'Сохранить',
      cancelBtn: 'Отмена'
    },
    premiumModal: {
      title: 'Перейти на Premium Pro',
      sub: 'Ключ к умному управлению вашими финансами и безлимитным возможностям',
      feature1: '🔮 Безлимитный ИИ-ассистент',
      feature2: '📊 Расширенные отчеты в PDF/Excel',
      feature3: '🎯 Безлимитная установка лимитов расходов',
      feature4: '⛔ Полностью безопасный интерфейс без рекламы',
      price: '19 000 сум / месяц',
      activateBtn: 'Активировать (Пробный период)',
      cancelBtn: 'Закрыть',
      successMsg: 'Поздравляем! Вы успешно перешли на тариф Премиум.'
    },
    cardsModal: {
      title: 'Мои карты',
      addCardBtn: 'Добавить новую карту',
      cardNumber: 'Номер карты',
      cardHolder: 'Владелец карты',
      cardExpiry: 'Срок действия (ММ/ГГ)',
      cardBalance: 'Начальный баланс',
      addBtn: 'Добавить',
      cancelBtn: 'Отмена',
      emptyMsg: 'У вас пока нет карт.'
    },
    exportModal: {
      title: 'Экспорт отчета',
      formatLabel: 'Формат файла',
      periodLabel: 'Период экспорта',
      periodCurrent: 'Текущий месяц',
      periodLast: 'Прошлый месяц',
      periodQuarter: 'Последние 3 месяца',
      downloadBtn: 'Скачать отчет',
      generating: 'Подготовка файла...',
      success: 'Отчет успешно скачан! ✅'
    },
    notifModal: {
      title: 'Настройки уведомлений',
      opt1: 'Оповещения о расходах',
      opt2: 'Еженедельный фин. анализ',
      opt3: 'Умные подсказки ИИ',
      saved: 'Настройки уведомлений сохранены!'
    },
    securityModal: {
      title: 'Безопасность и PIN-код',
      pinEnable: 'Включить PIN-код',
      faceIdEnable: 'Face ID и биометрия',
      pinSetup: 'Настройка PIN-кода',
      enterPin: 'Введите 4-значный PIN',
      saved: 'Настройки безопасности обновлены!'
    },
    helpModal: {
      title: 'Служба поддержки финансов',
      sub: 'Мы всегда рады помочь вам. Задайте вопрос:',
      placeholder: 'Введите сообщение...',
      faq1: 'Как изменить лимит?',
      faq2: 'Что дает Premium тариф?',
      faq3: 'Обновление графиков анализа',
      typing: 'Помощник пишет...'
    },
    clearConfirm: {
      title: 'Очистить данные аккаунта',
      sub: 'Вы действительно хотите удалить все данные аккаунта? Это действие невозможно отменить! Все средства, транзакции и PIN-код будут удалены.',
      confirmBtn: 'Да, очистить',
      cancelBtn: 'Отмена'
    }
  },
  en: {
    title: 'Profile',
    stats: [
      { val: '3', label: 'Months total' },
      { val: '247', label: 'Transactions' },
      { val: 'Unlimited', label: 'AI Advisory' },
    ],
    premium: {
      planLabel: 'Current plan',
      planName: 'Free',
      planPremium: 'Premium Pro 🌟',
      usage: '10/50 AI questions',
      usagePremium: 'Unlimited AI Advisor',
      action: 'Premium →',
      actionPremium: 'Premium Active ✔️'
    },
    menu: {
      hisob: 'ACCOUNT',
      ilova: 'APP',
      items: {
        notifications: 'Notifications',
        notificationsSub: 'All turned on',
        security: 'Security',
        securitySub: 'Face ID, PIN',
        payments: 'Payment methods',
        paymentsSub: '2 cards',
        lang: 'Language',
        langSub: 'English',
        export: 'Export report',
        exportSub: 'PDF, Excel',
        help: 'Help',
        helpSub: '24/7 live support',
        clearData: 'Clear My Data',
        clearDataSub: 'Delete financial records (Your account stays active)',
        deleteAccount: 'Delete Account',
        deleteAccountSub: 'Permanently delete account and all data'
      }
    },
    logout: 'Logout',
    editModal: {
      title: 'Edit Profile',
      nameLabel: 'Full Name',
      phoneLabel: 'Phone Number',
      telegramLabel: 'Telegram Username',
      saveBtn: 'Save',
      cancelBtn: 'Cancel'
    },
    premiumModal: {
      title: 'Upgrade to Premium Pro',
      sub: 'Unlock the ultimate smart financial manager and unlimited capacities',
      feature1: '🔮 Unlimited AI-Assistant chats & advisory',
      feature2: '📊 Advanced PDF/Excel document exports',
      feature3: '🎯 Unlimited custom spend limits setup',
      feature4: '⛔ Clean, fast, safe & completely ad-free',
      price: '19,000 UZS / month',
      activateBtn: 'Activate (Free Trial)',
      cancelBtn: 'Close',
      successMsg: 'Congratulations! You have successfully upgraded to Premium Pro.'
    },
    cardsModal: {
      title: 'My Cards',
      addCardBtn: 'Add new card',
      cardNumber: 'Card Number',
      cardHolder: 'Card Holder',
      cardExpiry: 'Expiry Date (MM/YY)',
      cardBalance: 'Initial Balance',
      addBtn: 'Add Card',
      cancelBtn: 'Cancel',
      emptyMsg: 'No cards added yet.'
    },
    exportModal: {
      title: 'Export Data Report',
      formatLabel: 'File format',
      periodLabel: 'Export period',
      periodCurrent: 'Current month',
      periodLast: 'Last month',
      periodQuarter: 'Last 3 months',
      downloadBtn: 'Download Report',
      generating: 'Preparing file...',
      success: 'Report successfully downloaded! ✅'
    },
    notifModal: {
      title: 'Notification Settings',
      opt1: 'Expense alerts',
      opt2: 'Weekly financial digest',
      opt3: 'AI smart suggestions',
      saved: 'Notification settings successfully updated!'
    },
    securityModal: {
      title: 'Security & PIN lock',
      pinEnable: 'Enable PIN access',
      faceIdEnable: 'Face ID & Biometrics',
      pinSetup: 'PIN Code setup',
      enterPin: 'Enter 4-digit PIN',
      saved: 'Security options updated!'
    },
    helpModal: {
      title: 'Financial Support Helpdesk',
      sub: 'We are here to help you 24/7. Ask us anything:',
      placeholder: 'Type your message...',
      faq1: 'How do I change limit?',
      faq2: 'What are premium benefits?',
      faq3: 'Updating analytic graphics',
      typing: 'Support agent is typing...'
    },
    clearConfirm: {
      title: 'Clear Account Data',
      sub: 'Are you sure you want to clear all account data? This action cannot be undone! All funds, transactions, and PIN code will be deleted.',
      confirmBtn: 'Yes, clear all',
      cancelBtn: 'Cancel'
    }
  }
}

export default function ProfileScreen({ onLogout, onboarding, onUpdateOnboarding, onClearData, onStartTour }: Props) {
  const initialLang = onboarding?.language || 'uz'
  const lang = (initialLang in translations) ? initialLang : 'uz'
  const t = translations[lang as keyof typeof translations]

  // Global premium state (can read from onboarding, default false)
  const isPremium = onboarding?.monthlyIncome === undefined && onboarding?.monthlyGoal === 999999 ? true : (onboarding as any)?.isPremium || false

  // Profile data
  const userName = (onboarding as any)?.name || 'Jasur Toshmatov'
  const userPhone = (onboarding as any)?.phone || '+998 90 123 45 67'
  const userTelegram = (onboarding as any)?.telegram || '@jasur_moliya'

  // Modal States
  const [activeModal, setActiveModal] = useState<
    'edit' | 'premium' | 'notifications' | 'security' | 'payments' | 'lang' | 'export' | 'help' | 'clearConfirm' | 'clearDataOnly' | 'logout_confirm' | null
  >(null)

  // Transient Toast state
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  // Edit Profile States
  const [editName, setEditName] = useState(userName)
  const [editPhone, setEditPhone] = useState(userPhone)
  const [editTelegram, setEditTelegram] = useState(userTelegram)

  const { cards: rawCards, saveCards, security: contextSecurity, updateSecurity, clearAllData, clearOnlyFinancialData, customTransactions, addTransaction } = useFinance()
  const cards = Array.isArray(rawCards) ? rawCards : []

  const getCardBalance = (cardId: string) => {
    const c = cards.find(x => x.id === cardId)
    if (!c) return 0
    const initial = Number(String(c.balance).replace(/\s/g, '').replace(/,/g, '')) || 0
    const cardTxs = customTransactions.filter((t: Transaction) => t.cardId === cardId)
    const cardIncome = cardTxs.filter((t: Transaction) => Number(t.amount) > 0).reduce((acc: number, t: Transaction) => acc + Number(t.amount), 0)
    const cardExpense = cardTxs.filter((t: Transaction) => Number(t.amount) < 0).reduce((acc: number, t: Transaction) => acc + Math.abs(Number(t.amount)), 0)
    return initial + cardIncome - cardExpense
  }

  // New card Form states
  const [showAddCardForm, setShowAddCardForm] = useState(false)
  const [newCardNumber, setNewCardNumber] = useState('')
  const [newCardBank, setNewCardBank] = useState('')
  const [newCardHolder, setNewCardHolder] = useState(userName.toUpperCase())
  const [newCardBalance, setNewCardBalance] = useState('')
  const [newCardBrand, setNewCardBrand] = useState<'uzcard' | 'humo' | 'visa' | 'mastercard'>('uzcard')
  const [editingCardId, setEditingCardId] = useState<string | null>(null)
  
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [deleteStep, setDeleteStep] = useState<1 | 2 | 3 | 4>(1)
  const [deleteRandomCode, setDeleteRandomCode] = useState<string>('')
  const [deleteInputCode, setDeleteInputCode] = useState<string>('')
  const [showMorePlans, setShowMorePlans] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<{ title: string; price: string; code: string } | null>(null)

  // Notifications states
  const [notifOpts, setNotifOpts] = useState(() => onboarding?.notifications || { opt1: true, opt2: true, opt3: false })

  // Security states
  const [securityOpts, setSecurityOpts] = useState(() => contextSecurity)
  const [tempPin, setTempPin] = useState('')

  useEffect(() => {
    setSecurityOpts(contextSecurity)
  }, [contextSecurity])

  // Export states
  const [exportFormat, setExportFormat] = useState<'PDF' | 'Excel' | 'CSV'>('PDF')
  const [exportPeriod, setExportPeriod] = useState<'current' | 'last' | 'quarter'>('current')
  const [exportProgress, setExportProgress] = useState<number | null>(null)

  // Chat/Support states
  const [chatMessages, setChatMessages] = useState<{ sender: 'user' | 'support'; text: string }[]>([
    { sender: 'support', text: lang === 'uz' ? 'Assalomu alaykum! Moliya qo\'llab-quvvatlash markaziga xush kelibsiz. Qanday yordam bera olaman?' : lang === 'uz_cyrl' ? 'Ассалому алайкум! Молия қўллаб-қувватлаш марказига хуш келибсиз. Қандай ёрдам бера оламан?' : lang === 'ru' ? 'Здравствуйте! Добро пожаловать в центр поддержки. Чем я могу помочь?' : 'Hello! Welcome to our financial support helpdesk. How can I assist you today?' }
  ])
  const [chatInput, setChatInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)

  // Toast auto-hide
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [toastMessage])

  // Handle Edit Profile save
  const handleSaveProfile = () => {
    if (onUpdateOnboarding) {
      onUpdateOnboarding({
        name: editName,
        phone: editPhone,
        telegram: editTelegram
      } as any)
      setToastMessage(lang === 'uz' ? 'Profil muvaffaqiyatli yangilandi!' : lang === 'uz_cyrl' ? 'Профил муваффақиятли янгиланди!' : lang === 'ru' ? 'Профиль успешно обновлен!' : 'Profile updated successfully!')
    }
    setActiveModal(null)
  }

  // Handle Premium subscription toggle
  const handleTogglePremium = () => {
    if (onUpdateOnboarding) {
      onUpdateOnboarding({
        isPremium: !isPremium
      } as any)
      setToastMessage(!isPremium ? t.premiumModal.successMsg : (lang === 'uz' ? 'Premium status o\'chirildi' : lang === 'uz_cyrl' ? 'Premium статус ўчирилди' : 'Premium status off'))
    }
    setActiveModal(null)
  }

  // Handle new card submission
  const handleAddCardSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newCardNumber || !newCardBank) return

    const cleanNum = newCardNumber.replace(/\s/g, '')
    
    if (cleanNum.length !== 16) {
      alert("Karta raqamini to'liq kiritishingiz kerak (16 ta raqam).")
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
        name: newCardHolder.toUpperCase() || userName.toUpperCase(),
        brand: newCardBrand,
        balance: c.balance // preserve existing initial balance so previous history isn't lost
      } : c)
      saveCards(updated)

      if (difference !== 0) {
        addTransaction({
          id: Date.now(),
          type: difference > 0 ? 'income' : 'expense',
          amount: difference,
          category: difference > 0 ? 'Daromad' : 'Boshqa',
          note: "Karta balansi to'g'irlandi",
          date: new Date().toISOString(),
          cardId: editingCardId
        })
      }
      
      setToastMessage(lang === 'uz' ? 'Karta saqlandi!' : lang === 'uz_cyrl' ? 'Карта сақланди!' : lang === 'ru' ? 'Карта сохранена!' : 'Card saved!')
      setEditingCardId(null)
    } else {
      const newCardId = Date.now().toString()
      const newCard: any = {
        id: newCardId,
        bank: newCardBank,
        number: newCardNumber,
        name: newCardHolder.toUpperCase() || userName.toUpperCase(),
        brand: newCardBrand,
        balance: '0' // force 0
      }
      const updated = [...cards, newCard]
      saveCards(updated)

      if (balanceValue > 0) {
        addTransaction({
          id: Date.now(),
          type: 'income',
          amount: balanceValue,
          category: 'Daromad',
          note: 'Karta qo\'shildi (boshlang\'ich balans)',
          date: new Date().toISOString(),
          cardId: newCardId
        })
      }

      setToastMessage(lang === 'uz' ? 'Yangi karta qo\'shildi!' : lang === 'uz_cyrl' ? 'Янги карта қўшилди!' : lang === 'ru' ? 'Новая карта добавлена!' : 'New card successfully added!')
    }

    // Reset card form
    setNewCardNumber('')
    setNewCardBank('')
    setNewCardBalance('')
    setNewCardHolder(userName.toUpperCase())
    setNewCardBrand('uzcard')
    setEditingCardId(null)
    setShowAddCardForm(false)
  }

  // Handle report export with real file download
  const handleExportStart = () => {
    setExportProgress(10)
    const interval = setInterval(() => {
      setExportProgress((p) => {
        if (p === null) return null
        if (p >= 100) {
          clearInterval(interval)
          setTimeout(() => {
            try {
              const now = new Date()
              let filteredTxs = [...customTransactions]

              if (exportPeriod === 'current') {
                filteredTxs = filteredTxs.filter(t => {
                  const d = new Date(t.date || Date.now())
                  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
                })
              } else if (exportPeriod === 'last') {
                const lastM = new Date(now.getFullYear(), now.getMonth() - 1, 1)
                filteredTxs = filteredTxs.filter(t => {
                  const d = new Date(t.date || Date.now())
                  return d.getMonth() === lastM.getMonth() && d.getFullYear() === lastM.getFullYear()
                })
              } else if (exportPeriod === 'quarter') {
                const threeM = new Date(now.getFullYear(), now.getMonth() - 3, 1)
                filteredTxs = filteredTxs.filter(t => new Date(t.date || Date.now()) >= threeM)
              }

              if (exportFormat === 'PDF') {
                const printWin = window.open('', '_blank')
                if (printWin) {
                  printWin.document.write(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                      <meta charset="utf-8">
                      <title>Moliya Financial Report - ${userName}</title>
                      <style>
                        body { font-family: system-ui, -apple-system, sans-serif; padding: 30px; color: #1E1A3C; max-width: 800px; margin: 0 auto; }
                        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #7C3AED; padding-bottom: 16px; margin-bottom: 24px; }
                        h1 { color: #7C3AED; margin: 0; font-size: 24px; }
                        .meta { font-size: 13px; color: #5C548A; margin-bottom: 20px; line-height: 1.6; }
                        table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 14px; }
                        th, td { border: 1px solid #E4E2F0; padding: 12px; text-align: left; }
                        th { background: #F5F3FF; color: #7C3AED; font-weight: 700; }
                        tr:nth-child(even) { background: #FAF9FD; }
                        .type-income { color: #16A34A; font-weight: 600; }
                        .type-expense { color: #DC2626; font-weight: 600; }
                      </style>
                    </head>
                    <body>
                      <div class="header">
                        <h1>Moliya Financial Report</h1>
                        <span>${now.toLocaleDateString()}</span>
                      </div>
                      <div class="meta">
                        <strong>Foydalanuvchi:</strong> ${userName} (${userPhone})<br>
                        <strong>Hisobot davri:</strong> ${exportPeriod === 'current' ? 'Shu oy' : exportPeriod === 'last' ? 'O\'tgan oy' : '3 oy'}<br>
                        <strong>Jami tranzaksiyalar:</strong> ${filteredTxs.length} ta
                      </div>
                      <table>
                        <thead>
                          <tr>
                            <th>Sana</th>
                            <th>Turi</th>
                            <th>Kategoriya</th>
                            <th>Summa</th>
                            <th>Izoh</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${filteredTxs.map(t => {
                            const numAmt = Number(String(t.amount).replace(/\s/g, '').replace(/,/g, '')) || 0
                            const isInc = numAmt > 0
                            return `
                              <tr>
                                <td>${new Date(t.date || Date.now()).toLocaleDateString()}</td>
                                <td class="${isInc ? 'type-income' : 'type-expense'}">${isInc ? 'Daromad' : 'Xarajat'}</td>
                                <td>${t.category}</td>
                                <td class="${isInc ? 'type-income' : 'type-expense'}">${Math.abs(numAmt).toLocaleString('uz-UZ')} so'm</td>
                                <td>${(t.note || '').replace(/</g, '&lt;')}</td>
                              </tr>
                            `
                          }).join('')}
                        </tbody>
                      </table>
                      <script>
                        window.onload = function() { window.print(); }
                      </script>
                    </body>
                    </html>
                  `)
                  printWin.document.close()
                }
              } else {
                // UTF-8 BOM for Excel compatibility
                const BOM = '\uFEFF'
                const headers = "ID;Sana (Date);Turi (Type);Kategoriya (Category);Summa (Amount);Izoh (Note)\n"
                const rows = filteredTxs.map(t => 
                  `"${t.id}";"${t.date ? new Date(t.date).toLocaleDateString() : ''}";"${t.type}";"${t.category}";"${t.amount}";"${(t.note || '').replace(/"/g, '""')}"`
                ).join("\n")
                const content = BOM + headers + rows
                const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
                const url = URL.createObjectURL(blob)
                const link = document.createElement("a")
                link.href = url
                link.download = `Moliya_Report_${exportPeriod}_${now.toISOString().slice(0, 10)}.csv`
                document.body.appendChild(link)
                link.click()
                document.body.removeChild(link)
                URL.revokeObjectURL(url)
              }
            } catch (err) {
              console.error('Export error:', err)
            }

            setExportProgress(null)
            setActiveModal(null)
            setToastMessage(t.exportModal.success)
          }, 300)
          return 100
        }
        return p + 30
      })
    }, 300)
  }

  // Support chat trigger
  const triggerSupportReply = (userQuery: string) => {
    setIsTyping(true)
    setTimeout(() => {
      let replyText = ''
      const q = userQuery.toLowerCase()
      if (q.includes('limit') || q.includes('xarajat') || q.includes('лимит')) {
        replyText = (lang === 'uz' || lang === 'uz_cyrl') 
          ? (lang === 'uz_cyrl' ? 'Лимитларни ўзгартириш учун Бош саҳифага ўтинг ва лимит картасидаги қаламчани ✏️ босинг.' : 'Limitlarni o\'zgartirish uchun Bosh sahifaga o\'ting va limit kartasidagi qalamchani ✏️ bosing.')
          : lang === 'ru'
          ? 'Чтобы изменить лимит, перейдите на Главную страницу и нажмите на иконку карандаша ✏️ на карте лимита.'
          : 'To change limits, navigate to the Home screen and press the pencil icon ✏️ on the limit card.'
      } else if (q.includes('premium') || q.includes('премиум')) {
        replyText = (lang === 'uz' || lang === 'uz_cyrl')
          ? (lang === 'uz_cyrl' ? 'Premium Pro тарифида барча таҳлиллар, PDF/Excel экспорт ва AI маслаҳатчи чексиз тақдим этилади.' : 'Premium Pro tarifida barcha tahlillar, PDF/Excel eksport va AI maslahatchi cheksiz taqdim etiladi.')
          : lang === 'ru'
          ? 'С тарифом Премиум Pro вам доступны безлимитный ИИ-советник, детальный экспорт в PDF/Excel и управление лимитами.'
          : 'Premium Pro unlocks unlimited AI insights, advanced PDF/Excel reports, and flexible custom spend boundaries.'
      } else if (q.includes('grafik') || q.includes('graf') || q.includes('график')) {
        replyText = (lang === 'uz' || lang === 'uz_cyrl')
          ? (lang === 'uz_cyrl' ? 'Таҳлиллар бўлимидаги графиклар жорий ойдаги транзакциялар асосида автоматик шаклланади.' : 'Tahlillar bo\'limidagi grafiklar joriy oydagi tranzaksiyalar asosida avtomatik shakllanadi.')
          : lang === 'ru'
          ? 'Графики и диаграммы в разделе Аналитика обновляются мгновенно при добавлении новых расходов.'
          : 'Graphs and visual statistics on the Analytics screen refresh automatically once any new records are updated.'
      } else {
        replyText = (lang === 'uz' || lang === 'uz_cyrl')
          ? (lang === 'uz_cyrl' ? 'Тушунарли. Саволингиз мутахассисга йўналтирилди. Тез орада жавоб қайтарамиз.' : 'Tushunarli. Savolingiz mutaxassisga yo\'naltirildi. Tez orada javob qaytaramiz.')
          : lang === 'ru'
          ? 'Понятно. Ваш запрос передан специалисту техподдержки. Мы свяжемся с вами в ближайшее время.'
          : 'Understood. Your request has been forwarded to our support specialist. We will get back to you shortly!'
      }

      setChatMessages((prev) => [...prev, { sender: 'support', text: replyText }])
      setIsTyping(false)
    }, 1200)
  }

  const handleSendChat = () => {
    if (!chatInput.trim()) return
    const msg = chatInput
    setChatMessages((prev) => [...prev, { sender: 'user', text: msg }])
    setChatInput('')
    triggerSupportReply(msg)
  }

  const handleClearAllData = async () => {
    if (deleteConfirmName !== userName) {
      alert(lang === 'uz' ? 'Tasdiqlash uchun ismingizni to\'g\'ri kiriting.' : lang === 'uz_cyrl' ? 'Тасдиқлаш учун исмингизни тўғри киритинг.' : 'Please enter your name correctly to confirm.')
      return
    }
    setDeleteConfirmName('')
    setActiveModal(null);
    setToastMessage(lang === 'uz' ? "Ma'lumotlar o'chirilmoqda..." : lang === 'uz_cyrl' ? "Маълумотлар ўчирилмоқда..." : lang === 'ru' ? "Удаление данных..." : "Clearing data...");
    
    try {
      await clearAllData();
      setToastMessage(lang === 'uz' ? "Barcha ma'lumotlar o'chirildi" : lang === 'uz_cyrl' ? "Барча маълумотлар ўчирилди" : lang === 'ru' ? "Все данные удалены" : "All data cleared");
    } catch (e) {
      console.error("Failed to clear data:", e);
    }
    
    setTimeout(() => {
      onClearData?.();
    }, 1000);
  }

  // Get initials for Avatar
  const getInitials = (nameStr: string) => {
    const parts = nameStr.trim().split(' ')
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
    return 'JT'
  }

  return (
    <div style={{ position: 'relative', width: '100%', minHeight: '100%' }}>
      <div style={{ height: 54 }} />

      {/* Header Title */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        style={{ padding: '4px 20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <h2 style={{ fontSize: 24, fontWeight: 700, color: '#1E1A3C', letterSpacing: -0.5 }}>{t.title}</h2>
        {isPremium && (
          <span style={{
            fontSize: 11, fontWeight: 700, color: '#F59E0B', background: '#FEF3C7',
            padding: '4px 10px', borderRadius: 20, border: '1px solid #FCD34D'
          }}>
            PRO 🌟
          </span>
        )}
      </motion.div>

      {/* User profile card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.08 }}
        style={{ padding: '0 20px 20px' }}
      >
        <div style={{
          background: 'linear-gradient(135deg, #FAF9FD 0%, #F5F3FF 100%)', 
          borderRadius: 22, padding: '20px',
          border: '1.5px solid #E4E1F4',
          display: 'flex', alignItems: 'center', gap: 16,
          boxShadow: '0 4px 12px rgba(124, 58, 237, 0.02)'
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: 20, background: '#EDE9FE',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, fontWeight: 800, color: '#7C3AED', flexShrink: 0,
            boxShadow: 'inset 0 1px 3px rgba(124, 58, 237, 0.1)'
          }}>
            {getInitials(userName)}
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: '#1E1A3C', marginBottom: 2 }}>{userName}</h3>
            {userPhone && (
              <p style={{ fontSize: 12.5, color: '#64748B', marginBottom: 3, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span>📞</span> <span>{userPhone}</span>
              </p>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              {userTelegram && (
                <span style={{ fontSize: 11.5, background: '#EDE9FE', color: '#7C3AED', padding: '2px 8px', borderRadius: 8, fontWeight: 600 }}>
                  {userTelegram.startsWith('@') ? userTelegram : '@' + userTelegram}
                </span>
              )}
              {onboarding?.telegramId && (
                <span style={{ fontSize: 11, background: '#F1F5F9', color: '#64748B', padding: '2px 8px', borderRadius: 8, fontWeight: 600 }}>
                  ID: {onboarding.telegramId}
                </span>
              )}
            </div>
          </div>
          <button 
            id="btn_edit_profile"
            onClick={() => {
              setEditName(userName)
              setEditPhone(userPhone)
              setEditTelegram(userTelegram)
              setActiveModal('edit')
            }}
            style={{
              width: 36, height: 36, borderRadius: 11, background: '#FFFFFF',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '1.5px solid #E4E1F4', cursor: 'pointer',
              boxShadow: '0 2px 5px rgba(0,0,0,0.03)',
              outline: 'none', transition: 'all 0.2s'
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M11 2L14 5L5.5 13.5L2 14L2.5 10.5L11 2Z" stroke="#7C3AED" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </motion.div>

      {/* Quick stats board */}
      {(() => {
        const totalTxCount = customTransactions.length + (onboarding?.firstExpense ? 1 : 0)
        
        // Calculate unique active months
        const monthSet = new Set<string>()
        const now = new Date()
        monthSet.add(`${now.getFullYear()}-${now.getMonth() + 1}`)
        customTransactions.forEach((tx) => {
          if (tx.date) {
            const d = new Date(tx.date)
            if (!isNaN(d.getTime())) {
              monthSet.add(`${d.getFullYear()}-${d.getMonth() + 1}`)
            }
          }
        })
        const activeMonths = monthSet.size

        const dynamicStats = [
          { val: activeMonths.toString(), label: t.stats[0].label },
          { val: totalTxCount.toString(), label: t.stats[1].label },
          { val: isPremium ? (lang === 'uz' ? 'Cheksiz' : lang === 'uz_cyrl' ? 'Чексиз' : lang === 'ru' ? 'Безлимит' : 'Unlimited') : '10/50', label: t.stats[2].label },
        ]
        return (
          <div style={{ padding: '0 20px 20px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {dynamicStats.map((s, idx) => (
              <div key={idx} style={{
                background: '#F9F8FD', borderRadius: 16, padding: '14px 12px', textAlign: 'center',
                border: '1.5px solid #E4E1F4',
              }}>
                <p style={{ fontSize: 20, fontWeight: 800, color: '#7C3AED', marginBottom: 4 }}>
                  {s.val}
                </p>
                <p style={{ fontSize: 11, color: '#8B82C4', fontWeight: 500 }}>{s.label}</p>
              </div>
            ))}
          </div>
        )
      })()}

      {/* Premium Upgrade banner */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2 }}
        style={{ padding: '0 20px 20px' }}
      >
        <div 
          onClick={() => setActiveModal('premium')}
          style={{
            background: isPremium ? 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)' : 'linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)', 
            borderRadius: 20, padding: '18px 20px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            position: 'relative', overflow: 'hidden', cursor: 'pointer',
            boxShadow: '0 6px 18px rgba(124, 58, 237, 0.15)',
            transition: 'transform 0.2s'
          }}
        >
          <div style={{
            position: 'absolute', top: -24, right: -24, width: 100, height: 100,
            borderRadius: '50%', background: 'rgba(255,255,255,0.07)',
          }} />
          <div style={{ position: 'relative', zIndex: 2 }}>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', marginBottom: 3, fontWeight: 500 }}>{t.premium.planLabel}</p>
            <p style={{ fontSize: 17, fontWeight: 800, color: '#fff', marginBottom: 2 }}>
              {isPremium ? t.premium.planPremium : t.premium.planName}
            </p>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)' }}>
              {isPremium ? t.premium.usagePremium : t.premium.usage}
            </p>
          </div>
          <button style={{
            padding: '10px 16px', borderRadius: 12, border: 'none',
            background: 'rgba(255,255,255,0.18)', color: '#fff',
            fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
            boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
          }}>
            {isPremium ? t.premium.actionPremium : t.premium.action}
          </button>
        </div>
      </motion.div>

      {/* Menu Sections list */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.28 }}
        style={{ padding: '0 20px 10px' }}
      >
        <p style={{ fontSize: 11, fontWeight: 700, color: '#B8B0DC', marginBottom: 10, letterSpacing: 0.6 }}>
          {t.menu.hisob}
        </p>
        <div style={{
          background: '#FAF9FD', borderRadius: 20, border: '1.5px solid #E4E1F4', overflow: 'hidden',
          boxShadow: '0 2px 8px rgba(0,0,0,0.01)'
        }}>
          {/* Notifications */}
          <div 
            id="menu_item_notifications"
            onClick={() => setActiveModal('notifications')}
            style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
              borderBottom: '1px solid #E4E1F4', cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 18, width: 28, textAlign: 'center' }}>🔔</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#1E1A3C' }}>{t.menu.items.notifications}</p>
              <p style={{ fontSize: 11.5, color: '#8B82C4' }}>
                {notifOpts.opt1 && notifOpts.opt2 ? t.menu.items.notificationsSub : (lang === 'uz' ? 'Tahrirlangan sozlamalar' : lang === 'uz_cyrl' ? 'Таҳрирланган созламалар' : 'Измененные настройки')}
              </p>
            </div>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 3L9 7L5 11" stroke="#C4BDE8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          {/* Security */}
          <div 
            id="menu_item_security"
            onClick={() => setActiveModal('security')}
            style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
              borderBottom: '1px solid #E4E1F4', cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 18, width: 28, textAlign: 'center' }}>🔒</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#1E1A3C' }}>{t.menu.items.security}</p>
              <p style={{ fontSize: 11.5, color: '#8B82C4' }}>
                {securityOpts.pinEnabled ? 'PIN: ON' : 'PIN: OFF'}
              </p>
            </div>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 3L9 7L5 11" stroke="#C4BDE8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          {/* Payment Methods */}
          <div 
            id="menu_item_payments"
            onClick={() => setActiveModal('payments')}
            style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
              cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 18, width: 28, textAlign: 'center' }}>💳</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#1E1A3C' }}>{t.menu.items.payments}</p>
              <p style={{ fontSize: 11.5, color: '#8B82C4' }}>
                {cards.length} {lang === 'uz' ? 'ta karta' : lang === 'uz_cyrl' ? 'та карта' : lang === 'ru' ? 'карты' : 'cards'}
              </p>
            </div>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 3L9 7L5 11" stroke="#C4BDE8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.36 }}
        style={{ padding: '10px 20px 20px' }}
      >
        <p style={{ fontSize: 11, fontWeight: 700, color: '#B8B0DC', marginBottom: 10, letterSpacing: 0.6 }}>
          {t.menu.ilova}
        </p>
        <div style={{
          background: '#FAF9FD', borderRadius: 20, border: '1.5px solid #E4E1F4', overflow: 'hidden',
          boxShadow: '0 2px 8px rgba(0,0,0,0.01)'
        }}>
          {/* App Tour */}
          {onStartTour && (
            <div 
              id="menu_item_app_tour"
              onClick={onStartTour}
              style={{
                display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
                borderBottom: '1px solid #E4E1F4', cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 18, width: 28, textAlign: 'center' }}>🗺️</span>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: '#7C3AED' }}>
                  {(lang === 'uz' || lang === 'uz_cyrl') ? (lang === 'uz_cyrl' ? 'Илова бўйича қўлланма' : "Ilova bo'yicha qo'llanma") : lang === 'ru' ? 'Обзор приложения' : 'App Walkthrough'}
                </p>
                <p style={{ fontSize: 11.5, color: '#8B82C4' }}>
                  {(lang === 'uz' || lang === 'uz_cyrl') ? (lang === 'uz_cyrl' ? 'Қайта кўриб чиқиш ва маслаҳатлар' : "Qayta ko'rib chiqish va maslahatlar") : lang === 'ru' ? 'Интерактивный тур' : 'Interactive Tour'}
                </p>
              </div>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M5 3L9 7L5 11" stroke="#7C3AED" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}

          {/* Language Switcher */}
          <div 
            id="menu_item_lang"
            onClick={() => setActiveModal('lang')}
            style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
              borderBottom: '1px solid #E4E1F4', cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 18, width: 28, textAlign: 'center' }}>🌐</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#1E1A3C' }}>{t.menu.items.lang}</p>
              <p style={{ fontSize: 11.5, color: '#8B82C4' }}>
                {lang === 'uz' ? "O'zbekcha" : lang === 'uz_cyrl' ? "Ўзбекча" : lang === 'ru' ? 'Русский' : 'English'}
              </p>
            </div>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 3L9 7L5 11" stroke="#C4BDE8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          {/* Export Report */}
          <div 
            id="menu_item_export"
            onClick={() => isPremium ? setActiveModal('export') : setActiveModal('premium')}
            style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
              borderBottom: '1px solid #E4E1F4', cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 18, width: 28, textAlign: 'center' }}>📊</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#1E1A3C' }}>{t.menu.items.export}</p>
              <p style={{ fontSize: 11.5, color: '#8B82C4' }}>{t.menu.items.exportSub}</p>
            </div>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 3L9 7L5 11" stroke="#C4BDE8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          {/* Help Support */}
          <div 
            id="menu_item_help"
            onClick={() => setActiveModal('help')}
            style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
              borderBottom: '1px solid #E4E1F4', cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 18, width: 28, textAlign: 'center' }}>❓</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#1E1A3C' }}>{t.menu.items.help}</p>
              <p style={{ fontSize: 11.5, color: '#8B82C4' }}>{t.menu.items.helpSub}</p>
            </div>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 3L9 7L5 11" stroke="#C4BDE8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          {/* Option A: Clear My Data */}
          <div 
            id="menu_item_clear_data"
            onClick={() => {
              setDeleteConfirmName('')
              setActiveModal('clearDataOnly')
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
              borderBottom: '1px solid #E4E1F4', cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 18, width: 28, textAlign: 'center' }}>🧹</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#D97706' }}>{t.menu.items.clearData}</p>
              <p style={{ fontSize: 11.5, color: '#F59E0B' }}>{t.menu.items.clearDataSub}</p>
            </div>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 3L9 7L5 11" stroke="#F59E0B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          {/* Option B: Delete Account */}
          <div 
            id="menu_item_delete_account"
            onClick={() => {
              setDeleteStep(1)
              setDeleteConfirmName('')
              setDeleteInputCode('')
              setDeleteRandomCode(String(Math.floor(1000 + Math.random() * 9000)))
              setActiveModal('clearConfirm')
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
              cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 18, width: 28, textAlign: 'center' }}>🗑️</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#DC2626' }}>{t.menu.items.deleteAccount}</p>
              <p style={{ fontSize: 11.5, color: '#FCA3A3' }}>{t.menu.items.deleteAccountSub}</p>
            </div>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 3L9 7L5 11" stroke="#FCA3A3" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      </motion.div>

      {/* Logout button */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.44 }}
        style={{ padding: '10px 20px 40px' }}
      >
        <button
          onClick={() => setActiveModal('logout_confirm')}
          style={{
            width: '100%', padding: '14px', borderRadius: 16,
            border: '1.5px solid #FCA3A3', background: '#FEF2F2',
            color: '#DC2626', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
            transition: 'all 0.2s'
          }}
        >
          {t.logout}
        </button>
      </motion.div>

      {/* Global Simple Toast */}
      {toastMessage && (
        <div style={{
          position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(30,26,60,0.92)', color: '#FFFFFF', padding: '10px 18px',
          borderRadius: 30, fontSize: 12, fontWeight: 600, zIndex: 1100, textAlign: 'center',
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)', whiteSpace: 'nowrap', pointerEvents: 'none'
        }}>
          {toastMessage}
        </div>
      )}

      {/* ================= MODALS & BOTTOM SHEETS ================= */}

      {/* Backdrop */}
      {activeModal && (
        <div 
          onClick={() => {
            if (activeModal === 'help') {
              // custom help behavior if needed
            }
            setActiveModal(null)
          }}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(15,10,35,0.45)', zIndex: 999,
            backdropFilter: 'blur(3px)', transition: 'all 0.3s'
          }}
        />
      )}

      {/* 1. EDIT PROFILE MODAL */}
      <AnimatePresence>
        {activeModal === 'edit' && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={0.5}
              onDragEnd={(_, info) => {
                if (info.offset.y > 100) setActiveModal(null)
              }}
              transition={{ type: 'spring', damping: 26, stiffness: 220 }}
              style={{
                position: 'relative',
                width: '100%', maxWidth: 440, background: '#FFFFFF',
                borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: '16px 20px 32px',
                boxShadow: '0 -10px 40px rgba(0,0,0,0.15)', zIndex: 1001,
                maxHeight: '90vh', overflowY: 'auto'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ width: 28 }} />
                <div style={{ width: 40, height: 4, background: '#E8E3F8', borderRadius: 2, cursor: 'grab' }} />
                <button
                  onClick={() => setActiveModal(null)}
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
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1E1A3C', marginBottom: 18 }}>{t.editModal.title}</h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#8B82C4', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                    {t.editModal.nameLabel}
                  </label>
                  <input 
                    id="edit_profile_name_input"
                    type="text" 
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    style={{
                      width: '100%', padding: '12px 14px', borderRadius: 12,
                      border: '1.5px solid #E4E1F4', outline: 'none', fontFamily: 'inherit',
                      fontSize: 14, fontWeight: 600, color: '#1E1A3C'
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#8B82C4', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                    {t.editModal.phoneLabel}
                  </label>
                  <input 
                    id="edit_profile_phone_input"
                    type="text" 
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    style={{
                      width: '100%', padding: '12px 14px', borderRadius: 12,
                      border: '1.5px solid #E4E1F4', outline: 'none', fontFamily: 'inherit',
                      fontSize: 14, fontWeight: 600, color: '#1E1A3C'
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#8B82C4', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                    {t.editModal.telegramLabel}
                  </label>
                  <input 
                    id="edit_profile_telegram_input"
                    type="text" 
                    value={editTelegram}
                    onChange={(e) => setEditTelegram(e.target.value)}
                    style={{
                      width: '100%', padding: '12px 14px', borderRadius: 12,
                      border: '1.5px solid #E4E1F4', outline: 'none', fontFamily: 'inherit',
                      fontSize: 14, fontWeight: 600, color: '#1E1A3C'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
                <button 
                  id="btn_cancel_edit_profile"
                  onClick={() => setActiveModal(null)}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 12, border: '1.5px solid #E4E1F4',
                    background: '#FFFFFF', color: '#5C548A', fontSize: 13, fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit'
                  }}
                >
                  {t.editModal.cancelBtn}
                </button>
                <button 
                  id="btn_save_edit_profile"
                  onClick={handleSaveProfile}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 12, border: 'none',
                    background: '#7C3AED', color: '#FFFFFF', fontSize: 13, fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit'
                  }}
                >
                  {t.editModal.saveBtn}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 2. PREMIUM PRO MODAL & PAYMENT SHEET */}
      <AnimatePresence>
        {activeModal === 'premium' && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={0.5}
              onDragEnd={(_, info) => {
                if (info.offset.y > 100) setActiveModal(null)
              }}
              transition={{ type: 'spring', damping: 26, stiffness: 220 }}
              style={{
                position: 'relative',
                width: '100%', maxWidth: 440, background: '#FFFFFF',
                borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: '16px 20px 32px',
                boxShadow: '0 -10px 40px rgba(0,0,0,0.15)', zIndex: 1001,
                maxHeight: '90vh', overflowY: 'auto'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ width: 28 }} />
                <div style={{ width: 40, height: 4, background: '#E8E3F8', borderRadius: 2, cursor: 'grab' }} />
                <button
                  onClick={() => setActiveModal(null)}
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

              <div style={{ textAlign: 'center', marginBottom: 16 }}>
                <span style={{ fontSize: 36 }}>🌟</span>
                <h3 style={{ fontSize: 20, fontWeight: 800, color: '#1E1A3C', marginTop: 6, marginBottom: 4 }}>
                  {t.premiumModal.title}
                </h3>
                <p style={{ fontSize: 12, color: '#8B82C4', padding: '0 10px', lineHeight: 1.4 }}>
                  {t.premiumModal.sub}
                </p>
              </div>

              {/* What Premium gives */}
              <div style={{
                background: '#F5F3FF', borderRadius: 16, padding: '14px 16px',
                border: '1.5px solid #DDD6FE', marginBottom: 16,
                display: 'flex', flexDirection: 'column', gap: 10
              }}>
                <p style={{ fontSize: 12.5, fontWeight: 600, color: '#5B21B6' }}>{t.premiumModal.feature1}</p>
                <p style={{ fontSize: 12.5, fontWeight: 600, color: '#5B21B6' }}>{t.premiumModal.feature2}</p>
                <p style={{ fontSize: 12.5, fontWeight: 600, color: '#5B21B6' }}>{t.premiumModal.feature3}</p>
                <p style={{ fontSize: 12.5, fontWeight: 600, color: '#5B21B6' }}>{t.premiumModal.feature4}</p>
              </div>

              {/* Instant 1-day free trial button */}
              <div style={{ marginBottom: 16 }}>
                <button
                  onClick={() => {
                    handleTogglePremium()
                    setToastMessage((lang === 'uz' || lang === 'uz_cyrl') ? (lang === 'uz_cyrl' ? "1 кунлик бепул синов фаоллаштирилди! 🎉" : "1 kunlik bepul sinov faollashtirildi! 🎉") : "1-day free trial activated! 🎉")
                  }}
                  style={{
                    width: '100%', padding: '13px 16px', borderRadius: 16,
                    border: '1.5px solid #10B981', background: '#ECFDF5',
                    color: '#047857', fontSize: 13.5, fontWeight: 700,
                    cursor: 'pointer', fontFamily: 'inherit',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    boxShadow: '0 2px 8px rgba(16, 185, 129, 0.15)'
                  }}
                >
                  <span>🎁</span>
                  <span>
                    {(lang === 'uz' || lang === 'uz_cyrl') ? (lang === 'uz_cyrl' ? "1 кунлик текин синов (Дарҳол фаол)" : "1 kunlik tekin sinov (Darhol faol)") : "1-Day Free Trial (Instant)"}
                  </span>
                </button>
              </div>

              {/* Subscriptions title */}
              <p style={{ fontSize: 12, fontWeight: 700, color: '#8B82C4', textTransform: 'uppercase', marginBottom: 10, letterSpacing: 0.5 }}>
                {(lang === 'uz' || lang === 'uz_cyrl') ? (lang === 'uz_cyrl' ? "Тариф режалари:" : "Tarif rejalari:") : "Subscription Tiers:"}
              </p>

              {/* Primary Visible Plans */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                {[
                  { code: '1w', title: (lang === 'uz' || lang === 'uz_cyrl') ? (lang === 'uz_cyrl' ? '1 ҳафта' : '1 hafta') : '1 week', price: '9 000 so\'m' },
                  { code: '2w', title: (lang === 'uz' || lang === 'uz_cyrl') ? (lang === 'uz_cyrl' ? '2 ҳафта' : '2 hafta') : '2 weeks', price: '15 000 so\'m' },
                  { code: '1m', title: (lang === 'uz' || lang === 'uz_cyrl') ? (lang === 'uz_cyrl' ? '1 ой' : '1 oy') : '1 month', price: '25 000 so\'m', popular: true },
                ].map((plan) => (
                  <button
                    key={plan.code}
                    onClick={() => setSelectedPlan(plan)}
                    style={{
                      padding: '12px 16px', borderRadius: 14,
                      border: plan.popular ? '2px solid #7C3AED' : '1.5px solid #E8E3F8',
                      background: plan.popular ? '#FAF5FF' : '#FFFFFF',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#1E1A3C' }}>{plan.title}</span>
                      {plan.popular && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#FFFFFF', background: '#7C3AED', padding: '2px 8px', borderRadius: 10 }}>
                          {(lang === 'uz' || lang === 'uz_cyrl') ? (lang === 'uz_cyrl' ? 'Оммабоп' : 'Ommabop') : 'Popular'}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 800, color: '#7C3AED' }}>{plan.price}</span>
                  </button>
                ))}
              </div>

              {/* Expandable "Ko'proq" plans button */}
              {!showMorePlans ? (
                <button
                  onClick={() => setShowMorePlans(true)}
                  style={{
                    width: '100%', padding: '10px', borderRadius: 12, border: '1px dashed #C4BDE8',
                    background: '#FAF9FD', color: '#7C3AED', fontSize: 12.5, fontWeight: 700,
                    cursor: 'pointer', fontFamily: 'inherit', marginBottom: 16
                  }}
                >
                  {(lang === 'uz' || lang === 'uz_cyrl') ? (lang === 'uz_cyrl' ? "Кўпроқ тарифлар 🔽" : "Ko'proq tariflar 🔽") : "Show More Plans 🔽"}
                </button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                  {[
                    { code: '3m', title: (lang === 'uz' || lang === 'uz_cyrl') ? (lang === 'uz_cyrl' ? '3 ой' : '3 oy') : '3 months', price: '65 000 so\'m' },
                    { code: '6m', title: (lang === 'uz' || lang === 'uz_cyrl') ? (lang === 'uz_cyrl' ? '6 ой' : '6 oy') : '6 months', price: '115 000 so\'m', badge: 'Tavsiya' },
                    { code: '1y', title: (lang === 'uz' || lang === 'uz_cyrl') ? (lang === 'uz_cyrl' ? '1 йил' : '1 yil') : '1 year', price: '199 000 so\'m', badge: '-45% Chegirma' },
                  ].map((plan) => (
                    <button
                      key={plan.code}
                      onClick={() => setSelectedPlan(plan)}
                      style={{
                        padding: '12px 16px', borderRadius: 14,
                        border: '1.5px solid #DDD6FE', background: '#F5F3FF',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        cursor: 'pointer', fontFamily: 'inherit'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: '#1E1A3C' }}>{plan.title}</span>
                        {plan.badge && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#047857', background: '#D1FAE5', padding: '2px 8px', borderRadius: 10 }}>
                            {plan.badge}
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 800, color: '#7C3AED' }}>{plan.price}</span>
                    </button>
                  ))}
                </div>
              )}

              <button 
                id="btn_close_premium"
                onClick={() => setActiveModal(null)}
                style={{
                  width: '100%', padding: '13px', borderRadius: 16, border: '1.5px solid #E4E1F4',
                  background: '#FFFFFF', color: '#5C548A', fontSize: 13, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit'
                }}
              >
                {t.premiumModal.cancelBtn}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 2B. PAYMENT DETAILS SHEET */}
      <AnimatePresence>
        {selectedPlan && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1010, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            <div 
              onClick={() => setSelectedPlan(null)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(15,10,35,0.5)', backdropFilter: 'blur(3px)' }}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 220 }}
              style={{
                position: 'relative', width: '100%', maxWidth: 440, background: '#FFFFFF',
                borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: '20px 20px 32px',
                boxShadow: '0 -10px 40px rgba(0,0,0,0.2)', zIndex: 1011
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h3 style={{ fontSize: 18, fontWeight: 800, color: '#1E1A3C' }}>
                  {(lang === 'uz' || lang === 'uz_cyrl') ? (lang === 'uz_cyrl' ? "Тўлов маълумотлари" : "To'lov ma'lumotlari") : "Payment Details"}
                </h3>
                <button
                  onClick={() => setSelectedPlan(null)}
                  style={{
                    width: 28, height: 28, borderRadius: '50%', background: '#F5F4FA',
                    border: 'none', fontSize: 14, color: '#5C548A', cursor: 'pointer', fontWeight: 700
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Plan Summary */}
              <div style={{ background: '#FAF5FF', border: '1.5px solid #DDD6FE', borderRadius: 16, padding: '14px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ fontSize: 11, color: '#8B82C4', fontWeight: 600, textTransform: 'uppercase' }}>
                    {(lang === 'uz' || lang === 'uz_cyrl') ? (lang === 'uz_cyrl' ? "Танланган тариф" : "Tanlangan tarif") : "Selected Plan"}
                  </p>
                  <p style={{ fontSize: 16, fontWeight: 800, color: '#1E1A3C' }}>{selectedPlan.title}</p>
                </div>
                <p style={{ fontSize: 18, fontWeight: 800, color: '#7C3AED' }}>{selectedPlan.price}</p>
              </div>

              {/* Card Number Box */}
              <div style={{ background: '#F7F5FF', border: '1.5px solid #E8E3F8', borderRadius: 16, padding: '16px', marginBottom: 16 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: '#8B82C4', textTransform: 'uppercase', marginBottom: 6 }}>
                  {(lang === 'uz' || lang === 'uz_cyrl') ? (lang === 'uz_cyrl' ? "Дастурчи карта рақами (Humo):" : "Dasturchi karta raqami (Humo):") : "Developer Card (Humo):"}
                </p>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontSize: 17, fontWeight: 800, color: '#1E1A3C', letterSpacing: 1 }}>
                    9860 1701 1341 1376
                  </span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText('9860170113411376')
                      setToastMessage((lang === 'uz' || lang === 'uz_cyrl') ? (lang === 'uz_cyrl' ? "Карта рақами нусхаланди! 📋" : "Karta raqami nusxalandi! 📋") : "Card number copied! 📋")
                    }}
                    style={{
                      padding: '8px 14px', borderRadius: 12, border: 'none',
                      background: '#7C3AED', color: '#FFFFFF', fontSize: 12, fontWeight: 700,
                      cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 2px 6px rgba(124,58,237,0.2)'
                    }}
                  >
                    {(lang === 'uz' || lang === 'uz_cyrl') ? (lang === 'uz_cyrl' ? "Нусхалаш" : "Nusxalash") : "Copy"}
                  </button>
                </div>
              </div>

              {/* Instructions */}
              <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 14, padding: '12px 14px', marginBottom: 20 }}>
                <p style={{ fontSize: 12, color: '#1E40AF', lineHeight: 1.45 }}>
                  ℹ️ {(lang === 'uz' || lang === 'uz_cyrl') 
                    ? (lang === 'uz_cyrl' ? "Тўловни амалга оширгач, чек расмини Telegram орқали @moliya_admin га юборинг. Администратор 5 дақиқа ичида обунани фаоллаштиради." : "To'lovni amalga oshirgach, chek rasmini Telegram orqali @moliya_admin ga yuboring. Administrator 5 daqiqa ichida obunani faollashtiradi.")
                    : "After completing payment, send receipt screenshot via Telegram to @moliya_admin to activate your subscription."
                  }
                </p>
              </div>

              {/* Telegram Admin Button */}
              <button
                onClick={() => {
                  window.open('https://t.me/moliya_admin', '_blank')
                }}
                style={{
                  width: '100%', padding: '14px', borderRadius: 16, border: 'none',
                  background: 'linear-gradient(135deg, #0088CC 0%, #0077B5 100%)',
                  color: '#FFFFFF', fontSize: 14, fontWeight: 700,
                  cursor: 'pointer', fontFamily: 'inherit',
                  boxShadow: '0 4px 14px rgba(0, 136, 204, 0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                }}
              >
                <span>💬</span>
                <span>
                  {(lang === 'uz' || lang === 'uz_cyrl') ? (lang === 'uz_cyrl' ? "Telegram: @moliya_admin га ёзиш" : "Telegram: @moliya_admin ga yozish") : "Telegram: Contact @moliya_admin"}
                </span>
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 2C. LOGOUT CONFIRMATION MODAL */}
      <AnimatePresence>
        {activeModal === 'logout_confirm' && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div
              onClick={() => setActiveModal(null)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(15,10,35,0.45)', backdropFilter: 'blur(3px)' }}
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              style={{
                width: '100%', maxWidth: 360, background: '#FFFFFF',
                borderRadius: 24, padding: '24px 20px', textAlign: 'center',
                boxShadow: '0 20px 40px rgba(0,0,0,0.2)', zIndex: 1001
              }}
            >
              <span style={{ fontSize: 36, display: 'block', marginBottom: 12 }}>🚪</span>
              <h3 style={{ fontSize: 18, fontWeight: 800, color: '#1E1A3C', marginBottom: 6 }}>
                {(lang === 'uz' || lang === 'uz_cyrl') ? (lang === 'uz_cyrl' ? "Иловани тарк этмоқчимисиз?" : "Ilovani tark etmoqchimisiz?") : "Do you want to exit?"}
              </h3>
              <p style={{ fontSize: 13, color: '#8B82C4', marginBottom: 20, lineHeight: 1.4 }}>
                {(lang === 'uz' || lang === 'uz_cyrl') ? (lang === 'uz_cyrl' ? "Тизимдан чиқсангиз, қайта кириш учун тил ва профил созламаларини киритиш керак бўлади." : "Tizimdan chiqsangiz, qayta kirish uchun til va profil sozlamalarini kiritish kerak bo'ladi.") : "If you log out, you will need to complete login onboarding again."}
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => setActiveModal(null)}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 14, border: '1.5px solid #E4E1F4',
                    background: '#FFFFFF', color: '#5C548A', fontSize: 13, fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit'
                  }}
                >
                  {(lang === 'uz' || lang === 'uz_cyrl') ? (lang === 'uz_cyrl' ? "Бекор қилиш" : "Bekor qilish") : "Cancel"}
                </button>
                <button
                  onClick={() => {
                    setActiveModal(null)
                    onLogout()
                  }}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 14, border: 'none',
                    background: '#DC2626', color: '#FFFFFF', fontSize: 13, fontWeight: 700,
                    cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 12px rgba(220, 38, 38, 0.2)'
                  }}
                >
                  {(lang === 'uz' || lang === 'uz_cyrl') ? (lang === 'uz_cyrl' ? "Чиқиш" : "Chiqish") : "Log out"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 3. NOTIFICATIONS MODAL */}
      <AnimatePresence>
        {activeModal === 'notifications' && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={0.5}
              onDragEnd={(_: any, info: any) => {
                if (info.offset.y > 100) setActiveModal(null)
              }}
              transition={{ type: 'spring', damping: 26, stiffness: 220 }}
              style={{
                position: 'relative',
                width: '100%', maxWidth: 440, background: '#FFFFFF',
                borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: '16px 20px 32px',
                boxShadow: '0 -10px 40px rgba(0,0,0,0.15)', zIndex: 1001
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ width: 28 }} />
                <div style={{ width: 40, height: 4, background: '#E8E3F8', borderRadius: 2, cursor: 'grab' }} />
                <button
                  onClick={() => setActiveModal(null)}
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
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1E1A3C', marginBottom: 18 }}>{t.notifModal.title}</h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Opt 1 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500, color: '#1E1A3C' }}>{t.notifModal.opt1}</span>
                  <button 
                    id="toggle_notif_opt1"
                    onClick={() => setNotifOpts(p => ({ ...p, opt1: !p.opt1 }))}
                    style={{
                      width: 48, height: 26, borderRadius: 15, border: 'none',
                      background: notifOpts.opt1 ? '#7C3AED' : '#E4E1F4', position: 'relative',
                      cursor: 'pointer', transition: 'background-color 0.2s'
                    }}
                  >
                    <div style={{
                      width: 20, height: 20, borderRadius: '50%', background: '#FFFFFF',
                      position: 'absolute', top: 3, left: notifOpts.opt1 ? 25 : 3,
                      transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.15)'
                    }} />
                  </button>
                </div>

                {/* Opt 2 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500, color: '#1E1A3C' }}>{t.notifModal.opt2}</span>
                  <button 
                    id="toggle_notif_opt2"
                    onClick={() => setNotifOpts(p => ({ ...p, opt2: !p.opt2 }))}
                    style={{
                      width: 48, height: 26, borderRadius: 15, border: 'none',
                      background: notifOpts.opt2 ? '#7C3AED' : '#E4E1F4', position: 'relative',
                      cursor: 'pointer', transition: 'background-color 0.2s'
                    }}
                  >
                    <div style={{
                      width: 20, height: 20, borderRadius: '50%', background: '#FFFFFF',
                      position: 'absolute', top: 3, left: notifOpts.opt2 ? 25 : 3,
                      transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.15)'
                    }} />
                  </button>
                </div>

                {/* Opt 3 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500, color: '#1E1A3C' }}>{t.notifModal.opt3}</span>
                  <button 
                    id="toggle_notif_opt3"
                    onClick={() => setNotifOpts(p => ({ ...p, opt3: !p.opt3 }))}
                    style={{
                      width: 48, height: 26, borderRadius: 15, border: 'none',
                      background: notifOpts.opt3 ? '#7C3AED' : '#E4E1F4', position: 'relative',
                      cursor: 'pointer', transition: 'background-color 0.2s'
                    }}
                  >
                    <div style={{
                      width: 20, height: 20, borderRadius: '50%', background: '#FFFFFF',
                      position: 'absolute', top: 3, left: notifOpts.opt3 ? 25 : 3,
                      transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.15)'
                    }} />
                  </button>
                </div>
              </div>

              <button 
                id="btn_save_notifications"
                onClick={() => {
                  if (onUpdateOnboarding) {
                    onUpdateOnboarding({ notifications: notifOpts })
                  }
                  setToastMessage(t.notifModal.saved)
                  setActiveModal(null)
                }}
                style={{
                  width: '100%', padding: '12px', borderRadius: 12, border: 'none',
                  background: '#7C3AED', color: '#FFFFFF', fontSize: 13, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit', marginTop: 24
                }}
              >
                {lang === 'uz' ? 'Tayyor' : lang === 'ru' ? 'Готово' : 'Done'}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 4. SECURITY & PIN MODAL */}
      <AnimatePresence>
        {activeModal === 'security' && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={0.5}
              onDragEnd={(_: any, info: any) => {
                if (info.offset.y > 100) setActiveModal(null)
              }}
              transition={{ type: 'spring', damping: 26, stiffness: 220 }}
              style={{
                position: 'relative',
                width: '100%', maxWidth: 440, background: '#FFFFFF',
                borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: '16px 20px 32px',
                boxShadow: '0 -10px 40px rgba(0,0,0,0.15)', zIndex: 1001
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ width: 28 }} />
                <div style={{ width: 40, height: 4, background: '#E8E3F8', borderRadius: 2, cursor: 'grab' }} />
                <button
                  onClick={() => setActiveModal(null)}
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
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1E1A3C', marginBottom: 18 }}>{t.securityModal.title}</h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* PIN enable */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500, color: '#1E1A3C' }}>{t.securityModal.pinEnable}</span>
                  <button 
                    id="toggle_security_pin"
                    onClick={() => {
                      const updated = { ...securityOpts, pinEnabled: !securityOpts.pinEnabled }
                      setSecurityOpts(updated)
                      updateSecurity(updated)
                    }}
                    style={{
                      width: 48, height: 26, borderRadius: 15, border: 'none',
                      background: securityOpts.pinEnabled ? '#7C3AED' : '#E4E1F4', position: 'relative',
                      cursor: 'pointer', transition: 'background-color 0.2s'
                    }}
                  >
                    <div style={{
                      width: 20, height: 20, borderRadius: '50%', background: '#FFFFFF',
                      position: 'absolute', top: 3, left: securityOpts.pinEnabled ? 25 : 3,
                      transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.15)'
                    }} />
                  </button>
                </div>

                {/* Face ID enable */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500, color: '#1E1A3C' }}>{t.securityModal.faceIdEnable}</span>
                  <button 
                    id="toggle_security_faceid"
                    onClick={() => {
                      const updated = { ...securityOpts, faceIdEnabled: !securityOpts.faceIdEnabled }
                      setSecurityOpts(updated)
                      updateSecurity(updated)
                    }}
                    style={{
                      width: 48, height: 26, borderRadius: 15, border: 'none',
                      background: securityOpts.faceIdEnabled ? '#7C3AED' : '#E4E1F4', position: 'relative',
                      cursor: 'pointer', transition: 'background-color 0.2s'
                    }}
                  >
                    <div style={{
                      width: 20, height: 20, borderRadius: '50%', background: '#FFFFFF',
                      position: 'absolute', top: 3, left: securityOpts.faceIdEnabled ? 25 : 3,
                      transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.15)'
                    }} />
                  </button>
                </div>

                {securityOpts.pinEnabled && (
                  <div style={{ borderTop: '1px solid #EAE8F6', paddingTop: 16 }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: '#8B82C4', marginBottom: 8 }}>{t.securityModal.pinSetup}</p>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input 
                        id="security_pin_input"
                        type="password" 
                        maxLength={4}
                        placeholder="****"
                        value={tempPin}
                        onChange={(e) => setTempPin(e.target.value.replace(/\D/g, ''))}
                        style={{
                          width: 100, padding: '10px', borderRadius: 10, border: '1.5px solid #E4E1F4',
                          textAlign: 'center', fontSize: 16, fontWeight: 700, outline: 'none'
                        }}
                      />
                      <button 
                        id="btn_save_pin"
                        onClick={() => {
                          if (tempPin.length === 4) {
                            const updated = { ...securityOpts, pinCode: tempPin }
                            setSecurityOpts(updated)
                            updateSecurity(updated)
                            setToastMessage(t.securityModal.saved)
                            setTempPin('')
                          }
                        }}
                        disabled={tempPin.length !== 4}
                        style={{
                          padding: '0 16px', borderRadius: 10, border: 'none',
                          background: tempPin.length === 4 ? '#7C3AED' : '#E4E1F4',
                          color: '#FFFFFF', fontSize: 12, fontWeight: 600, cursor: 'pointer'
                        }}
                      >
                        O'rnatish
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <button 
                id="btn_save_security"
                onClick={() => {
                  updateSecurity(securityOpts)
                  setToastMessage(t.securityModal.saved)
                  setActiveModal(null)
                }}
                style={{
                  width: '100%', padding: '12px', borderRadius: 12, border: 'none',
                  background: '#7C3AED', color: '#FFFFFF', fontSize: 13, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit', marginTop: 24
                }}
              >
                {lang === 'uz' ? 'Tayyor' : lang === 'ru' ? 'Готово' : 'Done'}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 5. PAYMENTS & CARDS MODAL */}
      <AnimatePresence>
        {activeModal === 'payments' && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={0.5}
              onDragEnd={(_: any, info: any) => {
                if (info.offset.y > 100) setActiveModal(null)
              }}
              transition={{ type: 'spring', damping: 26, stiffness: 220 }}
              style={{
                position: 'relative',
                width: '100%', maxWidth: 440, background: '#FFFFFF',
                borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: '16px 20px 32px',
                boxShadow: '0 -10px 40px rgba(0,0,0,0.15)', zIndex: 1001,
                maxHeight: '85vh', overflowY: 'auto'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1E1A3C' }}>{t.cardsModal.title}</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button 
                    id="btn_add_card_form_toggle"
                    onClick={() => setShowAddCardForm(!showAddCardForm)}
                    style={{
                      padding: '6px 12px', borderRadius: 10, border: 'none',
                      background: '#F0EDF8', color: '#7C3AED', fontSize: 12, fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    {showAddCardForm ? t.cardsModal.cancelBtn : t.cardsModal.addCardBtn}
                  </button>
                  <button 
                    id="btn_close_payments_top"
                    onClick={() => setActiveModal(null)}
                    style={{
                      padding: '6px 12px', borderRadius: 10, border: '1.5px solid #E4E1F4',
                      background: '#FFFFFF', color: '#EF4444', fontSize: 12, fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    {lang === 'uz' ? 'Yopish' : lang === 'ru' ? 'Закрыть' : 'Close'}
                  </button>
                </div>
              </div>

              {/* New Card Form */}
              {showAddCardForm ? (
                <form onSubmit={handleAddCardSubmit} style={{
                  background: '#F9F8FD', borderRadius: 16, padding: '16px',
                  border: '1.5px solid #E4E1F4', marginBottom: 20
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: '#8B82C4', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>
                        Karta Banki nomi
                      </label>
                      <input 
                        id="add_card_bank_input"
                        type="text" 
                        placeholder="TBC Bank, Kapitalbank"
                        required
                        value={newCardBank}
                        onChange={(e) => setNewCardBank(e.target.value)}
                        style={{
                          width: '100%', padding: '10px 12px', borderRadius: 10,
                          border: '1.5px solid #E4E1F4', fontSize: 13, fontWeight: 600, outline: 'none'
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: '#8B82C4', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>
                        Karta egasi nomi
                      </label>
                      <input 
                        id="add_card_holder_input"
                        type="text" 
                        placeholder="JASUR TOSHMATOV"
                        required
                        value={newCardHolder}
                        onChange={(e) => setNewCardHolder(e.target.value.toUpperCase())}
                        style={{
                          width: '100%', padding: '10px 12px', borderRadius: 10,
                          border: '1.5px solid #E4E1F4', fontSize: 13, fontWeight: 600, outline: 'none'
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: '#8B82C4', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>
                        {t.cardsModal.cardNumber} (Humo/Uzcard/Visa)
                      </label>
                      <input 
                        id="add_card_number_input"
                        type="tel" 
                        placeholder="8600 1234 5678 9012"
                        required
                        maxLength={19}
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
                        style={{
                          width: '100%', padding: '10px 12px', borderRadius: 10,
                          border: '1.5px solid #E4E1F4', fontSize: 13, fontWeight: 600, outline: 'none'
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: '#8B82C4', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>
                        Karta Turi (Rang)
                      </label>
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
                              border: newCardBrand === brand.id ? 'none' : '1.5px solid #E4E1F4',
                              fontSize: 11, fontWeight: 600, cursor: 'pointer'
                            }}
                          >
                            {brand.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: '#8B82C4', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>
                        {t.cardsModal.cardBalance}
                      </label>
                      <input 
                        id="add_card_balance_input"
                        type="tel" 
                        placeholder="500 000"
                        value={newCardBalance ? Number(newCardBalance.replace(/\D/g, '')).toLocaleString('en-US').replace(/,/g, ' ') : ''}
                        onChange={(e) => setNewCardBalance(e.target.value.replace(/\D/g, ''))}
                        style={{
                          width: '100%', padding: '10px 12px', borderRadius: 10,
                          border: '1.5px solid #E4E1F4', fontSize: 13, fontWeight: 600, outline: 'none'
                        }}
                      />
                    </div>

                    <button 
                      id="btn_add_card_submit"
                      type="submit"
                      style={{
                        width: '100%', padding: '12px', borderRadius: 12, border: 'none',
                        background: '#7C3AED', color: '#FFFFFF', fontSize: 13, fontWeight: 700,
                        cursor: 'pointer', fontFamily: 'inherit', marginTop: 6
                      }}
                    >
                      {t.cardsModal.addBtn}
                    </button>
                  </div>
                </form>
              ) : null}

              {/* Cards List rendering */}
              {cards.length === 0 ? (
                <p style={{ textAlign: 'center', padding: '30px 0', fontSize: 13, color: '#8B82C4' }}>{t.cardsModal.emptyMsg}</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {cards.map((c, i) => (
                    <BankCard 
                      key={i}
                      id={c.id}
                      bank={c.bank}
                      number={c.number}
                      name={c.name}
                      brand={c.brand || 'uzcard'}
                      balance={getCardBalance(c.id)}
                      currency={lang === 'uz' ? 'so\'m' : lang === 'ru' ? 'сум' : 'so\'m'}
                      editLabel="Tahrirlash"
                      deleteLabel="O'chirish"
                      onEdit={() => {
                        setEditingCardId(c.id)
                        setNewCardBank(c.bank)
                        setNewCardNumber(c.number)
                        setNewCardHolder(c.name)
                        setNewCardBalance(c.balance.toString())
                        setNewCardBrand(c.brand as any || 'uzcard')
                        setShowAddCardForm(true)
                      }}
                      onDelete={() => {
                        if (window.confirm(lang === 'uz' ? "Kartani o'chirmoqchimisiz?" : lang === 'ru' ? "Удалить карту?" : "Delete card?")) {
                          const currentBal = getCardBalance(c.id)
                          if (currentBal !== 0) {
                            addTransaction({
                              id: Date.now(),
                              type: currentBal > 0 ? 'income' : 'expense',
                              amount: Math.abs(currentBal),
                              category: currentBal > 0 ? 'Daromad' : 'Boshqa',
                              note: lang === 'uz'
                                ? `Karta o'chirildi (balans saqlandi: ${c.bank})`
                                : lang === 'ru'
                                ? `Карта удалена (баланс сохранён: ${c.bank})`
                                : `Card removed (balance kept: ${c.bank})`,
                              date: new Date().toISOString(),
                              cardId: undefined,
                            })
                          }
                          saveCards(cards.filter(item => item.id !== c.id))
                        }
                      }}
                    />
                  ))}
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 6. LANGUAGE SELECTOR MODAL */}
      <AnimatePresence>
        {activeModal === 'lang' && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={0.5}
              onDragEnd={(_: any, info: any) => {
                if (info.offset.y > 100) setActiveModal(null)
              }}
              transition={{ type: 'spring', damping: 26, stiffness: 220 }}
              style={{
                position: 'relative',
                width: '100%', maxWidth: 440, background: '#FFFFFF',
                borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: '16px 20px 32px',
                boxShadow: '0 -10px 40px rgba(0,0,0,0.15)', zIndex: 1001
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ width: 28 }} />
                <div style={{ width: 40, height: 4, background: '#E8E3F8', borderRadius: 2, cursor: 'grab' }} />
                <button
                  onClick={() => setActiveModal(null)}
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
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1E1A3C', marginBottom: 16 }}>{lang === 'uz' || lang === 'uz_cyrl' ? (lang === 'uz_cyrl' ? 'Тилни танланг' : 'Tilni tanlang') : lang === 'ru' ? 'Выберите язык' : 'Select Language'}</h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* O'zbekcha - with script type sub-options */}
                {(() => {
                  const isUzbekSelected = lang === 'uz' || lang === 'uz_cyrl'
                  return (
                    <div>
                      <button
                        id="btn_lang_uz"
                        onClick={() => {
                          if (!isUzbekSelected && onUpdateOnboarding) {
                            onUpdateOnboarding({ language: 'uz' })
                            setToastMessage("Muvaffaqiyatli o'rnatildi!")
                          }
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12, padding: '14px',
                          borderRadius: 14, border: '1.5px solid',
                          borderColor: isUzbekSelected ? '#7C3AED' : '#E4E1F4',
                          background: isUzbekSelected ? '#F5F3FF' : '#FFFFFF',
                          cursor: 'pointer', fontFamily: 'inherit', width: '100%'
                        }}
                      >
                        <span style={{ fontSize: 20 }}>🇺🇿</span>
                        <span style={{ fontSize: 14, fontWeight: 600, color: isUzbekSelected ? '#7C3AED' : '#1E1A3C', flex: 1, textAlign: 'left' }}>
                          O'zbekcha
                        </span>
                        {isUzbekSelected && (
                          <span style={{ color: '#7C3AED', fontWeight: 800 }}>✓</span>
                        )}
                      </button>

                      {/* Script type sub-options */}
                      {isUzbekSelected && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 8, paddingLeft: 8 }}>
                          {[
                            { code: 'uz' as const, label: 'Lotin', sublabel: 'A B C D' },
                            { code: 'uz_cyrl' as const, label: 'Кирилл', sublabel: 'А Б В Г' },
                          ].map((st) => {
                            const stActive = lang === st.code
                            return (
                              <button
                                key={st.code}
                                id={`btn_lang_${st.code}`}
                                onClick={() => {
                                  if (onUpdateOnboarding) {
                                    onUpdateOnboarding({ language: st.code })
                                    setToastMessage(st.code === 'uz' ? "Muvaffaqiyatli o'rnatildi!" : "Муваффақиятли ўрнатилди!")
                                    setActiveModal(null)
                                  }
                                }}
                                style={{
                                  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                                  gap: 4, padding: '10px 8px', borderRadius: 12,
                                  border: stActive ? '1.5px solid #7C3AED' : '1px solid #E8E3F8',
                                  background: stActive ? '#F5F3FF' : '#FFFFFF',
                                  cursor: 'pointer', fontFamily: 'inherit',
                                  transition: 'all 0.15s ease',
                                }}
                              >
                                <span style={{ fontSize: 13, fontWeight: 700, color: stActive ? '#7C3AED' : '#1E1A3C' }}>
                                  {st.label}
                                </span>
                                <span style={{ fontSize: 10, color: '#8B82C4', letterSpacing: 1 }}>
                                  {st.sublabel}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* Русский */}
                <button
                  id="btn_lang_ru"
                  onClick={() => {
                    if (onUpdateOnboarding) {
                      onUpdateOnboarding({ language: 'ru' })
                      setToastMessage('Успешно установлено!')
                    }
                    setActiveModal(null)
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '14px',
                    borderRadius: 14, border: '1.5px solid',
                    borderColor: lang === 'ru' ? '#7C3AED' : '#E4E1F4',
                    background: lang === 'ru' ? '#F5F3FF' : '#FFFFFF',
                    cursor: 'pointer', fontFamily: 'inherit', width: '100%'
                  }}
                >
                  <span style={{ fontSize: 20 }}>🇷🇺</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: lang === 'ru' ? '#7C3AED' : '#1E1A3C', flex: 1, textAlign: 'left' }}>
                    Русский
                  </span>
                  {lang === 'ru' && (
                    <span style={{ color: '#7C3AED', fontWeight: 800 }}>✓</span>
                  )}
                </button>

                {/* English */}
                <button
                  id="btn_lang_en"
                  onClick={() => {
                    if (onUpdateOnboarding) {
                      onUpdateOnboarding({ language: 'en' })
                      setToastMessage('Language selected!')
                    }
                    setActiveModal(null)
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '14px',
                    borderRadius: 14, border: '1.5px solid',
                    borderColor: lang === 'en' ? '#7C3AED' : '#E4E1F4',
                    background: lang === 'en' ? '#F5F3FF' : '#FFFFFF',
                    cursor: 'pointer', fontFamily: 'inherit', width: '100%'
                  }}
                >
                  <span style={{ fontSize: 20 }}>🇺🇸</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: lang === 'en' ? '#7C3AED' : '#1E1A3C', flex: 1, textAlign: 'left' }}>
                    English
                  </span>
                  {lang === 'en' && (
                    <span style={{ color: '#7C3AED', fontWeight: 800 }}>✓</span>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 7. EXPORT REPORT MODAL */}
      <AnimatePresence>
        {activeModal === 'export' && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={0.5}
              onDragEnd={(_: any, info: any) => {
                if (info.offset.y > 100) setActiveModal(null)
              }}
              transition={{ type: 'spring', damping: 26, stiffness: 220 }}
              style={{
                position: 'relative',
                width: '100%', maxWidth: 440, background: '#FFFFFF',
                borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: '16px 20px 32px',
                boxShadow: '0 -10px 40px rgba(0,0,0,0.15)', zIndex: 1001
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ width: 28 }} />
                <div style={{ width: 40, height: 4, background: '#E8E3F8', borderRadius: 2, cursor: 'grab' }} />
                <button
                  onClick={() => setActiveModal(null)}
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
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1E1A3C', marginBottom: 18 }}>{t.exportModal.title}</h3>
              
              {exportProgress !== null ? (
                /* Progress state */
                <div style={{ textAlign: 'center', padding: '30px 0' }}>
                  <div style={{
                    width: 48, height: 48, borderRadius: '50%', border: '4px solid #E4E1F4',
                    borderTopColor: '#7C3AED', margin: '0 auto 16px', animation: 'spin 1s linear infinite'
                  }} />
                  <p style={{ fontSize: 14, fontWeight: 600, color: '#1E1A3C', marginBottom: 8 }}>{t.exportModal.generating}</p>
                  <div style={{ width: 140, height: 6, background: '#E4E1F4', borderRadius: 3, margin: '0 auto', overflow: 'hidden' }}>
                    <div style={{ width: `${exportProgress}%`, height: '100%', background: '#7C3AED', transition: 'width 0.3s' }} />
                  </div>
                </div>
              ) : (
                <>
                  {/* Format selection */}
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#8B82C4', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                      {t.exportModal.formatLabel}
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {['PDF', 'Excel', 'CSV'].map((f) => (
                        <button
                          id={`btn_export_format_${f}`}
                          key={f}
                          type="button"
                          onClick={() => setExportFormat(f as any)}
                          style={{
                            flex: 1, padding: '10px', borderRadius: 10, border: '1.5px solid',
                            borderColor: exportFormat === f ? '#7C3AED' : '#E4E1F4',
                            background: exportFormat === f ? '#F5F3FF' : '#FFFFFF',
                            color: exportFormat === f ? '#7C3AED' : '#5C548A',
                            fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit'
                          }}
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Period selection */}
                  <div style={{ marginBottom: 24 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#8B82C4', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                      {t.exportModal.periodLabel}
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {[
                        { key: 'current', label: t.exportModal.periodCurrent },
                        { key: 'last', label: t.exportModal.periodLast },
                        { key: 'quarter', label: t.exportModal.periodQuarter }
                      ].map((p) => (
                        <button
                          id={`btn_export_period_${p.key}`}
                          key={p.key}
                          type="button"
                          onClick={() => setExportPeriod(p.key as any)}
                          style={{
                            width: '100%', padding: '12px', borderRadius: 10, border: '1.5px solid',
                            borderColor: exportPeriod === p.key ? '#7C3AED' : '#E4E1F4',
                            background: exportPeriod === p.key ? '#F5F3FF' : '#FFFFFF',
                            color: exportPeriod === p.key ? '#7C3AED' : '#1E1A3C',
                            fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                            textAlign: 'left'
                          }}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 10 }}>
                    <button 
                      id="btn_cancel_export"
                      onClick={() => setActiveModal(null)}
                      style={{
                        flex: 1, padding: '12px', borderRadius: 12, border: '1.5px solid #E4E1F4',
                        background: '#FFFFFF', color: '#5C548A', fontSize: 13, fontWeight: 600,
                        cursor: 'pointer', fontFamily: 'inherit'
                      }}
                    >
                      {lang === 'uz' ? 'Bekor qilish' : lang === 'ru' ? 'Отмена' : 'Cancel'}
                    </button>
                    <button 
                      id="btn_submit_export"
                      onClick={handleExportStart}
                      style={{
                        flex: 1, padding: '12px', borderRadius: 12, border: 'none',
                        background: '#7C3AED', color: '#FFFFFF', fontSize: 13, fontWeight: 600,
                        cursor: 'pointer', fontFamily: 'inherit'
                      }}
                    >
                      {lang === 'uz' ? 'Eksport qilish' : lang === 'ru' ? 'Экспорт' : 'Export'}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Option A: Clear My Data Modal */}
        {activeModal === 'clearDataOnly' && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setActiveModal(null)}
              style={{ position: 'absolute', inset: 0, background: 'rgba(30, 26, 60, 0.5)', backdropFilter: 'blur(4px)' }} 
            />
            <motion.div 
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              style={{
                position: 'relative',
                width: '100%', maxWidth: 440, background: '#FFFFFF',
                borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: '24px 20px 32px',
                boxShadow: '0 -10px 30px rgba(0,0,0,0.15)', zIndex: 1001
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1E1A3C' }}>
                  🧹 {lang === 'uz' ? "Ma'lumotlarimni tozalash" : lang === 'uz_cyrl' ? "Маълумотларимни тозалаш" : lang === 'ru' ? "Очистить мои данные" : "Clear My Data"}
                </h3>
                <button
                  onClick={() => setActiveModal(null)}
                  style={{
                    width: 28, height: 28, borderRadius: '50%', background: '#F5F4FA', border: 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#5C548A', cursor: 'pointer', fontWeight: 700
                  }}
                >
                  ✕
                </button>
              </div>

              <div style={{ background: '#FEF3C7', padding: '14px 16px', borderRadius: 16, border: '1px solid #FCD34D', marginBottom: 16 }}>
                <p style={{ fontSize: 13, color: '#92400E', lineHeight: 1.5, fontWeight: 500 }}>
                  {lang === 'uz' ? "Barcha moliyaviy yozuvlar, tranzaksiyalar, kategoriyalar, hisobotlar, byudjetlar va maqsadlar o'chiriladi. Hisobingiz va profilingiz faol holatda qoladi va siz ilovadan toza ma'lumotlar bilan foydalanishda davom eta olasiz." : lang === 'uz_cyrl' ? "Барча молиявий ёзувлар, транзакциялар, категориялар, ҳисоботлар, бюджетлар ва мақсадлар ўчирилади. Ҳисобингиз ва профилингиз фаол ҳолатда қолади ва сиз иловадан тоза маълумотлар билан фойдаланишда давом эта оласиз." : lang === 'ru' ? "Все финансовые записи, транзакции, категории, отчеты, бюджеты и цели будут удалены. Ваш аккаунт и профиль останутся активными, и вы сможете продолжить работу с чистыми данными." : "All financial records, transactions, categories, analytics, budgets, and goals will be removed. Your account itself will remain active, and you can continue using the application."}
                </p>
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#1E1A3C', display: 'block', marginBottom: 8 }}>
                  {lang === 'uz' ? `Tasdiqlash uchun ismingizni kiriting (${userName}):` : lang === 'uz_cyrl' ? `Тасдиқлаш учун исмингизни киритинг (${userName}):` : lang === 'ru' ? `Введите имя для подтверждения (${userName}):` : `Enter your name to confirm (${userName}):`}
                </label>
                <input 
                  type="text" 
                  value={deleteConfirmName} 
                  onChange={e => setDeleteConfirmName(e.target.value)} 
                  placeholder={userName}
                  style={{
                    width: '100%', padding: '12px 16px', borderRadius: 12, border: '1.5px solid #E4E1F4',
                    fontSize: 14, outline: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button 
                  onClick={() => setActiveModal(null)}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 12, border: '1.5px solid #E4E1F4',
                    background: '#FFFFFF', color: '#5C548A', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
                  }}
                >
                  {lang === 'uz' ? 'Bekor qilish' : lang === 'uz_cyrl' ? 'Бекор қилиш' : lang === 'ru' ? 'Отмена' : 'Cancel'}
                </button>
                <button 
                  disabled={deleteConfirmName.trim() !== userName.trim()}
                  onClick={async () => {
                    setActiveModal(null)
                    setToastMessage(lang === 'uz' ? "Moliyaviy ma'lumotlar tozalanmoqda..." : lang === 'uz_cyrl' ? "Молиявий маълумотлар тозаланмоқда..." : lang === 'ru' ? "Очистка финансовых данных..." : "Clearing financial data...")
                    await clearOnlyFinancialData()
                    setToastMessage(lang === 'uz' ? "Moliyaviy ma'lumotlar tozalandi! ✅" : lang === 'uz_cyrl' ? "Молиявий маълумотлар тозаланди! ✅" : lang === 'ru' ? "Финансовые данные очищены! ✅" : "Financial data cleared! ✅")
                  }}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 12, border: 'none',
                    background: deleteConfirmName.trim() === userName.trim() ? '#D97706' : '#FCD34D',
                    color: '#FFFFFF', fontSize: 13, fontWeight: 700,
                    cursor: deleteConfirmName.trim() === userName.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit'
                  }}
                >
                  🧹 {lang === 'uz' ? "Ma'lumotlarimni tozalash" : lang === 'uz_cyrl' ? "Маълумотларимни тозалаш" : lang === 'ru' ? "Очистить мои данные" : "Clear My Data"}
                </button>
              </div>
            </motion.div>
          </div>
        )}

      {/* Option B: Account Deletion Wizard Modal */}
        {activeModal === 'clearConfirm' && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setActiveModal(null)}
              style={{ position: 'absolute', inset: 0, background: 'rgba(30, 26, 60, 0.5)', backdropFilter: 'blur(4px)' }} 
            />
            <motion.div 
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              style={{
                position: 'relative',
                width: '100%', maxWidth: 440, background: '#FFFFFF',
                borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: '24px 20px 32px',
                boxShadow: '0 -10px 30px rgba(0,0,0,0.15)', zIndex: 1001
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#DC2626', background: '#FEF2F2', padding: '4px 10px', borderRadius: 12 }}>
                  {lang === 'uz' ? `Qadam ${deleteStep} / 4` : lang === 'uz_cyrl' ? `Қадам ${deleteStep} / 4` : lang === 'ru' ? `Шаг ${deleteStep} / 4` : `Step ${deleteStep} / 4`}
                </span>
                <button
                  onClick={() => setActiveModal(null)}
                  style={{
                    width: 28, height: 28, borderRadius: '50%', background: '#F5F4FA', border: 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#5C548A', cursor: 'pointer', fontWeight: 700
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Step 1: Confirmation Dialog */}
              {deleteStep === 1 && (
                <div>
                  <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1E1A3C', marginBottom: 10 }}>
                    {lang === 'uz' ? "⚠️ Hisobni o'chirish" : lang === 'uz_cyrl' ? "⚠️ Ҳисобни ўчириш" : lang === 'ru' ? "⚠️ Удаление аккаунта" : "⚠️ Delete Account"}
                  </h3>
                  <p style={{ fontSize: 14, color: '#DC2626', marginBottom: 20, lineHeight: 1.5, fontWeight: 500 }}>
                    {lang === 'uz' ? "Siz hisobingizni butunlay o'chirish arafasidasiz. Bu harakatni ortga qaytarib bo'lmaydi." : lang === 'uz_cyrl' ? "Сиз ҳисобингизни бутунлай ўчириш арафасидасиз. Бу ҳаракатни ортга қайтариб бўлмайди." : lang === 'ru' ? "Вы собираетесь навсегда удалить свой аккаунт. Это действие нельзя отменить." : "You are about to permanently delete your account. This action cannot be undone."}
                  </p>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button 
                      onClick={() => setActiveModal(null)}
                      style={{
                        flex: 1, padding: '12px', borderRadius: 12, border: '1.5px solid #E4E1F4',
                        background: '#FFFFFF', color: '#5C548A', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
                      }}
                    >
                      {lang === 'uz' ? 'Bekor qilish' : lang === 'uz_cyrl' ? 'Бекор қилиш' : lang === 'ru' ? 'Отмена' : 'Cancel'}
                    </button>
                    <button 
                      onClick={() => setDeleteStep(2)}
                      style={{
                        flex: 1, padding: '12px', borderRadius: 12, border: 'none',
                        background: '#DC2626', color: '#FFFFFF', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
                      }}
                    >
                      {lang === 'uz' ? 'Davom etish →' : lang === 'uz_cyrl' ? 'Давом этиш →' : lang === 'ru' ? 'Продолжить →' : 'Continue →'}
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: Name Verification */}
              {deleteStep === 2 && (
                <div>
                  <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1E1A3C', marginBottom: 10 }}>
                    {lang === 'uz' ? "👤 Ismingizni tasdiqlang" : lang === 'uz_cyrl' ? "👤 Исмингизни тасдиқланг" : lang === 'ru' ? "👤 Подтвердите имя" : "👤 Confirm Your Name"}
                  </h3>
                  <p style={{ fontSize: 13, color: '#5C548A', marginBottom: 16 }}>
                    {lang === 'uz' ? `Hisobingizni o'chirish uchun ismingizni to'liq va aniq kiriting:` : lang === 'uz_cyrl' ? `Ҳисобингизни ўчириш учун исмингизни киритинг:` : lang === 'ru' ? `Введите точное имя вашего аккаунта:` : `Enter your exact account name:`} <b>{userName}</b>
                  </p>
                  <input 
                    type="text" 
                    value={deleteConfirmName} 
                    onChange={e => setDeleteConfirmName(e.target.value)} 
                    placeholder={userName}
                    style={{
                      width: '100%', padding: '12px 16px', borderRadius: 12, border: '1.5px solid #E4E1F4',
                      fontSize: 14, outline: 'none', marginBottom: 20
                    }}
                  />
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button 
                      onClick={() => setActiveModal(null)}
                      style={{
                        flex: 1, padding: '12px', borderRadius: 12, border: '1.5px solid #E4E1F4',
                        background: '#FFFFFF', color: '#5C548A', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
                      }}
                    >
                      {lang === 'uz' ? 'Bekor qilish' : lang === 'uz_cyrl' ? 'Бекор қилиш' : lang === 'ru' ? 'Отмена' : 'Cancel'}
                    </button>
                    <button 
                      onClick={() => setDeleteStep(3)}
                      disabled={deleteConfirmName.trim() !== userName.trim()}
                      style={{
                        flex: 1, padding: '12px', borderRadius: 12, border: 'none',
                        background: deleteConfirmName.trim() === userName.trim() ? '#DC2626' : '#FCA5A5',
                        color: '#FFFFFF', fontSize: 13, fontWeight: 600,
                        cursor: deleteConfirmName.trim() === userName.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit'
                      }}
                    >
                      {lang === 'uz' ? 'Keyingisi →' : lang === 'uz_cyrl' ? 'Кейингиси →' : lang === 'ru' ? 'Далее →' : 'Next →'}
                    </button>
                  </div>
                </div>
              )}

              {/* Step 3: 4-Digit Code Verification */}
              {deleteStep === 3 && (
                <div>
                  <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1E1A3C', marginBottom: 10 }}>
                    {lang === 'uz' ? "🔢 Tasdiqlash kodi" : lang === 'uz_cyrl' ? "🔢 Тасдиқлаш кодини киритинг" : lang === 'ru' ? "🔢 Код подтверждения" : "🔢 Verification Code"}
                  </h3>
                  <p style={{ fontSize: 13, color: '#5C548A', marginBottom: 12 }}>
                    {lang === 'uz' ? "Quyidagi 4 xonali tasdiqlash kodini kiriting:" : lang === 'uz_cyrl' ? "Қуйидаги 4 хонали тасдиқлаш кодини киритинг:" : lang === 'ru' ? "Введите следующий 4-значный код:" : "Enter the following 4-digit code:"}
                  </p>
                  <div style={{ textAlign: 'center', background: '#F5F4FA', padding: '14px', borderRadius: 16, marginBottom: 16, fontSize: 24, fontWeight: 800, letterSpacing: 6, color: '#7C3AED' }}>
                    {deleteRandomCode}
                  </div>
                  <input 
                    type="text" 
                    maxLength={4}
                    value={deleteInputCode} 
                    onChange={e => setDeleteInputCode(e.target.value)} 
                    placeholder={lang === 'uz' ? "4 xonali kod" : lang === 'uz_cyrl' ? "4 хонали код" : lang === 'ru' ? "4-значный код" : "4-digit code"}
                    style={{
                      width: '100%', padding: '12px 16px', borderRadius: 12, border: '1.5px solid #E4E1F4',
                      fontSize: 18, textAlign: 'center', letterSpacing: 4, outline: 'none', marginBottom: 20
                    }}
                  />
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button 
                      onClick={() => setActiveModal(null)}
                      style={{
                        flex: 1, padding: '12px', borderRadius: 12, border: '1.5px solid #E4E1F4',
                        background: '#FFFFFF', color: '#5C548A', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
                      }}
                    >
                      {lang === 'uz' ? 'Bekor qilish' : lang === 'uz_cyrl' ? 'Бекор қилиш' : lang === 'ru' ? 'Отмена' : 'Cancel'}
                    </button>
                    <button 
                      onClick={() => setDeleteStep(4)}
                      disabled={deleteInputCode.trim() !== deleteRandomCode}
                      style={{
                        flex: 1, padding: '12px', borderRadius: 12, border: 'none',
                        background: deleteInputCode.trim() === deleteRandomCode ? '#DC2626' : '#FCA5A5',
                        color: '#FFFFFF', fontSize: 13, fontWeight: 600,
                        cursor: deleteInputCode.trim() === deleteRandomCode ? 'pointer' : 'not-allowed', fontFamily: 'inherit'
                      }}
                    >
                      {lang === 'uz' ? 'Oxirgi tasdiq →' : lang === 'uz_cyrl' ? 'Охирги тасдиқ →' : lang === 'ru' ? 'Финал →' : 'Final Check →'}
                    </button>
                  </div>
                </div>
              )}

              {/* Step 4: Final Warning & Permanent Delete */}
              {deleteStep === 4 && (
                <div>
                  <h3 style={{ fontSize: 18, fontWeight: 700, color: '#DC2626', marginBottom: 10 }}>
                    {lang === 'uz' ? "🚨 Oxirgi ogohlantirish!" : lang === 'uz_cyrl' ? "🚨 Охирги огоҳлантириш!" : lang === 'ru' ? "🚨 Последнее предупреждение!" : "🚨 Final Warning!"}
                  </h3>
                  <div style={{ background: '#FEF2F2', padding: '14px 16px', borderRadius: 16, border: '1px solid #FCA5A5', marginBottom: 20 }}>
                    <p style={{ fontSize: 13, color: '#991B1B', lineHeight: 1.5, fontWeight: 500 }}>
                      {lang === 'uz' ? "Siz Moliya AI hisobingizni butunlay o'chiryapsiz. Bu harakat profilingiz va barcha ma'lumotlaringizni qayta tiklab bo'lmaydigan qilib o'chirib tashlaydi. O'chirilgan ma'lumotlarni qaytarib bo'lmaydi. Moliya AI hisob to'liq o'chirilgandan keyin yuzaga kelishi mumkin bo'lgan har qanday oqibatlar uchun javobgar emas." : lang === 'uz_cyrl' ? "Сиз Moliya AI ҳисобингизни бутунлай ўчиряпсиз. Бу ҳаракат профилингиз ва барча маълумотларингизни қайта тиклаб бўлмайдиган қилиб ўчириб ташлайди. Ўчирилган маълумотларни қайтариб бўлмайди. Moliya AI ҳисоб тўлиқ ўчирилгандан кейин юзага келиши мумкин бўлган ҳар қандай оқибатлар учун жавобгар эмас." : lang === 'ru' ? "Вы навсегда удаляете свой аккаунт Moliya AI. Это действие безвозвратно удаляет ваш аккаунт и все связанные данные. Удаленные данные невозможно восстановить. Moliya AI не несет ответственности за любые последствия после полного удаления аккаунта." : "You are permanently deleting your Moliya AI account. This action permanently removes your account and associated data. Deleted data cannot be recovered. Moliya AI is not responsible for any consequences after the account has been permanently deleted."}
                    </p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <button 
                      onClick={handleClearAllData}
                      style={{
                        width: '100%', padding: '14px', borderRadius: 14, border: 'none',
                        background: '#DC2626', color: '#FFFFFF', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
                        boxShadow: '0 4px 14px rgba(220, 38, 38, 0.3)'
                      }}
                    >
                      {lang === 'uz' ? "Hisobni va barcha ma'lumotlarni butunlay o'chirish 🗑" : lang === 'uz_cyrl' ? "Ҳисобни ва барча маълумотларни бутунлай ўчириш 🗑" : lang === 'ru' ? "Безвозвратно удалить аккаунт 🗑" : "Permanently Delete Account & All Data 🗑"}
                    </button>
                    <button 
                      onClick={() => setActiveModal(null)}
                      style={{
                        width: '100%', padding: '12px', borderRadius: 12, border: '1.5px solid #E4E1F4',
                        background: '#FFFFFF', color: '#5C548A', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
                      }}
                    >
                      {lang === 'uz' ? "Bekor qilish (Orqaga)" : lang === 'uz_cyrl' ? "Бекор қилиш (Орқага)" : lang === 'ru' ? "Отмена (Назад)" : "Cancel (Go back)"}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      {/* 8. HELP & CHAT SUPPORT MODAL */}
      {activeModal === 'help' && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', justifyContent: 'center'
        }}>
          <div style={{
            position: 'relative', width: '100%', maxWidth: 440, height: '100vh', background: '#FFFFFF',
            zIndex: 1001, display: 'flex', flexDirection: 'column'
          }}>
          {/* Header */}
          <div style={{
            padding: '16px 20px', borderBottom: '1px solid #E4E1F4',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
          }}>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1E1A3C' }}>{t.helpModal.title}</h3>
              <p style={{ fontSize: 11, color: '#22C55E', fontWeight: 600 }}>● Online support team</p>
            </div>
            <button 
              id="btn_close_help"
              onClick={() => setActiveModal(null)}
              style={{
                border: 'none', background: '#F5F4FA', width: 30, height: 30,
                borderRadius: '50%', fontSize: 14, cursor: 'pointer', color: '#1E1A3C'
              }}
            >
              ✕
            </button>
          </div>

          {/* Chat Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 11, color: '#8B82C4', textAlign: 'center', marginBottom: 10 }}>{t.helpModal.sub}</p>

            {chatMessages.map((m, idx) => (
              <div 
                key={idx} 
                style={{
                  alignSelf: m.sender === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '80%',
                  background: m.sender === 'user' ? '#7C3AED' : '#F5F4FA',
                  color: m.sender === 'user' ? '#FFFFFF' : '#1E1A3C',
                  padding: '10px 14px', borderRadius: 14,
                  borderBottomRightRadius: m.sender === 'user' ? 2 : 14,
                  borderBottomLeftRadius: m.sender === 'support' ? 2 : 14,
                  fontSize: 13, lineHeight: 1.45, fontWeight: 500,
                  boxShadow: '0 1px 2px rgba(0,0,0,0.02)'
                }}
              >
                {m.text}
              </div>
            ))}

            {isTyping && (
              <div style={{
                alignSelf: 'flex-start',
                background: '#F5F4FA', color: '#8B82C4',
                padding: '8px 12px', borderRadius: 14,
                fontSize: 11.5, fontWeight: 500, fontStyle: 'italic'
              }}>
                {t.helpModal.typing}
              </div>
            )}
          </div>

          {/* Quick FAQ Pills */}
          <div style={{
            padding: '10px 14px', borderTop: '1px solid #F5F4FA',
            display: 'flex', gap: 6, overflowX: 'auto', background: '#FAF9FE'
          }}>
            {[
              { text: t.helpModal.faq1 },
              { text: t.helpModal.faq2 },
              { text: t.helpModal.faq3 }
            ].map((faq, idx) => (
              <button
                id={`btn_faq_${idx}`}
                key={idx}
                onClick={() => {
                  setChatMessages(prev => [...prev, { sender: 'user', text: faq.text }])
                  triggerSupportReply(faq.text)
                }}
                style={{
                  padding: '6px 12px', borderRadius: 20, border: '1px solid #E4E1F4',
                  background: '#FFFFFF', color: '#7C3AED', fontSize: 11, fontWeight: 600,
                  cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit'
                }}
              >
                {faq.text}
              </button>
            ))}
          </div>

          {/* Chat input form */}
          <div style={{ padding: '12px 14px', borderTop: '1px solid #E4E1F4', display: 'flex', gap: 10, alignItems: 'center' }}>
            <input 
              id="chat_message_input"
              type="text"
              placeholder={t.helpModal.placeholder}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
              style={{
                flex: 1, padding: '12px 14px', borderRadius: 12,
                border: '1.5px solid #E4E1F4', fontSize: 13, fontWeight: 500,
                outline: 'none', fontFamily: 'inherit'
              }}
            />
            <button 
              id="btn_send_chat_message"
              onClick={handleSendChat}
              style={{
                background: '#7C3AED', color: '#FFFFFF', border: 'none',
                width: 40, height: 40, borderRadius: 12, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}
            >
              ➔
            </button>
          </div>
        </div>
      </div>
    )}

      {/* Embedded CSS animations */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
