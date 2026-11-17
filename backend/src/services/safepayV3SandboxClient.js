'use strict';
// Isolated sandbox-only payment TRACKER client. Does not confirm payment,
// update orders, process refunds or move money. Not wired to buyer checkout.
const {buildPaymentV3,validateCreatedTracker,validateReportedTracker}=require('./safepayV3ContractService');
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
  async createHostedCheckout({amountPkr,orderCode,redirectUrl,cancelUrl,intent='CYBERSOURCE'}){
    const created=await this.createPaymentTracker({amountPkr,orderCode,intent});
    let passport;
    try{
      const response=await this.fetchImpl('https://sandbox.api.getsafepay.com/client/passport/v1/token',{
        method:'POST',
        headers:{'Content-Type':'application/json',
          'X-SFPY-MERCHANT-SECRET':this.env.SAFEPAY_SECRET_KEY},
        body:'{}',signal:AbortSignal.timeout(10000)
      });
      if(!response||response.status<200||response.status>=300)
        throw new Error('passport request rejected');
      const parsed=await response.json();
      passport=parsed?.data;
      if(typeof passport!=='string'||passport.length<16||passport.length>2048)
        throw new Error('passport response invalid');
    }catch(_){
      // Tracker may already exist; never silently retry and create a duplicate.
      throw fail('SAFEPAY_V3_TRACKER_CREATED_AUTH_TOKEN_FAILED',
        'Tracker exists but checkout authentication token was not issued; reconcile before retry',502);
    }
    const frontendBase=new URL(this.env.FRONTEND_URL||'http://localhost:3000');
    const safeRedirect=(value,fallback)=>{
      const target=new URL(value||fallback,frontendBase);
      if(target.origin!==frontendBase.origin||
         !['http:','https:'].includes(target.protocol))
        throw fail('SAFEPAY_V3_REDIRECT_ORIGIN_INVALID','Checkout redirect must remain on configured frontend origin',400);
      return target.toString();
    };
    const success=safeRedirect(redirectUrl,
      '/payment/return?order_id='+encodeURIComponent(orderCode));
    const cancel=safeRedirect(cancelUrl,
      '/payment/cancelled?order_id='+encodeURIComponent(orderCode));
    const checkout=new URL('https://sandbox.api.getsafepay.com/checkout/pay');
    checkout.searchParams.set('beacon',created.trackerToken);
    checkout.searchParams.set('tbt',passport);
    checkout.searchParams.set('env','sandbox');
    checkout.searchParams.set('source','hosted');
    checkout.searchParams.set('order_id',orderCode);
    checkout.searchParams.set('redirect_url',success);
    checkout.searchParams.set('cancel_url',cancel);
    checkout.searchParams.set('webhooks','true');
    return Object.freeze({...created,checkoutUrl:checkout.toString(),
      authenticationTokenExpiresInSeconds:3600});
  }
  async inspectPaymentTracker({trackerToken,amountPkr,orderCode}){
    assertSafeEnvironment(this.env);
    if(typeof this.fetchImpl!=='function')
      throw fail('SAFEPAY_V3_FETCH_UNAVAILABLE','HTTPS transport unavailable');
    if(typeof trackerToken!=='string'||!/^track_[A-Za-z0-9_-]{3,180}$/.test(trackerToken))
      throw fail('INVALID_TRACKER_TOKEN','Opaque Safepay tracker token required',400);
    let response;
    try{
      response=await this.fetchImpl(
        'https://sandbox.api.getsafepay.com/reporter/api/v1/payments/'+trackerToken,{
          method:'GET',
          headers:{'Accept':'application/json','X-SFPY-MERCHANT-SECRET':this.env.SAFEPAY_SECRET_KEY},
          signal:AbortSignal.timeout(10000)
        });
    }catch(_){
      throw fail('SAFEPAY_V3_REPORT_UNAVAILABLE','Provider reporter outcome uncertain');
    }
    if(!response||response.status!==200)
      throw fail('SAFEPAY_V3_REPORT_REJECTED','Provider reporter did not accept lookup',502);
    let data;
    try{data=await response.json();}catch(_){
      throw fail('SAFEPAY_V3_REPORT_INVALID','Provider reporter response invalid',502);
    }
    try{
      return validateReportedTracker({response:data,expectedTrackerToken:trackerToken,
        expectedAmountPkr:amountPkr,expectedOrderCode:orderCode});
    }catch(_){
      throw fail('SAFEPAY_V3_REPORT_UNVERIFIED','Provider reporter identity or quote unverifiable',502);
    }
  }

}
module.exports={SafepayV3SandboxClient,assertSafeEnvironment};
