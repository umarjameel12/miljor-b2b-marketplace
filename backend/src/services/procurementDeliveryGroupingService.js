'use strict';
// B6-O: buyer-confirmed delivery terms and supplier-owned route proposals.
// No distance-based estimates, order amount changes, payment, refund or fake dispatch.
const crypto=require('node:crypto');
const db=require('../config/db');
const notifications=require('./procurementNotificationService');
const exact=require('./exactDecimal');
const {planSupplierDeliveryGroups}=require('./procurementDeliveryGroupPolicy');
const fail=(code,message,statusCode=400)=>Object.assign(new Error(message),{code,statusCode});
const id=x=>{if(x==null||typeof x==='boolean'||!/^[1-9]\d*$/.test(String(x))||
 !Number.isSafeInteger(Number(x)))throw fail('INVALID_DELIVERY_ID','Positive identifier required.');return Number(x)};
const key=x=>{if(typeof x!=='string'||!/^[a-zA-Z0-9:_-]{12,120}$/.test(x))
 throw fail('INVALID_IDEMPOTENCY_KEY','12–120 character safe key required.');return x};
const money=x=>exact.toCanonical(x,2);
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const read=x=>typeof x==='string'?JSON.parse(x):x;
const normalizedDate=x=>{
 if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(x)||
  !Number.isFinite(Date.parse(x+'T00:00:00Z')))throw fail('INVALID_DELIVERY_DAY','Use YYYY-MM-DD.');
 return x;
};
const options=x=>{
 const day=normalizedDate(x?.delivery_day);
 const lahoreToday=new Date(Date.now()+5*3600000).toISOString().slice(0,10);
 if(day<lahoreToday)
  throw fail('DELIVERY_DAY_IN_PAST','Buyer cannot authorize a past delivery day.');
 const mode=String(x?.mode||'').toUpperCase();
 const window=String(x?.delivery_window||'').trim();
 const handling=String(x?.handling_class||'AMBIENT').toUpperCase().trim();
 if(!['STANDARD_CLUSTERED','PICKUP','EXPRESS'].includes(mode)||
  !/^[a-zA-Z0-9:_ -]{1,60}$/.test(window)||!/^[A-Z0-9_-]{1,32}$/.test(handling))
  throw fail('INVALID_DELIVERY_OPTIONS','Use configured supplier mode and canonical date/window/handling.');
 return {day,mode,window,handling};
};
class ProcurementDeliveryGroupingService {
 constructor(database=db){this.database=database;}
 async acceptBuyerDelivery(buyerId,orderId,payload,idempotency){
  const buyer=id(buyerId),oid=id(orderId),idem=key(idempotency);
  const addressId=id(payload?.address_id),o=options(payload);
  if(payload?.confirm_existing_order_delivery_fee!==true)
   throw fail('DELIVERY_CONSENT_REQUIRED','Buyer must explicitly approve existing locked order delivery fee.');
  const requestHash=hash({buyer,oid,addressId,...o});
  const conn=await this.database.getConnection();
  try{
   await conn.beginTransaction();
   const [orders]=await conn.query(
    "SELECT id,buyer_id,supplier_id,delivery_type,payment_status,fulfillment_status,delivery_fee FROM orders WHERE id=? AND buyer_id=? FOR UPDATE",
    [oid,buyer]);
   const order=orders[0];
   if(!order)throw fail('ORDER_NOT_FOUND','Buyer-owned order not found.',404);
   const [prior]=await conn.query('SELECT acceptance_key,acceptance_hash FROM procurement_order_delivery_choices WHERE order_id=? FOR UPDATE',[oid]);
   if(prior.length){
    if(prior[0].acceptance_key!==idem||prior[0].acceptance_hash!==requestHash)
     throw fail('DELIVERY_CHOICE_LOCKED','Existing paid order delivery details cannot silently change.',409);
    await conn.commit();return {order_id:oid,status:'AUTHORIZED',is_replay:true,creates_payment:false};
   }
   if(order.payment_status!=='PAID'||!['AWAITING_SUPPLIER_ACKNOWLEDGEMENT',
     'PREPARING','READY_FOR_DISPATCH'].includes(order.fulfillment_status))
    throw fail('ORDER_NOT_ELIGIBLE','Only paid, pre-dispatch orders can enter delivery grouping.',409);
   if(o.mode==='PICKUP'&&order.delivery_type!=='SUPPLIER_PICKUP'||
      o.mode!=='PICKUP'&&order.delivery_type==='SUPPLIER_PICKUP')
    throw fail('DELIVERY_MODE_CHANGED','Pickup cannot replace paid doorstep terms without reapproval.',409);
   const [addresses]=await conn.query(
    "SELECT a.id,a.user_id,a.cluster_id,a.revision,a.city,a.user_confirmation_status,a.geographic_match_status,c.is_active AS cluster_active FROM buyer_delivery_addresses a JOIN geographic_clusters c ON c.id=a.cluster_id WHERE a.id=? AND a.user_id=? FOR UPDATE",
    [addressId,buyer]);
   const address=addresses[0];
   if(!address||address.user_confirmation_status!=='CONFIRMED'||
     !Boolean(address.cluster_active)||
     String(address.city).toLowerCase()!=='lahore')
    throw fail('DELIVERY_ADDRESS_INVALID','Buyer-confirmed supported Lahore destination is required.',409);
   const [settings]=await conn.query(
    'SELECT supplier_id,standard_delivery_enabled,pickup_enabled,express_enabled,version FROM supplier_delivery_configurations WHERE supplier_id=?',[order.supplier_id]);
   const setting=settings[0];
   if(!setting)throw fail('SUPPLIER_DELIVERY_NOT_CONFIGURED','Supplier must declare delivery mode.',409);
   if(o.mode==='STANDARD_CLUSTERED'&&!setting.standard_delivery_enabled||
      o.mode==='PICKUP'&&!setting.pickup_enabled||
      o.mode==='EXPRESS'&&!setting.express_enabled)
    throw fail('SUPPLIER_MODE_UNAVAILABLE','Supplier did not enable selected mode.',409);
   if(o.mode!=='PICKUP'){
    const [rates]=await conn.query(
     'SELECT id FROM supplier_delivery_cluster_rates WHERE supplier_id=? AND cluster_id=? AND mode=? AND is_eligible=1',
     [order.supplier_id,address.cluster_id,o.mode]);
    if(!rates.length)throw fail('SUPPLIER_CLUSTER_UNSUPPORTED','Supplier does not serve this cluster with the selected mode.',409);
   }
   if(o.mode==='EXPRESS'){
    const [quotes]=await conn.query(
     "SELECT id FROM delivery_quotes WHERE buyer_id=? AND supplier_id=? AND address_id=? AND cluster_id=? AND mode='EXPRESS' AND status='ACCEPTED' AND quoted_delivery_fee_pkr=? LIMIT 1",
     [buyer,order.supplier_id,addressId,address.cluster_id,order.delivery_fee]);
    if(!quotes.length)throw fail('EXPRESS_REAPPROVAL_REQUIRED','Express needs an accepted exact-fee delivery quote.',409);
   }
   const fee=money(order.delivery_fee);
   await conn.query(
    'INSERT INTO procurement_order_delivery_choices(order_id,buyer_id,supplier_id,delivery_address_id,cluster_id,delivery_day,delivery_window,mode,handling_class,locked_delivery_fee,address_version,supplier_config_version,acceptance_key,acceptance_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [oid,buyer,order.supplier_id,addressId,address.cluster_id,o.day,o.window,o.mode,
     o.handling,fee,address.revision,setting.version,idem,requestHash]);
   await notifications.enqueue(conn,{recipient_id:buyer,recipient_role:'BUYER',
    event_key:'delivery:choice:'+oid,event_type:'DELIVERY_CHOICE_RECORDED',
    payload:{order_id:oid,supplier_id:order.supplier_id}});
   await conn.commit();return {order_id:oid,status:'AUTHORIZED',
    mode:o.mode,cluster_id:address.cluster_id,delivery_day:o.day,
    locked_delivery_fee:fee,is_replay:false,creates_payment:false};
  }catch(e){await conn.rollback();if(e.code==='ER_DUP_ENTRY')
    throw fail('DELIVERY_ACCEPTANCE_CONFLICT','Concurrent delivery acceptance; refresh.',409);
   throw e;}finally{conn.release()}
 }
 async planSupplierRun(supplierId,orderIds,rawKey){
  const supplier=id(supplierId),idem=key(rawKey);
  if(!Array.isArray(orderIds)||!orderIds.length||orderIds.length>50)
   throw fail('INVALID_STOP_COUNT','Choose 1–50 orders.');
  const sorted=orderIds.map(id).sort((a,b)=>a-b);
  if(new Set(sorted).size!==sorted.length)
   throw fail('DUPLICATE_DELIVERY_ORDER','Cannot include an order twice.');
  const requestHash=hash({supplier,orders:sorted});
  const conn=await this.database.getConnection();
  try{
   await conn.beginTransaction();
   const [prior]=await conn.query(
    'SELECT id,request_hash,status,snapshot FROM procurement_delivery_runs WHERE supplier_id=? AND idempotency_key=? FOR UPDATE',
    [supplier,idem]);
   if(prior.length){
    if(prior[0].request_hash!==requestHash)
     throw fail('IDEMPOTENCY_CONFLICT','Delivery run key used with different stops.',409);
    await conn.commit();return {run:read(prior[0].snapshot),is_replay:true};
   }
   const [verified]=await conn.query(
    "SELECT u.id FROM users u JOIN supplier_profiles p ON p.supplier_id=u.id WHERE u.id=? AND u.role='SUPPLIER' AND u.is_verified=1 AND u.verification_status='VERIFIED' AND p.verification_status='VERIFIED'",
    [supplier]);
   if(!verified.length)throw fail('SUPPLIER_NOT_VERIFIED','Verified supplier required.',403);
   const inputs=[];
   for(const oid of sorted){
    const [rows]=await conn.query(
     "SELECT o.id,o.buyer_id,o.supplier_id,o.payment_status,o.fulfillment_status,o.delivery_fee,c.delivery_address_id,c.cluster_id,c.delivery_day,c.delivery_window,c.mode,c.handling_class,c.locked_delivery_fee,c.supplier_config_version,c.address_version,a.revision AS current_address_revision,d.standard_delivery_enabled,d.express_enabled,d.pickup_enabled,d.version AS current_supplier_config_version,cl.is_active AS cluster_active,rate.is_eligible AS rate_enabled FROM orders o JOIN procurement_order_delivery_choices c ON c.order_id=o.id JOIN buyer_delivery_addresses a ON a.id=c.delivery_address_id AND a.user_id=o.buyer_id JOIN supplier_delivery_configurations d ON d.supplier_id=o.supplier_id JOIN geographic_clusters cl ON cl.id=c.cluster_id LEFT JOIN supplier_delivery_cluster_rates rate ON rate.supplier_id=o.supplier_id AND rate.cluster_id=c.cluster_id AND rate.mode=c.mode WHERE o.id=? AND o.supplier_id=? FOR UPDATE",
     [oid,supplier]);
    const row=rows[0];
    if(!row)throw fail('SUPPLIER_ORDER_NOT_ELIGIBLE','Selected order is not authorized for supplier route.',403);
    if(row.mode==='PICKUP')
     throw fail('PICKUP_NOT_A_DELIVERY_RUN','Supplier pickup is fulfilled separately.',409);
    if(Number(row.address_version)!==Number(row.current_address_revision)||
       Number(row.supplier_config_version)!==Number(row.current_supplier_config_version))
     throw fail('DELIVERY_TERMS_CHANGED','Destination or supplier delivery terms changed; buyer reconfirmation required.',409);
    if(!exact.exactDecimalEquals(row.delivery_fee,row.locked_delivery_fee,2))
     throw fail('DELIVERY_FEE_CHANGED','Paid order fee differs from accepted delivery choice.',409);
    inputs.push({id:oid,buyer_id:row.buyer_id,supplier_id:row.supplier_id,
     cluster_id:row.cluster_id,delivery_day:row.delivery_day instanceof Date?row.delivery_day.toISOString().slice(0,10):String(row.delivery_day).slice(0,10),
     delivery_window:row.delivery_window,handling_class:row.handling_class,
     delivery_address_id:row.delivery_address_id,mode:row.mode,
     payment_status:row.payment_status,fulfillment_status:row.fulfillment_status,
     locked_delivery_fee:row.locked_delivery_fee,delivery_authorized:true,
     supplier_standard_enabled:!!row.standard_delivery_enabled,
     supplier_express_enabled:!!row.express_enabled,
     supplier_pickup_enabled:!!row.pickup_enabled,
     cluster_supported:!!row.cluster_active&&!!row.rate_enabled});
   }
   const result=planSupplierDeliveryGroups(inputs,{maxStops:50});
   if(result.groups.length!==1||result.excluded.length)
    throw fail('INCOMPATIBLE_DELIVERY_GROUP','Selected orders must share supplier, cluster, day, window and handling.',409);
   const group=result.groups[0];
   const redacted={supplier_id:supplier,cluster_id:group.cluster_id,
    delivery_day:group.delivery_day,delivery_window:group.window,mode:group.mode,
    handling_class:group.handling_class,orders:group.stops.map(stop=>stop.order_id),
    locked_delivery_fee_total:group.total_locked_delivery_fee,
    exact_stop_count:group.stops.length,changes_order_fee:false,creates_payment:false};
   const [created]=await conn.query(
    "INSERT INTO procurement_delivery_runs(supplier_id,cluster_id,delivery_day,delivery_window,mode,handling_class,status,locked_delivery_fee_total,planned_stops,idempotency_key,request_hash,snapshot) VALUES (?,?,?,?,?,?,'PROPOSED',?,?,?,?,?)",
    [supplier,group.cluster_id,group.delivery_day,group.window,group.mode,group.handling_class,
     group.total_locked_delivery_fee,group.stops.length,idem,requestHash,JSON.stringify(redacted)]);
   for(const stop of group.stops){
    await conn.query(
     'INSERT INTO procurement_delivery_stops(run_id,order_id,buyer_id,address_id,locked_delivery_fee,snapshot) VALUES (?,?,?,?,?,?)',
     [created.insertId,stop.order_id,stop.buyer_id,stop.delivery_address_id,
      stop.locked_delivery_fee,JSON.stringify({order_id:stop.order_id,
       fee:stop.locked_delivery_fee,fulfillment_authority:'EXISTING_FULFILLMENT_ENGINE'})]);
    await notifications.enqueue(conn,{recipient_id:stop.buyer_id,recipient_role:'BUYER',
     event_key:'delivery:planned:'+stop.order_id+':'+created.insertId,
     event_type:'DELIVERY_RUN_PLANNED',
     payload:{order_id:stop.order_id,run_id:created.insertId,supplier_id:supplier}});
   }
   await conn.commit();return {run:{...redacted,id:created.insertId,status:'PROPOSED'},is_replay:false};
  }catch(e){await conn.rollback();if(e.code==='ER_DUP_ENTRY')
    throw fail('DELIVERY_RUN_CONFLICT','An order is already assigned to a delivery run.',409);
   throw e;}finally{conn.release()}
 }
 async refreshSupplierRun(supplierId,runId){
  const supplier=id(supplierId),rid=id(runId),conn=await this.database.getConnection();
  try{await conn.beginTransaction();
   const [runs]=await conn.query(
    'SELECT id,status FROM procurement_delivery_runs WHERE id=? AND supplier_id=? FOR UPDATE',[rid,supplier]);
   const run=runs[0];
   if(!run)throw fail('DELIVERY_RUN_NOT_FOUND','Own supplier run not found.',404);
   if(run.status==='CANCELLED')throw fail('DELIVERY_RUN_CANCELLED','Cancelled run is immutable.',409);
   const [stops]=await conn.query(
    "SELECT s.id,s.order_id,s.buyer_id,s.status AS stop_status,o.payment_status,o.fulfillment_status FROM procurement_delivery_stops s JOIN orders o ON o.id=s.order_id AND o.supplier_id=? WHERE s.run_id=? ORDER BY s.order_id FOR UPDATE",
    [supplier,rid]);
   if(!stops.length)throw fail('DELIVERY_RUN_EMPTY','No supplier orders attached.',409);
   const nextStop=x=>{
    if(x.payment_status!=='PAID'||x.fulfillment_status==='EXCEPTION')return 'EXCEPTION';
    if(['BUYER_CONFIRMED','COMPLETED'].includes(x.fulfillment_status))return 'BUYER_CONFIRMED';
    if(x.fulfillment_status==='SUPPLIER_DELIVERED')return 'SUPPLIER_DELIVERED';
    if(x.fulfillment_status==='DISPATCHED')return 'DISPATCHED';
    return 'ASSIGNED';
   };
   const nextStops=stops.map(x=>({...x,next_status:nextStop(x)}));
   let nextStatus='PROPOSED';
   if(nextStops.some(x=>x.next_status==='EXCEPTION'))nextStatus='EXCEPTION';
   else if(nextStops.every(x=>x.next_status==='BUYER_CONFIRMED'))nextStatus='DELIVERED';
   else if(nextStops.some(x=>['DISPATCHED','SUPPLIER_DELIVERED','BUYER_CONFIRMED'].includes(x.next_status)))
    nextStatus='DISPATCHED';
   else if(stops.every(x=>x.fulfillment_status==='READY_FOR_DISPATCH'))
    nextStatus='CONFIRMED';
   const levels={PROPOSED:0,CONFIRMED:1,DISPATCHED:2,DELIVERED:3,EXCEPTION:4};
   if(nextStatus!=='EXCEPTION'&&levels[nextStatus]<levels[run.status])
    nextStatus=run.status; // no backwards run status on eventual order reads
   for(const stop of nextStops){
    if(stop.stop_status===stop.next_status)continue;
    await conn.query('UPDATE procurement_delivery_stops SET status=? WHERE id=?',[stop.next_status,stop.id]);
    await notifications.enqueue(conn,{recipient_id:stop.buyer_id,recipient_role:'BUYER',
     event_key:'delivery:status:'+stop.order_id+':'+stop.next_status,
     event_type:'DELIVERY_STATUS_CHANGED',
     payload:{order_id:stop.order_id,run_id:rid,status_code:stop.next_status}});
   }
   if(run.status!==nextStatus){
    await conn.query('UPDATE procurement_delivery_runs SET status=? WHERE id=?',[nextStatus,rid]);
   }
   await conn.commit();return {run_id:rid,status:nextStatus,
    stop_statuses:nextStops.map(x=>({order_id:x.order_id,status:x.next_status})),
    fulfillment_source:'AUTHORITATIVE_ORDER_FULFILLMENT',orders_mutated:false};
  }catch(e){await conn.rollback();throw e}finally{conn.release()}
 }
 async supplierRuns(supplierId){
  const supplier=id(supplierId);
  const [rows]=await this.database.query(
   'SELECT id,cluster_id,delivery_day,delivery_window,mode,status,planned_stops,locked_delivery_fee_total FROM procurement_delivery_runs WHERE supplier_id=? ORDER BY delivery_day DESC,id DESC LIMIT 100',
   [supplier]);
  return rows;
 }
 async buyerDelivery(buyerId,orderId){
  const buyer=id(buyerId),oid=id(orderId);
  const [rows]=await this.database.query(
   "SELECT c.order_id,c.cluster_id,c.delivery_day,c.delivery_window,c.mode,c.locked_delivery_fee,r.id AS run_id,r.status AS run_status,s.status AS stop_status FROM procurement_order_delivery_choices c LEFT JOIN procurement_delivery_stops s ON s.order_id=c.order_id LEFT JOIN procurement_delivery_runs r ON r.id=s.run_id WHERE c.order_id=? AND c.buyer_id=?",
   [oid,buyer]);
  if(!rows.length)throw fail('DELIVERY_NOT_FOUND','Buyer delivery is unavailable.',404);
  return rows[0];
 }
}
module.exports=new ProcurementDeliveryGroupingService();
module.exports.ProcurementDeliveryGroupingService=ProcurementDeliveryGroupingService;
