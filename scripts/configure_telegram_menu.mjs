#!/usr/bin/env node
// Run from Moliya-V2 with Node 20+: node --env-file=.env scripts/configure_telegram_menu.mjs
// Optional numeric private chat IDs reset older per-chat menu overrides too.
import { pathToFileURL } from 'node:url';

export async function configureMenu(token, chatIds = [], fetcher = fetch) {
  if (!token || !/^\d+:[A-Za-z0-9_-]+$/.test(token)) throw new Error('TELEGRAM_BOT_TOKEN is required');
  if (chatIds.some(id => !/^\d+$/.test(String(id)))) throw new Error('Private chat IDs must be positive integers');
  const call = async (method, body) => {
    let response;
    try {
      response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000), body: JSON.stringify(body)
      });
    } catch { throw new Error(`Telegram ${method}: network error`); }
    let result;
    try { result = await response.json(); } catch { throw new Error(`Telegram ${method}: invalid response`); }
    if (!response.ok || !result.ok) throw new Error(`Telegram ${method} failed (HTTP ${response.status})`);
    return result.result;
  };
  for (const chatId of [null, ...new Set(chatIds.map(String))]) {
    const target = chatId === null ? {} : { chat_id: chatId };
    await call('setChatMenuButton', { ...target, menu_button: { type: 'commands' } });
    const menu = await call('getChatMenuButton', target);
    if (menu?.type !== 'commands') throw new Error('Menu verification failed');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  configureMenu((process.env.TELEGRAM_BOT_TOKEN || '').trim(), process.argv.slice(2))
    .then(() => console.log('Menu updated: command menu replaces the persistent app launcher. Message link buttons are unchanged. Disable the profile Main Mini App separately in BotFather.'))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
