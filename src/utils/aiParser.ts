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

// Word to number mapping supporting Uzbek (Latin & Cyrillic), Russian, and English
const wordsMap: Record<string, number> = {
  // Units
  'bir': 1, 'one': 1, 'один': 1, 'одна': 1, 'бир': 1,
  'ikki': 2, 'two': 2, 'два': 2, 'две': 2, 'икки': 2,
  'uch': 3, 'three': 3, 'три': 3, 'уч': 3,
  'to\'rt': 4, 'tort': 4, 'four': 4, 'четыре': 4, 'тўрт': 4, 'торт': 4,
  'besh': 5, 'five': 5, 'пять': 5, 'беш': 5,
  'olti': 6, 'six': 6, 'шесть': 6, 'олти': 6,
  'yetti': 7, 'seven': 7, 'семь': 7, 'етти': 7,
  'sakkiz': 8, 'eight': 8, 'восемь': 8, 'саккиз': 8,
  'to\'qqiz': 9, 'toqqiz': 9, 'nine': 9, 'девять': 9, 'тўққиз': 9, 'токкиз': 9,

  // Teens & Tens
  'o\'n': 10, 'on': 10, 'ten': 10, 'десять': 10, 'ўн': 10, 'он': 10,
  'o\'n bir': 11, 'on bir': 11, 'eleven': 11, 'одиннадцать': 11, 'ўн бир': 11,
  'o\'n ikki': 12, 'on ikki': 12, 'twelve': 12, 'двенадцать': 12, 'ўн икки': 12,
  'o\'n uch': 13, 'on uch': 13, 'тринадцать': 13, 'ўн уч': 13,
  'o\'n to\'rt': 14, 'on tort': 14, 'четырнадцать': 14, 'ўн тўрт': 14,
  'o\'n besh': 15, 'on besh': 15, 'fifteen': 15, 'пятнадцать': 15, 'ўн беш': 15,
  'o\'n olti': 16, 'on olti': 16, 'шестнадцать': 16, 'ўн олти': 16,
  'o\'n yetti': 17, 'on yetti': 17, 'семнадцать': 17, 'ўн етти': 17,
  'o\'n sakkiz': 18, 'on sakkiz': 18, 'восемнадцать': 18, 'ўн саккиз': 18,
  'o\'n to\'qqiz': 19, 'on toqqiz': 19, 'девятнадцать': 19, 'ўн тўққиз': 19,

  'yigirma': 20, 'twenty': 20, 'двадцать': 20, 'йигирма': 20,
  'o\'ttiz': 30, 'ottiz': 30, 'thirty': 30, 'тридцать': 30, 'ўттиз': 30, 'оттиз': 30,
  'qirq': 40, 'forty': 40, 'сорок': 40, 'қирқ': 40,
  'ellik': 50, 'fifty': 50, 'пятьдесят': 50, 'эллик': 50,
  'oltmish': 60, 'sixty': 60, 'шестьдесят': 60, 'олтмиш': 60,
  'yetmish': 70, 'seventy': 70, 'семьдесят': 70, 'етмиш': 70,
  'sakson': 80, 'eighty': 80, 'восемьдесят': 80, 'саксон': 80,
  'to\'qson': 90, 'toqson': 90, 'ninety': 90, 'девяносто': 90, 'тўқсон': 90,

  // Hundreds
  'yuz': 100, 'hundred': 100, 'сто': 100, 'юз': 100,
  'ikki yuz': 200, 'двести': 200, 'икки юз': 200,
  'uch yuz': 300, 'триста': 300, 'уч юз': 300,
  'to\'rt yuz': 400, 'tort yuz': 400, 'четыреста': 400, 'тўрт юз': 400,
  'besh yuz': 500, 'пятьсот': 500, 'беш юз': 500,
  'olti yuz': 600, 'шестьсот': 600, 'олти юз': 600,
  'yetti yuz': 700, 'семьсот': 700, 'етти юз': 700,
  'sakkiz yuz': 800, 'восемьсот': 800, 'саккиз юз': 800,
  'to\'qqiz yuz': 900, 'toqqiz yuz': 900, 'девятьсот': 900, 'тўққиз юз': 900,

  // Half / Yarim
  'yarim': 0.5, 'пол': 0.5, 'полтора': 1.5, 'bir yarim': 1.5, 'бир ярим': 1.5,
}

export function parseAITransaction(text: string, cardsList: any[] = []): ParsedTransaction {
  const originalText = text.trim()
  const cleanText = originalText
    .toLowerCase()
    .replace(/[‘`ʻʼ]/g, "'")
    .replace(/\s+/g, ' ')

  // 1. TRANSACTION TYPE DETECTION
  let type: EntryType = 'expense'

  const incomeKeywords = [
    'pul topdim', 'topdim', 'ishlab topdim', 'maosh', 'oylik', 'зарплата', 'salary',
    'tushdi', 'daromad', 'freelance', 'frilans', 'stipendiya', 'bonus', 'sovg\'a', 'tushum',
    'kirdi', 'доход', 'заработал', 'получил', 'пришло', 'поступили', 'нашел',
    'выиграл', 'аванс', 'earned', 'received', 'income', 'кешбек', 'keshbek', 'cashback',
    'тушди', 'маош', 'ойлик', 'даромад', 'стипендия', 'бонус', 'совға'
  ]
  const debtKeywords = [
    'qarz oldim', 'qarzga oldim', 'qarz ko\'tardim', 'zajom', 'borrowed', 'borch',
    'в долг взял', 'взял в долг', 'қарз олдим', 'қарзга олдим'
  ]
  const lendingKeywords = [
    'qarz berdim', 'qarzga berdim', 'pul berib turdim', 'berdim', 'lent', 'gave debt',
    'дал в долг', 'в долг дал', 'қарз бердим', 'қарзга бердим'
  ]

  if (debtKeywords.some(kw => cleanText.includes(kw))) {
    type = 'debt'
  } else if (lendingKeywords.some(kw => cleanText.includes(kw))) {
    type = 'lending'
  } else if (incomeKeywords.some(kw => cleanText.includes(kw))) {
    type = 'income'
  }

  // 2. AMOUNT EXTRACTION ENGINE
  let rawAmount = 0

  // Pattern 1: Millions ("1.5 mln", "2 million", "bir yarim million", "5 миллион", "3.2m")
  const mlnRegex = /(?:(\d+(?:[\.,]\d+)?)|(bir yarim|бир ярим|yarim|полтора|пол|бир|икки|уч|тўрт|беш|олти|етти|саккиз|тўққиз|ўн|йигирма|ўттиз|қирқ|эллик|bir|ikki|uch|to'rt|tort|besh|olti|yetti|sakkiz|to'qqiz|toqqiz|o'n|on|yigirma|o'ttiz|ottiz|qirq|ellik|один|два|три|четыре|пять|шесть|семь|восемь|девять|десять))\s*(?:million|milyon|milliion|миллион|млн|mln|m\b)/i
  const mlnMatch = cleanText.match(mlnRegex)

  // Pattern 2: Thousands with number or words ("45 ming", "45k", "150minglik", "200 минг", "500 тыс", "yuz ellik ming")
  const mingRegex = /(?:(\d+(?:[\.,]\d+)?)|(bir yarim|бир ярим|yarim|полтора|пол|yuz ellik|bir yuz|ikki yuz|uch yuz|to'rt yuz|besh yuz|olti yuz|yetti yuz|sakkiz yuz|to'qqiz yuz|yuz|сто|двести|триста|четыреста|пятьсот|шестьсот|семьсот|восемьсот|девятьсот|ўн беш|йигирма беш|ўттиз беш|қирқ беш|эллик|бир|икки|уч|тўрт|беш|олти|етти|саккиз|тўққиз|ўн|йигирма|ўттиз|қирқ|bir|ikki|uch|to'rt|tort|besh|olti|yetti|sakkiz|to'qqiz|toqqiz|o'n|on|o'n besh|on besh|yigirma|yigirma besh|o'ttiz|o'ttiz besh|qirq|qirq besh|ellik|oltmish|yetmish|sakson|to'qson|toqson|один|два|три|четыре|пять|шесть|семь|восемь|девять|десять|двадцать|тридцать|сорок|пятьдесят))\s*(?:minglik|mingga|ming|минг|тысяч|тыс|тысяча|к\b|k\b)/i
  const mingMatch = cleanText.match(mingRegex)

  // Pattern 3: Currency / Dollar ("100$", "50 dollar", "$25")
  const dollarRegex = /(?:\$|\b)(\d+(?:[\.,]\d+)?)\s*(?:\$|dollar|доллар|usd)\b/i
  const dollarMatch = cleanText.match(dollarRegex)

  // Pattern 4: Explicit numeric with suffix or standalone digits ("45000 so'm", "45 000 som", "150000", "25 000")
  const numericWithCurrency = /(\d{1,3}(?:[\s\.,]\d{3})+|\d+)\s*(?:so'm|som|сўм|сум|rub|руб|uzs)/i
  const numCurrMatch = cleanText.match(numericWithCurrency)

  // Pattern 5: Standalone 3+ digit number in text ("tushlik 45000", "taxi 25000")
  const standaloneDigits = /(?:^|\s)(\d{1,3}(?:[\s\.,]\d{3})+|\d{3,9})(?:\s|$|[a-zа-я])/i
  const standaloneMatch = cleanText.match(standaloneDigits)

  if (mlnMatch) {
    let multiplier = 1
    if (mlnMatch[1]) {
      multiplier = parseFloat(mlnMatch[1].replace(',', '.'))
    } else if (mlnMatch[2]) {
      multiplier = wordsMap[mlnMatch[2]] || 1
    }
    rawAmount = Math.round(multiplier * 1000000)
  } else if (mingMatch) {
    let multiplier = 1
    if (mingMatch[1]) {
      multiplier = parseFloat(mingMatch[1].replace(',', '.'))
    } else if (mingMatch[2]) {
      multiplier = wordsMap[mingMatch[2]] || 1
    }
    rawAmount = Math.round(multiplier * 1000)
  } else if (dollarMatch) {
    const val = parseFloat(dollarMatch[1].replace(',', '.'))
    rawAmount = val // Keep dollar amount directly
  } else if (numCurrMatch) {
    const digitsOnly = numCurrMatch[1].replace(/[\s\.,]/g, '')
    rawAmount = parseInt(digitsOnly, 10) || 0
  } else if (standaloneMatch) {
    const digitsOnly = standaloneMatch[1].replace(/[\s\.,]/g, '')
    rawAmount = parseInt(digitsOnly, 10) || 0
  } else {
    // Check spoken words without explicit "ming" or "million"
    for (const [w, val] of Object.entries(wordsMap)) {
      if (cleanText.includes(w)) {
        rawAmount = val < 100 ? val * 1000 : val
        break
      }
    }
  }

  // Format amount string
  let amountStr = ''
  if (rawAmount > 0) {
    amountStr = rawAmount.toLocaleString('en-US').replace(/,/g, ' ')
  } else {
    amountStr = type === 'income' ? '1 000 000' : '25 000'
  }

  // 3. CATEGORY DETECTION
  let category = 'Boshqa'

  if (type === 'income') {
    if (cleanText.includes('maosh') || cleanText.includes('oylik') || cleanText.includes('зарплата') || cleanText.includes('salary') || cleanText.includes('аванс') || cleanText.includes('маош') || cleanText.includes('ойлик')) {
      category = 'Maosh'
    } else if (cleanText.includes('freelance') || cleanText.includes('frilans') || cleanText.includes('zakaz') || cleanText.includes('проект') || cleanText.includes('заказ')) {
      category = 'Freelance'
    } else if (cleanText.includes('biznes') || cleanText.includes('savdo') || cleanText.includes('магазин') || cleanText.includes('бизнес') || cleanText.includes('савдо')) {
      category = 'Biznes'
    } else if (cleanText.includes('invest') || cleanText.includes('foyda') || cleanText.includes('dividend') || cleanText.includes('инвестиции')) {
      category = 'Investitsiya'
    } else if (cleanText.includes('sovg\'a') || cleanText.includes('sovga') || cleanText.includes('подарок') || cleanText.includes('gift') || cleanText.includes('совға')) {
      category = 'Sovg\'a'
    } else {
      category = 'Maosh'
    }
  } else if (type === 'debt' || type === 'lending') {
    if (cleanText.includes('bank') || cleanText.includes('kredit') || cleanText.includes('банк') || cleanText.includes('кредит')) {
      category = 'Bank'
    } else if (cleanText.includes('akam') || cleanText.includes('ukam') || cleanText.includes('opam') || cleanText.includes('singlim') || cleanText.includes('dadam') || cleanText.includes('onam') || cleanText.includes('oila') || cleanText.includes('семья')) {
      category = 'Oila'
    } else if (cleanText.includes('hamkasb') || cleanText.includes('ishxona') || cleanText.includes('коллега')) {
      category = 'Hamkasb'
    } else {
      category = "Do'st"
    }
  } else {
    // Expense Categories
    const foodKeywords = [
      'ovqat', 'tushlik', 'nonushta', 'kechki ovqat', 'osh', 'somsa', 'lagmon', 'lag\'mon', 'lavash',
      'burger', 'pizza', 'pitsa', 'shashlik', 'manti', 'fastfood', 'fastfud', 'kofe', 'coffee', 'choy',
      'choyxana', 'bozor', 'go\'sht', 'gosht', 'non', 'sut', 'suv', 'kola', 'meva', 'sabzavot',
      'korzinka', 'makro', 'havas', 'supermarket', 'magazin', 'shirinlik', 'tort', 'muzqaymoq',
      'restoran', 'kafe', 'cafe', 'еда', 'обед', 'ужин', 'завтрак', 'кофе', 'мясо', 'хлеб', 'продукты', 'бозор', 'ош'
    ]
    const transportKeywords = [
      'taksi', 'taxi', 'yandex', 'yandeks', 'indrive', 'indriver', 'benzin', 'gaz', 'propan', 'metan',
      'zapravka', 'avtomoyka', 'moyka', 'remont', 'zapchast', 'shina', 'balon', 'avtobus', 'metro',
      'poyezd', 'bilet', 'samolyot', 'radar', 'shtraf', 'jarima', 'parkovka', 'транспорт', 'бензин', 'заправка', 'яндекс'
    ]
    const clothesKeywords = [
      'kiyim', 'libos', 'ko\'ylak', 'koylak', 'shim', 'jinsi', 'futbolka', 'kurtka', 'palto', 'poyabzal',
      'tufli', 'krossovka', 'keta', 'etik', 'sumka', 'ryukzak', 'kamar', 'zara', 'nike', 'adidas',
      'одежда', 'обувь', 'куртка', 'штаны', 'джинсы', 'кроссовки', 'сумка', 'рюкзак', 'кийим'
    ]
    const utilitiesKeywords = [
      'svet', 'elektr', 'gaz', 'suv', 'issiq suv', 'musor', 'chiqindi', 'internet', 'wifi', 'vayfay',
      'beeline', 'ucell', 'mobiuz', 'uztelecom', 'tarif', 'ijara', 'arenda', 'kvartira', 'uy',
      'коммуналка', 'свет', 'газ', 'вода', 'интернет', 'аренда', 'квартира'
    ]
    const healthKeywords = [
      'dorixona', 'apteka', 'dori', 'tabletka', 'ukol', 'vitamin', 'doktor', 'vrach', 'poliklinika',
      'klinika', 'shifoxona', 'uzi', 'analiz', 'tish', 'stomatolog', 'sportzal', 'fitnes',
      'аптека', 'лекарства', 'таблетки', 'врач', 'больница', 'зубы', 'стоматолог', 'дори'
    ]
    const eduKeywords = [
      'kurs', 'repetitor', 'kitob', 'daftar', 'ruchka', 'kanselyariya', 'maktab', 'bog\'cha', 'bogcha',
      'universitet', 'institut', 'kontrakt', 'darslik', 'ielts', 'ucheba', 'книга', 'курсы', 'школа', 'китоб', 'таълим'
    ]
    const funKeywords = [
      'kino', 'kinoteatr', 'film', 'konsert', 'teatr', 'o\'yin', 'oyin', 'ps', 'playstation', 'billiard',
      'park', 'attraksion', 'sayohat', 'dacha', 'dam olish', 'кино', 'игры', 'отдых', 'парк', 'концерт'
    ]

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
      if (
        cleanText.includes(c.bank?.toLowerCase() || '') ||
        cleanText.includes(c.brand?.toLowerCase() || '') ||
        cleanText.includes(c.name?.toLowerCase() || '')
      ) {
        cardId = c.id
        break
      }
    }
  }

  // 5. DEBT WHO / TARGET PERSON
  let debtWho: string | undefined
  if (type === 'debt' || type === 'lending') {
    const words = originalText.split(/\s+/)
    for (const w of words) {
      const cleanW = w.replace(/[^\wа-яА-ЯўқғҳЎҚҒҲ']/gi, '')
      if (cleanW.length >= 3 && !['qarz', 'oldim', 'berdim', 'pul', 'ming', 'som', 'so\'m', 'uchun', 'kredit', 'bank'].includes(cleanW.toLowerCase())) {
        debtWho = cleanW.replace(/ga$|dan$|ni$/i, '')
        break
      }
    }
  }

  // 6. SHORT TITLE CREATION
  let title = originalText
  if (category === 'Oziq-ovqat') title = 'Oziq-ovqat / Taom'
  else if (category === 'Transport') title = 'Transport / Yo\'l'
  else if (category === 'Kiyim') title = 'Kiyim-kechak'
  else if (category === 'Kommunal') title = 'Kommunal / Internet'
  else if (category === 'Sog\'liq') title = 'Sog\'liq / Dorixona'
  else if (category === 'Ta\'lim') title = 'Ta\'lim / Kitob'
  else if (category === 'Ko\'ngil ochar') title = 'Hordiq / O\'yin'
  else if (category === 'Maosh') title = 'Maosh / Daromad'
  else if (type === 'debt') title = `Qarz olindi (${debtWho || "Do'st"})`
  else if (type === 'lending') title = `Qarz berildi (${debtWho || "Do'st"})`

  return {
    type,
    amount: amountStr,
    category,
    note: originalText,
    title,
    debtWho,
    cardId
  }
}
