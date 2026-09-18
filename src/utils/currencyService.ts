/**
 * Moliya AI — Multi-Currency & CBU Exchange Rate Engine
 * 
 * Supports USD ($), EUR (€), RUB (₽) conversion into base currency Uzbek So'm (UZS).
 * Integrates with Central Bank of Uzbekistan (CBU) JSON API with instant offline fallback.
 */

export type SupportedCurrency = 'UZS' | 'USD' | 'EUR' | 'RUB';

export interface CurrencyDetectionResult {
  currency: SupportedCurrency;
  symbol: string;
  isForeign: boolean;
  rate: number;
}

// Fallback rates (updated 2026)
export const DEFAULT_RATES: Record<SupportedCurrency, number> = {
  UZS: 1,
  USD: 12900,
  EUR: 14000,
  RUB: 140,
};

let cachedRates: Record<SupportedCurrency, number> = { ...DEFAULT_RATES };
let lastFetchTime = 0;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * Loads cached rates from localStorage if available
 */
if (typeof window !== 'undefined') {
  try {
    const saved = localStorage.getItem('moliya_cbu_rates');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.rates && parsed.timestamp && (Date.now() - parsed.timestamp < CACHE_TTL_MS)) {
        cachedRates = { ...DEFAULT_RATES, ...parsed.rates };
        lastFetchTime = parsed.timestamp;
      }
    }
  } catch {}
}

/**
 * Fetch latest rates from Central Bank of Uzbekistan (async, non-blocking)
 */
export async function refreshCbuRates(): Promise<Record<SupportedCurrency, number>> {
  if (Date.now() - lastFetchTime < CACHE_TTL_MS) {
    return cachedRates;
  }

  try {
    const res = await fetch('https://cbu.uz/oz/arkhiv-kursov-valyut/json/', {
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list)) {
        const newRates = { ...DEFAULT_RATES };
        for (const item of list) {
          const ccy = item.Ccy as string;
          const rateVal = parseFloat(item.Rate);
          if (!isNaN(rateVal) && rateVal > 0) {
            if (ccy === 'USD') newRates.USD = Math.round(rateVal);
            if (ccy === 'EUR') newRates.EUR = Math.round(rateVal);
            if (ccy === 'RUB') newRates.RUB = Math.round(rateVal);
          }
        }
        cachedRates = newRates;
        lastFetchTime = Date.now();
        if (typeof window !== 'undefined') {
          localStorage.setItem('moliya_cbu_rates', JSON.stringify({
            rates: cachedRates,
            timestamp: lastFetchTime
          }));
        }
      }
    }
  } catch (e) {
    // Graceful fallback to default rates
  }

  return cachedRates;
}

// Trigger background refresh on init if in browser
if (typeof window !== 'undefined') {
  setTimeout(() => { refreshCbuRates().catch(() => {}); }, 2000);
}

/**
 * Detects if a string mentions foreign currency (USD, EUR, RUB)
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

  return {
    currency: 'UZS',
    symbol: "so'm",
    isForeign: false,
    rate: 1
  };
}

/**
 * Converts a detected amount in foreign currency to Uzbek So'm (UZS).
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
  }

  return {
    uzsAmount,
    rate,
    formattedUzs,
    originalFormatted,
    noteAnnotation
  };
}
