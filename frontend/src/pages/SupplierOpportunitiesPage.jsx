import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { useAuth } from '../context/AuthContext';
import { SupplierGroupDeliveryPanel } from '../components/procurement/SupplierGroupDeliveryPanel';

const filters = ['all','single','grouped'];
export const SupplierOpportunitiesPage = () => {
  const { user, token } = useAuth();
  const [type,setType] = useState('all');
  const [items,setItems] = useState([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [counts,setCounts] = useState({all:0,single:0,grouped:0});
  const reload = useCallback(async(signal) => {
    if(!token) { setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/v1/procurement/supplier/opportunities?type='+encodeURIComponent(type), {
        headers:{Authorization:'Bearer '+token},signal
      });
      const body = await response.json();
      if(!response.ok || !body.success) throw new Error(body.error?.message || 'Unable to load invitations');
      setItems(body.data?.items || []);
      setCounts(body.data?.counts || {all:0,single:0,grouped:0});
    } catch(e) {
      if(e.name !== 'AbortError') setError(e.message || 'Unable to load invitations');
    } finally { if(!signal?.aborted) setLoading(false); }
  },[token,type]);
  useEffect(()=>{ const controller=new AbortController();reload(controller.signal);return()=>controller.abort(); },[reload]);
  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-8">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--brand-accent)]">Supplier workspace</p>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Procurement Opportunities</h1>
          <p className="text-sm text-[var(--text-muted)]">Single and grouped requests in one live inbox. Quotes, buyer approvals and payments remain separate steps.</p>
        </header>
        {user?.role !== 'SUPPLIER' ? (
          <p role="alert">This workspace is available to supplier accounts only.</p>
        ) : <>
          <SupplierGroupDeliveryPanel/>
          <div role="tablist" aria-label="Opportunity type" className="flex flex-wrap gap-2">
            {filters.map(f=>(
              <button key={f} type="button" role="tab" aria-selected={type===f}
                className={'rounded-xl border px-4 py-2 text-sm font-medium '+(type===f?'border-[var(--brand-accent)] text-[var(--text-primary)]':'border-[var(--border-subtle)] text-[var(--text-muted)]')}
                onClick={()=>setType(f)}>{f==='all'?'All':f==='single'?'Single':'Grouped'} ({counts[f]})</button>
            ))}
          </div>
          <button type="button" className="rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm"
            onClick={()=>reload()} disabled={loading}>Refresh opportunities</button>
          {loading && <p role="status">Loading eligible invitations…</p>}
          {error && <div role="alert" className="space-y-2"><p>{error}</p><button type="button" onClick={()=>reload()}>Retry</button></div>}
          {!loading && !error && items.length===0 && <p className="rounded-2xl border border-[var(--border-subtle)] p-6 text-sm text-[var(--text-muted)]">No active {type==='all'?'':type} invitations right now. New opportunities will appear here when your supplier account is invited.</p>}
          {!loading && !error && <div className="grid gap-4 md:grid-cols-2">
            {items.map(row=>(
              <article key={row.key} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold uppercase text-[var(--brand-accent)]">{row.type==='single'?'Single request':'Grouped request'}</span>
                  <span className="text-xs text-[var(--text-muted)]">{row.status}</span>
                </div>
                <h2 className="mt-3 text-lg font-semibold text-[var(--text-primary)]">
                  {row.type==='single'?('Request '+(row.request_code||row.request_id)):('Group #'+row.group_id)}
                </h2>
                <p className="mt-2 text-xs text-[var(--text-muted)]">Quote deadline: {row.quote_deadline?new Date(row.quote_deadline).toLocaleString():'Not specified'}</p>
                {row.type==='grouped' && <p className="mt-2 text-xs text-[var(--text-muted)]">Participating buyers: {row.participant_count ?? 'Unknown'} · Minimum required: {row.minimum_buyers} · Area: {row.delivery_area||'Not specified'}</p>}
                <ul className="mt-3 space-y-2">
                  {(row.items||[]).map((item,index)=>(
                    <li key={item.request_item_id||item.id||index} className="border-t border-[var(--border-subtle)] pt-2 text-xs text-[var(--text-secondary)]">
                      Item {index+1}: Family {item.family_id} {(row.type==='grouped' && item.aggregate_quantity)?(' · '+item.aggregate_quantity+' '+(item.unit||'')):(item.quantity?(' · '+item.quantity+' '+(item.unit||'')):(item.unit?' · '+item.unit:''))}
                    </li>
                  ))}
                </ul>
                <Link to={row.type==='single'?'/rfqs#supplier-invitations':'/rfqs#supplier-collective'}
                  className="mt-4 inline-block rounded-xl bg-[var(--brand-accent)] px-4 py-2 text-sm font-semibold text-[var(--text-on-champagne)]">
                  {row.type==='single'?'Open request and quote':'Open group and bid'}
                </Link>
              </article>
            ))}
          </div>}
        </>}
      </main>
    </AppShell>
  );
};
