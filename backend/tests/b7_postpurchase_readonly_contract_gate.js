'use strict';
// READ-ONLY B7 postpurchase boundary inventory. Does not connect to MySQL.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
let passed=0;
function check(name,fn){fn();passed++;console.log('PASS '+passed+': '+name)}
const fulfillmentRoutes=read('src/routes/v1/fulfillmentRoutes.js');
const fulfill=read('src/services/fulfillmentService.js');
const disputeRoutes=read('src/routes/v1/disputeRoutes.js');
const invoice=read('src/services/invoiceService.js');
const marketplaceRoutes=read('src/routes/v1/marketplaceOperationsRoutes.js');
const g2=read('tests/part_g2_delivery_integration_gate.js');
check('Supplier transition route already exists',()=>assert.match(fulfillmentRoutes,/\/supplier\/orders\/:id\/transition/));
check('Supplier exception route already exists',()=>assert.match(fulfillmentRoutes,/\/supplier\/orders\/:id\/exception/));
check('Buyer receipt confirmation route already exists',()=>assert.match(fulfillmentRoutes,/\/buyer\/orders\/:id\/confirm-receipt/));
check('Buyer discrepancy route already exists',()=>assert.match(fulfillmentRoutes,/\/buyer\/orders\/:id\/report-discrepancy/));
check('Supplier transitions are paid-order scoped',()=>assert.match(fulfill,/payment_status\s*=\s*'PAID'/));
check('Buyer receipt is distinct from supplier delivery',()=>assert.match(fulfill,/async confirmBuyerReceipt\(/));
check('Dispute submission endpoint already exists',()=>assert.match(disputeRoutes,/router\.post\(\s*'\/'/));
check('Supplier shortage endpoint already exists',()=>assert.match(disputeRoutes,/\/supplier\/shortage/));
check('Invoice is service-authorized',()=>assert.match(invoice,/INVOICE_ACCESS_FORBIDDEN/));
check('Invoice uses order-backed data',()=>assert.match(invoice,/FROM orders o/));
check('Invoice retrieval endpoint already exists',()=>assert.match(marketplaceRoutes,/\/invoices\/:orderId/));
check('Unsafe legacy G2 broad fixture deletion is detected (do not execute on shared DB)',()=>
  assert.match(g2,/DELETE FROM delivery_quotes/));
console.log('B7 READ-ONLY CONTRACT INVENTORY: '+passed+'/'+passed+' source assertions PASS');
console.log('Not proof of integration, security, payment or production readiness.');
