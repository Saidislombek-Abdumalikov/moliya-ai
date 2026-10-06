import { financialTotals, type FinancialRecord } from './financialTotals.js';
import { tashkentDay, transactionDay } from './reminderPolicy.js';

type Language = 'uz' | 'uz_cyrl' | 'ru' | 'en';
type DatedRecord = FinancialRecord & { date?: unknown };
const money = (n: number) => `${Math.round(n).toLocaleString('en-US').replace(/,/g, ' ')} so‘m`;

export function isFinancialQuestion(text: string): boolean {
  const q = text.trim().toLowerCase();
  if (!q || q.length > 600) return false;
  if (/\d/.test(q) && !/[?？]|qancha|qanday|necha|қанча|қандай|неча|сколько|how much|maslahat|маслаҳат|advice/iu.test(q)) return false;
  return /(qancha|qanchaga|qanday|necha|maslahat|tavsiya|tejash|statistika|balansim|xarajatlarim|daromadim|qarzim|қанча|қандай|неча|маслаҳат|тавсия|балансим|харажатларим|даромадим|қарзим|сколько|совет|баланс|how much|advice|balance)/iu.test(q)
    || /[?？]$/.test(q) && /xarajat|daromad|qarz|pul|sarf|hisob|харажат|даромад|қарз|пул|income|expense|debt|money|расход|доход|долг/iu.test(q);
}

export function financialInsight(records: readonly DatedRecord[], lang: Language = 'uz', now = new Date(), scope: 'month' | 'today' | 'all' | 'week' = 'month'): string {
  const day = tashkentDay(now);
  const weekStart = new Date(Date.parse(day + 'T00:00:00Z') - 6 * 86400000).toISOString().slice(0,10);
  const month = day.slice(0, 7);
  const txs = scope === 'all' ? records : records.filter(tx =>
    scope === 'week' ? transactionDay(tx.date) >= weekStart && transactionDay(tx.date) <= day : scope === 'today' ? transactionDay(tx.date) === tashkentDay(now) : transactionDay(tx.date).slice(0, 7) === month);
  const totals = financialTotals(txs);
  const period = scope === 'week' ? {uz:'Oxirgi 7 kunda',uz_cyrl:'Охирги 7 кунда',ru:'За последние 7 дней',en:'In the last 7 days'}[lang] : scope === 'today'
    ? { uz: 'Bugun', uz_cyrl: 'Бугун', ru: 'Сегодня', en: 'Today' }[lang]
    : scope === 'all'
    ? { uz: 'Qaydlarda', uz_cyrl: 'Қайдларда', ru: 'Во всех записях', en: 'Across all records' }[lang]
    : { uz: 'Shu oy', uz_cyrl: 'Шу ой', ru: 'За этот месяц', en: 'This month' }[lang];
  const noData = {
    uz: `${period} haqiqiy moliyaviy qayd yetarli emas. Yozuv kiritsangiz, tahlil paydo bo‘ladi.`,
    uz_cyrl: `${period} ҳақиқий молиявий қайд етарли эмас. Ёзув киритсангиз, таҳлил пайдо бўлади.`,
    ru: `${period} недостаточно реальных записей. Добавьте операцию для анализа.`,
    en: `${period}, there are not enough real records. Add a transaction to see an insight.`
  };
  if (!totals.count) return noData[lang];
  const top = Object.entries(totals.categories).sort((a, b) => b[1] - a[1])[0];
  if (!top) return {
    uz: `${period} ${totals.count} ta qayd bor, lekin xarajat qaydi yo‘q. Tejash haqida xulosa qilishga ma’lumot yetmaydi.`,
    uz_cyrl: `${period} ${totals.count} та қайд бор, лекин харажат қайди йўқ. Тежаш ҳақида хулоса қилишга маълумот етмайди.`,
    ru: `${period} ${totals.count} записей, но расходов нет. Данных для совета по экономии недостаточно.`,
    en: `${period} there are ${totals.count} records, but no expenses. There is not enough data for a savings insight.`
  }[lang];
  const [category, amount] = top;
  return {
    uz: `${period} qayd etilgan xarajat ${money(totals.expense)}. Eng katta toifa: ${category} — ${money(amount)}. Shu toifa bo‘yicha limitni ko‘rib chiqishingiz mumkin.`,
    uz_cyrl: `${period} қайд этилган харажат ${money(totals.expense)}. Энг катта тоифа: ${category} — ${money(amount)}. Шу тоифа учун лимитни кўриб чиқинг.`,
    ru: `${period} расходы по записям: ${money(totals.expense)}. Крупнейшая категория: ${category} — ${money(amount)}. Можно установить для неё лимит.`,
    en: `${period}, recorded spending is ${money(totals.expense)}. Largest category: ${category} — ${money(amount)}. Consider setting a limit for it.`
  }[lang];
}

export function answerFinancialQuestion(question: string, records: readonly DatedRecord[], lang: Language = 'uz', now = new Date()): string | null {
  if (!isFinancialQuestion(question)) return null;
  const q = question.toLowerCase();
  const day = tashkentDay(now);
  const scope = /bugun|бугун|сегодня|today/iu.test(q) ? 'today' : /jami|жами|barchasi|барчаси|hammasi|ҳаммаси|всего|all time/iu.test(q) ? 'all' : 'month';
  const txs = records.filter(tx => {
    if (scope === 'all') return true;
    const recordedDay = transactionDay(tx.date);
    return scope === 'today' ? recordedDay === day : recordedDay.slice(0, 7) === day.slice(0, 7);
  });
  const totals = financialTotals(txs);
  if (!totals.count) return {
    uz: 'Bu davr uchun qayd topilmadi. Ma’lumot bo‘lmasa, summa yoki maslahatni taxmin qilmayman.',
    uz_cyrl: 'Бу давр учун қайд топилмади. Маълумот бўлмаса, суммани тахмин қилмайман.',
    ru: 'За этот период записей нет. Без данных я не буду угадывать суммы.',
    en: 'No records were found for this period. I cannot estimate amounts without data.'
  }[lang];
  if (/maslahat|маслаҳат|tavsiya|тавсия|tejash|qanday|қандай|совет|advice|save money/iu.test(q)) return financialInsight(txs, lang, now, scope);
  const label = scope === 'today' ? { uz: 'Bugun', uz_cyrl: 'Бугун', ru: 'Сегодня', en: 'Today' }[lang]
    : scope === 'all' ? { uz: 'Barcha qaydlar', uz_cyrl: 'Барча қайдлар', ru: 'Все записи', en: 'All records' }[lang]
    : { uz: 'Shu oy', uz_cyrl: 'Шу ой', ru: 'Этот месяц', en: 'This month' }[lang];
  const lines = lang === 'ru'
    ? [`${label} (${totals.count} записей):`, `Доходы: ${money(totals.income)}`, `Расходы: ${money(totals.expense)}`, `Получено в долг: ${money(totals.borrowed)}`, `Дано в долг: ${money(totals.lent)}`, `Движение денег по записям: ${money(totals.cashFlow)}`]
    : lang === 'en'
    ? [`${label} (${totals.count} records):`, `Income: ${money(totals.income)}`, `Expenses: ${money(totals.expense)}`, `Borrowed: ${money(totals.borrowed)}`, `Lent: ${money(totals.lent)}`, `Recorded cash movement: ${money(totals.cashFlow)}`]
    : lang === 'uz_cyrl'
    ? [`${label} (${totals.count} та қайд):`, `Даромад: ${money(totals.income)}`, `Харажат: ${money(totals.expense)}`, `Олинган қарз: ${money(totals.borrowed)}`, `Берилган қарз: ${money(totals.lent)}`, `Қайдлардаги пул оқими: ${money(totals.cashFlow)}`]
    : [`${label} (${totals.count} ta qayd):`, `Daromad: ${money(totals.income)}`, `Xarajat: ${money(totals.expense)}`, `Olingan qarz: ${money(totals.borrowed)}`, `Berilgan qarz: ${money(totals.lent)}`, `Qaydlardagi pul oqimi: ${money(totals.cashFlow)}`];
  return lines.join('\n');
}
