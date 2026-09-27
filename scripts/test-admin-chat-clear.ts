import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const root = new URL(existsSync(new URL('../../Admin-Dashboard/', import.meta.url))
  ? '../../Admin-Dashboard/' : '../../admin Dashboard Moliya/', import.meta.url);
const { clearAllUserChatHistory, clearAllMessagesGlobally } = await import(new URL('src/services/userService.js', root).href);
const requests: any[] = [];
globalThis.fetch = async (url: any, options: any) => {
  requests.push({ url, options });
  return { ok: true, json: async () => ({ success: true, usersPurged: 2,
    summary: { attempted: 3, deleted: 2, failed: 1 } }) } as any;
};

const single = await clearAllUserChatHistory('moliya_user_tg_123', '123', { messageIds: [4] });
assert.equal(single.tgDeleted, 2);
assert.equal(single.tgFailed, 1);
assert.equal(requests.length, 1);
assert.equal(requests[0].url, '/api/admin?route=clear-telegram-history');
assert.equal(requests[0].options.credentials, 'include');
assert.deepEqual(JSON.parse(requests[0].options.body), {
  userId: 'moliya_user_tg_123', telegramId: '123', messageIds: [4], sweepRecent: true
});

await assert.rejects(clearAllUserChatHistory('moliya_user_tg_123', '456'), /RECIPIENT_MISMATCH/);
await assert.rejects(clearAllUserChatHistory('moliya_user_tg_123', '123', { wipeDbLogs: false }), /UNSUPPORTED_CLEAR_MODE/);
assert.equal(requests.length, 1);

const global = await clearAllMessagesGlobally();
assert.equal(global.usersUpdated, 2);
assert.equal(requests.length, 2);
assert.deepEqual(JSON.parse(requests[1].options.body), { allUsers: true });
await assert.rejects(clearAllMessagesGlobally({ wipeAiLogs: true }), /UNSUPPORTED_CLEAR_MODE/);
assert.equal(requests.length, 2);

globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: 'SERVER_FAILURE' }) }) as any;
await assert.rejects(clearAllUserChatHistory('moliya_user_tg_123', '123'), /SERVER_FAILURE/);
console.log('Admin chat clear: authenticated server calls, input guards, and failure handling passed.');
