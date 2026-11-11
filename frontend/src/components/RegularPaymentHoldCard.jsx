import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Clock,RefreshCw,ExternalLink,ShieldCheck} from 'lucide-react';
import apiClient from '../api/client';
import {CountdownTimer} from './ui/CountdownTimer';

// B4 regular-only payment hold. Separate from pool expiry and B5 flash checkout holds.
// All expiration/checkout decisions are made by server/verified Safepay state, never this clock.
export function RegularPaymentHoldCard({order}) {
  const [status,setStatus]=useState(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const checkoutKey=useRef(null);
  const [error,setError]=useState('');
  const fetchStatus=useCallback(async()=>{
    try{
      const {data}=await apiClient.get(`/orders/${order.id}/payment-status`);
      if(data.success)setStatus(data.data);
      else throw Error(data.error?.message||'Payment status unavailable');
      setError('');
    }catch(e){setError(e.response?.data?.error?.message||e.message||'Could not load payment status');}
    finally{setLoading(false);}
  },[order.id]);
  useEffect(()=>{
    fetchStatus();
    const interval=setInterval(fetchStatus,30000);
    return()=>clearInterval(interval);
  },[fetchStatus]);
  const hold=status?.regular_pool_payment_hold;
  const paid=status?.payment_status==='PAID'||hold?.status==='PAID';
  const pending=hold?.status==='PAYMENT_PENDING'||status?.lifecycle_phase==='WAITING_FOR_PROVIDER_CONFIRMATION';
  const canCheckout=Boolean(hold?.can_start_checkout)&&!paid&&!pending;
  const checkout=async()=>{
    if(!canCheckout||busy)return;
    setBusy(true);setError('');
    try {
      if(!checkoutKey.current)checkoutKey.current=`b4-checkout-${order.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const key=checkoutKey.current;
      const {data}=await apiClient.post(`/orders/${order.id}/checkout`,{},{
        headers:{'X-Idempotency-Key':key}
      });
      const url=data?.data?.checkout_url;
      if(!url||!/^https:\/\//i.test(url))throw Error('Secure checkout URL unavailable');
      window.location.assign(url);
    }catch(e){setError(e.response?.data?.error?.message||e.message||'Unable to initiate payment');setBusy(false);fetchStatus();}
  };
  return (
    <article className="rounded-2xl border p-4 space-y-3" style={{backgroundColor:'var(--bg-card)',borderColor:'var(--border-subtle)'}}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-[var(--text-muted)]">Regular Pool · Order {order.order_code}</div>
          <div className="font-semibold text-sm text-[var(--text-primary)]">{order.product_title||'Wholesale commodity'}</div>
        </div>
        <span className="text-sm font-bold tabular-nums">Rs. {Number(order.total_amount).toLocaleString('en-PK',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
      </div>
      {loading?<p className="text-xs text-[var(--text-muted)]">Loading payment deadline…</p>
      : !hold?<p className="text-xs text-[var(--text-muted)]">Historical order — no retroactive payment deadline.</p>
      :paid?<div className="flex items-center gap-2 text-xs text-emerald-700"><ShieldCheck size={14}/> Payment verified</div>
      :pending?<div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-200">
        <ShieldCheck size={14} className="inline mr-2"/>Checkout started. Awaiting authoritative Safepay confirmation; expiry will not automatically cancel this payment.
      </div>
      :hold.status==='EXPIRED'||!hold.can_start_checkout?
        <div className="text-xs text-amber-700 dark:text-amber-400">Payment hold expired. New checkout is blocked; contact MilJor support for safe reauthorization.</div>
      :<div className="rounded-xl border p-3 flex flex-wrap items-center justify-between gap-3" style={{borderColor:'var(--border-subtle)'}}>
          <div>
            <div className="text-[11px] text-[var(--text-muted)] flex gap-1 items-center"><Clock size={13}/> Payment hold deadline</div>
            <CountdownTimer deadline={hold.expires_at} serverTime={hold.server_time} label="Pay within" onExpire={fetchStatus}/>
          </div>
          <button type="button" disabled={!canCheckout||busy} onClick={checkout}
            className="px-4 py-2 rounded-xl text-xs font-semibold disabled:opacity-40 bg-emerald-700 text-white flex gap-2 items-center">
            {busy?'Connecting…':'Pay securely'}<ExternalLink size={13}/>
          </button>
        </div>}
      <div className="flex justify-between items-center gap-3">
        <span className="text-[11px] text-[var(--text-muted)]">Pool participation cutoff and payment hold are separate timers.</span>
        <button type="button" onClick={fetchStatus} aria-label="Refresh payment status" className="text-[var(--text-muted)]"><RefreshCw size={15}/></button>
      </div>
      {error&&<p role="alert" className="text-xs text-red-600">{error}</p>}
    </article>
  );
}
