import assert from 'node:assert/strict';
import {authRequest, onceAsync, tourDone, tourKey, fetchWithTimeout, registrationReady} from '../src/clientSession';
import {telegramBotLink,telegramBotDeepLink} from '../src/telegramLinks';

let count = 0;
function check(name: string, fn: () => void) { fn(); count++; console.log('PASS', name); }
const values = new Map<string, string>();
const storage = {getItem: (key: string) => values.get(key) ?? null};
check('new account sees tour', () => assert.equal(tourDone(storage, 'a', false), false));
values.set(tourKey('a'), 'true');
check('dismissal survives old server data', () => assert.equal(tourDone(storage, 'a', false), true));
check('dismissal is scoped to account', () => assert.equal(tourDone(storage, 'b', false), false));
check('server dismissal does not skip a new browser tour', () => assert.equal(tourDone(storage, 'b', true), false));
values.set(tourKey('a','old','telegram'),'true');
check('web tour is separate from Mini App',()=>assert.equal(tourDone(storage,'a',true,'old','web'),false));
check('recreated account gets a fresh tour',()=>assert.equal(tourDone(storage,'a',true,'new','telegram'),false));
values.set('user_tour_completed_v2', 'true');
check('legacy global dismissal cannot hide another account tour', () => assert.equal(tourDone(storage, 'b', false), false));
check('verified bot account enters without local onboarding flag', () => assert.equal(registrationReady('moliya_user_tg_123', {completed:true,oferta_accepted:true,phone:'+998901234567'}, true), true));
check('phone or consent alone never enters', () => {
  for(const profile of [{completed:false,oferta_accepted:true},{completed:true,oferta_accepted:false},{completed:true,oferta_accepted:true}]) {
    assert.equal(registrationReady('moliya_user_tg_123', profile, profile.phone !== undefined), false);
  }
  assert.equal(registrationReady(null, {completed:true,oferta_accepted:true,phone:'+998901234567'}, true), false);
});
check('Mini App uses signed Telegram data over stale code', () => assert.deepEqual(authRequest('signed', 'expired', 'old'), {action:'telegram', body:{initData:'signed'}}));
check('saved web session is validated before a lingering code', () => assert.equal(authRequest('', 'new', 'old')?.action, 'validate-session'));
check('web session validated by server', () => assert.equal(authRequest('', null, 'saved')?.action, 'validate-session'));
check('no identity creates no authentication', () => assert.equal(authRequest('', null, null), null));
check('web login QR and deep link carry the same bot and request', () => {
  assert.equal(telegramBotLink('req_1234567890abcdef'),'https://t.me/moliya_v2bot?start=req_1234567890abcdef');
  assert.equal(telegramBotDeepLink('req_1234567890abcdef'),'tg://resolve?domain=moliya_v2bot&start=req_1234567890abcdef');
});
let calls = 0;
const bootstrap = onceAsync(async () => { calls++; return 'session'; });
assert.deepEqual(await Promise.all([bootstrap(), bootstrap()]), ['session', 'session']);
check('effect replay exchanges code only once', () => assert.equal(calls, 1));
const original = globalThis.fetch;
try {
  globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {once:true});
  });
  await assert.rejects(fetchWithTimeout('/api/auth/telegram', undefined, 10), /aborted/);
  count++; console.log('PASS stalled authentication aborts');
  globalThis.fetch = async () => new Response('{}', {status: 200});
  assert.equal((await fetchWithTimeout('/api/auth/telegram')).status, 200);
  count++; console.log('PASS normal authentication response preserved');
} finally { globalThis.fetch = original; }
console.log(`${count} client session tests passed`);
