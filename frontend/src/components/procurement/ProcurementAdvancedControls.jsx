import React, { useCallback, useEffect, useState } from 'react';
import { Bell, Truck, Users, RefreshCw, ShieldAlert } from 'lucide-react';
import { CountdownTimer } from '../ui/CountdownTimer';

// B6-N–Q features extend the original RFQ page. No new marketplace or payment flow.
export function ProcurementAdvancedControls({ user, token }) {
  const buyer=user?.role==='BUYER';
  const supplier=user?.role==='SUPPLIER';
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState('');
  const [cohorts,setCohorts]=useState([]);
  const [contracts,setContracts]=useState([]);
  const [notices,setNotices]=useState([]);
  const [addresses,setAddresses]=useState([]);
  const [runs,setRuns]=useState([]);
  const [contractId,setContractId]=useState('');
  const [minimumBuyers,setMinimumBuyers]=useState('2');
  const [ownConsent,setOwnConsent]=useState(false);
  const [invitedBuyer,setInvitedBuyer]=useState('');
  const [memberContract,setMemberContract]=useState('');
  const [cycleLists,setCycleLists]=useState({});
  const [selectedCycles,setSelectedCycles]=useState({});
  const [delivery,setDelivery]=useState({order_id:'',address_id:'',delivery_day:'',
    delivery_window:'09:00-12:00',mode:'STANDARD_CLUSTERED'});
  const [deliveryConsent,setDeliveryConsent]=useState(false);
  const [supplierOrderIds,setSupplierOrderIds]=useState('');
  const [preorder,setPreorder]=useState(null);
  const api=useCallback(async (path,opts={})=>{
    const res=await fetch(path,{...opts,headers:{
      Authorization:'Bearer '+token,'Content-Type':'application/json',
      ...(opts.headers||{})}});
    const payload=await res.json().catch(()=>({}));
    if(!res.ok)throw Error(payload?.error?.message||'Procurement operation failed');
    return payload.data??{};
  },[token]);
  const randomKey=()=>{
    const uuid=globalThis.crypto?.randomUUID?.();
    return 'phase2-'+(uuid||Date.now()+'-'+Math.random().toString(36).slice(2));
  };
  const post=(path,data={},keyed=false)=>api(path,{method:'POST',
    headers:keyed?{'X-Idempotency-Key':randomKey()}:{},body:JSON.stringify(data)});
  const refresh=useCallback(async()=>{
    if(!token||(!buyer&&!supplier))return;
    const p=[api('/api/v1/procurement/notifications'),
      api('/api/v1/procurement/preorder-policy')];
    if(buyer)p.push(api('/api/v1/procurement/recurring-cohorts'),
      api('/api/v1/procurement/recurring'),api('/api/v1/buyer/addresses'));
    else p.push(api('/api/v1/procurement/supplier/delivery-runs'));
    const results=await Promise.allSettled(p);
    if(results[0].status==='fulfilled')setNotices(results[0].value.notifications||[]);
    if(results[1].status==='fulfilled')setPreorder(results[1].value);
    if(buyer){
      if(results[2].status==='fulfilled')setCohorts(results[2].value.cohorts||[]);
      if(results[3].status==='fulfilled')setContracts(results[3].value.contracts||[]);
      if(results[4].status==='fulfilled')setAddresses(
        Array.isArray(results[4].value)?results[4].value:results[4].value.addresses||[]);
    }else if(results[2].status==='fulfilled')setRuns(results[2].value.runs||[]);
    if(results.some(x=>x.status==='rejected'))
      setError('Advanced procurement data is partially unavailable until migrations are verified.');
  },[api,token,buyer,supplier]);
  useEffect(()=>{refresh();},[refresh]);
  const action=async(fn,message)=>{
    if(busy)return;
    setBusy(true);setError('');setSuccess('');
    try{await fn();await refresh();setSuccess(message);}
    catch(e){setError(e.message);}
    finally{setBusy(false);}
  };
  const create=()=>action(()=>{
    if(!ownConsent)throw Error('Confirm own contract consent.');
    return post('/api/v1/procurement/recurring/'+contractId+'/cohorts',
      {minimum_buyers:Number(minimumBuyers),join_cutoff_minutes:60,
        quote_window_minutes:1440,confirm_own_schedule:true},true);
  },'Group created. Invite businesses with their own active recurring contracts.');
  const updateCohort=(id,operation,payload={})=>action(
    ()=>post('/api/v1/procurement/recurring-cohorts/'+id+'/'+operation,
      payload,operation==='consent'),
    'Group updated. Existing cycle orders remain unchanged.'
  );
  const loadCycles=cohort=>action(async()=>{
    const data=await api('/api/v1/procurement/recurring/'+cohort.recurring_contract_id+'/cycles');
    setCycleLists(p=>({...p,[cohort.id]:data.cycles||[]}));
  },'Upcoming cycles loaded.');
  const prepareCycle=cohort=>action(
    ()=>post('/api/v1/procurement/recurring-cohorts/'+cohort.id+'/cycles/prepare',
      {organizer_cycle_id:Number(selectedCycles[cohort.id])}),
    'Collective cycle invitations created. Each buyer must join and approve separately.'
  );
  const acceptDelivery=()=>action(async()=>{
    if(!deliveryConsent)throw Error('Approve the unchanged order delivery fee.');
    await post('/api/v1/procurement/orders/'+delivery.order_id+'/delivery-choice',{
      address_id:Number(delivery.address_id),
      delivery_day:delivery.delivery_day,delivery_window:delivery.delivery_window,
      mode:delivery.mode,handling_class:'AMBIENT',
      confirm_existing_order_delivery_fee:true},true);
    setDeliveryConsent(false);
  },'Paid-order delivery choice saved. No extra charge.');
  const planRun=()=>action(async()=>{
    const ids=supplierOrderIds.split(',').map(x=>x.trim()).filter(Boolean);
    if(!ids.length||ids.some(x=>!/^[1-9]\d*$/.test(x)))
      throw Error('Enter valid paid order IDs separated by commas.');
    await post('/api/v1/procurement/supplier/delivery-runs',{order_ids:ids.map(Number)},true);
    setSupplierOrderIds('');
  },'Supplier delivery run proposed. Original buyer fees unchanged.');
  if(!buyer&&!supplier)return null;
  const field='w-full mt-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 text-sm';
  const button='rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-xs font-semibold hover:opacity-80 disabled:opacity-40';
  return <section className="mb-8 space-y-4" aria-label="Advanced Smart Procurement">
    <div className="flex justify-between items-center gap-3 flex-wrap">
      <div>
        <p className="text-xs font-semibold text-[var(--brand-accent)] uppercase">Smart Procurement Hub</p>
        <h2 className="text-xl font-serif font-bold">Recurring Groups & Delivery</h2>
      </div>
      <button type="button" className={button} disabled={busy} onClick={refresh}>
        <RefreshCw size={13} className="inline mr-1"/> Refresh
      </button>
    </div>
    {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
    {success&&<p role="status" className="text-sm text-emerald-700">{success}</p>}
    {buyer&&<div className="grid lg:grid-cols-2 gap-4">
      <article className="rounded-xl border border-[var(--border-subtle)] p-4 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Users size={16}/> Collective Recurring Procurement</h3>
        <p className="text-xs text-[var(--text-muted)]">
          Each business must consent to future invitations, then separately join each cycle and approve its quote. No standing payment authorization.
        </p>
        <label className="block text-xs font-semibold">Your active recurring contract
          <select className={field} value={contractId} onChange={e=>setContractId(e.target.value)}>
            <option value="">Select contract</option>
            {contracts.filter(c=>c.status==='ACTIVE').map(c=>
              <option key={c.id} value={c.id}>{c.contract_code} · {c.cadence}</option>)}
          </select>
        </label>
        <label className="block text-xs font-semibold">Minimum businesses
          <input type="number" min="2" max="1000" className={field}
            value={minimumBuyers} onChange={e=>setMinimumBuyers(e.target.value)}/>
        </label>
        <label className="flex gap-2 text-xs">
          <input type="checkbox" checked={ownConsent} onChange={e=>setOwnConsent(e.target.checked)}/>
          I agree to future group invitations, not automatic purchases.
        </label>
        <button type="button" className={button} disabled={busy||!ownConsent||!contractId}
          onClick={create}>Create recurring group</button>
        {cohorts.map(cohort=>{
          const organizer=Number(cohort.organizer_buyer_id)===Number(user.id);
          const options=cycleLists[cohort.id]||[];
          return <div key={cohort.id} className="border-t border-[var(--border-subtle)] pt-3 space-y-2">
            <p className="text-xs font-semibold">
              Group #{cohort.id} · {cohort.status} · Your membership: {cohort.my_status}
            </p>
            {cohort.my_status==='INVITED'&&<>
              <label className="text-xs block">Link your own active contract
                <select className={field} value={memberContract}
                  onChange={e=>setMemberContract(e.target.value)}>
                  <option value="">Choose contract</option>
                  {contracts.filter(c=>c.status==='ACTIVE').map(c=>
                    <option key={c.id} value={c.id}>{c.contract_code}</option>)}
                </select>
              </label>
              <button type="button" className={button} disabled={busy||!memberContract}
                onClick={()=>updateCohort(cohort.id,'consent',{contract_id:Number(memberContract)})}>
                Accept future cycle invitations
              </button>
            </>}
            {cohort.my_status==='CONSENTED'&&<button type="button" className={button}
              disabled={busy} onClick={()=>updateCohort(cohort.id,'leave')}>
              Leave future cycles
            </button>}
            {organizer&&<>
              <input type="number" min="1" className={field}
                placeholder="Verified business buyer ID" value={invitedBuyer}
                onChange={e=>setInvitedBuyer(e.target.value)}/>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={button} disabled={busy||!invitedBuyer}
                  onClick={()=>updateCohort(cohort.id,'invitations',
                    {buyer_id:Number(invitedBuyer)})}>Invite buyer</button>
                {cohort.status==='FORMING'&&<button type="button" className={button}
                  disabled={busy} onClick={()=>updateCohort(cohort.id,'activate')}>Activate</button>}
                {['ACTIVE','PAUSED'].includes(cohort.status)&&<button type="button"
                  className={button} disabled={busy} onClick={()=>updateCohort(cohort.id,'status',{
                    action:cohort.status==='ACTIVE'?'PAUSE':'RESUME'})}>
                  {cohort.status==='ACTIVE'?'Pause':'Resume'}
                </button>}
                {cohort.status!=='CANCELLED'&&<button type="button" className={button}
                  disabled={busy} onClick={()=>updateCohort(cohort.id,'status',{action:'CANCEL'})}>
                  Cancel future cycles
                </button>}
              </div>
              {cohort.status==='ACTIVE'&&<>
                <button type="button" className={button} disabled={busy}
                  onClick={()=>loadCycles(cohort)}>Load my scheduled cycles</button>
                {options.length>0&&<select className={field}
                  value={selectedCycles[cohort.id]||''}
                  onChange={e=>setSelectedCycles(p=>({...p,[cohort.id]:e.target.value}))}>
                  <option value="">Select due cycle</option>
                  {options.filter(x=>x.status==='SCHEDULED').map(x=>
                    <option key={x.id} value={x.id}>{x.cycle_key} · {x.status}</option>)}
                </select>}
                <button type="button" className={button}
                  disabled={busy||!selectedCycles[cohort.id]} onClick={()=>prepareCycle(cohort)}>
                  Prepare private buyer invitations (no charge)
                </button>
              </>}
            </>}
          </div>;
        })}
      </article>
      <article className="rounded-xl border border-[var(--border-subtle)] p-4 space-y-3">
        <h3 className="text-sm font-semibold flex gap-2 items-center">
          <Truck size={16}/> Paid-Order Delivery Choice
        </h3>
        <p className="text-xs text-[var(--text-muted)]">
          Delivery grouping happens only after payment. This never changes your locked delivery fee.
        </p>
        <label className="block text-xs font-semibold">Paid order ID
          <input type="number" min="1" className={field} value={delivery.order_id}
            onChange={e=>setDelivery(p=>({...p,order_id:e.target.value}))}/>
        </label>
        <label className="block text-xs font-semibold">Confirmed Lahore address
          <select className={field} value={delivery.address_id}
            onChange={e=>setDelivery(p=>({...p,address_id:e.target.value}))}>
            <option value="">Choose your address</option>
            {addresses.filter(x=>x.user_confirmation_status==='CONFIRMED').map(a=>
              <option key={a.id} value={a.id}>{a.society_area||'Lahore'} · #{a.id}</option>)}
          </select>
        </label>
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="text-xs font-semibold">Delivery day
            <input type="date" className={field} value={delivery.delivery_day}
              onChange={e=>setDelivery(p=>({...p,delivery_day:e.target.value}))}/>
          </label>
          <label className="text-xs font-semibold">Original supplier mode
            <select className={field} value={delivery.mode}
              onChange={e=>setDelivery(p=>({...p,mode:e.target.value}))}>
              <option value="STANDARD_CLUSTERED">Standard clustered</option>
              <option value="EXPRESS">Express, if previously accepted</option>
              <option value="PICKUP">Pickup, if already ordered</option>
            </select>
          </label>
        </div>
        <label className="block text-xs font-semibold">Delivery window
          <select className={field} value={delivery.delivery_window}
            onChange={e=>setDelivery(p=>({...p,delivery_window:e.target.value}))}>
            <option value="09:00-12:00">9 AM – 12 PM</option>
            <option value="12:00-16:00">12 PM – 4 PM</option>
            <option value="16:00-20:00">4 PM – 8 PM</option>
          </select>
        </label>
        <label className="flex gap-2 text-xs">
          <input type="checkbox" checked={deliveryConsent}
            onChange={e=>setDeliveryConsent(e.target.checked)}/>
          I approve my existing paid-order delivery fee without an extra charge.
        </label>
        <button type="button" className={button} disabled={busy||!deliveryConsent||
          !delivery.order_id||!delivery.address_id||!delivery.delivery_day}
          onClick={acceptDelivery}>Confirm delivery choice</button>
      </article>
    </div>}
    {supplier&&<article className="rounded-xl border border-[var(--border-subtle)] p-4 space-y-3">
      <h3 className="text-sm font-semibold flex gap-2 items-center">
        <Truck size={16}/> Supplier Delivery Grouping
      </h3>
      <p className="text-xs text-[var(--text-muted)]">
        Group only your PAID orders sharing supplier, Lahore cluster, day, window and handling. No invented distance or revised fee.
      </p>
      <label className="block text-xs font-semibold">Paid order IDs separated by commas
        <input className={field} placeholder="1001, 1002" value={supplierOrderIds}
          onChange={e=>setSupplierOrderIds(e.target.value)}/>
      </label>
      <button type="button" className={button} disabled={busy||!supplierOrderIds.trim()}
        onClick={planRun}>Create delivery group</button>
      {runs.map(run=><div key={run.id}
        className="flex flex-wrap justify-between gap-2 border-t border-[var(--border-subtle)] pt-2">
        <p className="text-xs">
          Run #{run.id} · Cluster #{run.cluster_id} · {String(run.delivery_day).slice(0,10)}
          · {run.status} · {run.planned_stops} stops · Rs. {run.locked_delivery_fee_total} locked
        </p>
        <button type="button" className={button} disabled={busy}
          onClick={()=>action(
            ()=>post('/api/v1/procurement/supplier/delivery-runs/'+run.id+'/refresh'),
            'Run status synced from actual fulfillment.')}>Refresh milestones</button>
      </div>)}
    </article>}
    <div className="grid md:grid-cols-2 gap-4">
      <article className="rounded-xl border border-[var(--border-subtle)] p-4 space-y-2">
        <h3 className="text-sm font-semibold flex gap-2 items-center">
          <Bell size={16}/> Private procurement notifications
        </h3>
        {notices.length===0&&<p className="text-xs text-[var(--text-muted)]">No new events.</p>}
        {notices.slice(0,15).map(n=><div key={n.id}
          className="flex justify-between items-start gap-2 border-t border-[var(--border-subtle)] pt-2">
          <div>
            <p className="text-xs font-semibold">{String(n.event_type).replaceAll('_',' ')}</p>
            <p className="text-xs text-[var(--text-muted)]">
              {Object.entries(n.payload||{}).map(([k,v])=>k.replaceAll('_',' ')+': '+v).join(' · ')}
            </p>
          </div>
          {!n.is_read&&<button type="button" className={button} disabled={busy}
            onClick={()=>action(
              ()=>post('/api/v1/procurement/notifications/'+n.id+'/read'),
              'Notice marked as read.')}>Read</button>}
        </div>)}
      </article>
      <article className="rounded-xl border border-[var(--border-subtle)] p-4 space-y-2">
        <h3 className="text-sm font-semibold flex gap-2 items-center">
          <ShieldAlert size={16}/> Production batches / pre-orders
        </h3>
        <p className="text-xs font-semibold">Status: {preorder?.status||'DEFERRED'}</p>
        <p className="text-xs text-[var(--text-muted)]">
          Deposit/refund, food-safety and production-risk policies require approval.
          No advance payment, ready-stock reservation or production order is enabled.
        </p>
      </article>
    </div>
  </section>;
}
export default ProcurementAdvancedControls;
