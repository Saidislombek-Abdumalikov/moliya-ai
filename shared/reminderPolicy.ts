import { financialAmount, financialKind } from './financialTotals.js';

export type ReminderSlot = 'morning' | 'afternoon' | 'evening';
export const reminderSlots: readonly ReminderSlot[] = ['morning', 'afternoon', 'evening'];

export function tashkentDay(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const value = (key: string) => parts.find(part => part.type === key)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function transactionDay(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return '';
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)?$/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }
  const date = new Date(trimmed);
  return Number.isFinite(date.getTime()) ? tashkentDay(date) : '';
}

export function shouldRemind(user: any, slot: ReminderSlot | null, now: Date): boolean {
  const preferences = user?.onboarding?.notifications;
  if (preferences?.opt1 === false) return false;
  if (slot && preferences?.reminderSlot && preferences.reminderSlot !== slot) return false;
  if (slot && !preferences?.reminderSlot && slot !== 'evening') return false;
  const frequency = preferences?.reminderFrequency || 'daily';
  if (frequency === 'off') return false;
  if (frequency === 'weekly' && new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tashkent', weekday: 'short'
  }).format(now) !== 'Mon') return false;
  if (frequency !== 'daily' && frequency !== 'weekly') return false;
  const day = tashkentDay(now);
  const transactions = Array.isArray(user?.transactions) ? user.transactions : [];
  return !transactions.some((tx: any) => financialKind(tx) && financialAmount(tx) > 0 && transactionDay(tx.date) === day);
}
