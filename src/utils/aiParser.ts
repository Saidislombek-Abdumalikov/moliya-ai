export type EntryType = 'expense' | 'income' | 'debt' | 'lending'

export interface ParsedTransaction {
  type: EntryType
  amount: string
  category: string
  note: string
  title?: string
  debtWho?: string
  date?: string
  cardId?: string
}

const numberWords: Record<string, number> = {
  'bir': 1, 'one': 1, 'один': 1,
  'ikki': 2, 'two': 2, 'два': 2,
  'uch': 3, 'three': 3, 'три': 3,
  'to\'rt': 4, 'four': 4, 'четыре': 4,
  'besh': 5, 'five': 5, 'пять': 5,
  'olti': 6, 'six': 6, 'шесть': 6,
  'yetti': 7, 'seven': 7, 'семь': 7,
  'sakkiz': 8, 'eight': 8, 'восемь': 8,
  'to\'qqiz': 9, 'nine': 9, 'девять': 9,
  'o\'n': 10, 'ten': 10, 'десять': 10,
  'yuz': 100, 'hundred': 100, 'сто': 100,
}

export function parseAITransaction(text: string, cardsList: any[] = []): ParsedTransaction {
  const cleanText = text.trim().toLowerCase()

  // 1. TRANSACTION TYPE DETECTION (Done early to help amount & category context)
  let type: EntryType = 'expense'

  const incomeKeywords = [
    'pul topdim', 'topdim', 'ishlab topdim', 'maosh', 'oylik', 'зарплата', 'salary',
    'tushdi', 'daromad', 'freelance', 'stipendiya', 'bonus', 'sovg\'a', 'tushum',
    'kirdi', 'доход', 'заработал', 'получил', 'пришло', 'поступили', 'нашел',
    'выиграл', 'аванс', 'earned', 'received', 'income'
  ]
  const debtKeywords = ['qarz oldim', 'zajom', 'borrowed', 'borch', 'в долг взял', 'взял в долг', 'qarzga oldim']
  const lendingKeywords = ['qarz berdim', 'berdim', 'lent', 'gave debt', 'дал в долг', 'в долг дал', 'qarzga berdim']

  if (incomeKeywords.some(kw => cleanText.includes(kw))) {
    type = 'income'
  } else if (debtKeywords.some(kw => cleanText.includes(kw))) {
    type = 'debt'
  } else if (lendingKeywords.some(kw => cleanText.includes(kw))) {
    type = 'lending'
  }

  // 2. AMOUNT EXTRACTION
  let amount = ''
  
  // A) Match numbers with Million multiplier: e.g. "1 million", "1.5 mln", "10 million", "bir million"
  const mlnMatch = cleanText.match(/(\d+(?:[\.,]\d+)?|\b[a-z']+\b)\s*(?:million|milliion|milyon|миллион|млн|m\b)/i)
  
  // B) Match numbers with Thousand multiplier: e.g. "500 ming", "25k", "25.5k", "500 тысяч", "500 тыс"
  const mingMatch = cleanText.match(/(\d+(?:[\.,]\d+)?|\b[a-z']+\b)\s*(?:ming|тысяч|тыс|тысяча|k\b)/i)
  
  // C) Match currency amount: e.g. "100$", "100 dollar", "100 доллар", "$100"
  const dollarMatch = cleanText.match(/(\d+(?:[\.,]\d+)?)\s*(?:\$|dollar|доллар|usd)/i)
  
  // D) Match raw numbers: e.g. "1000000", "1 000 000", "250.000", "25000"
  const rawNumMatch = cleanText.match(/(?:^|\s)(\d{1,3}(?:[\s\.,]\d{3})*|\d+)(?:\s*(?:som|so'm|сум|rub|руб))?(?:\s|$)/i)

  if (mlnMatch) {
    let num = parseFloat(mlnMatch[1].replace(',', '.'))
    if (isNaN(num)) {
      num = numberWords[mlnMatch[1]] || 1
    }
    const val = num * 1000000
    amount = Math.round(val).toLocaleString('en-US').replace(/,/g, ' ')
  } else if (mingMatch) {
    let num = parseFloat(mingMatch[1].replace(',', '.'))
    if (isNaN(num)) {
      num = numberWords[mingMatch[1]] || 1
    }
    const val = num * 1000
    amount = Math.round(val).toLocaleString('en-US').replace(/,/g, ' ')
  } else if (dollarMatch) {
    const val = parseFloat(dollarMatch[1].replace(',', '.'))
    amount = val.toString()
  } else if (rawNumMatch) {
    const digitsOnly = rawNumMatch[1].replace(/[\s\.,]/g, '')
    if (digitsOnly.length > 0) {
      const val = parseInt(digitsOnly, 10)
      if (!isNaN(val)) {
        amount = val.toLocaleString('en-US').replace(/,/g, ' ')
      }
    }
  }

  // Fallback default amount if no numbers detected
  if (!amount || amount === '0') {
    amount = type === 'income' ? '1 000 000' : '25 000'
  }

  // 3. CATEGORY DETECTION
  let category = 'Boshqa'

  if (type === 'income') {
    if (cleanText.includes('maosh') || cleanText.includes('oylik') || cleanText.includes('зарплата') || cleanText.includes('salary') || cleanText.includes('pul topdim') || cleanText.includes('topdim') || cleanText.includes('ishlab topdim')) {
      category = 'Maosh'
    } else if (cleanText.includes('freelance') || cleanText.includes('zakaz') || cleanText.includes('проект')) {
      category = 'Freelance'
    } else if (cleanText.includes('biznes') || cleanText.includes('savdo') || cleanText.includes('магазин')) {
      category = 'Biznes'
    } else if (cleanText.includes('sovg\'a') || cleanText.includes('подарок') || cleanText.includes('gift')) {
      category = 'Sovg\'a'
    } else {
      category = 'Maosh'
    }
  } else if (type === 'debt' || type === 'lending') {
    category = "Do'st"
  } else {
    // Expense Categories
    const foodKeywords = ['korzinka', 'makro', 'supermarket', 'ovqat', 'osh', 'tushlik', 'eda', 'lunch', 'dinner', 'cafe', 'restoran', 'kofe', 'burger', 'lavash', 'somsa', 'choyxana', 'продукты', 'еда', 'бозор', 'bozor', 'yegulik', 'toshkent osh', 'non']
    const transportKeywords = ['taksi', 'taxi', 'yandex', 'avtobus', 'metro', 'benzin', 'zapravka', 'proezd', 'fuel', 'car', 'mashina', 'parkovka', 'транспорт', 'яндекс']
    const clothesKeywords = ['kiyim', 'shoes', 'poyabzal', 'clothes', 'zara', 'nike', 'odejda', 'shim', 'ko\'ylak', 'kurtka', 'обувь', 'одежда', 'backpack', 'ryukzak', 'рюкзак', 'sumka', 'сумка', 'bag', 'portfel', 'портфель', 'narsa']
    const utilitiesKeywords = ['svet', 'gaz', 'suv', 'wifi', 'internet', 'ijara', 'arenda', 'kvartira', 'komunal', 'utilities', 'rent', 'uy', 'коммуналка']
    const healthKeywords = ['dorixona', 'apteka', 'doktor', 'vrach', 'dori', 'pharmacy', 'medicine', 'klinika', 'лекарство', 'аптека']
    const eduKeywords = ['kurs', 'maktab', 'universitet', 'kitob', 'book', 'study', 'ucheba', 'обучение', 'книга', 'ruчка', 'ruchka', 'daftar']
    const funKeywords = ['kino', 'cinema', 'o\'yin', 'game', 'park', 'concert', 'кино', 'игра', 'развлечение']

    if (foodKeywords.some(kw => cleanText.includes(kw))) category = 'Oziq-ovqat'
    else if (transportKeywords.some(kw => cleanText.includes(kw))) category = 'Transport'
    else if (clothesKeywords.some(kw => cleanText.includes(kw))) category = 'Kiyim'
    else if (utilitiesKeywords.some(kw => cleanText.includes(kw))) category = 'Kommunal'
    else if (healthKeywords.some(kw => cleanText.includes(kw))) category = 'Sog\'liq'
    else if (eduKeywords.some(kw => cleanText.includes(kw))) category = 'Ta\'lim'
    else if (funKeywords.some(kw => cleanText.includes(kw))) category = 'Ko\'ngil ochar'
    else category = 'Boshqa'
  }

  // 4. CARD MATCHING
  let cardId = 'cash'
  if (Array.isArray(cardsList) && cardsList.length > 0) {
    for (const c of cardsList) {
      if (cleanText.includes(c.bank?.toLowerCase() || '') || cleanText.includes(c.brand?.toLowerCase() || '')) {
        cardId = c.id
        break
      }
    }
  }

  // 5. DEBT WHO
  let debtWho: string | undefined
  if (type === 'debt' || type === 'lending') {
    const words = text.split(' ')
    if (words.length > 1) {
      debtWho = words[0]
    }
  }

  const localISOTime = (new Date(Date.now() - new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16)

  return {
    type,
    amount,
    category,
    note: text,
    title: text,
    debtWho,
    date: localISOTime,
    cardId
  }
}
