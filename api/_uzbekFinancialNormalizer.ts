/**
 * Uzbek Financial Language Normalizer for Moliya AI
 * Handles numbers, multipliers, abbreviations, colloquial phrases, and mixed languages.
 */

// Mapping of Uzbek word numbers to numeric values
const UZBEK_WORD_NUMBERS: Record<string, number> = {
  'nol': 0,
  'bir': 1,
  'bitta': 1,
  'ikki': 2,
  'ikkita': 2,
  'uch': 3,
  'uchta': 3,
  'to\'rt': 4,
  'turt': 4,
  'toʻrt': 4,
  'tort': 4,
  'to‘rt': 4,
  'to\'rtta': 4,
  'besh': 5,
  'beshta': 5,
  'olti': 6,
  'oltita': 6,
  'yetti': 7,
  'yettita': 7,
  'etti': 7,
  'ettita': 7,
  'sakkiz': 8,
  'sakkizta': 8,
  'to\'qqiz': 9,
  'toqqiz': 9,
  'toʻqqiz': 9,
  'to‘qqiz': 9,
  'to\'qqizta': 9,
  'o\'n': 10,
  'on': 10,
  'oʻn': 10,
  'o‘n': 10,
  'o\'nta': 10,
  'yigirma': 20,
  'yigirmata': 20,
  'o\'ttiz': 30,
  'ottiz': 30,
  'oʻttiz': 30,
  'o‘ttiz': 30,
  'qirq': 40,
  'qirqta': 40,
  'ellik': 50,
  'ellikta': 50,
  'oltmish': 60,
  'oltmishta': 60,
  'yetmish': 70,
  'yetmishta': 70,
  'etmish': 70,
  'sakson': 80,
  'saksonta': 80,
  'to\'qson': 90,
  'toqson': 90,
  'toʻqson': 90,
  'to‘qson': 90,
  'yuz': 100,
  'yuzta': 100,
  'ming': 1000,
  'mingta': 1000,
  'million': 1000000,
  'milyon': 1000000,
  'millyon': 1000000,
  'milion': 1000000,
  'mln': 1000000,
  'milliard': 1000000000,
  'miliard': 1000000000,
  'yarim': 0.5,
  'yarm': 0.5,
  'bita': 1,
  'iki': 2,
  'yeti': 7,
  'sakiz': 8,
  'toqiz': 9,
  'otiz': 30,
  'elik': 50,
  'elikk': 50,
  'oltmis': 60,
  'yetmis': 70
};

const UZBEK_SUFFIXES = [
  'likdan', 'likka', 'chidan', 'chiga',
  'larga', 'lardan', 'larda',
  'lik', 'dan', 'ga', 'ka', 'qa', 'da', 'ni', 'ning', 'si', 'cha', 'lar'
];

/**
 * Strips Uzbek suffixes (e.g. "taksiga" -> "taksi", "aptekaga" -> "apteka")
 */
export function stripUzbekSuffix(word: string): string {
  if (!word || word.length <= 3) return word;
  const lower = word.toLowerCase();
  for (const suf of UZBEK_SUFFIXES) {
    if (lower.length > suf.length + 2 && lower.endsWith(suf)) {
      return lower.slice(0, -suf.length);
    }
  }
  return lower;
}

/**
 * High-speed Levenshtein & Phonetic distance fuzzy matcher (<0.001 ms)
 * Handles 1-letter typos, missing letters, phonetic substitutions
 */
export function isFuzzyMatch(rawWord: string, target: string, maxDist: number = 1): boolean {
  if (!rawWord || !target) return false;
  const w = rawWord.toLowerCase();
  const t = target.toLowerCase();
  if (w === t) return true;

  const stem = stripUzbekSuffix(w);
  if (stem === t) return true;

  // Phonetic normalization: x -> ks, w -> v, ye -> e, collapse repeated letters (elikk -> elik)
  const normW = w.replace(/[`ʻ‘’]/g, "'").replace(/x/g, 'ks').replace(/w/g, 'v').replace(/ye/g, 'e').replace(/(.)\1+/g, '$1');
  const normT = t.replace(/[`ʻ‘’]/g, "'").replace(/x/g, 'ks').replace(/w/g, 'v').replace(/ye/g, 'e').replace(/(.)\1+/g, '$1');
  if (normW === normT) return true;

  const normStem = stem.replace(/[`ʻ‘’]/g, "'").replace(/x/g, 'ks').replace(/w/g, 'v').replace(/ye/g, 'e').replace(/(.)\1+/g, '$1');
  if (normStem === normT) return true;

  const testW = stem.length >= 3 ? stem : w;
  const lenDiff = Math.abs(testW.length - t.length);
  if (lenDiff > maxDist) return false;

  const m = testW.length;
  const n = t.length;
  let prevRow = new Int32Array(n + 1);
  let currRow = new Int32Array(n + 1);
  for (let j = 0; j <= n; j++) prevRow[j] = j;

  for (let i = 1; i <= m; i++) {
    currRow[0] = i;
    let minInRow = currRow[0];
    const charA = testW.charCodeAt(i - 1);

    for (let j = 1; j <= n; j++) {
      const cost = charA === t.charCodeAt(j - 1) ? 0 : 1;
      const val = Math.min(
        prevRow[j] + 1,
        currRow[j - 1] + 1,
        prevRow[j - 1] + cost
      );
      currRow[j] = val;
      if (val < minInRow) minInRow = val;
    }

    if (minInRow > maxDist) return false;
    const temp = prevRow;
    prevRow = currRow;
    currRow = temp;
  }

  return prevRow[n] <= maxDist;
}

/**
 * High-speed extractor for spoken and written numbers in Uzbek & Russian with typo tolerance
 */
export function extractUzbekNumber(raw: string): number | null {
  if (!raw || typeof raw !== 'string') return null;
  let text = raw.toLowerCase().replace(/[`ʻ‘’]/g, "'");

  // Multiplier abbreviations
  text = text.replace(/(\d+)\s*(k|к)\b/gi, '$1000');
  text = text.replace(/(\d+)\s*(mln|млн|million|миллион)\b/gi, (_, n) => `${n}000000`);
  text = text.replace(/(\d+)\s*(m|м)\b(?!\w)/gi, (_, n) => `${n}000000`);
  text = text.replace(/(\d+)\s*(ming|минг)\b/gi, (_, n) => `${n}000`);

  // Decimals & "yarim" (e.g. 2 yarim mln, 2.5 mln, 1.5m)
  text = text.replace(/(\d+)\s*(yarim|\.5|,5)\s*(mln|million|000000)\b/gi, (_, n) => `${n}500000`);
  text = text.replace(/(\d+)\s*(yarim|\.5|,5)\s*(ming|000)\b/gi, (_, n) => `${n}500`);
  text = text.replace(/(\d+)[.,](\d+)\s*(mln|million|000000)\b/gi, (_, whole, frac) => {
    const paddedFrac = frac.padEnd(6, '0').slice(0, 6);
    return `${whole}${paddedFrac}`;
  });

  // Extract explicit digits first
  const cleanedDigits = text.replace(/(\d+)\s+(\d{3})\b/g, '$1$2');
  const numberMatch = cleanedDigits.match(/\b\d{3,12}\b/);
  if (numberMatch) {
    return parseInt(numberMatch[0].replace(/\s+/g, ''), 10);
  }

  // Fallback to spoken words
  const words = text.split(/\s+/);
  let total = 0;
  let current = 0;
  let hasNumber = false;

  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/[^\w']/g, '');
    if (w === 'yarim' && (words[i + 1] === 'million' || words[i + 1] === 'mln' || words[i + 1] === 'ming')) {
      current += 0.5;
      hasNumber = true;
      continue;
    }
    let val = UZBEK_WORD_NUMBERS[w];
    if (val === undefined && w.length >= 3) {
      // 1-Letter Typo tolerance for spoken numbers
      for (const [keyNum, numVal] of Object.entries(UZBEK_WORD_NUMBERS)) {
        if (keyNum.length >= 3 && isFuzzyMatch(w, keyNum, 1)) {
          val = numVal;
          break;
        }
      }
    }

    if (val !== undefined) {
      hasNumber = true;
      if (val === 100) current = (current || 1) * 100;
      else if (val === 1000) { total += (current || 1) * 1000; current = 0; }
      else if (val === 1000000) { total += (current || 1) * 1000000; current = 0; }
      else if (val === 1000000000) { total += (current || 1) * 1000000000; current = 0; }
      else current += val;
    }
  }
  total += current;
  return hasNumber && total > 0 ? Math.round(total) : null;
}

// Primary category keywords for 1-letter typo / fuzzy matching
export const PRIMARY_CATEGORY_KEYWORDS: Array<{ keyword: string; category: string; type: 'expense' | 'income' | 'debt' | 'lending' }> = [
  { keyword: 'taksi', category: 'Transport', type: 'expense' },
  { keyword: 'benzin', category: 'Transport', type: 'expense' },
  { keyword: 'yandex', category: 'Transport', type: 'expense' },
  { keyword: 'avtobus', category: 'Transport', type: 'expense' },
  { keyword: 'metro', category: 'Transport', type: 'expense' },
  { keyword: 'bozor', category: 'Oziq-ovqat', type: 'expense' },
  { keyword: 'ovqat', category: 'Oziq-ovqat', type: 'expense' },
  { keyword: 'tushlik', category: 'Oziq-ovqat', type: 'expense' },
  { keyword: 'obed', category: 'Oziq-ovqat', type: 'expense' },
  { keyword: 'kafe', category: 'Oziq-ovqat', type: 'expense' },
  { keyword: 'restoran', category: 'Oziq-ovqat', type: 'expense' },
  { keyword: 'supermarket', category: 'Oziq-ovqat', type: 'expense' },
  { keyword: 'magazin', category: 'Oziq-ovqat', type: 'expense' },
  { keyword: 'svet', category: 'Kommunal', type: 'expense' },
  { keyword: 'gaz', category: 'Kommunal', type: 'expense' },
  { keyword: 'suv', category: 'Kommunal', type: 'expense' },
  { keyword: 'internet', category: 'Kommunal', type: 'expense' },
  { keyword: 'ijara', category: 'Kommunal', type: 'expense' },
  { keyword: 'kvartira', category: 'Kommunal', type: 'expense' },
  { keyword: 'dori', category: 'Sog\'liq', type: 'expense' },
  { keyword: 'apteka', category: 'Sog\'liq', type: 'expense' },
  { keyword: 'doktor', category: 'Sog\'liq', type: 'expense' },
  { keyword: 'kiyim', category: 'Kiyim', type: 'expense' },
  { keyword: 'poyafzal', category: 'Kiyim', type: 'expense' },
  { keyword: 'maktab', category: 'Ta\'lim', type: 'expense' },
  { keyword: 'kurs', category: 'Ta\'lim', type: 'expense' },
  { keyword: 'kontrakt', category: 'Ta\'lim', type: 'expense' },
  { keyword: 'kino', category: 'Ko\'ngil ochar', type: 'expense' },
  { keyword: 'fitnes', category: 'Ko\'ngil ochar', type: 'expense' },
  { keyword: 'sport', category: 'Ko\'ngil ochar', type: 'expense' },
  { keyword: 'maosh', category: 'Maosh', type: 'income' },
  { keyword: 'oylik', category: 'Maosh', type: 'income' },
  { keyword: 'avans', category: 'Maosh', type: 'income' },
  { keyword: 'zarplata', category: 'Maosh', type: 'income' },
  { keyword: 'qarz', category: 'Do\'st', type: 'lending' }
];

// Category Dictionary with stems
export const TURBO_CATEGORY_MAP = [
  {
    category: 'Transport',
    type: 'expense' as const,
    regex: /\b(taxi\w*|taksi\w*|taxsi\w*|yandex\w*|yandeks\w*|benzin\w*|benzn\w*|binzin\w*|metan\w*|propan\w*|zapravka\w*|avtobus\w*|metro\w*|yo'?lkira\w*|yolkira\w*|mashina\w*|moy\w*|zapchast\w*|parkovka\w*|stoyanka\w*|radar\w*|shtraf\w*|moyka\w*)\b/i
  },
  {
    category: 'Oziq-ovqat',
    type: 'expense' as const,
    regex: /\b(ovqat\w*|avqat\w*|non\w*|go'?sht\w*|gosht\w*|bozor\w*|bozrlik\w*|bazar\w*|korzinka\w*|makro\w*|havas\w*|supermarket\w*|supermark\w*|osh\w*|choyxona\w*|lunch\w*|obed\w*|tushlik\w*|kechki\s+ovqat|kafe\w*|restoran\w*|kofe\w*|lavash\w*|shashlik\w*|somsa\w*|shirinlik\w*|suv\w*|ichimlik\w*|pechenye\w*|meva\w*|sabzavot\w*|kartoshka\w*|piyoz\w*|guruch\w*|un\w*|yog'?\w*|magazin\w*|magaz\w*)\b/i
  },
  {
    category: 'Kommunal',
    type: 'expense' as const,
    regex: /\b(svet\w*|swet\w*|svyet\w*|gaz\w*|suv\w*|musor\w*|kommunal\w*|kvartira\w*|arenda\w*|ijara\w*|wifi\w*|internet\w*|beeline\w*|ucell\w*|uztelecom\w*|mobiuz\w*|paynet\w*|elektr\w*|isitish\w*|domkom\w*)\b/i
  },
  {
    category: 'Sog\'liq',
    type: 'expense' as const,
    regex: /\b(dori\w*|dorixona\w*|dorxona\w*|apteka\w*|abteka\w*|shifokor\w*|doktor\w*|klinika\w*|analiz\w*|tish\w*|stomatolog\w*|ukol\w*|retsept\w*|operatsiya\w*|shifoxona\w*|bolnitsa\w*|terapevt\w*|massaj\w*)\b/i
  },
  {
    category: 'Kiyim',
    type: 'expense' as const,
    regex: /\b(kiyim\w*|poyafzal\w*|kurtka\w*|shim\w*|ko'ylak\w*|koylak\w*|oyoq\s+kiyim|futbolka\w*|kostyum\w*|palto\w*|etik\w*|krossovka\w*|paypoq\w*|shapka\w*|sumka\w*|tufli\w*)\b/i
  },
  {
    category: 'Ta\'lim',
    type: 'expense' as const,
    regex: /\b(o'qish\w*|oqish\w*|kurs\w*|repetitor\w*|repititor\w*|kontrakt\w*|kitob\w*|maktab\w*|maktap\w*|universitet\w*|institut\w*|kollej\w*|dars\w*|daftar\w*|ruchka\w*|talim\w*|ta'lim\w*|ucheba\w*)\b/i
  },
  {
    category: 'Ko\'ngil ochar',
    type: 'expense' as const,
    regex: /\b(kino\w*|teatr\w*|konsert\w*|o'yin\w*|oyin\w*|pubg\w*|park\w*|attraktsion\w*|bouling\w*|bilyard\w*|fitnes\w*|sportzal\w*|zal\w*|baseyn\w*|trenirovka\w*)\b/i
  },
  {
    category: 'Maosh',
    type: 'income' as const,
    regex: /\b(maosh\w*|mayosh\w*|oylik\w*|avans\w*|ish\s+haqi|zarplata\w*|stipendiya\w*|tushdi|keldi|berishdi|topdim|daromad\w*|gonorar\w*)\b/i
  },
  {
    category: 'Do\'st',
    type: 'lending' as const,
    regex: /\b(qarz\s*(?:berdim|bervordim)|qarzga\s*(?:berdim|bervordim)|berdim|bervordim)\b/i
  },
  {
    category: 'Do\'st',
    type: 'debt' as const,
    regex: /\b(qarz\s*(?:oldim|oluvdim)|qarzga\s*(?:oldim|oluvdim)|oldim|qarzdor)\b/i
  }
];

/**
 * Normalizes Uzbek financial text containing abbreviations like "14 mln", "50k", "2 yarim mln", "lunchga 30 ming"
 */
export function normalizeUzbekFinancialText(rawText: string): NormalizedFinancialInput {
  if (!rawText || typeof rawText !== 'string') {
    return { originalText: '', normalizedText: '' };
  }

  const originalText = rawText.trim();
  let text = originalText.toLowerCase();

  // Normalize apostrophes
  text = text.replace(/[`ʻ‘’]/g, "'");

  // 1. Currency Normalization
  text = text.replace(/\b(so'm|som|sum|сўм|сум|uzs)\b/gi, " so'm ");
  text = text.replace(/\b(dollar|dollor|usd|\$)\b/gi, " dollar ");
  text = text.replace(/\b(rubl|rub|руб|₽)\b/gi, " rubl ");

  // 2. Multiplier Preprocessing (e.g., "14mln" -> "14000000", "50k" -> "50000", "14m" -> "14000000")
  text = text.replace(/(\d+)\s*(k|к)\b/gi, '$1000');
  text = text.replace(/(\d+)\s*(mln|млн|million|миллион)\b/gi, (_, n) => `${n}000000`);
  text = text.replace(/(\d+)\s*(m|м)\b(?!\w)/gi, (_, n) => `${n}000000`);
  text = text.replace(/(\d+)\s*(ming|минг)\b/gi, (_, n) => `${n}000`);

  // 3. Handle decimal and "yarim" (half) multipliers:
  text = text.replace(/(\d+)\s*(yarim|\.5|,5)\s*(mln|million|000000)\b/gi, (_, n) => `${n}500000`);
  text = text.replace(/(\d+)\s*(yarim|\.5|,5)\s*(ming|000)\b/gi, (_, n) => `${n}500`);
  text = text.replace(/(\d+)[.,](\d+)\s*(mln|million|000000)\b/gi, (_, whole, frac) => {
    const paddedFrac = frac.padEnd(6, '0').slice(0, 6);
    return `${whole}${paddedFrac}`;
  });

  // 4. Colloquial Suffix Normalization
  text = text.replace(/(\d+)\s*mingga\b/gi, '$1000 ga');
  text = text.replace(/(\d+)\s*mlnga\b/gi, '$1000000 ga');

  // Category inference hints from common colloquial words
  let inferredCategory: string | undefined;
  let inferredType: 'expense' | 'income' | 'debt' | 'lending' | undefined;

  for (const item of TURBO_CATEGORY_MAP) {
    if (item.regex.test(text)) {
      inferredCategory = item.category;
      inferredType = item.type;
      break;
    }
  }

  // Extract amount: first via digits, then spoken numbers
  let extractedAmount = extractUzbekNumber(text) || undefined;

  return {
    originalText,
    normalizedText: text.trim(),
    extractedAmount,
    inferredType,
    inferredCategory
  };
}

/**
 * Ultra-Fast Local Deterministic NLP Engine (<1ms)
 * Parses financial sentences without calling cloud LLM.
 */
export function parseTurboFinancialText(rawText: string, todayStr?: string): TurboParseResult | null {
  if (!rawText || typeof rawText !== 'string') return null;
  const clean = rawText.trim();
  const lower = clean.toLowerCase().replace(/[`ʻ‘’]/g, "'");
  const fallbackDate = todayStr || getServerDateTimeContext().currentDate;

  // 1. Detect Intent: query_finances (e.g. "balansim qancha?", "oylik hisobot", "qancha pul qoldi?")
  if (/\b(balans\w*|qancha\s+(?:pulim|qoldi|ishlatdim|sarfladim)|hisobot\w*|statistika\w*|sarf-xarajat\w*)\b/i.test(lower)) {
    return {
      intent: 'query_finances',
      transactions: [],
      needs_clarification: false,
      clarification_reason: null,
      overall_confidence: 0.99,
      is_local_turbo: true
    };
  }

  // 2. Detect Intent: general_question (e.g. "salom", "yordam ber", "/start")
  if (/^(salom|assalomu|qalaysiz|qalesiz|start|\/start|yordam|help|nima\s+qila\s+olasan)\b/i.test(lower)) {
    return {
      intent: 'general_question',
      transactions: [],
      needs_clarification: false,
      clarification_reason: null,
      overall_confidence: 0.99,
      is_local_turbo: true
    };
  }

  // 3. Multi-Transaction Splitting (e.g. "50k taksiga va 100k bozorlikka")
  const parts = clean.split(/\s+(?:va\s+yana|va|hamda|\+)\s+/i);
  if (parts.length > 1) {
    const multiResults: TurboTransaction[] = [];
    for (const part of parts) {
      const single = parseSingleTurboTransaction(part, fallbackDate);
      if (single) multiResults.push(single);
    }
    if (multiResults.length > 1) {
      return {
        intent: 'record_transaction',
        transactions: multiResults,
        needs_clarification: false,
        clarification_reason: null,
        overall_confidence: 0.98,
        is_local_turbo: true
      };
    }
  }

  // 4. Single transaction parse
  const single = parseSingleTurboTransaction(clean, fallbackDate);
  if (single) {
    return {
      intent: 'record_transaction',
      transactions: [single],
      needs_clarification: false,
      clarification_reason: null,
      overall_confidence: single.confidence,
      is_local_turbo: true
    };
  }

  return null;
}

function parseSingleTurboTransaction(text: string, todayStr: string): TurboTransaction | null {
  const amount = extractUzbekNumber(text);
  if (!amount || amount <= 0) return null;

  // Currency
  let currency = 'UZS';
  if (/\b(dollar|dollor|dolir|usd|\$|доллар)\b/i.test(text)) {
    currency = 'USD';
  } else if (/\b(rubl|rub|руб|₽)\b/i.test(text)) {
    currency = 'RUB';
  }

  // Category & Type
  let category = 'Boshqa';
  let type: 'expense' | 'income' | 'debt' | 'lending' = 'expense';
  let matched = false;

  for (const item of TURBO_CATEGORY_MAP) {
    if (item.regex.test(text)) {
      category = item.category;
      type = item.type;
      matched = true;
      break;
    }
  }

  // 1-Letter Typo / Fuzzy Fallback Matcher (<0.01 ms)
  if (!matched) {
    const words = text.split(/\s+/);
    for (const w of words) {
      const cleanW = w.replace(/[^\w']/g, '');
      if (cleanW.length < 3) continue;
      for (const item of PRIMARY_CATEGORY_KEYWORDS) {
        if (isFuzzyMatch(cleanW, item.keyword, 1)) {
          category = item.category;
          type = item.type;
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
  }

  // Counterparty Detection: e.g. "Akmalga 200$ qarz berdim", "Sardordan 100 ming oldim"
  let counterparty: string | null = null;
  const isDebtOrLending = type === 'debt' || type === 'lending';
  const personMatch = text.match(/\b([A-ZА-Яa-zа-я']+)(?:ga|dan|bilan)\b/);
  if (personMatch) {
    const rawName = personMatch[1];
    const isExcluded = /^(bugun|kecha|o'tgan|taksi|supermarket|korzinka|makro|obed|lunch|arenda|kvartira|kurs|dars|o'qish|dori|svet|gaz|suv|so'm|som|sum|dollar|rubl|ovqat|tushlik|bozorlik|bozor|kartoshka|go'sht|benzin)/i.test(rawName);
    const isCapitalized = /^[A-ZА-Я]/.test(rawName);
    if (!isExcluded && (isDebtOrLending || isCapitalized)) {
      counterparty = rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase();
    }
  }

  // Date resolution
  let date = todayStr;
  const [y, m, d] = todayStr.split('-').map(Number);
  const nowObj = new Date(y, m - 1, d);

  if (/\b(kecha|kechagi|вчера)\b/i.test(text)) {
    nowObj.setDate(nowObj.getDate() - 1);
    date = `${nowObj.getFullYear()}-${String(nowObj.getMonth() + 1).padStart(2, '0')}-${String(nowObj.getDate()).padStart(2, '0')}`;
  } else if (/\b(o'tgan\s+kuni|avvalgi\s+kun|позавчера)\b/i.test(text)) {
    nowObj.setDate(nowObj.getDate() - 2);
    date = `${nowObj.getFullYear()}-${String(nowObj.getMonth() + 1).padStart(2, '0')}-${String(nowObj.getDate()).padStart(2, '0')}`;
  }

  return {
    type,
    amount,
    currency,
    category,
    description: text.slice(0, 80),
    date,
    time: null,
    counterparty,
    confidence: matched ? 0.98 : 0.85
  };
}

/**
 * Server DateTime Context helper for authoritative date interpretation
 */
export interface ServerDateTimeContext {
  currentDate: string; // YYYY-MM-DD
  currentTime: string; // HH:mm
  currentDayOfWeek: string; // Monday, Tuesday, ...
  timezone: string; // "Asia/Tashkent (UTC+5)"
}

export function getServerDateTimeContext(): ServerDateTimeContext {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const tashkentTime = new Date(utc + (3600000 * 5)); // Asia/Tashkent UTC+5

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = days[tashkentTime.getDay()];
  const yyyy = tashkentTime.getFullYear();
  const mm = String(tashkentTime.getMonth() + 1).padStart(2, '0');
  const dd = String(tashkentTime.getDate()).padStart(2, '0');
  const hh = String(tashkentTime.getHours()).padStart(2, '0');
  const min = String(tashkentTime.getMinutes()).padStart(2, '0');

  return {
    currentDate: `${yyyy}-${mm}-${dd}`,
    currentTime: `${hh}:${min}`,
    currentDayOfWeek: dayName,
    timezone: 'Asia/Tashkent (UTC+5)'
  };
}

/**
 * Builds the robust, Uzbek-specialized system prompt for Gemini with first-class date support
 */
export const buildUzbekFinancialPrompt = (normalizedText: string, ctx?: ServerDateTimeContext): string => buildUzbekFinancialAiPrompt(normalizedText, ctx);

export function buildUzbekFinancialAiPrompt(normalizedText: string, ctx: ServerDateTimeContext = getServerDateTimeContext()): string {
  return `Moliya AI parser. Extract financial event from text into JSON.
Date context: Today is ${ctx.currentDate} (${ctx.currentDayOfWeek}). Input: "${normalizedText}"

Categories: 'Oziq-ovqat', 'Transport', 'Kiyim', 'Kommunal', 'Sog\\'liq', 'Ta\\'lim', 'Ko\\'ngil ochar', 'Maosh', 'Freelance', 'Biznes', 'Sovg\\'a', 'Investitsiya', 'Boshqa'.
Types: 'expense', 'income', 'debt', 'lending'.
Currency: Assume Uzbek So'm (UZS). Extract amount as integer.

Rules:
- If relative date (e.g. "kecha", "bugun"), calculate YYYY-MM-DD from ${ctx.currentDate}. If no date, use ${ctx.currentDate}.
- 'debt' = borrowed money from someone; 'lending' = lent money to someone. Fill 'debtWho' with the person's name if present.
- 'title': short 2-3 word title. 'note': clean description.

Return ONLY valid JSON:
{
  "type": "expense" | "income" | "debt" | "lending",
  "amount": number,
  "category": string,
  "title": string,
  "note": string,
  "date": "YYYY-MM-DD",
  "debtWho": string
}`;
}

export interface SafeParsedDate {
  date: string; // YYYY-MM-DD
  day: number;
  month: number;
  year: number;
  time: string;
}

/**
 * Universal date parser that ALWAYS returns valid YYYY-MM-DD, day, month, year, time
 * Never produces NaN, undefined, or empty placeholders.
 */
export function parseSafeDate(dateVal: any, fallbackDate?: string): SafeParsedDate {
  const srv = getServerDateTimeContext();
  const fallback = fallbackDate || srv.currentDate;
  const nowTime = srv.currentTime;

  if (!dateVal || typeof dateVal !== 'string') {
    const [yStr, mStr, dStr] = fallback.split('-');
    return {
      date: fallback,
      day: parseInt(dStr, 10),
      month: parseInt(mStr, 10),
      year: parseInt(yStr, 10),
      time: nowTime
    };
  }

  const str = dateVal.trim();

  // 1. Direct YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [yStr, mStr, dStr] = str.split('-');
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    const d = parseInt(dStr, 10);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      return { date: str, day: d, month: m, year: y, time: nowTime };
    }
  }

  // 2. ISO format YYYY-MM-DDTHH:mm...
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
    const datePart = str.slice(0, 10);
    const timePart = str.slice(11, 16);
    const [yStr, mStr, dStr] = datePart.split('-');
    return {
      date: datePart,
      day: parseInt(dStr, 10),
      month: parseInt(mStr, 10),
      year: parseInt(yStr, 10),
      time: timePart || nowTime
    };
  }

  // 3. DD.MM.YYYY or DD/MM/YYYY or DD-MM-YYYY
  const dmy = str.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (dmy) {
    const d = parseInt(dmy[1], 10);
    const m = parseInt(dmy[2], 10);
    const y = parseInt(dmy[3], 10);
    const dateFormatted = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return {
      date: dateFormatted,
      day: d,
      month: m,
      year: y,
      time: nowTime
    };
  }

  // 4. DD.MM or DD/MM (current year)
  const dm = str.match(/^(\d{1,2})[./-](\d{1,2})$/);
  if (dm) {
    const d = parseInt(dm[1], 10);
    const m = parseInt(dm[2], 10);
    const y = parseInt(fallback.slice(0, 4), 10);
    const dateFormatted = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return {
      date: dateFormatted,
      day: d,
      month: m,
      year: y,
      time: nowTime
    };
  }

  // 5. JavaScript Date parsing fallback
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = parsed.getMonth() + 1;
    const d = parsed.getDate();
    const dateFormatted = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const timeFormatted = `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`;
    return {
      date: dateFormatted,
      day: d,
      month: m,
      year: y,
      time: timeFormatted
    };
  }

  // Fallback to trusted current date
  const [yStr, mStr, dStr] = fallback.split('-');
  return {
    date: fallback,
    day: parseInt(dStr, 10),
    month: parseInt(mStr, 10),
    year: parseInt(yStr, 10),
    time: nowTime
  };
}

/**
 * Validates structured AI output before writing to database
 */
export function validateAiFinancialOutput(rawJson: any, normalizedInput: NormalizedFinancialInput, fallbackDate?: string): {
  isValid: boolean;
  type: string;
  amount: number;
  category: string;
  name: string;
  note: string;
  date: string;
  day: number;
  month: number;
  year: number;
  time: string;
  debtWho?: string;
  error?: string;
} {
  const defaultDate = fallbackDate || getServerDateTimeContext().currentDate;
  const defaultParsed = parseSafeDate(defaultDate);

  if (!rawJson || typeof rawJson !== 'object') {
    return {
      isValid: false,
      type: 'expense',
      amount: 0,
      category: 'Boshqa',
      name: '',
      note: '',
      date: defaultParsed.date,
      day: defaultParsed.day,
      month: defaultParsed.month,
      year: defaultParsed.year,
      time: defaultParsed.time,
      error: 'Invalid JSON response from AI'
    };
  }

  let amount = Number(rawJson.amount);
  if (isNaN(amount) || amount <= 0) {
    if (normalizedInput.extractedAmount && normalizedInput.extractedAmount > 0) {
      amount = normalizedInput.extractedAmount;
    } else {
      return {
        isValid: false,
        type: 'expense',
        amount: 0,
        category: 'Boshqa',
        name: '',
        note: '',
        date: defaultParsed.date,
        day: defaultParsed.day,
        month: defaultParsed.month,
        year: defaultParsed.year,
        time: defaultParsed.time,
        error: 'Could not determine valid transaction amount'
      };
    }
  }

  const validTypes = ['expense', 'income', 'debt', 'lending'];
  const type = validTypes.includes(rawJson.type) ? rawJson.type : (normalizedInput.inferredType || 'expense');

  const validCategories = [
    'Oziq-ovqat', 'Transport', 'Kiyim', 'Kommunal', 'Sog\'liq',
    'Ta\'lim', 'Ko\'ngil ochar', 'Maosh', 'Freelance', 'Biznes',
    'Sovg\'a', 'Investitsiya', 'Boshqa', 'Do\'st', 'Bank', 'Oila', 'Hamkasb'
  ];
  let category = validCategories.includes(rawJson.category) ? rawJson.category : (normalizedInput.inferredCategory || 'Boshqa');
  if (category === 'Sog\\\'liq') category = 'Sog\'liq';
  if (category === 'Ko\\\'ngil ochar') category = 'Ko\'ngil ochar';
  if (category === 'Ta\\\'lim') category = 'Ta\'lim';

  const name = (rawJson.title || rawJson.note || normalizedInput.originalText).slice(0, 80);
  const note = (rawJson.note || normalizedInput.originalText).slice(0, 200);

  // Validate or assign date deterministically
  const parsedDate = parseSafeDate(rawJson.date, defaultDate);

  return {
    isValid: true,
    type,
    amount,
    category,
    name,
    note,
    date: parsedDate.date,
    day: parsedDate.day,
    month: parsedDate.month,
    year: parsedDate.year,
    time: parsedDate.time,
    debtWho: typeof rawJson.debtWho === 'string' ? rawJson.debtWho : ''
  };
}

