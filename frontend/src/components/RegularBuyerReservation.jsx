import React,{useState} from 'react';
import {Link,useNavigate} from 'react-router-dom';
import apiClient from '../api/client';
import {useAuth} from '../context/AuthContext';
// B4-specific buyer reservation. Never creates an order/payment or impersonates buyer consent.
export function RegularBuyerReservation({pool,onClose,onComplete}){
 const {isAuthenticated,user}=useAuth();
 const navigate=useNavigate();
 const [qty,setQty]=useState(String(pool.buyer_min_qty||pool.min_order_qty||1));
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [reservation,setReservation]=useState(null);
 const min=Number(pool.buyer_min_qty||pool.min_order_qty||1);
 const increment=Number(pool.purchase_increment||1);
 const quantity=Number(qty);
 const eligible=Number.isFinite(quantity)&&quantity>=min&&Number.isFinite(increment)&&increment>0&&
   Math.abs((quantity-min)/increment-Math.round((quantity-min)/increment))<0.000001;
 const reserve=async()=>{
   if(!isAuthenticated){navigate('/login?redirect=/pools');return;}
   if(user?.role!=='BUYER'){setError('Only buyer accounts may reserve quantities in Regular Pools.');return;}
   if(!eligible){setError('Quantity does not satisfy the supplier minimum and purchasing increment.');return;}
   setBusy(true);setError('');
   try{
     const key=`b4-reserve-${pool.id}-${Date.now()}-${Math.random().toString(36).slice(2,12)}`;
     const r=await apiClient.post('/reservations',{pool_id:Number(pool.id),quantity:qty},
       {headers:{'X-Idempotency-Key':key}});
     const value=r.data?.data?.reservation;
     if(!value?.id)throw Error('Reservation status is uncertain. Refresh My Reservations before trying again.');
     setReservation(value);
     onComplete?.();
   }catch(e){setError(e.response?.data?.error?.message||e.message||'Reservation rejected by the Regular Pool engine.');}
   finally{setBusy(false);}
 };
 return <div role="dialog" aria-modal="true" aria-label="Join Regular Pool" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
  <div className="w-full max-w-md rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] p-5 space-y-4">
   <header><p className="text-xs font-semibold text-emerald-600">Regular Pool · B4</p>
    <h2 className="text-lg font-bold">Join {pool.product_name||pool.title||pool.pool_code}</h2>
    <p className="text-xs text-[var(--text-muted)]">This is a demand reservation. Final unit price, buyer commitment and Safepay checkout follow the authoritative B4 milestones.</p>
   </header>
   {!reservation?<><label className="block text-xs space-y-1"><span>Quantity ({pool.pool_unit||'unit'}) · Minimum {min}</span>
    <input type="number" min={min} step={increment} value={qty}
      onChange={e=>setQty(e.target.value)}
      className="w-full rounded-xl border p-3 bg-[var(--bg-elevated)] border-[var(--border-subtle)]"/>
   </label>
   <p className="text-xs text-[var(--text-muted)]">Participation cutoff: {pool.scheduled_close_at||pool.expires_at?new Date(pool.scheduled_close_at||pool.expires_at).toLocaleString('en-PK',{timeZone:'Asia/Karachi'}):'Unavailable'}</p>
   <div className="flex justify-end gap-2">
    <button onClick={onClose} disabled={busy} className="border px-4 py-2 rounded-xl text-xs">Cancel</button>
    <button onClick={reserve} disabled={busy||!eligible} className="bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs disabled:opacity-50">{busy?'Submitting…':'Reserve quantity'}</button>
   </div></>:<div className="space-y-3"><p className="text-sm font-semibold text-emerald-600">Reservation created: {reservation.reservation_code||reservation.id}</p>
    <p className="text-xs text-[var(--text-muted)]">Your reservation is not a paid order. Follow final pricing and confirmation in My Reservations.</p>
    <div className="flex gap-2"><Link to="/orders" className="bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs">My Orders</Link>
      <button onClick={onClose} className="border px-4 py-2 rounded-xl text-xs">Close</button></div>
   </div>}
   {error&&<p role="alert" className="text-xs text-red-600">{error}</p>}
  </div>
 </div>;
}
export default RegularBuyerReservation;
