'use strict';
// Evidence inventory only: a source reference is not proof of transactional
// execution, recipient correctness, provider delivery, or full release coverage.
const fs=require('node:fs'),path=require('node:path');
const {definitions}=require('../src/services/ucpNotificationEventCatalog');
const root=path.resolve(__dirname,'..');
const excluded=new Set(['ucpNotificationEventCatalog.js','notificationEventPolicy.js']);
const files=['src/services','src/controllers'].flatMap(directory=>fs.readdirSync(path.join(root,directory))
 .filter(name=>name.endsWith('.js')&&!excluded.has(name)).map(name=>directory+'/'+name));
const source=files.map(file=>({file,text:fs.readFileSync(path.join(root,file),'utf8')}));
const aliases={
 'PAYMENT.CHECKOUT_CREATED':'PAYMENT_INITIATED','PAYMENT.CONFIRMED':'PAYMENT_VERIFIED','PAYMENT.FAILED':'PAYMENT_FAILED',
 'PAYMENT.INVOICE_ISSUED':'INVOICE_ISSUED','PAYMENT.REFUND_INITIATED':'REFUND_INITIATED','PAYMENT.REFUND_SUCCEEDED':'REFUND_COMPLETED',
 'PAYMENT.SETTLEMENT_ELIGIBLE':'SETTLEMENT_PENDING','PAYMENT.SETTLEMENT_SUCCEEDED':'SETTLEMENT_COMPLETED',
 'DISPUTE.OPENED':'DISPUTE_OPENED','DISPUTE.RESOLVED':'DISPUTE_RESOLVED',
 'FULFILLMENT.DISPATCHED':'OUT_FOR_DELIVERY','FULFILLMENT.SUPPLIER_MARKED_DELIVERED':'DELIVERY_REPORTED','FULFILLMENT.BUYER_ACCEPTED':'RECEIPT_CONFIRMED',
 'FULFILLMENT.PARTIAL_DELIVERY':'PARTIAL_DELIVERY','FULFILLMENT.DELIVERY_FAILED':'DELIVERY_FAILED','FULFILLMENT.ETA_CHANGED':'ETA_CHANGED'};
const rows=Object.keys(definitions).map(type=>{
 const tokens=[type,...(aliases[type]?[aliases[type]]:[])];
 const paths=source.filter(({text})=>tokens.some(token=>text.includes("'"+token+"'")||text.includes('"'+token+'"'))).map(({file})=>file);
 return {type,alias:aliases[type]||null,status:paths.length?'SOURCE_REFERENCE_REVIEW_REQUIRED':'NO_LITERAL_EMITTER_FOUND',paths};
});
const evidence={timestamp:new Date().toISOString(),catalogEvents:rows.length,
 sourceReferenced:rows.filter(row=>row.paths.length).length,unreferenced:rows.filter(row=>!row.paths.length).length,
 qualification:'Dynamic emission may need manual review. No literal emitter is an outstanding coverage finding, not a passing acceptance assertion. Full event/actor/version/causation and recipient matrix remains a release gate.',events:rows};
fs.writeFileSync(path.join(root,'docs/evidence/ucp-event-coverage-2026-11-16.json'),JSON.stringify(evidence,null,2));
console.log(JSON.stringify({catalogEvents:evidence.catalogEvents,sourceReferenced:evidence.sourceReferenced,unreferenced:evidence.unreferenced,qualification:evidence.qualification}));
