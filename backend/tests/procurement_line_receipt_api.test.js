'use strict';
// Real Express HTTP wiring with authentication/idempotency boundary doubles.
// This verifies route wiring, NOT JWT/DB middleware integration.
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const express=require('express');
const authPath=require.resolve('../src/middlewares/authGuard');
const idemPath=require.resolve('../src/middlewares/idempotencyGuard');
const calls=[];
require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{
 protect(req,res,next){if(!req.get('X-Test-Role'))return res.sendStatus(401);req.user={id:7,role:req.get('X-Test-Role')};next();},
 authorizeStrict(role){return (req,res,next)=>req.user.role===role?next():res.sendStatus(403);}
}};
require.cache[idemPath]={id:idemPath,filename:idemPath,loaded:true,exports:{required(req,res,next){
 if(!req.get('X-Idempotency-Key'))return res.sendStatus(400);next();
}}};
const service=require('../src/services/procurementLineReceiptService');
service.recordBuyerReceipt=async input=>{calls.push(input);if(input.orderId==='99')throw Object.assign(Error('private'),{code:'ORDER_NOT_FOUND',statusCode:404});return {receipt:{financial_status:'BLOCKED'}};};
service.getBuyerReceipts=async input=>{calls.push(input);return {order_id:Number(input.orderId),lines:[]};};
const app=express();app.use(express.json());app.use('/api/v1',require('../src/routes/v1/procurementLineReceiptRoutes'));
const server=app.listen(0,'127.0.0.1');
const ready=new Promise(resolve=>server.once('listening',resolve));
after(()=>new Promise(resolve=>server.close(resolve)));
async function request(method='POST',headers={},body={lines:[]},orderId=1){
 await ready;return fetch(`http://127.0.0.1:${server.address().port}/api/v1/procurement/orders/${orderId}/line-receipts`,{
 method,headers:{'Content-Type':'application/json',...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})});
}
test('HTTP receipt route binds actor, order, evidence and mandatory key',async()=>{
 const lines=[{award_line_id:4,received_quantity:'80',accepted_quantity:'80',disputed_quantity:'20'}];
 const response=await request('POST',{'X-Test-Role':'BUYER','X-Idempotency-Key':'abc'},{lines});
 assert.equal(response.status,200);assert.equal((await response.json()).data.receipt.financial_status,'BLOCKED');
 assert.deepEqual(calls.at(-1),{orderId:'1',actor:{id:7,role:'BUYER'},lines,feePolicy:undefined,idempotencyKey:'abc'});
});
test('HTTP anonymous, supplier, absent key and extra money fields rejected',async()=>{
 assert.equal((await request()).status,401);
 assert.equal((await request('POST',{'X-Test-Role':'SUPPLIER','X-Idempotency-Key':'abc'})).status,403);
 assert.equal((await request('POST',{'X-Test-Role':'BUYER'})).status,400);
 assert.equal((await request('POST',{'X-Test-Role':'BUYER','X-Idempotency-Key':'abc'},{lines:[],amount:123})).status,400);
});
test('HTTP GET and domain errors return expected shape',async()=>{
 const response=await request('GET',{'X-Test-Role':'BUYER'});assert.equal(response.status,200);
 assert.deepEqual((await response.json()).data,{order_id:1,lines:[]});
 assert.equal((await request('POST',{'X-Test-Role':'BUYER','X-Idempotency-Key':'abc'},{lines:[]},99)).status,404);
});
test('source retains legacy fail-closed guards and migration uniqueness/bounds',()=>{
 const root=path.join(__dirname,'..');
 for(const [file,guard] of [['disputeService.js','LINE_ITEM_DISPUTE_REQUIRED'],['financialSettlementService.js','LINE_ITEM_REFUND_ALLOCATION_REQUIRED'],['fulfillmentService.js','LINE_ITEM_RECEIPT_REQUIRED']])
  assert.ok(fs.readFileSync(path.join(root,'src/services',file),'utf8').includes(guard));
 const migration=fs.readFileSync(path.join(root,'database/migrations/097_procurement_line_receipts.sql'),'utf8');
 assert.match(migration,/UNIQUE KEY uq_final_award_line_receipt\(award_line_id\)/);
 assert.match(migration,/disputed_quantity=ordered_quantity-accepted_quantity/);
 assert.match(migration,/refund_assessment_amount<=subtotal/);
 assert.match(migration,/financial_status ENUM\('BLOCKED'\)/);
});
