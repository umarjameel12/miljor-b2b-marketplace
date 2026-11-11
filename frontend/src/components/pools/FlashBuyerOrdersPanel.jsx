import React,{useState} from 'react';
import {Clock,ShieldCheck,RefreshCw,AlertTriangle} from 'lucide-react';
import {CountdownTimer} from '../ui/CountdownTimer';
import unifiedPoolsApi from '../../api/unifiedPools';
import apiClient from '../../api/client';
import {toast} from 'react-toastify';

// Real buyer-owned B5 hold/order data. Checkout remains the existing Safepay endpoint.
export function FlashBuyerOrdersPanel({holds=[],onRefresh}){
  const [busy,setBusy]=useState(null);
  const [clock,setClock]=useState(new Date().toISOString());
  const refresh=async()=>{
    setClock(new Date().toISOString());
    await onRefresh?.();
  };
  const pay=async(hold)=>{
    if(busy)return;
    setBusy(hold.id);
    try {
      const key='flash-checkout-'+hold.order_id+'-'+Date.now()+'-'+Math.random().toString(36).slice(2);
      const result=await unifiedPoolsApi.initiateCheckout(hold.order_id,key);
      const url=result.data?.checkout_url;
      if(!url||typeof url!=='string'||!/^https:\/\//i.test(url))
        throw Error('Secure Safepay checkout URL was not provided.');
      window.location.assign(url);
    }catch(e){
      toast.error(e.response?.data?.error?.message||e.message||'Checkout unavailable');
      setBusy(null);refresh();
    }
  };
  const reconcile=async(hold)=>{
    if(busy)return;
    setBusy(hold.id);
    try{
      await apiClient.post(`/orders/${hold.order_id}/reconcile`,{});
      await refresh();
      toast.info('Payment status checked against Safepay.');
    }catch(e){toast.error(e.response?.data?.error?.message||e.message||'Safepay verification is unavailable');}
    finally{setBusy(null);}
  };
  if(!holds.length)return null;
  return <section className="space-y-3" aria-label="Your Flash Pool purchases">
    <div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-lg">Flash Pool Orders</h2>
      <button type="button" onClick={refresh} className="text-xs flex gap-1 items-center underline"><RefreshCw size={13}/>Refresh</button></div>
    {holds.map(h=>{
      const paid=h.status==='PAID'||h.payment_status==='PAID';
      const awaiting=h.status==='PAYMENT_PENDING';
      const expired=Date.parse(h.hold_expires_at)<=Date.now();
      const blocked=['EXPIRED','RELEASED','FAILED'].includes(h.status)||(!awaiting&&!paid&&expired);
      return <article key={h.id} className="rounded-2xl border border-[var(--border-subtle)] p-4 bg-[var(--bg-card)] space-y-2">
        <div className="flex justify-between gap-3"><div><p className="text-[11px] text-[var(--text-muted)]">{h.flash_code} · {h.order_code}</p>
          <h3 className="font-semibold text-sm">{h.sku_title}</h3></div>
          <p className="font-semibold text-sm">Rs. {Number(h.total_amount).toLocaleString('en-PK',{minimumFractionDigits:2})}</p></div>
        <p className="text-xs text-[var(--text-muted)]">{h.quantity} {h.purchasing_unit} · Stock hold #{h.id}</p>
        {paid?<p className="text-xs flex gap-2 items-center text-emerald-600"><ShieldCheck size={15}/>Safepay payment verified</p>:
          awaiting?<p className="text-xs text-amber-600 flex gap-2 items-center"><Clock size={14}/>Provider payment processing; stock is not released merely because the timer ends.</p>:
          blocked?<p className="text-xs text-amber-600 flex gap-2 items-center"><AlertTriangle size={14}/>Hold is no longer payable. Do not start another payment for this order.</p>:
          <CountdownTimer deadline={h.hold_expires_at} serverTime={clock} compact label="Pay within"/>}
        {!paid&&<div className="flex flex-wrap gap-2 mt-2">
          {!awaiting&&!blocked&&<button type="button" disabled={busy===h.id} onClick={()=>pay(h)}
            className="rounded-lg bg-emerald-700 text-white px-3 py-2 text-xs disabled:opacity-50">Pay via Safepay</button>}
          {(awaiting||h.payment_status==='AWAITING_PAYMENT')&&<button type="button" disabled={busy===h.id}
            onClick={()=>reconcile(h)} className="rounded-lg border px-3 py-2 text-xs disabled:opacity-50">Check provider status</button>}
        </div>}
      </article>;
    })}
  </section>;
}
export default FlashBuyerOrdersPanel;
