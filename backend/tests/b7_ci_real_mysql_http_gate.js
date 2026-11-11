'use strict';
// Real MySQL 8 + REAL Express HTTP B7 flow on disposable synthetic PAID B6
// award orders. This is NOT payment provider certification.
const assert=require('node:assert/strict');
const http=require('node:http');
const jwt=require('jsonwebtoken');
const db=require('../src/config/db');
const app=require('../server');
let server=null,count=0;
const pass=(name,ok)=>{assert.ok(ok,name);console.log('PASS '+(++count)+': '+name)};
const token=(id,role)=>jwt.sign({id,role,verification_status:'VERIFIED'},
 process.env.JWT_SECRET,{expiresIn:'1h',issuer:'miljor-api',audience:'miljor-app'});
async function request(root,method,path,identity=null,body=null,key=null){
 const data=body===null?null:JSON.stringify(body);
 const headers={};
 if(identity)headers.Authorization='Bearer '+token(identity.id,identity.role);
 if(data!==null){headers['Content-Type']='application/json';headers['Content-Length']=Buffer.byteLength(data)}
 if(key)headers['X-Idempotency-Key']=key;
 return await new Promise((resolve,reject)=>{
  const req=http.request(root+path,{method,headers},res=>{
   let raw='';res.on('data',c=>raw+=c);res.on('end',()=>{
    try{resolve({status:res.statusCode,body:JSON.parse(raw)})}
    catch{resolve({status:res.statusCode,body:{raw}})}
   });
  });req.on('error',reject);if(data)req.write(data);req.end();
 });
}
async function main(){
 const requireEnv={GITHUB_ACTIONS:'true',B7_CI_EPHEMERAL_DB:'YES',
  NODE_ENV:'test',TEST_DB_NAME:'miljor_test_db',DB_NAME:'miljor_test_db'};
 for(const [k,v] of Object.entries(requireEnv))
  if(process.env[k]!==v)throw Error('B7_HTTP_GUARD: '+k);
 const [[identity]]=await db.query('SELECT DATABASE() AS db_name');
 if(identity.db_name!=='miljor_test_db')throw Error('B7_WRONG_DB');
 const [orders]=await db.query(
  `SELECT id,order_code,fulfillment_status,payment_status
   FROM orders WHERE order_code LIKE 'B7-CI-%' AND notes='SMART_PROCUREMENT_BASKET'
   ORDER BY id DESC LIMIT 2`);
 if(orders.length!==2||orders.some(o=>o.payment_status!=='PAID'))
  throw Error('B7_CI_SYNTHETIC_FIXTURES_MISSING');
 const [before]=await db.query(
  'SELECT order_id,amount,status,escrow_status FROM payments WHERE order_id IN (?,?) ORDER BY order_id',
  orders.map(o=>o.id));
 const [lines]=await db.query(
  `SELECT ao.order_id,l.id,l.quantity,l.purchasing_unit
     FROM procurement_award_orders ao JOIN procurement_award_lines l ON l.award_order_id=ao.id
     WHERE ao.order_id IN (?,?)`,orders.map(o=>o.id));
 if(lines.length!==2)throw Error('B7_FK_AWARD_LINES_MISSING');
 server=await new Promise(done=>{let s=app.listen(0,'127.0.0.1',()=>done(s))});
 const root='http://127.0.0.1:'+server.address().port;
 const buy={id:5,role:'BUYER'},supp={id:2,role:'SUPPLIER'},
 otherBuy={id:6,role:'BUYER'},otherSupp={id:3,role:'SUPPLIER'};
 let second=orders[0],first=orders[1];
 const endpoint=(role,id)=>'/api/v1/fulfillment/'+role+'/orders/'+id;
 for(const o of orders){
  const buyer=await request(root,'GET',endpoint('buyer',o.id),buy);
  const supplier=await request(root,'GET',endpoint('supplier',o.id),supp);
  pass('Real HTTP buyer owns paid B6 awarded order '+o.id,
   buyer.status===200&&buyer.body.data?.award_lines?.length===1);
  pass('Real HTTP supplier sees same physical supplier SKU order '+o.id,
   supplier.status===200&&supplier.body.data?.award_lines?.length===1);
  const unrelated=await request(root,'GET',endpoint('buyer',o.id),otherBuy);
  pass('Other buyer IDOR denied',unrelated.status===403||unrelated.status===404);
  const unrelatedSupplier=await request(root,'GET',endpoint('supplier',o.id),otherSupp);
  pass('Other supplier IDOR denied',unrelatedSupplier.status===403||unrelatedSupplier.status===404);
  const noAuth=await request(root,'GET',endpoint('buyer',o.id));
  pass('Anonymous fulfillment access denied',noAuth.status===401);
 }
 // Synthetic payment rows never imply real provider verification.
 for(const o of orders){
  for(const to of ['PREPARING','READY_FOR_DISPATCH','DISPATCHED','SUPPLIER_DELIVERED']){
   const key='B7-REAL-HTTP-'+o.id+'-'+to;
   const payload={to_status:to};
   if(to==='DISPATCHED'){
    payload.delivery_method='SUPPLIER_FLEET';
    payload.supplier_delivery_reference='B7-CI-TEST-DELIVERY';
   }
   const res=await request(root,'POST',endpoint('supplier',o.id)+'/transition',supp,payload,key);
   pass('Supplier real MySQL transaction '+o.id+' -> '+to,
    res.status===200&&res.body.success===true);
  }
 }
 const invoice=await request(root,'GET','/api/v1/invoices/'+first.id,buy);
 pass('Buyer creates own persisted paid supplier-specific invoice',
  invoice.status===200&&invoice.body.data?.invoice?.id>0);
 const [invoices]=await db.query('SELECT invoice_snapshot_json FROM invoices WHERE order_id=?',[first.id]);
 let snapshot=invoices[0]?.invoice_snapshot_json;
 if(typeof snapshot==='string')snapshot=JSON.parse(snapshot);
 pass('Invoice uses real immutable award physical SKU quantity',
  snapshot?.items?.length===1&&String(snapshot.items[0].quantity)==='100.0000');
 const confirmed=await request(root,'POST',endpoint('buyer',first.id)+'/confirm-receipt',
  buy,{notes:'Received all supplier order goods and verified.'},'B7-REAL-BUYER-CONFIRM-'+first.id);
 pass('Buyer independently confirms complete supplier delivery',
  confirmed.status===200&&confirmed.body.success===true);
 const line=lines.find(x=>x.order_id===second.id);
 const payload={order_id:second.id,category:'SHORT_QUANTITY',
  description:'Received only 80 bags from the awarded 100 bags of supplier rice.',
  evidence_metadata:{award_line_id:line.id,received_quantity:'80.0000'}};
 const dispute=await request(root,'POST','/api/v1/disputes',buy,payload,
  'B7-REAL-SHORTAGE-'+second.id);
 pass('Buyer creates real physical SKU shortage dispute',dispute.status===201&&dispute.body.success===true);
 const [claims]=await db.query(
  'SELECT claimed_amount,disputed_quantity,evidence_metadata FROM order_disputes WHERE order_id=?',
  [second.id]);
 pass('Database persists 20 unit shortage, exact Rs1600 claim',
  claims.length===1&&Number(claims[0].disputed_quantity)===20&&Number(claims[0].claimed_amount)===1600);
 const [latest]=await db.query(
  'SELECT id,fulfillment_status FROM orders WHERE id IN (?,?)',orders.map(o=>o.id));
 pass('Dispute does not impersonate buyer receipt',
  latest.find(x=>x.id===second.id)?.fulfillment_status==='EXCEPTION'&&
  latest.find(x=>x.id===first.id)?.fulfillment_status==='BUYER_CONFIRMED');
 const [after]=await db.query(
  'SELECT order_id,amount,status,escrow_status FROM payments WHERE order_id IN (?,?) ORDER BY order_id',
  orders.map(o=>o.id));
 pass('No payment, escrow or supplier amount changed during fulfillment/dispute',
  JSON.stringify(before)===JSON.stringify(after));
 const [privateEvents]=await db.query(
  'SELECT recipient_id,recipient_role,payload FROM procurement_notifications WHERE event_key LIKE ?',
  ['B7:%']);
 pass('Pool-less B6 fulfillment/disputes emit private transactional notifications',
  privateEvents.length>=6);
 console.log('B7 REAL MYSQL 8 HTTP SYNTHETIC PAID: '+count+'/'+count+' PASS; NOT SAFEpay provider verification');
}
main().catch(e=>{console.error('B7_REAL_MYSQL_HTTP_FAIL',e.stack||e);process.exitCode=1})
 .finally(async()=>{if(server)await new Promise(done=>server.close(done));await db.end().catch(()=>{})});
