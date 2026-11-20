'use strict';
// OPT-IN, STAGE ONE ONLY. Main must securely populate process.env from the
// original .env BEFORE calling this runner; this file never reads that file.
// From backend: MILJOR_GENUINE_SANDBOX_CHECK=1 node tests/smart_hub_genuine_safepay_probe.js
// No checkout submission, contact entry, fabricated callbacks, SMS or real money.
// The real canonical checkout and authenticated reconciliation use no mockClient.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const https=require('node:https'),crypto=require('node:crypto');
const BACKEND=path.resolve(__dirname,'..'),ARTIFACTS=path.join(BACKEND,'artifacts','smart-hub-genuine-safepay-probe');
const API='http://127.0.0.1:5317',PROVIDER='sandbox.api.getsafepay.com';
// Official reference: https://apidocs.getsafepay.com/ describes
// GENERATE_CAPTURE_CONTEXT as the Cybersource Microform bootstrap, before card
// entry/token processing/authentication/capture. The hosted v2 UI requests this
// exact route with {tracker,intent}; no other browser POST is authorized here.
const CAPTURE_CONTEXT='/order/payments/v2/capture-context';
function staticReadAllowed(url){
  // The Microform iframe is a static hosted card-field document, not a charge
  // endpoint. Its keyId is never logged. Only the observed version is allowed.
  if(url.hostname==='testflex.cybersource.com'&&url.pathname==='/cybersource/assets/microform/0.11.8/iframe.html'&&[...url.searchParams.keys()].every(key=>key==='keyId'))return true;
  if(url.search)return false;
  return (url.hostname==='unpkg.com'&&url.pathname==='/@sfpy/checkout-components@0.1.1/dist/sfpy-checkout.js')||
    (url.hostname==='flex.cybersource.com'&&/^\/cybersource\/assets\/microform\/0\.11\/[-A-Za-z0-9_.]+\.(?:js|css)$/.test(url.pathname))||
    (url.hostname==='testflex.cybersource.com'&&/^\/cybersource\/assets\/microform\/0\.11\.8\/[-A-Za-z0-9_.]+\.(?:js|css)$/.test(url.pathname))||
    (url.hostname==='storage.googleapis.com'&&['/safepayobjects/safepay-ui/web/components/switch/blue-sheild.svg','/safepayobjects/safepay-ui/web/components/switch/switch.svg'].includes(url.pathname))||
    (url.hostname==='www.gstatic.com'&&/^\/recaptcha\/releases\/[-A-Za-z0-9_]+\/(?:recaptcha__[-A-Za-z0-9_]+\.js|styles__[-A-Za-z0-9_]+\.css)$/.test(url.pathname));
}
const fail=code=>Object.assign(Error(code),{code});
function preflight(){
  assert.equal(process.env.MILJOR_GENUINE_SANDBOX_CHECK,'1','GENUINE_PROBE_OPT_IN_REQUIRED');
  assert.equal(process.cwd(),BACKEND,'BACKEND_WORKING_DIRECTORY_REQUIRED');
  for(const [name,value] of Object.entries({NODE_ENV:'test',DB_NAME:'miljor_test_db',TEST_DB_NAME:'miljor_test_db',MILJOR_TEST_ONLY_MIGRATIONS:'1',ALLOW_EXTERNAL_MONEY_MOVEMENT:'false',SAFEPAY_ENV:'sandbox'}))assert.equal(process.env[name],value,'ISOLATION_REQUIRED');
  assert.ok(['127.0.0.1','localhost','::1'].includes(process.env.DB_HOST),'LOCAL_TEST_DATABASE_REQUIRED');
  assert.ok(process.env.JWT_SECRET?.length>=32,'EXPLICIT_TEST_JWT_SECRET_REQUIRED');
  for(const name of ['SAFEPAY_PUBLIC_KEY','SAFEPAY_SECRET_KEY','SAFEPAY_WEBHOOK_SECRET'])assert.ok(process.env[name]?.trim(),'CALLER_PROVIDER_CONFIGURATION_REQUIRED');
}
function safeMetadata(value,secrets){
  if(typeof value!=='string')return '';
  // Never preserve dynamic values masquerading as input metadata.
  if(value.length>100||!/^[-A-Za-z0-9 _.,:#*\/()]*$/.test(value)||/(?:track_|beacon|tbt_|sec_|bearer|token=)/i.test(value)||secrets.some(secret=>secret&&value.includes(secret)))return '[redacted]';
  return value;
}
function requestDescription(request,secrets){
  const url=new URL(request.url());
  const safePath=url.pathname.split('/').map(part=>/^(?:track_|tbt_|sec_)/i.test(part)||/^[a-f0-9-]{24,}$/i.test(part)||secrets.some(secret=>secret&&part.includes(secret))?':redacted':part.replace(/[^-A-Za-z0-9_.:@]/g,'_')).join('/');
  let bodyKeys=[];
  const body=request.postData();
  if(body){try{const parsed=JSON.parse(body);const visit=(object,prefix='',depth=0)=>{if(!object||typeof object!=='object'||depth>3)return;for(const name of Object.keys(object)){const key=safeMetadata(name,secrets);bodyKeys.push(prefix+key);visit(object[name],prefix+key+'.',depth+1);}};visit(parsed);}catch{try{bodyKeys=[...new URLSearchParams(body).keys()].map(key=>safeMetadata(key,secrets));}catch{bodyKeys=['[unparsed]'];}}}
  return {host:url.hostname,path:safePath,method:request.method(),resource_type:request.resourceType(),query_keys:[...url.searchParams.keys()].map(key=>safeMetadata(key,secrets)),body_keys:[...new Set(bodyKeys)].slice(0,80)};
}
async function runProbe(){
  const checks={opted_in:false,isolated_database_verified:false,local_server_owned:false,fixture_award_verified:false,real_jwt_login_verified:false,genuine_tracker_created:false,genuine_passport_authenticated:false,webhooks_disabled:false,official_sandbox_page_available:false,input_metadata_inspected:false,redacted_screenshot_saved:false,canonical_reconciliation_checked:false,original_order_remains_unpaid:false,unexpected_capture_observed:false,off_origin_request_blocked:false,browser_non_read_request_blocked:false,checkout_submission_performed:false,contact_input_performed:false,synthetic_callback_used:false,genuine_sandbox_payment_verified:false,stage_one_complete:false};
  let blocker=null,stage='OPT_IN_OR_ISOLATION_REQUIRED',metadata=[],requests=[],secrets=[],expectedTracker=null,contactRequirements=null;
  const requestRecords=new WeakMap();
  Object.assign(checks,{reused_existing_tracker:false,stored_passport_present:false,provider_http_ok:false,provider_network_error_visible:false,provider_form_controls_available:false,genuine_readonly_tracker_checked:false,capture_context_bootstrap_allowed:false,capture_context_bootstrap_ok:false,required_static_read_allowed:false,cybersource_microform_available:false});
  let db,server,browser,context,adapter,originalConstruct,originalRequest,requestGuard;
  let configured=false;
  const consoleMethods=['log','error','warn','info','debug'],originalConsole={};
  const savedEnv={};
  const settingNames=['TRANSACTIONAL_EMAIL_MODE','EMAIL_MODE','ENABLE_VERBOSE_LOGS','B6_FINANCIAL_GATE_ENABLED','B6_B5_INVENTORY_RECONCILED','B6_TAX_POLICY_APPROVED'];
  try{
    preflight();checks.opted_in=true;
    for(const name of settingNames)savedEnv[name]=process.env[name];
    Object.assign(process.env,{TRANSACTIONAL_EMAIL_MODE:'mock',EMAIL_MODE:'mock',ENABLE_VERBOSE_LOGS:'false',B6_FINANCIAL_GATE_ENABLED:'false',B6_B5_INVENTORY_RECONCILED:'false',B6_TAX_POLICY_APPROVED:'false'});
    configured=true;
    // Dependency errors can contain checkout URLs or provider response bodies.
    // Suppress dependency console output; emit only this runner's fixed evidence.
    for(const name of consoleMethods){originalConsole[name]=console[name];console[name]=()=>{};}
    originalRequest=https.request;
    requestGuard=function(...args){
      let options;
      if(typeof args[0]==='string'||args[0] instanceof URL){const url=new URL(args[0]);options={protocol:url.protocol,hostname:url.hostname,port:url.port,path:url.pathname+url.search,...(typeof args[1]==='object'?args[1]:{})};}
      else options=args[0]||{};
      const host=options.hostname||options.host,method=String(options.method||'GET').toUpperCase(),target=String(options.path||'/');
      const permitted=host===PROVIDER&&(!options.protocol||options.protocol==='https:')&&(!options.port||Number(options.port)===443)&&!options.auth&&
        ((method==='POST'&&['/order/v1/init','/client/passport/v1/token'].includes(target))||(method==='GET'&&/^\/order\/v1\/[-A-Za-z0-9_]+$/.test(target)));
      if(!permitted){checks.off_origin_request_blocked=true;throw fail('PROBE_PROVIDER_REQUEST_BLOCKED');}
      return originalRequest.apply(this,args);
    };
    https.request=requestGuard;
    stage='CHROMIUM_UNAVAILABLE';
    const {chromium}=require('playwright');
    browser=await chromium.launch({headless:true,args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--disable-domain-reliability']});
    context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1100},acceptDownloads:false});
    await context.route('**/*',async route=>{
      let url;try{url=new URL(route.request().url());}catch{return route.abort('blockedbyclient');}
      const description=requestDescription(route.request(),secrets);
      requestRecords.set(route.request(),description);
      const official=url.protocol==='https:'&&url.hostname===PROVIDER&&(!url.port||url.port==='443')&&!url.username&&!url.password;
      const read=['GET','HEAD'].includes(route.request().method());
      const safeOrigin=url.protocol==='https:'&&(!url.port||url.port==='443')&&!url.username&&!url.password;
      const recaptchaScript=url.hostname==='www.google.com'&&url.pathname==='/recaptcha/api.js'&&[...url.searchParams.keys()].every(key=>key==='render');
      if(!official&&safeOrigin&&read&&(staticReadAllowed(url)||recaptchaScript)){
        description.decision='ALLOWED_PINNED_STATIC_READ';requests.push(description);checks.required_static_read_allowed=true;return route.continue();
      }
      if(!official){description.decision='BLOCKED_ORIGIN';requests.push(description);checks.off_origin_request_blocked=true;return route.abort('blockedbyclient');}
      if(!read){
        let body;try{body=route.request().postDataJSON();}catch{}
        // Hosted v2 intent is a scalar bootstrap hint, not the v3 next_action
        // provider enum. Do not assume its value is the string CYBERSOURCE.
        const bootstrap=route.request().method()==='POST'&&url.pathname===CAPTURE_CONTEXT&&!url.search&&body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).sort().join(',')==='intent,tracker'&&body.tracker===expectedTracker&&typeof body.intent==='string'&&/^[A-Za-z_]{1,64}$/.test(body.intent);
        if(bootstrap){description.decision='ALLOWED_VERIFIED_CAPTURE_CONTEXT_BOOTSTRAP';requests.push(description);checks.capture_context_bootstrap_allowed=true;return route.continue();}
        description.decision='BLOCKED_NON_BOOTSTRAP_WRITE';requests.push(description);checks.browser_non_read_request_blocked=true;return route.abort('blockedbyclient');
      }
      description.decision='ALLOWED_OFFICIAL_READ';requests.push(description);
      return route.continue();
    });
    context.on('response',response=>{const entry=requestRecords.get(response.request());if(entry){entry.http_status=response.status();if(entry.decision==='ALLOWED_VERIFIED_CAPTURE_CONTEXT_BOOTSTRAP')checks.capture_context_bootstrap_ok=response.ok();}});
    context.on('requestfailed',request=>{const entry=requestRecords.get(request);if(entry)entry.network_error=/net::(ERR_[A-Z_]+)/.exec(request.failure()?.errorText||'')?.[1]||'REQUEST_FAILED';});
    await context.routeWebSocket('**/*',socket=>{checks.browser_non_read_request_blocked=true;socket.close({code:1008,reason:'Inspection only'});});
    stage='TEST_DATABASE_UNAVAILABLE';
    const fixtureTools=require('./smart_hub_paid_browser_fixture');
    db=require('../src/config/db');await fixtureTools.identity(db);checks.isolated_database_verified=true;
    stage='LOCAL_PORT_5317_UNAVAILABLE';
    server=require('../server').listen(5317,'127.0.0.1');
    await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});checks.local_server_owned=true;
    // Bind our own port before fixture mutation; never reuse another process.
    stage='CANONICAL_FIXTURE_OR_AUTH_BLOCKED';
    let fixture,checkout;
    async function api(user,method,endpoint,body,status=200,code=null,extra={}){
      assert.ok(endpoint.startsWith('/')&&!endpoint.includes('://'),'LOCAL_API_PATH_REQUIRED');
      const response=await fetch(API+'/api/v1'+endpoint,{method,redirect:'error',signal:AbortSignal.timeout(45000),headers:{'Content-Type':'application/json',...(user?{Authorization:'Bearer '+user.token}:{}),'X-Idempotency-Key':fixtureTools.key(crypto.randomBytes(8).toString('hex')),...extra},...(body==null?{}:{body:JSON.stringify(body)})});
      const result=await response.json();if(response.status!==status)throw fail('LOCAL_API_STATUS_MISMATCH');
      if(code&&result.error?.code!==code)throw fail('LOCAL_API_ERROR_CONTRACT_MISMATCH');
      if(status<300&&result.success!==true)throw fail('LOCAL_API_NOT_CONFIRMED');
      return status<300?result.data:result;
    }
    // Reuse only this probe's isolated, unpaid, purpose-free sandbox attempt.
    // No password reset, new fixture or new provider tracker is needed on retries.
    if(process.env.MILJOR_GENUINE_SANDBOX_REUSE!=='0'){
      const [attempts]=await db.query("SELECT pa.order_id,pa.buyer_id,pa.provider,pa.environment,pa.provider_tracker_token,pa.checkout_url FROM payment_attempts pa JOIN orders o ON o.id=pa.order_id AND o.buyer_id=pa.buyer_id JOIN users u ON u.id=o.buyer_id WHERE pa.provider='SAFEPAY' AND pa.environment='sandbox' AND pa.procurement_delivery_contract_id IS NULL AND pa.status='INITIATED' AND o.payment_status<>'PAID' AND u.email LIKE 'smart-paid-%@miljor.test' AND pa.checkout_url IS NOT NULL ORDER BY pa.id DESC LIMIT 30");
      checkout=attempts.find(attempt=>{try{const url=new URL(attempt.checkout_url),redirect=new URL(url.searchParams.get('redirect_url'));return url.origin==='https://'+PROVIDER&&url.pathname==='/checkout/pay'&&url.searchParams.get('webhooks')==='false'&&url.searchParams.get('beacon')===attempt.provider_tracker_token&&redirect.origin===API&&redirect.pathname==='/probe/return'&&!/synthetic|mock/i.test(attempt.provider_tracker_token);}catch{return false;}});
      if(!checkout)throw fail('REUSABLE_PROBE_ATTEMPT_UNAVAILABLE');
      checks.reused_existing_tracker=true;fixture={order:{id:checkout.order_id},buyer:{id:checkout.buyer_id,role:'BUYER'}};
    }else{
    fixture=await fixtureTools.seed(db);
    for(const actor of [fixture.buyer,fixture.supplier]){
      const login=await api(null,'POST','/auth/login',{identifier:actor.email,password:fixture.password});
      assert.equal(login.user.role,actor.role);assert.equal(Number(login.user.id),Number(actor.id));assert.ok(login.token);actor.token=login.token;
    }
    checks.real_jwt_login_verified=true;
    await fixtureTools.award(api,db,fixture);checks.fixture_award_verified=true;
    }
    adapter=require('../src/services/safepayAdapter');
    assert.equal(adapter.env,'sandbox');assert.equal(adapter.sandboxApiHost,PROVIDER);assert.equal(new URL(adapter.sandboxCheckoutBase).hostname,PROVIDER);
    // Force webhooks=false when the canonical service builds AND stores the URL.
    // Only this pure URL builder is wrapped. Tracker/passport/fetch remain genuine.
    originalConstruct=adapter.constructCheckoutUrl;
    adapter.constructCheckoutUrl=function(options){return originalConstruct.call(this,{...options,webhooks:false});};
    stage='GENUINE_SANDBOX_CHECKOUT_UNAVAILABLE';
    try{if(!checks.reused_existing_tracker)checkout=await api(fixture.buyer,'POST',`/orders/${fixture.order.id}/checkout`,{redirect_url:API+'/probe/return',cancel_url:API+'/probe/cancel'});}
    finally{adapter.constructCheckoutUrl=originalConstruct;}
    assert.equal(checkout.provider,'SAFEPAY');assert.equal(checkout.environment,'sandbox');assert.ok(checkout.provider_tracker_token);
    checks.genuine_tracker_created=!checks.reused_existing_tracker;
    const checkoutUrl=new URL(checkout.checkout_url);
    assert.equal(checkoutUrl.protocol,'https:');assert.equal(checkoutUrl.hostname,PROVIDER);assert.equal(checkoutUrl.pathname,'/checkout/pay');assert.equal(checkoutUrl.searchParams.get('webhooks'),'false');
    assert.equal(checkoutUrl.searchParams.get('beacon'),checkout.provider_tracker_token);
    for(const [parameter,pathname] of [['redirect_url','/probe/return'],['cancel_url','/probe/cancel']]){
      const target=new URL(checkoutUrl.searchParams.get(parameter));assert.equal(target.origin,API);assert.equal(target.pathname,pathname);assert.equal(target.search,'');assert.equal(target.hash,'');
    }
    expectedTracker=checkout.provider_tracker_token;
    checks.webhooks_disabled=true;checks.stored_passport_present=Boolean(checkoutUrl.searchParams.get('tbt'));checks.genuine_passport_authenticated=!checks.reused_existing_tracker&&checks.stored_passport_present;
    secrets=[process.env.SAFEPAY_PUBLIC_KEY,process.env.SAFEPAY_SECRET_KEY,process.env.SAFEPAY_WEBHOOK_SECRET,fixture.password,fixture.buyer.token,fixture.supplier?.token,checkout.provider_tracker_token,...checkoutUrl.searchParams.values()].filter(value=>typeof value==='string'&&value.length>5);
    if(checks.reused_existing_tracker){
      stage='READONLY_PROVIDER_TRACKER_UNAVAILABLE';
      const provider=await adapter.fetchTracker(checkout.provider_tracker_token);
      assert.equal(provider.data.token,checkout.provider_tracker_token);checks.genuine_readonly_tracker_checked=true;
      checks.unexpected_capture_observed=['TRACKER_ENDED','COMPLETED','PAID'].includes(provider.data.state)&&Boolean(provider.data.transaction);
      const [[order]]=await db.query('SELECT payment_status FROM orders WHERE id=?',[fixture.order.id]);
      const [[payments]]=await db.query('SELECT COUNT(*) total FROM payments WHERE order_id=?',[fixture.order.id]);
      checks.original_order_remains_unpaid=order.payment_status!=='PAID'&&Number(payments.total)===0;
      if(checks.unexpected_capture_observed||!checks.original_order_remains_unpaid)throw fail('UNEXPECTED_PROVIDER_CAPTURE');
    }
    const page=await context.newPage();
    stage='OFFICIAL_SANDBOX_PAGE_UNAVAILABLE';
    const response=await page.goto(checkoutUrl.href,{waitUntil:'domcontentloaded',timeout:30000});
    if(!response?.ok()||new URL(page.url()).origin!=='https://'+PROVIDER)throw fail('OFFICIAL_SANDBOX_PAGE_UNAVAILABLE');
    checks.provider_http_ok=true;checks.official_sandbox_page_available=true;
    // A bounded render wait; no form actions and no contact/payment values entered.
    await page.locator('body').waitFor({state:'visible',timeout:10000});
    // Bound bootstrap rendering; no clicks/fills/submissions are issued.
    for(let attempt=0;attempt<40;attempt++){
      const microforms=page.frames().filter(frame=>{try{return new URL(frame.url()).hostname==='testflex.cybersource.com';}catch{return false;}});
      checks.cybersource_microform_available=microforms.length>=2&&(await Promise.all(microforms.map(frame=>frame.locator('input').count().catch(()=>0)))).every(count=>count>0);
      if(checks.capture_context_bootstrap_ok&&checks.cybersource_microform_available&&await page.locator('input:not([type=hidden]),select,textarea').first().isVisible().catch(()=>false))break;
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    const hasControls=await page.locator('input:not([type=hidden]),select,textarea').first().isVisible().catch(()=>false);
    checks.provider_form_controls_available=hasControls;
    checks.provider_network_error_visible=await page.getByText('Network Error',{exact:true}).isVisible().catch(()=>false);
    // Inspect only DOM attributes and attached schema descriptors. Never invoke
    // submit/change/validation callbacks or enter a contact to test requiredness.
    contactRequirements=await page.evaluate(()=>{
      const fields=[...document.querySelectorAll('input')];
      const inspect=(node,kind)=>{
        if(!node)return {present:false,native_required:false,aria_required:false,attached_required_validator:false,attached_schema_found:false,required_verified:false,optional_verified:false};
        let fiber=node[Object.keys(node).find(key=>key.startsWith('__reactFiber$'))],schemaFound=false,validatorRequired=false;
        for(let depth=0;fiber&&depth<100;depth++,fiber=fiber.return){
          const props=fiber.memoizedProps;
          for(const schema of [props?.validationSchema,props?.formik?.validationSchema,props?.form?.validationSchema]){
            if(!schema||typeof schema!=='object'||!schema.fields)continue;
            for(const [name,field] of Object.entries(schema.fields))if(new RegExp(kind==='phone'?'phone|mobile|telephone':'email','i').test(name)){
              schemaFound=true;
              validatorRequired=validatorRequired||Boolean(field.exclusiveTests?.required||field._exclusive?.required||field.tests?.some(test=>test.OPTIONS?.name==='required'));
            }
          }
        }
        const native=Boolean(node.required),aria=node.getAttribute('aria-required')==='true';
        return {present:true,native_required:native,aria_required:aria,attached_required_validator:validatorRequired,attached_schema_found:schemaFound,required_verified:native||aria||validatorRequired,optional_verified:false};
      };
      return {phone:inspect(fields.find(node=>node.type==='tel'||node.getAttribute('placeholder')==='Phone number'),'phone'),email:inspect(fields.find(node=>node.type==='email'||/email/i.test(node.getAttribute('placeholder')||'')),'email')};
    });
    contactRequirements.controlled_test_phone_configured=['SAFEPAY_TEST_PHONE','TEST_PHONE','TEST_MOBILE','SMS_TEST_TO'].some(name=>Boolean(process.env[name]));
    contactRequirements.phone_requiredness_unknown=contactRequirements.phone.present&&!contactRequirements.phone.required_verified&&!contactRequirements.phone.optional_verified;
    const frames=page.frames().filter(frame=>{try{return [PROVIDER,'testflex.cybersource.com'].includes(new URL(frame.url()).hostname);}catch{return false;}});
    for(const frame of frames){
      const raw=await frame.locator('input,select,textarea').evaluateAll(nodes=>nodes.map(node=>({name:node.getAttribute('name')||'',type:node.getAttribute('type')||node.tagName.toLowerCase(),placeholder:node.getAttribute('placeholder')||'',required_attribute:Boolean(node.required),aria_required:node.getAttribute('aria-required')==='true'})));
      metadata.push(...raw.map(item=>({frame_host:new URL(frame.url()).hostname,name:safeMetadata(item.name,secrets),type:safeMetadata(item.type,secrets),placeholder:safeMetadata(item.placeholder,secrets),required_attribute:item.required_attribute,aria_required:item.aria_required})));
    }
    checks.input_metadata_inspected=true;
    // Remove values and sensitive rendered text before producing any screenshot.
    // Set DOM properties directly: no events, fills, clicks or submits are fired.
    for(const frame of frames)await frame.evaluate(secrets=>{
      for(const node of document.querySelectorAll('input,textarea,select')){node.value='';node.removeAttribute('value');node.disabled=true;}
      for(const button of document.querySelectorAll('button'))button.disabled=true;
      const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
      while(walker.nextNode()){const node=walker.currentNode;if(secrets.some(secret=>node.textContent.includes(secret))||/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(node.textContent)||/\b\d[\d -]{11,}\d\b/.test(node.textContent))node.textContent='[redacted]';}
    },secrets);
    fs.mkdirSync(ARTIFACTS,{recursive:true});
    await page.screenshot({path:path.join(ARTIFACTS,'provider-page-redacted.png'),fullPage:true,mask:frames.map(frame=>frame.locator('input,textarea,select')),maskColor:'#202020'});checks.redacted_screenshot_saved=true;
    // No payment is submitted. Canonical authenticated reconciliation fetches the
    // real tracker; a pending tracker is expected and is not payment success.
    stage='AUTHENTICATED_PROVIDER_RECONCILIATION_UNAVAILABLE';
    if(checks.reused_existing_tracker){
      // Reused credentials are not fabricated into a JWT. This continuation is
      // strictly read-only: fetch the real tracker without any ledger transition.
      assert.equal(checks.genuine_readonly_tracker_checked,true);
    }else{
      const reconciled=await api(fixture.buyer,'POST',`/orders/${fixture.order.id}/reconcile`,{});
      checks.canonical_reconciliation_checked=true;checks.unexpected_capture_observed=reconciled.payment_status==='PAID'||reconciled.reconciled===true;
    }
    const [[order]]=await db.query('SELECT payment_status FROM orders WHERE id=?',[fixture.order.id]);
    const [[payments]]=await db.query('SELECT COUNT(*) total FROM payments WHERE order_id=?',[fixture.order.id]);
    checks.original_order_remains_unpaid=order.payment_status!=='PAID'&&Number(payments.total)===0;
    if(checks.unexpected_capture_observed||!checks.original_order_remains_unpaid)throw fail('UNEXPECTED_PROVIDER_CAPTURE');
    if(!checks.capture_context_bootstrap_allowed){blocker='CAPTURE_CONTEXT_NOT_OBSERVED_OR_SCHEMA_NOT_ALLOWED';}
    else if(!checks.capture_context_bootstrap_ok){blocker='CAPTURE_CONTEXT_BOOTSTRAP_REJECTED_OR_UNAVAILABLE';}
    else if(checks.provider_network_error_visible){blocker='HOSTED_FORM_DEPENDENCY_LIMITATION_AFTER_BOOTSTRAP';}
    else if(!hasControls){blocker='OFFICIAL_SANDBOX_FORM_UNAVAILABLE';}
    else if(!checks.cybersource_microform_available){blocker='CYBERSOURCE_MICROFORM_NOT_AVAILABLE';}
    else if(!checks.stored_passport_present){blocker='PASSPORT_TOKEN_NOT_RETURNED';}
    else{checks.stage_one_complete=true;blocker='PAYMENT_FORM_INSPECTION_ONLY_AWAITING_MAIN_REVIEW';}
  }catch(error){
    blocker=['UNEXPECTED_PROVIDER_CAPTURE','REUSABLE_PROBE_ATTEMPT_UNAVAILABLE'].includes(error.code)?error.code:stage;
  }finally{
    if(adapter&&originalConstruct)adapter.constructCheckoutUrl=originalConstruct;
    await browser?.close().catch(()=>{});
    if(server?.listening)await new Promise(resolve=>server.close(resolve));
    if(db)await db.end().catch(()=>{});
    if(originalRequest)https.request=originalRequest;
    if(configured){
      for(const name of settingNames){if(savedEnv[name]===undefined)delete process.env[name];else process.env[name]=savedEnv[name];}
      for(const name of consoleMethods)if(originalConsole[name])console[name]=originalConsole[name];
    }
  }
  requests=requests.slice(0,120);
  const result={checks,blocker,contact_requirements:contactRequirements,input_metadata:metadata,request_metadata:requests};
  if(checks.opted_in){fs.mkdirSync(ARTIFACTS,{recursive:true});fs.writeFileSync(path.join(ARTIFACTS,'evidence.json'),JSON.stringify({checks,blocker,contact_requirements:contactRequirements},null,2));fs.writeFileSync(path.join(ARTIFACTS,'input-metadata.json'),JSON.stringify(metadata,null,2));fs.writeFileSync(path.join(ARTIFACTS,'request-metadata.json'),JSON.stringify(requests,null,2));}
  return result;
}
module.exports={runProbe};
if(require.main===module)runProbe().then(result=>{console.log(JSON.stringify(result,null,2));if(!result.checks.stage_one_complete)process.exitCode=1;}).catch(()=>{console.error('GENUINE_SANDBOX_PROBE_RUNNER_FAILED');process.exitCode=1;});
