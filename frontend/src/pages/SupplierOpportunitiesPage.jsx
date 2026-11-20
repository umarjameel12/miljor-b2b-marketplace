import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { useAuth } from '../context/AuthContext';
import { SupplierGroupDeliveryPanel } from '../components/procurement/SupplierGroupDeliveryPanel';

const filters = ['all','single','grouped'];
const PAGE_SIZE = 12;
export const SupplierOpportunitiesPage = () => {
  const { user, token } = useAuth();
  const [type,setType] = useState('all');
  const [search,setSearch] = useState('');
  const [query,setQuery] = useState('');
  const [page,setPage] = useState(1);
  const [items,setItems] = useState([]);
  const [pagination,setPagination] = useState({page:1,limit:PAGE_SIZE,total:0,pages:0,has_more:false});
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [counts,setCounts] = useState({all:0,single:0,grouped:0});
  const reload = useCallback(async(signal) => {
    if(!token) { setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const params=new URLSearchParams({type,page:String(page),limit:String(PAGE_SIZE)});
      if(query)params.set('search',query);
      const response = await fetch('/api/v1/procurement/supplier/opportunities?'+params.toString(), {
        headers:{Authorization:'Bearer '+token},signal
      });
      const body = await response.json();
      if(!response.ok || !body.success) throw new Error(body.error?.message || 'Unable to load invitations');
      setItems(body.data?.items || []);
      setCounts(body.data?.counts || {all:0,single:0,grouped:0});
      setPagination(body.data?.pagination || {page:1,limit:PAGE_SIZE,total:0,pages:0,has_more:false});
    } catch(e) {
      if(e.name !== 'AbortError') setError(e.message || 'Unable to load invitations');
    } finally { if(!signal?.aborted) setLoading(false); }
  },[token,type,page,query]);
  useEffect(()=>{ const controller=new AbortController();reload(controller.signal);return()=>controller.abort(); },[reload]);
  function applySearch(e){e.preventDefault();setPage(1);setQuery(search.trim().slice(0,100));}
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
                onClick={()=>{setType(f);setPage(1);}}>{f==='all'?'All':f==='single'?'Single':'Grouped'} ({counts[f]})</button>
            ))}
          </div>
          <form onSubmit={applySearch} className="flex flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor="supplier-opportunity-search">Search opportunities</label>
            <input id="supplier-opportunity-search" value={search} maxLength={100}
              onChange={e=>setSearch(e.target.value)} placeholder="Search request code, product family or delivery area"
              className="min-w-0 flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 text-sm"/>
            <button type="submit" className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-sm">Search</button>
            <button type="button" className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-sm"
              onClick={()=>{setSearch('');setQuery('');setPage(1);}}>Clear</button>
            <button type="button" className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-sm"
              onClick={()=>reload()} disabled={loading}>Refresh</button>
          </form>
          {loading && <p role="status">Loading eligible invitations…</p>}
          {error && <div role="alert" className="space-y-2"><p>{error}</p><button type="button" onClick={()=>reload()}>Retry</button></div>}
          {!loading && !error && items.length===0 && <p className="rounded-2xl border border-[var(--border-subtle)] p-6 text-sm text-[var(--text-muted)]">No active {type==='all'?'':type} invitations match this search. New eligible opportunities will appear here when your supplier account is invited.</p>}
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
          {!loading && !error && pagination.pages>1 && <nav aria-label="Opportunity pages" className="flex items-center justify-between gap-3">
            <button type="button" disabled={page<=1} onClick={()=>setPage(value=>Math.max(1,value-1))}
              className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-sm disabled:opacity-40">Previous</button>
            <span className="text-xs text-[var(--text-muted)]">Page {pagination.page} of {pagination.pages} · {pagination.total} opportunities</span>
            <button type="button" disabled={!pagination.has_more} onClick={()=>setPage(value=>value+1)}
              className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-sm disabled:opacity-40">Next</button>
          </nav>}
        </>}
      </main>
    </AppShell>
  );
};
