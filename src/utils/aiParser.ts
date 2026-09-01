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
  'bir': 1, 'ikki': 2, 'uch': 3, "to'rt": 4, 'besh': 5,
  'olti': 6, 'yetti': 7, 'sakkiz': 8, "to'qqiz": 9, "o'n": 10,
  'yigirma': 20, "o'ttiz": 30, 'qirq': 40, 'ellik': 50,
  'oltmish': 60, 'yetmish': 70, 'sakson': 80, "to'qson": 90,
  'yuz': 100, 'ming': 1000, 'million': 1000000, 'mln': 1000000,
  'минг': 1000, 'миллион': 1000000, 'млн': 1000000,
  'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
  'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
  'twenty': 20, 'fifty': 50, 'hundred': 100,
  'один': 1, 'два': 2, 'три': 3, 'четыре': 4, 'пять': 5,
  'шесть': 6, 'семь': 7, 'восемь': 8, 'девять': 9, 'десять': 10,
  'двадцать': 20, 'пятьдесят': 50, 'сто': 100, 'тысяча': 1000
}

export function parseAITransaction(text: string, cardsList: any[] = []): ParsedTransaction {
  if (!text || typeof text !== 'string') {
    return {
      type: 'expense',
      amount: '',
      category: 'Boshqa',
      note: '',
      title: '',
      date: (new Date(Date.now() - new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16),
      cardId: 'cash'
    }
  }

  let cleanText = text.trim().toLowerCase().replace(/[`ʻ‘’]/g, "'")

  // 1. TRANSACTION TYPE DETECTION
  let type: EntryType = 'expense'

  const incomeKeywords = [
    'pul topdim', 'topdim', 'ishlab topdim', 'maosh', 'oylik', 'зарплата', 'salary',
    'tushdi', 'daromad', 'freelance', 'stipendiya', 'bonus', "sovg'a", 'tushum',
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
  let extractedNum: number | null = null

  // A) Pre-clean text: remove currency words (like "so'm", "som", "uzs")
  // so the 'm' in "so'm" does NOT trigger the million multiplier!
  let procText = cleanText
    .replace(/(so'm|som|sum|сўм|сум|uzs)/gi, ' ')
    .replace(/\b(dollar|dollor|usd|\$)\b/gi, ' ')
    .replace(/\b(rubl|rub|руб|₽)\b/gi, ' ')

  // B) Check "yarim" (half) multipliers: e.g. "2 yarim mln" -> 2500000, "1 yarim ming" -> 1500
  const yarimMlnMatch = procText.match(/(\d+(?:[\.,]\d+)?)\s*(?:yarim|\.5|,5)\s*(?:million|mln|миллион|млн)\b/i)
  const yarimMingMatch = procText.match(/(\d+(?:[\.,]\d+)?)\s*(?:yarim|\.5|,5)\s*(?:ming|минг|тыс)\b/i)

  if (yarimMlnMatch) {
    const base = parseFloat(yarimMlnMatch[1].replace(',', '.'))
    extractedNum = (base + 0.5) * 1000000
  } else if (yarimMingMatch) {
    const base = parseFloat(yarimMingMatch[1].replace(',', '.'))
    extractedNum = (base + 0.5) * 1000
  }

  // C) Check Millions: e.g. "14 mln", "14 million", "1.5 mln", "14m" (only digits before m)
  if (extractedNum === null) {
    const mlnMatch = procText.match(/(\d+(?:[\.,]\d+)?)\s*(?:million|milliion|milyon|миллион|mln|млн)\b/i) ||
                     procText.match(/\b(\d+(?:[\.,]\d+)?)\s*m\b(?!\w)/i)
    if (mlnMatch) {
      const val = parseFloat(mlnMatch[1].replace(',', '.'))
      if (!isNaN(val)) extractedNum = Math.round(val * 1000000)
    }
  }

  // D) Check Thousands: e.g. "500 ming", "50k", "25.5k", "500 тысяч"
  if (extractedNum === null) {
    const mingMatch = procText.match(/(\d+(?:[\.,]\d+)?)\s*(?:ming|минг|тысяч|тыс|тысяча)\b/i) ||
                      procText.match(/\b(\d+(?:[\.,]\d+)?)\s*k\b(?!\w)/i)
    if (mingMatch) {
      const val = parseFloat(mingMatch[1].replace(',', '.'))
      if (!isNaN(val)) extractedNum = Math.round(val * 1000)
    }
  }

  // E) Check Raw Numbers: e.g. "25000", "25 000", "25.000", "14000000"
  if (extractedNum === null) {
    // Find numbers formatted like "25 000", "25,000", "25.000" or raw "25000"
    const rawMatches = procText.match(/\b\d{1,3}(?:[\s\.,]\d{3})+\b/) || procText.match(/\b\d{3,12}\b/) || procText.match(/\b\d+\b/)
    if (rawMatches) {
      const digitsOnly = rawMatches[0].replace(/[\s\.,]/g, '')
      const val = parseInt(digitsOnly, 10)
      if (!isNaN(val) && val > 0) {
        extractedNum = val
      }
    }
  }

  // F) Check Uzbek word numbers: e.g. "yigirma besh ming", "ellik ming", "bir million"
  if (extractedNum === null) {
    let wordSum = 0
    const words = procText.split(/\s+/)
    for (const w of words) {
      if (numberWords[w]) {
        const val = numberWords[w]
        if (val === 1000 || val === 1000000) {
          wordSum = (wordSum || 1) * val
        } else {
          wordSum += val
        }
      }
    }
    if (wordSum > 0) {
      extractedNum = wordSum
    }
  }

  let amount = ''
  if (extractedNum !== null && extractedNum > 0) {
    amount = extractedNum.toLocaleString('en-US').replace(/,/g, ' ')
  } else {
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
    } else if (cleanText.includes("sovg'a") || cleanText.includes('подарок') || cleanText.includes('gift')) {
      category = "Sovg'a"
    } else {
      category = 'Maosh'
    }
  } else if (type === 'debt' || type === 'lending') {
    category = "Do'st"
  } else {
    // Expense Categories
    const foodKeywords = ['korzinka', 'makro', 'supermarket', 'ovqat', 'osh', 'tushlik', 'eda', 'lunch', 'dinner', 'cafe', 'restoran', 'kofe', 'burger', 'lavash', 'somsa', 'choyxana', 'продукты', 'еда', 'бозор', 'bozor', 'yegulik', 'toshkent osh', 'non']
    const transportKeywords = ['taksi', 'taxi', 'yandex', 'avtobus', 'metro', 'benzin', 'zapravka', 'proezd', 'fuel', 'car', 'mashina', 'parkovka', 'транспорт', 'яндекс']
    const clothesKeywords = ['kiyim', 'shoes', 'poyabzal', 'clothes', 'zara', 'nike', 'odejda', 'shim', "ko'ylak", 'kurtka', 'обувь', 'одежда', 'backpack', 'ryukzak', 'рюкзак', 'sumka', 'сумка', 'bag', 'portfel', 'портфель', 'narsa']
    const utilitiesKeywords = ['svet', 'gaz', 'suv', 'wifi', 'internet', 'ijara', 'arenda', 'kvartira', 'komunal', 'utilities', 'rent', 'uy', 'коммуналка']
    const healthKeywords = ['dorixona', 'apteka', 'doktor', 'vrach', 'dori', 'pharmacy', 'medicine', 'klinika', 'лекарство', 'аптека']
    const eduKeywords = ['kurs', 'maktab', 'universitet', 'kitob', 'book', 'study', 'ucheba', 'обучение', 'книга', 'ruчка', 'ruchka', 'daftar']
    const funKeywords = ['kino', 'cinema', "o'yin", 'game', 'park', 'concert', 'кино', 'игра', 'развлечение']

    if (foodKeywords.some(kw => cleanText.includes(kw))) category = 'Oziq-ovqat'
    else if (transportKeywords.some(kw => cleanText.includes(kw))) category = 'Transport'
    else if (clothesKeywords.some(kw => cleanText.includes(kw))) category = 'Kiyim'
    else if (utilitiesKeywords.some(kw => cleanText.includes(kw))) category = 'Kommunal'
    else if (healthKeywords.some(kw => cleanText.includes(kw))) category = "Sog'liq"
    else if (eduKeywords.some(kw => cleanText.includes(kw))) category = "Ta'lim"
    else if (funKeywords.some(kw => cleanText.includes(kw))) category = "Ko'ngil ochar"
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
