import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const handlers={};let cached;let putCalls=0;
const context={URL,Response,console,self:{location:{origin:'https://app.test'},addEventListener:(name,fn)=>handlers[name]=fn},
 caches:{match:async()=>cached,open:async()=>({put:async()=>{putCalls++}})},fetch:async()=>{throw Error('offline')}};
vm.runInNewContext(fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),context);
async function request(url,mode='cors'){
 let response;const waits=[];
 handlers.fetch({request:{url,method:'GET',mode},respondWith:value=>response=Promise.resolve(value),waitUntil:p=>waits.push(p)});
 const result=await response;await Promise.all(waits);return result;
}
assert.equal(await request('https://telegram.org/js/telegram-web-app.js'),undefined);
assert.equal(await request('https://app.test/api/auth'),undefined);
assert.equal(await request('https://app.test/private.json'),undefined);
assert.equal((await request('https://app.test/?code=secret','navigate')).status,503);
assert.equal((await request('https://app.test/assets/missing.js')).type,'error');
cached=new Response('cached');assert.equal(await (await request('https://app.test/assets/main.js')).text(),'cached');
assert.equal(putCalls,0);
console.log('SW: external SDK bypass, API/private exclusions, offline Response fallbacks passed.');
