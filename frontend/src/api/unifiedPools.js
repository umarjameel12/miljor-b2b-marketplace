// UCP supplier-only presentation facade. Commercial mutations still use
// authoritative B4 Regular Pool and B5 Flash Pool endpoints.
import apiClient from './client';
import {poolsApi} from './pools';
import catalogApi from './catalog';

const newKey=(kind)=>`ucp-${kind}-${Date.now()}-${Math.random().toString(36).slice(2,12)}`;
export const unifiedPoolsApi={
  overview:async()=> (await apiClient.get('/supplier/pools/overview')).data,
  listings:async()=>catalogApi.getMyListings(),
  saveRegularDraft:async(payload,id=null)=>id
    ?poolsApi.updateDraftPool(id,payload,newKey('regular-update'))
    :poolsApi.createPool(payload,newKey('regular-create')),
  publishRegular:async id=>poolsApi.publishPool(id,{},newKey('regular-publish')),
  saveFlashDraft:async(payload,id=null)=>(
    await (id?apiClient.put(`/flash-pools/${id}`,payload)
    :apiClient.post('/flash-pools',payload))
  ).data,
  publishFlash:async id=>(await apiClient.post(`/flash-pools/${id}/publish`,{})).data,
  cancelRegular:async id=>(await apiClient.put(`/pools/${id}/cancel`,{})).data,
  cancelFlash:async id=>(await apiClient.post(`/flash-pools/${id}/cancel`,{})).data
};
export default unifiedPoolsApi;
