'use strict';
// Actual Chromium UI verification on disposable seeded supplier account.
// No mocked UI or API; authenticated through the live HTTP service.
const assert=require('node:assert/strict');
assert.equal(process.env.NODE_ENV,'test');
assert.equal(process.env.DB_NAME,'miljor_test_db');
assert.equal(process.env.MILJOR_TEST_ONLY_MIGRATIONS,'1');
const {chromium}=require('playwright');
const base=process.env.P0_BROWSER_BASE_URL||'http://127.0.0.1:3000';
async function main(){
  const password=process.env.P0_BROWSER_TEST_PASSWORD;
  assert.ok(password&&password.length>=16,'Test fixture password missing');
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try{
    const ctx=await browser.newContext({baseURL:base});
    const page=await ctx.newPage();
    await page.goto(base+'/login',{waitUntil:'domcontentloaded'});
    await page.locator('input[type=email]').fill('p0_supplier@miljor.test');
    await page.locator('input[type=password]').fill(password);
    const responsePromise=page.waitForResponse(r=>r.url().includes('/api/v1/auth/login'),{timeout:20000});
    await page.getByRole('button',{name:/sign in/i}).click();
    const response=await responsePromise;
    assert.equal(response.status(),200,'Real supplier login failed');
    const login=await response.json();
    assert.equal(login.data.user.role,'SUPPLIER');
    await page.goto(base+'/supplier/procurement',{waitUntil:'domcontentloaded'});
    await page.getByRole('heading',{name:'Procurement Opportunities'}).waitFor({timeout:20000});
    const tabs=page.getByRole('tablist',{name:'Opportunity type'});
    await tabs.getByRole('tab',{name:/All/}).waitFor({timeout:10000});
    await page.getByRole('status',{name:/Loading eligible invitations/i}).count().catch(()=>0);
    // Wait for request completion, not a hardcoded mocked card.
    await page.waitForFunction(()=>!Array.from(document.querySelectorAll('[role=status]'))
      .some(el=>el.textContent.includes('Loading eligible invitations')),null,{timeout:20000});
    const error=page.getByRole('alert');
    assert.equal(await error.count(),0,'Supplier opportunities returned an error');
    await tabs.getByRole('tab',{name:/Single/}).click();
    await page.waitForFunction(()=>!Array.from(document.querySelectorAll('[role=status]'))
      .some(el=>el.textContent.includes('Loading eligible invitations')),null,{timeout:20000});
    assert.equal(await tabs.getByRole('tab',{name:/Single/}).getAttribute('aria-selected'),'true');
    await tabs.getByRole('tab',{name:/Grouped/}).click();
    await page.waitForFunction(()=>!Array.from(document.querySelectorAll('[role=status]'))
      .some(el=>el.textContent.includes('Loading eligible invitations')),null,{timeout:20000});
    assert.equal(await tabs.getByRole('tab',{name:/Grouped/}).getAttribute('aria-selected'),'true');
    assert.equal(await page.getByText('Procurement Opportunities',{exact:true}).count(),1);
    const cookies=await ctx.cookies();
    assert.ok(cookies.some(c=>c.name==='miljor_refresh'&&c.httpOnly));
    console.log('PASS CHROMIUM: authenticated supplier, unified inbox, All/Single/Grouped, empty/error safety and HttpOnly session');
    await ctx.close();
  }finally{await browser.close();}
}
main().catch(e=>{console.error('FAIL CHROMIUM PR61 PART1',e);process.exitCode=1;});
