'use strict';
// Offline refund evidence gate: actual refund service code, real exactDecimal
// module, fake Safepay signature verifier and fake SQL transactions. NO MySQL,
// Safepay network calls, migrations, or real refunds.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const exact=require('../src/services/exactDecimal');
let signatureValid=true,reply,queries=[];
const adapter={verifyWebhookSignature:()=>signatureValid};
const db={getConnection:async()=>({
  beginTransaction:async()=>queries.push(['BEGIN']),
  commit:async()=>queries.push(['COMMIT']),
  rollback:async()=>queries.push(['ROLLBACK']),
  release:()=>{},
  query:async(sql,params=[])=>{queries.push([sql,params]);return reply(sql,params);}
})};
const financial={_logAuditEvent:async()=>{queries.push(['AUDIT']);}};
const moduleRef={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,
  '../src/services/safepayRefundWebhookService.js'),'utf8'),{
  require(name){
    if(name==='../config/db')return db;
    if(name==='./exactDecimal')return exact;
    if(name==='./safepayAdapter')return adapter;
    if(name==='./financialSettlementService')return financial;
    throw Error('Forbidden module '+name);
  },
  module:moduleRef,exports:moduleRef.exports,
  Buffer,console
},{timeout:5000});
const svc=moduleRef.exports;
const goodEvent=(data={})=>Buffer.from(JSON.stringify({
  token:'evt_REFUND_123456789',type:'payment.refunded',
  data:{tracker:'track_abcdefgh1234',currency:'PKR',
    state:'TRACKER_PARTIAL_REFUND',refund_amount:1000,
    metadata:{order_id:'ORD-12'},...data}
}));
const original={
  attempt:{id:2,order_id:12,status:'COMPLETED'},
  order:{id:12,order_code:'ORD-12',payment_status:'PAID'},
  payment:{id:3,amount:'100.00',status:'PAID'},
  approved:[{id:4,total_refund_amount:'10.00',status:'APPROVED'}],
  confirmed:'0.00',existing:[]
};
let state;
function reset(){
  signatureValid=true;queries=[];state=JSON.parse(JSON.stringify(original));
  reply=async(sql)=>{
    if(sql.includes('FROM payment_attempts'))return [[state.attempt]];
    if(sql.includes('FROM orders'))return [[state.order]];
    if(sql.includes('FROM payment_webhook_events'))return [state.existing];
    if(sql.includes('FROM payments'))return [[state.payment]];
    if(sql.includes('FROM refund_obligations')&&sql.includes("status='APPROVED'"))
      return [state.approved];
    if(sql.includes('FROM refund_obligations')&&sql.includes("status='CONFIRMED'"))
      return [[{confirmed_amount:state.confirmed}]];
    if(sql.includes('INSERT INTO')||sql.includes('UPDATE'))return [{affectedRows:1}];
    throw Error('Unexpected SQL '+sql);
  };
}
let scenarios=0;
async function verify(label,expected,setup=()=>{},raw=goodEvent()){
  reset();setup();
  if(expected==='SUCCESS'){
    const response=await svc.receive({rawBody:raw,signature:'signed'});
    assert.equal(response.status,'PROCESSED');
    assert.equal(queries.filter(x=>x[0].includes?.('UPDATE refund_obligations')).length,1);
    assert.equal(queries.filter(x=>x[0]==='COMMIT').length,1);
  }else{
    await assert.rejects(()=>svc.receive({rawBody:raw,signature:'signed'}),
      err=>err.code===expected);
    assert.equal(queries.filter(x=>x[0].includes?.('UPDATE refund_obligations')).length,0);
    if(queries.some(x=>x[0]==='BEGIN'))assert.equal(queries.filter(x=>x[0]==='ROLLBACK').length,1);
  }
  scenarios++;console.log('PASS:',label);
}
(async()=>{
  await verify('signed uniquely matched approved refund','SUCCESS');
  await verify('forged signature','INVALID_WEBHOOK_SIGNATURE',()=>{signatureValid=false});
  await verify('unverified tracker','REFUND_TRACKER_UNVERIFIED',()=>{state.attempt.status='INITIATED'});
  await verify('wrong immutable order code','REFUND_ORDER_MISMATCH',()=>{state.order.order_code='WRONG'});
  await verify('unknown approved amount','REFUND_OBLIGATION_AMBIGUOUS',()=>{state.approved=[]});
  await verify('ambiguous same-amount obligations','REFUND_OBLIGATION_AMBIGUOUS',
    ()=>{state.approved.push({id:5,total_refund_amount:'10.00'});});
  await verify('cumulative amount exceeds capture','REFUND_CAPTURE_CEILING',()=>{state.confirmed='95.00'});
  await verify('preexisting incompatible event','REFUND_EVENT_RECONCILIATION_REQUIRED',
    ()=>{state.existing=[{provider:'SAFEPAY',event_type:'payment.succeeded',processed_status:'PROCESSED'}]});
  await verify('incorrect full tracker state','REFUND_TRACKER_STATE_MISMATCH',
    ()=>{},goodEvent({state:'TRACKER_REFUNDED'}));
  await verify('invalid fractional minor units','INVALID_REFUND_MINOR_UNITS',
    ()=>{},goodEvent({refund_amount:10.25}));
  await verify('non-PKR currency rejected','INVALID_REFUND_EVIDENCE',
    ()=>{},goodEvent({currency:'USD'}));
  const unit=svc.safeMoneyFromMinorUnits(1025);
  assert.equal(unit,'10.25');scenarios++;
  console.log('PASS: exact integer minor unit conversion');
  console.log('Safepay refund evidence isolated acceptance:',scenarios,'PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
