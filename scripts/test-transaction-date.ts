import assert from 'node:assert/strict';
import {localTransactionDate} from '../shared/transactionDate';
for(const zone of ['Asia/Tashkent','UTC','America/Los_Angeles']){
  process.env.TZ=zone;
  assert.equal(localTransactionDate('2026-10-07T00:30'),'2026-10-07T00:30');
  assert.equal(localTransactionDate('2026-10-07'),'2026-10-07T12:00');
}
for(const bad of ['',null,'2026-02-30T12:00','2026-10-07T24:00','2026-10-07T12:60','2026-10-07T12:00Z'])assert.equal(localTransactionDate(bad),null);
console.log('Transaction calendar dates: passed');
