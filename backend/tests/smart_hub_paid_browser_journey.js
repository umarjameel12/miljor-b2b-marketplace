'use strict';
// Run from backend: NODE_ENV=test DB_NAME=miljor_test_db TEST_DB_NAME=miljor_test_db
// DB_HOST=127.0.0.1 MILJOR_TEST_ONLY_MIGRATIONS=1 SAFEPAY_ENV=sandbox
// ALLOW_EXTERNAL_MONEY_MOVEMENT=false JWT_SECRET=<disposable 32+ chars>
// node tests/smart_hub_paid_browser_journey.js
// Requires migrated test DB, backend/frontend dependencies and Playwright Chromium.
// Starts local Express + Vite itself; never connects to an already-running API.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const crypto=require('node:crypto'),{spawn}=require('node:child_process');
const fixtureTools=require('./smart_hub_paid_browser_fixture');
fixtureTools.assertIsolated();
assert.equal(process.cwd(),path.resolve(__dirname,'..'),'Run from this checkout backend directory');
// Override provider credentials BEFORE dotenv/service imports. Original secrets are
// never used; checkout uses the existing injected mockClient contract only.
Object.assign(process.env,{SAFEPAY_PUBLIC_KEY:'synthetic-browser-public',SAFEPAY_SECRET_KEY:'synthetic-browser-secret',SAFEPAY_WEBHOOK_SECRET:'synthetic-smart-hub-browser-hmac-only',TRANSACTIONAL_EMAIL_MODE:'mock',B6_FINANCIAL_GATE_ENABLED:'false',B6_B5_INVENTORY_RECONCILED:'false',B6_TAX_POLICY_APPROVED:'false'});
const browserPort=Number(process.env.SMART_HUB_BROWSER_PORT||3000);
assert.ok(Number.isSafeInteger(browserPort)&&browserPort>=1024&&browserPort<=65535,'Explicit local test browser port required');
const apiPort=Number(process.env.SMART_HUB_BACKEND_PORT||5217);
assert.ok(Number.isSafeInteger(apiPort)&&apiPort>=1024&&apiPort<=65535&&apiPort!==browserPort,'Explicit separate local test API port required');
process.env.MILJOR_TEST_API_PORT=String(apiPort);
const apiOrigin='http://127.0.0.1:'+apiPort;
const root=path.resolve(__dirname,'../..'),base='http://localhost:'+browserPort;
const artifactDir=path.join(root,'backend','artifacts','smart-hub-paid-browser');
const evidence={status:'BLOCKED',provider_evidence:'SYNTHETIC signed sandbox callback; genuine provider success NOT VERIFIED',target_database:'miljor_test_db',database_identity_verified:false,tax_contract:'TEST ONLY: current no-tax-calculated contract; production tax approval NOT VERIFIED',checks:[],scenarios:[],deferred:[]};
// Explicit future integration hooks: do not implement another owner's finance contract.
async function integrationHook(name,context){
  const hook=process.env[name];if(!hook)return;
  const resolved=path.resolve(__dirname,hook);
  assert.ok(resolved.startsWith(__dirname+path.sep)&&path.basename(resolved).startsWith('smart_hub_paid_browser'),'Integration hooks must be owned test files');
  await require(resolved)(context);
}
const pass=label=>{evidence.checks.push(label);console.log('PASS SYNTHETIC PAID CHROMIUM: '+label);};
async function main(){
  fs.mkdirSync(artifactDir,{recursive:true});
  let db,server,vite,browser;
  const pages=[];
  try{
    const {chromium}=require('playwright');
    browser=await chromium.launch({headless:true});
    db=require('../src/config/db');await fixtureTools.identity(db);evidence.database_identity_verified=true;
    const fixture=await fixtureTools.seed(db);
    server=require('../server').listen(apiPort,'127.0.0.1');
    await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
    // Strict port prevents accidentally exercising another developer's frontend.
    vite=spawn(process.execPath,[path.join(root,'frontend/node_modules/vite/bin/vite.js'),'--host','localhost','--port',String(browserPort),'--strictPort'],{cwd:path.join(root,'frontend'),env:{...process.env},stdio:['ignore','pipe','pipe']});
    const logs=[];for(const stream of [vite.stdout,vite.stderr])stream.on('data',chunk=>{logs.push(String(chunk));if(logs.length>20)logs.shift();});
    let ready=false;
    for(let attempt=0;attempt<80;attempt++){
      if(vite.exitCode!==null)throw Error('Vite failed to start (port must be free): '+logs.join('').slice(-1500));
      try{if(logs.join('').includes('Local:')){const response=await fetch(base,{signal:AbortSignal.timeout(500)});if(response.ok){ready=true;break;}}}catch{}
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    assert.ok(ready,'Local frontend did not become ready');
    const context=async()=>browser.newContext({baseURL:base,viewport:{width:1440,height:1100},timezoneId:'Asia/Karachi'});
    async function signin(user,ui=true,password=fixture.password){
      const ctx=await context();
      if(!ui){const response=await ctx.request.post(base+'/api/v1/auth/login',{data:{identifier:user.email,password}});assert.equal(response.status(),200);const body=await response.json();assert.equal(body.data.user.role,user.role);user.token=body.data.token;assert.ok(user.token);return;}
      const page=await ctx.newPage();pages.push(page);user.page=page;
      await page.goto(base+'/login');await page.locator('input[type=email]').fill(user.email);await page.locator('input[type=password]').fill(password);
      const login=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/auth/login'&&r.request().method()==='POST');
      await page.getByRole('button',{name:/sign in/i}).click();
      const response=await login;assert.equal(response.status(),200);const body=await response.json();
      assert.equal(body.data.user.role,user.role);user.token=body.data.token;assert.ok(user.token);
      assert.ok((await ctx.cookies()).some(cookie=>cookie.name==='miljor_refresh'&&cookie.httpOnly));
      assert.equal(await page.evaluate(()=>localStorage.getItem('miljor_token')),null);
    }
    await signin(fixture.buyer);await signin(fixture.supplier);await signin(fixture.foreignBuyer,false);await signin(fixture.foreignSupplier,false);
    pass('Real buyer/supplier UI login, issued JWTs, HttpOnly refresh and foreign accounts');
    async function api(user,method,endpoint,body,status=200,code=null,headers={}){
      const stableHeaders={'Content-Type':'application/json',...(user?{Authorization:'Bearer '+user.token}:{}),'X-Idempotency-Key':fixtureTools.key(crypto.randomBytes(8).toString('hex')),...headers};
      let response,result;
      for(let retry=0;retry<30;retry++){
       response=await fetch(apiOrigin+'/api/v1'+endpoint,{method,signal:AbortSignal.timeout(20000),headers:stableHeaders,...(body==null?{}:{body:JSON.stringify(body)})});
       result=await response.json();
       if(status<300&&response.status===409&&result.error?.code==='CONCURRENT_REQUEST'){await new Promise(resolve=>setTimeout(resolve,100));continue;}break;
      }
      assert.equal(response.status,status,method+' '+endpoint+': '+(result.error?.code||'unexpected response'));
      if(code)assert.equal(result.error?.code,code);
      if(status<300)assert.equal(result.success,true,endpoint);
      return status<300?result.data:result;
    }
    async function runScenario(fixture,partial=false,extra=false){
    const prefix=extra?'extra-fee-':partial?'partial-':'';
    await fixtureTools.award(api,db,fixture);
    pass('Canonical API request, supplier quote, B6 blocked-by-default check, exact test tax/fee gate and two inventory holds');
    const oid=fixture.order.id,orderBase='/procurement/orders/'+oid;
    await api(fixture.supplier,'POST',`/fulfillment/supplier/orders/${oid}/transition`,{to_status:'PREPARING'},422,'UNPAID_ORDER_NOT_IN_FULFILLMENT');
    await fixtureTools.pay(api,db,fixture);
    pass('Injected sandbox checkout, rejected bad HMAC, signed HTTP callback, concurrent replay, one payment and committed inventory');
    const buyer=fixture.buyer.page,supplier=fixture.supplier.page;
    async function action(page,locator,endpoint,status=200,method='POST'){
      const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1'+endpoint&&r.request().method()===method,{timeout:20000});
      await locator.click();let res;try{res=await response;}catch(error){console.error('BROWSER_ACTION_DIAGNOSTIC',JSON.stringify({endpoint,path:new URL(page.url()).pathname,text:(await page.locator('body').innerText()).slice(0,1500)}));throw error;}const body=await res.json();assert.equal(res.status(),status,endpoint+': '+(body.error?.code||''));assert.equal(body.success,true);return {data:body.data,request:res.request()};
    }
    async function buyerPanel(navigate=true){
      if(navigate)await buyer.goto(base+'/orders');
      const card=buyer.locator('article').filter({hasText:fixture.order.order_code});await card.waitFor();
      await card.getByText('Delivery, proof and line receipts',{exact:true}).click();
      return card;
    }
    let panel=await buyerPanel();
    await panel.getByLabel('Verified address',{exact:true}).selectOption(String(fixture.addressId));
    await panel.getByLabel('Pakistan delivery date',{exact:true}).fill(new Date(Date.now()+86400000).toISOString().slice(0,10));
    await panel.getByLabel('I approve this destination, window and handling.',{exact:true}).check();
    const choice=await action(buyer,panel.getByRole('button',{name:'Request delivery window',exact:true}),orderBase+'/delivery');
    assert.equal(choice.data.locked_delivery_fee,'25.00');
    // Replay actual browser request over real JWT/API, preserving its intent key.
    const requestHeaders=choice.request.headers();
    const replay=await api(fixture.buyer,'POST',orderBase+'/delivery',choice.request.postDataJSON(),200,null,{'X-Idempotency-Key':requestHeaders['x-idempotency-key']});assert.deepEqual(replay,choice.data,'HTTP guard preserves exact original response');
    await api(fixture.foreignBuyer,'GET',orderBase+'/delivery',null,404);
    await api(fixture.supplier,'POST',orderBase+'/delivery',choice.request.postDataJSON(),403);
    await supplier.goto(base+'/orders');
    const routes=supplier.getByRole('region',{name:'Supplier delivery coordination',exact:true});
    await routes.getByRole('button',{name:'Open or refresh delivery workspace',exact:true}).click();
    await routes.getByText('Configure vehicle capacity',{exact:true}).click();
    const vehicleRef='SYNTHETIC-'+fixture.tag;
    await routes.getByLabel('Vehicle reference',{exact:true}).fill(vehicleRef);
    await routes.getByLabel('Maximum weight (kg)',{exact:true}).fill(partial?'6000':'100');
    await routes.getByLabel('Maximum liquid volume (litres)',{exact:true}).fill('0');
    await action(supplier,routes.getByRole('button',{name:'Save vehicle',exact:true}),'/procurement/delivery/vehicles');
    const vehicle=await routes.getByLabel('Vehicle',{exact:true}).locator('option').filter({hasText:vehicleRef}).getAttribute('value');
    await routes.getByLabel('Vehicle',{exact:true}).selectOption(vehicle);
    await routes.getByLabel(new RegExp(fixture.order.order_code)).check();
    await routes.getByLabel('Total planned route cost (PKR)',{exact:true}).fill('20.00');
    await routes.getByLabel('I confirm handling compatibility and declared route cost.',{exact:true}).check();
    const proposed=await action(supplier,routes.getByRole('button',{name:'Create proposed route',exact:true}),'/procurement/delivery/runs');
    const runId=proposed.data.run_id,runPath='/procurement/delivery/runs/'+runId+'/actions';
    const createRequest=proposed.request;
    const routeReplay=await api(fixture.supplier,'POST','/procurement/delivery/runs',createRequest.postDataJSON(),200,null,{'X-Idempotency-Key':createRequest.headers()['x-idempotency-key']});assert.deepEqual(routeReplay,proposed.data);
    await api(fixture.buyer,'POST',runPath,{action:'CONFIRM'},403);
    await api(fixture.foreignSupplier,'POST',runPath,{action:'CONFIRM'},404);
    await action(supplier,routes.getByRole('button',{name:'Confirm route',exact:true}),runPath);
    await supplier.screenshot({path:path.join(artifactDir,prefix+'01-synthetic-route-confirmed.png'),fullPage:true});
    pass('Buyer UI delivery choice and supplier UI vehicle/route; exact locked fee, role/foreign rejection and durable duplicate replay');
    await supplier.getByRole('button',{name:'Manage '+fixture.order.order_code,exact:true}).click();
    const fulfillment=supplier.getByRole('region',{name:'Selected fulfillment order',exact:true});
    const transitionPath=`/fulfillment/supplier/orders/${oid}/transition`;
    await action(supplier,fulfillment.getByRole('button',{name:'Start preparation',exact:true}),transitionPath);
    await action(supplier,fulfillment.getByRole('button',{name:'Mark ready for dispatch',exact:true}),transitionPath);
    await fulfillment.getByLabel('Dispatch / pickup reference',{exact:true}).fill('SYNTHETIC-HANDOFF-'+fixture.tag);
    await action(supplier,fulfillment.getByRole('button',{name:'Record dispatch / pickup handoff',exact:true}),transitionPath);
    await action(supplier,routes.getByRole('button',{name:'Confirm route dispatched',exact:true}),runPath);
    if(extra){
      const supplemental=await require('./smart_hub_paid_browser_extra_fee')({api,db,fixture,buyer,supplier,fulfillment,routes,runPath,action,buyerPanel,artifactDir,signin});
      evidence.scenarios.push({...supplemental,run_id:runId});
      await integrationHook('SMART_HUB_PAID_BROWSER_EXTRA_FEE_HOOK',{api,db,fixture,buyer,supplier});
      pass('Browser failed delivery, synthetic separate fee, paid resume, new same-vehicle route, second delivery/proof, final line receipts, canonical buyer confirmation, admin fee retention and DISABLED canonical payout preparation');
      return {buyer,supplier,runId};
    }
    await fulfillment.getByText('Delivery, proof and line receipts',{exact:true}).click();
    // Actual screenshot bytes uploaded through the file input and real private API.
    const proofBytes=await supplier.screenshot();
    await fulfillment.getByLabel('PNG, JPEG or PDF, at most 1 MB',{exact:true}).setInputFiles({name:'synthetic-delivery-proof.png',mimeType:'image/png',buffer:proofBytes});
    const uploaded=await action(supplier,fulfillment.getByRole('button',{name:'Upload proof',exact:true}),orderBase+'/evidence',201);
    const proof=uploaded.data.proof;
    await api(fixture.foreignBuyer,'GET',orderBase+'/evidence/'+proof.id,null,404);
    await api(fixture.foreignSupplier,'GET',orderBase+'/evidence/'+proof.id,null,404);
    const uploadReplay=await api(fixture.supplier,'POST',orderBase+'/evidence',uploaded.request.postDataJSON(),200,null,{'X-Idempotency-Key':uploaded.request.headers()['x-idempotency-key']});assert.equal(uploadReplay.is_replay,true);assert.equal(uploadReplay.proof.id,proof.id);
    await fulfillment.getByLabel('Delivery evidence / operational notes',{exact:true}).fill('Synthetic browser delivery proof uploaded; no real delivery or provider settlement claimed.');
    await action(supplier,fulfillment.getByRole('button',{name:'Report delivered / collected',exact:true}),transitionPath);
    await action(supplier,routes.getByRole('button',{name:'Close delivered route',exact:true}),runPath);
    await supplier.screenshot({path:path.join(artifactDir,prefix+'02-synthetic-delivery-proof.png'),fullPage:true});
    pass('Supplier UI preparation, dispatch, private proof upload, delivered report and route close; foreign proof denial and upload replay');
    panel=await buyerPanel();
    const downloadEvent=buyer.waitForEvent('download');await panel.getByRole('button',{name:'Download privately',exact:true}).click();
    const download=await downloadEvent;const downloadPath=path.join(artifactDir,prefix+'03-synthetic-proof-download.png');await download.saveAs(downloadPath);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(downloadPath)).digest('hex'),crypto.createHash('sha256').update(proofBytes).digest('hex'));
    const invoice=await action(supplier,fulfillment.getByRole('button',{name:'View authoritative invoice',exact:true}),`/invoices/${oid}`,200,'GET');
    assert.equal(Number(invoice.data.invoice.total_amount),Number(fixture.order.total_amount));
    assert.equal(Number(invoice.data.invoice.tax_amount),0,'Isolated zero-tax test contract only');
    await panel.getByRole('button',{name:'Review ordered products',exact:true}).click();
    await panel.getByLabel('received',{exact:true}).first().waitFor();
    assert.equal(await panel.getByLabel('received',{exact:true}).count(),2);
    const receiptInput={fee_policy:{version:'R4_ACCEPTED_MERCHANDISE_V1',accepted:true},lines:(await api(fixture.buyer,'GET',orderBase+'/line-receipts')).lines.map(line=>({award_line_id:line.award_line_id,received_quantity:line.ordered_quantity,accepted_quantity:line.ordered_quantity,disputed_quantity:'0'}))};
    await api(fixture.supplier,'POST',orderBase+'/line-receipts',receiptInput,403);
    await api(fixture.foreignBuyer,'POST',orderBase+'/line-receipts',receiptInput,404);
    await api(fixture.buyer,'POST',orderBase+'/line-receipts',{...receiptInput,lines:[{...receiptInput.lines[0],award_line_id:2147483647}]},403,'FOREIGN_AWARD_LINE');
    if(partial){
      for(let index=0;index<2;index++){
        await panel.getByLabel('received',{exact:true}).nth(index).fill('80');
        await panel.getByLabel('accepted',{exact:true}).nth(index).fill('80');
        await panel.getByLabel('disputed',{exact:true}).nth(index).fill('20');
        await panel.getByLabel('Dispute reason',{exact:true}).nth(index).selectOption('QUANTITY_MISMATCH');
        await panel.getByLabel('Evidence notes',{exact:true}).nth(index).fill('Synthetic partial receipt: 80 of 100 bags received; 20 missing.');
      }
    }
    await panel.getByLabel('I accept commission on accepted products and disputed delivery/processing fees held for admin review. Historical invoice terms remain recorded.',{exact:true}).check();
    const receipt=await action(buyer,panel.getByRole('button',{name:'Submit final product receipts',exact:true}),orderBase+'/line-receipts');
    assert.equal(receipt.data.receipt.lines.length,2);assert.equal(receipt.data.receipt.dispute_recorded,partial);
    for(const line of receipt.data.receipt.lines){
      assert.equal(line.received_quantity,partial?'80.0000':line.ordered_quantity);assert.equal(line.accepted_quantity,partial?'80.0000':line.ordered_quantity);assert.equal(line.disputed_quantity,partial?'20.0000':'0.0000');assert.equal(line.refund_assessment_amount,partial?'2000.00':'0.00');
    }
    const receiptReplay=await Promise.all([1,2].map(()=>api(fixture.buyer,'POST',orderBase+'/line-receipts',receipt.request.postDataJSON(),200,null,{'X-Idempotency-Key':receipt.request.headers()['x-idempotency-key']})));
    for(const result of receiptReplay)assert.deepEqual(result,receipt.data,'HTTP retries return the exact persisted response');
    assert.deepEqual(receiptReplay[0].receipt,receipt.data.receipt);
    await buyer.reload();panel=await buyerPanel(false);await panel.getByRole('button',{name:'Review ordered products',exact:true}).click();
    await panel.getByText(/Product line .*Final receipt recorded/).first().waitFor();
    assert.equal(await panel.getByText(/Product line .*Final receipt recorded/).count(),2);
    await buyer.screenshot({path:path.join(artifactDir,partial?'partial-04-synthetic-80-20-line-receipts.png':'04-synthetic-full-line-receipts.png'),fullPage:true});
    const [[totals]]=await db.query('SELECT (SELECT COUNT(*) FROM procurement_line_receipts WHERE order_id=?) receipts,(SELECT COUNT(*) FROM procurement_line_receipt_submissions WHERE order_id=?) submissions,(SELECT COUNT(*) FROM procurement_delivery_stops WHERE order_id=? AND is_current=1) stops,(SELECT COUNT(*) FROM procurement_delivery_evidence WHERE order_id=?) proofs',[oid,oid,oid,oid]);
    assert.deepEqual(Object.values(totals).map(Number),[2,1,1,1]);
    pass('Buyer UI downloads byte-identical proof and finalizes two '+(partial?'80/20 partial':'full undisputed')+' line receipts; JWT ownership/foreign-line denial, concurrent replay and reload persistence');
    if(partial){
      await signin(fixture.admin,false,fixture.password);
      const reviewed=await require('./smart_hub_paid_browser_partial_review')({api,db,fixture});
      evidence.scenarios.push({name:'partial-80-20-financial-review',status:'PASS',order_id:oid,run_id:runId,...reviewed});
      await integrationHook('SMART_HUB_PAID_BROWSER_PARTIAL_RECEIPT_HOOK',{api,db,fixture,buyer,supplier});
      pass('Actual FINANCE_ADMIN login; exact fee split, immutable review, canonical prepare/approve and DISABLED refund/payout checks');
    }else evidence.scenarios.push({name:'full-undisputed',status:'PASS',order_id:oid,run_id:runId});
    return {buyer,supplier,runId};
    }
    const full=await runScenario(fixture);
    const partial=await fixtureTools.seed(db,{quantities:['100','100'],stock:250});
    for(const user of [partial.buyer,partial.supplier,partial.foreignBuyer,partial.foreignSupplier])await signin(user,['BUYER','SUPPLIER'].includes(user.role)&&[partial.buyer,partial.supplier].includes(user),partial.password);
    await runScenario(partial,true);
    const extra=await fixtureTools.seed(db);
    for(const user of [extra.buyer,extra.supplier,extra.foreignBuyer,extra.foreignSupplier])await signin(user,[extra.buyer,extra.supplier].includes(user),extra.password);
    await runScenario(extra,false,true);
    evidence.status='PASS';evidence.order_id=fixture.order.id;evidence.run_id=full.runId;
  }catch(error){
    evidence.status=['MODULE_NOT_FOUND','ECONNREFUSED','ENOENT'].includes(error.code)||/Executable doesn't exist/.test(error.message)?'BLOCKED':'FAIL';evidence.blocker=error.message;
    for(const [index,page] of pages.entries())await page.screenshot({path:path.join(artifactDir,'failure-'+index+'.png'),fullPage:true}).catch(()=>{});
    throw error;
  }finally{
    fs.writeFileSync(path.join(artifactDir,'evidence.json'),JSON.stringify(evidence,null,2));
    await browser?.close();
    if(vite&&vite.exitCode===null){vite.kill();await Promise.race([new Promise(resolve=>vite.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);}
    if(server?.listening)await new Promise(resolve=>server.close(resolve));
    if(db)await db.end();
  }
}
main().catch(error=>{console.error('SMART_HUB_PAID_BROWSER_FAILED',error.stack);process.exitCode=1;});
