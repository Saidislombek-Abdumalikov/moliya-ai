import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
// Exercise the actual context functions with deferred network responses.
const source=fs.readFileSync(new URL('../src/FinanceContext.tsx',import.meta.url),'utf8');
const refresh=source.slice(source.indexOf('  const refreshUserData ='),source.indexOf('\n  // ═',source.indexOf('  const refreshUserData =')));
const update=source.slice(source.indexOf('  const updateOnboarding ='),source.indexOf('\n  const writeFinancial',source.indexOf('  const updateOnboarding =')));
const code=ts.transpileModule(refresh+'\n'+update+'\nreturn {refreshUserData,updateOnboarding};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
function deferred(){let resolve!:(v:any)=>void;const promise=new Promise<any>(r=>resolve=r);return {promise,resolve};}
let token='old',state:any={voice_auto_send:false,completed:false},persisted=0,gets=0;
let get=deferred(),post=deferred();
const scope:any={onboarding:state,preferenceWrites:{current:0},refreshSequence:{current:0},getEffectiveUserId:()=> 'user',readSessionToken:()=>token,getClientAuthHeaders:()=>({}),setOnboarding:(v:any)=>{state=v;},localStorage:{setItem(){}},window:{dispatchEvent(){}},Event, tourKey:()=>'',isTelegramMiniApp:()=>false,fetchWithTimeout:(_url:string,init:any)=>{if(init?.method==='POST')return post.promise;gets++;return get.promise;},persistAuthState:()=>persisted++,renewTelegramSession:async()=>{},setUserId(){},setCards(){},setCustomTransactions(){},clearSessionToken(){},setAuthError(){}};
const api=new Function(...Object.keys(scope),code)(...Object.values(scope));
const oldRefresh=api.refreshUserData();
const saving=api.updateOnboarding({voice_auto_send:true});
assert.equal(state.voice_auto_send,true);
await api.refreshUserData();assert.equal(gets,1,'Refresh must pause while preferences save');
post.resolve({ok:true,status:200});await saving;
get.resolve({ok:true,json:async()=>({user:{id:'user',onboarding:{voice_auto_send:false}}})});await oldRefresh;
assert.equal(persisted,0,'An older refresh cannot overwrite the saved toggle');assert.equal(state.voice_auto_send,true);assert.equal(scope.preferenceWrites.current,0);
post=deferred();const changedSession=api.updateOnboarding({voice_auto_send:false});token='new';state=null;post.resolve({ok:false,status:409});await assert.rejects(changedSession,/Sessiya/);assert.equal(state,null,'Old session must not restore its profile after logout');assert.equal(scope.preferenceWrites.current,0);
console.log('Client preference race: pending refresh, stale response, session change and guard release passed.');

// A second toggle must not overwrite an in-flight preference snapshot.
token='stable';post=deferred();const firstSave=api.updateOnboarding({voice_auto_send:true});
await assert.rejects(api.updateOnboarding({remember_categories:true}),/Oldingi sozlama/);
post.resolve({ok:true,status:200});await firstSave;assert.equal(scope.preferenceWrites.current,0);
// Conflict retry can itself fail: restore the pre-save state and release the guard.
let calls=0;
const retryScope={...scope,fetchWithTimeout:async()=>{if(++calls===1)return {ok:false,status:409};throw Error('offline');}};
const retryApi=new Function(...Object.keys(retryScope),code)(...Object.values(retryScope));
await assert.rejects(retryApi.updateOnboarding({voice_auto_send:true}),/offline/);
assert.equal(state.voice_auto_send,false);assert.equal(scope.preferenceWrites.current,0);
console.log('Preference overlap and conflict retry rollback passed.');
