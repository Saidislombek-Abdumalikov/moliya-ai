/**
 * Moliya AI Backend — Live Bank.uz & CBU Exchange Rate Engine
 * 
 * Fetches live real-time rates from https://bank.uz/uz/currency
 * Extracts both official Central Bank (CBU) rates and best commercial bank rates (Sotib olish / Sotish).
 * Includes resilient fallbacks to CBU JSON API and default offline rates.
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
  rate: number; // Effective market rate (best sell or cbu rate)
  cbuRate?: number | null;
  buy?: number | null;
  buyBank?: string | null;
  sell?: number | null;
  sellBank?: string | null;
}

export interface BankUzRatesResponse {
  source: 'bank.uz' | 'cbu.uz' | 'fallback';
  updatedAt: string;
  rates: Record<SupportedCurrency, BankUzCurrencyDetail>;
}

// Default fallback rates based on current bank.uz market data
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

let lastFetchTime = 0;
let lastSource: 'bank.uz' | 'cbu.uz' | 'fallback' = 'fallback';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes cache for high performance

export async function fetchLiveBankUzRates(): Promise<BankUzRatesResponse> {
  if (Date.now() - lastFetchTime < CACHE_TTL_MS && lastSource !== 'fallback') {
    return {
      source: lastSource,
      updatedAt: new Date(lastFetchTime).toISOString(),
      rates: cachedDetailedRates,
    };
  }

  // 1. Primary: Fetch live HTML from bank.uz
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch('https://bank.uz/uz/currency', {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'uz,ru,en;q=0.9'
      }
    });
    clearTimeout(timer);

    if (res.ok) {
      const html = await res.text();
      if (html && html.length > 5000) {
        const parseCurrency = (code: SupportedCurrency): BankUzCurrencyDetail => {
          // A. Markaziy bank rate from top tab
          const mbRe = new RegExp(`href=["']#${code}["'][\\s\\S]*?<span class=["']medium-text["']>\\s*([\\d\\s.,]+)<\\/span>`, 'i');
          const mbMatch = html.match(mbRe);
          const cbuRate = mbMatch ? parseFloat(mbMatch[1].replace(/\s+/g, '').replace(',', '.')) : null;

          // B. Tab content block with best commercial rates
          const tabRe = new RegExp(`id=["']best_${code}["'][\\s\\S]*?(<div role=["']tabpanel["']|<\\/div>\\s*<\\/div>\\s*<\\/div>\\s*<\\/div>\\s*<\\/div>)`, 'i');
          const tabMatch = html.match(tabRe);
          const tabHtml = tabMatch ? tabMatch[0] : '';

          const bankRegex = /<a[^>]*href=[^>]*\/currency\/bank\/[^>]*>[\s\S]*?<span class=["']medium-text["']>\s*([^<]+)<\/span>[\s\S]*?<span class=["']medium-text green-date["']>\s*([\d\s.,]+)/gi;

          // Buy section (Sotib olish — eng yuqori)
          let bestBuyRate: number | null = null;
          let bestBuyBank: string | null = null;
          const buyBlock = tabHtml.match(/Sotib\s+olish[\s\S]*?(Sotish|$)/i);
          if (buyBlock) {
            let m: RegExpExecArray | null;
            while ((m = bankRegex.exec(buyBlock[0])) !== null) {
              const bName = m[1].trim();
              const bRate = parseFloat(m[2].replace(/\s+/g, '').replace(',', '.'));
              if (!isNaN(bRate) && (bestBuyRate === null || bRate > bestBuyRate)) {
                bestBuyRate = bRate;
                bestBuyBank = bName;
              }
            }
          }

          // Sell section (Sotish — eng past)
          let bestSellRate: number | null = null;
          let bestSellBank: string | null = null;
          const sellIndex = tabHtml.indexOf('Sotish');
          if (sellIndex !== -1) {
            const sellBlock = tabHtml.slice(sellIndex);
            let m: RegExpExecArray | null;
            bankRegex.lastIndex = 0;
            while ((m = bankRegex.exec(sellBlock)) !== null) {
              const bName = m[1].trim();
              const bRate = parseFloat(m[2].replace(/\s+/g, '').replace(',', '.'));
              if (!isNaN(bRate) && (bestSellRate === null || bRate < bestSellRate)) {
                bestSellRate = bRate;
                bestSellBank = bName;
              }
            }
          }

          // When user converts foreign currency to UZS (e.g. 400$ expense/income), use the best bank exchange rate
          const activeRate = bestBuyRate || bestSellRate || cbuRate || DEFAULT_RATES[code];

          return {
            code,
            rate: Math.round(activeRate),
            cbuRate,
            buy: bestBuyRate,
            buyBank: bestBuyBank,
            sell: bestSellRate,
            sellBank: bestSellBank
          };
        };

        const currencies: SupportedCurrency[] = ['USD', 'EUR', 'RUB', 'GBP', 'KZT'];
        const updated = { ...cachedDetailedRates };
        for (const c of currencies) {
          const parsed = parseCurrency(c);
          if (parsed.rate > 0) {
            updated[c] = parsed;
          }
        }
        cachedDetailedRates = updated;
        lastFetchTime = Date.now();
        lastSource = 'bank.uz';

        return {
          source: 'bank.uz',
          updatedAt: new Date(lastFetchTime).toISOString(),
          rates: cachedDetailedRates,
        };
      }
    }
  } catch (e) {
    console.warn('[CURRENCY] bank.uz fetch notice, trying CBU fallback...');
  }

  // 2. Secondary Fallback: Central Bank of Uzbekistan official JSON API
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
        const updated = { ...cachedDetailedRates };
        for (const item of list) {
          const ccy = item.Ccy as SupportedCurrency;
          const rateVal = parseFloat(item.Rate);
          if (!isNaN(rateVal) && rateVal > 0 && updated[ccy]) {
            updated[ccy] = {
              ...updated[ccy],
              code: ccy,
              rate: Math.round(rateVal),
              cbuRate: rateVal
            };
          }
        }
        cachedDetailedRates = updated;
        lastFetchTime = Date.now();
        lastSource = 'cbu.uz';

        return {
          source: 'cbu.uz',
          updatedAt: new Date(lastFetchTime).toISOString(),
          rates: cachedDetailedRates,
        };
      }
    }
  } catch (e) {
    // Fallback to cached default rates
  }

  return {
    source: 'fallback',
    updatedAt: new Date(lastFetchTime || Date.now()).toISOString(),
    rates: cachedDetailedRates,
  };
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
      rate: cachedDetailedRates.USD.rate || DEFAULT_RATES.USD
    };
  }

  // 2. EUR: "€", "yevro", "evro", "euro", "eur", "евро"
  if (/€|(?:\b(?:yevro|evro|euro|eur|евро)\b)/i.test(clean)) {
    return {
      currency: 'EUR',
      symbol: '€',
      isForeign: true,
      rate: cachedDetailedRates.EUR.rate || DEFAULT_RATES.EUR
    };
  }

  // 3. RUB: "₽", "rubl", "rub", "руб", "рубл"
  if (/₽|(?:\b(?:rubl|rub|руб|рубл)\b)/i.test(clean)) {
    return {
      currency: 'RUB',
      symbol: '₽',
      isForeign: true,
      rate: cachedDetailedRates.RUB.rate || DEFAULT_RATES.RUB
    };
  }

  // 4. GBP: "£", "funt", "pound", "gbp"
  if (/£|(?:\b(?:funt|pound|gbp)\b)/i.test(clean)) {
    return {
      currency: 'GBP',
      symbol: '£',
      isForeign: true,
      rate: cachedDetailedRates.GBP.rate || DEFAULT_RATES.GBP
    };
  }

  // 5. KZT: "₸", "tenge", "тенге", "kzt"
  if (/₸|(?:\b(?:tenge|тенге|kzt)\b)/i.test(clean)) {
    return {
      currency: 'KZT',
      symbol: '₸',
      isForeign: true,
      rate: cachedDetailedRates.KZT.rate || DEFAULT_RATES.KZT
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
  const rate = customRate || cachedDetailedRates[currency]?.rate || DEFAULT_RATES[currency] || 1;
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
