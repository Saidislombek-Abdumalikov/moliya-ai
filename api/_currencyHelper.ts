/**
 * Moliya AI Backend — Currency & CBU Exchange Rate Helper
 * 
 * Supports USD ($), EUR (€), RUB (₽) conversion into base currency Uzbek So'm (UZS).
 * Includes live CBU fetching and authoritative fallback rates.
 */

export type SupportedCurrency = 'UZS' | 'USD' | 'EUR' | 'RUB';

export interface CurrencyDetectionResult {
  currency: SupportedCurrency;
  symbol: string;
  isForeign: boolean;
  rate: number;
}

export const DEFAULT_RATES: Record<SupportedCurrency, number> = {
  UZS: 1,
  USD: 12900,
  EUR: 14000,
  RUB: 140,
};

let cachedRates: Record<SupportedCurrency, number> = { ...DEFAULT_RATES };
let lastFetchTime = 0;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export async function getLiveRates(): Promise<Record<SupportedCurrency, number>> {
  if (Date.now() - lastFetchTime < CACHE_TTL_MS) {
    return cachedRates;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('https://cbu.uz/oz/arkhiv-kursov-valyut/json/', {
      signal: controller.signal
    });
    clearTimeout(timer);

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
      }
    }
  } catch (e) {
    // Graceful fallback to default rates
  }

  return cachedRates;
}

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
