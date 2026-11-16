import React,{useEffect,useState} from 'react';
import apiClient from '../../api/client';

export function CollectiveBuyerCheckout({groupId}){
 const [state,setState]=useState(null),[addresses,setAddresses]=useState([]);
 const [addressId,setAddressId]=useState(''),[loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [route,setRoute]=useState(null),[routeBusy,setRouteBusy]=useState(false);
 const [rejectionReason,setRejectionReason]=useState('');
 const load=async()=>{
  setLoading(true);
  try{
   const [stateResponse,addressResponse]=await Promise.all([
    apiClient.get(`/procurement/collectives/${groupId}/order`),
    apiClient.get('/buyer/addresses')
   ]);
   setState(stateResponse.data.data);
   try{
     const proposed=await apiClient.get(`/procurement/collectives/${groupId}/delivery-route`);
     setRoute(proposed.data.data);
   }catch(e){if(e.response?.status===404)setRoute(null);else throw e;}

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
 const decide=async decision=>{
   if(!route)return;
   setRouteBusy(true);setError('');
   try{
     await apiClient.post(`/procurement/collectives/${groupId}/delivery-route/decision`,{
       run_id:route.run_id,decision,...(decision==='REJECT'?{reason:rejectionReason}:{})
     });
     await load();
   }catch(e){setError(e.response?.data?.error?.message||'Could not save delivery decision');}
   finally{setRouteBusy(false);}
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
   <p className="text-xs text-[var(--text-muted)]">This is your independent payable order. Group consent did not charge you.</p>
   <a href={`/orders`} className="inline-block underline text-[var(--brand-accent)]">Open your order to pay with Safepay</a>
  </div>}
  {!loading&&route&&order&&<section aria-label="My group delivery window"
    className="rounded-xl border border-[var(--border-subtle)] p-3 space-y-2">
    <h5 className="font-semibold text-sm">Your proposed clustered delivery</h5>
    <p className="text-xs">{String(route.delivery_day).slice(0,10)} · {route.delivery_window} · {route.run_status}</p>
    <p className="text-xs">Your response: {route.approval_status}</p>
    {route.approval_status==='PENDING'&&<div className="space-y-2">
      <button type="button" disabled={routeBusy} onClick={()=>decide('ACCEPT')}
        className="rounded-lg bg-[var(--brand-accent)] px-3 py-2 font-semibold text-stone-900 text-xs">
        Accept my delivery window
      </button>
      <label className="block text-xs">Reason to reject/reschedule
        <input value={rejectionReason} onChange={e=>setRejectionReason(e.target.value)}
          className="block w-full border rounded-lg p-2 bg-[var(--bg-surface)]"/>
      </label>
      <button type="button" disabled={routeBusy||rejectionReason.trim().length<8}
        onClick={()=>decide('REJECT')} className="rounded-lg border px-3 py-2 text-xs">
        Reject window and request review
      </button>
    </div>}
    <p className="text-xs text-[var(--text-muted)]">Supplier dispatch is blocked until all buyers accept. Your receipt confirmation remains separate.</p>
  </section>}
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
