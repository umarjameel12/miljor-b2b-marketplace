import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {toast} from 'react-toastify';
import {Clock,Package,ShoppingCart,Truck,Info,ShieldCheck} from 'lucide-react';
import {useAuth} from '../../context/AuthContext';
import {CountdownTimer} from '../ui/CountdownTimer';
import unifiedPoolsApi from '../../api/unifiedPools';
import apiClient from '../../api/client';

const fmt=value=>value==null?'Not quoted':'Rs. '+Number(value).toLocaleString('en-PK',{
  minimumFractionDigits:2,maximumFractionDigits:2
});
const key=(prefix)=>prefix+'-'+Date.now()+'-'+Math.random().toString(36).slice(2,14);
const errorMessage=e=>e.response?.data?.error?.message||e.message||'Request failed';
const positive=value=>Number.isFinite(Number(value))&&Number(value)>0;
export function BuyerPoolCard({pool,serverTime,clusterId,onChange}){
  const {user,isAuthenticated}=useAuth();
  const flash=pool.type==='FLASH';
  const [open,setOpen]=useState(false);
  const [quantity,setQuantity]=useState(String(flash?
    (pool.selling_mode==='WHOLE_LOT'?pool.total_stock:pool.min_quantity):pool.buyer_min_qty));
  const [savedAddresses,setSavedAddresses]=useState([]);
  const [selectedAddress,setSelectedAddress]=useState('');
  const [loadingAddresses,setLoadingAddresses]=useState(false);
  const [saving,setSaving]=useState(false);
  const [hold,setHold]=useState(null);
  const [holdState,setHoldState]=useState(null);
  const [holdClockExpired,setHoldClockExpired]=useState(false);
  const [quoteNotice,setQuoteNotice]=useState('');
  const purchaseKey=useRef(null);
  const purchaseIntent=useRef(null);
  const [uncertainPurchase,setUncertainPurchase]=useState(false);
  const checkoutKey=useRef(null);
  useEffect(()=>{
    setQuantity(String(flash?
      (pool.selling_mode==='WHOLE_LOT'?pool.total_stock:pool.min_quantity):pool.buyer_min_qty));
    setHold(null);setHoldState(null);setHoldClockExpired(false);purchaseKey.current=null;purchaseIntent.current=null;setUncertainPurchase(false);checkoutKey.current=null;setOpen(false);
  },[pool.id,pool.type]);
  useEffect(()=>{
    if(!open||!flash||!isAuthenticated||user?.role!=='BUYER')return;
    let active=true;
    setLoadingAddresses(true);
    apiClient.get('/buyer/addresses').then(({data})=>{
      const addresses=Array.isArray(data?.data)?data.data:(data?.data?.addresses||[]);
      const verified=addresses.filter(a=>String(a.city||'').toLowerCase()==='lahore' &&
        a.geographic_match_status==='VERIFIED'&&a.user_confirmation_status==='CONFIRMED' &&
        !a.manual_review_required);
      if(active){
        setSavedAddresses(verified);
        setSelectedAddress(prev=>verified.some(a=>String(a.id)===prev)?prev:
          String(verified.find(a=>a.is_default)?.id||verified[0]?.id||''));
      }
    }).catch(e=>{
      if(active)setQuoteNotice(errorMessage(e));
    }).finally(()=>{if(active)setLoadingAddresses(false)});
    return()=>{active=false};
  },[open,flash,isAuthenticated,user?.role]);
  const refreshHold=useCallback(async()=>{
    if(!hold?.id)return;
    try {
      const res=await apiClient.get(`/flash-pools/holds/${hold.id}`);
      if(res?.data?.success)setHoldState(res.data.data?.hold||null);
    }catch(e){setQuoteNotice(errorMessage(e));}
  },[hold?.id]);
  useEffect(()=>{
    if(!hold?.id)return;
    refreshHold();
    const timer=setInterval(refreshHold,20000);
    return()=>clearInterval(timer);
  },[refreshHold,hold?.id]);
  const submit=async()=>{
    if(!isAuthenticated||user?.role!=='BUYER'){toast.error('Verified business buyer login required.');return;}
    if(!positive(quantity)){toast.error('Enter a positive quantity.');return;}
    setSaving(true);setQuoteNotice('');
    try{
      if(flash){
        const saved=savedAddresses.find(a=>String(a.id)===selectedAddress);
        if(!saved)throw Error('Choose your verified saved Lahore business delivery address before holding ready stock.');
        const payload={quantity:String(quantity),delivery_address_id:Number(saved.id),
          delivery_cluster_id:Number(saved.cluster_id)};
        const fingerprint=JSON.stringify(payload);
        if(purchaseIntent.current && purchaseIntent.current.fingerprint!==fingerprint)
          throw Error('Previous stock-hold outcome is uncertain. Review My Orders before changing quantity or delivery address.');
        if(!purchaseKey.current)purchaseKey.current=key('flash-hold');
        if(!purchaseIntent.current)purchaseIntent.current={fingerprint};
        const result=await unifiedPoolsApi.holdFlash(pool.id,payload,purchaseKey.current);
        const next=result.data?.hold;
        if(!next?.order_id||!next.id)throw Error('The server did not provide a valid Flash purchase hold.');
        setHold(next);setUncertainPurchase(false);
        // Do NOT refresh the discover list here: a whole-lot hold can remove
        // the offer and unmount this live checkout modal before Safepay starts.
        toast.success('Stock hold created. Pay within the displayed 15-minute window.');
      }else{
        const payload={pool_id:pool.id,quantity:String(quantity)};
        const fingerprint=JSON.stringify(payload);
        if(purchaseIntent.current&&purchaseIntent.current.fingerprint!==fingerprint)
          throw Error('An earlier pool reservation could have succeeded. Review My Orders before changing quantity.');
        if(!purchaseKey.current)purchaseKey.current=key('regular-reserve');
        if(!purchaseIntent.current)purchaseIntent.current={fingerprint};
        const result=await apiClient.post('/reservations',payload,
          {headers:{'X-Idempotency-Key':purchaseKey.current}});
        if(!result?.data?.success)throw Error('Unable to reserve quantity.');
        purchaseKey.current=null;purchaseIntent.current=null;setUncertainPurchase(false);
        toast.success('Pool quantity reserved. Final tier and payment require separate buyer confirmation.');
        setOpen(false);onChange?.();
      }
    }catch(e){if(!e.response&&purchaseIntent.current)setUncertainPurchase(true);toast.error(errorMessage(e));}
    finally{setSaving(false);}
  };
  const checkout=async()=>{
    if(!hold?.order_id||saving)return;
    setSaving(true);
    try{
      if(!checkoutKey.current)checkoutKey.current=key('flash-pay');
      const response=await unifiedPoolsApi.initiateCheckout(hold.order_id,checkoutKey.current);
      const url=response.data?.checkout_url;
      if(typeof url!=='string'||!/^https:\/\//i.test(url))throw Error('Safepay checkout is unavailable. Payment remains unconfirmed.');
      window.location.assign(url);
    }catch(e){toast.error(errorMessage(e));setSaving(false);refreshHold();}
  };
  const openForBuyer=()=>{
    if(!isAuthenticated||user?.role!=='BUYER'){toast.error('Sign in as a verified B2B buyer to purchase.');return;}
    setOpen(true);
  };
  const holdExpired=['EXPIRED','RELEASED','FAILED'].includes(holdState?.status) ||
    (holdClockExpired && !['PAID','PAYMENT_PENDING'].includes(holdState?.status));
  const pending=holdState?.status==='PAYMENT_PENDING';
  const paid=holdState?.status==='PAID';
  const ends=pool.pool_close_at;
  return <article className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 space-y-3 flex flex-col" aria-label={pool.type+' supplier pool'}>
    <div className="flex justify-between gap-2 items-center">
      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${flash?'text-amber-600 bg-amber-500/10':'text-emerald-600 bg-emerald-500/10'}`}>Pool</span>
      <span className="text-xs text-[var(--text-muted)]">{pool.code}</span>
    </div>
    <div>
      <h3 className="font-semibold text-base">{pool.product_title||'Published Supplier SKU'}</h3>
      <p className="text-xs text-[var(--text-muted)] mt-1">{pool.supplier_name? 'By '+pool.supplier_name:'Verified supplier'} · {pool.unit||'Supplier purchasing unit'}</p>
    </div>
    <div className="rounded-lg bg-[var(--bg-elevated)] p-3 space-y-1">
      {flash?<><div className="text-lg font-bold">{fmt(pool.discounted_unit_price)} <span className="text-xs font-normal">/ {pool.unit}</span></div>
        {pool.original_unit_price&&Number(pool.original_unit_price)>Number(pool.discounted_unit_price)&&
          <p className="text-xs text-[var(--text-muted)]">Reference listing price when this offer was published: <s>{fmt(pool.original_unit_price)}</s></p>}
        <p className="text-xs">Remaining: <b>{pool.remaining_stock} / {pool.total_stock} {pool.unit}</b></p>
        <p className="text-xs">{pool.selling_mode==='WHOLE_LOT'?'Whole lot purchase only':
          'Buyer limit: '+pool.min_quantity+'–'+pool.max_quantity_per_buyer+' '+pool.unit}</p>
      </>:<><div className="text-lg font-bold">{fmt(pool.estimated_unit_price)} <span className="text-xs font-normal">/ {pool.unit} (estimated tier)</span></div>
        <p className="text-xs">Pooled: <b>{pool.current_qty} / {pool.target_qty} {pool.unit}</b> · Minimum {pool.minimum_qty}</p>
        {pool.additional_quantity_for_next_tier!=null&&Number(pool.additional_quantity_for_next_tier)>0&&
          <p className="text-xs text-emerald-700 dark:text-emerald-400">{pool.additional_quantity_for_next_tier} {pool.unit} more towards next tier</p>}
        <p className="text-xs text-[var(--text-muted)]">Final price requires the supplier offer and buyer commercial confirmation.</p>
      </>}
    </div>
    <div className="text-xs flex items-center gap-2"><Clock size={14}/>
      {ends?<CountdownTimer deadline={ends} serverTime={serverTime} compact label="Closes in"/>:
        <span>Deadline unavailable</span>}
    </div>
    {flash?<div className="text-xs space-y-1">
      <p><Info size={12} className="inline mr-1"/>Clearance: {pool.clearance_reason||'Reason not provided'}</p>
      {pool.best_before_date&&<p>Best-before: {String(pool.best_before_date).slice(0,10)}</p>}
      {pool.condition_notes&&<p>Condition: {pool.condition_notes}</p>}
      <p>Published delivery charge: {fmt(pool.delivery_fee_pkr)}. Final total verified at checkout.</p>
    </div>:<p className="text-xs text-[var(--text-muted)]"><Truck size={13} className="inline mr-1"/>Delivery options: {pool.delivery_modes?.join(', ')||'Buyer eligibility to be verified'}.</p>}
    <button type="button" onClick={openForBuyer} disabled={!pool.can_join}
      className="mt-auto rounded-xl px-3 py-2.5 bg-[var(--brand-accent)] text-[#072a21] text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-2 shadow-xs hover:opacity-95 transition cursor-pointer">
      <ShoppingCart size={14}/>{pool.can_join?(flash?'Reserve stock for checkout':'Join pool'):'Unavailable'}
    </button>
    {open&&<div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Confirm supplier pool purchase">
      <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] p-5 max-w-md w-full space-y-4 max-h-[90vh] overflow-y-auto">
        <h3 className="font-semibold text-lg">Pool participation</h3>
        <p className="text-sm">{pool.product_title} · {pool.code}</p>
        {!hold?<><label className="text-xs block space-y-1">Quantity ({pool.unit})
          <input type="number" step={flash?'0.01':'0.0001'} min={flash?pool.min_quantity:pool.buyer_min_qty}
            max={flash?pool.remaining_stock:undefined} disabled={flash&&pool.selling_mode==='WHOLE_LOT'}
            value={quantity} onChange={e=>setQuantity(e.target.value)}
            className="block w-full border rounded-xl p-3 border-[var(--border-subtle)] bg-[var(--bg-elevated)]" />
        </label>
          {flash&&<div className="space-y-2">
            <label className="text-xs block space-y-1">Verified Lahore delivery address
              <select required disabled={loadingAddresses} value={selectedAddress} onChange={e=>setSelectedAddress(e.target.value)}
                className="block w-full border rounded-xl p-3 border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
                <option value="">Select verified address</option>
                {savedAddresses.map(a=><option value={a.id} key={a.id}>{a.society_area} · {a.full_address}</option>)}
              </select>
            </label>
            {uncertainPurchase&&<p role="alert" className="text-xs text-amber-600">
                A previous purchase/reservation request may already exist. Retry only the identical request, or check My Orders before another action.
              </p>}
              {loadingAddresses&&<p className="text-xs text-[var(--text-muted)]">Loading business delivery addresses…</p>}
            {!loadingAddresses&&savedAddresses.length===0&&<p className="text-xs text-amber-600">
              No verified delivery address found. <Link className="underline" to="/profile">Save or verify a Lahore delivery address in your profile</Link>.
            </p>}
            {savedAddresses.length>0&&<p className="text-xs text-[var(--text-muted)]">
              Supplier coverage will be checked against the selected address's verified Lahore cluster before stock is held.
            </p>}
          </div>}
          <p className="text-xs text-[var(--text-muted)]">{flash?
            'A 15-minute stock hold starts when the backend accepts your request. Safepay payment is a separate explicit action.':
            'Joining a pool does not guarantee final tier pricing or charge you; the supplier offer and payment are separate steps.'}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={()=>setOpen(false)} className="border rounded-lg px-3 py-2 text-xs">Back</button>
            <button disabled={saving} type="button" onClick={submit} className="bg-[var(--brand-accent)] text-[#072a21] font-semibold rounded-lg px-4 py-2 text-xs shadow-xs hover:opacity-95 transition cursor-pointer">
              {saving?'Submitting…':flash?'Reserve for 15 minutes':'Confirm reservation'}
            </button>
          </div></>:
          <div className="space-y-3">
            <div className="text-sm flex gap-2 items-center"><ShieldCheck size={16} className="text-emerald-600"/>Order {hold.order_code||'#'+hold.order_id} · Hold #{hold.id}</div>
            {holdState?.hold_expires_at||hold.hold_expires_at?
              <CountdownTimer deadline={holdState?.hold_expires_at||hold.hold_expires_at} serverTime={serverTime} compact label="Pay within" onExpire={()=>{setHoldClockExpired(true);refreshHold();}}/>:
              <p className="text-xs text-[var(--text-muted)]">Confirm the deadline from your payment status.</p>}
            <p className="text-sm">Amount: {fmt(hold.total_amount)} (backend-verified total, if provided)</p>
            {paid?<p className="text-emerald-600 text-sm">Payment verified.</p>:
              pending?<p className="text-amber-600 text-xs">Awaiting authoritative Safepay verification; do not create a duplicate order.</p>:
              holdExpired?<p className="text-amber-600 text-xs">Stock hold is no longer payable. Refresh order status or contact support.</p>:
              <button disabled={saving} onClick={checkout} type="button" className="w-full bg-[var(--brand-accent)] text-[#072a21] font-semibold rounded-lg p-3 text-xs shadow-xs hover:opacity-95 transition cursor-pointer">
                {saving?'Opening…':'Continue to Safepay'}
              </button>}
            <div className="flex justify-between text-xs"><button type="button" onClick={refreshHold} className="underline">Refresh hold status</button>
              <button type="button" onClick={()=>{setOpen(false);onChange?.();}} className="underline">Close</button></div>
          </div>}
        {quoteNotice&&<p role="alert" className="text-xs text-amber-600">{quoteNotice}</p>}
      </div>
    </div>}
  </article>;
}
export default BuyerPoolCard;
