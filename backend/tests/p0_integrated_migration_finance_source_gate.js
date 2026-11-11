'use strict';
// Read-only source assertions. This gate never opens a database or Safepay.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const regular=read('src/services/orderService.js');
const flash=read('src/services/flashPoolService.js');
const smart=read('src/services/procurementAwardService.js');
const fee=read('src/services/feeService.js');
const settlement=read('src/services/financialSettlementService.js');
const runner=read('database/runMigrations.js');
const snap=read('database/migrations/052_order_supplier_commission_snapshot.sql');
const {migrationManifest}=require('../database/runMigrations');
const manifest=migrationManifest();
const byVersion=new Map(manifest.map(x=>[x.version,x.file]));
for(const [v,name] of [
  ['046','046_recurring_collective_cycles.sql'],
  ['047','047_procurement_delivery_runs.sql'],
  ['048','048_procurement_notification_outbox.sql'],
  ['049','049_regular_pool_payment_hold_deadlines.sql'],
  ['050','050_expand_canonical_product_families.sql'],
  ['051','051_demand_requester_role.sql'],
  ['052','052_order_supplier_commission_snapshot.sql']
])assert.equal(byVersion.get(v),name);
assert.match(runner,/selectedDb !== 'miljor_test_db'/);
assert.match(runner,/MILJOR_RECONCILED_MIGRATION_TEST_APPROVED/);
assert.match(fee,/options\\.lockProfile\\s*\\?\\s*' FOR UPDATE'/);
assert.match(regular,/supplier_commission_percent/);
assert.match(regular,/calculateSupplierFeeExact\(\s*pool.supplier_id, expectedSubtotalStr, connection, \{ lockProfile: true \}/);
assert.match(flash,/supplier_commission_percent/);
assert.match(flash,/calculateSupplierFeeExact\(\s*offer.supplier_id, subtotal, conn, \{ lockProfile: true \}/);
assert.match(smart,/supplier_commission_percent/);
assert.match(smart,/this._money\(conn,preview,true\)/);
assert.match(smart,/lockProfile:lockSupplierRates/);
assert.match(settlement,/o.supplier_commission_percent AS locked_supplier_commission_percent/);
assert.match(settlement,/const commissionPercent = order.locked_supplier_commission_percent/);
assert.doesNotMatch(settlement,/const commissionPercent = order.transaction_fee_percent/);
assert.match(snap,/ADD COLUMN supplier_commission_percent DECIMAL\(5,2\) NULL/);
assert.doesNotMatch(snap,/UPDATE orders SET/);
// Count placeholders versus parameters in each order INSERT manually during
// integration review; do not rely on this test as a substitute for SQL execution.
console.log('PASS: staged 046-052 manifest and 3 order creators use immutable supplier commission snapshot.');
