'use strict';
// No-DB source guard; complements (never replaces) real MySQL+HTTP test.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const order=read('src/services/orderService.js');
const orderRoutes=read('src/routes/v1/orderRoutes.js');
const checkout=read('src/services/safepayCheckoutService.js');
const joins=order.match(/LEFT JOIN pools p ON o\.pool_id = p\.id/g)||[];
assert.equal(joins.length,2,'Both order listing and detail must include non-Regular-pool orders');
assert.ok(order.includes('o.buyer_id = ?')&&order.includes('o.supplier_id = ?'),
  'Buyer and supplier order listings must use tenant filter');
assert.ok(order.includes("actor.role === 'BUYER' && Number(order.buyer_id) !== Number(actor.id)")&&
  order.includes("actor.role === 'SUPPLIER' && Number(order.supplier_id) !== Number(actor.id)"),
  'Order detail must deny unrelated buyer/supplier');
assert.ok(orderRoutes.includes("authorizeStrict('BUYER')")&&orderRoutes.includes("idempotencyGuard.required"),
  'Checkout requires strict BUYER role and idempotency key');
assert.ok(checkout.includes('Number(order.buyer_id) !== Number(actor.id)'),
  'Safepay checkout must check real buyer ownership');
console.log('PASS P0 ALL ORDER ORIGINS SOURCE CONTRACT (source-only; real HTTP gate separate)');
