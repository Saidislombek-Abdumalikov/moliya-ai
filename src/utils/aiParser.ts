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
  isLocalParsed?: boolean
}

// 1. Uzbek & Russian Word Numbers Map
const WORD_NUMBERS: Record<string, number> = {
  'nol': 0, 'ноль': 0,
  'bir': 1, 'bitta': 1, 'bita': 1, 'один': 1, 'one': 1,
  'ikki': 2, 'ikkita': 2, 'iki': 2, 'два': 2, 'two': 2,
  'uch': 3, 'uchta': 3, 'три': 3, 'three': 3,
  "to'rt": 4, "to'rtta": 4, 'tort': 4, 'turt': 4, 'четыре': 4, 'four': 4,
  'besh': 5, 'beshta': 5, 'пять': 5, 'five': 5,
  'olti': 6, 'oltita': 6, 'шесть': 6, 'six': 6,
  'yetti': 7, 'yettita': 7, 'etti': 7, 'ettita': 7, 'семь': 7, 'seven': 7,
  'sakkiz': 8, 'sakkizta': 8, 'sakiz': 8, 'восемь': 8, 'eight': 8,
  "to'qqiz": 9, "to'qqizta": 9, 'toqqiz': 9, 'девять': 9, 'nine': 9,
  "o'n": 10, 'on': 10, 'o‘n': 10, 'o`n': 10, 'десять': 10, 'ten': 10,
  'yigirma': 20, 'двадцать': 20, 'twenty': 20,
  "o'ttiz": 30, 'ottiz': 30, 'otiz': 30, 'тридцать': 30, 'thirty': 30,
  'qirq': 40, 'сорок': 40, 'forty': 40,
  'ellik': 50, 'elik': 50, 'пятьдесят': 50, 'fifty': 50,
  'oltmish': 60, 'oltmis': 60, 'шестьдесят': 60, 'sixty': 60,
  'yetmish': 70, 'yetmis': 70, 'семьдесят': 70, 'seventy': 70,
  'sakson': 80, 'восемьдесят': 80, 'eighty': 80,
  "to'qson": 90, 'toqson': 90, 'девяносто': 90, 'ninety': 90,
  'yuz': 100, 'сто': 100, 'hundred': 100,
  'ming': 1000, 'минг': 1000, 'тысяча': 1000, 'тыс': 1000, 'thousand': 1000,
  'million': 1000000, 'миллион': 1000000, 'mln': 1000000, 'млн': 1000000, 'milyon': 1000000
}

const UZBEK_SUFFIXES = [
  'likdan', 'likka', 'chidan', 'chiga',
  'larga', 'lardan', 'larda',
  'lik', 'dan', 'ga', 'ka', 'qa', 'da', 'ni', 'ning', 'si', 'cha', 'lar'
]

export function stripSuffix(word: string): string {
  if (!word || word.length <= 3) return word
  const lower = word.toLowerCase()
  for (const suf of UZBEK_SUFFIXES) {
    if (lower.length > suf.length + 2 && lower.endsWith(suf)) {
      return lower.slice(0, -suf.length)
    }
  }
  return lower
}

/**
 * Resolves compound spoken/written numbers before single multiplier expansion:
 * - "1mln 250 ming" -> "1250000"
 * - "2 mln 500k" -> "2500000"
 * - "50 ming 500" -> "50500"
 */
export function resolveCompoundNumbers(raw: string): string {
  if (!raw) return raw
  let text = raw.toLowerCase().replace(/[`ʻ‘’]/g, "'")

  // Compound Million + Thousand + Hundred: e.g. "1mln 250 ming"
  text = text.replace(/(\d+)\s*(?:mln|млн|million|миллион|m)\s*(\d+)\s*(?:ming|минг|k|к)\s*(\d{1,3})?\b/gi, (_, mln, th, h) => {
    const total = parseInt(mln, 10) * 1000000 + parseInt(th, 10) * 1000 + (h ? parseInt(h, 10) : 0)
    return ` ${total} `
  })

  // Compound Million + Thousand (k): e.g. "2 mln 500k"
  text = text.replace(/(\d+)\s*(?:mln|млн|million|миллион|m)\s*(\d+)\s*(?:k|к)\b/gi, (_, mln, th) => {
    const total = parseInt(mln, 10) * 1000000 + parseInt(th, 10) * 1000
    return ` ${total} `
  })

  // Colloquial "1mln 250" where second number is 1-3 digits
  text = text.replace(/(\d+)\s*(?:mln|млн|million|миллион|m)\s*(\d{1,3})\b(?!\s*(?:so'm|som|sum|dollar|rubl|%))/gi, (_, mln, th) => {
    const total = parseInt(mln, 10) * 1000000 + parseInt(th, 10) * 1000
    return ` ${total} `
  })

  // Compound Thousand + Hundreds: e.g. "50 ming 500", "25k 500"
  text = text.replace(/(\d+)\s*(?:ming|минг|k|к)\s*(\d{1,3})\b/gi, (_, th, h) => {
    const total = parseInt(th, 10) * 1000 + parseInt(h, 10)
    return ` ${total} `
  })

  return text
}

/**
 * Extracts numeric value from spoken or written text
 */
export function extractAmountFromText(raw: string): number | null {
  if (!raw || typeof raw !== 'string') return null
  let text = raw.toLowerCase().replace(/[`ʻ‘’]/g, "'")

  // Remove currency words so 'm' in "so'm" doesn't trigger million
  text = text.replace(/\b(so'm|som|sum|сўм|сум|uzs)\b/gi, ' ')
  text = text.replace(/\b(dollar|dollor|usd|\$)\b/gi, ' ')
  text = text.replace(/\b(rubl|rub|руб|₽)\b/gi, ' ')

  // 1. Resolve compound numbers
  text = resolveCompoundNumbers(text)

  // 2. Multipliers abbreviations
  text = text.replace(/(\d+)\s*(k|к)\b/gi, '$1000')
  text = text.replace(/(\d+)\s*(mln|млн|million|миллион)\b/gi, (_, n) => `${n}000000`)
  text = text.replace(/(\d+)\s*(m|м)\b(?!\w)/gi, (_, n) => `${n}000000`)
  text = text.replace(/(\d+)\s*(ming|минг)\b/gi, (_, n) => `${n}000`)

  // 3. Decimals & "yarim" (e.g. 2 yarim mln, 2.5 mln, 500 yarim ming)
  text = text.replace(/(\d+)\s*(yarim|\.5|,5)\s*(mln|million|000000)\b/gi, (_, n) => `${n}500000`)
  text = text.replace(/(\d+)\s*(yarim|\.5|,5)\s*(ming|000)\b/gi, (_, n) => `${n}500`)
  text = text.replace(/(\d+)[.,](\d+)\s*(mln|million|000000)\b/gi, (_, whole, frac) => {
    const paddedFrac = frac.padEnd(6, '0').slice(0, 6)
    return `${whole}${paddedFrac}`
  })

  // 4. Colloquial suffixes
  text = text.replace(/(\d+)\s*mingga\b/gi, '$1000')
  text = text.replace(/(\d+)\s*mlnga\b/gi, '$1000000')

  // 5. Extract explicit digits
  const cleanedDigits = text.replace(/(\d+)\s+(\d{3})\b/g, '$1$2')
  const numberMatch = cleanedDigits.match(/\b\d{3,12}\b/)
  if (numberMatch) {
    const val = parseInt(numberMatch[0].replace(/\s+/g, ''), 10)
    if (!isNaN(val) && val > 0) return val
  }

  // Also check smaller numbers (e.g. 50, 100)
  const anyDigitsMatch = cleanedDigits.match(/\b\d{1,12}\b/)
  if (anyDigitsMatch) {
    const val = parseInt(anyDigitsMatch[0], 10)
    if (!isNaN(val) && val > 0) return val
  }

  // 6. Word numbers parsing (e.g. "besh yuz ming", "ellik ming", "bir million")
  const words = text.split(/\s+/)
  let total = 0
  let current = 0
  let hasNum = false

  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/[^\w']/g, '')
    if (w === 'yarim' && (words[i + 1] === 'million' || words[i + 1] === 'mln' || words[i + 1] === 'ming')) {
      current += 0.5
      hasNum = true
      continue
    }

    const val = WORD_NUMBERS[w]
    if (val !== undefined) {
      hasNum = true
      if (val === 1000 || val === 1000000) {
        if (current === 0) current = 1
        total += current * val
        current = 0
      } else if (val === 100) {
        if (current === 0) current = 1
        current = current * 100
      } else {
        current += val
      }
    }
  }

  total += current
  if (hasNum && total > 0) {
    return total
  }

  return null
}

/**
 * Multiplier Guard: Detects and corrects AI 1000x multiplier hallucinations (500 ming -> 500,000,000)
 */
export function correctAiMultiplierHallucination(aiAmount: number, rawText: string, extraNote?: string): number {
  if (!aiAmount || isNaN(aiAmount) || aiAmount <= 0) return aiAmount

  const combined = `${rawText || ''} ${extraNote || ''}`.trim()
  if (!combined) return aiAmount

  const localAmt = extractAmountFromText(combined)
  if (localAmt && localAmt > 0) {
    if (aiAmount === localAmt * 1000 || aiAmount === localAmt * 1000000) {
      console.log(`[CLIENT_GUARD] Corrected 1000x hallucination: ${aiAmount} -> ${localAmt}`)
      return localAmt
    }
  }

  const hasThousand = /\b(\d+(?:[.,]\d+)?)\s*(?:ming|минг|k|к)\b/i.test(combined)
  const hasMillion = /\b(\d+(?:[.,]\d+)?)\s*(?:million|миллион|mln|млн)\b/i.test(combined)

  if (hasThousand && !hasMillion && aiAmount >= 100000000) {
    const corrected = Math.round(aiAmount / 1000)
    console.log(`[CLIENT_GUARD] Corrected ming-to-million mixup: ${aiAmount} -> ${corrected}`)
    return corrected
  }

  return aiAmount
}

// Category Vocabulary & Rules
interface CategoryRule {
  category: string
  type: EntryType
  regex: RegExp
}

const CATEGORY_RULES: CategoryRule[] = [
  // 1. Ta'lim (Education) - HIGH PRIORITY
  {
    category: "Ta'lim",
    type: 'expense',
    regex: /\b(kurs\w*|o'qish\w*|oqish\w*|kontrakt\w*|kantrakt\w*|repetitor\w*|repititor\w*|maktab\w*|maktap\w*|universitet\w*|institut\w*|kollej\w*|dars\w*|daftar\w*|ruchka\w*|kitob\w*|talim\w*|ta'lim\w*|ucheba\w*|obuchenie\w*)\b/i
  },
  // 2. Transport
  {
    category: 'Transport',
    type: 'expense',
    regex: /\b(taxi\w*|taksi\w*|taxsi\w*|yandex\w*|yandeks\w*|benzin\w*|metan\w*|propan\w*|zapravka\w*|avtobus\w*|metro\w*|yo'?lkira\w*|yolkira\w*|mashina\w*|moy\w*|zapchast\w*|parkovka\w*|stoyanka\w*|radar\w*|shtraf\w*|moyka\w*)\b/i
  },
  // 3. Oziq-ovqat (Food & Groceries)
  {
    category: 'Oziq-ovqat',
    type: 'expense',
    regex: /\b(ovqat\w*|avqat\w*|non\w*|go'?sht\w*|gosht\w*|bozor\w*|bozrlik\w*|korzinka\w*|makro\w*|havas\w*|supermarket\w*|osh\w*|choyxona\w*|lunch\w*|obed\w*|tushlik\w*|kechki\s+ovqat|kafe\w*|restoran\w*|kofe\w*|coffee\w*|lavash\w*|shashlik\w*|somsa\w*|shirinlik\w*|suv\w*|ichimlik\w*|magazin\w*|eda\w*|produkt\w*)\b/i
  },
  // 4. Kommunal (Utilities)
  {
    category: 'Kommunal',
    type: 'expense',
    regex: /\b(svet\w*|swet\w*|svyet\w*|gaz\w*|suv\w*|musor\w*|kommunal\w*|kvartira\w*|arenda\w*|ijara\w*|wifi\w*|internet\w*|beeline\w*|ucell\w*|uztelecom\w*|mobiuz\w*|paynet\w*|elektr\w*|isitish\w*|domkom\w*|kommunalka\w*)\b/i
  },
  // 5. Sog'liq (Health)
  {
    category: "Sog'liq",
    type: 'expense',
    regex: /\b(dori\w*|dorixona\w*|dorxona\w*|apteka\w*|abteka\w*|shifokor\w*|doktor\w*|klinika\w*|analiz\w*|tish\w*|stomatolog\w*|ukol\w*|retsept\w*|operatsiya\w*|shifoxona\w*|bolnitsa\w*|lekarstvo\w*)\b/i
  },
  // 6. Kiyim (Clothes & Shopping)
  {
    category: 'Kiyim',
    type: 'expense',
    regex: /\b(kiyim\w*|poyafzal\w*|kurtka\w*|shim\w*|ko'ylak\w*|koylak\w*|oyoq\s+kiyim|futbolka\w*|kostyum\w*|palto\w*|etik\w*|krossovka\w*|paypoq\w*|shapka\w*|sumka\w*|tufli\w*|odejda\w*|obuv\w*)\b/i
  },
  // 7. Ko'ngil ochar (Entertainment & Leisure)
  {
    category: "Ko'ngil ochar",
    type: 'expense',
    regex: /\b(kino\w*|teatr\w*|konsert\w*|o'yin\w*|oyin\w*|pubg\w*|park\w*|attraktsion\w*|bouling\w*|bilyard\w*|fitnes\w*|sportzal\w*|zal\w*|baseyn\w*|basseyn\w*|trenirovka\w*)\b/i
  },
  // 8. Maosh / Daromad (Income)
  {
    category: 'Maosh',
    type: 'income',
    regex: /\b(maosh\w*|mayosh\w*|oylik\w*|avans\w*|ish\s+haqi|zarplata\w*|stipendiya\w*|tushdi|keldi|berishdi|topdim|daromad\w*|gonorar\w*|ishlab\s+topdim|pul\s+topdim)\b/i
  },
  // 9. Qarz berdim (Lending)
  {
    category: "Do'st",
    type: 'lending',
    regex: /\b(qarz\s*(?:berdim|bervordim|berganman)|qarzga\s*(?:berdim|bervordim))\b/i
  },
  // 10. Qarz oldim (Debt)
  {
    category: "Do'st",
    type: 'debt',
    regex: /\b(qarz\s*(?:oldim|oluvdim|olgandim)|qarzga\s*(?:oldim|oluvdim))\b/i
  }
]

/**
 * Parses user input locally with high-precision Uzbek financial intelligence.
 * Works 100% offline with 0 network latency.
 */
export function parseLocalAIText(text: string, cardsList: any[] = []): ParsedTransaction | null {
  if (!text || typeof text !== 'string') return null
  const clean = text.trim()
  if (!clean) return null
  const lower = clean.toLowerCase().replace(/[`ʻ‘’]/g, "'")

  // 1. Extract Amount
  const amountNum = extractAmountFromText(lower)
  if (!amountNum || amountNum <= 0) {
    return null
  }

  // 2. Detect Type & Category
  let detectedType: EntryType = 'expense'
  let detectedCategory = 'Boshqa'

  // Income checks
  const incomeKeywords = /\b(maosh\w*|oylik\w*|avans\w*|zarplata\w*|stipendiya\w*|tushdi|daromad\w*|topdim|ishlab\s+topdim|pul\s+topdim|kirdi)\b/i
  const debtKeywords = /\b(qarz\s*(?:oldim|oluvdim)|qarzga\s*(?:oldim|oluvdim))\b/i
  const lendingKeywords = /\b(qarz\s*(?:berdim|bervordim)|qarzga\s*(?:berdim|bervordim))\b/i

  if (debtKeywords.test(lower)) {
    detectedType = 'debt'
    detectedCategory = "Do'st"
  } else if (lendingKeywords.test(lower)) {
    detectedType = 'lending'
    detectedCategory = "Do'st"
  } else if (incomeKeywords.test(lower)) {
    detectedType = 'income'
    detectedCategory = 'Maosh'
  } else {
    detectedType = 'expense'
    for (const rule of CATEGORY_RULES) {
      if (rule.regex.test(lower)) {
        detectedCategory = rule.category
        if (rule.type) detectedType = rule.type
        break
      }
    }
  }

  // If "to'lov" or "to'ladim" is present and category is still Boshqa, check words
  if (detectedCategory === 'Boshqa') {
    if (lower.includes('kurs') || lower.includes("o'qish") || lower.includes('kontrakt')) {
      detectedCategory = "Ta'lim"
    } else if (lower.includes('taksi') || lower.includes('yo\'l')) {
      detectedCategory = 'Transport'
    } else if (lower.includes('ovqat') || lower.includes('obed') || lower.includes('lunch')) {
      detectedCategory = 'Oziq-ovqat'
    }
  }

  // 3. Format Amount (e.g. 500000 -> "500 000")
  const formattedAmount = amountNum.toLocaleString('en-US').replace(/,/g, ' ')

  // 4. Card Matching
  let cardId = 'cash'
  if (Array.isArray(cardsList) && cardsList.length > 0) {
    for (const c of cardsList) {
      const bName = (c.name || c.bank || '').toLowerCase()
      const bBrand = (c.brand || '').toLowerCase()
      if ((bName && lower.includes(bName)) || (bBrand && lower.includes(bBrand))) {
        cardId = c.id
        break
      }
    }
  }

  // 5. Date Parsing
  let dateIso = (new Date(Date.now() - new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16)
  if (lower.includes('kecha')) {
    const yesterday = new Date(Date.now() - 86400000 - new Date().getTimezoneOffset() * 60000)
    dateIso = yesterday.toISOString().slice(0, 16)
  }

  // 6. Title formatting
  const title = clean.slice(0, 80)

  return {
    type: detectedType,
    amount: formattedAmount,
    category: detectedCategory,
    note: clean,
    title,
    debtWho: detectedType === 'debt' || detectedType === 'lending' ? clean.split(' ')[0] : '',
    date: dateIso,
    cardId,
    isLocalParsed: true
  }
}

/**
 * Backward compatibility export
 */
export function parseAITransaction(text: string, cardsList: any[] = []): ParsedTransaction {
  const local = parseLocalAIText(text, cardsList)
  if (local) return local

  return {
    type: 'expense',
    amount: '',
    category: 'Boshqa',
    note: text || '',
    title: text || '',
    date: (new Date(Date.now() - new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16),
    cardId: 'cash'
  }
}

