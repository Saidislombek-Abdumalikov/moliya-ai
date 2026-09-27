// Use the same bot for web login, onboarding verification and return links.
const configured = String(import.meta.env?.VITE_TELEGRAM_BOT_USERNAME || 'moliya_v2bot').replace(/^@/, '');
export const telegramBotUsername = /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(configured)
  ? configured : 'moliya_v2bot';

export function telegramBotLink(start?: string) {
  return `https://t.me/${telegramBotUsername}${start ? `?start=${encodeURIComponent(start)}` : ''}`;
}

export function telegramBotDeepLink(start: string) {
  return `tg://resolve?domain=${telegramBotUsername}&start=${encodeURIComponent(start)}`;
}
