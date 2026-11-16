'use strict';
// Real MySQL B6 award test with TEST-ONLY synthetic signed Safepay callback.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const jwt=require('jsonwebtoken'),db=require('../src/config/db');
const app=require('../server'),fulfillment=require('../src/services/fulfillmentService');
const invoice=require('../src/services/invoiceService');
const tag=crypto.randomBytes(5).toString('hex');let n=0;
const pass=x=>console.log('PASS B6 AWARD MYSQL '+(++n)+': '+x);
async function main(){
  const boundDelivery=process.env.B6_TEST_BOUND_DELIVERY==='true';
  const fixtureIds={request:null,order:null,point:null,config:null,configChanged:false};
  for(const [key,value] of Object.entries({
    NODE_ENV:'test',DB_NAME:'miljor_test_db',TEST_DB_NAME:'miljor_test_db',
    MILJOR_TEST_ONLY_MIGRATIONS:'1',ALLOW_EXTERNAL_MONEY_MOVEMENT:'false',
    SAFEPAY_ENV:'sandbox',B6_FINANCIAL_GATE_ENABLED:'true',
    B6_B5_INVENTORY_RECONCILED:'true',B6_TAX_POLICY_APPROVED:'true'
  }))assert.equal(process.env[key],value,'PROTECTED_DB_OR_FINANCIAL_GATE_ABORT '+key);
  assert.equal(process.env.SAFEPAY_WEBHOOK_SECRET,'p0-only-synthetic-safepay-callback-key-2026');
  const [[identity]]=await db.query('SELECT DATABASE() AS db');
  assert.equal(identity.db,'miljor_test_db');
  const [[sku]]=await db.query(
    "SELECT l.id AS listing_id,l.supplier_id,s.id AS sku_id,s.family_id,s.purchasing_unit,l.product_spec_id FROM supplier_listings l JOIN supplier_skus s ON s.id=l.supplier_sku_id WHERE l.listing_code='LST-B6-TEST-001' AND l.status='ACTIVE' AND s.status='PUBLISHED' LIMIT 1"
  );
  assert.ok(sku,'Seeded approved B6 supplier listing must be present');
  const token=(id,role)=>jwt.sign({id,role,verification_status:'VERIFIED'},
    process.env.JWT_SECRET,{expiresIn:'20m',issuer:'miljor-api',audience:'miljor-app'});
  const server=app.listen(0),base='http://127.0.0.1:'+server.address().port;
  const api=async(endpoint,role='BUYER',method='GET',body=null,extra=null)=>{
    const headers=extra||{'Content-Type':'application/json',
      Authorization:'Bearer '+token(role==='BUYER'?5:2,role),
      'X-Idempotency-Key':'B6REAL-'+tag+'-'+Buffer.from(endpoint+method).toString('hex').slice(-32)};
    const res=await fetch(base+'/api/v1'+endpoint,{method,headers,
      body:body==null?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    const raw=await res.text();let data;
    try{data=JSON.parse(raw)}catch{data={raw}};
    return {status:res.status,data};
  };
  const ok=(r,status,label)=>{
    assert.equal(r.status,status,label+' '+JSON.stringify(r.data));
    assert.equal(r.data.success,true,label);
    return r.data.data;
  };
  try{
    const created=ok(await api('/procurement/requests','BUYER','POST',{
      delivery_area:'Johar Town, Lahore',
      quote_deadline:new Date(Date.now()+172800000).toISOString(),
      items:[{family_id:Number(sku.family_id),quantity:'1',
        unit:String(sku.purchasing_unit).toLowerCase(),requirements:'Test commercial quality'}]
    }),201,'create request');
    const rid=Number(created.request.id),item=Number(created.request.items[0].id);
    fixtureIds.request=rid;
    pass('Verified buyer creates B6 request');
    ok(await api('/procurement/requests/'+rid+'/publish','BUYER','POST',
      {version_number:1}),200,'publish');
    const invitation=ok(await api('/procurement/requests/'+rid+'/invitations',
      'BUYER','POST',{supplier_id:2}),201,'invite');
    ok(await api('/procurement/supplier/invitations/'+invitation.invitation.id+
      '/respond','SUPPLIER','POST',{decision:'INTERESTED'}),200,'supplier respond');
    const quote=ok(await api('/procurement/supplier/requests/'+rid+'/quotes',
      'SUPPLIER','POST',{delivery_fee:'350.00',delivery_lead_days:2,
        valid_until:new Date(Date.now()+86400000).toISOString(),
        supplier_notes:'CI-only B6 supplier test quote',
        lines:[{request_item_id:item,supplier_listing_id:Number(sku.listing_id),
          quantity:'1',unit_price:'450.00'}]
      }),201,'supplier quote');
    const quoteId=Number(quote.quote.id||quote.quote.quote_id);
    pass('Supplier invitation and quote are persisted');
    let acceptedVersion=1,deliveryTerms=null;
    if(boundDelivery){
      const [configs]=await db.query('SELECT * FROM supplier_delivery_configurations WHERE supplier_id=2');
      fixtureIds.config=configs[0]||null;
      if(configs.length)await db.query('UPDATE supplier_delivery_configurations SET pickup_enabled=1,version=version+1 WHERE supplier_id=2');
      else await db.query('INSERT INTO supplier_delivery_configurations(supplier_id,pickup_enabled) VALUES (2,1)');
      fixtureIds.configChanged=true;
      const [[cluster]]=await db.query('SELECT id FROM geographic_clusters WHERE is_active=1 ORDER BY id LIMIT 1');
      const [point]=await db.query('INSERT INTO supplier_pickup_points(supplier_id,point_name,cluster_id,address_line,pickup_handling_fee_pkr) VALUES (2,?,?,?,25)',
        ['Bound fixture '+tag,cluster.id,'Owned test pickup '+tag]);fixtureIds.point=point.insertId;
      const choice=ok(await api('/procurement/requests/'+rid+'/quotes/'+quoteId+'/delivery-choice','BUYER','POST',
        {cluster_id:cluster.id,mode:'PICKUP',pickup_point_id:point.insertId}),201,'delivery choice');
      deliveryTerms=choice.delivery_terms;
      const omitted=await api('/procurement/supplier/requests/'+rid+'/quotes','SUPPLIER','POST',{
        delivery_fee:'350.00',delivery_lead_days:2,valid_until:new Date(Date.now()+3600000).toISOString(),
        lines:[{request_item_id:item,supplier_listing_id:Number(sku.listing_id),quantity:'1',unit_price:'450.00'}]},
        {'Content-Type':'application/json',Authorization:'Bearer '+token(2,'SUPPLIER'),'X-Idempotency-Key':'B6OMITTED-'+tag});
      assert.equal(omitted.status,409);assert.equal(omitted.data.error.code,'DELIVERY_CHOICE_CONFIRMATION_REQUIRED');
      const bypass=await api('/delivery/quote/accept','BUYER','POST',{quote_code:deliveryTerms.quote_code});
      assert.equal(bypass.status,409);assert.equal(bypass.data.error.code,'PROCUREMENT_AWARD_REQUIRED');
      const spoof=await api('/delivery/quote/accept','BUYER','POST',{quote_code:deliveryTerms.quote_code,procurementRequestId:rid,currentTime:'2000-01-01T00:00:00Z'});
      assert.equal(spoof.status,409);assert.equal(spoof.data.error.code,'PROCUREMENT_AWARD_REQUIRED');
      const revised=ok(await api('/procurement/supplier/requests/'+rid+'/quotes','SUPPLIER','POST',{
        delivery_fee:'25.00',delivery_lead_days:2,delivery_quote_code:deliveryTerms.quote_code,
        valid_until:new Date(Date.parse(deliveryTerms.expires_at)-60000).toISOString(),
        lines:[{request_item_id:item,supplier_listing_id:Number(sku.listing_id),quantity:'1',unit_price:'450.00'}]},
        {'Content-Type':'application/json',Authorization:'Bearer '+token(2,'SUPPLIER'),'X-Idempotency-Key':'B6BOUND-'+tag}),201,'supplier delivery approval');
      acceptedVersion=revised.quote.version_number;
      assert.equal(revised.quote.delivery_terms.hash,deliveryTerms.hash);
      pass('Buyer pickup choice bound to supplier immutable revised quote');
    }
    const selections=[{request_item_id:item,quote_id:quoteId,version_number:acceptedVersion,
      supplier_sku_id:Number(sku.sku_id),product_spec_id:Number(sku.product_spec_id),
      physical_specifications_accepted:true,...(deliveryTerms?{delivery_terms_hash:deliveryTerms.hash}:{})}];
    const preview=ok(await api('/procurement/requests/'+rid+
      '/checkout-preview','BUYER','POST',{selections}),200,'checkout preview').preview;
    assert.ok(preview.total_payable);
    const total=String(preview.total_payable);
    pass('Fee-inclusive buyer award preview');
    const awardPayload={selections,buyer_total_confirmed:true,
      accepted_total_payable:total,
      delivery_address:'Johar Town Lahore Pakistan warehouse'};
    if(boundDelivery){
      const rejected=await api('/procurement/requests/'+rid+'/award','BUYER','POST',
        {...awardPayload,selections:selections.map(selection=>({...selection,delivery_terms_hash:'stale'}))});
      assert.equal(rejected.status,409);assert.equal(rejected.data.error.code,'DELIVERY_REAPPROVAL_REQUIRED');
      const [[counts]]=await db.query('SELECT COUNT(*) AS total FROM procurement_awards WHERE request_id=?',[rid]);assert.equal(Number(counts.total),0);
      pass('Stale delivery consent rejects award before any order or allocation');
    }
    const awardHttp=await api('/procurement/requests/'+rid+'/award',
      'BUYER','POST',awardPayload);
    if(awardHttp.status!==201){
      // Test-only diagnostic; the public Express endpoint remains sanitized.
      try {
        await require('../src/services/procurementAwardService').accept(
          5,rid,awardPayload,'DIAGNOSTIC-B6-'+tag
        );
      } catch(error) {
        console.error('B6_ISOLATED_ACCEPT_DIAGNOSTIC',error.code||error.name,
          error.message,error.stack);
      }
    }
    const award=ok(awardHttp,201,'accept award').award;
    assert.equal(award.orders.length,1);
    const oid=Number(award.orders[0].order_id);
    fixtureIds.order=oid;
    if(boundDelivery){
      const replay=ok(await api('/procurement/requests/'+rid+'/award','BUYER','POST',awardPayload),200,'award replay');
      assert.equal(replay.is_replay,true);assert.equal(replay.award.award_id,award.award_id);
    }
    if(boundDelivery){
      const [[locked]]=await db.query('SELECT delivery_type,delivery_fee,procurement_delivery_snapshot FROM orders WHERE id=?',[oid]);
      assert.equal(locked.delivery_type,'SUPPLIER_PICKUP');assert.equal(String(locked.delivery_fee),'25.00');
      const snapshot=typeof locked.procurement_delivery_snapshot==='string'?JSON.parse(locked.procurement_delivery_snapshot):locked.procurement_delivery_snapshot;
      assert.equal(snapshot.hash,deliveryTerms.hash);assert.equal(snapshot.pickup_snapshot.address_line,'Owned test pickup '+tag);
      pass('Award order preserves pickup mode, exact charge and immutable pickup location');
    }
    const [[pre]]=await db.query('SELECT payment_status FROM orders WHERE id=?',[oid]);
    assert.equal(pre.payment_status,'AWAITING_PAYMENT');
    const [[lines]]=await db.query('SELECT COUNT(*) AS n FROM procurement_award_lines WHERE award_id=?',[award.award_id]);
    assert.equal(Number(lines.n),1);
    pass('B6 award created unpaid order and immutable supplier line');
    const pending=await fulfillment.listSupplierFulfillmentOrders({actor:{id:2,role:'SUPPLIER'}});
    assert.ok(!pending.orders.some(o=>Number(o.order_id)===oid));
    pass('Unpaid award is not fulfillable');
    const tracker='b6_paid_'+tag;
    await db.query(
      "INSERT INTO payment_attempts(attempt_code,order_id,buyer_id,provider,environment,provider_tracker_token,amount,currency,status,idempotency_key) VALUES (?,?,5,'SAFEPAY','sandbox',?,?,'PKR','INITIATED',?)",
      ['B6ATT-'+tag,oid,tracker,total,'B6INIT-'+tag]);
    const payload={token:'evt_b6_'+tag,type:'payment.succeeded',
      data:{tracker:{token:tracker,amount:Number(total),currency:'PKR'}}};
    const bytes=Buffer.from(JSON.stringify(payload));
    const sig=crypto.createHmac('sha512',process.env.SAFEPAY_WEBHOOK_SECRET).update(bytes).digest('hex');
    const callback=await api('/webhooks/safepay','BUYER','POST',payload,{
      'Content-Type':'application/json','X-SFPY-SIGNATURE':sig,
      'X-SFPY-EVENT-ID':'b6_final_'+tag,'X-SFPY-EVENT-TYPE':'payment.succeeded',
      'X-SFPY-TIMESTAMP':new Date().toISOString()
    });
    assert.equal(callback.status,200,JSON.stringify(callback.data));
    assert.equal(callback.data.data.payment_status,'PAID');
    const [[status]]=await db.query('SELECT status FROM procurement_awards WHERE id=?',[award.award_id]);
    assert.equal(status.status,'PAID');
    const [[stock]]=await db.query(
      "SELECT COUNT(*) AS n FROM supplier_inventory_allocations WHERE allocation_type='ORDER_DIRECT' AND reference_id=? AND status='COMMITTED'",[oid]);
    assert.equal(Number(stock.n),1);
    pass('Synthetic signed callback reconciled real paid B6 award/stock');
    const paid=await fulfillment.listSupplierFulfillmentOrders({actor:{id:2,role:'SUPPLIER'}});
    assert.ok(paid.orders.some(o=>Number(o.order_id)===oid));
    const issued=await invoice.generateInvoiceForOrder(oid,{id:5,role:'BUYER'});
    const doc=typeof issued.invoice_snapshot_json==='string'
      ?JSON.parse(issued.invoice_snapshot_json):issued.invoice_snapshot_json;
    assert.equal(doc.items.length,1);
    assert.equal(doc.items[0].supplier_sku_id,Number(sku.sku_id));
    assert.equal(Number(doc.pricing.total_amount),Number(total));
    if(boundDelivery)assert.equal(doc.delivery_terms.hash,deliveryTerms.hash);
    pass('Real supplier paid fulfillment and B6 immutable-line invoice');
    console.log('REAL B6 AWARD PAID FULFILLMENT: '+n+'/'+n+
      ' PASS; synthetic provider signature only, no real Safepay attestation');
  } finally {
    try{
      if(fixtureIds.configChanged){
        if(fixtureIds.config)await db.query('UPDATE supplier_delivery_configurations SET pickup_enabled=?,version=? WHERE supplier_id=2',[fixtureIds.config.pickup_enabled,fixtureIds.config.version]);
        else await db.query('DELETE FROM supplier_delivery_configurations WHERE supplier_id=2');
      }
      if(fixtureIds.point)await db.query('DELETE FROM supplier_pickup_points WHERE id=?',[fixtureIds.point]);
      if(fixtureIds.request)await db.query("DELETE FROM procurement_notifications WHERE JSON_UNQUOTE(JSON_EXTRACT(payload,'$.entityId'))=? AND event_type IN ('REQUEST_CREATED','REQUEST_PUBLISHED','SUPPLIER_MATCHED','QUOTE_RECEIVED','QUOTE_REVISED','TERMS_LOCKED','DELIVERY_CHOICE_RECORDED')",[String(fixtureIds.request)]);
      if(fixtureIds.order)await db.query("DELETE FROM procurement_notifications WHERE JSON_UNQUOTE(JSON_EXTRACT(payload,'$.entityId'))=? AND event_type IN ('PAYMENT_PENDING','PAYMENT_VERIFIED')",[String(fixtureIds.order)]);
    }finally{await new Promise(resolve=>server.close(resolve));}
  }
}
main().then(()=>process.exit(0)).catch(e=>{
  console.error('FAIL REAL B6 AWARD PAID FULFILLMENT',e.stack||e);
  process.exit(1);
});
