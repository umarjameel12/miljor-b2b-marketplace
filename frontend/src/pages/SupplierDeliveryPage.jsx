import React, { useCallback, useEffect, useState } from 'react';
import { AppShell } from '../components/layout/AppShell';
import SupplierDeliverySettingsForm from '../components/delivery/SupplierDeliverySettingsForm';
import { Truck, RefreshCw, AlertCircle, CheckCircle2, CalendarDays } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';

const formatDate = value => value ? new Date(value).toLocaleDateString('en-PK',{day:'numeric',month:'short',year:'numeric'}) : '—';
const formatPKR = value => new Intl.NumberFormat('en-PK',{style:'currency',currency:'PKR',maximumFractionDigits:2}).format(Number(value||0));
const readable = value => String(value||'—').replaceAll('_',' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());

export const SupplierDeliveryPage = () => {
  const {token}=useAuth();
  const [runs,setRuns]=useState([]);
  const [loading,setLoading]=useState(true);
  const [refreshing,setRefreshing]=useState(false);
  const [error,setError]=useState('');
  const load=useCallback(async(refresh=false)=>{
    if(!token)return;
    refresh?setRefreshing(true):setLoading(true);
    setError('');
    try{
      const response=await fetch('/api/v1/supplier/delivery-runs',{
        headers:{Authorization:`Bearer ${token}`}
      });
      const body=await response.json();
      if(!response.ok||!body.success||!Array.isArray(body.data?.runs))
        throw new Error(body.error?.message||'Unable to load delivery runs');
      setRuns(body.data.runs);
    }catch(e){setError(e.message||'Delivery runs are unavailable');}
    finally{setLoading(false);setRefreshing(false);}
  },[token]);
  useEffect(()=>{load();},[load]);
  return <AppShell>
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-12 space-y-8 text-[var(--text-primary)]">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--brand-accent)]">Supplier operations</p>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">Delivery & logistics</h1>
          <p className="text-sm text-[var(--text-muted)]">Delivery runs, pickup points and coverage.</p>
        </div>
        <button type="button" onClick={()=>load(true)} disabled={loading||refreshing}
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] px-4 py-2.5 text-sm font-medium hover:border-[var(--brand-accent)] disabled:opacity-50">
          <RefreshCw size={16} className={refreshing?'animate-spin':''}/> Refresh
        </button>
      </header>
      <section aria-label="Supplier delivery runs" className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl font-semibold">Delivery runs</h2>
          {!loading && !error && <span className="text-xs text-[var(--text-muted)]">{runs.length} recorded</span>}
        </div>
        {error && <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-400/30 p-3 text-sm"><AlertCircle size={18} className="text-red-500"/>{error}</div>}
        {loading ? <div role="status" className="rounded-2xl border border-[var(--border-subtle)] p-8 text-sm text-[var(--text-muted)]">Loading delivery runs…</div> :
          !error && runs.length===0 ?
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-10 text-center space-y-2">
              <Truck className="mx-auto text-[var(--brand-accent)]" size={26}/>
              <p className="font-medium">No delivery runs yet</p>
              <p className="text-sm text-[var(--text-muted)]">Paid orders assigned to delivery runs will appear here.</p>
            </div> :
          !error && <div className="grid gap-3">
            {runs.map(run=><article key={run.id} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 sm:p-6">
              <div className="flex flex-wrap justify-between items-start gap-3">
                <div>
                  <h3 className="text-base font-semibold">Run #{run.id}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
                    <span className="inline-flex items-center gap-1"><CalendarDays size={14}/>{formatDate(run.delivery_day)}</span>
                    <span>{readable(run.mode)}</span>
                    <span>Cluster {run.cluster_id}</span>
                    <span>{run.delivery_window}</span>
                  </div>
                </div>
                <span className="rounded-full border border-[var(--border-subtle)] px-3 py-1 text-xs font-medium">{readable(run.status)}</span>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div><p className="text-xs text-[var(--text-muted)]">Assigned stops</p><p className="mt-1 font-sans tabular-nums font-semibold">{run.actual_stops} / {run.planned_stops}</p></div>
                <div><p className="text-xs text-[var(--text-muted)]">Buyer confirmed</p><p className="mt-1 font-sans tabular-nums font-semibold">{run.buyer_confirmed_stops}</p></div>
                <div><p className="text-xs text-[var(--text-muted)]">Exceptions</p><p className="mt-1 font-sans tabular-nums font-semibold">{run.exception_stops}</p></div>
                <div><p className="text-xs text-[var(--text-muted)]">Locked delivery fees</p><p className="mt-1 font-sans tabular-nums font-semibold">{formatPKR(run.locked_delivery_fee_total)}</p></div>
              </div>
            </article>)}
          </div>}
      </section>
      <section aria-label="Supplier delivery configuration" className="space-y-4">
        <h2 className="font-display text-2xl font-semibold">Coverage & pricing</h2>
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 sm:p-6">
          <SupplierDeliverySettingsForm onSaved={()=>toast.success('Delivery settings saved')}/>
        </div>
      </section>
    </main>
  </AppShell>;
};
export default SupplierDeliveryPage;
