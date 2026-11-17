'use strict';
// Isolated sandbox-only payment TRACKER client. Does not confirm payment,
// update orders, process refunds or move money. Not wired to buyer checkout.
const {buildPaymentV3,validateCreatedTracker}=require('./safepayV3ContractService');
const fail=(code,message,statusCode=503)=>Object.assign(new Error(message),{code,statusCode});
function assertSafeEnvironment(env){
  if(env.SAFEPAY_ENV!=='sandbox'||env.ALLOW_EXTERNAL_MONEY_MOVEMENT!=='false'||
     !['miljor_test_db','miljor_sandbox_db'].includes(env.DB_NAME))
    throw fail('SAFEPAY_V3_ISOLATION_REQUIRED','Sandbox and disposable database are mandatory');
  if(env.SAFEPAY_V3_SANDBOX_ENABLED!=='true')
    throw fail('SAFEPAY_V3_SANDBOX_DISABLED','Sandbox v3 tracker creation requires explicit enablement');
  if(!env.SAFEPAY_PUBLIC_KEY||!env.SAFEPAY_SECRET_KEY)
    throw fail('SAFEPAY_V3_CREDENTIALS_MISSING','Sandbox merchant configuration required');
}
class SafepayV3SandboxClient{
  constructor({env=process.env,fetchImpl=globalThis.fetch}={}){
    this.env=env;
    this.fetchImpl=fetchImpl;
  }
  async createPaymentTracker({amountPkr,orderCode,intent='CYBERSOURCE'}){
    assertSafeEnvironment(this.env);
    if(typeof this.fetchImpl!=='function')
      throw fail('SAFEPAY_V3_FETCH_UNAVAILABLE','HTTPS transport unavailable');
    const request=buildPaymentV3({
      amountPkr,orderCode,intent,merchantApiKey:this.env.SAFEPAY_PUBLIC_KEY
    });
    // Host fixed by source code, never user input or environment override.
    const url='https://sandbox.api.getsafepay.com'+request.path;
    let response;
    try{
      response=await this.fetchImpl(url,{
        method:'POST',
        headers:{'Content-Type':'application/json',
          'X-SFPY-MERCHANT-SECRET':this.env.SAFEPAY_SECRET_KEY},
        body:JSON.stringify(request.body),
        signal:AbortSignal.timeout(10000)
      });
    }catch(_){
      // Network uncertainty is NOT a failed payment. Operator reconciles
      // any possibly created tracker rather than retrying a charge blindly.
      throw fail('SAFEPAY_V3_NETWORK_UNKNOWN','Tracker creation outcome uncertain; reconcile before retry');
    }
    if(!response||response.status!==201)
      throw fail('SAFEPAY_V3_PROVIDER_REJECTED','Provider rejected tracker creation',502);
    let data;
    try{data=await response.json();}catch(_){
      throw fail('SAFEPAY_V3_RESPONSE_INVALID','Provider tracker response invalid',502);
    }
    try{
      return validateCreatedTracker({
        response:data,expectedAmountPkr:amountPkr,expectedOrderCode:orderCode
      });
    }catch(_){
      throw fail('SAFEPAY_V3_RESPONSE_UNVERIFIED','Provider tracker quote/identity could not be verified',502);
    }
  }
}
module.exports={SafepayV3SandboxClient,assertSafeEnvironment};
