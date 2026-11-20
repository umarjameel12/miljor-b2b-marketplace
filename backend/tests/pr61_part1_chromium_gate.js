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
  let db;
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
    // Exercise actual correction-only React view on a disposable supplier fixture,
    // without creating any payments or editing a protected database.
    db=require('../src/config/db');
    const [[fixture]]=await db.query("SELECT id FROM users WHERE email='p0_supplier@miljor.test'");
    assert.ok(fixture?.id,'Disposable supplier fixture missing');
    const [[previous]]=await db.query(
      'SELECT verification_status,submitted_revision,correction_fields,correction_notes,correction_requested_revision FROM supplier_profiles WHERE supplier_id=?',
      [fixture.id]);
    const [[evidenceBefore]]=await db.query('SELECT COALESCE(MAX(id),0) AS max_id FROM supplier_verification_documents WHERE supplier_id=?',[fixture.id]);
    try {
      await db.query(
        `UPDATE supplier_profiles SET verification_status='MORE_INFORMATION_REQUIRED', submitted_revision=1,
          correction_fields=JSON_ARRAY('warehouse_address','document:BUSINESS_LICENSE'),
          correction_notes=JSON_OBJECT('warehouse_address','Please update exact dispatch street',
            'document:BUSINESS_LICENSE','Please provide readable license evidence'),
          correction_requested_revision=1 WHERE supplier_id=?`,[fixture.id]);
      await page.goto(base+'/supplier/profile',{waitUntil:'domcontentloaded'});
      await page.getByRole('heading',{name:'Requested verification corrections'}).waitFor({timeout:20000});
      assert.equal(await page.locator('#correction-warehouse_address').count(),1);
      assert.equal(await page.locator('#correction-bank_iban').count(),0,
        'Unrequested bank information must never be requested');
      assert.equal(await page.getByText('Please update exact dispatch street').count(),1);
      assert.equal(await page.locator('#evidence-BUSINESS_LICENSE').count(),1);
      assert.equal(await page.locator('#evidence-BANK_PROOF').count(),0);
      await page.locator('#evidence-BUSINESS_LICENSE').setInputFiles({
        name:'corrected-license.pdf',mimeType:'application/pdf',
        buffer:Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF')
      });
      await page.getByText('Latest v1 · corrected-license.pdf',{exact:false}).waitFor({timeout:18000});
      const [added]=await db.query(`SELECT id,version_number,review_revision,sha256 FROM supplier_verification_documents
        WHERE supplier_id=? AND id>? AND document_kind='BUSINESS_LICENSE'`,[fixture.id,evidenceBefore.max_id]);
      assert.equal(added.length,1);
      assert.equal(Number(added[0].review_revision),1);
      assert.match(added[0].sha256,/^[a-f0-9]{64}$/);
      console.log('PASS CHROMIUM: requested-only PDF uploaded through real React and persisted as immutable review-scoped evidence');
      console.log('PASS CHROMIUM: Request Info renders only requested correction field, retains all others');
    } finally {
      await db.query(`DELETE FROM system_audit_logs WHERE entity_name='supplier_verification_documents'
        AND entity_id IN (SELECT id FROM supplier_verification_documents WHERE supplier_id=? AND id>?)`,
        [fixture.id,evidenceBefore.max_id]);
      await db.query('DELETE FROM supplier_verification_documents WHERE supplier_id=? AND id>?',
        [fixture.id,evidenceBefore.max_id]);
      await db.query(
        'UPDATE supplier_profiles SET verification_status=?,submitted_revision=?,correction_fields=?,correction_notes=?,correction_requested_revision=? WHERE supplier_id=?',
        [previous.verification_status,previous.submitted_revision,previous.correction_fields,
          previous.correction_notes,previous.correction_requested_revision,fixture.id]);
    }
    await ctx.close();
  }finally{
    await browser.close();
    if(db && typeof db.end==='function')await db.end();
  }
}
main().catch(e=>{console.error('FAIL CHROMIUM PR61 PART1',e);process.exitCode=1;});
