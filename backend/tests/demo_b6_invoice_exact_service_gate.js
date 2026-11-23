'use strict';
// Executes the actual invoice generation service using deterministic SQL
// fixtures. This is NOT a database, Safepay or PDF renderer acceptance test.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const crypto=require('node:crypto');
const exact=require('../src/services/exactDecimal');
const root=path.resolve(__dirname,'../src/services');
const source=fs.readFileSync(path.join(root,'invoiceService.js'),'utf8');
const immutableLines=[
  {request_item_id:1,supplier_sku_id:5,quantity:'10',purchasing_unit:'bag',
    unit_price:'100.00',subtotal:'1000.00',
    immutable_sku_snapshot:JSON.stringify({product_title:'Rice A'})},
  {request_item_id:2,supplier_sku_id:6,quantity:'5',purchasing_unit:'tin',
    unit_price:'200.00',subtotal:'1000.00',
    immutable_sku_snapshot:JSON.stringify({product_title:'Cooking Oil B'})}
];
function fixture(config={}){
  const trace={writes:0,commits:0,rollbacks:0,snapshot:null,notices:[],attempts:0,releases:0};
  let active=false,staged=[],invoice=config.replay?{id:88,order_id:51}:null;
  const order={id:51,buyer_id:1,supplier_id:2,order_code:'B6-51',
    subtotal_amount:'2000.00',delivery_fee:'100.00',
    buyer_platform_fee:'50.00',total_amount:config.wrongTotal?'2200.00':'2150.00',
    total_qty:'15',unit_price:'0',currency:'PKR',
    buyer_business_name:'Buyer Store',supplier_business_name:'Supplier Alpha'};
  const lines=immutableLines.map(x=>({...x}));
  if(config.wrongLine)lines[0].subtotal='999.00';
  const conn={
    async query(sql,args){
      if(sql === 'SELECT id,buyer_id,supplier_id FROM orders WHERE id=?')return [[order]];
      if(sql === 'SELECT id,role FROM users WHERE id=?')return [[{id:args[0],role:config.wrongRole?'ADMIN':args[0]===1?'BUYER':'SUPPLIER'}]];
      if(sql.includes('INSERT INTO procurement_notifications')){
        assert.equal(active,true);assert.equal(trace.writes,1);assert.equal(trace.commits,0);
        if(++trace.attempts===config.failNotice)throw Error('outbox failed');
        staged.push(args);return [{affectedRows:1}];
      }
      if(sql.includes('FROM orders o'))return [[order]];
      if(sql.includes('FROM invoices WHERE order_id = ?'))return [invoice?[invoice]:[]];
      if(sql.includes('FROM procurement_award_lines'))return [lines];
      if(sql.includes('INSERT INTO invoices')){
        if(config.failInsert)throw Error('invoice insert failed');
        trace.snapshot=JSON.parse(args[9]);trace.writes++;invoice={id:88,order_id:51,invoice_snapshot_json:trace.snapshot};return [{insertId:88}];
      }
      if(sql.includes('SELECT * FROM invoices WHERE id = ?'))
        return [[{id:88,invoice_snapshot_json:trace.snapshot}]];
      throw Error('Unexpected SQL: '+sql.slice(0,95));
    },
    async beginTransaction(){active=true;staged=[];},
    async commit(){if(config.failCommit)throw Error('commit failed');trace.commits++;trace.notices.push(...staged);staged=[];active=false;},
    async rollback(){trace.rollbacks++;invoice=null;staged=[];trace.writes=0;active=false;},
    release(){trace.releases++;}
  };
  const m=new Module(path.join(root,'invoiceService.js'),module);
  m.filename=path.join(root,'invoiceService.js');
  const requireLocal=id=>{
    if(id==='../config/db')return {getConnection:async()=>conn,query:(...args)=>conn.query(...args)};
    if(id==='./exactDecimal')return exact;
    if(id==='./ucpTransactionalNotifications')return adapter;
    throw Error('Unexpected invoice dependency: '+id);
  };
  const notificationModule={exports:{}};
  const adapterModule={exports:{}};
  const isolatedRequire=id=>{
    if(id==='../config/db')return {};
    if(id==='node:crypto')return crypto;
    if(id==='./notificationService')return notificationModule.exports;
    if(['./ucpNotificationEventCatalog','./notificationEventPolicy','./notificationDeliveryPolicy'].includes(id))return require(path.join(root,id));
    throw Error('Unexpected writer dependency: '+id);
  };
  new Function('require','module','exports',fs.readFileSync(path.join(root,'notificationService.js'),'utf8'))(isolatedRequire,notificationModule,notificationModule.exports);
  new Function('require','module','exports',fs.readFileSync(path.join(root,'ucpTransactionalNotifications.js'),'utf8'))(isolatedRequire,adapterModule,adapterModule.exports);
  const adapter=adapterModule.exports;
  new Function('require','module','exports',source)(requireLocal,m,m.exports);
  return {service:m.exports,trace};
}
async function main(){
  let n=0;const pass=name=>console.log('PASS '+(++n)+': '+name);
  const valid=fixture();
  const generated=await valid.service.generateInvoiceForOrder(51,{id:1,role:'BUYER'});
  assert.equal(generated.id,88);
  assert.equal(valid.trace.writes,1);
  assert.equal(valid.trace.commits,1);
  assert.equal(valid.trace.snapshot.items.length,2);
  assert.equal(valid.trace.snapshot.items[0].description,'Rice A');
  assert.equal(valid.trace.snapshot.items[1].description,'Cooking Oil B');
  assert.equal(valid.trace.snapshot.pricing.total_amount,2150);
  pass('Two-line supplier invoice exact 2000+100+50=2150');
  const key='PAYMENT.INVOICE_ISSUED:'+crypto.createHash('sha256').update(JSON.stringify(['order-51',1,'invoice-88'])).digest('hex');
  assert.deepEqual(valid.trace.notices.map(n=>n.slice(0,4)),[
    [1,'BUYER',key,'PAYMENT.INVOICE_ISSUED'],[2,'SUPPLIER',key,'PAYMENT.INVOICE_ISSUED']]);
  for(const notice of valid.trace.notices)assert.deepEqual(JSON.parse(notice[4]),{entityId:51,schemaVersion:1});
  pass('Canonical invoice notice commits with invoice for persisted owners only');
  await valid.service.generateInvoiceForOrder(51,{id:2,role:'SUPPLIER'});
  assert.equal(valid.trace.notices.length,2);assert.equal(valid.trace.writes,1);
  pass('Repeated generation emits no additional invoice notice');
  const replay=fixture({replay:true});
  await replay.service.generateInvoiceForOrder(51,{id:1,role:'BUYER'});
  assert.equal(replay.trace.notices.length,0);assert.equal(replay.trace.writes,0);
  pass('Existing invoice replay emits nothing');
  const fastReplay=fixture({replay:true});
  assert.equal((await fastReplay.service.getInvoiceByOrderId(51,1,'BUYER')).id,88);
  assert.equal(fastReplay.trace.attempts,0);assert.equal(fastReplay.trace.commits,0);
  await assert.rejects(fastReplay.service.getInvoiceByOrderId(51,999,'BUYER'),e=>e.code==='INVOICE_ACCESS_FORBIDDEN');
  assert.equal(fastReplay.trace.attempts,0);
  pass('Retrieval replay and unauthorized retrieval emit nothing');
  for(const caller of [{id:999,role:'BUYER'},{id:998,role:'SUPPLIER'},null]){
    const h=fixture();
    await assert.rejects(h.service.generateInvoiceForOrder(51,caller),e=>e.code==='INVOICE_ACCESS_FORBIDDEN');
    assert.equal(h.trace.writes,0);assert.equal(h.trace.attempts,0);assert.equal(h.trace.commits,0);
  }
  pass('Unauthorized callers create neither invoice nor notice');
  const admin=fixture();
  await admin.service.generateInvoiceForOrder(51,{id:500,role:'ADMIN'});
  assert.deepEqual(admin.trace.notices.map(n=>n[0]),[1,2]);
  pass('Admin issuance still notifies only persisted order owners');
  for(const config of [{failNotice:1},{failNotice:2},{failCommit:true},{failInsert:true},{wrongRole:true}]){
    const h=fixture(config);
    await assert.rejects(h.service.generateInvoiceForOrder(51,{id:1,role:'BUYER'}),/outbox failed|commit failed|invoice insert failed|NOTIFICATION_RECIPIENT_ROLE_MISMATCH/);
    assert.equal(h.trace.notices.length,0);assert.equal(h.trace.writes,0);
    assert.equal(h.trace.rollbacks,1);assert.equal(h.trace.commits,0);assert.equal(h.trace.releases,1);
  }
  pass('Insert, recipient, outbox and commit failures roll back invoice and all notices');
  const badGrand=fixture({wrongTotal:true});
  await assert.rejects(badGrand.service.generateInvoiceForOrder(51,{id:1,role:'BUYER'}),
    e=>e.code==='INVOICE_TOTAL_MISMATCH');
  assert.equal(badGrand.trace.writes,0);
  assert.equal(badGrand.trace.rollbacks,1);
  assert.equal(badGrand.trace.attempts,0);
  pass('Wrong grand total rejected before writing');
  const badLine=fixture({wrongLine:true});
  await assert.rejects(badLine.service.generateInvoiceForOrder(51,{id:1,role:'BUYER'}),
    e=>e.code==='INVOICE_LINE_AMOUNT_MISMATCH');
  assert.equal(badLine.trace.writes,0);
  assert.equal(badLine.trace.rollbacks,1);
  assert.equal(badLine.trace.attempts,0);
  pass('Wrong award-line quantity price subtotal rejected before writing');
  console.log('B6 INVOICE EXACT SERVICE: '+n+'/'+n+' PASS (in-memory only)');
}
main().catch(e=>{console.error(e);process.exitCode=1});
