import assert from 'node:assert/strict';
import {readSessionToken,saveSessionToken,clearSessionToken,SESSION_KEY} from '../src/clientSession.js';
import {configureTelegramViewport,keepTelegramSwipesDisabled} from '../src/telegramViewport.js';
import {normalizeTelegramKeyboard,telegramButtonUrl} from '../api/_telegramKeyboard.js';
import {captureInstallPrompt,pendingInstall,dismissInstall,INSTALL_DISMISSED_KEY,consumeInstall,installDismissed} from '../src/installPrompt.js';

const values=new Map<string,string>();
(globalThis as any).localStorage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)};
values.set('user_session_token_v1','legacy-session');
assert.equal(readSessionToken(),'legacy-session');
assert.equal(values.get(SESSION_KEY),'legacy-session');
assert.equal(values.has('user_session_token_v1'),false);
saveSessionToken('new-session');
values.set('user_session_token_v1','stale-session');
assert.equal(readSessionToken(),'new-session');
clearSessionToken();
assert.equal(readSessionToken(),null);
assert.equal(values.has('user_session_token_v1'),false);

for(const platform of ['tdesktop','macos','webk','webz']) {
 const calls:string[]=[];
 const tg={platform,isVersionAtLeast:()=>true,expand:()=>calls.push('expand'),requestFullscreen:()=>calls.push('fullscreen'),enableVerticalSwipes:()=>calls.push('enable'),disableVerticalSwipes:()=>calls.push('disable'),onEvent:()=>calls.push('event')};
 configureTelegramViewport(tg);keepTelegramSwipesDisabled(tg)();
 assert.deepEqual(calls,['expand','enable','fullscreen']);
}
let fullscreen=false;
configureTelegramViewport({platform:'tdesktop',isVersionAtLeast:()=>false,requestFullscreen:()=>{fullscreen=true}});
assert.equal(fullscreen,false);

assert.equal(telegramButtonUrl('moliya.uz'),'https://moliya.uz/');
assert.equal(telegramButtonUrl('https://example.com/?a=1&b=2'),'https://example.com/?a=1&b=2');
assert.equal(telegramButtonUrl('/?screen=reports','https://moliya-ai-pi.vercel.app'),'https://moliya-ai-pi.vercel.app/?screen=reports');
const markup=normalizeTelegramKeyboard({inline_keyboard:[[{text:'Open',url:'moliya.uz'},{text:'App',web_app:{url:'https://moliya-ai-pi.vercel.app'}}]]});
assert.equal(markup.inline_keyboard[0][0].url,'https://moliya.uz/');
assert.deepEqual(markup.inline_keyboard[0][1].web_app,{url:'https://moliya-ai-pi.vercel.app/'});
for(const value of ['javascript:alert(1)','data:text/plain,abc','https://user:pass@example.com','//evil.com','http://example.com','a\\b.com','example.com/a b'])assert.throws(()=>telegramButtonUrl(value));
assert.throws(()=>normalizeTelegramKeyboard({inline_keyboard:[[{text:'x',url:'example.com',callback_data:'a'}]]}));

const browser=new EventTarget() as any;
(globalThis as any).window=browser;(globalThis as any).location={hash:''};
browser.matchMedia=()=>({matches:false});
captureInstallPrompt();
const event=()=>Object.assign(new Event('beforeinstallprompt',{cancelable:true}),{prompt:async()=>{},userChoice:Promise.resolve({outcome:'dismissed'})});
const early=event();browser.dispatchEvent(early);
assert.equal(early.defaultPrevented,true);assert.equal(pendingInstall(),early);
dismissInstall();assert.equal(values.get(INSTALL_DISMISSED_KEY),undefined);assert.equal(installDismissed(),true);
assert.equal(pendingInstall(),early);assert.equal(consumeInstall(),early);assert.equal(pendingInstall(),null);
browser.dispatchEvent(new Event('appinstalled'));assert.equal(values.get('moliya_install_confirmed_v2'),'true');
values.clear();browser.Telegram={WebApp:{initData:'signed'}};
browser.dispatchEvent(event());assert.equal(pendingInstall(),null);
delete browser.Telegram;(globalThis as any).location.hash='#tgWebAppPlatform=android';
browser.dispatchEvent(event());assert.equal(pendingInstall(),null);
console.log('Release fixes: session migration/logout, desktop viewport, URL keyboards and install suppression passed.');
