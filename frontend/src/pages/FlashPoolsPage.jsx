import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/layout/AppShell';
import { CountdownTimer } from '../components/ui/CountdownTimer';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import { Zap, Package, ShieldCheck, Clock, Plus, LockKeyhole, ShoppingCart } from 'lucide-react';

const api = async (url, token, options = {}) => {
  const response = await fetch(url, {
    ...options, headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Request failed (${response.status})`);
  return data.data || {};
};

const initial = {
  supplier_listing_id: '', selling_mode: 'MULTI_BUYER',
  total_stock: '', discounted_unit_price: '', original_unit_price: '',
  min_quantity: '', max_quantity_per_buyer: '', delivery_fee: '0',
  clearance_reason: '', condition_notes: '', best_before_date: '', duration_value: '',
  duration_unit: 'hours'
};
const money = n => Number(n || 0).toLocaleString('en-PK', {maximumFractionDigits:2});
const durationFactors = {minutes:60000,hours:3600000,days:86400000};

export const FlashPoolsPage = () => {
  const { user, token } = useAuth();
  const [deals,setDeals] = useState([]);
  const [mine,setMine] = useState([]);
  const [listings,setListings] = useState([]);
  const [form,setForm] = useState(initial);
  const [selected,setSelected] = useState(null);
  const [buyerQuantity,setBuyerQuantity] = useState('');
  const [deliveryAddress,setDeliveryAddress] = useState('');
  const [creating,setCreating] = useState(false);
  const [editingDraft,setEditingDraft] = useState(null);
  const [pendingOrder,setPendingOrder] = useState(null);
  const [busy,setBusy] = useState(false);
  const [loading,setLoading] = useState(true);
  const [serverTime,setServerTime] = useState(null);
  const [now,setNow] = useState(Date.now());
  const isSupplier = user?.role === 'SUPPLIER';
  const isBuyer = user?.role === 'BUYER';

  const load = useCallback(async () => {
    try {
      const publicData = await api('/api/v1/flash-pools',null);
      setDeals(publicData.flash_pools || []);
      setServerTime(publicData.server_time || null);
      if (isSupplier && token) {
        const [own,offers]=await Promise.all([
          api('/api/v1/flash-pools/mine',token),
          api('/api/v1/listings/me',token)
        ]);
        setMine(own.flash_pools || []);
        setListings((offers.listings || []).filter(l=>l.status==='ACTIVE' && l.supplier_sku_id));
      }
    } catch(err) {toast.error(err.message || 'Flash offer retrieval failed');}
    finally {setLoading(false);}
  },[isSupplier,token]);

  useEffect(() => {load();},[load]);
  useEffect(() => {
    const timer = setInterval(()=>setNow(Date.now()),1000);
    const refresh = setInterval(()=>load(),60000);
    return () => {clearInterval(timer);clearInterval(refresh);};
  },[load]);

  const selectedListing = useMemo(()=>listings.find(x=>String(x.id)===String(form.supplier_listing_id)),[listings,form.supplier_listing_id]);
  const update=(name,value)=>setForm(old=>({...old,[name]:value}));
  const beginEditDraft = offer => {
    if(offer.status!=='DRAFT')return;
    const duration=Number(offer.configured_duration_minutes)||15;
    const [durationUnit,durationValue]=duration%1440===0?['days',duration/1440]:
      duration%60===0?['hours',duration/60]:['minutes',duration];
    setEditingDraft(offer.id);
    setForm({
      supplier_listing_id:String(offer.supplier_listing_id),
      selling_mode:offer.selling_mode||'MULTI_BUYER',
      total_stock:String(offer.total_stock),
      discounted_unit_price:String(offer.discounted_unit_price),
      original_unit_price:offer.original_unit_price==null?'':String(offer.original_unit_price),
      min_quantity:String(offer.min_quantity||''),
      max_quantity_per_buyer:String(offer.max_quantity_per_buyer||''),
      delivery_fee:String(offer.delivery_fee||'0'),
      clearance_reason:offer.clearance_reason||'',
      condition_notes:offer.condition_notes||'',
      best_before_date:offer.best_before_date?String(offer.best_before_date).slice(0,10):'',
      duration_value:String(durationValue),duration_unit:durationUnit
    });
    setCreating(true);
  };
  const cancelOffer = async offer => {
    if(!window.confirm('Cancel this Flash offer? Active buyer checkout/payment obligations cannot be cancelled.'))return;
    setBusy(true);
    try{
      await api(`/api/v1/flash-pools/${offer.id}/cancel`,token,{method:'POST',body:'{}'});
      toast.success('Flash offer safely cancelled.');await load();
    }catch(err){toast.error(err.message);}finally{setBusy(false);}
  };
  const expireOffer = async offer => {
    setBusy(true);
    try{
      await api(`/api/v1/flash-pools/${offer.id}/expire`,token,{method:'POST',body:'{}'});
      toast.success('Expired Flash inventory reconciled.');await load();
    }catch(err){toast.error(err.message);}finally{setBusy(false);}
  };
  const create = async e => {
    e.preventDefault();
    if(!isSupplier || !token)return toast.error('Verified suppliers only');
    const duration=Number(form.duration_value);
    if(!Number.isFinite(duration)||duration<=0||!durationFactors[form.duration_unit])return toast.error('Enter a valid duration');
    const milliseconds=duration*durationFactors[form.duration_unit];
    if(!Number.isFinite(milliseconds)||milliseconds<60001 || Date.now()+milliseconds>Date.UTC(9999,11,31))
      return toast.error('Choose an expiry more than one minute in the future');
    if(!selectedListing)return toast.error('Select an active published supplier SKU listing');
    setBusy(true);
    try {
      await api(editingDraft?`/api/v1/flash-pools/${editingDraft}`:'/api/v1/flash-pools',token,{
        method:editingDraft?'PUT':'POST',
        body:JSON.stringify({
          supplier_listing_id:Number(form.supplier_listing_id),
          supplier_sku_id:selectedListing.supplier_sku_id,
          selling_mode:form.selling_mode,
          total_stock:form.total_stock,
          discounted_unit_price:form.discounted_unit_price,
          original_unit_price:form.original_unit_price || null,
          ...(form.selling_mode==='MULTI_BUYER'?{
            min_quantity:form.min_quantity || null,
            max_quantity_per_buyer:form.max_quantity_per_buyer || null
          }:{}),
          delivery_fee:form.delivery_fee,
          duration_minutes:Math.ceil(milliseconds/60000),
          expiry_time:new Date(Date.now()+milliseconds).toISOString(),
          best_before_date:form.best_before_date||null,
          clearance_reason:form.clearance_reason,
          condition_notes:form.condition_notes
        })
      });
      toast.success(editingDraft?'Flash draft updated.':'Flash draft saved. Review and publish it below.');
      setForm(initial);setCreating(false);setEditingDraft(null);await load();
    }catch(err){toast.error(err.message);}finally{setBusy(false);}
  };
  const publish = async offer => {
    if(!window.confirm('Publish this Flash offer and allocate its stock? Published pricing and terms will be locked.'))return;
    setBusy(true);
    try {
      await api(`/api/v1/flash-pools/${offer.id}/publish`,token,{method:'POST',body:'{}'});
      toast.success('Flash offer published. Inventory allocation committed.');
      await load();
    }catch(err){toast.error(err.message);}finally{setBusy(false);}
  };
  const buy = async e => {
    e.preventDefault();
    if(!isBuyer || !token)return toast.error('Sign in as a verified B2B buyer');
    if(!selected)return;
    const quantity=selected.selling_mode==='WHOLE_LOT'
      ? String(selected.total_stock):buyerQuantity;
    if(!quantity || !deliveryAddress.trim())return toast.error('Quantity and delivery address required');
    setBusy(true);
    try {
      const holdKey=`flash-${selected.id}-${crypto.randomUUID()}`;
      const data=await api(`/api/v1/flash-pools/${selected.id}/hold`,token,{
        method:'POST',
        headers:{'X-Idempotency-Key':holdKey},
        body:JSON.stringify({quantity,delivery_address:deliveryAddress.trim()})
      });
      const order=data.hold;
      const checkout=await api(`/api/v1/orders/${order.order_id}/checkout`,token,{
        method:'POST',headers:{'X-Idempotency-Key':`flash-checkout-${order.order_id}`},
        body:JSON.stringify({})
      });
      toast.info('Safepay checkout created. Only verified payment will confirm your order.');
      const link=checkout.checkout_url;
      if(typeof link==='string' && link.startsWith('https://')) {
        window.location.assign(link);
      } else {
        toast.info(`Order ${order.order_code} created. Open My Orders to finish checkout.`);
        setSelected(null);await load();
      }
    }catch(err) {toast.error(err.message);}
    finally {setBusy(false);}
  };

  return <AppShell>
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <header className="rounded-3xl border border-amber-500/20 bg-gradient-to-r from-amber-500/10 to-transparent p-6">
        <div className="flex items-center gap-2 text-amber-600 text-sm font-bold"><Zap size={18}/> READY-STOCK CLEARANCE</div>
        <h1 className="font-serif text-2xl font-bold text-[var(--text-primary)] mt-2">Flash Pools</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">Supplier-controlled duration, genuine stock, fixed flash price and immediate buyer checkout. No collective target waiting.</p>
      </header>

      {isSupplier && <section className="border rounded-2xl p-4 space-y-3 border-[var(--border-subtle)]">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-[var(--text-primary)]">My Flash Offers</h2>
          <button onClick={()=>{setCreating(v=>!v);setEditingDraft(null);setForm(initial);}} className="rounded-xl px-3 py-2 bg-[var(--brand-accent)] text-xs font-semibold text-stone-900 flex items-center gap-1"><Plus size={15}/> New Flash Offer</button>
        </div>
        {creating && <form onSubmit={create} className="grid grid-cols-1 md:grid-cols-2 gap-3 border rounded-xl p-4 border-[var(--border-subtle)]">
          <label className="text-xs">Published SKU Listing *
            <select required value={form.supplier_listing_id} onChange={e=>update('supplier_listing_id',e.target.value)}
              className="block w-full p-2 border rounded-lg bg-[var(--bg-surface)]">
              <option value="">Select active offer</option>
              {listings.map(l=><option key={l.id} value={l.id}>{l.listing_code} — {l.product_title||l.spec_title||'Supplier SKU'} (#{l.id})</option>)}
            </select>
          </label>
          <label className="text-xs">Selling mode *
            <select value={form.selling_mode} onChange={e=>update('selling_mode',e.target.value)}
              className="block w-full p-2 border rounded-lg bg-[var(--bg-surface)]">
              <option value="MULTI_BUYER">Multiple buyers</option>
              <option value="WHOLE_LOT">One buyer buys entire lot</option>
            </select>
          </label>
          <label className="text-xs">Total available flash stock *
            <input required type="number" min="0.01" step="0.01" value={form.total_stock} onChange={e=>update('total_stock',e.target.value)}
              className="block w-full p-2 border rounded-lg bg-[var(--bg-surface)]"/>
          </label>
          <label className="text-xs">Flash price per unit (PKR) *
            <input required type="number" min="0.01" step="0.01" value={form.discounted_unit_price} onChange={e=>update('discounted_unit_price',e.target.value)}
              className="block w-full p-2 border rounded-lg bg-[var(--bg-surface)]"/>
          </label>
          <label className="text-xs">Truthful comparison price (optional)
            <input type="number" min="0.01" step="0.01" value={form.original_unit_price} onChange={e=>update('original_unit_price',e.target.value)}
              className="block w-full p-2 border rounded-lg bg-[var(--bg-surface)]"/>
          </label>
          <label className="text-xs">Fixed delivery fee (PKR)
            <input type="number" min="0" step="0.01" value={form.delivery_fee} onChange={e=>update('delivery_fee',e.target.value)}
              className="block w-full p-2 border rounded-lg bg-[var(--bg-surface)]"/>
          </label>
          {form.selling_mode==='MULTI_BUYER' ? <>
            <label className="text-xs">Minimum purchase (optional; default 1 unit)
              <input type="number" min="0.01" step="0.01" value={form.min_quantity} onChange={e=>update('min_quantity',e.target.value)}
                className="block w-full p-2 border rounded-lg bg-[var(--bg-surface)]"/>
            </label>
            <label className="text-xs">Maximum per buyer (optional)
              <input type="number" min="0.01" step="0.01" value={form.max_quantity_per_buyer} onChange={e=>update('max_quantity_per_buyer',e.target.value)}
                className="block w-full p-2 border rounded-lg bg-[var(--bg-surface)]"/>
            </label>
          </> : <div className="rounded-lg p-3 bg-amber-500/10 text-xs">Whole Lot mode: One buyer must buy all listed units in one transaction. No separate minimum/maximum field.</div>}
          <div className="flex gap-2">
            <label className="text-xs flex-1">Sale duration *
              <input required type="number" min="0.0001" step="any" placeholder="e.g. 15 or 1" value={form.duration_value} onChange={e=>update('duration_value',e.target.value)}
                className="block w-full p-2 border rounded-lg bg-[var(--bg-surface)]"/>
            </label>
            <label className="text-xs flex-1">Unit
              <select value={form.duration_unit} onChange={e=>update('duration_unit',e.target.value)}
                className="block w-full p-2 border rounded-lg bg-[var(--bg-surface)]">
                <option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option>
              </select>
            </label>
          </div>
          <label className="text-xs">Clearance reason *
            <input required maxLength={255} value={form.clearance_reason} onChange={e=>update('clearance_reason',e.target.value)}
              className="block w-full p-2 border rounded-lg bg-[var(--bg-surface)]"/>
          </label>
          <label className="text-xs">Best-before date (required for near-expiry clearance)
            <input type="date" value={form.best_before_date} onChange={e=>update('best_before_date',e.target.value)}
              className="block w-full p-2 border rounded-lg bg-[var(--bg-surface)]"/>
          </label>
          <label className="text-xs md:col-span-2">Product condition / best-before details (if applicable)
            <textarea rows={2} maxLength={2000} value={form.condition_notes} onChange={e=>update('condition_notes',e.target.value)}
              className="block w-full p-2 border rounded-lg bg-[var(--bg-surface)]"/>
          </label>
          <button disabled={busy} className="rounded-xl px-4 py-2 text-sm bg-[var(--brand-accent)] text-stone-900 md:col-span-2">{busy?'Saving draft...':editingDraft?'Save Draft Changes':'Save Flash Draft'}</button>
        </form>}
        <div className="grid gap-2">
          {mine.length===0 && <p className="text-sm text-[var(--text-secondary)]">No supplier Flash offers yet.</p>}
          {mine.map(p=><div key={p.id} className="border rounded-xl p-3 flex items-center justify-between gap-2 border-[var(--border-subtle)]">
            <div><p className="text-sm font-semibold">{p.flash_code} · {p.status}</p>
              <p className="text-xs text-[var(--text-secondary)]">{p.selling_mode==='WHOLE_LOT'?'Whole lot only':'Multiple buyers'} · {p.total_stock} units · PKR {money(p.discounted_unit_price)}</p>
              {p.status==='DRAFT'?
                <p className="text-xs text-[var(--text-secondary)]">Timer begins on publishing · {p.configured_duration_minutes} min configured</p>:
                <CountdownTimer compact deadline={p.expiry_at_utc} label="Ends in"/>}
            </div>
            <div className="flex gap-2 flex-wrap">
              {p.status==='DRAFT'&&<>
                <button disabled={busy} onClick={()=>beginEditDraft(p)} className="text-xs rounded-lg border px-3 py-2">Edit</button>
                <button disabled={busy} onClick={()=>publish(p)} className="text-xs font-semibold rounded-lg border px-3 py-2">Publish</button>
              </>}
              {['DRAFT','ACTIVE'].includes(p.status)&&<button disabled={busy} onClick={()=>cancelOffer(p)} className="text-xs rounded-lg border px-3 py-2">Cancel</button>}
              {['ACTIVE','SOLD_OUT'].includes(p.status)&&Number.isFinite(Date.parse(p.expiry_at_utc))&&Date.parse(p.expiry_at_utc)<=now&&
                <button disabled={busy} onClick={()=>expireOffer(p)} className="text-xs rounded-lg border px-3 py-2">Reconcile Expiry</button>}
            </div>
          </div>)}
        </div>
      </section>}

      <h2 className="text-xl font-serif font-bold text-[var(--text-primary)]">Available Flash Deals</h2>
      {loading ? <div className="text-sm text-[var(--text-secondary)]">Loading offers...</div>
      : deals.length===0 ? <div className="rounded-2xl border p-8 text-center text-[var(--text-secondary)]">No active, verified ready-stock offers right now.</div>
      : <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {deals.map(p=>{
          const offerExpired=Number.isFinite(Date.parse(p.expiry_at_utc)) && Date.parse(p.expiry_at_utc)<=now;
          const isWhole=p.selling_mode==='WHOLE_LOT';
          const hasDiscount=Number(p.original_unit_price)>Number(p.discounted_unit_price);
          return <article key={p.id} className="rounded-2xl border p-5 space-y-3 border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <div className="flex justify-between items-center text-xs font-semibold">
              <span className="text-amber-600 flex items-center gap-1"><Zap size={14}/> Flash · {p.flash_code}</span>
              {isWhole&&<span className="rounded-full bg-amber-500/10 px-2 py-1">WHOLE LOT</span>}
            </div>
            <h3 className="font-serif font-bold text-lg">{p.sku_title||'Supplier physical SKU'}</h3>
            <p className="text-xs text-[var(--text-secondary)]"><ShieldCheck size={13} className="inline"/> {p.supplier_name} · {p.pack_size} {p.pack_unit} / {p.purchasing_unit}</p>
            <div className="flex items-center gap-2">
              <strong className="text-xl">Rs {money(p.discounted_unit_price)}</strong>
              {hasDiscount&&<span className="line-through text-xs text-[var(--text-secondary)]">Rs {money(p.original_unit_price)}</span>}
            </div>
            <div className="text-sm"><CountdownTimer deadline={p.expiry_at_utc} serverTime={serverTime} label="Time left"/></div>
            <p className="text-xs">{p.remaining_stock} units available · {isWhole?'Buy entire lot':`Min ${p.min_quantity} units`}</p>
            <p className="text-xs text-[var(--text-secondary)]">{p.clearance_reason}</p>
            {p.condition_notes&&<p className="text-xs text-[var(--text-secondary)]">Condition: {p.condition_notes}</p>}
            <button disabled={!isBuyer||offerExpired||Number(p.remaining_stock)<=0}
              onClick={()=>{setSelected(p);setBuyerQuantity(isWhole?String(p.total_stock):String(p.min_quantity));}}
              className="w-full rounded-xl px-4 py-2.5 bg-[var(--brand-accent)] text-stone-900 font-semibold text-sm disabled:opacity-50">
              <ShoppingCart size={15} className="inline mr-1"/> {isWhole?'Buy Entire Lot':'Reserve & Checkout'}
            </button>
            {!isBuyer&&<p className="text-xs text-[var(--text-secondary)]">Verified buyer login required for checkout.</p>}
          </article>;
        })}
      </div>}

      {selected&&<div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
        <form onSubmit={buy} className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-5 w-full max-w-md space-y-3">
          <div className="flex items-center gap-2 font-bold"><LockKeyhole size={17}/> Secure Flash Checkout</div>
          <p className="text-xs">{selected.sku_title} · PKR {money(selected.discounted_unit_price)} per unit</p>
          {selected.selling_mode==='WHOLE_LOT'?
            <p className="rounded-lg bg-amber-500/10 p-3 text-sm">Whole Lot: {selected.total_stock} units must be purchased together.</p>:
            <label className="block text-xs">Quantity (minimum {selected.min_quantity})
              <input required type="number" min={selected.min_quantity} max={selected.remaining_stock}
                step="1" value={buyerQuantity} onChange={e=>setBuyerQuantity(e.target.value)}
                className="block p-2 border rounded-lg w-full bg-[var(--bg-card)]"/>
            </label>}
          <label className="block text-xs">Delivery address
            <textarea required value={deliveryAddress} onChange={e=>setDeliveryAddress(e.target.value)}
              className="block w-full p-2 rounded-lg border bg-[var(--bg-card)]" rows={2}/>
          </label>
          <p className="text-xs text-[var(--text-secondary)]">A 15-minute checkout hold is created. Your order becomes paid only after Safepay server verification. Applicable buyer and delivery fees are shown in checkout.</p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={()=>setSelected(null)} className="flex-1 rounded-xl border p-2">Cancel</button>
            <button disabled={busy} className="flex-1 rounded-xl p-2 bg-[var(--brand-accent)] text-stone-900">{busy?'Processing...':'Proceed to Safepay'}</button>
          </div>
        </form>
      </div>}
    </div>
  </AppShell>;
};
