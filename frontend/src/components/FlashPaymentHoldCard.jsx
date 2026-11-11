import React,{useState} from 'react';
import {CountdownTimer} from './ui/CountdownTimer';
import apiClient from '../api/client';
// Read-only payment state plus explicit Safepay checkout for an existing B5 Flash order.
export function FlashPaymentHoldCard({hold,onRefresh}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [elapsed,setElapsed]=useState(false);
 const paid=hold.verified_paid||hold.payment_status==='PAID';
 const pending=hold.payment_pending||hold.hold_status==='PAYMENT_PENDING';
 const canCheckout=hold.can_checkout&&!paid&&!pending&&!elapsed;
 const checkout=async()=>{
  if(busy||!canCheckout)return;
  setBusy(true);setError('');
  try{
   const res=await apiClient.post(`/orders/${hold.order_id}/checkout`,{},
    {headers:{'X-Idempotency-Key':`ucp-b5-checkout-${hold.order_id}-${Date.now()}`}});
   const url=res.data?.data?.checkout_url;
   if(!url||!/^https:\/\//i.test(url))throw Error('No valid Safepay checkout URL was returned. Check payment status.');
   window.location.assign(url);
  }catch(e){setError(e.response?.data?.error?.message||e.message||'Unable to start Safepay checkout');setBusy(false);onRefresh?.();}
 };
 return <article className="border border-[var(--border-subtle)] rounded-xl p-4 space-y-2 bg-[var(--bg-card)]">
  <div className="flex justify-between items-center gap-2"><strong className="text-sm">{hold.product_title||hold.flash_code}</strong>
   <span className="text-xs text-amber-600">Flash Pool</span></div>
  <p className="text-xs text-[var(--text-muted)]">Order {hold.order_code} · {hold.quantity} {hold.purchasing_unit||'units'} · Rs. {Number(hold.total_amount).toLocaleString('en-PK')}</p>
  {paid?<p className="text-xs text-emerald-600">Safepay verified as paid</p>
    :pending?<p className="text-xs text-amber-600">Payment was initiated. Awaiting Safepay verification; do not create a second hold.</p>
    :canCheckout?<div className="flex flex-wrap gap-3 items-center justify-between">
      <CountdownTimer deadline={hold.hold_expires_at} serverTime={hold.server_time} compact label="Pay within" onExpire={()=>{setElapsed(true);onRefresh?.()}}/>
      <button type="button" onClick={checkout} disabled={busy} className="bg-emerald-700 text-white px-4 py-2 rounded-lg text-xs">{busy?'Connecting…':'Continue to Safepay'}</button>
    </div>:<p className="text-xs text-amber-600">Hold not available for new checkout. Review payment status before retrying.</p>}
  <button type="button" onClick={onRefresh} className="underline text-xs text-[var(--text-muted)]">Refresh verified state</button>
  {error&&<p role="alert" className="text-xs text-red-600">{error}</p>}
 </article>;
}
export default FlashPaymentHoldCard;
