'use strict';
// Audits cross-module B6 award -> paid fulfillment -> immutable invoice
// boundaries WITHOUT database or payment calls. Source gate, NOT full E2E.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname,'..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');
const award = read('src/services/procurementAwardService.js');
const fulfillment = read('src/services/fulfillmentService.js');
const invoice = read('src/services/invoiceService.js');
const finance = read('src/services/financialSettlementService.js');
let passed=0;
const gate=(name,fn)=>{fn();passed++;console.log('PASS '+passed+': '+name)};
gate('award produces separately mapped procurement order references',()=>{
  assert.match(award,/procurement_award_orders/);
  assert.match(award,/procurement_award_lines/);
});
gate('awarded order stock is only committed after confirmed PAID',()=>{
  assert.match(award,/row\.payment_status==='PAID'/);
  assert.match(award,/status='COMMITTED'/);
});
gate('supplier order listing includes non-pool B6 orders',()=>{
  assert.match(fulfillment,/LEFT JOIN pools p ON o\.pool_id = p\.id/);
});
gate('supplier fulfillment is paid and owned',()=>{
  assert.match(fulfillment,/WHERE o\.supplier_id = \? AND o\.payment_status = 'PAID'/);
  assert.match(fulfillment,/Number\(order\.supplier_id\) !== Number\(actor\.id\)/);
});
gate('supplier reported delivery does not substitute for buyer acceptance',()=>{
  assert.match(fulfillment,/currentStatus !== 'SUPPLIER_DELIVERED'/);
  assert.match(fulfillment,/SET fulfillment_status = 'BUYER_CONFIRMED'/);
});
gate('unresolved disputes block receipt confirmation',()=>{
  assert.match(fulfillment,/UNRESOLVED_DISPUTE_EXISTS/);
});
gate('invoice uses immutable per-line B6 snapshots',()=>{
  assert.match(invoice,/procurement_award_lines/);
  assert.match(invoice,/immutable_sku_snapshot/);
});
gate('invoice rejects line subtotal mismatch',()=>{
  assert.match(invoice,/INVOICE_AMOUNT_MISMATCH/);
  assert.match(invoice,/exactDecimal\.exactDecimalSum\(awardLines\.map/);
});
gate('B6 aggregate receipt and partial refund are fail-closed',()=>{
  assert.match(fulfillment,/LINE_ITEM_RECEIPT_REQUIRED/);
  assert.match(finance,/LINE_ITEM_REFUND_ALLOCATION_REQUIRED/);
});
console.log('B6 FULFILLMENT + INVOICE SOURCE CONTRACT: '+passed+'/'+passed+' PASS; database/provider acceptance remains separate');
