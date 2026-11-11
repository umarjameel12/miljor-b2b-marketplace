'use strict';
// Real HTTP + MySQL B4/B5 same-listing race, disposable DB only.
// DO NOT run against miljor_db, miljor_sandbox_db, or any shared staging data.
process.env.NODE_ENV='test';
const assert=require('node:assert/strict');
const jwt=require('jsonwebtoken');
const path=require('node:path');
require('dotenv').config({path:path.join(__dirname,'../.env')});
assert.equal(process.env.DB_NAME,'miljor_test_db','Requires disposable miljor_test_db');
assert.equal(process.env.MILJOR_TEST_ONLY_MIGRATIONS,'1','Explicit isolated-test guard required');
const db=require('../src/config/db');
const app=require('../server');

async function main(){
  const [[identity]]=await db.query('SELECT DATABASE() AS name');
  assert.equal(identity.name,'miljor_test_db');
  const server=app.listen(0);
  const base='http://127.0.0.1:'+server.address().port;
  const stamp=Date.now();
  const tokenSecret=process.env.JWT_SECRET;
  assert.ok(tokenSecret && tokenSecret.length>=32,'Strong isolated JWT secret required');
  const token=id=>jwt.sign({id,role:'SUPPLIER',verification_status:'VERIFIED'},tokenSecret,
    {expiresIn:'1h',issuer:'miljor-api',audience:'miljor-app'});
  async function req(url,{method='GET',body,auth,key}={}){
    const headers={'Content-Type':'application/json'};
    if(auth)headers.Authorization='Bearer '+auth;
    if(key)headers['X-Idempotency-Key']=key;
    const res=await fetch(base+url,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});
    let json;try{json=await res.json()}catch{json={}};
    return {status:res.status,body:json};
  }
  const must=(res,status,label)=>{
    assert.equal(res.status,status,label+': '+JSON.stringify(res.body).slice(0,600));return res.body.data;
  };
  const createdRegular=[],createdFlash=[];
  try{
    const [user]=await db.query(
      "INSERT INTO users(full_name,email,phone,password_hash,role,verification_status,is_verified,buyer_trust_status) VALUES (?, ?, ?, 'testhash','SUPPLIER','VERIFIED',1,'CONTACT_VERIFIED')",
      ['P0 Publication Race '+stamp,'p0race_'+stamp+'@miljor.test','+92311'+String(stamp).slice(-7)]);
    const supplierId=user.insertId,auth=token(supplierId);
    await db.query(
      "INSERT INTO supplier_profiles(supplier_id,business_type,verification_status,subscription_plan,subscription_status,max_active_listings,transaction_fee_percent) VALUES (?,'WHOLESALER','VERIFIED','STARTER','STARTER_ACTIVE',10,2.50)",
      [supplierId]);
    const p=must(await req('/api/v1/catalog/supplier-products',{
      method:'POST',auth,body:{family_id:1,is_unbranded:false,brand:'P0 RACE',variety:'Batch '+stamp}}),201,'create product');
    const supplierProductId=p.product.id;
    const sku=must(await req('/api/v1/catalog/supplier-skus',{
      method:'POST',auth,body:{supplier_product_id:supplierProductId,packaging_type:'PP Woven Bag',
        pack_size:25,pack_unit:'kg',purchasing_unit:'bag'}}),201,'create SKU');
    const skuId=sku.sku.id;
    must(await req('/api/v1/catalog/supplier-skus/'+skuId+'/publish',{method:'POST',auth}),200,'publish SKU');
    const listing=must(await req('/api/v1/listings',{
      method:'POST',auth,body:{supplier_sku_id:skuId,available_stock:200,base_unit_price:5000,
        supplier_min_qty:1,buyer_min_qty:1}}),201,'create listing');
    const listingId=listing.listing.id;
    const [[spec]]=await db.query(
      'SELECT ps.id AS spec_id,ps.product_id,ps.supplier_sku_id FROM supplier_listings sl JOIN product_specifications ps ON ps.id=sl.product_spec_id WHERE sl.id=?',[listingId]);
    assert.equal(Number(spec.supplier_sku_id),Number(skuId));
    const prepare=async(type,qty,index,round)=>{
      if(type==='REGULAR'){
        const body={product_id:spec.product_id,product_spec_id:spec.spec_id,
          supplier_listing_id:listingId,target_qty:qty,supplier_min_qty:1,buyer_min_qty:1,
          max_capacity:qty,pool_unit:'bag',purchase_increment:1,duration_days:7,
          delivery_type:'DOORSTEP',delivery_zones:['Gulberg','Model Town'],
          delivery_fee_policy:'INCLUDED_IN_PRICE',fulfilment_lead_time_days:3,
          cancellation_cutoff_hours:12,price_tiers:[{min_qty:1,max_qty:qty,
            price_per_unit:4800,pricing_unit:'bag'}]};
        const v=must(await req('/api/v1/pools',{method:'POST',auth,
          key:'P0-RACE-R-DRAFT-'+stamp+'-'+round+'-'+index,body}),201,'Regular draft '+round+'/'+index);
        createdRegular.push(v.pool.id);
        return {type,id:v.pool.id,qty,endpoint:'/api/v1/pools/'+v.pool.id+'/publish',
          cancel:'/api/v1/pools/'+v.pool.id+'/cancel',cancelMethod:'PUT'};
      }
      const body={supplier_listing_id:listingId,total_stock:String(qty)+'.00',
        discounted_unit_price:'4500.00',original_unit_price:'5000.00',
        min_quantity:'1.00',max_quantity_per_buyer:String(qty)+'.00',
        purchase_increment:'1.00',selling_mode:'MULTI_BUYER',
        expiry_time:new Date(Date.now()+3600000).toISOString(),
        duration_minutes:60,clearance_reason:'Surplus ready stock test'};
      const v=must(await req('/api/v1/flash-pools',{method:'POST',auth,body}),201,'Flash draft '+round+'/'+index);
      createdFlash.push(v.flash_pool.id);
      return {type,id:v.flash_pool.id,qty,endpoint:'/api/v1/flash-pools/'+v.flash_pool.id+'/publish',
        cancel:'/api/v1/flash-pools/'+v.flash_pool.id+'/cancel',cancelMethod:'POST'};
    };
    async function allocated(){
      const [rows]=await db.query(
        "SELECT allocation_type,reference_id,allocated_qty,unit FROM supplier_inventory_allocations WHERE supplier_listing_id=? AND status IN ('PENDING','COMMITTED')",
        [listingId]);
      const scaled=rows.reduce((sum,x)=>sum+Math.round(Number(x.allocated_qty)*100),0);
      assert.ok(scaled<=20000,'OVERSELL: '+scaled+' cents-equivalent stock vs 20000');
      assert.ok(rows.every(x=>String(x.unit).toLowerCase()==='bag'),'Mixed inventory units');
      const keys=rows.map(x=>x.allocation_type+':'+x.reference_id);
      assert.equal(new Set(keys).size,keys.length,'Duplicate allocation reference');
      return {quantity:scaled/100,count:rows.length};
    }
    // PR #8 selective reconciliation: verify buyer discovery eligibility
    // against REAL disposable MySQL, not merely source string assertions.
    // This probe is separate from the concurrency waves and fully released.
    const discoveryProbe=await prepare('REGULAR',5,0,'DISCOVERY');
    const probePublished=await req(discoveryProbe.endpoint,{method:'POST',auth,
      key:'P0-DISCOVERY-PUBLISH-'+stamp});
    must(probePublished,200,'publish discovery probe');
    const poolRepo=require('../src/repositories/poolRepo');
    const visible=async()=> (await poolRepo.findAllActive({}))
      .some(x=>Number(x.id)===Number(discoveryProbe.id));
    assert.equal(await visible(),true,'Verified approved physical SKU must be discoverable');
    try {
      await db.query('UPDATE users SET is_verified=0 WHERE id=?',[supplierId]);
      assert.equal(await visible(),false,'Suspended/unverified supplier must disappear from buyer discovery');
    } finally {
      await db.query('UPDATE users SET is_verified=1 WHERE id=?',[supplierId]);
    }
    assert.equal(await visible(),true,'Restored eligible supplier should be discoverable');
    try {
      await db.query('UPDATE product_specifications SET is_active=0 WHERE id=?',[spec.spec_id]);
      assert.equal(await visible(),false,'Deactivated physical SKU must disappear from buyer discovery');
    } finally {
      await db.query('UPDATE product_specifications SET is_active=1 WHERE id=?',[spec.spec_id]);
    }
    assert.equal(await visible(),true,'Restored approved SKU should be discoverable');
    const probeCancelled=await req(discoveryProbe.cancel,{method:discoveryProbe.cancelMethod,
      auth,key:'P0-DISCOVERY-CANCEL-'+stamp,body:{reason:'Disposable discovery gate cleanup'}});
    must(probeCancelled,200,'cancel discovery probe');
    assert.equal((await allocated()).quantity,0,'Discovery probe stock allocation fully released');
    console.log('PASS P0 REAL MYSQL DISCOVERY RECONCILIATION: supplier verification and SKU lifecycle fail closed');
    // Diagnostic only, runs against disposable test DB; no production settings.
    // Make lock problems fail quickly rather than masking a 50-client pile-up.
    await db.query('SET GLOBAL innodb_lock_wait_timeout = 8');
    for(const parallel of [2,10,50,100]){
      console.log('START SAME-SKU PUBLICATION WAVE',parallel,'clients');
      const qty=parallel===2?120:parallel===10?25:parallel===50?5:3;
      const drafts=[];
      // Sequential draft creation avoids conflating draft-rate limits with publication races.
      for(let i=0;i<parallel;i++)drafts.push(await prepare(i%2?'FLASH':'REGULAR',qty,i,parallel));
      console.log('DRAFTS READY',parallel,drafts.length);
      const mysql=require('mysql2/promise');
      const diagnose=parallel<50?null:setTimeout(async()=>{
        let monitor;
        try{
          monitor=await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',
            user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',
            database:'miljor_test_db',connectTimeout:3000});
          const [waits]=await monitor.query(
            'SELECT COUNT(*) AS waiting FROM performance_schema.data_lock_waits');
          const [trx]=await monitor.query(
            "SELECT trx_state,COUNT(*) AS n FROM information_schema.innodb_trx GROUP BY trx_state");
          console.error('P0_LOCK_DIAGNOSTIC',JSON.stringify({wave:parallel,
            waiting:Number(waits[0]?.waiting||0),states:trx}));
        }catch(e){console.error('P0_LOCK_DIAGNOSTIC_UNAVAILABLE',e.message)}
        finally{await monitor?.end().catch(()=>{})}
      },3000);
      let results;
      try{
        results=await Promise.all(drafts.map((x,i)=>req(x.endpoint,{method:'POST',auth,
          key:'P0-RACE-PUBLISH-'+stamp+'-'+parallel+'-'+i})));
      }finally{if(diagnose)clearTimeout(diagnose)}
      const winners=[],losers=[];
      results.forEach((r,i)=>((r.status===200)?winners:losers).push({draft:drafts[i],response:r}));
      assert.ok(winners.length>0,'No publications succeeded in wave '+parallel);
      assert.ok(losers.every(x=>[409,422].includes(x.response.status)),
        'Unexpected publication failures '+JSON.stringify(losers.map(x=>x.response.status)));
      const verification=await allocated();
      assert.equal(verification.quantity,winners.reduce((n,x)=>n+x.draft.qty,0),
        'Ledger does not equal winning publication reservations');
      if(parallel===2)assert.equal(winners.length,1,'120+120 must never overcommit stock 200');
      if(parallel>=10)assert.ok(losers.length>=1,'Expected stock contention at '+parallel);
      console.log('PASS SAME-SKU API RACE',JSON.stringify({
        concurrent_publications:parallel,quantity_per_pool:qty,
        success:winners.length,rejected:losers.length,allocated:verification.quantity,
        stock:200}));
      // Cancel only successful publications so next wave begins with unallocated stock.
      for(const {draft} of winners){
        const r=await req(draft.cancel,{method:draft.cancelMethod,auth,
          key:'P0-RACE-CANCEL-'+stamp+'-'+parallel+'-'+draft.type+'-'+draft.id,
          body:draft.type==='REGULAR'?{reason:'Disposable test cleanup'}:undefined});
        assert.equal(r.status,200,'Cancel/reset '+draft.type+' '+draft.id+' '+JSON.stringify(r.body));
      }
      const after=await allocated();
      assert.equal(after.quantity,0,'Cancellation must release exact allocation');
    }
    console.log('PASS: 2/10/50/100 real simultaneous mixed-mode publication HTTP+InnoDB stress');
  }finally{
    // Disposable MySQL runner is destroyed after job; never cleanup shared/protected state.
    // Cancel any still-live tests before allowing the job to finish.
    await new Promise(resolve=>server.close(resolve));
  }
}
main().then(()=>process.exit(0)).catch(e=>{
  console.error('FAIL P0 SAME-SKU REAL CONCURRENCY',e.stack||e);
  process.exit(1);
});
