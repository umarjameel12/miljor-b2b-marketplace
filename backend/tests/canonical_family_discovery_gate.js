// Canonical catalog migration regression: run with node tests/canonical_family_discovery_gate.js
// Source-only checks; database migration and runtime integration are separate gates.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const pools = read('frontend/src/pages/PoolsPage.jsx');
const migration = read('backend/database/migrations/046_expand_canonical_product_families.sql');
const legacy = read('backend/database/migrations/033_canonical_catalog_and_moderation.sql');
const catalog = read('frontend/src/api/catalog.js');
assert.match(pools, /catalogApi\.getFamilies\(\)/);
assert.match(pools, /catalogApi\.getCategories\(\)/);
assert.match(pools, /filteredFamilies\.map/);
assert.doesNotMatch(pools, /16 Staple Specifications|16 Authoritative|productsApi|filteredProducts|prod\.brand|prod\.moq_buyer/);
assert.match(pools, /family\.urdu_name/); // Optional display alias, not separate product.
assert.match(pools, /family\.category_id/);
assert.match(pools, /family\.aliases/);
assert.match(catalog, /\/catalog\/families/);
assert.match(legacy, /Seed initial 13 canonical product families/);
const codes = [
  'FAM-TEA','FAM-SALT','FAM-RED-CHILLI','FAM-TURMERIC','FAM-CORIANDER',
  'FAM-CUMIN','FAM-CORN-STARCH','FAM-BAKING-POWDER','FAM-YEAST',
  'FAM-MILK-POWDER','FAM-BLACK-PEPPER','FAM-WHEAT-GRAIN'
];
for (const code of codes) assert.ok(migration.includes("'" + code + "'"), code);
assert.match(migration, /ON DUPLICATE KEY UPDATE id = id/);
assert.doesNotMatch(migration, /DELETE FROM|DROP TABLE|UPDATE supplier_listings|UPDATE pools|UPDATE orders/i);
console.log('PASS: canonical family discovery source regression (25-family migration + legacy isolation)');
