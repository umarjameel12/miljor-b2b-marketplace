import React,{useState} from 'react';
import {Clock,Package,ShieldCheck,Zap,RefreshCw} from 'lucide-react';
import apiClient from '../api/client';
import {CountdownTimer} from './ui/CountdownTimer';
import {useAuth} from '../context/AuthContext';
import {useNavigate} from 'react-router-dom';

// Buyer Flash checkout is B5-only: stock hold -> existing order -> Safepay.
// Regular Pool reservations/tiers must never enter this component.
const positive=v=>/^\d+(?:\.\d{1,2})?$/.test(String(v))&&Number(v)>0;
const key=()=>`b5-hold-${Date.now()}-${Math.random().toString(36).slice(2,12)}`;
export function FlashBuyerPoolCard({pool,serverTime,onRefresh}){
  const {user,isAuthenticated}=useAuth();
  const navigate=useNavigate();
  const whole=pool.selling_mode==='WHOLE_LOT';
  const min=Number(pool.min_quantity||1),max=Number(pool.max_quantity_per_buyer||pool.remaining_stock||0);
  const [quantity,setQuantity]=useState(String(whole?pool.total_stock:min));
  const [submitting,setSubmitting]=useState(false);
  const [error,setError]=useState('');
  const [order,setOrder]=useState(null);
  const [expired,setExpired]=useState(false);
  const remaining=Number(pool.remaining_stock);
  const unit=pool.purchasing_unit||'unit';
  const original=Number(pool.original_unit_price),price=Number(pool.discounted_unit_price);
  const discount=original>price&&price>0?((original-price)/original)*100:null;
  const buy=async()=>{
    if(submitting)return;
    if(!isAuthenticated){navigate('/login?redirect=/pools');return;}
    if(user?.role!=='BUYER'){setError('Only verified buyer accounts can reserve Flash stock.');return;}
    const amount=whole?String(pool.total_stock):quantity.trim();
    if(!positive(amount)||Number(amount)<min||Number(amount)>max||
       Number(amount)>remaining){setError('Choose a quantity within available stock and buyer limits.');return;}
    if(whole&&Number(amount)!==Number(pool.total_stock)){setError('Whole-lot offer must be purchased in full.');return;}
    const increment=Number(pool.purchase_increment||1);
    if(!whole&&(!Number.isFinite(increment)||increment<=0||
       Math.abs((Number(amount)-min)/increment-Math.round((Number(amount)-min)/increment))>0.000001)){
      setError('Quantity must match supplier purchase increments.');return;
    }
    setSubmitting(true);setError('');
    try{
      const response=await apiClient.post(`/flash-pools/${pool.id}/hold`,
        {quantity:amount},{headers:{'X-Idempotency-Key':key()}});
      const hold=response.data?.data?.hold;
      if(!hold?.order_id)throw Error('Flash stock hold created but order reference is unavailable. Check your orders before retrying.');
      setOrder({order_id:hold.order_id,hold_id:hold.id,checkout_endpoint:hold.checkout_endpoint});
      // We do not initiate a financial transaction without buyer's second explicit click.
    }catch(e){
      setError(e.response?.data?.error?.message||e.message||'Unable to reserve Flash stock.');
      onRefresh?.();
    }finally{setSubmitting(false);}
  };
  const checkout=async()=>{
    if(!order?.order_id||submitting)return;
    setSubmitting(true);setError('');
    try{
      const response=await apiClient.post(`/orders/${order.order_id}/checkout`,{},
        {headers:{'X-Idempotency-Key':`b5-checkout-${order.order_id}-${Date.now()}`}});
      const url=response.data?.data?.checkout_url;
      if(!url||!/^https:\/\//i.test(url))throw Error('Safepay checkout URL unavailable. Review your order payment status.');
      window.location.assign(url);
    }catch(e){setError(e.response?.data?.error?.message||e.message||'Checkout not started. Your hold may require reconciliation.');setSubmitting(false);}
  };
  return <article className="rounded-2xl border border-[var(--border-subtle)] p-4 bg-[var(--bg-card)] space-y-3">
    <div className="flex flex-wrap justify-between gap-2 items-center">
      <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-600"><Zap size={14}/> Flash Pool</span>
      <span className="text-xs text-[var(--text-muted)]">{pool.flash_code}</span>
    </div>
    <h3 className="font-semibold text-sm text-[var(--text-primary)]">{pool.sku_title||'Published supplier SKU'}</h3>
    <p className="text-xs text-[var(--text-muted)]">By {pool.supplier_name||'Verified supplier'} · {pool.pack_size||''} {pool.pack_unit||''}</p>
    <div className="flex gap-2 flex-wrap items-baseline">
      <strong className="text-xl">Rs. {price.toLocaleString('en-PK',{minimumFractionDigits:2,maximumFractionDigits:2})}/{unit}</strong>
      {discount!==null&&<span className="text-xs text-[var(--text-muted)] line-through">Rs. {original.toLocaleString('en-PK')}/{unit}</span>}
      {discount!==null&&<span className="text-xs text-emerald-600">{discount.toFixed(1)}% below this supplier's listed price</span>}
    </div>
    <div className="text-xs flex flex-col gap-1">
      <span>{remaining} {unit} available{whole?' · Entire lot only':''}</span>
      <CountdownTimer deadline={pool.expiry_at_utc} serverTime={serverTime} label="Closes in" compact onExpire={()=>{setExpired(true);onRefresh?.()}}/>
      <span className="text-[var(--text-muted)]">Buyer quantity: {whole?'whole lot':`${min} to ${max} ${unit}`} · Delivery fee: Rs. {Number(pool.delivery_fee||0).toLocaleString('en-PK')}</span>
      {pool.clearance_reason&&<span>Clearance reason: {pool.clearance_reason}</span>}
      {pool.best_before_date&&<span>Best before: {String(pool.best_before_date).slice(0,10)}</span>}
      {pool.condition_notes&&<span>Stock condition: {pool.condition_notes}</span>}
    </div>
    {order?<div className="rounded-xl border p-3 space-y-2">
      <p className="text-xs flex items-center gap-1"><ShieldCheck size={14}/> Stock hold created for order #{order.order_id}. Payment is not yet verified.</p>
      <button type="button" disabled={submitting} onClick={checkout} className="bg-emerald-700 text-white rounded-xl px-4 py-2 text-xs disabled:opacity-50">Continue to Safepay</button>
      <p className="text-xs text-[var(--text-muted)]">Use your order payment-status page after returning from provider.</p>
    </div>:<div className="flex items-end gap-2">
      {!whole&&<label className="text-xs flex-1 space-y-1"><span>Quantity ({unit})</span>
        <input type="number" min={min} max={Math.min(max,remaining)} step={pool.purchase_increment||1} value={quantity}
          onChange={e=>setQuantity(e.target.value)}
          className="w-full rounded-xl border p-2 bg-[var(--bg-elevated)] border-[var(--border-subtle)]"/>
      </label>}
      <button type="button" disabled={submitting||expired||remaining<=0} onClick={buy}
        className="bg-emerald-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-semibold flex gap-2 items-center">
        {submitting?'Reserving…':whole?'Reserve Whole Lot':'Reserve Stock'}
      </button>
    </div>}
    {error&&<div role="alert" className="text-xs text-red-600 flex items-start gap-2"><Package size={14}/>{error}</div>}
  </article>;
}
export default FlashBuyerPoolCard;
