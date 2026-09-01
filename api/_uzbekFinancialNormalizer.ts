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
  } else if (/\b(taxi|taksi|yandex|benzin|metan|propan|zapravka|avtobus|metro|yo'lkira)\b/i.test(text)) {
    inferredCategory = 'Transport';
    inferredType = 'expense';
  } else if (/\b(ovqat|non|go'sht|gosht|bozor|korzinka|makro|havas|supermarket|osh|choyxona|lunch|obed|kechki ovqat|kafe|restoran|kofe|lavash|shashlik)\b/i.test(text)) {
    inferredCategory = 'Oziq-ovqat';
    inferredType = 'expense';
  } else if (/\b(svet|gaz|suv|musor|kommunal|kvartira|arenda|wifi|internet|beeline|ucell|uztelecom|mobiuz)\b/i.test(text)) {
    inferredCategory = 'Kommunal';
    inferredType = 'expense';
  } else if (/\b(dori|dorixona|apteka|shifokor|doktor|klinika|analiz|tish|stomatolog)\b/i.test(text)) {
    inferredCategory = 'Sog\'liq';
    inferredType = 'expense';
  } else if (/\b(kiyim|poyafzal|kurtka|shim|ko'ylak|oyoq kiyim|futbolka|shim)\b/i.test(text)) {
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
 * Builds the robust, Uzbek-specialized system prompt for Gemini
 */
export function buildUzbekFinancialAiPrompt(normalizedText: string): string {
  return `You are an expert financial AI assistant for Moliya AI (Uzbekistan).
Your job is to parse financial transactions from natural language inputs (Uzbek, Russian, English, or mixed slang).

User Input: "${normalizedText}"

STRICT INSTRUCTIONS:
1. Detect transaction TYPE:
   - 'expense' (spent money, bought item, paid bill: "oldim", "sarfladim", "ketdi", "to'ladim", "lunchga", "taxiga")
   - 'income' (received salary, income, profit, gift: "maosh", "oylik", "tushdi", "ishladim", "keldi")
   - 'debt' (borrowed money from someone: "qarz oldim")
   - 'lending' (loaned money to someone: "qarz berdim")

2. Extract total AMOUNT as an INTEGER in UZS:
   - "14 mln" / "14 million" / "14000000" -> 14000000
   - "2 yarim mln" / "2.5 mln" -> 2500000
   - "500 ming" / "500k" / "500000" -> 500000
   - "30 mingga" / "30k" -> 30000
   - "100 dollar" -> 100
   - If no currency is mentioned, assume Uzbek So'm (UZS).

3. Categorize into EXACTLY ONE of these categories:
   - 'Oziq-ovqat' (food, groceries, restaurants, lunch, coffee, bread, meat: "non", "go'sht", "bozor", "korzinka", "osh", "obed")
   - 'Transport' (taxi, bus, fuel, metro: "taxi", "yandex", "benzin", "yo'lkira")
   - 'Kiyim' (clothes, shoes)
   - 'Kommunal' (utilities, rent, internet, phone bill: "svet", "gaz", "suv", "arenda", "wifi")
   - 'Sog\\'liq' (medicine, doctors, clinic: "dori", "apteka", "shifoxona")
   - 'Ta\\'lim' (courses, books, university tuition: "kurs", "kitob", "kontrakt")
   - 'Ko\\'ngil ochar' (entertainment, movies, games, park)
   - 'Maosh' (salary, earnings, wages: "oylik", "maosh", "avans")
   - 'Freelance' (freelance work, projects)
   - 'Biznes' (business income or expense)
   - 'Sovg\\'a' (gifts, donations)
   - 'Investitsiya' (savings, investment)
   - 'Boshqa' (other/general)

4. Title and Note:
   - 'title': concise 2-3 word title (e.g. "Taksi xarajati", "Bozor xaridi", "Oylik maosh")
   - 'note': meaningful description of the transaction

Return ONLY a valid JSON object matching the requested schema.`;
}

/**
 * Validates structured AI output before writing to database
 */
export function validateAiFinancialOutput(rawJson: any, normalizedInput: NormalizedFinancialInput): {
  isValid: boolean;
  type: string;
  amount: number;
  category: string;
  name: string;
  note: string;
  error?: string;
} {
  if (!rawJson || typeof rawJson !== 'object') {
    return {
      isValid: false,
      type: 'expense',
      amount: 0,
      category: 'Boshqa',
      name: '',
      note: '',
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

  return {
    isValid: true,
    type,
    amount,
    category,
    name,
    note
  };
}
