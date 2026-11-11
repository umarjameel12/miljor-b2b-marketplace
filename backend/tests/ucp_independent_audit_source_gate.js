'use strict';
// UCP-3/4/5 independent audit source gate. Runnable without DB or network.
// Does NOT replace the final MySQL / API / Safepay / Vite acceptance gates.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const file=p=>fs.readFileSync(path.resolve(root,p),'utf8');
const ui=p=>file('../frontend/src/'+p);
let passed=0;
function check(ok,label){assert.ok(ok,label);passed++;console.log('PASS',label)}
const migrationFiles=fs.readdirSync(path.join(root,'database/migrations')).filter(p=>p.endsWith('.sql')&&!p.includes('rollback'));
const names=new Set();
for(const name of migrationFiles){
  const version=name.split('_')[0];
  check(!names.has(version),'Unique migration prefix: '+version);
  names.add(version);
}
for(const n of ['051_expand_canonical_product_families.sql','052_demand_requester_role.sql','053_regular_pool_payment_hold_deadlines.sql'])
  check(migrationFiles.includes(n),'Renumbered UCP migration present: '+n);
for(const n of ['046_expand_canonical_product_families.sql','047_demand_requester_role.sql','048_regular_pool_payment_hold_deadlines.sql'])
  check(!migrationFiles.includes(n),'Old colliding UCP filename retired: '+n);
const runner=file('database/runMigrations.js');
const manifest=file('database/migrationManifest.js');
check(manifest.includes('DUPLICATE_MIGRATION_VERSION')&&
      runner.includes('const manifest = scanMigrations()')&&
      runner.indexOf('const manifest = scanMigrations()') < runner.indexOf('mysql.createConnection'),
  'Global duplicate-prefix preflight BEFORE MySQL connection or DDL');
check(manifest.includes('MIGRATION_RENUMBERED_HISTORY_REQUIRES_RECONCILIATION')&&
      runner.includes('checkAppliedHistory(manifest,appliedRows,attemptRows)'),
  'Previously applied old UCP migrations cannot replay silently');
const flash=file('src/services/flashPoolService.js');
check(flash.includes(String.raw`/^\d{4}-\d{2}-\d{2}$/`),
  'Flash best-before validates actual ISO numeric dates');
check(!flash.includes(String.raw`/^\\d{4}-\\d{2}-\\d{2}$/`),
  'Flash does not use literal backslash-d regex');
check(flash.includes('FLASH_DELIVERY_AREA_UNAVAILABLE')&&flash.includes('BUYER_ADDRESS_NOT_VERIFIED'),
  'Flash verified Lahore delivery and supplier area check retained');
const buyer=ui('components/pools/BuyerPoolCard.jsx');
check(buyer.includes('holdState?.hold_expires_at')&&buyer.includes('holdClockExpired'),
  'Flash buyer uses correct hold expiry field and blocks stale payment action');
check(buyer.includes('checkoutKey.current')&&buyer.includes('purchaseKey.current'),
  'Flash checkout and B4 reservation retries are idempotent');
const regular=ui('components/RegularPaymentHoldCard.jsx');
check(regular.includes('checkoutKey.current'),'Regular Safepay checkout retries reuse key');
const orders=ui('pages/OrdersPage.jsx');
check(orders.includes('activeCommitmentCount')&&orders.includes('flashHolds.filter'),
  'B4/B5 buyer commitment counter excludes paid/cancelled records');
const discovery=file('src/services/unifiedPoolDiscoveryService.js');
check(!discovery.includes('procurement_collective_groups')&&!discovery.includes('procurement_awards'),
  'Buyer pool board does not fold B6 procurement entities into B4/B5');
const report=file('docs/MILJOR_UCP3_TO_UCP5_MASTER_IMPLEMENTATION_PLAN.md');
check(report.includes('B6 buyer-created RFQ'),'Business architecture retains B6 isolation');
console.log('UCP AUDIT SOURCE GATE:',passed,'PASS; runtime acceptance still BLOCKED');
