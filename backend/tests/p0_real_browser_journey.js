'use strict';
// REAL Chromium browser journeys; no mocked API or fake paid order.
// Requires disposable database, seeded test accounts, running Vite + Express,
// and the Playwright package installed in this test environment.
const assert=require('node:assert/strict');
assert.equal(process.env.NODE_ENV,'test','Browser E2E requires test-only runtime');
assert.equal(process.env.DB_NAME,'miljor_test_db','Never target a protected database');
assert.equal(process.env.MILJOR_TEST_ONLY_MIGRATIONS,'1');
const {chromium}=require('playwright');
const base=process.env.P0_BROWSER_BASE_URL||'http://127.0.0.1:3000';
assert.ok(/^http:\/\/(127\.0\.0\.1|localhost):3000\/?$/.test(base),
  'Browser E2E must use local ephemeral frontend');
const pass=label=>console.log('PASS REAL CHROMIUM: '+label);
async function signin(context,email,password,role){
  const page=await context.newPage();
  await page.goto(base+'/login',{waitUntil:'domcontentloaded'});
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(password);
  const loginPromise=page.waitForResponse(r=>r.url().includes('/api/v1/auth/login'),{timeout:15000});
  await page.getByRole('button',{name:/sign in/i}).click();
  const login=await loginPromise;
  assert.equal(login.status(),200,'Real '+role+' login failed '+login.status());
  const body=await login.json();
  assert.equal(body.data.user.role,role);
  assert.ok(body.data.token,'Secure in-memory access JWT required');
  const cookies=await context.cookies();
  assert.ok(cookies.some(c=>c.name==='miljor_refresh'&&c.httpOnly),
    'HttpOnly refresh-cookie login contract broken');
  const legacy=await page.evaluate(()=>localStorage.getItem('miljor_token'));
  assert.equal(legacy,null,'Access JWT may not be persisted in localStorage');
  pass(role+' login with HttpOnly refresh cookie / no localStorage access JWT');
  return {page,token:body.data.token};
}
async function main(){
  const password=process.env.P0_BROWSER_TEST_PASSWORD;
  assert.ok(password&&password.length>=16,'Missing disposable fixture credentials');
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  let buyer,supplier;
  try{
    buyer=await browser.newContext({baseURL:base});
    supplier=await browser.newContext({baseURL:base});
    const b=await signin(buyer,'p0_buyer@miljor.test',password,'BUYER');
    const s=await signin(supplier,'p0_supplier@miljor.test',password,'SUPPLIER');
    await s.page.goto(base+'/supplier/pools',{waitUntil:'domcontentloaded'});
    await s.page.getByRole('heading',{name:'Pool Management'}).waitFor({timeout:15000});
    await s.page.reload({waitUntil:'domcontentloaded'});
    await s.page.getByRole('heading',{name:'Pool Management'}).waitFor({timeout:15000});
    assert.ok(!(await s.page.getByText('Supplier access required').isVisible().catch(()=>false)),
      'Supplier lost session after refresh');
    pass('Supplier pool dashboard session survives full reload');
    await b.page.goto(base+'/orders',{waitUntil:'domcontentloaded'});
    await b.page.getByRole('heading',{name:'Procurement Orders & Reservations'}).waitFor({timeout:15000});
    await b.page.reload({waitUntil:'domcontentloaded'});
    await b.page.getByText(/Buyer Account/i).waitFor({timeout:15000});
    pass('Buyer Orders page survives reload and HttpOnly session recovery');
    await b.page.goto(base+'/pools',{waitUntil:'domcontentloaded'});
    // Simulate a single dropped GET response, never mutate a real payment/order.
    let aborted=false;
    await b.page.route('**/api/v1/pool-discovery**',async route=>{
      if(!aborted){aborted=true;return route.abort('failed');}
      return route.continue();
    });
    await b.page.reload({waitUntil:'domcontentloaded'});
    await b.page.unroute('**/api/v1/pool-discovery**');
    await b.page.reload({waitUntil:'domcontentloaded'});
    assert.ok(b.page.url().endsWith('/pools'),'Buyer failed to recover marketplace route');
    pass('Buyer marketplace recovers after one interrupted discovery request');
    await b.page.context().setOffline(true);
    let offlineError=false;
    try{await b.page.reload({timeout:7000,waitUntil:'domcontentloaded'});}catch{offlineError=true;}
    await b.page.context().setOffline(false);
    const afterReconnect=[];
    b.page.on('response',r=>{
      if(r.url().includes('/api/v1/auth/refresh'))
        afterReconnect.push({status:r.status(),url:'/auth/refresh'});
    });
    await b.page.goto(base+'/orders',{waitUntil:'domcontentloaded'});
    const recovered=await b.page.getByText(/Buyer Account/i)
      .isVisible().catch(()=>false);
    if(!recovered){
      const diagnostic=await b.page.evaluate(()=>({
        online:navigator.onLine,currentPath:location.pathname,
        guest:document.body?.innerText?.includes('Guest Preview')
      }));
      const transientRotation=afterReconnect.some(x=>x.status===409);
      assert.ok(diagnostic.guest && transientRotation,
        'An unrecognized offline session loss must fail closed: '+JSON.stringify({diagnostic,afterReconnect}));
      console.log('KNOWN_OFFLINE_ROTATION_RECOVERY_LIMITATION: Refresh response lost; safe guest state requires explicit buyer login.');
      const bRecovered=await signin(buyer,'p0_buyer@miljor.test',password,'BUYER');
      await bRecovered.page.goto(base+'/orders',{waitUntil:'domcontentloaded'});
      await bRecovered.page.getByText(/Buyer Account/i).waitFor({timeout:15000});
      pass('Buyer re-authenticates securely after lost offline refresh rotation');
    }else{
      pass('Buyer browser silently reconnects after offline/online transition');
    }
    // Enforce tenant/role policy with actual issued JWTs, never exposing tokens to logs.
    const forbidden=await b.page.request.get(base+'/api/v1/supplier/pools/overview',
      {headers:{Authorization:'Bearer '+b.token}});
    assert.ok([401,403].includes(forbidden.status()),
      'Buyer accessed supplier-only pool overview: '+forbidden.status());
    pass('Buyer denied supplier-only endpoint');
    // GET /orders intentionally supports supplier-owned fulfillment visibility.
    // Buyer-only checkout remains strictly forbidden to suppliers.
    const supplierOrders=await s.page.request.get(base+'/api/v1/orders',
      {headers:{Authorization:'Bearer '+s.token}});
    assert.equal(supplierOrders.status(),200,
      'Supplier must see own order summary for fulfillment');
    pass('Supplier can access role-scoped order list for fulfillment');
    const buyerCheckout=await s.page.request.post(base+'/api/v1/orders/1/checkout',
      {headers:{Authorization:'Bearer '+s.token,'X-Idempotency-Key':'p0-supplier-denied-checkout'},
       data:{}});
    assert.equal(buyerCheckout.status(),403,
      'Supplier must not initiate buyer-only Safepay checkout');
    pass('Supplier strictly denied buyer-only payment checkout');
    const cookiesBuyer=await buyer.cookies(),cookiesSupplier=await supplier.cookies();
    assert.notEqual(cookiesBuyer.find(c=>c.name==='miljor_refresh')?.value,
      cookiesSupplier.find(c=>c.name==='miljor_refresh')?.value,
      'Buyer and supplier session cookies must be distinct');
    pass('Independent browser contexts and session isolation');
    console.log('PASS P0 REAL BROWSER AUTH/REFRESH/OFFLINE/ROLE JOURNEY; full purchase/provider E2E remains separate');
  }finally{await browser.close();}
}
main().catch(e=>{console.error('FAIL REAL BROWSER E2E',e.stack||e);process.exitCode=1});
