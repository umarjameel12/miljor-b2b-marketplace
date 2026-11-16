'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const exact = require('../src/services/exactDecimal');

async function main() {
  let profile = {supplier_id:7,verification_status:'VERIFIED',subscription_plan:'STARTER'};
  const plan = {plan_code:'GROWTH',monthly_price_pkr:'3500.00',max_active_listings:13,is_active:1};
  const attempts = [];
  let calls = 0, paidSubscriptionId = null, transactions = 0, issued = 0;
  const query = async (sql, params = []) => {
    if (sql.startsWith('SELECT supplier_id, verification_status')) return [[{...profile}]];
    if (sql.startsWith('SELECT supplier_id, subscription_plan')) return [[{...profile}]];
    if (sql.includes('WHERE supplier_id = ? AND idempotency_key = ? FOR UPDATE'))
      return [attempts.filter(a=>a.supplier_id===params[0]&&a.idempotency_key===params[1]).map(a=>({...a}))];
    if (sql.includes("status IN ('INITIATING','INITIATED','UNKNOWN')"))
      return [attempts.filter(a=>a.supplier_id===params[0]&&['INITIATING','INITIATED','UNKNOWN'].includes(a.status))];
    if (sql.includes('FROM subscription_plans WHERE plan_code = ? FOR UPDATE'))
      return [params[0]==='GROWTH'?[{...plan}]:[]];
    if (sql.includes('monthly_price_pkr, max_active_listings FROM subscription_plans'))
      return [[{...plan}]];
    if (sql.startsWith('INSERT INTO supplier_subscription_checkout_attempts')) {
      const a = {id: attempts.length+1,supplier_id:params[0],plan_code:params[1],amount_pkr:params[2],
        idempotency_key:params[3],currency:'PKR',status:'INITIATING',tracker_token:null,checkout_url:null};
      attempts.push(a);return [{insertId:a.id}];
    }
    if (sql.includes('UPDATE supplier_subscription_checkout_attempts SET status=\'INITIATED\'')) {
      const a=attempts.find(x=>x.id===params[2]);
      if (a.status!=='INITIATING')return [{affectedRows:0}];
      Object.assign(a,{status:'INITIATED',tracker_token:params[0],checkout_url:params[1]});
      return [{affectedRows:1}];
    }
    if (sql.includes("status='UNKNOWN'")) {attempts.find(a=>a.id===params[0]).status='UNKNOWN';return [{affectedRows:1}];}
    if (sql.startsWith('SELECT * FROM supplier_subscription_checkout_attempts WHERE id=?')) {
      return [attempts.filter(a=>a.id===params[0]&&a.supplier_id===params[1]).map(a=>({...a}))];
    }
    if (sql.startsWith('SELECT id, plan_code, amount_pkr, currency, status, checkout_url')) {
      return [attempts.filter(a=>a.supplier_id===params[0])];
    }
    if (sql.startsWith('INSERT INTO supplier_subscriptions')) {
      issued++;paidSubscriptionId=99; return [{insertId:99}];
    }
    if (sql.startsWith('UPDATE supplier_profiles SET subscription_plan=')) {
      profile.subscription_plan=params[0];return [{affectedRows:1}];
    }
    if (sql.includes("status='PAID',paid_subscription_id")) {
      attempts.find(a=>a.id===params[1]).status='PAID';return [{affectedRows:1}];
    }
    if (sql.startsWith('INSERT INTO system_audit_logs')) return [{insertId:1}];
    if (sql.startsWith('SELECT id,role FROM users WHERE id=?'))
      return [[{id:params[0],role:'SUPPLIER'}]];
    if (sql.includes('INSERT INTO procurement_notifications'))
      return [{insertId:1,affectedRows:1}];
    throw new Error('Unexpected SQL: '+sql.slice(0,140));
  };
  const connection = {query,beginTransaction:async()=>{transactions++;},
    commit:async()=>{},rollback:async()=>{},release:()=>{}};
  const db={query,getConnection:async()=>connection};
  let providerAmount='3500.00';
  let providerState='TRACKER_ENDED';
  let transactionStatus='SUCCESS';
  const adapter={
    createTracker:async input=>{calls++;assert.equal(input.amount,3500);return {trackerToken:'track_mock_01'};},
    constructCheckoutUrl:()=> 'https://sandbox.api.getsafepay.com/checkout/pay?beacon=track_mock_01',
    fetchTracker:async token=>({data:{token,state:providerState,currency:'PKR',amount:providerAmount,transaction:{id:'tx_mock',status:transactionStatus}}})
  };
  const source=fs.readFileSync(path.join(__dirname,'../src/services/supplierSubscriptionCheckoutService.js'),'utf8');
  const moduleStub={exports:{}};
  new Function('require','module','exports',source)(
    name=>name==='../config/db'?db:name==='./safepayAdapter'?adapter:
      name==='./exactDecimal'?exact:require(name),moduleStub,moduleStub.exports);
  const Service=moduleStub.exports.SupplierSubscriptionCheckoutService;
  const svc=new Service(db,adapter);
  const actor={id:7,role:'SUPPLIER'};
  const key='supplier-test-idem-00001';
  const oldEnv={SAFEPAY_ENV:process.env.SAFEPAY_ENV,ALLOW_EXTERNAL_MONEY_MOVEMENT:process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT};
  process.env.SAFEPAY_ENV='sandbox';process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT='false';
  try {
    await assert.rejects(()=>svc.start({actor:{id:7,role:'BUYER'},planCode:'GROWTH',idempotencyKey:key}),e=>e.code==='FORBIDDEN');
    await assert.rejects(()=>svc.start({actor,planCode:'GROWTH',idempotencyKey:'invalid'}),e=>e.code==='INVALID_IDEMPOTENCY_KEY');
    const started=await svc.start({actor,planCode:'GROWTH',idempotencyKey:key});
    assert.equal(started.attempt.status,'INITIATED');
    assert.equal(calls,1);
    const replay=await svc.start({actor,planCode:'GROWTH',idempotencyKey:key});
    assert.equal(replay.replay,true);
    assert.equal(calls,1);
    await assert.rejects(()=>svc.start({actor,planCode:'GROWTH',idempotencyKey:'supplier-test-idem-00002'}),e=>e.code==='CHECKOUT_ALREADY_PENDING');
    providerAmount='3500.01';
    await assert.rejects(()=>svc.reconcile({actor,attemptId:1}),e=>e.code==='AMOUNT_MISMATCH');
    assert.equal(profile.subscription_plan,'STARTER');
    assert.equal(issued,0);
    providerAmount='3500.00';
    providerState='TRACKER_PENDING';
    const pending=await svc.reconcile({actor,attemptId:1});
    assert.equal(pending.reconciled,false);
    assert.equal(profile.subscription_plan,'STARTER');
    providerState='TRACKER_ENDED';
    transactionStatus='FAILED';
    const declined=await svc.reconcile({actor,attemptId:1});
    assert.equal(declined.reconciled,false);
    assert.equal(profile.subscription_plan,'STARTER');
    transactionStatus='UNKNOWN';
    assert.equal((await svc.reconcile({actor,attemptId:1})).reconciled,false);
    assert.equal(profile.subscription_plan,'STARTER');
    transactionStatus='SUCCESS';
    await assert.rejects(()=>svc.reconcile({actor:{id:8,role:'SUPPLIER'},attemptId:1}),e=>e.code==='ATTEMPT_NOT_FOUND');
    const paid=await svc.reconcile({actor,attemptId:1});
    assert.equal(paid.reconciled,true);
    assert.equal(profile.subscription_plan,'GROWTH');
    assert.equal(paidSubscriptionId,99);
    assert.equal(issued,1);
    const again=await svc.reconcile({actor,attemptId:1});
    assert.equal(again.replay,true);
    assert.equal(issued,1);
    const list=await svc.list({actor});
    assert.equal(list.length,1);
    assert.equal(list[0].status,'PAID');
    assert.equal(list[0].tracker_token,undefined);
    console.log('SUPPLIER_SUBSCRIPTION_CHECKOUT_CONTRACT_PASS: ownership, idempotency, provider amount, pending state, paid activation, replay');
  } finally {
    for(const [key,value] of Object.entries(oldEnv)) {
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
