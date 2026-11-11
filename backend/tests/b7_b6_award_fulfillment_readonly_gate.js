'use strict';
// REAL read-only B6 award -> fulfillment HTTP acceptance.
// Requires a pre-existing, disposable, VERIFIED-PAID B6 test fixture.
// Never creates payments, orders, invoices, disputes, or migrations.
const assert=require('node:assert/strict');
const http=require('node:http');
const jwt=require('jsonwebtoken');
const db=require('../src/config/db');
const app=require('../server');
let passed=0,server;
function pass(label,condition){assert.ok(condition,label);console.log('PASS '+(++passed)+': '+label)}
function blocked(reason){const e=new Error('B7_HTTP_BLOCKED: '+reason);e.code='B7_HTTP_BLOCKED';throw e;}
const ticket=async(url,token=null)=>{
 const res=await new Promise((resolve,reject)=>{
  const req=http.get(url,{headers:token?{Authorization:'Bearer '+token}:{}},response=>{
   let data='';response.on('data',x=>data+=x);
   response.on('end',()=>{
    let body={};try{body=JSON.parse(data)}catch{body={raw:data}}
    resolve({status:response.statusCode,body});
   });
  });
  req.on('error',reject);
 });
 return res;
};
async function main(){
 if(process.env.B7_ALLOW_READONLY_HTTP_TEST!=='YES')
  blocked('explicit B7_ALLOW_READONLY_HTTP_TEST=YES required');
 if(process.env.NODE_ENV!=='test'||process.env.TEST_DB_NAME!=='miljor_test_db')
  blocked('NODE_ENV=test and TEST_DB_NAME=miljor_test_db required');
 if(!process.env.JWT_SECRET)blocked('JWT_SECRET required');
 const oid=Number(process.env.B7_TEST_PAID_B6_ORDER_ID);
 if(!Number.isSafeInteger(oid)||oid<=0)blocked('B7_TEST_PAID_B6_ORDER_ID required');
 const [[identity]]=await db.query('SELECT DATABASE() AS n');
 if(identity.n!=='miljor_test_db')blocked('connected to an unexpected database');
 pass('Connected to disposable miljor_test_db',true);
 const [rows]=await db.query(
  `SELECT o.id,o.buyer_id,o.supplier_id,o.payment_status,o.notes,o.total_amount,
          (SELECT COUNT(*) FROM procurement_award_orders ao WHERE ao.order_id=o.id) AS award_orders
     FROM orders o WHERE o.id=?`,[oid]);
 if(rows.length!==1||rows[0].payment_status!=='PAID'||
    rows[0].notes!=='SMART_PROCUREMENT_BASKET'||Number(rows[0].award_orders)!==1)
  blocked('fixture must be one provider-verified PAID B6 supplier order');
 pass('Real paid B6 award-order association exists',true);
 const order=rows[0];
 const [users]=await db.query('SELECT id,role FROM users WHERE id IN (?,?)',
  [order.buyer_id,order.supplier_id]);
 if(!users.some(u=>u.id===order.buyer_id&&u.role==='BUYER')||
    !users.some(u=>u.id===order.supplier_id&&u.role==='SUPPLIER'))
  blocked('fixture buyer/supplier roles are invalid');
 const token=(id,role)=>jwt.sign({id,role},process.env.JWT_SECRET,
  {expiresIn:'5m',issuer:'miljor-api',audience:'miljor-app'});
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
 const root='http://127.0.0.1:'+server.address().port+'/api/v1/fulfillment/';
 const buyer=await ticket(root+'buyer/orders/'+oid,token(order.buyer_id,'BUYER'));
 const supplier=await ticket(root+'supplier/orders/'+oid,token(order.supplier_id,'SUPPLIER'));
 pass('Owning business buyer can read paid fulfillment',buyer.status===200&&buyer.body?.success===true);
 pass('Assigned supplier can read paid fulfillment',supplier.status===200&&supplier.body?.success===true);
 const ownLines=buyer.body?.data?.award_lines||[];
 const suppLines=supplier.body?.data?.award_lines||[];
 pass('Both authorized sides see same immutable SKU lines',
  ownLines.length>0&&JSON.stringify(ownLines)===JSON.stringify(suppLines));
 pass('Order basket marker not treated as actual physical quantity',
  ownLines.every(x=>Number(x.award_line_id)>0&&Number(x.quantity)>0&&x.purchasing_unit));
 const anonymous=await ticket(root+'buyer/orders/'+oid);
 pass('Anonymous read denied',anonymous.status===401);
 const otherId=Number(process.env.B7_TEST_UNRELATED_BUYER_ID);
 if(Number.isSafeInteger(otherId)&&otherId>0&&otherId!==order.buyer_id){
  const attacker=await ticket(root+'buyer/orders/'+oid,token(otherId,'BUYER'));
  pass('Unrelated buyer cannot access paid order or SKU detail',
   attacker.status===403||attacker.status===404);
 }else console.log('SKIP: no separate unrelated buyer test identity configured');
 const outsiderSupplierId=Number(process.env.B7_TEST_UNRELATED_SUPPLIER_ID);
 if(Number.isSafeInteger(outsiderSupplierId)&&outsiderSupplierId>0&&
    outsiderSupplierId!==order.supplier_id){
  const badSupplier=await ticket(root+'supplier/orders/'+oid,
    token(outsiderSupplierId,'SUPPLIER'));
  pass('Unrelated supplier cannot see awarded buyer SKU/order',
    badSupplier.status===403||badSupplier.status===404);
 }else console.log('SKIP: no separate unrelated supplier test identity configured');
 console.log('B7 READONLY B6 AWARD -> FULFILLMENT: '+passed+' assertions PASS; no mutations.');
}
main().catch(e=>{console.error('B7 HTTP GATE FAILED/BLOCKED:',e);process.exitCode=1})
 .finally(async()=>{
  if(server)await new Promise(resolve=>server.close(resolve));
  await db.end().catch(()=>{});
 });
