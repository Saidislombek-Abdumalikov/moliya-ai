import assert from 'node:assert/strict';
import {sanitizeForLog,safeError} from '../api/_logger';
let count=0;
function test(name:string,fn:()=>void){fn();count++;console.log('PASS '+name)}
const secret='test-admin-credential-908172';
process.env.ADMIN_SECRET_KEY=secret;
test('configured admin secret removed from error stack',()=>assert.equal(sanitizeForLog(new Error('failed '+secret)).includes(secret),false));
test('encoded secret removed',()=>{process.env.TELEGRAM_BOT_TOKEN='12345678:abcdefghijklmnopqrstuvwxyz_123456';assert.equal(sanitizeForLog(encodeURIComponent(process.env.TELEGRAM_BOT_TOKEN)).includes('abcdefghijklmnopqrstuvwxyz'),false)});
test('non-hex sessions removed',()=>assert.equal(sanitizeForLog('sess_ZYX_abcdefgh-1234567890').includes('ZYX'),false));
test('Bearer header fully removed',()=>assert.equal(sanitizeForLog('Authorization: Bearer private-value').includes('private-value'),false));
test('JSON headers and nested credentials removed',()=>{const text=sanitizeForLog({headers:{authorization:'Bearer private-value',cookie:'moliya_admin_session=private-cookie'},data:{phone:'+998901234567',password:'private-password'}});for(const raw of ['private-value','private-cookie','private-password','+998901234567'])assert.equal(text.includes(raw),false)});
test('URL login code and key removed',()=>{const text=sanitizeForLog('https://example.test/?code=private-code&key=private-key&mode=normal');assert.equal(text.includes('private-code'),false);assert.equal(text.includes('private-key'),false);assert.ok(text.includes('mode=normal'))});
test('serialized session fields removed',()=>assert.equal(sanitizeForLog('{"sessionToken":"arbitrary-private-value"}').includes('arbitrary-private-value'),false));
test('Telegram download URL hides bot credential',()=>assert.equal(sanitizeForLog('https://api.telegram.org/file/bot12345678:abcdefghijklmnopqrstuvwxyz_123456/audio.ogg').includes('abcdefghijklmnopqrstuvwxyz'),false));
test('financial arrays not printed',()=>{const s=sanitizeForLog({transactions:[{note:'private-note'}],cards:[{number:'private-card'}]});assert.equal(s.includes('private-note'),false);assert.equal(s.includes('private-card'),false)});
test('circular objects handled',()=>{const x:any={password:'private-value'};x.self=x;const s=sanitizeForLog(x);assert.ok(s.includes('CIRCULAR'));assert.equal(s.includes('private-value'),false)});
test('diagnostics remain useful',()=>assert.equal(sanitizeForLog({status:503,route:'auth'}),'{"status":503,"route":"auth"}'));
test('safeError sanitizes every argument',()=>{const old=console.error;let captured:any[]=[];console.error=(...args)=>{captured=args};try{safeError('route failed',new Error(secret),{password:secret});assert.equal(captured.join(' ').includes(secret),false);assert.ok(captured.join(' ').includes('route failed'))}finally{console.error=old}});
console.log(`${count} log redaction checks passed.`);
