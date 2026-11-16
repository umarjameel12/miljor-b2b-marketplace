import React,{useEffect,useState} from 'react';
import apiClient from '../../api/client';

export function CollectiveBuyerCheckout({groupId}){
 const [state,setState]=useState(null),[addresses,setAddresses]=useState([]);
 const [addressId,setAddressId]=useState(''),[loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const load=async()=>{
  setLoading(true);
  try{
   const [stateResponse,addressResponse]=await Promise.all([
    apiClient.get(`/procurement/collectives/${groupId}/order`),
    apiClient.get('/buyer/addresses')
   ]);
   setState(stateResponse.data.data);
   const data=addressResponse.data.data;
   const list=Array.isArray(data)?data:(data?.addresses||[]);
   setAddresses(list);
   const first=list.find(a=>a.is_default)||list[0];
   setAddressId(first?String(first.id):'');
  }catch(e){setError(e.response?.data?.error?.message||'Could not load qualified order');}
  finally{setLoading(false);}
 };
 useEffect(()=>{load();},[groupId]);
 const submit=async()=>{
  if(!state?.approved_terms||!addressId)return;
  setBusy(true);setError('');
  try{
   await apiClient.post(`/procurement/collectives/${groupId}/orders`,{
     bid_version_id:state.approved_terms.bid_version_id,
     total_amount:state.approved_terms.total_amount,
     delivery_address_id:Number(addressId),
     confirm_payment_terms:true,confirm_physical_specifications:true
   },{headers:{'X-Idempotency-Key':'collective-'+crypto.randomUUID()}});
   await load();
  }catch(e){setError(e.response?.data?.error?.message||'Cannot lock own payment order');}
  finally{setBusy(false);}
 };
 const order=state?.order;
 return <section aria-label="Buyer-owned collective checkout"
  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-3">
  <h4 className="font-semibold text-sm">Your own group payment</h4>
  {loading&&<p role="status" className="text-xs">Checking your approved group terms…</p>}
  {error&&<p role="alert" className="text-xs text-red-600">{error}</p>}
  {!loading&&order&&<div className="space-y-2 text-sm">
   <p>Order #{order.order_id} · {order.payment_status}</p>
   <p>Total locked: PKR {order.total_amount}</p>
   <a href={order.checkout_endpoint.replace('/api/v1','')}
     onClick={e=>e.preventDefault()} className="sr-only">Checkout endpoint</a>
   <p className="text-xs text-[var(--text-muted)]">This is your independent payable order. Group consent did not charge you.</p>
   <a href={`/orders`} className="inline-block underline text-[var(--brand-accent)]">Open your order to pay with Safepay</a>
  </div>}
  {!loading&&!order&&state?.approved_terms&&<div className="space-y-3 text-sm">
   <p>Supplier goods: PKR {state.approved_terms.item_subtotal}</p>
   <p>Fixed supplier delivery: PKR {state.approved_terms.delivery_fee}</p>
   <p>Buyer processing: PKR {state.approved_terms.buyer_platform_fee}</p>
   <p className="font-bold">Your approved total: PKR {state.approved_terms.total_amount}</p>
   <label className="block text-xs font-medium" htmlFor={'collective-address-'+groupId}>Confirmed delivery address</label>
   <select id={'collective-address-'+groupId} value={addressId} onChange={e=>setAddressId(e.target.value)}
    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2">
    <option value="">Select your address</option>
    {addresses.filter(a=>a.user_confirmation_status==='CONFIRMED'&&!a.manual_review_required)
      .map(a=><option key={a.id} value={a.id}>{a.full_address}</option>)}
   </select>
   <button type="button" onClick={submit} disabled={busy||!addressId}
    className="rounded-xl px-4 py-2 bg-[var(--brand-accent)] text-stone-900 font-semibold disabled:opacity-50">
     {busy?'Locking…':'Confirm my payable order (no charge yet)'}
   </button>
   <p className="text-xs text-[var(--text-muted)]">A real payment occurs only later through the order's Safepay checkout. No buyer can pay on another buyer's behalf.</p>
  </div>}
  {!loading&&!state?.approved_terms&&!order&&<p className="text-xs">Your exact bid-version approval must be recorded before this group can create an order.</p>}
 </section>;
}
