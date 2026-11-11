'use strict';
// Full B7 buyer/supplier browser WRITE acceptance on two PRE-SEEDED PAID B6
// supplier orders in DISPOSABLE miljor_test_db. NO live payment/refund/payout.
// Requires Playwright installed separately in the test agent environment.
const assert=require('node:assert/strict');
const mysql=require('mysql2/promise');
require('dotenv').config();
const allowed=/^http:\/\/(localhost|127\.0\.0\.1):\d+$/;
const site=String(process.env.B7_BROWSER_URL||'');
const required=[
 'B7_BROWSER_WRITE_ACCEPTANCE','B7_BACKEND_TEST_DB_CONFIRMED',
 'B7_BROWSER_COMPLETE_ORDER_CODE','B7_BROWSER_SHORTAGE_ORDER_CODE',
 'B7_BUYER_EMAIL','B7_BUYER_PASSWORD','B7_SUPPLIER_EMAIL','B7_SUPPLIER_PASSWORD',
 'DB_USER','JWT_SECRET'
];
const reject=(why)=>{throw Error('B7_BROWSER_WRITE_BLOCKED: '+why)};
async function main(){
 if(required.some(x=>!process.env[x]))reject('All listed test-only environment variables are required.');
 if(process.env.B7_BROWSER_WRITE_ACCEPTANCE!=='YES'||
    process.env.B7_BACKEND_TEST_DB_CONFIRMED!=='YES'||
    process.env.NODE_ENV!=='test'||process.env.TEST_DB_NAME!=='miljor_test_db')
  reject('Explicit mutation consent and isolated test DB environment required.');
 if(!allowed.test(site))reject('Only localhost browser targets are allowed.');
 if(['miljor_db','miljor_sandbox_db'].includes(process.env.DB_NAME))
  reject('Refusing protected DB_NAME');
 let chromium;
 try{({chromium}=require('playwright'))}
 catch{reject('Install Playwright and Chromium in isolated E2E runner; no automatic install.')}
 const db=await mysql.createConnection({
  host:process.env.DB_HOST||'localhost',user:process.env.DB_USER,
  password:process.env.DB_PASSWORD||'',database:'miljor_test_db'
 });
 let browser=null;
 try{
  const [[identity]]=await db.query('SELECT DATABASE() AS name');
  assert.equal(identity.name,'miljor_test_db');
  const codes=[process.env.B7_BROWSER_COMPLETE_ORDER_CODE,process.env.B7_BROWSER_SHORTAGE_ORDER_CODE];
  if(codes[0]===codes[1])reject('Use distinct disposable supplier order fixtures.');
  const [orders]=await db.query(
   'SELECT id,order_code,buyer_id,supplier_id,notes,payment_status,fulfillment_status,total_amount FROM orders WHERE order_code IN (?,?)',
   codes);
  if(orders.length!==2)reject('Both real paid B6 order fixtures must exist.');
  const complete=orders.find(x=>x.order_code===codes[0]);
  const shortage=orders.find(x=>x.order_code===codes[1]);
  if(orders.some(x=>x.notes!=='SMART_PROCUREMENT_BASKET'||x.payment_status!=='PAID'||
     x.fulfillment_status!=='AWAITING_SUPPLIER_ACKNOWLEDGEMENT'))
   reject('Fixtures must be unprocessed paid B6 orders, not synthetic/updated statuses.');
  if(complete.buyer_id!==shortage.buyer_id||complete.supplier_id!==shortage.supplier_id)
   reject('Both fixtures must belong to the same dedicated test buyer and supplier.');
  const [sku]=await db.query(
   `SELECT l.id,l.quantity,l.supplier_sku_id FROM procurement_award_orders ao
      JOIN procurement_award_lines l ON l.award_order_id=ao.id WHERE ao.order_id=?`,
   [shortage.id]);
  if(sku.length!==1||String(sku[0].quantity)!=='100.0000')
   reject('Shortage fixture must contain exactly one 100.0000-unit immutable award line.');
  const [beforePayment]=await db.query(
    'SELECT id,escrow_status FROM payments WHERE order_id IN (?,?) ORDER BY id',
    [complete.id,shortage.id]);
  browser=await chromium.launch({headless:true});
  const logIn=async(role)=>{
   const context=await browser.newContext();
   const page=await context.newPage();
   await page.goto(site+'/login');
   await page.locator('input[type=email]').fill(process.env['B7_'+role+'_EMAIL']);
   await page.locator('input[type=password]').fill(process.env['B7_'+role+'_PASSWORD']);
   await page.locator('button[type=submit]').click();
   await page.waitForURL(url=>!url.pathname.includes('/login'),{timeout:20000});
   await page.goto(site+'/post-purchase');
   await page.getByText('Paid orders',{exact:true}).waitFor();
   return {context,page};
  };
  const pick=async(page,code)=>{
   const row=page.locator('button').filter({hasText:code}).first();
   await row.waitFor({timeout:15000});
   await row.click();
   await page.getByText('Tracking history',{exact:true}).waitFor();
  };
  const supplier=await logIn('SUPPLIER');
  try{
   for(const code of codes){
    await pick(supplier.page,code);
    for(const [from,to] of [
      ['AWAITING_SUPPLIER_ACKNOWLEDGEMENT','Preparing'],
      ['PREPARING','Ready for Dispatch'],
      ['READY_FOR_DISPATCH','Dispatched'],
      ['DISPATCHED','Supplier Delivered']
    ]){
      const button=supplier.page.getByRole('button',{name:'Move to '+to});
      await button.waitFor({timeout:15000});
      if(to==='Dispatched'){
       await supplier.page.getByRole('combobox',{name:'Actual supplier delivery method'})
         .selectOption('SUPPLIER_FLEET');
      }
      await button.click();
      if(to!=='Supplier Delivered'){
       const next=to==='Preparing'?'Ready for Dispatch':
        to==='Ready for Dispatch'?'Dispatched':'Supplier Delivered';
       await supplier.page.getByRole('button',{name:'Move to '+next})
        .waitFor({timeout:15000});
      }else{
       await supplier.page.getByText('supplier delivered',{exact:false}).first().waitFor();
      }
    }
   }
  }finally{await supplier.context.close()}
  const buyer=await logIn('BUYER');
  try{
   await pick(buyer.page,complete.order_code);
   await buyer.page.getByRole('button',{name:'Confirm complete receipt'}).click();
   await buyer.page.getByText('buyer confirmed',{exact:false}).first().waitFor();
   await buyer.page.getByRole('button',{name:'View authorized invoice'}).click();
   await buyer.page.locator('pre').waitFor({timeout:15000});
   await pick(buyer.page,shortage.order_code);
   await buyer.page.locator('input[placeholder="Actual received quantity"]').first().fill('80');
   await buyer.page.locator('textarea').first().fill('Only 80 units delivered from 100 units paid and ordered.');
   await buyer.page.getByRole('button',{name:'Report missing quantity'}).first().click();
   await buyer.page.getByText('exception',{exact:false}).first().waitFor({timeout:15000});
  }finally{await buyer.context.close()}
  const [final]=await db.query(
   'SELECT order_code,fulfillment_status FROM orders WHERE id IN (?,?)',
   [complete.id,shortage.id]);
  assert.equal(final.find(o=>o.order_code===complete.order_code).fulfillment_status,'BUYER_CONFIRMED');
  assert.equal(final.find(o=>o.order_code===shortage.order_code).fulfillment_status,'EXCEPTION');
  const [claims]=await db.query(
   'SELECT disputed_quantity,claimed_amount,evidence_metadata FROM order_disputes WHERE order_id=? ORDER BY id DESC LIMIT 1',
   [shortage.id]);
  assert.equal(String(claims[0]?.disputed_quantity),'20.0000');
  let evidence=claims[0].evidence_metadata;
  if(typeof evidence==='string')evidence=JSON.parse(evidence);
  assert.equal(Number(evidence.award_line_id),Number(sku[0].id));
  assert.equal(evidence.source,'IMMUTABLE_B6_AWARD_LINE');
  const [afterPayment]=await db.query(
    'SELECT id,escrow_status FROM payments WHERE order_id IN (?,?) ORDER BY id',
    [complete.id,shortage.id]);
  assert.deepEqual(afterPayment,beforePayment,'Browser delivery/dispute journey must not mutate payments.');
  console.log('B7 BROWSER WRITE E2E PASS: Supplier delivery; buyer full confirmation; 100->80 shortage; immutable SKU; zero payment mutation.');
 }finally{
  if(browser)await browser.close();
  await db.end();
 }
}
main().catch(e=>{console.error('B7 BROWSER WRITE E2E FAILED/BLOCKED:',e);process.exitCode=1});
