'use strict';
// Executes the actual invoice generation service using deterministic SQL
// fixtures. This is NOT a database, Safepay or PDF renderer acceptance test.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
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
  const trace={writes:0,commits:0,rollbacks:0,snapshot:null};
  const order={id:51,buyer_id:1,supplier_id:2,order_code:'B6-51',
    subtotal_amount:'2000.00',delivery_fee:'100.00',
    buyer_platform_fee:'50.00',total_amount:config.wrongTotal?'2200.00':'2150.00',
    total_qty:'15',unit_price:'0',currency:'PKR',
    buyer_business_name:'Buyer Store',supplier_business_name:'Supplier Alpha'};
  const lines=immutableLines.map(x=>({...x}));
  if(config.wrongLine)lines[0].subtotal='999.00';
  const conn={
    async query(sql,args){
      if(sql.includes('FROM orders o')&&sql.includes('FOR UPDATE'))return [[order]];
      if(sql.includes('FROM invoices WHERE order_id = ? FOR UPDATE'))return [[]];
      if(sql.includes('FROM procurement_award_lines'))return [lines];
      if(sql.includes('INSERT INTO invoices')){
        trace.snapshot=JSON.parse(args[9]);trace.writes++;return [{insertId:88}];
      }
      if(sql.includes('SELECT * FROM invoices WHERE id = ?'))
        return [[{id:88,invoice_snapshot_json:trace.snapshot}]];
      throw Error('Unexpected SQL: '+sql.slice(0,95));
    },
    async beginTransaction(){},
    async commit(){trace.commits++},
    async rollback(){trace.rollbacks++},
    release(){}
  };
  const m=new Module(path.join(root,'invoiceService.js'),module);
  m.filename=path.join(root,'invoiceService.js');
  const requireLocal=id=>{
    if(id==='../config/db')return {getConnection:async()=>conn};
    if(id==='./exactDecimal')return exact;
    return require(id);
  };
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
  const badGrand=fixture({wrongTotal:true});
  await assert.rejects(badGrand.service.generateInvoiceForOrder(51,{id:1,role:'BUYER'}),
    e=>e.code==='INVOICE_TOTAL_MISMATCH');
  assert.equal(badGrand.trace.writes,0);
  assert.equal(badGrand.trace.rollbacks,1);
  pass('Wrong grand total rejected before writing');
  const badLine=fixture({wrongLine:true});
  await assert.rejects(badLine.service.generateInvoiceForOrder(51,{id:1,role:'BUYER'}),
    e=>e.code==='INVOICE_LINE_AMOUNT_MISMATCH');
  assert.equal(badLine.trace.writes,0);
  assert.equal(badLine.trace.rollbacks,1);
  pass('Wrong award-line quantity price subtotal rejected before writing');
  console.log('B6 INVOICE EXACT SERVICE: '+n+'/'+n+' PASS (in-memory only)');
}
main().catch(e=>{console.error(e);process.exitCode=1});
