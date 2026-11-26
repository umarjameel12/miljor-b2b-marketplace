import React,{useEffect,useMemo,useState,useCallback,useRef} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {toast} from 'react-toastify';
import {Layers,Plus,RefreshCw,Clock,Package,AlertTriangle,Lock} from 'lucide-react';
import {AppShell} from '../components/layout/AppShell';
import {useAuth} from '../context/AuthContext';
import {CountdownTimer} from '../components/ui/CountdownTimer';
import unifiedPoolsApi from '../api/unifiedPools';
import {SupplierPoolOperationsPanel} from '../components/supplier/SupplierPoolOperationsPanel';

const localDate=(date)=>{
  const d=new Date(date);
  const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,16);
};
const LOOSE_UNITS=new Set(['kg','g','mg','l','litre','liter','ml']);
const isLooseUnit=(unit)=>LOOSE_UNITS.has(String(unit||'').trim().toLowerCase());
const initialForm=(listing)=>({
  supplier_listing_id:String(listing?.id||''),
  supplier_min_qty:String(listing?.supplier_min_qty||''),
  buyer_min_qty:String(listing?.buyer_min_qty||''),
  target_qty:'',max_capacity:'',purchase_increment:'1',tier1_price:String(listing?.base_unit_price||''),
  tier2_price:'',tier2_min_qty:'',delivery_type:'DOORSTEP',delivery_clusters:[],
  scheduled_close_at:localDate(Date.now()+72*3600000),
  promised_delivery_at:localDate(Date.now()+120*3600000),
  total_stock:'',discounted_unit_price:'',min_quantity:'1',
  max_quantity_per_buyer:'',selling_mode:'MULTI_BUYER',
  duration_minutes:'720',clearance_reason:'',condition_notes:'',
  best_before_date:'',delivery_fee:'0'
});
const positive=v=>/^\d+(?:\.\d{1,4})?$/.test(String(v||'')) && Number(v)>0;
const money=v=>/^\d+(?:\.\d{1,2})?$/.test(String(v||'')) && Number(v)>0;
const Field=({label,hint,value,onChange,type='number',step='0.01',required=true,min,placeholder})=>(
  <label className="block text-xs font-medium space-y-1.5">
    <span className="block text-[var(--text-secondary)] font-semibold">{label}</span>
    <input className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-accent)]/40 transition"
      type={type} step={step} min={min} required={required} placeholder={placeholder||''} value={value}
      onChange={e=>onChange(e.target.value)}/>
    {hint&&<span className="block text-[11px] text-[var(--text-muted)]">{hint}</span>}
  </label>
);
function buildPayload(mode,form,listing,editing){
  if(!listing||listing.status!=='ACTIVE'||!listing.supplier_sku_id)
    throw Error('Select a published supplier-owned SKU listing, not legacy global specifications.');
  const unit=listing.pricing_unit||listing.purchasing_unit;
  if(!unit)throw Error('Listing has no authoritative purchasing unit.');
  const discrete=!isLooseUnit(unit);
  if(mode==='FLASH'){
    const qty=form.total_stock,price=form.discounted_unit_price;
    if(!positive(qty)||!money(price)||Number(price)>Number(listing.base_unit_price))
      throw Error('Valid ready-stock quantity and discounted PKR price (≤ base listing price) required.');
    if(discrete && !Number.isInteger(Number(qty)))
      throw Error(`Unit '${unit}' is indivisible; ready stock must be a whole number.`);
    if(!Number.isSafeInteger(Number(form.duration_minutes))||Number(form.duration_minutes)<2)
      throw Error('Flash duration must be at least 2 whole minutes.');
    if(!form.clearance_reason.trim()||form.clearance_reason.trim().length<3)
      throw Error('Provide a truthful clearance reason (at least 3 characters).');
    if(form.selling_mode==='MULTI_BUYER'){
      if(!positive(form.min_quantity)||!positive(form.max_quantity_per_buyer)||!positive(form.purchase_increment))
        throw Error('Buyer min, max per buyer, and purchase increment must be positive numbers.');
      if(Number(form.min_quantity)>Number(form.max_quantity_per_buyer)||Number(form.max_quantity_per_buyer)>Number(qty))
        throw Error('Must satisfy: Buyer Min ≤ Max Per Buyer ≤ Ready Stock.');
      if(discrete && (!Number.isInteger(Number(form.min_quantity))||!Number.isInteger(Number(form.max_quantity_per_buyer))))
        throw Error(`Unit '${unit}' is indivisible; buyer min/max must be whole numbers.`);
    }
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
    throw Error('All Regular Pool quantities and purchase increment must be positive.');
  const minimum=Number(form.supplier_min_qty),target=Number(form.target_qty),capacity=Number(form.max_capacity),buyerMin=Number(form.buyer_min_qty),increment=Number(form.purchase_increment);
  if(discrete && [minimum,target,capacity,buyerMin].some(v=>!Number.isInteger(v)))
    throw Error(`Unit '${unit}' is indivisible; quantities must be whole numbers.`);
  if(target<minimum||capacity<target||buyerMin>capacity)
    throw Error('Quantities must satisfy: Supplier Min ≤ Target ≤ Max Capacity, and Buyer Min ≤ Max Capacity.');
  if(!money(form.tier1_price)||Number(form.tier1_price)>Number(listing.base_unit_price))
    throw Error('Tier 1 price must be positive and must not exceed the listing base price.');
  const hasDiscount=Boolean(form.tier2_price);
  const tier2StartRaw=form.tier2_min_qty?String(form.tier2_min_qty).trim():String(form.target_qty);
  const tier2Start=Number(tier2StartRaw);
  if(hasDiscount){
    if(!money(form.tier2_price)||Number(form.tier2_price)>=Number(form.tier1_price))
      throw Error('Tier 2 discounted price must be strictly lower than Tier 1 price.');
    if(!positive(tier2StartRaw)||tier2Start<=minimum||tier2Start>capacity)
      throw Error('Tier 2 threshold must be greater than Supplier Min and ≤ Max Capacity.');
    if(discrete && !Number.isInteger(tier2Start))
      throw Error(`Unit '${unit}' is indivisible; Tier 2 threshold must be a whole number.`);
  }
  const close=new Date(form.scheduled_close_at),delivery=new Date(form.promised_delivery_at);
  const hours=(delivery-close)/3600000;
  if(!Number.isFinite(hours)||close<=new Date()||hours<24||hours>72)
    throw Error('Pool close must be in the future, and promised delivery must be 24–72 hours after closing.');
  const tiers=[];
  if(hasDiscount){
    const step=discrete&&!Number.isInteger(increment)?1:increment;
    const firstMax=(Math.round(tier2Start*10000)-Math.round(step*10000))/10000;
    if(firstMax<minimum)throw Error('Tier 1 max qty cannot be smaller than Supplier Min. Increase Tier 2 threshold.');
    tiers.push({min_qty:form.supplier_min_qty,max_qty:String(firstMax),price_per_unit:form.tier1_price,pricing_unit:unit});
    tiers.push({min_qty:tier2StartRaw,max_qty:form.max_capacity,price_per_unit:form.tier2_price,pricing_unit:unit});
  }else{
    tiers.push({min_qty:form.supplier_min_qty,max_qty:form.max_capacity,price_per_unit:form.tier1_price,pricing_unit:unit});
  }
  if(form.delivery_type==='SUPPLIER_PICKUP'){
    if(!form.pickup_available)throw Error('Enable an active supplier pickup point in Supplier Profile before choosing pickup-only.');
  }else if(!Array.isArray(form.delivery_clusters)||form.delivery_clusters.length===0){
    throw Error('Choose at least one eligible Lahore delivery cluster for doorstep/grouped delivery.');
  }
  const payload={
    delivery_clusters:form.delivery_type==='SUPPLIER_PICKUP'?[]:form.delivery_clusters,
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
  }
  return payload;
}
export function SupplierPoolsPage(){
  const {user,isAuthenticated}=useAuth();
  const [params,setParams]=useSearchParams();
  const [data,setData]=useState({pools:[],counts:{total:0,regular:0,flash:0},server_time:null});
  const [listings,setListings]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [operations,setOperations]=useState({
    delivery:null,inventory:null,insights:null,alerts:null
  });
  const [operationsError,setOperationsError]=useState('');

  const [filter,setFilter]=useState('ALL');
  const [statusFilter,setStatusFilter]=useState('ALL');
  const [mode,setMode]=useState('REGULAR');
  const [form,setForm]=useState(initialForm());
  const [edit,setEdit]=useState(null);
  const [busy,setBusy]=useState(false);
  const regularDraftIntent=useRef(null);
  const regularPublishIntents=useRef({});
  const [uncertainDraft,setUncertainDraft]=useState(false);

  const [confirm,setConfirm]=useState(null);
  const editRequest=params.get('edit');
  const creating=params.get('create')==='1'||Boolean(edit);
  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const [overview,listingsResult]=await Promise.all([unifiedPoolsApi.overview(),unifiedPoolsApi.listings()]);
      setData(overview?.data||{pools:[],counts:{total:0,regular:0,flash:0}});
      setListings((listingsResult?.data?.listings||[]).filter(l=>l.status==='ACTIVE'&&l.supplier_sku_id&&l.product_spec_id));
      // Operational read models may fail independently; creation and existing pool listing
      // remain available without presenting guessed stock/rates.
      const jobs=await Promise.allSettled([
        unifiedPoolsApi.deliveryContext(),unifiedPoolsApi.inventory(),
        unifiedPoolsApi.insights(),unifiedPoolsApi.alerts()
      ]);
      setOperations({
        delivery:jobs[0].status==='fulfilled'?jobs[0].value?.data:null,
        inventory:jobs[1].status==='fulfilled'?jobs[1].value?.data:null,
        insights:jobs[2].status==='fulfilled'?jobs[2].value?.data:null,
        alerts:jobs[3].status==='fulfilled'?jobs[3].value?.data:null
      });
      setOperationsError(jobs.some(j=>j.status==='rejected')?
        'Some operational data is unavailable; no missing values have been estimated.':'');
    }catch(e){setError(e.response?.data?.error?.message||'Supplier pools are unavailable.');}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{if(isAuthenticated&&user?.role==='SUPPLIER')load();else setLoading(false)},[load,isAuthenticated,user?.role]);
  // Deep links from Supplier Catalog preselect the same real commercial offer.
  useEffect(()=>{
    if(params.get('create')!=='1'||edit||!listings.length)return;
    const requestedType=params.get('type')?.toUpperCase();
    if(['REGULAR','FLASH'].includes(requestedType))setMode(requestedType);
    const listingId=params.get('listing');
    if(listingId && listings.some(l=>String(l.id)===listingId)){
      setForm(previous=>previous.supplier_listing_id===listingId?previous:
        initialForm(listings.find(l=>String(l.id)===listingId)));
    }
  // Only respond to route/data changes, not the supplier's unsaved form edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[params.toString(),listings.length,edit]);
  const chosen=useMemo(()=>listings.find(l=>String(l.id)===String(form.supplier_listing_id)),[listings,form.supplier_listing_id]);
  const rows=useMemo(()=>data.pools.filter(p=>(filter==='ALL'||p.type===filter)&&
    (statusFilter==='ALL'||p.status===statusFilter)), [data.pools,filter,statusFilter]);
  const update=(name,value)=>setForm(old=>({...old,[name]:value}));
  const openCreate=(type='REGULAR',listingId='')=>{
    const listing=listings.find(l=>String(l.id)===String(listingId))||listings[0];
    regularDraftIntent.current=null;setUncertainDraft(false);
    setMode(type);setEdit(null);setForm(initialForm(listing));
    setParams({create:'1',type:type.toLowerCase()});
  };
  const openEdit=(pool)=>{
    const listing=listings.find(l=>Number(l.id)===Number(pool.supplier_listing_id));
    if(!listing){toast.error('Original supplier SKU listing is no longer eligible for editing.');return;}
    regularDraftIntent.current=null;setUncertainDraft(false);
    setMode(pool.type);setEdit(pool);
    const base=initialForm(listing);
    if(pool.type==='REGULAR'){
      const tiers=pool.price_tiers||[];
      Object.assign(base,{
        target_qty:String(pool.quantity_target??''),max_capacity:String(pool.max_capacity??pool.quantity_target??''),
        supplier_min_qty:String(pool.supplier_min_qty??listing.supplier_min_qty??''),
        buyer_min_qty:String(pool.buyer_min_qty??listing.buyer_min_qty??''),
        purchase_increment:String(pool.purchase_increment??1),
        scheduled_close_at:localDate(pool.expires_at),
        promised_delivery_at:localDate(pool.promised_delivery_at),
        delivery_type:pool.delivery_type||'DOORSTEP',
        delivery_clusters:pool.delivery_clusters||[],
        tier1_price:String(tiers[0]?.price_per_unit??pool.price??listing.base_unit_price??''),
        tier2_price:tiers.length>1?String(tiers[1].price_per_unit):'',
        tier2_min_qty:tiers.length>1?String(tiers[1].min_qty):''
      });
    }else{
      const bestBefore=pool.best_before_date?new Date(pool.best_before_date):null;
      Object.assign(base,{
        total_stock:String(pool.quantity_target??''),
        discounted_unit_price:String(pool.price??''),
        duration_minutes:String(pool.configured_duration_minutes??720),
        selling_mode:pool.selling_mode||'MULTI_BUYER',
        min_quantity:String(pool.min_quantity??1),
        max_quantity_per_buyer:String(pool.max_quantity_per_buyer??pool.quantity_target??''),
        purchase_increment:String(pool.purchase_increment??1),
        clearance_reason:pool.clearance_reason||'',
        condition_notes:pool.condition_notes||'',
        delivery_fee:String(pool.delivery_fee??0),
        best_before_date:bestBefore&&!Number.isNaN(bestBefore.getTime())?bestBefore.toISOString().slice(0,10):''
      });
    }
    setForm(base);setParams({create:'1',type:pool.type.toLowerCase()});
  };
  useEffect(()=>{
    if(!editRequest||loading||edit||!data.pools.length)return;
    const [type,id]=editRequest.split(':');
    const selected=data.pools.find(p=>p.type===type&&String(p.id)===id);
    if(selected&&selected.can_edit)openEdit(selected);
    else {
      toast.error('That pool draft is no longer editable.');
      setParams({});
    }
  // openEdit is intentionally invoked after both catalog and pool data load.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[editRequest,loading,data.pools,listings,edit]);
  const close=()=>{regularDraftIntent.current=null;setUncertainDraft(false);setEdit(null);setParams({})};
  const save=async(e)=>{
    e.preventDefault();
    if(busy)return;
    let networkMutationStarted=false;
    try{
      if(uncertainDraft)
        throw Error('Draft creation result is uncertain. Refresh Pool Management and verify whether it already exists before another submission.');
      const validatedForm={...form,
        pickup_available:Boolean(operations.delivery?.configuration?.pickup_enabled &&
          operations.delivery?.pickup_points?.some(p=>p.is_active))
      };
      const payload=buildPayload(mode,validatedForm,chosen,edit);
      if(mode==='REGULAR'){
        const fingerprint=JSON.stringify({id:edit?.id||null,payload});
        if(!regularDraftIntent.current)regularDraftIntent.current={
          fingerprint,idempotencyKey:'ucp-regular-draft-'+Date.now()+'-'+Math.random().toString(36).slice(2,12)
        };
        if(regularDraftIntent.current.fingerprint!==fingerprint)
          throw Error('An earlier Regular draft attempt has an uncertain outcome. Reconcile it before editing draft terms.');
      }
      setBusy(true);
      networkMutationStarted=true;
      if(mode==='REGULAR')
        await unifiedPoolsApi.saveRegularDraft(payload,edit?.id,regularDraftIntent.current.idempotencyKey);
      else await unifiedPoolsApi.saveFlashDraft(payload,edit?.id);
      toast.success(mode+' draft saved. Review and publish it from Pool Management.');
      close();await load();
    }catch(e){
      if(networkMutationStarted&&!e.response)setUncertainDraft(true);
      toast.error(e.response?.data?.error?.message||e.message||'Unable to save pool draft.');
    }
    finally{setBusy(false);}
  };
  const runAction=async()=>{
    if(!confirm||busy)return;
    setBusy(true);
    try{
      const {pool,action}=confirm;
      if(action==='PUBLISH'){
        if(pool.type==='REGULAR'){
          const intentKey='REGULAR:'+pool.id;
          if(!regularPublishIntents.current[intentKey])
            regularPublishIntents.current[intentKey]='ucp-publish-'+pool.id+'-'+Date.now()+'-'+Math.random().toString(36).slice(2,12);
          await unifiedPoolsApi.publishRegular(pool.id,regularPublishIntents.current[intentKey]);
          delete regularPublishIntents.current[intentKey];
        }
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
    <header className="rounded-3xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 sm:p-6 shadow-sm flex flex-wrap items-center justify-between gap-4">
      <div className="space-y-1">
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text-primary)]">Wholesale Pool Studio</h1>
        <p className="text-xs sm:text-sm text-[var(--text-secondary)]">Manage regular and flash wholesale pools, stock allocations, and delivery readiness.</p>
      </div>
      <div className="flex items-center gap-2.5">
        <button type="button" onClick={load} className="miljor-btn-primary rounded-xl px-3.5 py-2 inline-flex items-center justify-center gap-2 text-xs font-semibold leading-none whitespace-nowrap cursor-pointer"><RefreshCw size={14} className="shrink-0"/><span>Refresh</span></button>
        <button type="button" onClick={()=>creating?close():openCreate(params.get('type')?.toUpperCase()==='FLASH'?'FLASH':'REGULAR',params.get('listing')||'')} className="landing-gradient-cta rounded-xl px-4 py-2 bg-[var(--brand-accent)] text-[#072a21] font-semibold inline-flex items-center justify-center gap-2 text-xs sm:text-sm leading-none whitespace-nowrap shadow-xs hover:opacity-95 transition cursor-pointer"><Plus size={15} className="shrink-0"/><span>{creating?'Back to pools':'Create Pool'}</span></button>
      </div>
    </header>
    {error&&<div role="alert" className="p-3 rounded-xl border border-red-500 text-red-500 text-sm">{error}</div>}
    {uncertainDraft&&<p role="alert" className="text-amber-600 text-xs">
      A draft operation may have succeeded despite a network error. Refresh Pool Management and check existing drafts; do not create another until reconciled.
    </p>}
    {operationsError&&<p role="status" className="text-xs text-amber-600">{operationsError}</p>}
    {!loading&&<SupplierPoolOperationsPanel {...operations} onRefresh={load}/>}
    {creating?<section className="max-w-4xl rounded-3xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 sm:p-7 space-y-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-[var(--bg-card)] border border-[var(--border-default)] flex items-center justify-center text-[var(--brand-accent)]">
            <Layers size={18}/>
          </span>
          <div>
            <h2 className="font-display font-bold text-lg text-[var(--text-primary)]">{edit?'Edit':'Create'} Pool Draft</h2>
            <p className="text-xs text-[var(--text-secondary)]">Configure validated commercial terms before publishing live to Lahore buyers.</p>
          </div>
        </div>
      </div>
      {!edit&&<div className="grid sm:grid-cols-2 gap-3">
        {['REGULAR','FLASH'].map(t=><button key={t} type="button" onClick={()=>setMode(t)} className={`rounded-2xl border p-4 text-left transition-all cursor-pointer ${mode===t?'border-[var(--brand-accent)] bg-[var(--brand-accent)]/10 shadow-xs':'border-[var(--border-default)] bg-[var(--bg-card)] hover:border-[var(--brand-accent)]/50'}`}>
          <div className="flex items-center justify-between">
            <b className={`text-sm ${mode===t?'text-[var(--brand-accent)]':'text-[var(--text-primary)]'}`}>{t==='REGULAR'?'Regular Pool':'Flash Pool'}</b>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${mode===t?'border-[var(--brand-accent)] text-[var(--brand-accent)]':'border-[var(--border-subtle)] text-[var(--text-muted)]'}`}>{t}</span>
          </div>
          <p className="text-xs mt-1.5 text-[var(--text-secondary)]">{t==='REGULAR'?'Demand aggregation with volume-based Tier 1 & Tier 2 pricing':'Ready-stock clearance discount with instant Safepay hold'}</p>
        </button>)}
      </div>}
      {!listings.length?<div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 text-sm space-y-2.5"><AlertTriangle size={18} className="text-amber-600"/><p className="text-[var(--text-primary)] font-medium">No eligible published supplier listings. Create and publish your physical SKU and commercial offer first.</p><Link to="/supplier/catalog" className="miljor-btn-primary inline-flex items-center px-3.5 py-2 rounded-xl text-xs font-semibold">Open Supplier Catalog</Link></div>:
      <form onSubmit={save} className="space-y-5">
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 sm:p-5 space-y-3">
          <label className="block text-xs font-semibold space-y-1.5"><span className="text-[var(--text-secondary)]">Published SKU Listing *</span>
            <select disabled={Boolean(edit)} required value={form.supplier_listing_id} onChange={e=>setForm(initialForm(listings.find(l=>String(l.id)===e.target.value)))} className="w-full rounded-xl border p-3 bg-[var(--bg-elevated)] border-[var(--border-default)] text-sm text-[var(--text-primary)]">
              <option value="">Select supplier listing</option>
              {listings.map(l=><option key={l.id} value={l.id}>{l.variant_title||l.spec_title||l.listing_code} · {l.listing_code} · Rs. {l.base_unit_price}/{l.pricing_unit}</option>)}
            </select>
          </label>
          {chosen&&<div className="flex flex-wrap items-center gap-2 text-xs bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2.5 text-[var(--text-secondary)]">
            <span className="font-semibold text-[var(--text-primary)]">{chosen.variant_title||chosen.spec_title}</span>
            <span>·</span>
            <span>Stock: <strong className="text-[var(--text-primary)] tabular-nums">{chosen.available_stock} {chosen.pricing_unit}</strong></span>
            <span>·</span>
            <span>Base Price: <strong className="text-[var(--brand-accent)] tabular-nums">Rs. {chosen.base_unit_price}/{chosen.pricing_unit}</strong></span>
            <span>·</span>
            <span>Unit Type: <strong className="text-[var(--text-primary)]">{isLooseUnit(chosen.pricing_unit)?'Decimal allowed':'Whole numbers only'}</strong></span>
          </div>}
        </div>
        {mode==='REGULAR'?(()=>{
          const unit=chosen?.pricing_unit||chosen?.purchasing_unit||'unit';
          const qtyStep=chosen&&!isLooseUnit(unit)?'1':'0.0001';
          const qtyMin=chosen&&!isLooseUnit(unit)?'1':'0.0001';
          const t2Start=form.tier2_min_qty?form.tier2_min_qty:form.target_qty;
          const incNum=Number(form.purchase_increment||1);
          const stepAdj=chosen&&!isLooseUnit(unit)&&!Number.isInteger(incNum)?1:incNum;
          const t1Max=t2Start&&positive(t2Start)?((Math.round(Number(t2Start)*10000)-Math.round(stepAdj*10000))/10000):null;
          const eligibleStandard=(operations.delivery?.cluster_rates||[]).filter(rate=>rate.is_eligible&&rate.mode==='STANDARD_CLUSTERED'&&operations.delivery?.configuration?.standard_delivery_enabled);
          const setSlaPreset=(hrs)=>{
            const closeMs=new Date(form.scheduled_close_at).getTime();
            if(Number.isFinite(closeMs))update('promised_delivery_at',localDate(closeMs+hrs*3600000));
          };
          return <>
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 sm:p-5 space-y-4">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--brand-accent)]">Quantities &amp; Increment ({unit})</h3>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Rule: Supplier Min ≤ Target Qty ≤ Max Capacity, and Buyer Min ≤ Max Capacity.</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Field label="Supplier Min Qty" value={form.supplier_min_qty} onChange={v=>update('supplier_min_qty',v)} step={qtyStep} min={qtyMin}/>
              <Field label="Target Qty" value={form.target_qty} onChange={v=>update('target_qty',v)} step={qtyStep} min={qtyMin}/>
              <Field label="Max Capacity" value={form.max_capacity} onChange={v=>update('max_capacity',v)} step={qtyStep} min={qtyMin}/>
              <Field label="Buyer Min Qty" value={form.buyer_min_qty} onChange={v=>update('buyer_min_qty',v)} step={qtyStep} min={qtyMin}/>
              <Field label="Purchase Increment" hint="Step per buyer order" value={form.purchase_increment} onChange={v=>update('purchase_increment',v)} step={qtyStep} min={qtyMin}/>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 sm:p-5 space-y-4">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--brand-accent)]">Tier Pricing &amp; Quantity Limits</h3>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Tier 1 must be ≤ listing base price. Optional Tier 2 must be strictly lower than Tier 1.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label={`Tier 1 Price (PKR/${unit})`} value={form.tier1_price} onChange={v=>update('tier1_price',v)} />
              <Field label="Tier 2 Discounted Price (optional)" value={form.tier2_price} onChange={v=>update('tier2_price',v)} required={false}/>
              <Field label="Tier 2 Activates At Qty (optional)" placeholder={form.target_qty||'Defaults to Target Qty'} value={form.tier2_min_qty} onChange={v=>update('tier2_min_qty',v)} step={qtyStep} min={qtyMin} required={false}/>
            </div>
            {form.supplier_min_qty&&form.max_capacity&&form.tier1_price&&(
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-xs text-[var(--text-secondary)] flex flex-wrap gap-x-4 gap-y-1">
                {form.tier2_price&&t1Max!==null?(
                  <>
                    <span><strong className="text-[var(--text-primary)]">Tier 1:</strong> {form.supplier_min_qty} – {t1Max} {unit} @ <strong className="text-[var(--text-primary)]">Rs. {form.tier1_price}</strong></span>
                    <span><strong className="text-[var(--brand-accent)]">Tier 2:</strong> {t2Start} – {form.max_capacity} {unit} @ <strong className="text-[var(--brand-accent)]">Rs. {form.tier2_price}</strong></span>
                  </>
                ):(
                  <span><strong className="text-[var(--text-primary)]">Single Tier:</strong> {form.supplier_min_qty} – {form.max_capacity} {unit} @ <strong className="text-[var(--text-primary)]">Rs. {form.tier1_price}</strong></span>
                )}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 sm:p-5 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--brand-accent)]">Schedule &amp; Delivery Coverage</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Participation closes at (local time)" type="datetime-local" step="60" value={form.scheduled_close_at} onChange={v=>update('scheduled_close_at',v)}/>
              <div className="space-y-1.5">
                <Field label="Promised delivery (24–72h after closing)" type="datetime-local" step="60" value={form.promised_delivery_at} onChange={v=>update('promised_delivery_at',v)}/>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-[var(--text-muted)]">Quick SLA:</span>
                  {[24,48,72].map(h=>(
                    <button key={h} type="button" onClick={()=>setSlaPreset(h)} className="miljor-btn-outline px-2 py-0.5 rounded-md text-[11px] font-semibold cursor-pointer">+{h}h</button>
                  ))}
                </div>
              </div>
            </div>
            <label className="block text-xs font-semibold space-y-1.5"><span className="text-[var(--text-secondary)]">Delivery type (supplier-configured)</span>
              <select value={form.delivery_type} onChange={e=>update('delivery_type',e.target.value)} className="w-full rounded-xl p-3 border bg-[var(--bg-elevated)] border-[var(--border-default)] text-sm text-[var(--text-primary)]">
                <option value="DOORSTEP">Doorstep (Buyer selects cluster delivery or pickup if enabled)</option>
                <option value="GROUPED_CLUSTER">Grouped cluster (Shared cluster drop-off)</option>
                <option value="SUPPLIER_PICKUP">Supplier pickup only (Buyer picks up from your depot)</option>
              </select>
            </label>
            {form.delivery_type!=='SUPPLIER_PICKUP'&&<fieldset className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 p-3.5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <legend className="text-xs font-semibold text-[var(--text-primary)]">Eligible Lahore delivery clusters *</legend>
                {eligibleStandard.length>0&&(
                  <button type="button" onClick={()=>update('delivery_clusters',eligibleStandard.map(r=>Number(r.cluster_id)))} className="miljor-btn-outline px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer">
                    Select All ({eligibleStandard.length})
                  </button>
                )}
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">Select from your active Standard delivery rates. Buyers in these clusters can join.</p>
              <div className="grid sm:grid-cols-2 gap-2">
                {eligibleStandard.map(rate=>{
                  const cluster=operations.delivery?.clusters?.find(c=>Number(c.id)===Number(rate.cluster_id));
                  const checked=form.delivery_clusters.includes(Number(rate.cluster_id));
                  return <label key={rate.cluster_id} className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-xs cursor-pointer transition ${checked?'border-[var(--brand-accent)] bg-[var(--brand-accent)]/10':'border-[var(--border-subtle)] bg-[var(--bg-card)]'}`}>
                    <input type="checkbox" checked={checked} onChange={e=>update('delivery_clusters',e.target.checked?
                      Array.from(new Set([...form.delivery_clusters,Number(rate.cluster_id)])):
                      form.delivery_clusters.filter(id=>id!==Number(rate.cluster_id)))}/>
                    <span className="font-medium text-[var(--text-primary)]">{cluster?.name||'Cluster #'+rate.cluster_id}</span>
                    <span className="ml-auto font-mono text-[11px] text-[var(--text-muted)]">Rs. {rate.fee_pkr}</span>
                  </label>;
                })}
              </div>
              {!eligibleStandard.length&&
                <p className="text-xs text-amber-600">No eligible Standard delivery clusters active. <Link to="/supplier/profile" className="underline font-semibold">Configure in Supplier Profile</Link> before publishing.</p>}
            </fieldset>}
            {form.delivery_type==='SUPPLIER_PICKUP'&&<p className="text-xs text-[var(--text-secondary)] bg-[var(--bg-elevated)] rounded-xl p-3 border border-[var(--border-subtle)]">
              Active pickup location required. Available: <strong>{(operations.delivery?.pickup_points||[]).filter(p=>p.is_active).map(p=>p.point_name).join(', ')||'None — configure in Supplier Profile'}</strong>.
            </p>}
          </div>
        </>;})():(()=>{
          const unit=chosen?.pricing_unit||chosen?.purchasing_unit||'unit';
          const qtyStep=chosen&&!isLooseUnit(unit)?'1':'0.01';
          const qtyMin=chosen&&!isLooseUnit(unit)?'1':'0.01';
          return <>
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 sm:p-5 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--brand-accent)]">Ready Stock &amp; Flash Pricing ({unit})</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label={`Ready stock (${unit})`} value={form.total_stock} onChange={v=>update('total_stock',v)} step={qtyStep} min={qtyMin}/>
              <Field label={`Flash price (PKR/${unit})`} hint={chosen?`Must be ≤ Rs. ${chosen.base_unit_price}`:undefined} value={form.discounted_unit_price} onChange={v=>update('discounted_unit_price',v)}/>
              <Field label="Duration (minutes from publish)" value={form.duration_minutes} onChange={v=>update('duration_minutes',v)} step="1" min="2"/>
            </div>
            <label className="block text-xs font-semibold space-y-1.5"><span className="text-[var(--text-secondary)]">Selling mode</span>
              <select value={form.selling_mode} onChange={e=>update('selling_mode',e.target.value)} className="w-full rounded-xl p-3 border bg-[var(--bg-elevated)] border-[var(--border-default)] text-sm text-[var(--text-primary)]">
                <option value="MULTI_BUYER">Multiple buyers (Split stock within buyer min/max limits)</option>
                <option value="WHOLE_LOT">Whole lot, one buyer (Single buyer takes entire ready stock)</option>
              </select>
            </label>
            {form.selling_mode==='MULTI_BUYER'&&<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Minimum qty / buyer" value={form.min_quantity} onChange={v=>update('min_quantity',v)} step={qtyStep} min={qtyMin}/>
              <Field label="Maximum qty / buyer" value={form.max_quantity_per_buyer} onChange={v=>update('max_quantity_per_buyer',v)} step={qtyStep} min={qtyMin}/>
              <Field label="Purchase increment" value={form.purchase_increment} onChange={v=>update('purchase_increment',v)} step={qtyStep} min={qtyMin}/>
            </div>}
          </div>
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 sm:p-5 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--brand-accent)]">Clearance Details &amp; Delivery Readiness</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Clearance reason *" type="text" step={undefined} value={form.clearance_reason} onChange={v=>update('clearance_reason',v)} placeholder="e.g. Excess ready warehouse stock"/>
              <Field label="Best-before date (required for near-expiry)" type="date" step={undefined} value={form.best_before_date} onChange={v=>update('best_before_date',v)} required={false}/>
            </div>
            <label className="block text-xs font-semibold space-y-1.5"><span className="text-[var(--text-secondary)]">Stock condition notes</span>
              <textarea value={form.condition_notes} maxLength={2000} onChange={e=>update('condition_notes',e.target.value)} rows={2} placeholder="Packaging condition, storage batch, etc." className="w-full rounded-xl border p-3 bg-[var(--bg-elevated)] border-[var(--border-default)] text-sm text-[var(--text-primary)]"/>
            </label>
            <p className="text-xs rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 text-[var(--text-secondary)]">
              Delivery for Flash Pools uses your Supplier Profile settings (Standard: <strong>{operations.delivery?.configuration?.standard_delivery_enabled?'enabled':'disabled'}</strong> · Pickup: <strong>{operations.delivery?.configuration?.pickup_enabled?'enabled':'disabled'}</strong>). Buyers choose from your enabled options at checkout.
            </p>
          </div>
        </>;})()}
        <div className="flex flex-wrap gap-2.5 justify-end pt-2">
          <button type="button" onClick={close} className="miljor-btn-outline px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold cursor-pointer">Cancel</button>
          <button disabled={busy||!chosen||uncertainDraft} type="submit" className="landing-gradient-cta px-5 py-2.5 rounded-xl bg-[var(--brand-accent)] text-[#072a21] font-semibold disabled:opacity-50 text-xs sm:text-sm shadow-xs hover:opacity-95 transition cursor-pointer">{busy?'Saving…':'Save Draft'}</button>
        </div>
      </form>}
    </section>:
    <>
      <div className="grid grid-cols-3 gap-3">
        {[[data.counts.total,'All Pools'],[data.counts.regular,'Regular Pools'],[data.counts.flash,'Flash Pools']].map(([count,label])=><div key={label} className="rounded-2xl border border-[var(--border-default)] p-4 bg-[var(--bg-surface)]" style={{boxShadow:'var(--shadow-card)'}}><div className="text-2xl font-bold tabular-nums text-[var(--text-primary)]">{count||0}</div><div className="text-xs font-medium text-[var(--text-secondary)] mt-0.5">{label}</div></div>)}
      </div>
      <div className="flex gap-3 flex-wrap items-center justify-between rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
        <div aria-label="Unified Pool subcategories" className="flex items-center flex-wrap gap-2">
          <span className="text-xs font-semibold text-[var(--text-secondary)] mr-1">Pool Type</span>
          {['ALL','REGULAR','FLASH'].map(t=><button type="button" aria-pressed={filter===t} key={t} onClick={()=>setFilter(t)} className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer ${filter===t?'miljor-btn-primary':'miljor-btn-outline'}`}>{t==='ALL'?'All Pools':t==='REGULAR'?'Regular':'Flash'}</button>)}
        </div>
        <div aria-label="Pool status filters" className="flex items-center flex-wrap gap-2">
          <span className="text-xs font-semibold text-[var(--text-secondary)] mr-1">Status</span>
          {['ALL','DRAFT','ACTIVE'].map(t=><button type="button" aria-pressed={statusFilter===t} key={t} onClick={()=>setStatusFilter(t)} className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer ${statusFilter===t?'miljor-btn-primary':'miljor-btn-outline'}`}>{t==='ALL'?'Any Status':t==='DRAFT'?'Draft':'Active'}</button>)}
        </div>
      </div>
      {loading?<p className="text-sm text-[var(--text-muted)]">Loading supplier pools…</p>:rows.length===0?
        <div className="p-10 text-center rounded-3xl border border-[var(--border-default)] bg-[var(--bg-surface)] space-y-2"><Package className="mx-auto text-[var(--brand-accent)]" size={28}/><p className="font-semibold text-[var(--text-primary)]">No matching pools</p><p className="text-xs text-[var(--text-secondary)]">Create a Regular or Flash pool from a published supplier listing.</p></div>:
      <div className="grid sm:grid-cols-2 gap-4">{rows.map(pool=><article key={pool.type+'-'+pool.id} className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 space-y-3.5 transition-all hover:border-[var(--brand-accent)]/60" style={{boxShadow:'var(--shadow-card)'}}>
        <div className="flex justify-between items-center gap-2">
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--brand-accent)]">{pool.type}</span>
          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${pool.status==='ACTIVE'?'miljor-badge-verified':'miljor-badge-provisional'}`}>{pool.status}</span>
        </div>
        <div>
          <div className="font-display font-bold text-base text-[var(--text-primary)]">{pool.product_title||pool.code||'Supplier SKU'}</div>
          <p className="text-xs text-[var(--text-secondary)] mt-1 tabular-nums">{pool.code} · {pool.type==='REGULAR'?
            `${pool.quantity_current||0} / ${pool.quantity_target||0} ${pool.unit||''} committed`:
            `${pool.quantity_available??0} / ${pool.quantity_target||0} ${pool.unit||''} available`}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]"><Clock size={14} className="shrink-0 text-[var(--brand-accent)]"/>{pool.status==='DRAFT'&&pool.type==='FLASH'?
          'Flash duration starts on publication':pool.expires_at?
          <CountdownTimer deadline={pool.expires_at} serverTime={data.server_time} compact label="Closes in"/>:
          'No deadline'}</div>
        <div className="flex flex-wrap gap-2 pt-1 border-t border-[var(--border-subtle)]">
          {pool.can_edit&&<button onClick={()=>openEdit(pool)} className="miljor-btn-primary rounded-xl px-3.5 py-1.5 text-xs font-semibold cursor-pointer">Edit Draft</button>}
          {pool.can_publish&&<button onClick={()=>setConfirm({pool,action:'PUBLISH'})} className="landing-gradient-cta bg-[var(--brand-accent)] text-[#072a21] font-semibold px-3.5 py-1.5 rounded-xl text-xs inline-flex gap-1.5 items-center leading-none whitespace-nowrap shadow-xs cursor-pointer hover:opacity-95"><Lock size={12} className="shrink-0"/><span>Review &amp; Publish</span></button>}
          {['DRAFT','ACTIVE'].includes(pool.status)&&<button onClick={()=>setConfirm({pool,action:'CANCEL'})} className="border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 px-3.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer hover:bg-rose-500/10">Cancel</button>}
        </div>
      </article>)}</div>}
    </>}
    {confirm&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true"><div className="max-w-md w-full rounded-2xl p-5 bg-[var(--bg-card)] space-y-4">
      <h2 className="text-lg font-bold">{confirm.action==='PUBLISH'?'Publish and lock commercial terms?':'Cancel this pool?'}</h2>
      <p className="text-sm text-[var(--text-secondary)]">{confirm.pool.type} · {confirm.pool.code}. {confirm.action==='PUBLISH'?'The original B4/B5 engine will verify stock, subscription, ownership and deadlines before publishing.':'Cancellation may fail if buyers already have protected commitments.'}</p>
      <div className="flex justify-end gap-2"><button onClick={()=>setConfirm(null)} disabled={busy} className="miljor-btn-primary rounded-lg px-3 py-2 text-sm font-semibold cursor-pointer">Back</button><button onClick={runAction} disabled={busy} className="bg-[var(--brand-accent)] text-[#072a21] font-semibold rounded-lg px-4 py-2 text-sm cursor-pointer">{busy?'Working…':'Confirm '+confirm.action.toLowerCase()}</button></div>
    </div></div>}
  </div></AppShell>;
}
export default SupplierPoolsPage;
