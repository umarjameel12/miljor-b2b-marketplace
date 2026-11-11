'use strict';
// B7 ownership bridge: standalone B6 award orders do not have a B4 pool_id.
// The legacy reservation_business_events table requires pool_id NOT NULL with
// an FK to pools. Never insert synthetic pool_id=0 for a direct B6 order.
// This reuses the already accepted transactional B6-Q private notification
// outbox; it never changes payment, settlement or stock.
const notifications=require('./procurementNotificationService');
const fail=(code,message)=>Object.assign(new Error(message),{code,statusCode:409});
async function appendDirectAwardNotice(conn,{order,eventId,statusCode}){
 if(!order||!Number.isSafeInteger(Number(order.id))||Number(order.id)<=0)
  throw fail('POSTPURCHASE_ORDER_REQUIRED','Authoritative order row required.');
 if(order.pool_id!=null && Number(order.pool_id)>0)return false; // B4 legacy outbox
 if(order.notes!=='SMART_PROCUREMENT_BASKET')
  throw fail('POSTPURCHASE_SOURCE_NOT_SUPPORTED','Direct order source has no approved outbox policy.');
 if(typeof eventId!=='string'||!/^EVT-[A-Za-z0-9_-]{4,72}$/.test(eventId)||eventId.length>80||
    typeof statusCode!=='string'||!/^[A-Z0-9_]{3,90}$/.test(statusCode))
  throw fail('POSTPURCHASE_EVENT_INVALID','Invalid durable B6 event key or status.');
 // For a committed order both buyer/supplier are entitled to its operational
 // state. Do not include delivery address, phone, email, prices or arbitrary
 // user-supplied text in external notification projection.
 for(const [role,recipient] of [
  ['BUYER',order.buyer_id],['SUPPLIER',order.supplier_id]
 ]){
  if(!Number.isSafeInteger(Number(recipient))||Number(recipient)<=0)
   throw fail('POSTPURCHASE_RECIPIENT_INVALID','Order party identity missing.');
  await notifications.enqueue(conn,{
   recipient_id:Number(recipient),recipient_role:role,
   event_key:'B7:'+eventId+':'+role,
   event_type:'DELIVERY_STATUS_CHANGED',
   payload:{order_id:Number(order.id),status_code:statusCode}
  });
 }
 return true;
}
module.exports={appendDirectAwardNotice};
