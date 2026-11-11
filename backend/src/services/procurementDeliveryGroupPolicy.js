'use strict';
// B6-O: deterministic supplier-managed grouping of PAID fulfillment orders.
// No buyer-to-buyer address disclosure, no distance guesses, no price mutation.
const exact=require('./exactDecimal');
const fail=(code,message)=>Object.assign(new Error(message),{code,statusCode:400});
const id=(value,label)=>{
 if(value==null||typeof value==='boolean'||!/^[1-9]\d*$/.test(String(value))||
    !Number.isSafeInteger(Number(value)))throw fail('INVALID_DELIVERY_ID',label+' requires positive ID.');
 return Number(value);
};
const date=v=>{
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00Z')))
  throw fail('INVALID_DELIVERY_DATE','Delivery day requires YYYY-MM-DD.');
 return v;
};
const money=v=>{
 try{
  const x=exact.toCanonical(v,2);
  if(!exact.exactDecimalGte(x,'0.00',2)||x.split('.')[0].length>10)throw Error();
  return x;
 }catch{throw fail('INVALID_DELIVERY_FEE','Order delivery fee requires exact nonnegative PKR.');}
};
function planSupplierDeliveryGroups(orders,{maxStops=12}={}){
 if(!Number.isSafeInteger(maxStops)||maxStops<1||maxStops>50)
  throw fail('INVALID_MAX_STOPS','Supplier stop limit must be 1–50.');
 if(!Array.isArray(orders)||orders.length>500)
  throw fail('INVALID_DELIVERY_ORDERS','Use 0–500 bounded orders.');
 const used=new Set(),groups=new Map(),excluded=[];
 for(const raw of orders){
  const order_id=id(raw.id??raw.order_id,'Order');
  if(used.has(order_id))throw fail('DUPLICATE_DELIVERY_ORDER','Same order cannot be grouped twice.');
  used.add(order_id);
  if(raw.payment_status!=='PAID'||!['AWAITING_SUPPLIER_ACKNOWLEDGEMENT',
   'PREPARING','READY_FOR_DISPATCH'].includes(raw.fulfillment_status)){
   excluded.push({order_id,reason:'ORDER_NOT_DELIVERABLE'});continue;
  }
  const supplier=id(raw.supplier_id,'Supplier'),buyer=id(raw.buyer_id,'Buyer');
  const cluster=id(raw.cluster_id,'Lahore cluster');
  const deliveryDay=date(raw.delivery_day);
  const mode=String(raw.mode||'').trim().toUpperCase();
  if(!['STANDARD_CLUSTERED','EXPRESS','PICKUP'].includes(mode))
   throw fail('UNSUPPORTED_DELIVERY_MODE','Supplier mode must be explicitly configured.');
  const window=String(raw.delivery_window||'').trim();
  const handling=String(raw.handling_class||'AMBIENT').trim().toUpperCase();
  if(!/^[A-Z0-9_-]{1,32}$/.test(handling)||!/^[A-Za-z0-9:_ -]{1,60}$/.test(window))
   throw fail('INVALID_DELIVERY_WINDOW','Only canonical delivery window and handling identifiers.');
  const price=money(raw.locked_delivery_fee);
  if(raw.delivery_authorized!==true)
   throw fail('DELIVERY_NOT_APPROVED','Buyer must approve the locked supplier delivery fee.');
  if(mode==='EXPRESS'&&raw.supplier_express_enabled!==true)
   throw fail('EXPRESS_NOT_CONFIGURED','Fast delivery must be enabled by supplier.');
  if(mode==='PICKUP'&&raw.supplier_pickup_enabled!==true)
   throw fail('PICKUP_NOT_CONFIGURED','Pickup must be enabled by supplier.');
  if(mode==='STANDARD_CLUSTERED'&&raw.supplier_standard_enabled!==true)
   throw fail('STANDARD_NOT_CONFIGURED','Cluster delivery must be enabled.');
  if(raw.cluster_supported!==true)
   throw fail('CLUSTER_NOT_SUPPORTED','Supplier does not serve this cluster.');
  const location=id(raw.delivery_address_id,'Delivery address');
  const key=[supplier,cluster,deliveryDay,mode,window,handling].join('|');
  const group=groups.get(key)||{supplier_id:supplier,cluster_id:cluster,
   delivery_day:deliveryDay,mode,window,handling_class:handling,
   total_locked_delivery_fee:'0.00',stops:[]};
  if(group.stops.length>=maxStops){
   // Stable additional batches: same supplier, cluster and day but max capacity.
   const n=Math.floor(group.stops.length/maxStops);
   throw fail('ROUTE_CAPACITY_REACHED','Create separate delivery batch once route stop limit reached.');
  }
  group.stops.push({order_id,buyer_id:buyer,delivery_address_id:location,
   locked_delivery_fee:price,fulfillment_status:raw.fulfillment_status});
  group.total_locked_delivery_fee=exact.exactDecimalSum([group.total_locked_delivery_fee,price],2);
  groups.set(key,group);
 }
 return {groups:[...groups.values()].sort((a,b)=>a.supplier_id-b.supplier_id||
   a.cluster_id-b.cluster_id||a.delivery_day.localeCompare(b.delivery_day)),
  excluded,changes_order_fees:false,creates_payments:false,
  promises_distance_or_eta:false};
}
module.exports={planSupplierDeliveryGroups};
