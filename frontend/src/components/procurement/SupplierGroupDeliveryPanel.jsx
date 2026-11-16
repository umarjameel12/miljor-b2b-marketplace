import React,{useCallback,useEffect,useState} from 'react';
import apiClient from '../../api/client';

export function SupplierGroupDeliveryPanel(){
 const [groups,setGroups]=useState([]),[loading,setLoading]=useState(true);
 const [error,setError]=useState(''),[busy,setBusy]=useState(null);
 const [day,setDay]=useState(''),[window,setWindow]=useState('09:00-12:00');
 const load=useCallback(async()=>{
  try{
   const res=await apiClient.get('/procurement/supplier/collectives/orders');
   setGroups(res.data?.data?.groups||[]);setError('');
  }catch(e){setError(e.response?.data?.error?.message||'Cannot load grouped orders');}
  finally{setLoading(false);}
 },[]);
 useEffect(()=>{load();},[load]);
 async function propose(groupId){
  if(!day)return setError('Select a delivery date');
  setBusy(groupId);setError('');
  try{
   await apiClient.post(`/procurement/supplier/collectives/${groupId}/delivery-route`,
     {delivery_day:day,delivery_window:window},
     {headers:{'X-Idempotency-Key':'group-run-'+crypto.randomUUID()}});
   await load();
  }catch(e){setError(e.response?.data?.error?.message||'Cannot propose grouped delivery');}
  finally{setBusy(null);}
 }
 return <section aria-label="Supplier grouped delivery" className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 space-y-4">
  <header className="space-y-1">
   <h2 className="text-lg font-semibold">Qualified group orders & clustered delivery</h2>
   <p className="text-xs text-[var(--text-muted)]">Only verified buyer payments count. Each buyer approves the proposed delivery window independently; no early settlement.</p>
  </header>
  {loading&&<p role="status">Loading real supplier group orders…</p>}
  {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
  {!loading&&!groups.length&&<p className="text-xs text-[var(--text-muted)]">No buyer-owned qualified group orders yet.</p>}
  {groups.map(group=><article key={group.group_id}
   className="rounded-xl border border-[var(--border-subtle)] p-4 space-y-2">
   <p className="font-semibold">Group #{group.group_id}</p>
   <p className="text-xs">Real paid orders: {group.paid_orders}/{group.total_orders}
    · Buyer-confirmed: {group.confirmed_orders} · Exceptions: {group.exception_orders}</p>
   {group.route_status&&<p className="text-xs">Route status: {group.route_status}</p>}
   {!group.all_paid&&<p className="text-xs text-[var(--text-muted)]">Cluster scheduling remains blocked until every buyer's Safepay payment is verified.</p>}
   {group.all_paid&&!group.route_status&&<div className="space-y-2">
    <label className="block text-xs">Proposed delivery day
     <input type="date" value={day} onChange={e=>setDay(e.target.value)}
      className="block w-full rounded-lg border border-[var(--border-subtle)] p-2 bg-[var(--bg-surface)]" />
    </label>
    <label className="block text-xs">Local delivery window
     <select value={window} onChange={e=>setWindow(e.target.value)}
      className="block w-full rounded-lg border border-[var(--border-subtle)] p-2 bg-[var(--bg-surface)]">
      <option value="09:00-12:00">9 AM – Noon</option>
      <option value="12:00-15:00">Noon – 3 PM</option>
      <option value="15:00-18:00">3 PM – 6 PM</option>
     </select>
    </label>
    <button type="button" disabled={busy===group.group_id} onClick={()=>propose(group.group_id)}
     className="rounded-xl bg-[var(--brand-accent)] px-4 py-2 text-sm text-stone-900 font-semibold disabled:opacity-50">
     {busy===group.group_id?'Proposing…':'Propose cluster delivery (buyer consent required)'}
    </button>
   </div>}
  </article>)}
 </section>;
}
