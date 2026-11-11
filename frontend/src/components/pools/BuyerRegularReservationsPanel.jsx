import React,{useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {toast} from 'react-toastify';
import {RefreshCw,Info} from 'lucide-react';
import apiClient from '../../api/client';
import {RegularReservationWorkflow} from '../RegularReservationWorkflow';

// B4 only: buyer-owned real reservations. Does NOT silently accept final supplier
// terms, convert orders, charge money, or pretend B6 requests are Regular Pools.
export function BuyerRegularReservationsPanel(){
  const [items,setItems]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(null);
  const cancellationKeys=useRef({});
  const [activeOffer,setActiveOffer]=useState(null);
  const load=async()=>{
    try{
      const res=await apiClient.get('/reservations/my');
      setItems(res?.data?.data?.reservations||[]);
      setError('');
    }catch(e){setError(e.response?.data?.error?.message||'Unable to load Regular Pool reservations');}
    finally{setLoading(false);}
  };
  useEffect(()=>{load()},[]);
  const cancel=async(r)=>{
    if(!r.permissions?.can_cancel)return;
    if(!window.confirm('Cancel this uncommitted Regular Pool reservation?'))return;
    setBusy(r.id);
    try{
      if(!cancellationKeys.current[r.id])
        cancellationKeys.current[r.id]='regular-cancel-'+r.id+'-'+Date.now()+'-'+Math.random().toString(36).slice(2);
      const idem=cancellationKeys.current[r.id];
      await apiClient.post(`/reservations/${r.id}/cancel`,{},
        {headers:{'X-Idempotency-Key':idem}});
      delete cancellationKeys.current[r.id];
      toast.success('Reservation cancelled according to B4 cancellation rules.');
      await load();
    }catch(e){toast.error(e.response?.data?.error?.message||'Reservation cannot be cancelled');}
    finally{setBusy(null);}
  };
  return <section className="space-y-3" aria-label="Your Regular Pool reservations">
    <div className="flex items-center justify-between gap-2">
      <div><h2 className="font-semibold text-lg">Regular Pool Reservations</h2>
        <p className="text-xs text-[var(--text-muted)]">Buyer reservations are separate from confirmed paid orders.</p></div>
      <button type="button" onClick={load} className="underline flex items-center gap-1 text-xs"><RefreshCw size={13}/>Refresh</button>
    </div>
    {error&&<p role="alert" className="text-xs text-red-600">{error}</p>}
    {loading?<p className="text-xs text-[var(--text-muted)]">Loading reservations…</p>:
    !items.length?<p className="text-xs text-[var(--text-muted)]">You have no Regular Pool reservations yet. <Link className="underline" to="/pools?type=REGULAR">Explore Regular Pools</Link>.</p>:
    <div className="grid gap-3 sm:grid-cols-2">{items.map(r=><article key={r.id}
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 space-y-2">
      <div className="flex justify-between gap-2 items-center">
        <span className="text-xs font-semibold">{r.reservation_code||'Reservation #'+r.id}</span>
        <span className="text-xs text-[var(--text-muted)]">{r.status}</span>
      </div>
      <h3 className="text-sm font-semibold">{r.specification?.product_title||r.product_title||'Supplier-owned commodity'}</h3>
      <p className="text-xs text-[var(--text-muted)]">{r.quantity} {r.pool_unit||'listing units'} · {r.supplier?.business_name||'Supplier'}</p>
      {r.pool_progress&&<p className="text-xs">Pool quantity: {r.pool_progress.current_aggregate_qty}. {r.pool_progress.supplier_min_met?'Minimum reached':'Awaiting minimum'} · {r.pool_progress.target_met?'Target reached':'Target pending'}</p>}
      {r.locked_unit_price!=null?<p className="text-xs text-emerald-700 dark:text-emerald-400">Locked unit price: Rs. {Number(r.locked_unit_price).toLocaleString('en-PK')}</p>:
        <p className="text-xs text-[var(--text-muted)]">Final supplier-approved wholesale price is not locked yet.</p>}
      <div className="flex gap-2 items-center flex-wrap">
        <button type="button" onClick={()=>setActiveOffer(current=>current===r.id?null:r.id)}
          className="text-xs px-3 py-2 border rounded-lg border-emerald-600 text-emerald-600">
          {activeOffer===r.id?'Hide final offer':'Review final offer / commitment'}
        </button>
        {r.permissions?.can_cancel&&<button type="button" disabled={busy===r.id}
          onClick={()=>cancel(r)} className="text-xs px-3 py-2 border rounded-lg border-amber-600 text-amber-600">
          {busy===r.id?'Cancelling…':'Cancel reservation'}
        </button>}
      </div>
      {activeOffer===r.id&&<RegularReservationWorkflow reservation={r} onRefresh={load}/>}
      <p className="text-[11px] text-[var(--text-muted)]"><Info size={12} className="inline mr-1"/>Final commercial decisions require buyer consent and backend eligibility. Payment remains a separate Safepay action.</p>
    </article>)}</div>}
  </section>;
}
export default BuyerRegularReservationsPanel;
