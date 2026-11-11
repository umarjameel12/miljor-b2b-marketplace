// UCP supplier-only presentation facade. Commercial mutations still use
// authoritative B4 Regular Pool and B5 Flash Pool endpoints.
import apiClient from './client';
import {poolsApi} from './pools';
import catalogApi from './catalog';

const newKey=(kind)=>`ucp-${kind}-${Date.now()}-${Math.random().toString(36).slice(2,12)}`;
export const unifiedPoolsApi={
  overview:async()=> (await apiClient.get('/supplier/pools/overview')).data,
  deliveryContext:async()=> (await apiClient.get('/supplier/pools/delivery-context')).data,
  inventory:async()=> (await apiClient.get('/supplier/pools/inventory')).data,
  insights:async()=> (await apiClient.get('/supplier/pools/insights')).data,
  alerts:async()=> (await apiClient.get('/supplier/pools/alerts')).data,
  listings:async()=>catalogApi.getMyListings(),
  discover:async(params={})=>(await apiClient.get('/pool-discovery',{params})).data,
  holdFlash:async(id,payload,key)=>(await apiClient.post(`/flash-pools/${id}/hold`,payload,{headers:{'X-Idempotency-Key':key}})).data,
  initiateCheckout:async(orderId,key)=>(await apiClient.post(`/orders/${orderId}/checkout`,{}, {headers:{'X-Idempotency-Key':key}})).data,
  saveRegularDraft:async(payload,id=null,idempotencyKey=null)=>id
    ?poolsApi.updateDraftPool(id,payload,idempotencyKey||newKey('regular-update'))
    :poolsApi.createPool(payload,idempotencyKey||newKey('regular-create')),
  publishRegular:async(id,idempotencyKey=null)=>
    poolsApi.publishPool(id,{},idempotencyKey||newKey('regular-publish')),
  saveFlashDraft:async(payload,id=null)=>(
    await (id?apiClient.put(`/flash-pools/${id}`,payload)
    :apiClient.post('/flash-pools',payload))
  ).data,
  publishFlash:async id=>(await apiClient.post(`/flash-pools/${id}/publish`,{})).data,
  cancelRegular:async id=>(await apiClient.put(`/pools/${id}/cancel`,{})).data,
  cancelFlash:async id=>(await apiClient.post(`/flash-pools/${id}/cancel`,{})).data
};
export default unifiedPoolsApi;
