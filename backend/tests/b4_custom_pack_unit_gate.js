// B4-G: Fast pure unit-conversion contract. No database mutation.
const assert = require('assert');
const units = require('../src/services/unitConversionService');
const supplierSku = { pack_size: 37, pack_unit: 'kg', purchasing_unit: 'bundle', supplier_sku_id: 100 };
let passed = 0;
const ok = (label) => { passed++; console.log('PASS ' + passed + ': ' + label); };

assert.strictEqual(units.isDiscreteUnit('bundle'), true);
assert.strictEqual(units.isDiscreteUnit('kg'), false);
assert.strictEqual(units.isDiscreteUnit('L'), false);
ok('Custom physical bundle is indivisible; kg/L remain measurements');

assert.strictEqual(units.convertQuantity(2, 'bundle', 'kg', supplierSku), 74);
assert.strictEqual(units.convertQuantity(74, 'kg', 'bundle', supplierSku), 2);
ok('37kg supplier bundle converts correctly using its own published SKU identity');

assert.throws(() => units.convertQuantity(1, 'unrelated', 'kg', supplierSku), /Unsupported conversion/);
ok('Unrelated custom packaging terms cannot spoof SKU conversion');

const legacyBag = { pack_size: 25, pack_unit: 'kg', purchasing_unit: 'bag' };
assert.strictEqual(units.convertQuantity(2, 'pack', 'kg', legacyBag), 50);
ok('Historical global standard-pack conversion remains compatible');

console.log('B4 custom pack unit: ' + passed + '/' + passed + ' PASS (run locally for evidence)');
