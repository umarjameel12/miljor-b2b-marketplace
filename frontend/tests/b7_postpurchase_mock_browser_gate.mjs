import assert from 'node:assert/strict';
import {chromium} from 'playwright';
// Real Chromium/UI interactions with isolated mocked HTTP responses.
// NO MySQL, live payments, data mutations or production backend connections.
const base=process.env.B7_VITE_URL||'http://127.0.0.1:5173';
if(!/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(base))throw Error('Only localhost allowed.');
const orders=[
 {id:91,order_code:'MJQ-TEST-RECEIPT',supplier_id:2,buyer_id:5,
 payment_status:'PAID',fulfillment_status:'SUPPLIER_DELIVERED',total_amount:'9400.00',
 delivery_fee:'150.00',notes:'SMART_PROCUREMENT_BASKET'},
 {id:92,order_code:'MJQ-TEST-SHORTAGE',supplier_id:2,buyer_id:5,
 payment_status:'PAID',fulfillment_status:'SUPPLIER_DELIVERED',total_amount:'8200.00',
 delivery_fee:'200.00',notes:'SMART_PROCUREMENT_BASKET'},
 {id:93,order_code:'MJQ-TEST-PREPARING',supplier_id:2,buyer_id:5,
 payment_status:'PAID',fulfillment_status:'AWAITING_SUPPLIER_ACKNOWLEDGEMENT',
 total_amount:'5000.00',delivery_fee:'100.00',notes:'SMART_PROCUREMENT_BASKET'}
];
const physicalLines={
 91:[{award_line_id:101,supplier_sku_id:1001,quantity:'100.0000',purchasing_unit:'kg',
 unit_price:'80.00',subtotal:'8000.00'},{award_line_id:102,supplier_sku_id:1002,
 quantity:'2.0000',purchasing_unit:'tin',unit_price:'600.00',subtotal:'1200.00'}],
 92:[{award_line_id:201,supplier_sku_id:1001,quantity:'100.0000',purchasing_unit:'kg',
 unit_price:'80.00',subtotal:'8000.00'}],
 93:[{award_line_id:301,supplier_sku_id:1003,quantity:'1.0000',purchasing_unit:'bag',
 unit_price:'4900.00',subtotal:'4900.00'}]
};
const disputes=[],actions=[],timelines={91:[],92:[],93:[]};
let count=0;
const pass=label=>console.log('PASS '+(++count)+': '+label);
const json=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
const wrap=data=>({success:true,data});
const tokenUser=(role)=>({id:role==='BUYER'?5:role==='SUPPLIER'?2:1,
 role,full_name:'Fixture '+role,business_name:'MilJor Test '+role,is_verified:1});
async function contextFor(browser,role){
 const context=await browser.newContext({viewport:{width:1180,height:820}});
 const page=await context.newPage();
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/v1/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  const path=url.pathname.replace('/api/v1',''),method=request.method();
  if(path==='/auth/refresh')
   return json(route,wrap({token:'mock-test-'+role,user:tokenUser(role)}));
  const matchList=/^\/fulfillment\/(buyer|supplier)\/orders$/.exec(path);
  if(matchList){
   if(matchList[1].toUpperCase()!==role)return json(route,{success:false,error:{code:'FORBIDDEN'}},403);
   return json(route,wrap({orders,pagination:{page:1,total:orders.length}}));
  }
  const matchDetail=/^\/fulfillment\/(buyer|supplier)\/orders\/(\d+)$/.exec(path);
  if(matchDetail){
   if(matchDetail[1].toUpperCase()!==role)return json(route,{success:false,error:{code:'FORBIDDEN'}},403);
   const order=orders.find(o=>o.id===Number(matchDetail[2]));
   return json(route,wrap({order,timeline:timelines[order.id],award_lines:physicalLines[order.id]}));
  }
  if(path==='/disputes/my'||path==='/disputes/supplier/list')
   return json(route,wrap({disputes,pagination:{page:1,total:disputes.length}}));
  const matchInvoice=/^\/invoices\/(\d+)$/.exec(path);
  if(matchInvoice)
   return json(route,wrap({invoice:{id:10,invoice_snapshot_json:{
    order_id:Number(matchInvoice[1]),items:[{description:'Rice Grade A',quantity:'100.0000'}],
    pricing:{total_amount:9400,delivery_fee:150}
   }}}));
  const matchConfirm=/^\/fulfillment\/buyer\/orders\/(\d+)\/confirm-receipt$/.exec(path);
  if(matchConfirm&&method==='POST'){
   const order=orders.find(o=>o.id===Number(matchConfirm[1]));
   actions.push({type:'confirm',order:order.id,headers:request.headers()});
   order.fulfillment_status='BUYER_CONFIRMED';
   timelines[order.id].push({id:Date.now(),to_status:'BUYER_CONFIRMED',actor_role:'BUYER',
    created_at:'2026-11-11T00:00:00Z'});
   return json(route,{success:true,message:'Receipt confirmed',data:{order_id:order.id}});
  }
  const matchSupplier=/^\/fulfillment\/supplier\/orders\/(\d+)\/transition$/.exec(path);
  if(matchSupplier&&method==='POST'){
   const payload=request.postDataJSON(),order=orders.find(o=>o.id===Number(matchSupplier[1]));
   actions.push({type:'transition',body:payload,headers:request.headers()});
   order.fulfillment_status=payload.to_status;
   return json(route,{success:true,message:'Fulfillment advanced',data:{order_id:order.id}});
  }
  if(path==='/disputes'&&method==='POST'){
   const payload=request.postDataJSON();
   actions.push({type:'dispute',body:payload,headers:request.headers()});
   const order=orders.find(o=>o.id===Number(payload.order_id));
   order.fulfillment_status='EXCEPTION';
   disputes.push({id:701,order_id:order.id,dispute_code:'DSP-TEST',
    dispute_category:'SHORT_QUANTITY',status:'OPEN',claimed_amount:'1600.00'});
   return json(route,{success:true,message:'Dispute recorded',data:{dispute_id:701}},201);
  }
  // Only mock expected operations; unknown APIs fail closed rather than
  // inadvertently accessing the public internet or an actual backend.
  return json(route,{success:false,error:{code:'MOCK_API_NOT_DEFINED',message:path}},404);
 });
 await page.goto(base+'/post-purchase',{waitUntil:'domcontentloaded'});
 return {context,page,errors};
}
const browser=await chromium.launch({headless:true});
try{
 const buyer=await contextFor(browser,'BUYER');
 try{
  await buyer.page.getByText('Post-Purchase Operations',{exact:true}).waitFor();
  await buyer.page.getByRole('heading',{name:'Paid orders'}).waitFor();
  pass('Authenticated buyer loads paid order list in real Chromium');
  await buyer.page.getByRole('button',{name:/MJQ-TEST-RECEIPT/}).click();
  await buyer.page.getByText('Accepted physical SKU lines',{exact:true}).waitFor();
  await buyer.page.getByText(/SKU #1002/).waitFor();
  pass('Buyer order detail renders physical SKU quantity and separate tin units');
  await buyer.page.getByRole('button',{name:'View authorized invoice'}).click();
  await buyer.page.getByText(/Rice Grade A/).waitFor();
  pass('Buyer can view authorized invoice itemization');
  await buyer.page.getByRole('button',{name:'Confirm complete receipt'}).click();
  await buyer.page.getByText('Receipt confirmed').waitFor();
  assert.equal(orders[0].fulfillment_status,'BUYER_CONFIRMED');
  pass('Buyer full receipt calls exact authenticated endpoint');
  await buyer.page.getByRole('button',{name:/MJQ-TEST-SHORTAGE/}).click();
  await buyer.page.getByPlaceholder('Actual received quantity').fill('80');
  await buyer.page.locator('textarea').first().fill('Only 80 kg delivered from the ordered 100 kg.');
  await buyer.page.getByRole('button',{name:'Report missing quantity'}).click();
  await buyer.page.getByText('Dispute recorded').waitFor();
  const d=actions.find(a=>a.type==='dispute');
  assert.equal(d.body.evidence_metadata.award_line_id,201);
  assert.equal(d.body.evidence_metadata.received_quantity,'80');
  assert.equal(d.body.claimed_amount,undefined);
  assert.equal(orders[1].fulfillment_status,'EXCEPTION');
  pass('Buyer shortage form submits correct immutable SKU + received quantity, never client claim amount');
  assert.equal(buyer.errors.length,0,buyer.errors.join('; '));
  pass('Buyer browser UI emits no uncaught JavaScript errors');
 }finally{await buyer.context.close()}
 const supplier=await contextFor(browser,'SUPPLIER');
 try{
  await supplier.page.getByText('Post-Purchase Operations',{exact:true}).waitFor();
  await supplier.page.getByRole('button',{name:/MJQ-TEST-PREPARING/}).click();
  await supplier.page.getByRole('button',{name:'Move to Preparing'}).click();
  await supplier.page.getByText('Fulfillment advanced').waitFor();
  const action=actions.find(a=>a.type==='transition');
  assert.equal(action.body.to_status,'PREPARING');
  assert.ok(action.headers['x-idempotency-key']);
  pass('Supplier advances owned paid order and sends idempotency key');
  assert.equal(supplier.errors.length,0,supplier.errors.join('; '));
  pass('Supplier browser UI emits no uncaught JavaScript errors');
 }finally{await supplier.context.close()}
 const admin=await contextFor(browser,'ADMIN');
 try{
  await admin.page.getByText('Sign in as a business buyer or supplier').waitFor();
  pass('Admin is not given buyer/supplier commerce actions through postpurchase UI');
 }finally{await admin.context.close()}
 console.log('B7 REAL CHROMIUM + MOCK HTTP: '+count+'/'+count+' PASS');
}finally{await browser.close()}
