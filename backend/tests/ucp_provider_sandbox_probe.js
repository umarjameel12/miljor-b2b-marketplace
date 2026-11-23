'use strict';
// Actual sandbox initiation/readback only. Never invent a successful callback.
// Retain this order/attempt for reconciliation; no real charge/refund/payout.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.TEST_DB_NAME,'miljor_test_db');
assert.equal(process.env.DB_PORT,'33319');assert.equal(process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT,'false');
const config=require('dotenv').parse(fs.readFileSync(process.env.UCP_ORIGINAL_DB_CONFIG));
for(const key of ['SAFEPAY_PUBLIC_KEY','SAFEPAY_SECRET_KEY','SAFEPAY_WEBHOOK_SECRET'])process.env[key]=config[key]||'';
process.env.SAFEPAY_ENV='sandbox';
const db=require('../src/config/db'),checkout=require('../src/services/safepayCheckoutService'),adapter=require('../src/services/safepayAdapter');
async function main(){
 const evidence={timestamp:new Date().toISOString(),database:'miljor_test_db',port:33319,environment:'sandbox',syntheticCallback:false,actualPayment:'NOT_TESTED',refund:'NOT_TESTED'};
 try{
  assert.ok(adapter.publicKey&&adapter.secretKey,'Sandbox credentials missing');
  const tag=crypto.randomBytes(8).toString('hex');
  const [buyer]=await db.query("INSERT INTO users(full_name,email,role,is_verified,verification_status) VALUES ('Sandbox probe buyer',?,'BUYER',1,'VERIFIED')",['ucp-provider-'+tag+'@example.invalid']);
  const [supplier]=await db.query("INSERT INTO users(full_name,email,role) VALUES ('Sandbox probe supplier',?,'SUPPLIER')",['ucp-provider-supplier-'+tag+'@example.invalid']);
  const [order]=await db.query(`INSERT INTO orders(order_code,buyer_id,supplier_id,total_qty,unit_price,subtotal_amount,total_amount,currency,order_status)
   VALUES (?,?,?,1,100,100,100,'PKR','AWAITING_PAYMENT')`,['UCP-'+tag,buyer.insertId,supplier.insertId]);
  evidence.orderId=order.insertId;
  const result=await checkout.initiateCheckout({orderId:order.insertId,actor:{id:buyer.insertId,role:'BUYER'},idempotencyKey:'probe-'+tag});
  const [[attempt]]=await db.query('SELECT provider_tracker_token,checkout_url FROM payment_attempts WHERE order_id=? ORDER BY id DESC LIMIT 1',[order.insertId]);
  evidence.initiation='PASS';evidence.trackerHash=crypto.createHash('sha256').update(attempt.provider_tracker_token).digest('hex');
  fs.mkdirSync(path.resolve(__dirname,'../logs/ucp-provider'),{recursive:true});
  fs.writeFileSync(path.resolve(__dirname,'../logs/ucp-provider/checkout-private.json'),JSON.stringify({orderId:order.insertId,buyerId:buyer.insertId,checkoutUrl:attempt.checkout_url}));
  const fetched=await adapter.fetchTracker(attempt.provider_tracker_token);
  assert.equal(fetched.data.token,attempt.provider_tracker_token);
  evidence.independentReadback='PASS';evidence.providerState=String(fetched.data.state||'UNKNOWN');
  const reconciled=await checkout.reconcilePaymentWithProvider({orderId:order.insertId,actor:{id:buyer.insertId,role:'BUYER'}});
  evidence.reconciled=Boolean(reconciled.reconciled);evidence.status=reconciled.reconciled?'PAYMENT_VERIFIED':'INITIATED_PAYMENT_NOT_COMPLETED';
 }catch(error){evidence.status='BLOCKED';evidence.code=error.cause?.code||error.code||'PROVIDER_PROBE_FAILED';process.exitCode=1;}
 finally{
  fs.mkdirSync(path.resolve(__dirname,'../docs/evidence'),{recursive:true});
  fs.writeFileSync(path.resolve(__dirname,'../docs/evidence/ucp-provider-sandbox-2026-11-16.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence));await db.end();
 }
}
main();
