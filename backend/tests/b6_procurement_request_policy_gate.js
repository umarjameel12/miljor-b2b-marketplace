'use strict';
const assert = require('node:assert/strict');
const { normalizeRequestDraft } = require('../src/services/procurementRequestPolicy');

const sample = () => ({
  delivery_area: 'Johar Town, Lahore',
  items: [
    { family_id: 1, unit: 'kg', quantity: '100.2500', requirements: 'Premium Sella' },
    { family_id: 2, unit: 'tin', quantity: '5', requirements: '16L sealed tins' },
  ]
});
let count = 0;
const check = (name, fn) => {
  fn();
  count++;
  console.log(`PASS ${count}: ${name}`);
};
const fails = (name, input, code) => check(name, () => {
  assert.throws(() => normalizeRequestDraft(input), x => x.code === code);
});

check('Multi-product single one-time defaults', () => {
  const x = normalizeRequestDraft(sample());
  assert.equal(x.items.length, 2);
  assert.equal(x.items[0].quantity, '100.2500');
  assert.equal(x.items[1].quantity, '5.0000');
  assert.equal(x.ownership, 'SINGLE_BUYER');
  assert.equal(x.recurring_requires_explicit_consent, false);
});
check('Collective recurring intent is separate from financial commitment', () => {
  const x = normalizeRequestDraft({
    ...sample(), ownership: 'COLLECTIVE', frequency: 'WEEKLY',
    join_deadline: new Date(Date.now() + 86400000).toISOString(),
    quote_deadline: new Date(Date.now() + 2 * 86400000).toISOString()
  });
  assert.equal(x.participant_payment_separation, true);
  assert.equal(x.recurring_requires_explicit_consent, true);
});
fails('No empty shopping list', {...sample(),items:[]}, 'INVALID_PROCUREMENT_ITEMS');
fails('Reject fractional tins', {...sample(),items:[{family_id:1,unit:'tin',quantity:'1.5'}]}, 'INVALID_PROCUREMENT_QUANTITY');
fails('Reject negative or zero quantities', {...sample(),items:[{family_id:1,unit:'kg',quantity:'0'}]}, 'INVALID_PROCUREMENT_QUANTITY');
fails('Reject nonnumeric decimals', {...sample(),items:[{family_id:1,unit:'kg',quantity:'NaN'}]}, 'INVALID_PROCUREMENT_QUANTITY');
fails('Reject excessive decimal scale', {...sample(),items:[{family_id:1,unit:'kg',quantity:'1.00001'}]}, 'INVALID_PROCUREMENT_QUANTITY');
fails('Reject unknown unit', {...sample(),items:[{family_id:1,unit:'cubic',quantity:'1'}]}, 'INVALID_PROCUREMENT_UNIT');
fails('Reject invalid family', {...sample(),items:[{family_id:0,unit:'kg',quantity:'1'}]}, 'INVALID_PROCUREMENT_FAMILY');
fails('Reject unknown purchasing mode', {...sample(),ownership:'HOUSEHOLD'}, 'INVALID_PROCUREMENT_MODE');
fails('Collective join cutoff required', {...sample(),ownership:'COLLECTIVE'}, 'PROCUREMENT_JOIN_DEADLINE_REQUIRED');
fails('Single buyer cannot set collective cutoff', {...sample(),join_deadline:new Date(Date.now()+86400000).toISOString()}, 'INVALID_PROCUREMENT_JOIN');
fails('Reject timezone-less deadline', {...sample(),quote_deadline:'2030-01-01T12:00:00'}, 'INVALID_PROCUREMENT_DEADLINE');
fails('Reject quote deadline earlier than join cutoff', {...sample(),ownership:'COLLECTIVE',join_deadline:new Date(Date.now()+2*86400000).toISOString(),quote_deadline:new Date(Date.now()+86400000).toISOString()}, 'INVALID_PROCUREMENT_DEADLINE');
fails('Reject too many items', {...sample(),items:Array(51).fill({family_id:1,unit:'kg',quantity:'1'})}, 'INVALID_PROCUREMENT_ITEMS');
console.log(`B6-A PURE POLICY CONTRACT: ${count}/${count} PASS (NO database operations)`);
