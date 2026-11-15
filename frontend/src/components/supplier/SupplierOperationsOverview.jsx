import React,{useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {useAuth} from '../../context/AuthContext';
import {supplierFulfillmentApi} from '../../api/supplierFulfillment';
const cards=[
  ['rfq_invitations','Invitations awaiting response','/procurement#supplier-invitations'],
  ['collective_requests','Collective requests','/procurement#supplier-collective'],
  ['numeric_decisions','Active numeric counteroffers','/procurement#supplier-counteroffers'],
  ['delivery_choices','Delivery choices to confirm','/procurement#supplier-invitations'],
  ['expiring_quotes','Quotes expiring within 24 hours','/procurement#supplier-invitations'],
  ['paid_to_fulfill','Paid orders to fulfill','/orders'],
  ['awaiting_buyer_receipt','Awaiting buyer receipt','/orders'],
  ['fulfillment_exceptions','Fulfillment exceptions','/orders'],
];
export function SupplierOperationsOverview(){
  const {user,token}=useAuth();
  const [record,setRecord]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[refresh,setRefresh]=useState(0);
  const data=record?.owner===user?.id?record.data:null;
  useEffect(()=>{
    let active=true,timer;const controller=new AbortController();let failures=0;
    setRecord(null);setError('');
    if(!token||user?.role!=='SUPPLIER')return;
    const load=async()=>{
      setLoading(true);
      try{
        const next=await supplierFulfillmentApi.overview({signal:controller.signal});
        if(active){setRecord({owner:user.id,data:next});setError('');failures=0;}
      }catch(error){if(active){setError(error.response?.data?.error?.message||'Operations are unavailable. Retry to load verified counts.');failures++;}}
      finally{if(active){setLoading(false);timer=setTimeout(load,Math.min(30000*2**Math.min(failures,3),240000));}}
    };
    load();return()=>{active=false;clearTimeout(timer);controller.abort();};
  },[user?.id,user?.role,token,refresh]);
  return <section aria-label="Supplier action center" className="mb-8 p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] space-y-4">
    <div className="flex justify-between items-center gap-3"><h2 className="text-lg font-serif font-semibold">Your work queue</h2>
      <button type="button" disabled={loading} onClick={()=>setRefresh(value=>value+1)} className="text-xs underline disabled:opacity-50">{loading?'Refreshing…':'Refresh operations'}</button></div>
    {error&&<p role="alert" className="text-sm">{error}{data?' Last verified counts are shown below.':''}</p>}
    {!data&&!error&&<p role="status" className="text-sm">Loading verified supplier operations…</p>}
    {data&&<>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">{cards.map(([field,label,to])=><Link key={field} to={to} className="p-3 rounded-xl border border-[var(--border-subtle)] hover:bg-[var(--bg-card)]" aria-label={`${label}: ${data.counts[field]}`}>
        <p className="text-xs text-[var(--text-muted)]">{label}</p><p className="text-xl font-semibold tabular-nums mt-1">{data.counts[field]}</p>
      </Link>)}</div>
      <p className="text-xs text-[var(--text-muted)]">Updated {new Date(data.generated_at).toLocaleString('en-PK',{timeZone:'Asia/Karachi'})} PKT. Counts reflect backend state; quotation acceptance is not payment, and buyer receipt is not a bank payout.</p>
    </>}
  </section>;
}
