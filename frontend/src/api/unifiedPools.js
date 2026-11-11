// UCP supplier-only presentation facade. Commercial mutations still use
// authoritative B4 Regular Pool and B5 Flash Pool endpoints.
import apiClient from './client';
import {poolsApi} from './pools';
import catalogApi from './catalog';

const newKey=(kind)=>`ucp-${kind}-${Date.now()}-${Math.random().toString(36).slice(2,12)}`;
export const unifiedPoolsApi={
  overview:async()=> (await apiClient.get('/supplier/pools/overview')).data,
  stock:async listingId=>(await apiClient.get('/supplier/pools/stock',{params:{listing_id:listingId}})).data,
  fulfillment:async()=>(await apiClient.get('/supplier/pools/fulfillment')).data,
  analytics:async()=>(await apiClient.get('/supplier/pools/analytics')).data,
  regularClusters:async id=>(await apiClient.get(`/pools/${id}`)).data,
  listings:async()=>catalogApi.getMyListings(),
  saveRegularDraft:async(payload,id=null,idempotencyKey=null)=>id
    ?poolsApi.updateDraftPool(id,payload,idempotencyKey||newKey('regular-update'))
    :poolsApi.createPool(payload,idempotencyKey||newKey('regular-create')),
  updateRegularClusters:async(id,clusters)=>poolsApi.updatePoolClusters(id,clusters),
  publishRegular:async(id,idempotencyKey=null)=>poolsApi.publishPool(id,{},idempotencyKey||newKey('regular-publish')),
  saveFlashDraft:async(payload,id=null)=>(
    await (id?apiClient.put(`/flash-pools/${id}`,payload)
    :apiClient.post('/flash-pools',payload))
  ).data,
  publishFlash:async id=>(await apiClient.post(`/flash-pools/${id}/publish`,{})).data,
  cancelRegular:async id=>(await apiClient.put(`/pools/${id}/cancel`,{})).data,
  cancelFlash:async id=>(await apiClient.post(`/flash-pools/${id}/cancel`,{})).data
};
export default unifiedPoolsApi;
