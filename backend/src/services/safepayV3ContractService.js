'use strict';
// Payment v3 contract preparation and strict response verification.
// NO network requests, NO DB writes, and NO money movement.
// Sandbox production promotion requires independently verified merchant evidence.
const exact=require('./exactDecimal');
const fail=(code,message)=>Object.assign(new Error(message),{code,statusCode:422});
const tokenPattern=/^track_[A-Za-z0-9_-]{3,180}$/;
function toMinorPkr(amount){
  let s;
  try{s=exact.toCanonicalString(amount,2);}catch(_){throw fail('INVALID_PKR_AMOUNT','PKR amount must be an exact two-decimal amount');}
  if(!/^\d+\.\d{2}$/.test(s))throw fail('INVALID_PKR_AMOUNT','PKR amount must be nonnegative');
  const [rupees,paisa]=s.split('.');
  const value=BigInt(rupees)*100n+BigInt(paisa);
  if(value<=0n||value>BigInt(Number.MAX_SAFE_INTEGER))
    throw fail('INVALID_PKR_AMOUNT','Amount must be positive and fit exact provider integer range');
  return value.toString();
}
function fromMinorPkr(minor){
  if(typeof minor!=='string'&&typeof minor!=='number')
    throw fail('INVALID_PROVIDER_AMOUNT','Provider minor units must be integer');
  const raw=String(minor);
  if(!/^(0|[1-9]\d*)$/.test(raw))
    throw fail('INVALID_PROVIDER_AMOUNT','Provider minor units must be a nonnegative integer');
  const value=BigInt(raw);
  if(value>BigInt(Number.MAX_SAFE_INTEGER))
    throw fail('INVALID_PROVIDER_AMOUNT','Provider integer exceeds exact safe range');
  return String(value/100n)+'.'+String(value%100n).padStart(2,'0');
}
function buildPaymentV3({amountPkr,currency='PKR',merchantApiKey,orderCode,intent='CYBERSOURCE',entryMode='raw'}){
  if(currency!=='PKR')throw fail('UNSUPPORTED_CURRENCY','Only PKR is supported');
  if(typeof merchantApiKey!=='string'||!/^sec_[A-Za-z0-9_-]{8,200}$/.test(merchantApiKey))
    throw fail('INVALID_MERCHANT_API_KEY','Merchant API key must be configured privately');
  if(typeof orderCode!=='string'||!/^[A-Za-z0-9_-]{3,80}$/.test(orderCode))
    throw fail('INVALID_ORDER_CODE','Order code must be an opaque safe reference');
  if(!['CYBERSOURCE','MPGS'].includes(intent))
    throw fail('UNSUPPORTED_INTENT','Unsupported payment channel');
  if(entryMode!=='raw')throw fail('UNSUPPORTED_ENTRY_MODE','Only documented raw card entry is supported');
  const minor=toMinorPkr(amountPkr);
  return Object.freeze({
    method:'POST',path:'/order/payments/v3/',sandboxHost:'sandbox.api.getsafepay.com',
    body:Object.freeze({
      merchant_api_key:merchantApiKey,intent,mode:'payment',entry_mode:'raw',
      currency:'PKR',amount:Number(minor),metadata:{source:'miljor',order_id:orderCode}
    })
  });
}
function validateCreatedTracker({response,expectedAmountPkr,expectedOrderCode}){
  const tracker=response?.data?.tracker;
  if(!tracker||!tokenPattern.test(String(tracker.token||'')))
    throw fail('V3_TRACKER_MISSING','V3 response must return a valid tracker token');
  if(tracker.environment!=='sandbox'||tracker.mode!=='payment'||tracker.state!=='TRACKER_STARTED')
    throw fail('V3_TRACKER_STATE_MISMATCH','Expected new Sandbox payment tracker');
  const quoted=tracker.purchase_totals?.quote_amount;
  if(!quoted||quoted.currency!=='PKR'||fromMinorPkr(quoted.amount)!==exact.toCanonicalString(expectedAmountPkr,2))
    throw fail('V3_TRACKER_AMOUNT_MISMATCH','Provider quote differs from exact locked order');
  if(tracker.metadata?.order_id!==undefined&&
     tracker.metadata.order_id!==expectedOrderCode)
    throw fail('V3_TRACKER_ORDER_MISMATCH','Provider tracker metadata differs from order');
  return Object.freeze({trackerToken:tracker.token,providerContract:'payments-v3-minor',
    amountPkr:exact.toCanonicalString(expectedAmountPkr,2),currency:'PKR',
    captured:false,providerOriginVerified:false});
}
function validateReportedTracker({response,expectedTrackerToken,expectedAmountPkr,expectedOrderCode}){
  if(!tokenPattern.test(String(expectedTrackerToken||'')))
    throw fail('INVALID_TRACKER_TOKEN','Invalid Safepay tracker token');
  const tracker=response?.data?.tracker;
  if(!tracker||tracker.token!==expectedTrackerToken)
    throw fail('V3_TRACKER_IDENTITY_MISMATCH','Provider reporter did not return expected tracker');
  if(tracker.environment!=='sandbox'||tracker.mode!=='payment')
    throw fail('V3_TRACKER_STATE_MISMATCH','Tracker is not Sandbox payment mode');
  const quoted=tracker.purchase_totals?.quote_amount;
  if(!quoted||quoted.currency!=='PKR'||
      fromMinorPkr(quoted.amount)!==exact.toCanonicalString(expectedAmountPkr,2))
    throw fail('V3_TRACKER_AMOUNT_MISMATCH','Provider reporter amount/currency mismatch');
  if(tracker.metadata?.order_id!==undefined&&
      tracker.metadata.order_id!==expectedOrderCode)
    throw fail('V3_TRACKER_ORDER_MISMATCH','Reporter metadata differs from original order');
  // A reported state alone is never sufficient to mark an order PAID in
  // MilJor. Provider-origin signed webhook plus exact locked order reconciliation
  // and transactional ledger acceptance are separate requirements.
  return Object.freeze({
    trackerToken:expectedTrackerToken,
    state:String(tracker.state||'UNKNOWN'),
    amountPkr:exact.toCanonicalString(expectedAmountPkr,2),
    currency:'PKR',
    readOnly:true,
    canMarkOrderPaid:false,
    providerSignedWebhookVerified:false
  });
}
function refundPreview({amountPkr,trackerToken,currency='PKR'}){
  if(!tokenPattern.test(String(trackerToken||'')))throw fail('INVALID_TRACKER_TOKEN','Invalid provider tracker');
  if(currency!=='PKR')throw fail('UNSUPPORTED_CURRENCY','Only PKR supported');
  return Object.freeze({tracker:trackerToken,payload:{currency:'PKR',amount:Number(toMinorPkr(amountPkr))},
    executable:false,providerConfirmation:'NOT_VERIFIED'});
}
module.exports={toMinorPkr,fromMinorPkr,buildPaymentV3,validateCreatedTracker,validateReportedTracker,refundPreview};
