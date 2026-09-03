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
  'mln': 1000000,
  'milliard': 1000000000,
  'yarim': 0.5
};

export interface NormalizedFinancialInput {
  originalText: string;
  normalizedText: string;
  extractedAmount?: number;
  inferredType?: 'expense' | 'income' | 'debt' | 'lending';
  inferredCategory?: string;
}

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
  // e.g. "2 yarim mln" -> "2500000", "2.5 mln" / "2,5 mln" -> "2500000", "1 yarim ming" -> "1500"
  text = text.replace(/(\d+)\s*(yarim|\.5|,5)\s*(mln|million|000000)\b/gi, (_, n) => `${n}500000`);
  text = text.replace(/(\d+)\s*(yarim|\.5|,5)\s*(ming|000)\b/gi, (_, n) => `${n}500`);
  text = text.replace(/(\d+)[.,](\d+)\s*(mln|million|000000)\b/gi, (_, whole, frac) => {
    const paddedFrac = frac.padEnd(6, '0').slice(0, 6);
    return `${whole}${paddedFrac}`;
  });

  // 4. Colloquial Suffix Normalization (e.g., "30 mingga" -> "30000 ga", "lunchga" -> "tushlikka")
  text = text.replace(/(\d+)\s*mingga\b/gi, '$1000 ga');
  text = text.replace(/(\d+)\s*mlnga\b/gi, '$1000000 ga');

  // Category inference hints from common colloquial words
  let inferredCategory: string | undefined;
  let inferredType: 'expense' | 'income' | 'debt' | 'lending' | undefined;

  if (/\b(maosh|oylik|zarplata|avans|ish haqi|daromad|stipendiya|tushdi|keldi|berishdi)\b/i.test(text)) {
    inferredType = 'income';
    inferredCategory = 'Maosh';
  } else if (/\b(taxi\w*|taksi\w*|yandex\w*|benzin\w*|metan\w*|propan\w*|zapravka\w*|avtobus\w*|metro\w*|yo'?lkira\w*)/i.test(text)) {
    inferredCategory = 'Transport';
    inferredType = 'expense';
  } else if (/\b(ovqat\w*|non\w*|go'?sht\w*|bozor\w*|korzinka\w*|makro\w*|havas\w*|supermarket\w*|osh\w*|choyxona\w*|lunch\w*|obed\w*|kechki ovqat|kafe\w*|restoran\w*|kofe\w*|lavash\w*|shashlik\w*)/i.test(text)) {
    inferredCategory = 'Oziq-ovqat';
    inferredType = 'expense';
  } else if (/\b(svet\w*|gaz\w*|suv\w*|musor\w*|kommunal\w*|kvartira\w*|arenda\w*|wifi\w*|internet\w*|beeline\w*|ucell\w*|uztelecom\w*|mobiuz\w*)/i.test(text)) {
    inferredCategory = 'Kommunal';
    inferredType = 'expense';
  } else if (/\b(dori\w*|dorixona\w*|apteka\w*|shifokor\w*|doktor\w*|klinika\w*|analiz\w*|tish\w*|stomatolog\w*)/i.test(text)) {
    inferredCategory = 'Sog\'liq';
    inferredType = 'expense';
  } else if (/\b(kiyim\w*|poyafzal\w*|kurtka\w*|shim\w*|ko'ylak\w*|oyoq kiyim|futbolka\w*)/i.test(text)) {
    inferredCategory = 'Kiyim';
    inferredType = 'expense';
  } else if (/\b(qarz berdim|qarzga berdim|berdim)\b/i.test(text)) {
    inferredType = 'lending';
    inferredCategory = 'Do\'st';
  } else if (/\b(qarz oldim|qarzga oldim)\b/i.test(text)) {
    inferredType = 'debt';
    inferredCategory = 'Do\'st';
  }

  // Extract explicit standalone numbers (e.g. 14000000, 50000, 30000)
  const cleanedDigits = text.replace(/(\d+)\s+(\d{3})\b/g, '$1$2');
  const numberMatch = cleanedDigits.match(/\b\d{4,12}\b/) || text.match(/\b\d{3,12}\b/);
  const extractedAmount = numberMatch ? parseInt(numberMatch[0].replace(/\s+/g, ''), 10) : undefined;

  return {
    originalText,
    normalizedText: text.trim(),
    extractedAmount,
    inferredType,
    inferredCategory
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

