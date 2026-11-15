import apiClient from './client.js';
const dataOf=response=>{
  if(!response.data?.success||!response.data.data)throw Error('Supplier operation was not confirmed');
  return response.data.data;
};
export const supplierFulfillmentApi={
  overview:async({signal}={})=>dataOf(await apiClient.get('/supplier/operations/overview',{signal})),
  list:async({page=1,status,signal}={})=>dataOf(await apiClient.get('/supplier/orders',{params:{page,limit:20,...(status?{status}:{})},signal})),
  detail:async(id,{signal}={})=>dataOf(await apiClient.get(`/supplier/orders/${encodeURIComponent(id)}`,{signal})),
  transition:async(id,body,key,{signal}={})=>dataOf(await apiClient.post(`/supplier/orders/${encodeURIComponent(id)}/transition`,body,{headers:{'X-Idempotency-Key':key},signal})),
  exception:async(id,body,key,{signal}={})=>dataOf(await apiClient.post(`/supplier/orders/${encodeURIComponent(id)}/exception`,body,{headers:{'X-Idempotency-Key':key},signal})),
  invoice:async(id,{signal}={})=>dataOf(await apiClient.get(`/invoices/${encodeURIComponent(id)}`,{signal})),
};
export function nextSupplierMilestone(order){
  if(order?.payment_status!=='PAID')return null;
  return {AWAITING_SUPPLIER_ACKNOWLEDGEMENT:'PREPARING',PREPARING:'READY_FOR_DISPATCH',READY_FOR_DISPATCH:'DISPATCHED',DISPATCHED:'SUPPLIER_DELIVERED'}[order.fulfillment_status]||null;
}
export function supplierDeliveryMethods(order){
  return order?.delivery_type==='SUPPLIER_PICKUP'?['BUYER_PICKUP']:['SUPPLIER_FLEET','THIRD_PARTY_COURIER','STANDARD_DELIVERY'];
}
export function createSupplierIntentStore(makeKey=()=>`supplier-${crypto.randomUUID()}`){
  const keys=new Map();
  return {get(actorId,orderId,action,body){
    const signature=JSON.stringify([actorId,orderId,action,body]);
    if(!keys.has(signature))keys.set(signature,makeKey());
    return keys.get(signature);
  }};
}
