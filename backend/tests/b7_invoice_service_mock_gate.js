'use strict';
// Actual B7 invoiceService code, deterministic in-memory DB adapter.
// Does NOT imply MySQL integration; checks real service/transaction paths.
const assert=require('node:assert/strict');
const dbPath=require.resolve('../src/config/db');
let mock;
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{
 query:(sql,params)=>mock.query(sql,params),
 getConnection:()=>mock.getConnection()
}};
const invoice=require('../src/services/invoiceService');
const orderBase={
 id:91,order_code:'MJQ-INVOICE-91',
 buyer_id:5,supplier_id:2,buyer_business_name:'Lahore Catering',
 buyer_email:'private@example.test',buyer_phone:'03001234567',
 supplier_business_name:'Test Wholesale',supplier_ntn:'12345',
 supplier_address:'Test warehouse',delivery_address:'Johar Town Lahore',
 notes:'SMART_PROCUREMENT_BASKET',payment_status:'PAID',
 subtotal_amount:'9200.00',delivery_fee:'150.00',
 buyer_platform_fee:'50.00',total_amount:'9400.00',currency:'PKR',
 total_qty:'1.0000',unit_price:'9200.00'
};
const awarded=[
 {id:11,request_item_id:10,supplier_sku_id:101,quantity:'100.0000',
 purchasing_unit:'kg',unit_price:'80.00',subtotal:'8000.00',
 immutable_sku_snapshot:JSON.stringify({title:'Rice Grade A'})},
 {id:12,request_item_id:12,supplier_sku_id:102,quantity:'2.0000',
 purchasing_unit:'tin',unit_price:'600.00',subtotal:'1200.00',
 immutable_sku_snapshot:JSON.stringify({title:'Oil 16L'})}
];
function makeDatabase(overrides={}){
 let order={...orderBase,...overrides};
 let lines=overrides.lines??awarded;
 const state={inserts:[],commits:0,rollbacks:0,queries:[],saved:null};
 const conn={
  async beginTransaction(){state.queries.push('BEGIN')},
  async commit(){state.commits++;state.queries.push('COMMIT')},
  async rollback(){state.rollbacks++;state.queries.push('ROLLBACK')},
  release(){},
  async query(sql,params){
   state.queries.push(sql);
   if(sql.includes('FROM orders o'))return [[order]];
   if(sql.includes('SELECT * FROM invoices WHERE order_id'))return [[]];
   if(sql.includes('FROM procurement_award_orders ao'))return [lines];
   if(sql.includes('INSERT INTO invoices')){
    state.inserts.push(params);
    state.saved={id:101,order_id:order.id,invoice_number:params[0],
      invoice_snapshot_json:params[10]??params[9]};
    return [{insertId:101}];
   }
   if(sql.includes('SELECT * FROM invoices WHERE id'))return [[state.saved]];
   throw Error('Unexpected SQL: '+sql.slice(0,90));
  }
 };
 return {state,conn,async getConnection(){return conn},query:(sql,args)=>conn.query(sql,args)};
}
async function run(){
 let n=0;
 const pass=label=>{n++;console.log('PASS '+n+': '+label)};
 mock=makeDatabase();
 const created=await invoice.generateInvoiceForOrder(91,{id:5,role:'BUYER'});
 assert.equal(created.order_id,91);
 assert.equal(mock.state.inserts.length,1);
 assert.equal(mock.state.commits,1);
 assert.equal(mock.state.rollbacks,0);
 pass('Actual invoiceService persists and commits owned PAID B6 supplier order');
 const snapshot=JSON.parse(mock.state.inserts[0][9]);
 assert.equal(snapshot.items.length,2);
 assert.equal(snapshot.items[0].quantity,'100.0000');
 assert.equal(snapshot.items[1].unit,'tin');
 pass('Real service serializes two separate immutable award SKU lines');
 assert.equal(snapshot.pricing.total_amount,9400);
 assert.equal(snapshot.pricing.delivery_fee,150);
 pass('Invoice includes authoritative locked commercial totals/fees');
 mock=makeDatabase({payment_status:'AWAITING_PAYMENT'});
 await assert.rejects(()=>invoice.generateInvoiceForOrder(91,{id:5,role:'BUYER'}),
  e=>e.code==='INVOICE_ORDER_NOT_PAID');
 assert.equal(mock.state.inserts.length,0);
 assert.equal(mock.state.rollbacks,1);
 pass('Unpaid B6 order rejected with transaction rollback before invoice insert');
 mock=makeDatabase();
 await assert.rejects(()=>invoice.generateInvoiceForOrder(91,{id:6,role:'BUYER'}),
  e=>e.code==='INVOICE_ACCESS_FORBIDDEN');
 assert.equal(mock.state.inserts.length,0);
 pass('Other buyer cannot generate private invoice');
 mock=makeDatabase({lines:[awarded[0]]});
 await assert.rejects(()=>invoice.generateInvoiceForOrder(91,{id:2,role:'SUPPLIER'}),
  e=>e.code==='AWARD_INVOICE_SUBTOTAL_MISMATCH');
 assert.equal(mock.state.rollbacks,1);
 assert.equal(mock.state.inserts.length,0);
 pass('Incomplete multi-item invoice fails closed and rolls back');
 mock=makeDatabase();
 await assert.rejects(()=>invoice.generateInvoiceForOrder(91,null),
  e=>e.code==='INVOICE_ACCESS_FORBIDDEN');
 assert.equal(mock.state.inserts.length,0);
 pass('Direct invoice issuance without authenticated caller is denied');
 console.log('B7 REAL INVOICE SERVICE (MOCK DB): '+n+'/'+n+' PASS');
}
run().then(()=>process.exit(0)).catch(e=>{console.error('B7 INVOICE SERVICE TEST FAILED:',e);process.exit(1)});
