import assert from 'node:assert/strict';
import {configureTelegramViewport,keepTelegramSwipesDisabled,waitForTelegramSdk} from '../src/telegramViewport';
import {aiButtonCopy,aiCategoryLabel,type AppLanguage} from '../src/components/aiButtonCopy';
import {tourDone,tourKey} from '../src/clientSession';
import {activeSessionToken} from '../api/_sessionChoice';

const calls:string[]=[];
const app={platform:'android',ready:()=>calls.push('ready'),expand:()=>calls.push('expand'),
  disableVerticalSwipes:()=>calls.push('disableVerticalSwipes'),
  enableClosingConfirmation:()=>calls.push('enableClosingConfirmation'),
  requestFullscreen:()=>calls.push('requestFullscreen')};
assert.equal(configureTelegramViewport(app),true);
assert.deepEqual(calls,['ready','expand','disableVerticalSwipes','enableClosingConfirmation','requestFullscreen']);
assert.equal(configureTelegramViewport(undefined),false);
assert.equal(configureTelegramViewport({platform:'unknown',ready:()=>{throw Error('older client')},expand:()=>calls.push('fallback expand')}),true);
assert.equal(calls.at(-1),'fallback expand');
const handlers=new Map<string,()=>void>();
const remove=keepTelegramSwipesDisabled({
  disableVerticalSwipes:()=>calls.push('swipe disabled again'),
  onEvent:(event,handler)=>handlers.set(event,handler),
  offEvent:(event)=>handlers.delete(event)
});
handlers.get('fullscreenChanged')?.();handlers.get('activated')?.();
assert.equal(calls.filter(x=>x==='swipe disabled again').length,2);
remove();assert.equal(handlers.size,0);
let delayedSdk:{initData:string}|undefined;
setTimeout(()=>{delayedSdk={initData:'signed-launch'};},30);
assert.equal((await waitForTelegramSdk(()=>delayedSdk,250))?.initData,'signed-launch');
assert.equal(await waitForTelegramSdk(()=>undefined,110),undefined);
const now=Date.now();
assert.equal(activeSessionToken({session_token:'sess_'+'a'.repeat(48),session_expires_at:new Date(now+60_000).toISOString()},now),'sess_'+'a'.repeat(48));
assert.equal(activeSessionToken({session_token:'sess_'+'a'.repeat(48),session_expires_at:new Date(now-1).toISOString()},now),null);
assert.equal(activeSessionToken({session_token:'bad',session_expires_at:new Date(now+60_000).toISOString()},now),null);

for(const lang of ['uz','uz_cyrl','ru','en'] as AppLanguage[]){
  const copy=aiButtonCopy(lang);
  assert.equal(copy.types.length,4);
  assert.equal(copy.voice.length,4);
  assert.equal(copy.tips.length,4);
  assert.ok(copy.account && copy.amount && copy.receiptFailed && copy.samplesYes);
  assert.ok(aiCategoryLabel(lang,'Oziq-ovqat'));
}
assert.equal(aiCategoryLabel('en','Oziq-ovqat'),'Food');
assert.equal(aiCategoryLabel('ru','Oziq-ovqat'),'Продукты');
assert.equal(aiCategoryLabel('uz_cyrl','Oziq-ovqat'),'Озиқ-овқат');
assert.equal(aiCategoryLabel('en','Unrecognized'), 'Unrecognized');
const flags=new Map([[tourKey('first'),'true']]);
const storage={getItem:(key:string)=>flags.get(key)??null};
assert.equal(tourDone(storage,'first',false),true);
assert.equal(tourDone(storage,'second',false),false);
console.log('Mini App viewport, four AI modal languages and account-scoped tour checks passed.');
