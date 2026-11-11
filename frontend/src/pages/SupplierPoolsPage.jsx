import React,{useEffect,useMemo,useState,useCallback} from 'react';
import {Link,useNavigate,useSearchParams} from 'react-router-dom';
import {toast} from 'react-toastify';
import {Layers,Plus,RefreshCw,Clock,Package,AlertTriangle,CheckCircle2,ArrowLeft,Lock,Eye} from 'lucide-react';
import {AppShell} from '../components/layout/AppShell';
import {useAuth} from '../context/AuthContext';
import {CountdownTimer} from '../components/ui/CountdownTimer';
import unifiedPoolsApi from '../api/unifiedPools';

const localDate=(date)=>{
  const d=new Date(date);
  const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,16);
};
const initialForm=(listing)=>({
  supplier_listing_id:String(listing?.id||''),
  supplier_min_qty:String(listing?.supplier_min_qty||''),
  buyer_min_qty:String(listing?.buyer_min_qty||''),
  target_qty:'',max_capacity:'',purchase_increment:'1',tier1_price:String(listing?.base_unit_price||''),
  tier2_price:'',delivery_type:'DOORSTEP',
  scheduled_close_at:localDate(Date.now()+72*3600000),
  promised_delivery_at:localDate(Date.now()+120*3600000),
  total_stock:'',discounted_unit_price:'',min_quantity:'1',
  max_quantity_per_buyer:'',selling_mode:'MULTI_BUYER',
  duration_minutes:'720',clearance_reason:'',condition_notes:'',
  best_before_date:'',delivery_fee:'0'
});
const positive=v=>/^\d+(?:\.\d{1,4})?$/.test(String(v||'')) && Number(v)>0;
const money=v=>/^\d+(?:\.\d{1,2})?$/.test(String(v||'')) && Number(v)>0;
const Field=({label,value,onChange,type='number',step='0.01',required=true,min,placeholder})=>(
  <label className="block text-xs font-medium space-y-1">
    <span className="text-[var(--text-secondary)]">{label}</span>
    <input className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)]"
      type={type} step={step} min={min} required={required} placeholder={placeholder||''} value={value}
      onChange={e=>onChange(e.target.value)}/>
  </label>
);
function buildPayload(mode,form,listing,editing){
  if(!listing||listing.status!=='ACTIVE'||!listing.supplier_sku_id)
    throw Error('Select a published supplier-owned SKU listing, not legacy global specifications.');
  const unit=listing.pricing_unit||listing.purchasing_unit;
  if(!unit)throw Error('Listing has no authoritative purchasing unit.');
  if(mode==='FLASH'){
    const qty=form.total_stock,price=form.discounted_unit_price;
    if(!positive(qty)||!money(price)||Number(price)>Number(listing.base_unit_price))
      throw Error('Valid ready-stock quantity and discounted PKR price required.');
    if(!Number.isSafeInteger(Number(form.duration_minutes))||Number(form.duration_minutes)<2)
      throw Error('Flash duration must be at least 2 minutes.');
    if(!form.clearance_reason.trim()||form.clearance_reason.trim().length<3)
      throw Error('Provide a truthful clearance reason.');
    if(form.selling_mode==='MULTI_BUYER'&&(!positive(form.min_quantity)||
      !positive(form.max_quantity_per_buyer)||Number(form.min_quantity)>Number(form.max_quantity_per_buyer)||
      Number(form.max_quantity_per_buyer)>Number(qty)))throw Error('Buyer limits must fit ready stock.');
    const expiry=new Date(Date.now()+Number(form.duration_minutes)*60000);
    if(form.best_before_date && expiry.getTime()>=new Date(form.best_before_date+'T23:59:59Z').getTime())
      throw Error('Flash duration cannot extend beyond best-before date.');
    const payload={
      total_stock:qty,discounted_unit_price:price,
      selling_mode:form.selling_mode,
      min_quantity:form.selling_mode==='WHOLE_LOT'?qty:form.min_quantity,
      max_quantity_per_buyer:form.selling_mode==='WHOLE_LOT'?qty:form.max_quantity_per_buyer,
      purchase_increment:form.selling_mode==='WHOLE_LOT'?qty:form.purchase_increment,
      duration_minutes:Number(form.duration_minutes),
      clearance_reason:form.clearance_reason.trim(),
      condition_notes:form.condition_notes.trim(),
      best_before_date:form.best_before_date||null,
      delivery_fee:form.delivery_fee||'0',
      original_unit_price:String(listing.base_unit_price)
    };
    if(!editing){
      payload.supplier_listing_id=Number(listing.id);
      payload.supplier_sku_id=Number(listing.supplier_sku_id);
      payload.expiry_time=expiry.toISOString();
    }
    return payload;
  }
  if(![form.supplier_min_qty,form.buyer_min_qty,form.target_qty,form.max_capacity,form.purchase_increment].every(positive))
    throw Error('All Regular Pool quantities and increments must be positive.');
  const minimum=Number(form.supplier_min_qty),target=Number(form.target_qty),capacity=Number(form.max_capacity);
  if(target<minimum||capacity<target||Number(form.buyer_min_qty)>capacity)
    throw Error('Regular quantities must satisfy supplier minimum ≤ target ≤ capacity.');
  if(!money(form.tier1_price)||Number(form.tier1_price)>Number(listing.base_unit_price))
    throw Error('Tier 1 must be positive and must not exceed the published listing base price.');
  const hasDiscount=Boolean(form.tier2_price);
  if(hasDiscount&&(!money(form.tier2_price)||Number(form.tier2_price)>=Number(form.tier1_price)||target<=minimum))
    throw Error('Tier 2 must be cheaper than Tier 1, and target must exceed the minimum.');
  const close=new Date(form.scheduled_close_at),delivery=new Date(form.promised_delivery_at);
  const hours=(delivery-close)/3600000;
  if(!Number.isFinite(hours)||close<=new Date()||hours<24||hours>72)
    throw Error('Future pool close required; promised delivery must be 24–72h after closing.');
  const tiers=[];
  if(hasDiscount){
    const firstMax=(Math.round(target*10000)-Math.round(Number(form.purchase_increment)*10000))/10000;
    if(firstMax<minimum)throw Error('Tier 1 cannot be smaller than supplier minimum.');
    tiers.push({min_qty:form.supplier_min_qty,max_qty:String(firstMax),price_per_unit:form.tier1_price,pricing_unit:unit});
    tiers.push({min_qty:form.target_qty,max_qty:form.max_capacity,price_per_unit:form.tier2_price,pricing_unit:unit});
  }else{
    tiers.push({min_qty:form.supplier_min_qty,max_qty:form.max_capacity,price_per_unit:form.tier1_price,pricing_unit:unit});
  }
  const payload={
    supplier_min_qty:form.supplier_min_qty,buyer_min_qty:form.buyer_min_qty,
    target_qty:form.target_qty,max_capacity:form.max_capacity,
    purchase_increment:form.purchase_increment,pool_unit:unit,
    delivery_type:form.delivery_type,
    scheduled_close_at:close.toISOString(),promised_delivery_at:delivery.toISOString(),price_tiers:tiers
  };
  if(!editing){
    payload.supplier_listing_id=Number(listing.id);
    payload.supplier_sku_id=Number(listing.supplier_sku_id);
    payload.product_spec_id=Number(listing.product_spec_id);
    payload.product_id=Number(listing.product_id);
  }
  return payload;
}
export function SupplierPoolsPage(){
  const {user,isAuthenticated}=useAuth();
  const navigate=useNavigate();
  const [params,setParams]=useSearchParams();
  const [data,setData]=useState({pools:[],counts:{total:0,regular:0,flash:0},server_time:null});
  const [listings,setListings]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [filter,setFilter]=useState('ALL');
  const [mode,setMode]=useState('REGULAR');
  const [form,setForm]=useState(initialForm());
  const [edit,setEdit]=useState(null);
  const [busy,setBusy]=useState(false);
  const [confirm,setConfirm]=useState(null);
  const creating=params.get('create')==='1'||Boolean(edit);
  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const [overview,listingsResult]=await Promise.all([unifiedPoolsApi.overview(),unifiedPoolsApi.listings()]);
      setData(overview?.data||{pools:[],counts:{total:0,regular:0,flash:0}});
      setListings((listingsResult?.data?.listings||[]).filter(l=>l.status==='ACTIVE'&&l.supplier_sku_id&&l.product_spec_id));
    }catch(e){setError(e.response?.data?.error?.message||'Supplier pools are unavailable.');}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{if(isAuthenticated&&user?.role==='SUPPLIER')load();else setLoading(false)},[load,isAuthenticated,user?.role]);
  const chosen=useMemo(()=>listings.find(l=>String(l.id)===String(form.supplier_listing_id)),[listings,form.supplier_listing_id]);
  const rows=useMemo(()=>data.pools.filter(p=>filter==='ALL'||p.type===filter||
    (filter==='ACTIVE'&&p.status==='ACTIVE')||(filter==='DRAFT'&&p.status==='DRAFT')), [data.pools,filter]);
  const update=(name,value)=>setForm(old=>({...old,[name]:value}));
  const openCreate=(type='REGULAR',listingId='')=>{
    const listing=listings.find(l=>String(l.id)===String(listingId))||listings[0];
    setMode(type);setEdit(null);setForm(initialForm(listing));
    setParams({create:'1',type:type.toLowerCase()});
  };
  const openEdit=(pool)=>{
    const listing=listings.find(l=>Number(l.id)===Number(pool.supplier_listing_id));
    if(!listing){toast.error('The original listing is no longer eligible; this draft cannot be edited here.');return;}
    setMode(pool.type);setEdit(pool);
    const base=initialForm(listing);
    if(pool.type==='REGULAR')Object.assign(base,{
      target_qty:String(pool.quantity_target||''),max_capacity:String(pool.max_capacity||pool.quantity_target||''),
      supplier_min_qty:String(pool.supplier_min_qty||listing.supplier_min_qty||''),
      buyer_min_qty:String(pool.buyer_min_qty||listing.buyer_min_qty||''),
      scheduled_close_at:localDate(pool.expires_at),
      promised_delivery_at:localDate(new Date(pool.expires_at).getTime()+48*3600000),
      tier1_price:String(pool.price||listing.base_unit_price||'')
    });
    else Object.assign(base,{
      total_stock:String(pool.quantity_target||''),
      discounted_unit_price:String(pool.price||''),
      duration_minutes:String(pool.configured_duration_minutes||720),
      selling_mode:pool.selling_mode||'MULTI_BUYER',
      min_quantity:'1',max_quantity_per_buyer:String(pool.quantity_target||'')
    });
    setForm(base);setParams({create:'1',type:pool.type.toLowerCase()});
  };
  const close=()=>{setEdit(null);setParams({})};
  const save=async(e)=>{
    e.preventDefault();
    if(busy)return;
    try{
      const payload=buildPayload(mode,form,chosen,edit);
      setBusy(true);
      if(mode==='REGULAR')await unifiedPoolsApi.saveRegularDraft(payload,edit?.id);
      else await unifiedPoolsApi.saveFlashDraft(payload,edit?.id);
      toast.success(mode+' draft saved. Review and publish it from Pool Management.');
      close();await load();
    }catch(e){toast.error(e.response?.data?.error?.message||e.message||'Unable to save pool draft.');}
    finally{setBusy(false);}
  };
  const runAction=async()=>{
    if(!confirm||busy)return;
    setBusy(true);
    try{
      const {pool,action}=confirm;
      if(action==='PUBLISH'){
        if(pool.type==='REGULAR')await unifiedPoolsApi.publishRegular(pool.id);
        else await unifiedPoolsApi.publishFlash(pool.id);
      }else{
        if(pool.type==='REGULAR')await unifiedPoolsApi.cancelRegular(pool.id);
        else await unifiedPoolsApi.cancelFlash(pool.id);
      }
      toast.success(pool.type+' pool '+(action==='PUBLISH'?'published':'cancelled'));
      setConfirm(null);await load();
    }catch(e){toast.error(e.response?.data?.error?.message||'Pool action was rejected by the authoritative backend.');}
    finally{setBusy(false);}
  };
  if(!isAuthenticated||user?.role!=='SUPPLIER')return <AppShell><div className="max-w-xl mx-auto p-8 space-y-3"><h1 className="text-xl font-bold">Supplier access required</h1><p className="text-sm text-[var(--text-muted)]">Only signed-in suppliers manage commercial pools.</p><Link to="/login" className="underline">Sign in</Link></div></AppShell>;
  return <AppShell><div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs font-semibold text-emerald-600 uppercase">Supplier Portal · B4 + B5 only</p>
        <h1 className="font-display text-2xl font-bold text-[var(--text-primary)]">Pool Management</h1>
        <p className="text-sm text-[var(--text-muted)]">One workspace, two independent supplier-owned pool engines. Buyer RFQs, collective and recurring procurement stay separate.</p>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={load} className="rounded-xl border px-3 py-2 flex items-center gap-2 text-sm"><RefreshCw size={15}/>Refresh</button>
        <button type="button" onClick={()=>creating?close():openCreate(params.get('type')?.toUpperCase()==='FLASH'?'FLASH':'REGULAR',params.get('listing')||'')} className="rounded-xl px-4 py-2 bg-emerald-700 text-white flex gap-2 items-center text-sm"><Plus size={16}/>{creating?'Back to pools':'Create Pool'}</button>
      </div>
    </header>
    {error&&<div role="alert" className="p-3 rounded-xl border border-red-500 text-red-500 text-sm">{error}</div>}
    {creating?<section className="max-w-3xl rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5 space-y-4">
      <div className="flex items-center gap-2"><Layers size={18}/><h2 className="font-semibold text-lg">{edit?'Edit':'Create'} {mode==='REGULAR'?'Regular':'Flash'} Pool Draft</h2></div>
      {!edit&&<div className="grid grid-cols-2 gap-2">
        {['REGULAR','FLASH'].map(t=><button key={t} type="button" onClick={()=>setMode(t)} className={`rounded-xl border p-3 text-left text-sm ${mode===t?'border-emerald-600 bg-emerald-500/10':'border-[var(--border-subtle)]'}`}>
          <b>{t==='REGULAR'?'Regular Pool':'Flash Pool'}</b><p className="text-xs mt-1 text-[var(--text-muted)]">{t==='REGULAR'?'Demand aggregation & price tiers':'Ready-stock discount & immediate checkout'}</p>
        </button>)}
      </div>}
      {!listings.length?<div className="rounded-xl border p-4 text-sm space-y-2"><AlertTriangle size={18} className="text-amber-600"/><p>No eligible published supplier listings. Create and publish your physical SKU and commercial offer first.</p><Link to="/supplier/catalog" className="underline text-emerald-600">Open Supplier Catalog</Link></div>:
      <form onSubmit={save} className="space-y-4">
        <label className="block text-xs font-semibold space-y-1"><span>Your published SKU listing</span>
          <select disabled={Boolean(edit)} required value={form.supplier_listing_id} onChange={e=>setForm(initialForm(listings.find(l=>String(l.id)===e.target.value)))} className="w-full rounded-xl border p-3 bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-sm">
            <option value="">Select supplier listing</option>
            {listings.map(l=><option key={l.id} value={l.id}>{l.variant_title||l.spec_title||l.listing_code} · {l.listing_code} · Rs. {l.base_unit_price}/{l.pricing_unit}</option>)}
          </select>
        </label>
        {chosen&&<p className="text-xs bg-[var(--bg-elevated)] rounded-lg p-3">Reference listing: {chosen.variant_title||chosen.spec_title} · {chosen.available_stock} {chosen.pricing_unit} listed · Rs. {chosen.base_unit_price}/{chosen.pricing_unit}. Inventory allocations are checked on publish.</p>}
        {mode==='REGULAR'?<>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {['supplier_min_qty','target_qty','max_capacity','buyer_min_qty'].map(k=><Field key={k} label={k.replaceAll('_',' ')} value={form[k]} onChange={v=>update(k,v)} step="0.0001" min="0.0001"/>)}
          </div>
          <Field label="Purchase increment" value={form.purchase_increment} onChange={v=>update('purchase_increment',v)} step="0.0001" min="0.0001"/>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Participation closes at (local time)" type="datetime-local" step="60" value={form.scheduled_close_at} onChange={v=>update('scheduled_close_at',v)}/>
            <Field label="Promised delivery (24–72h after closing)" type="datetime-local" step="60" value={form.promised_delivery_at} onChange={v=>update('promised_delivery_at',v)}/>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Tier 1 PKR per listing unit" value={form.tier1_price} onChange={v=>update('tier1_price',v)} />
            <Field label="Tier 2 discounted price (optional)" value={form.tier2_price} onChange={v=>update('tier2_price',v)} required={false}/>
          </div>
          <label className="block text-xs font-semibold space-y-1">Delivery type
            <select value={form.delivery_type} onChange={e=>update('delivery_type',e.target.value)} className="w-full rounded-xl p-3 border bg-[var(--bg-elevated)] border-[var(--border-subtle)]">
              <option value="DOORSTEP">Doorstep</option><option value="GROUPED_CLUSTER">Grouped cluster</option><option value="SUPPLIER_PICKUP">Supplier pickup</option>
            </select>
          </label>
          <p className="text-xs text-[var(--text-muted)]">Regular reservations, commercial qualification, delivery clusters and buyer commitments remain governed by B4. Pricing is not guaranteed until terms are locked.</p>
        </>:<>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Ready stock (listing purchase units)" value={form.total_stock} onChange={v=>update('total_stock',v)} step="0.01"/>
            <Field label="Discounted price PKR per unit" value={form.discounted_unit_price} onChange={v=>update('discounted_unit_price',v)}/>
            <Field label="Duration (whole minutes, starts at publish)" value={form.duration_minutes} onChange={v=>update('duration_minutes',v)} step="1" min="2"/>
            <Field label="Buyer delivery fee PKR" value={form.delivery_fee} onChange={v=>update('delivery_fee',v)} min="0"/>
          </div>
          <label className="block text-xs font-semibold space-y-1">Selling mode
            <select value={form.selling_mode} onChange={e=>update('selling_mode',e.target.value)} className="w-full rounded-xl p-3 border bg-[var(--bg-elevated)] border-[var(--border-subtle)]">
              <option value="MULTI_BUYER">Multiple buyers</option><option value="WHOLE_LOT">Whole lot, one buyer</option>
            </select>
          </label>
          {form.selling_mode==='MULTI_BUYER'&&<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Minimum quantity / buyer" value={form.min_quantity} onChange={v=>update('min_quantity',v)} />
            <Field label="Maximum quantity / buyer" value={form.max_quantity_per_buyer} onChange={v=>update('max_quantity_per_buyer',v)}/>
            <Field label="Purchase increment" value={form.purchase_increment} onChange={v=>update('purchase_increment',v)}/>
          </div>}
          <Field label="Clearance reason" type="text" step={undefined} value={form.clearance_reason} onChange={v=>update('clearance_reason',v)} placeholder="Excess ready stock"/>
          <Field label="Best-before date (required for near-expiry reasons)" type="date" step={undefined} value={form.best_before_date} onChange={v=>update('best_before_date',v)} required={false}/>
          <label className="block text-xs font-semibold space-y-1">Stock condition notes
            <textarea value={form.condition_notes} maxLength={2000} onChange={e=>update('condition_notes',e.target.value)} rows={3} className="w-full rounded-xl border p-3 bg-[var(--bg-elevated)] border-[var(--border-subtle)]"/>
          </label>
          <p className="text-xs text-[var(--text-muted)]">Flash uses its own instant stock hold and Safepay checkout. No regular volume pricing or buyer commitment states.</p>
        </>}
        <div className="flex flex-wrap gap-2 justify-end pt-2">
          <button type="button" onClick={close} className="px-4 py-2 rounded-xl border text-sm">Cancel</button>
          <button disabled={busy||!chosen} type="submit" className="px-4 py-2 rounded-xl bg-emerald-700 text-white disabled:opacity-50 text-sm">{busy?'Saving…':'Save Draft'}</button>
        </div>
      </form>}
    </section>:
    <>
      <div className="grid grid-cols-3 gap-2">
        {[[data.counts.total,'All Pools'],[data.counts.regular,'Regular'],[data.counts.flash,'Flash']].map(([count,label])=><div key={label} className="rounded-xl border border-[var(--border-subtle)] p-3 bg-[var(--bg-card)]"><div className="text-2xl font-bold tabular-nums">{count||0}</div><div className="text-xs text-[var(--text-muted)]">{label}</div></div>)}
      </div>
      <div className="flex gap-2 flex-wrap">
        {['ALL','REGULAR','FLASH','DRAFT','ACTIVE'].map(t=><button key={t} onClick={()=>setFilter(t)} className={`px-3 py-2 border rounded-xl text-xs ${filter===t?'border-emerald-600 text-emerald-600':'border-[var(--border-subtle)]'}`}>{t==='ALL'?'All':t[0]+t.slice(1).toLowerCase()}</button>)}
      </div>
      {loading?<p className="text-sm text-[var(--text-muted)]">Loading supplier pools…</p>:rows.length===0?
        <div className="p-8 text-center rounded-xl border border-[var(--border-subtle)]"><Package className="mx-auto mb-2 text-[var(--text-muted)]"/><p className="font-semibold">No matching pools</p><p className="text-xs text-[var(--text-muted)]">Create a pool from a published supplier listing.</p></div>:
      <div className="grid sm:grid-cols-2 gap-3">{rows.map(pool=><article key={pool.type+'-'+pool.id} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 space-y-3">
        <div className="flex justify-between items-center gap-2"><span className="text-xs font-bold">{pool.type==='FLASH'?'Flash Pool':'Regular Pool'}</span><span className="text-xs text-[var(--text-muted)]">{pool.status}</span></div>
        <div className="font-semibold">{pool.product_title||pool.code||'Supplier SKU'}</div>
        <p className="text-xs text-[var(--text-muted)]">{pool.code} · {pool.type==='REGULAR'?
          `${pool.quantity_current||0} / ${pool.quantity_target||0} ${pool.unit||''} committed`:
          `${pool.quantity_available??0} / ${pool.quantity_target||0} ${pool.unit||''} available`}</p>
        <div className="flex items-center gap-2 text-xs"><Clock size={14}/>{pool.status==='DRAFT'&&pool.type==='FLASH'?
          'Flash duration starts on publication':pool.expires_at?
          <CountdownTimer deadline={pool.expires_at} serverTime={data.server_time} compact label="Closes in"/>:
          'No deadline'}</div>
        <div className="flex flex-wrap gap-2">
          {pool.can_edit&&<button onClick={()=>openEdit(pool)} className="border rounded-lg px-3 py-1.5 text-xs">Edit Draft</button>}
          {pool.can_publish&&<button onClick={()=>setConfirm({pool,action:'PUBLISH'})} className="bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs flex gap-1 items-center"><Lock size={12}/>Review & Publish</button>}
          {['DRAFT','ACTIVE'].includes(pool.status)&&<button onClick={()=>setConfirm({pool,action:'CANCEL'})} className="border border-amber-600 text-amber-600 px-3 py-1.5 rounded-lg text-xs">Cancel</button>}
        </div>
      </article>)}</div>}
    </>}
    {confirm&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true"><div className="max-w-md w-full rounded-2xl p-5 bg-[var(--bg-card)] space-y-4">
      <h2 className="text-lg font-bold">{confirm.action==='PUBLISH'?'Publish and lock commercial terms?':'Cancel this pool?'}</h2>
      <p className="text-sm text-[var(--text-secondary)]">{confirm.pool.type} · {confirm.pool.code}. {confirm.action==='PUBLISH'?'The original B4/B5 engine will verify stock, subscription, ownership and deadlines before publishing.':'Cancellation may fail if buyers already have protected commitments.'}</p>
      <div className="flex justify-end gap-2"><button onClick={()=>setConfirm(null)} disabled={busy} className="border rounded-lg px-3 py-2 text-sm">Back</button><button onClick={runAction} disabled={busy} className="bg-emerald-700 text-white rounded-lg px-4 py-2 text-sm">{busy?'Working…':'Confirm '+confirm.action.toLowerCase()}</button></div>
    </div></div>}
  </div></AppShell>;
}
export default SupplierPoolsPage;
