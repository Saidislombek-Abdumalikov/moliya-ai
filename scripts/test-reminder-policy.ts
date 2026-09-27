import assert from 'node:assert/strict';
import { shouldRemind, tashkentDay } from '../shared/reminderPolicy.js';
import { safePreferences } from '../api/_userPolicy.js';

const monday = new Date('2026-09-28T04:00:00Z'); // 09:00 Tashkent
assert.equal(tashkentDay(monday), '2026-09-28');
const user = (notifications: any, transactions: any[] = []) => ({ onboarding: { notifications }, transactions });
assert.equal(shouldRemind(user({}, []), 'morning', monday), false);
assert.equal(shouldRemind(user({}, []), 'evening', monday), true);
assert.equal(shouldRemind(user({ opt1: false }, []), 'evening', monday), false);
assert.equal(shouldRemind(user({ reminderSlot: 'morning', reminderFrequency: 'weekly' }, []), 'morning', monday), true);
assert.equal(shouldRemind(user({ reminderSlot: 'morning', reminderFrequency: 'weekly' }, []), 'morning', new Date('2026-09-29T04:00:00Z')), false);
assert.equal(shouldRemind(user({ reminderFrequency: 'off' }, []), null, monday), false);
for (const type of ['income', 'expense', 'debt', 'lending']) {
  assert.equal(shouldRemind(user({}, [{ type, amount: 100, date: '2026-09-28' }]), 'evening', monday), false);
}
assert.equal(shouldRemind(user({}, [{ type: 'expense', amount: 100, date: '2026-09-27T20:30:00Z' }]), 'evening', monday), false);
assert.equal(shouldRemind(user({}, [{ type: 'expense', amount: 100, date: '2026-09-27' }]), 'evening', monday), true);
assert.equal(shouldRemind(user({}, [{ type: 'unknown', amount: 100, date: '2026-09-28' }]), 'evening', monday), true);
assert.deepEqual(safePreferences({notifications:{opt1:true,opt2:false,opt3:false,reminderFrequency:'weekly',reminderSlot:'morning'}}).notifications,
  {opt1:true,opt2:false,opt3:false,reminderFrequency:'weekly',reminderSlot:'morning'});
assert.equal(safePreferences({notifications:{reminderFrequency:'yearly',reminderSlot:'arbitrary'}}).notifications.reminderFrequency,undefined);
console.log('Reminder preferences, local day and recorded-transaction rules passed.');
