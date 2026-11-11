import React,{useState} from 'react';
import {BarChart3,Truck,Package,AlertTriangle,Info,MapPin} from 'lucide-react';

// All data from supplier-scoped READ ONLY APIs. No simulated sales, savings or payouts.
export function SupplierPoolOperationsPanel({inventory,delivery,insights,alerts}){
  const [section,setSection]=useState('INVENTORY');
  const items=inventory?.listings||[];
  const categories=[['INVENTORY','Inventory'],['DELIVERY','Delivery'],['INSIGHTS','Insights'],['ALERTS','Alerts']];
  return <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 sm:p-5 space-y-4" aria-label="Supplier pool operations">
    <header className="flex flex-wrap items-start justify-between gap-2">
      <div><h2 className="text-lg font-semibold flex items-center gap-2"><BarChart3 size={18}/> Pool Operations</h2>
        <p className="text-xs text-[var(--text-muted)]">Live inventory, configured delivery terms, real pool statuses and in-app alerts · B4/B5 only</p></div>
      <span className="text-[10px] text-[var(--text-muted)]">Read-only · No stock or payment mutations</span>
    </header>
    <nav className="flex flex-wrap gap-2" aria-label="Pool operations sections">
      {categories.map(([id,label])=><button type="button" key={id} onClick={()=>setSection(id)}
        aria-pressed={section===id}
        className={`rounded-lg border px-3 py-2 text-xs ${section===id?'border-emerald-600 text-emerald-600 font-semibold':'border-[var(--border-subtle)]'}`}>
        {label}{id==='ALERTS'&&alerts?.alerts?.length>0?` (${alerts.alerts.length})`:''}
      </button>)}
    </nav>
    {section==='INVENTORY'&&<div className="space-y-3">
      <p className="text-xs text-[var(--text-muted)]">Available to allocate = listed stock − pending allocations − committed allocations. These are allocation estimates; publishing re-locks the actual inventory.</p>
      {!items.length?<p className="text-sm text-[var(--text-muted)]">No supplier listings available.</p>:
        <div className="grid gap-2 sm:grid-cols-2">
          {items.map(x=><div key={x.supplier_listing_id} className="rounded-xl border border-[var(--border-subtle)] p-3 space-y-2">
            <div className="flex items-center justify-between gap-2"><div className="font-medium text-sm">{x.sku_title||x.listing_code}</div>
              {x.allocation_state!=='RECONCILED'&&<AlertTriangle size={16} className="text-amber-600"/>}</div>
            <p className="text-[11px] text-[var(--text-muted)]">{x.listing_code} · {x.status} · {x.unit||'Unknown unit'}</p>
            {x.allocation_state==='RECONCILED'?<div className="grid grid-cols-2 gap-2 text-xs">
              <div><span className="text-[var(--text-muted)] block">Listed</span><b>{x.listed_stock}</b></div>
              <div><span className="text-[var(--text-muted)] block">Available</span><b className="text-emerald-700 dark:text-emerald-400">{x.available_to_allocate}</b></div>
              <div><span className="text-[var(--text-muted)] block">Pending allocation</span><b>{x.pending_allocated}</b></div>
              <div><span className="text-[var(--text-muted)] block">Committed</span><b>{x.committed_allocated}</b></div>
            </div>:<p className="text-xs text-amber-600">{x.note||'Inventory requires reconciliation before any new pool publication.'}</p>}
          </div>)}
        </div>}
    </div>}
    {section==='DELIVERY'&&<div className="space-y-3">
      <p className="text-xs text-[var(--text-muted)]">These are your actual configured supplier delivery modes. A buyer's final area-specific quote is resolved separately by the authoritative G2 delivery engine.</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
        {[
          ['Standard delivery',delivery?.configuration?.standard_delivery_enabled],
          ['Supplier pickup',delivery?.configuration?.pickup_enabled],
          ['Express delivery',delivery?.configuration?.express_enabled]
        ].map(([label,enabled])=><div key={label} className="rounded-xl border border-[var(--border-subtle)] p-3"><Truck size={14}/><p className="mt-1 text-xs font-medium">{label}</p><p className={`text-xs ${enabled?'text-emerald-600':'text-[var(--text-muted)]'}`}>{enabled?'Enabled':'Not enabled'}</p></div>)}
      </div>
      <h3 className="text-xs font-semibold">Eligible Lahore delivery clusters</h3>
      {(delivery?.cluster_rates||[]).filter(x=>x.is_eligible).length===0?
        <p className="text-xs text-[var(--text-muted)]">No active cluster rates configured. Set up your delivery coverage in Supplier Profile.</p>:
        <div className="flex flex-wrap gap-2">{delivery.cluster_rates.filter(x=>x.is_eligible).map(rate=>{
          const c=delivery.clusters?.find(x=>Number(x.id)===Number(rate.cluster_id));
          return <span key={rate.cluster_id+'-'+rate.mode} className="border border-[var(--border-subtle)] rounded-lg px-2.5 py-1.5 text-xs">
            {c?.name||'Cluster #'+rate.cluster_id} · {rate.mode} · Rs. {rate.fee_pkr}
          </span>;
        })}</div>}
      <h3 className="text-xs font-semibold">Active pickup locations</h3>
      {(delivery?.pickup_points||[]).filter(p=>p.is_active).length===0?
        <p className="text-xs text-[var(--text-muted)]">No active supplier pickup point.</p>:
        <div className="space-y-2">{delivery.pickup_points.filter(p=>p.is_active).map(p=><p key={p.id} className="text-xs flex items-start gap-1"><MapPin size={14}/>{p.point_name} · {p.address_line} · Handling fee Rs. {p.pickup_handling_fee_pkr}</p>)}</div>}
      <a href="/supplier/profile" className="underline text-emerald-600 text-xs">Manage delivery settings</a>
    </div>}
    {section==='INSIGHTS'&&<div className="space-y-3">
      <p className="text-xs text-[var(--text-muted)]">Counts reflect real B4/B5 records. Revenue, savings and net payout remain unavailable until verified settlement baselines exist.</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[['Regular',insights?.by_type?.REGULAR?.total],['Flash',insights?.by_type?.FLASH?.total],
          ['Paid orders',insights?.orders?.paid],['Awaiting payment',insights?.orders?.awaiting_payment]].map(([key,n])=>
          <div key={key} className="rounded-xl border p-3 border-[var(--border-subtle)]"><div className="text-xl font-bold tabular-nums">{n??'—'}</div><div className="text-xs text-[var(--text-muted)]">{key}</div></div>)}
      </div>
      {['REGULAR','FLASH'].map(type=><div key={type} className="rounded-xl border border-[var(--border-subtle)] p-3">
        <h3 className="font-semibold text-sm">{type==='REGULAR'?'Regular Pools':'Flash Pools'}</h3>
        <div className="grid grid-cols-3 gap-2 text-xs mt-2">
          <div>Draft <b className="block">{insights?.by_type?.[type]?.draft??'—'}</b></div>
          <div>Active <b className="block">{insights?.by_type?.[type]?.active??'—'}</b></div>
          <div>Closed <b className="block">{insights?.by_type?.[type]?.closed??'—'}</b></div>
        </div>
      </div>)}
      <p className="text-xs flex items-start gap-2 text-[var(--text-muted)]"><Info size={14}/>{insights?.unavailable_reason||'Settlement metrics unavailable.'}</p>
    </div>}
    {section==='ALERTS'&&<div className="space-y-2">
      <p className="text-xs text-[var(--text-muted)]">Status-derived, on-screen notices only. No email/SMS or payment action is triggered.</p>
      {(alerts?.alerts||[]).length===0?<p className="text-sm text-[var(--text-muted)]">No pool status alerts right now.</p>:
        alerts.alerts.map(alert=><div key={alert.id} className="rounded-lg border border-[var(--border-subtle)] p-3 flex items-start gap-2">
          {alert.severity==='warning'?<AlertTriangle size={16} className="text-amber-600 shrink-0"/>:<Package size={16} className="text-[var(--text-muted)] shrink-0"/>}
          <div><p className="font-semibold text-xs">{alert.type.replaceAll('_',' ')}</p><p className="text-xs text-[var(--text-muted)] mt-1">{alert.message}</p></div>
        </div>)}
    </div>}
  </section>;
}
export default SupplierPoolOperationsPanel;
