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
  return `You are Moliya AI's expert financial-language interpretation engine.
Understand natural human financial messages in Uzbek, Russian, English, or mixed colloquial language.
Extract the structured financial transaction data.

AUTHORITATIVE SERVER DATE & TIME:
- Current Date: ${ctx.currentDate} (${ctx.currentDayOfWeek})
- Current Time: ${ctx.currentTime}
- Timezone: ${ctx.timezone}

USER INPUT: "${normalizedText}"

STRICT INSTRUCTIONS:
1. Transaction TYPE:
   - 'expense' (spent money, bought items, paid fees/bills/taxi: "oldim", "sarfladim", "berdim", "to'ladim", "lunchga", "taxiga", "купил", "потратил", "заплатил")
   - 'income' (salary, earnings, received payment, profit, gift: "maosh", "oylik", "tushdi", "ishladim", "keldi", "зарплата", "получил", "пришло")
   - 'debt' (borrowed money: "qarz oldim", "взял в долг")
   - 'lending' (loaned money to someone: "qarz berdim", "дал в долг")

2. Transaction AMOUNT (integer in UZS):
   - Normalize multipliers and words:
     * "14 mln" / "14 million" / "14 млн" / "14m" -> 14000000
     * "2 yarim mln" / "2.5 mln" / "2,5 миллиона" -> 2500000
     * "500 ming" / "500k" / "500 тысяч" -> 500000
     * "30 ming" / "30k" -> 30000
     * "ellik ming" -> 50000
     * "bir yuz yigirma ming" -> 120000
   - If currency is not explicitly specified, assume Uzbek So'm (UZS).

3. Transaction DATE (YYYY-MM-DD):
   - Use the Authoritative Server Date (${ctx.currentDate}, ${ctx.currentDayOfWeek}) to calculate the exact calendar date:
     * "bugun" / "today" / "сегодня" -> ${ctx.currentDate}
     * "kecha" / "yesterday" / "вчера" -> calculate 1 day before ${ctx.currentDate}
     * "o'tgan kun" / "oldingi kun" / "позавчера" -> calculate 2 days before ${ctx.currentDate}
     * "X kun oldin" / "X дней назад" / "X days ago" -> calculate exactly X days before ${ctx.currentDate}
     * Days of week: "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba", "yakshanba", "o'tgan juma", "в прошлую пятницу" -> the closest matching past day of week.
     * Calendar dates: "25 avgust" / "25-avgust kuni" / "25.08" / "25 августа" -> ${ctx.currentDate.slice(0, 4)}-08-25
     * Month phrases: "oy boshida" -> first day of the current month
     * If NO date or relative phrase is mentioned, use ${ctx.currentDate}.
   - Never invent a random date; return the date strictly in "YYYY-MM-DD" format.

4. CATEGORY (Must be exactly one of these):
   - 'Oziq-ovqat' (food, groceries, restaurant, cafe, lunch, meat, bread: "non", "go'sht", "bozor", "korzinka", "makro", "havas", "osh", "obed", "kafe", "choyxona")
   - 'Transport' (taxi, bus, fuel, petrol, metro, fare: "taxi", "taksi", "yandex", "benzin", "metan", "yo'lkira")
   - 'Kiyim' (clothes, shoes, apparel: "kiyim", "poyafzal", "kurtka", "shim", "ko'ylak")
   - 'Kommunal' (utilities, rent, internet, mobile: "svet", "gaz", "suv", "arenda", "kvartira", "wifi", "internet", "beeline", "ucell")
   - 'Sog\\'liq' (medicine, pharmacy, clinic, doctor, dentist: "dori", "apteka", "doktor", "klinika", "stomatolog")
   - 'Ta\\'lim' (courses, books, tuition, university: "kurs", "kitob", "kontrakt", "maktab")
   - 'Ko\\'ngil ochar' (entertainment, movies, games, park: "kino", "konsert", "o'yin")
   - 'Maosh' (salary, wages, advance: "oylik", "maosh", "avans", "ish haqi")
   - 'Freelance' (freelance work, client gigs)
   - 'Biznes' (business profit or expense)
   - 'Sovg\\'a' (gifts, presents, donations)
   - 'Investitsiya' (investments, gold, shares)
   - 'Boshqa' (other/general)

5. Title, Note, and Debt:
   - 'title': concise 2-3 word title (e.g. "Taksi xarajati", "Bozorlik", "Oylik maosh")
   - 'note': clean description preserving user context.
   - 'debtWho': person name if debt or lending (otherwise empty string).

Return ONLY valid JSON matching this schema:
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
  debtWho?: string;
  error?: string;
} {
  const defaultDate = fallbackDate || getServerDateTimeContext().currentDate;

  if (!rawJson || typeof rawJson !== 'object') {
    return {
      isValid: false,
      type: 'expense',
      amount: 0,
      category: 'Boshqa',
      name: '',
      note: '',
      date: defaultDate,
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
        date: defaultDate,
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

  // Validate or assign date
  let date = defaultDate;
  if (typeof rawJson.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawJson.date)) {
    const parsedD = new Date(rawJson.date);
    if (!isNaN(parsedD.getTime())) {
      date = rawJson.date;
    }
  }

  return {
    isValid: true,
    type,
    amount,
    category,
    name,
    note,
    date,
    debtWho: typeof rawJson.debtWho === 'string' ? rawJson.debtWho : ''
  };
}
