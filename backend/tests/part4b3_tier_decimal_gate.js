// B4-E: Fast, database-free guard for tier precision and contiguous discounts.
// Run once in the consolidated B4 gate; must not mutate miljor_db.
const assert = require('assert');
const tierPricingService = require('../src/services/tierPricingService');

const config = { supplier_min_qty: '2', target_qty: '10', max_capacity: '20', pool_unit: 'bag', purchase_increment: '1' };
const base = [
  { min_qty: '2', max_qty: '9', price_per_unit: '6500.00', pricing_unit: 'bag' },
  { min_qty: '10', max_qty: '20', price_per_unit: '6200.00', pricing_unit: 'bag' }
];
let count = 0;
const pass = name => { count++; console.log('PASS ' + count + ' - ' + name); };

const valid = tierPricingService.validateTiers(base, config);
assert.strictEqual(valid.valid, true, JSON.stringify(valid.error));
pass('Continuous discrete-pack boundary with a discount is valid');

const sameBoundary = tierPricingService.validateTiers([
  base[0], { ...base[1], min_qty: '9' }
], config);
assert.strictEqual(sameBoundary.valid, false);
assert.strictEqual(sameBoundary.error.code, 'OVERLAPPING_TIERS');
pass('Same endpoint belongs to earlier discrete tier; overlap rejected');

const badPrecision = tierPricingService.validateTiers([
  { ...base[0], min_qty: '2.00001' }, base[1]
], config);
assert.strictEqual(badPrecision.valid, false);
assert.strictEqual(badPrecision.error.code, 'INVALID_TIER_DECIMAL');
pass('Excess-precision tier quantity rejected before rounding');

const badPrice = tierPricingService.validateTiers([
  { ...base[0], price_per_unit: 'Infinity' }, base[1]
], config);
assert.strictEqual(badPrice.valid, false);
assert.strictEqual(badPrice.error.code, 'INVALID_TIER_DECIMAL');
pass('Nonfinite tier price rejected');

const missingQty = tierPricingService.validateTiers([
  base[0], { ...base[1], min_qty: '11' }
], config);
assert.strictEqual(missingQty.valid, false);
assert.strictEqual(missingQty.error.code, 'TIER_GAP_DETECTED');
pass('Gap in tier quantities rejected');

const increasingPrice = tierPricingService.validateTiers([
  base[0], { ...base[1], price_per_unit: '6800.00' }
], config);
assert.strictEqual(increasingPrice.valid, false);
assert.strictEqual(increasingPrice.error.code, 'NON_MONOTONIC_PRICING');
pass('Higher-volume tier cannot be more expensive');

// B4-E: Discrete-pack stepping (prevMax + 1) with non-unit purchase increment (e.g. 5)
const steppedDiscreteWithIncrement = tierPricingService.validateTiers([
  { min_qty: '10', max_qty: '49', price_per_unit: '5200.00', pricing_unit: 'bag' },
  { min_qty: '50', max_qty: '100', price_per_unit: '4900.00', pricing_unit: 'bag' }
], { supplier_min_qty: '10', target_qty: '50', max_capacity: '100', pool_unit: 'bag', purchase_increment: '5' });
assert.strictEqual(steppedDiscreteWithIncrement.valid, true, JSON.stringify(steppedDiscreteWithIncrement.error));
pass('Discrete-pack 1-unit step (49 -> 50) valid when purchase increment is 5');

console.log('B4 tier decimal contract: ' + count + '/' + count + ' PASS (source assertions; run locally to verify)');
