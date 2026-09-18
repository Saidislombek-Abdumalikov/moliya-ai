/**
 * Moliya AI — Live Bank.uz Multi-Currency Exchange Rate Engine
 * 
 * Fetches live commercial & Central Bank rates from https://bank.uz/uz/currency
 * Supports USD ($), EUR (€), RUB (₽), GBP (£), KZT (₸) conversion into base currency Uzbek So'm (UZS).
 * Seamlessly caches in localStorage and falls back to offline rates if disconnected.
 */

export type SupportedCurrency = 'UZS' | 'USD' | 'EUR' | 'RUB' | 'GBP' | 'KZT';

export interface CurrencyDetectionResult {
  currency: SupportedCurrency;
  symbol: string;
  isForeign: boolean;
  rate: number;
}

export interface BankUzCurrencyDetail {
  code: SupportedCurrency;
  rate: number;
  cbuRate?: number | null;
  buy?: number | null;
  buyBank?: string | null;
  sell?: number | null;
  sellBank?: string | null;
}

// Live fallback rates based on bank.uz market data
export const DEFAULT_RATES: Record<SupportedCurrency, number> = {
  UZS: 1,
  USD: 11850,
  EUR: 13620,
  RUB: 136,
  GBP: 15980,
  KZT: 27,
};

let cachedDetailedRates: Record<SupportedCurrency, BankUzCurrencyDetail> = {
  UZS: { code: 'UZS', rate: 1, cbuRate: 1, buy: 1, sell: 1 },
  USD: { code: 'USD', rate: 11850, cbuRate: 11833.37, buy: 11830, buyBank: 'Tenge Bank', sell: 11850, sellBank: 'Asia Alliance Bank' },
  EUR: { code: 'EUR', rate: 13620, cbuRate: 13577.61, buy: 13420, buyBank: 'O‘zbekiston Milliy banki', sell: 13620, sellBank: 'Ipak Yuli Bank' },
  RUB: { code: 'RUB', rate: 136, cbuRate: 139.79, buy: 112, buyBank: 'Kapitalbank', sell: 136, sellBank: 'Kapitalbank' },
  GBP: { code: 'GBP', rate: 15980, cbuRate: 15821.22, buy: 15600, buyBank: 'O‘zbekiston Milliy banki', sell: 15980, sellBank: 'Ipak Yuli Bank' },
  KZT: { code: 'KZT', rate: 27, cbuRate: 26.52, buy: 25, buyBank: 'Tenge Bank', sell: 27, sellBank: 'O‘zbekiston Milliy banki' },
};

let cachedRates: Record<SupportedCurrency, number> = { ...DEFAULT_RATES };
let lastFetchTime = 0;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Loads cached rates from localStorage if available
 */
if (typeof window !== 'undefined') {
  try {
    const saved = localStorage.getItem('moliya_bankuz_rates');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.rates && parsed.timestamp && (Date.now() - parsed.timestamp < CACHE_TTL_MS)) {
        cachedDetailedRates = { ...cachedDetailedRates, ...parsed.rates };
        for (const [k, v] of Object.entries(parsed.rates)) {
          if ((v as any)?.rate) {
            cachedRates[k as SupportedCurrency] = (v as any).rate;
          }
        }
        lastFetchTime = parsed.timestamp;
      }
    }
  } catch {}
}

/**
 * Fetch latest rates from live Bank.uz endpoint (async, non-blocking)
 */
export async function refreshLiveRates(): Promise<Record<SupportedCurrency, number>> {
  if (Date.now() - lastFetchTime < CACHE_TTL_MS) {
    return cachedRates;
  }

  try {
    const res = await fetch('/api/currency-rates', {
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.rates && typeof data.rates === 'object') {
        const newRates = { ...DEFAULT_RATES };
        const newDetails = { ...cachedDetailedRates };

        for (const [code, info] of Object.entries(data.rates)) {
          const item = info as BankUzCurrencyDetail;
          if (item && item.rate > 0) {
            newRates[code as SupportedCurrency] = Math.round(item.rate);
            newDetails[code as SupportedCurrency] = item;
          }
        }

        cachedRates = newRates;
        cachedDetailedRates = newDetails;
        lastFetchTime = Date.now();

        if (typeof window !== 'undefined') {
          localStorage.setItem('moliya_bankuz_rates', JSON.stringify({
            rates: cachedDetailedRates,
            timestamp: lastFetchTime,
            source: data.source || 'bank.uz'
          }));
        }
      }
    }
  } catch (e) {
    // Graceful fallback to default/cached rates
  }

  return cachedRates;
}

// Background prefetch when app loads
if (typeof window !== 'undefined') {
  setTimeout(() => { refreshLiveRates().catch(() => {}); }, 1500);
}

/**
 * Detects if a string mentions foreign currency (USD, EUR, RUB, GBP, KZT)
 */
export function detectCurrency(text: string): CurrencyDetectionResult {
  if (!text || typeof text !== 'string') {
    return { currency: 'UZS', symbol: "so'm", isForeign: false, rate: 1 };
  }

  const clean = text.toLowerCase().replace(/[`ʻ‘’]/g, "'");

  // 1. USD: "$", "400$", "$400", "dollar", "dollor", "dolir", "usd", "доллар"
  if (/\$|(?:\b(?:dollar|dollor|dolir|usd|доллар(?:ov|da|ga|lik)?)\b)/i.test(clean)) {
    return {
      currency: 'USD',
      symbol: '$',
      isForeign: true,
      rate: cachedRates.USD || DEFAULT_RATES.USD
    };
  }

  // 2. EUR: "€", "yevro", "evro", "euro", "eur", "евро"
  if (/€|(?:\b(?:yevro|evro|euro|eur|евро)\b)/i.test(clean)) {
    return {
      currency: 'EUR',
      symbol: '€',
      isForeign: true,
      rate: cachedRates.EUR || DEFAULT_RATES.EUR
    };
  }

  // 3. RUB: "₽", "rubl", "rub", "руб", "рубл"
  if (/₽|(?:\b(?:rubl|rub|руб|рубл)\b)/i.test(clean)) {
    return {
      currency: 'RUB',
      symbol: '₽',
      isForeign: true,
      rate: cachedRates.RUB || DEFAULT_RATES.RUB
    };
  }

  // 4. GBP: "£", "funt", "pound", "gbp"
  if (/£|(?:\b(?:funt|pound|gbp)\b)/i.test(clean)) {
    return {
      currency: 'GBP',
      symbol: '£',
      isForeign: true,
      rate: cachedRates.GBP || DEFAULT_RATES.GBP
    };
  }

  // 5. KZT: "₸", "tenge", "тенге", "kzt"
  if (/₸|(?:\b(?:tenge|тенге|kzt)\b)/i.test(clean)) {
    return {
      currency: 'KZT',
      symbol: '₸',
      isForeign: true,
      rate: cachedRates.KZT || DEFAULT_RATES.KZT
    };
  }

  return {
    currency: 'UZS',
    symbol: "so'm",
    isForeign: false,
    rate: 1
  };
}

/**
 * Converts a detected amount in foreign currency to Uzbek So'm (UZS) using live bank.uz rate
 */
export function convertCurrencyToUzs(amount: number, currency: SupportedCurrency, customRate?: number): {
  uzsAmount: number;
  rate: number;
  formattedUzs: string;
  originalFormatted: string;
  noteAnnotation: string;
} {
  const rate = customRate || cachedRates[currency] || DEFAULT_RATES[currency] || 1;
  const uzsAmount = Math.round(amount * rate);
  const formattedUzs = uzsAmount.toLocaleString('en-US').replace(/,/g, ' ');

  let originalFormatted = `${amount}`;
  let noteAnnotation = '';

  if (currency === 'USD') {
    originalFormatted = `${amount}$`;
    noteAnnotation = `(${amount}$ ≈ ${formattedUzs} so'm)`;
  } else if (currency === 'EUR') {
    originalFormatted = `${amount}€`;
    noteAnnotation = `(${amount}€ ≈ ${formattedUzs} so'm)`;
  } else if (currency === 'RUB') {
    originalFormatted = `${amount} ₽`;
    noteAnnotation = `(${amount} ₽ ≈ ${formattedUzs} so'm)`;
  } else if (currency === 'GBP') {
    originalFormatted = `${amount}£`;
    noteAnnotation = `(${amount}£ ≈ ${formattedUzs} so'm)`;
  } else if (currency === 'KZT') {
    originalFormatted = `${amount} ₸`;
    noteAnnotation = `(${amount} ₸ ≈ ${formattedUzs} so'm)`;
  }

  return {
    uzsAmount,
    rate,
    formattedUzs,
    originalFormatted,
    noteAnnotation
  };
}

export function getCachedBankUzDetails(): Record<SupportedCurrency, BankUzCurrencyDetail> {
  return cachedDetailedRates;
}
