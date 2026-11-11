'use strict';
// Source-level contract preflight; no require('db'), no SQL, no writes.
// This gate intentionally does NOT claim schema or integrated HTTP readiness.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const order=read('src/services/orderService.js');
const fee=read('src/services/feeService.js');
const settle=read('src/services/financialSettlementService.js');
const ddl=read('docs/proposals/ORDER_SUPPLIER_COMMISSION_SNAPSHOT_MIGRATION_PROPOSAL.sql');
const collision=read('database/migrationCollisionGuard.js');
let pass=0;
const check=(label,fn)=>{fn();pass++;console.log('PASS: '+label);};
check('profile rate locked during order creation',()=>{
  assert.match(order,/calculateSupplierFeeExact\(\s*pool\.supplier_id, expectedSubtotalStr, connection, \{ lockProfile: true \}/);
  assert.match(fee,/options\.lockProfile \? ' FOR UPDATE' : ''/);
});
check('rate persisted on authoritative order insert',()=>{
  assert.match(order,/INSERT INTO orders \([\s\S]*?supplier_commission_percent,[\s\S]*?\) VALUES/);
  assert.match(order,/totalAmountStr,\s*lockedSupplierCommissionPercent,\s*deliveryType/);
});
check('immutable rate attached to created event',()=>{
  assert.match(order,/supplier_commission_percent: lockedSupplierCommissionPercent/);
});
check('settlement reads snapshotted rate rather than mutable profile',()=>{
  assert.match(settle,/o\.supplier_commission_percent AS locked_supplier_commission_percent/);
  assert.match(settle,/sp\.transaction_fee_percent AS current_supplier_commission_percent/);
  assert.match(settle,/const commissionPercent = order\.locked_supplier_commission_percent;/);
  assert.doesNotMatch(settle,/const commissionPercent = order\.transaction_fee_percent;/);
});
check('historical NULL snapshots never silently backfilled',()=>{
  assert.match(ddl,/ADD COLUMN supplier_commission_percent DECIMAL\(5,2\) NULL/);
  assert.doesNotMatch(ddl,/UPDATE orders SET/);
});
check('migration stop remains present',()=>{
  assert.match(collision,/MIGRATION_BRANCH_COLLISION_UNRESOLVED/);
  assert.ok(!fs.existsSync(path.join(root,'database/migrations/051_order_supplier_commission_snapshot.sql')));
});
console.log('Contract source checks:',pass,'PASS. DB migration/integration is still BLOCKED.');
