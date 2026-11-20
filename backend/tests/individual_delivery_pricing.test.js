'use strict';
// Unit/SQL boundary doubles only. No MySQL connections, fixtures or migrations.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {snapshotDeliveryTerms,assertDeliveryConsent}=require('../src/services/procurementDeliveryBindingPolicy');
const row={quote_code:'IND-1',buyer_id:7,supplier_id:11,cluster_id:3,mode:'INDIVIDUAL',
 procurement_request_id:4,procurement_quote_id:5,address_id:9,
 destination_address_snapshot:{address_id:9,revision:1,cluster_id:3,geographic_match_status:'VERIFIED'},
 destination_fingerprint:'a'.repeat(64),quoted_delivery_fee_pkr:'345.67',supplier_config_version:2,
 supplier_rate_version:3,expires_at:new Date('2026-12-01T00:00:00Z')};
test('individual terms lock supplier rate, mode, fee, address and expiry into buyer consent',()=>{
 const terms=snapshotDeliveryTerms(row);assert.equal(terms.fee,'345.67');assert.equal(terms.supplier_rate_version,3);
 assertDeliveryConsent(terms,terms.hash);
 for(const delta of [{supplier_rate_version:4},{quoted_delivery_fee_pkr:'345.68'},{mode:'EXPRESS'},
  {destination_fingerprint:'b'.repeat(64)},{expires_at:new Date('2026-12-02T00:00:00Z')}]){
  assert.throws(()=>assertDeliveryConsent(snapshotDeliveryTerms({...row,...delta}),terms.hash));
 }
});
test('individual terms fail closed without procurement scope, version or verified destination',()=>{
 for(const delta of [{procurement_request_id:null},{procurement_quote_id:null},{supplier_rate_version:null},{pool_id:1},
  {destination_address_snapshot:{...row.destination_address_snapshot,geographic_match_status:'PROVISIONAL'}}])
  assert.throws(()=>snapshotDeliveryTerms({...row,...delta}));
});

// The real repository, service and quote engine execute against an in-memory SQL
// boundary. This proves parameter/transaction contracts, not InnoDB semantics.
const dbPath=require.resolve('../src/config/db');
let current;
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{getConnection:async()=>current.connection}};
const service=require('../src/services/supplierDeliveryService');
const engine=require('../src/services/deliveryEligibilityService');
const geo=require('../src/repositories/geographicRepository');
const {normalizeCycleInputs}=require('../src/services/procurementRecurringCyclePolicy');
function fixture(){
 const state={config:{supplier_id:11,standard_delivery_enabled:true,pickup_enabled:false,express_enabled:false,individual_delivery_enabled:false,version:1},
  rates:[{supplier_id:11,cluster_id:3,mode:'STANDARD_CLUSTERED',fee_pkr:25,is_eligible:true,version:1}],quotes:[],calls:[],commits:0,rollbacks:0,releases:0,
  address:{id:9,user_id:7,revision:1,cluster_id:3,geographic_match_status:'VERIFIED',full_address:'Test road',society_area:'Test area',pin_latitude:31.5,pin_longitude:74.3},
  clock:new Date('2026-11-20T00:00:00Z'),failRate:false};
 let checkpoint;
 const connection={beginTransaction:async()=>{checkpoint=structuredClone({config:state.config,rates:state.rates});},
  commit:async()=>{state.commits++;},rollback:async()=>{Object.assign(state,checkpoint);state.rollbacks++;},release:()=>state.releases++,
  query:async(sql,args=[])=>{
   state.calls.push({sql,args});
   assert.equal((sql.match(/\?/g)||[]).length,args.length,'SQL placeholder count');
   if(sql.startsWith('SELECT UTC_TIMESTAMP'))return [[{quote_now:state.clock}]];
   if(sql.includes('expires_at > UTC_TIMESTAMP'))return [[{is_live:state.live===false?0:1}]];
   if(sql.startsWith('SELECT')&&sql.includes('FROM users'))return [[{id:7}]];
   if(sql.startsWith('SELECT')&&sql.includes('FROM buyer_delivery_addresses')){
    const owned=sql.includes('WHERE id = ?')?Number(args[0])===state.address.id&&Number(args[1])===state.address.user_id:Number(args[0])===state.address.user_id;
    return [owned?[state.address]:[]];
   }
   if(sql.startsWith('SELECT')&&sql.includes('FROM supplier_delivery_configurations'))return [[state.config]];
   if(sql.startsWith('SELECT')&&sql.includes('FROM supplier_delivery_cluster_rates'))return [state.rates.map(r=>({...r,exact_fee_pkr:String(r.fee_pkr)}))];
   if(sql.startsWith('SELECT')&&sql.includes('FROM supplier_pickup_points'))return [[]];
   if(sql.startsWith('INSERT INTO supplier_delivery_configurations')){
    assert.match(sql,/individual_delivery_enabled = VALUES/);
    const [supplier_id,standard_delivery_enabled,pickup_enabled,express_enabled,individual_delivery_enabled,express_cutoff_time,express_fulfillment_hours]=args;
    state.config={supplier_id,standard_delivery_enabled,pickup_enabled,express_enabled,individual_delivery_enabled,express_cutoff_time,express_fulfillment_hours,version:state.config.version+1};return [{affectedRows:1}];
   }
   if(sql.startsWith('INSERT INTO supplier_delivery_cluster_rates')){
    if(state.failRate)throw Error('Injected rate write failure');
    const [supplier_id,cluster_id,mode,is_eligible,fee_pkr]=args;
    const index=state.rates.findIndex(r=>r.cluster_id===cluster_id&&r.mode===mode);
    const next={supplier_id,cluster_id,mode,is_eligible,fee_pkr,version:index<0?1:state.rates[index].version+1};
    if(index<0)state.rates.push(next);else state.rates[index]=next;return [{affectedRows:1}];
   }
   if(sql.startsWith('INSERT INTO delivery_quotes')){
    assert.match(sql,/supplier_rate_version/);
    const [quote_code,buyer_id,supplier_id,pool_id,cluster_id,address_id,destination_address_snapshot,destination_fingerprint,mode,quoted_delivery_fee_pkr,pickup_point_id,supplier_config_version,supplier_rate_version,expires_at]=args;
    state.quotes.push({id:1,status:'PENDING',quote_code,buyer_id,supplier_id,pool_id,cluster_id,address_id,destination_address_snapshot,destination_fingerprint,mode,quoted_delivery_fee_pkr,pickup_point_id,supplier_config_version,supplier_rate_version,expires_at});return [{affectedRows:1}];
   }
   if(sql.startsWith('SELECT')&&sql.includes('FROM delivery_quotes'))return [state.quotes.filter(q=>sql.includes('WHERE id = ?')?q.id===args[0]:q.quote_code===args[0])];
   if(sql.startsWith('UPDATE delivery_quotes')){
    const quote=state.quotes.find(q=>q.quote_code===args[0]||q.id===args[0]);
    if(sql.includes("SET status = 'ACCEPTED'")){
     if(quote.status!=='PENDING')return [{affectedRows:0}];quote.status='ACCEPTED';return [{affectedRows:1}];
    }
    quote.status='EXPIRED';return [{affectedRows:1}];
   }
   throw Error('Unexpected SQL: '+sql);
  }};
 current={state,connection};return current;
}
const config=(fee='345.67')=>({individual_delivery_enabled:true,cluster_rates:[{cluster_id:3,mode:'INDIVIDUAL',fee_pkr:fee,is_eligible:true}]});
const payload={supplier_id:11,cluster_id:3,address_id:9,mode:'INDIVIDUAL',fee_pkr:'0',currentTime:'1990-01-01'};
function setup(t){const f=fixture();t.mock.method(geo,'getClusterById',async id=>id===3?{id:3,is_active:1,name:'Test cluster'}:null);return f;}
test('supplier opt-in and distinct exact cluster rate persist atomically and preserve legacy modes',async t=>{
 const {state,connection}=setup(t);
 assert.equal((await service.getSupplierSettings(11,connection)).configuration.individual_delivery_enabled,false);
 const saved=await service.updateSupplierSettings(11,config());assert.equal(saved.configuration.individual_delivery_enabled,true);
 assert.equal(saved.configuration.version,2);assert.equal(saved.cluster_rates.find(r=>r.mode==='INDIVIDUAL').fee_pkr,'345.67');
 assert.equal(saved.cluster_rates.find(r=>r.mode==='STANDARD_CLUSTERED').fee_pkr,25);assert.equal(state.commits,1);assert.equal(state.releases,1);
 await service.updateSupplierSettings(11,{cluster_rates:[]});assert.equal(state.config.individual_delivery_enabled,true,'legacy client omission preserves opt-in');
 state.failRate=true;const before=structuredClone(state.config);
 await assert.rejects(service.updateSupplierSettings(11,config('400.00')),/Injected/);assert.deepEqual(state.config,before);assert.equal(state.rollbacks,1);
});
test('individual fees reject fabricated, malformed, overflow, duplicate and invalid cluster rates',async t=>{
 const {state}=setup(t);
 for(const fee of [null,undefined,'',false,'-1','1.001','NaN','Infinity','1e2','100000000.00'])
  await assert.rejects(service.updateSupplierSettings(11,config(fee===undefined?null:fee)),e=>e.code==='INVALID_DELIVERY_FEE');
 await assert.rejects(service.updateSupplierSettings(11,{...config(),individual_delivery_enabled:'false'}),e=>e.code==='INVALID_DELIVERY_CONFIGURATION');
 await assert.rejects(service.updateSupplierSettings(11,{...config(),cluster_rates:[...config().cluster_rates,...config().cluster_rates]}),e=>e.code==='INVALID_RATE_SPECIFICATION');
 await assert.rejects(service.updateSupplierSettings(11,{...config(),cluster_rates:[{...config().cluster_rates[0],cluster_id:4}]}),e=>e.code==='INVALID_CLUSTER');
 assert.equal(state.commits,0);await service.updateSupplierSettings(11,config('0.00'));assert.equal(state.rates.at(-1).fee_pkr,'0.00');
});
test('individual discovery is procurement-only, opt-in and cluster coverage fail closed',async t=>{
 const {connection,state}=setup(t);
 const options=()=>engine.getDeliveryOptions(7,{supplier_id:11,cluster_id:3},connection,{procurement:true});
 assert.equal((await options()).ineligible_modes.find(m=>m.mode==='INDIVIDUAL').reason_code,'MODE_DISABLED_BY_SUPPLIER');
 await service.updateSupplierSettings(11,config());
 assert.equal((await options()).eligible_modes.find(m=>m.mode==='INDIVIDUAL').fee_pkr,'345.67');
 assert.equal((await engine.getDeliveryOptions(7,{supplier_id:11,cluster_id:3,procurement:true},connection)).eligible_modes.some(m=>m.mode==='INDIVIDUAL'),false);
 state.rates.at(-1).is_eligible=false;assert.equal((await options()).eligible_modes.some(m=>m.mode==='INDIVIDUAL'),false);
});
async function quoteFixture(t){const f=setup(t);await service.updateSupplierSettings(11,config());
 const quote=await engine.createAuthoritativeQuote(7,payload,f.connection,{procurement:true});
 Object.assign(quote,{procurement_request_id:4,procurement_quote_id:5});return {...f,quote};}
test('authoritative quote ignores client fee and clock, locks exact rate/version and owned saved address',async t=>{
 const {quote,state}=await quoteFixture(t);
 assert.equal(quote.quoted_delivery_fee_pkr,'345.67');assert.equal(quote.supplier_rate_version,1);
 assert.equal(quote.expires_at.toISOString(),'2026-11-21T00:00:00.000Z');assert.equal(quote.address_id,9);
 assert.match(quote.destination_fingerprint,/^[a-f0-9]{64}$/);
 assert.ok(state.calls.some(c=>c.sql.includes('supplier_delivery_configurations')&&c.sql.includes('FOR UPDATE')));
 assertDeliveryConsent(snapshotDeliveryTerms(quote),snapshotDeliveryTerms(quote).hash);
});
test('public spoofing, pool use, foreign address and unverified destination cannot create individual quotes',async t=>{
 const {connection,state}=setup(t);await service.updateSupplierSettings(11,config());
 await assert.rejects(engine.createAuthoritativeQuote(7,{...payload,procurement:true},connection),e=>e.code==='PROCUREMENT_DELIVERY_REQUIRED');
 await assert.rejects(engine.createAuthoritativeQuote(7,{...payload,pool_id:1},connection,{procurement:true}),e=>e.code==='PROCUREMENT_DELIVERY_REQUIRED');
 await assert.rejects(engine.createAuthoritativeQuote(8,payload,connection,{procurement:true}),e=>e.code==='INVALID_ADDRESS');
 for(const delta of [{geographic_match_status:'PROVISIONAL'},{cluster_id:4}]){
  const saved={...state.address};Object.assign(state.address,delta);
  await assert.rejects(engine.createAuthoritativeQuote(7,payload,connection,{procurement:true}),e=>e.code==='VERIFIED_DELIVERY_DESTINATION_REQUIRED');state.address=saved;
 }
 assert.equal(state.quotes.length,0);
});
test('acceptance requires gated procurement award, unchanged rate, verified address, and post-lock live expiry',async t=>{
 const {connection,state,quote}=await quoteFixture(t);
 const accept=()=>engine.verifyAndAcceptQuote(7,quote.quote_code,{procurementRequestId:4},connection);
 await assert.rejects(engine.verifyAndAcceptQuote(7,quote.quote_code,{},connection),e=>e.code==='PROCUREMENT_AWARD_REQUIRED');
 await assert.rejects(engine.verifyAndAcceptQuote(8,quote.quote_code,{procurementRequestId:4},connection),e=>e.code==='QUOTE_FORBIDDEN');
 state.rates.at(-1).version++;await assert.rejects(accept(),e=>e.code==='DELIVERY_REAPPROVAL_REQUIRED');state.rates.at(-1).version--;
 state.address.full_address='Changed';await assert.rejects(accept(),e=>e.code==='ADDRESS_DESTINATION_MISMATCH');state.address.full_address='Test road';
 state.live=false;await assert.rejects(accept(),e=>e.code==='QUOTE_EXPIRED');assert.equal(quote.status,'PENDING');state.live=true;
 const results=await Promise.allSettled([accept(),accept()]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 assert.equal(quote.status,'ACCEPTED');
});
test('recurring individual preference requires address and cannot inject a fee or bypass quotation',()=>{
 const baseline=[{id:1,line_number:1,family_id:2,quantity:'1',unit:'kg',allow_substitutions:false}];
 const input={expected_revision:0,items:[{template_item_id:1,quantity:'2'}],delivery_preference:{mode:'INDIVIDUAL',address_id:9}};
 assert.deepEqual(normalizeCycleInputs(baseline,input).delivery_preference,{mode:'INDIVIDUAL',address_id:9});
 for(const preference of [{mode:'INDIVIDUAL'},{mode:'INDIVIDUAL',address_id:9,fee:0}])
  assert.throws(()=>normalizeCycleInputs(baseline,{...input,delivery_preference:preference}));
});
test('procurement discovery and binding carry trusted context and reject revised individual rates',async t=>{
 const {state,connection,quote}=await quoteFixture(t);
 const {ProcurementDeliveryOptionsService}=require('../src/services/procurementDeliveryOptionsService');
 const owned={supplier_id:11,status:'ACTIVE',request_status:'OPEN',valid_until:'2099-12-01T00:00:00Z',current_version:1};
 const discovery=new ProcurementDeliveryOptionsService({query:async()=>[[owned]]},{getDeliveryOptions:async(buyer,args,conn,context)=>{
  assert.equal(buyer,7);assert.equal(context.procurement,true);return engine.getDeliveryOptions(buyer,args,connection,context);
 }});
 assert.equal((await discovery.forBuyer(7,4,5,3)).eligible_modes.find(m=>m.mode==='INDIVIDUAL').fee_pkr,'345.67');
 const {ProcurementDeliveryBindingService}=require('../src/services/procurementDeliveryBindingService');
 const validation={query:async(sql,args)=>{
  if(sql.includes('FROM delivery_quotes'))return [[{...quote,is_live:1}]];
  if(sql.includes('FROM buyer_delivery_addresses'))return [[state.address]];
  return connection.query(sql,args);
 }};
 const binding=new ProcurementDeliveryBindingService({},engine);
 const input={buyerId:7,supplierId:11,requestId:4,quoteId:5,code:quote.quote_code,fee:'345.67'};
 assert.equal((await binding.validate(validation,input)).supplier_rate_version,1);
 await assert.rejects(binding.validate(validation,{...input,fee:'0.00'}),e=>e.code==='DELIVERY_FEE_MISMATCH');
 state.rates.at(-1).version++;
 await assert.rejects(binding.validate(validation,input),e=>e.code==='DELIVERY_REAPPROVAL_REQUIRED');
});
test('existing run policy keeps individual runs singleton with unchanged locked buyer fees',()=>{
 const {compatibleRun}=require('../src/services/procurementDeliveryRunPolicy');
 const choice={order_id:1,supplier_id:11,cluster_id:3,mode:'INDIVIDUAL',delivery_day:'2026-12-01',delivery_window:'09:00-12:00',handling_class:'AMBIENT',locked_delivery_fee:'345.67'};
 const measure={weight_kg:'1.0000',volume_l:'0.0000'};
 const capacity={max_weight_kg:'10',max_volume_l:'0',planned_cost_pkr:'345.67'};
 const run=compatibleRun([choice],[measure],capacity);assert.equal(run.locked_fee_total,'345.67');assert.equal(run.locked_buyer_fees_unchanged,true);
 assert.throws(()=>compatibleRun([choice,{...choice,order_id:2}],[measure,measure],capacity),e=>e.code==='ROUTE_MODE_INCOMPATIBLE');
});
