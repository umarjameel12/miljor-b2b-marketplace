import React,{useRef,useState} from 'react';
import apiClient from '../api/client';
import {CountdownTimer} from './ui/CountdownTimer';
// B4-only explicit buyer commercial decision and order conversion.
// All pricing, commitment, quorum, deadline and money rules stay server-authoritative.
const key=(action,id)=>`ucp-b4-${action}-${id}-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
export function RegularReservationWorkflow({reservation,onRefresh}){
 const [offer,setOffer]=useState(null),[readiness,setReadiness]=useState(null);
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[confirmation,setConfirmation]=useState('');
 const [address,setAddress]=useState(''),[createdOrder,setCreatedOrder]=useState(null);
 const [declineReason,setDeclineReason]=useState('NO_LONGER_NEEDED');
 const decisionIntent=useRef(null),orderIntent=useRef(null);
 const [uncertain,setUncertain]=useState(false);
 const fetchState=async()=>{
   setLoading(true);setError('');
   try{
     const [a,b]=await Promise.all([
       apiClient.get(`/reservations/${reservation.id}/final-offer`),
       apiClient.get(`/reservations/${reservation.id}/order-readiness`)
     ]);
     setOffer(a.data?.data||null);setReadiness(b.data?.data||null);
   }catch(e){setError(e.response?.data?.error?.message||'Commercial offer status is not yet available.');}
   finally{setLoading(false);}
 };
 const decide=async(action)=>{
   if(busy||confirmation!==action)return;
   setBusy(true);setError('');
   try{
     const payload={decision:action,...(action==='DECLINE'?{decline_reason_code:declineReason}:{})};
     if(!decisionIntent.current){
       decisionIntent.current={payload,idempotencyKey:key('decision',reservation.id)};
     }else if(JSON.stringify(decisionIntent.current.payload)!==JSON.stringify(payload)){
       throw Error('Prior buyer decision outcome is uncertain. Refresh final offer before changing your decision.');
     }
     await apiClient.post(`/reservations/${reservation.id}/final-decision`,
       decisionIntent.current.payload,
       {headers:{'X-Idempotency-Key':decisionIntent.current.idempotencyKey}});
     setConfirmation('');setUncertain(false);await fetchState();onRefresh?.();
   }catch(e){setUncertain(!e.response);setError(e.response?.data?.error?.message||e.message||'Commercial decision may be pending. Check final offer before another attempt.');}
   finally{setBusy(false);}
 };
 const convert=async()=>{
   if(busy||!readiness?.eligible_for_order)return;
   if(address.trim().length<8){setError('Provide the complete business delivery address.');return;}
   setBusy(true);setError('');
   try{
     if(!orderIntent.current){
       orderIntent.current={delivery_address:address.trim(),idempotencyKey:key('order',reservation.id)};
     }else if(orderIntent.current.delivery_address!==address.trim()){
       throw Error('Order creation may already be in progress. Check My Orders before changing delivery address.');
     }
     const r=await apiClient.post(`/reservations/${reservation.id}/order`,
       {delivery_address:orderIntent.current.delivery_address},
       {headers:{'X-Idempotency-Key':orderIntent.current.idempotencyKey}});
     const order=r.data?.data?.order;
     if(!order?.id)throw Error('Order status uncertain. Refresh payment history before retrying.');
     setCreatedOrder(order);setUncertain(false);onRefresh?.();
   }catch(e){setUncertain(!e.response);setError(e.response?.data?.error?.message||e.message||'B4 order conversion status is uncertain; check your Orders before retrying.');}
   finally{setBusy(false);}
 };
 return <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 space-y-3">
   <div className="flex justify-between gap-2">
     <div><strong className="text-sm">{reservation.specification?.product_title||reservation.reservation_code}</strong>
     <p className="text-xs text-[var(--text-muted)]">{reservation.reservation_code} · {reservation.quantity} · {reservation.status}</p></div>
     <button type="button" onClick={fetchState} disabled={loading} className="text-xs underline text-emerald-600">{loading?'Checking…':'Review final offer'}</button>
   </div>
   <p className="text-xs text-[var(--text-muted)]">Supplier: {reservation.supplier?.business_name||'Unavailable'}. Reservation is not a payment.</p>
   {offer?.offer_available===false&&<p className="text-xs text-amber-600">{offer.message||'Awaiting pool qualification or supplier acceptance.'}</p>}
   {offer?.offer_available===true&&<div className="rounded-lg border border-[var(--border-subtle)] p-3 space-y-3">
     <p className="text-xs font-bold">Confirmed supplier commercial offer</p>
     <p className="text-sm">Quantity: {offer.reservation.quantity} {offer.reservation.unit} · Supplier price: Rs. {Number(offer.pricing.candidate_unit_price).toLocaleString('en-PK',{minimumFractionDigits:2})} per unit</p>
     <p className="text-xs">Merchandise subtotal: Rs. {Number(offer.pricing.estimated_subtotal).toLocaleString('en-PK',{minimumFractionDigits:2})}</p>
     <p className="text-xs text-[var(--text-muted)]">Delivery and buyer processing fees will be determined by the server before checkout. This is NOT the total payable amount.</p>
     {offer.deadlines?.buyer_commitment_deadline&&<CountdownTimer deadline={offer.deadlines.buyer_commitment_deadline} label="Buyer commitment closes" compact/>}
     {offer.buyer_decision_status?.can_accept&&<div className="space-y-2">
       {confirmation?<div className="text-xs space-y-2"><p>This {confirmation} decision is final. Confirm only if you agree to the supplier's terms.</p>
         {confirmation==='DECLINE'&&<select value={declineReason} onChange={e=>setDeclineReason(e.target.value)}
           className="block w-full border border-[var(--border-subtle)] rounded-lg p-2 bg-[var(--bg-elevated)]">
           {['PRICE_HIGH','FOUND_ALTERNATIVE','NO_LONGER_NEEDED','DELIVERY_WINDOW_UNSUITABLE','TERMS_UNACCEPTABLE','OTHER']
             .map(code=><option key={code} value={code}>{code.replaceAll('_',' ')}</option>)}
         </select>}
         <button type="button" onClick={()=>decide(confirmation)} disabled={busy} className="bg-[var(--brand-accent)] text-[#072a21] font-semibold rounded-lg px-3 py-2 shadow-xs hover:opacity-95 transition cursor-pointer">Confirm {confirmation}</button>
         <button type="button" onClick={()=>setConfirmation('')} className="ml-2 underline">Go back</button>
       </div>:<div className="flex gap-2"><button type="button" onClick={()=>setConfirmation('ACCEPT')} className="bg-[var(--brand-accent)] text-[#072a21] font-semibold rounded-lg px-3 py-2 text-xs shadow-xs hover:opacity-95 transition cursor-pointer">Accept offer</button>
          <button type="button" onClick={()=>setConfirmation('DECLINE')} className="border rounded-lg px-3 py-2 text-xs">Decline</button></div>}
     </div>}
     {offer.buyer_decision_status?.has_decision&&<p className="text-xs font-semibold">Buyer decision: {offer.buyer_decision_status.decision}</p>}
   </div>}
   {readiness&&<p className="text-xs text-[var(--text-muted)]">
     Order readiness: {readiness.eligible_for_order?'Ready for buyer order conversion':
       (readiness.message||(readiness.reason_codes||[]).join(', ')||'Waiting for acceptance, quorum or deadline')}
   </p>}
   {readiness?.eligible_for_order&&!createdOrder&&<div className="space-y-2">
     <label className="block text-xs space-y-1">Business delivery address
       <textarea rows={2} value={address} maxLength={1000} onChange={e=>setAddress(e.target.value)}
         className="w-full border rounded-xl p-2 bg-[var(--bg-elevated)] border-[var(--border-subtle)]"/>
     </label>
     <button type="button" onClick={convert} disabled={busy} className="bg-[var(--brand-accent)] text-[#072a21] font-semibold rounded-lg px-3 py-2 text-xs shadow-xs hover:opacity-95 transition cursor-pointer">Create payable B4 order</button>
   </div>}
   {createdOrder&&<p className="text-xs text-emerald-600">Order {createdOrder.order_code} created. Use the Regular Pool payment-hold card above to initiate Safepay checkout.</p>}
   {error&&<p role="alert" className="text-xs text-red-600">{error}</p>}
   {uncertain&&<p className="text-xs text-amber-600">A network error does not prove the decision/order failed. Refresh your authoritative status before repeating any action.</p>}
 </div>;
}
export default RegularReservationWorkflow;
