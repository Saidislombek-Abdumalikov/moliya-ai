import assert from 'node:assert/strict';
import {withVoiceProgress} from '../api/_voiceEvidence.js';
let updates=0,finished=false;
await withVoiceProgress(async()=>{await new Promise(r=>setTimeout(r,35));return 1},async()=>{assert.equal(finished,false);updates++;return true},5);
finished=true;const count=updates;await new Promise(r=>setTimeout(r,20));assert.equal(updates,count);assert.ok(count>0);
let blocked=0;
await withVoiceProgress(async()=>{await new Promise(r=>setTimeout(r,25))},async()=>{blocked++;return false},5);
assert.equal(blocked,1);
console.log('Voice progress cleanup and backoff passed. No real audio/provider calls.');
