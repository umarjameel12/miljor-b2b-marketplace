// Optional REAL-browser read-only B7 smoke gate.
// Requires Playwright installed in the operator's isolated test environment.
// No buyer confirmation, dispute, checkout, refund or stock mutation is attempted.
const {spawnSync}=await import('node:child_process');
const base=process.env.B7_BROWSER_URL||'';
const allowed=/^http:\/\/(localhost|127\.0\.0\.1):\d+$/;
if(process.env.B7_BROWSER_READONLY_ACCEPTANCE!=='YES'||!allowed.test(base)){
 console.error('BLOCKED: set B7_BROWSER_READONLY_ACCEPTANCE=YES and B7_BROWSER_URL=http://localhost:<vite-port>');
 process.exit(1);
}
if(process.env.B7_BACKEND_TEST_DB_CONFIRMED!=='YES'){
 console.error('BLOCKED: verify backend connects ONLY to disposable miljor_test_db first.');
 process.exit(1);
}
let chromium;
try{({chromium}=await import('playwright'))}
catch{console.error('BLOCKED: Playwright is not installed. Use an isolated browser test environment with Playwright.');process.exit(1)}
const accounts=[
 ['BUYER',process.env.B7_BUYER_EMAIL,process.env.B7_BUYER_PASSWORD],
 ['SUPPLIER',process.env.B7_SUPPLIER_EMAIL,process.env.B7_SUPPLIER_PASSWORD]
];
if(accounts.some(([,email,password])=>!email||!password)){
 console.error('BLOCKED: provide dedicated B7_BUYER_* and B7_SUPPLIER_* disposable test accounts.');
 process.exit(1);
}
const browser=await chromium.launch({headless:true});
let ok=0;
try{
 for(const [role,email,password] of accounts){
  const context=await browser.newContext();
  const page=await context.newPage();
  try{
   await page.goto(base+'/login',{waitUntil:'domcontentloaded'});
   await page.locator('input[type=email]').fill(email);
   await page.locator('input[type=password]').fill(password);
   await page.locator('button[type=submit]').click();
   await page.waitForURL(url=>!url.pathname.includes('/login'),{timeout:15000});
   await page.goto(base+'/post-purchase',{waitUntil:'domcontentloaded'});
   await page.getByText('Post-Purchase Operations',{exact:true}).waitFor();
   await page.getByText('Paid orders',{exact:true}).waitFor();
   const forbidden=await page.getByText('Sign in as a business buyer or supplier',{exact:false}).count();
   if(forbidden)throw Error(role+' role was not authorized for postpurchase screen');
   const errors=await page.locator('[role=alert]').allTextContents();
   if(errors.length)throw Error(role+' screen failed to load: '+errors.join('; '));
   const candidate=page.locator('button').filter({hasText:/PKR/}).first();
   if(await candidate.count()){
    await candidate.click();
    await page.getByText('Tracking history',{exact:true}).waitFor();
   }
   console.log('PASS B7 browser '+role+' authenticated read-only postpurchase journey');
   ok++;
  }finally{await context.close()}
 }
 console.log('B7 BROWSER READONLY: '+ok+'/2 PASS; write E2E and financial release still separate gates.');
}finally{await browser.close()}
