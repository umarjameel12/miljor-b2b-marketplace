import React,{useCallback,useEffect,useState} from 'react';
import {AppShell} from '../components/layout/AppShell';
import {useAuth} from '../context/AuthContext';
import apiClient from '../api/client';
import {Package,Truck,ShieldCheck,FileText,RefreshCw,AlertTriangle} from 'lucide-react';

const msg=e=>e?.response?.data?.error?.message||e?.message||'Request unsuccessful';
const newKey=()=> 'b7-'+Date.now()+'-'+Math.random().toString(36).slice(2,14);
const paidStatus=s=>String(s||'').replaceAll('_',' ');
const nextStatus={AWAITING_SUPPLIER_ACKNOWLEDGEMENT:'PREPARING',
 PREPARING:'READY_FOR_DISPATCH',READY_FOR_DISPATCH:'DISPATCHED',
 DISPATCHED:'SUPPLIER_DELIVERED'};
export function PostPurchasePage(){
 const {user,isAuthenticated}=useAuth();
 const role=user?.role;
 const buyer=role==='BUYER',supplier=role==='SUPPLIER';
 const [orders,setOrders]=useState([]),[selected,setSelected]=useState(null);
 const [timeline,setTimeline]=useState([]),[lines,setLines]=useState([]);
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [received,setReceived]=useState({}),[description,setDescription]=useState('');
 const [invoice,setInvoice]=useState(null),[deliveryRef,setDeliveryRef]=useState('');
 const [disputes,setDisputes]=useState([]),[supplierReply,setSupplierReply]=useState('');
 const [remedyNotes,setRemedyNotes]=useState('');
 const route=buyer?'buyer':'supplier';
 const refresh=useCallback(async()=>{
  if(!buyer&&!supplier)return;
  setLoading(true);setError('');
  try{
   const [res,disputesRes]=await Promise.all([
    apiClient.get('/fulfillment/'+route+'/orders'),
    apiClient.get(buyer?'/disputes/my':'/disputes/supplier/list')
   ]);
   setOrders(res.data?.data?.orders||[]);
   setDisputes(disputesRes.data?.data?.disputes||[]);
  }catch(e){setError(msg(e))}
  finally{setLoading(false)}
 },[buyer,supplier,route]);
 useEffect(()=>{refresh()},[refresh]);
 const details=async id=>{
  setError('');setNotice('');setInvoice(null);
  try{
   const res=await apiClient.get('/fulfillment/'+route+'/orders/'+id);
   setSelected(res.data?.data?.order||null);
   setTimeline(res.data?.data?.timeline||[]);
   setLines(res.data?.data?.award_lines||[]);
   setReceived({});
  }catch(e){setError(msg(e))}
 };
 const execute=async(action,payload)=>{
  if(!selected||busy)return;
  setBusy(true);setError('');setNotice('');
  try{
   const headers={'X-Idempotency-Key':newKey()};
   let endpoint='/fulfillment/'+route+'/orders/'+selected.id;
   if(action==='advance')endpoint+='/transition';
   else if(action==='confirm')endpoint+='/confirm-receipt';
   else if(action==='dispute')endpoint='/disputes';
   const res=await apiClient.post(endpoint,payload,{headers});
   setNotice(res.data?.message||'Request accepted. Refreshing authoritative status.');
   await refresh();await details(selected.id);
  }catch(e){setError(msg(e))}
  finally{setBusy(false)}
 };
 const reportShortage=async line=>{
  const v=received[line.award_line_id];
  if(v===undefined||String(v).trim()===''){
   setError('Enter the actual received quantity before submitting.');return;
  }
  if(description.trim().length<10){
   setError('Add a description of at least 10 characters.');return;
  }
  await execute('dispute',{
   order_id:selected.id,category:'SHORT_QUANTITY',description,
   evidence_metadata:{award_line_id:line.award_line_id,received_quantity:String(v)}
  });
 };
 const actOnDispute=async(dispute,step,payload)=>{
  if(busy)return;
  setBusy(true);setError('');setNotice('');
  try{
   const id=dispute.id;
   const endpoint=step==='respond'?'/disputes/'+id+'/supplier-response':
    step==='dispatch'?'/disputes/'+id+'/remediation/declare-delivered':
    '/disputes/'+id+'/remediation/confirm-receipt';
   const res=await apiClient.post(endpoint,payload,{
    headers:{'X-Idempotency-Key':newKey()}
   });
   setNotice(res.data?.message||'Dispute action recorded.');
   await refresh();
   if(selected)await details(selected.id);
  }catch(e){setError(msg(e))}
  finally{setBusy(false)}
 };
 const loadInvoice=async()=>{
  if(!selected)return;
  setError('');
  try{
   const res=await apiClient.get('/invoices/'+selected.id);
   const data=res.data?.data||res.data;
   setInvoice(data);
  }catch(e){setError(msg(e))}
 };
 if(!isAuthenticated||(!buyer&&!supplier))return <AppShell title="Post-purchase">
  <div className="max-w-2xl mx-auto p-6">Sign in as a business buyer or supplier to view your post-purchase orders.</div>
 </AppShell>;
 return <AppShell title="Order Fulfillment">
  <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-5">
   <div className="flex flex-wrap justify-between gap-3">
    <div><h1 className="text-2xl font-bold">Post-Purchase Operations</h1>
     <p className="text-sm text-[var(--text-muted)]">{buyer?
       'Your verified paid orders, supplier delivery progress, receipt and disputes.':
       'Prepare and dispatch your assigned paid orders. Buyer receipt remains independent.'}</p></div>
    <button type="button" onClick={refresh} disabled={loading} className="rounded-xl border px-4 py-2 flex gap-2 items-center text-sm">
     <RefreshCw size={16}/>Refresh</button>
   </div>
   {error&&<div role="alert" className="rounded-xl border border-red-500 p-3 text-red-600 text-sm">{error}</div>}
   {notice&&<div role="status" className="rounded-xl border p-3 text-sm">{notice}</div>}
   <div className="grid lg:grid-cols-[minmax(250px,1fr)_minmax(0,2fr)] gap-4">
    <section className="rounded-2xl border border-[var(--border-subtle)] p-4 space-y-3">
     <h2 className="font-semibold">Paid orders</h2>
     {loading&&<p className="text-sm">Loading orders…</p>}
     {!loading&&!orders.length&&<p className="text-sm text-[var(--text-muted)]">No eligible paid orders found.</p>}
     {orders.map(o=><button type="button" key={o.id}
      onClick={()=>details(o.id)} className="block w-full text-left rounded-xl border border-[var(--border-subtle)] p-3 hover:opacity-80">
      <div className="font-semibold">{o.order_code||'#'+o.id}</div>
      <div className="text-xs mt-1">{paidStatus(o.fulfillment_status)} · PKR {o.total_amount}</div>
     </button>)}
    </section>
    <section className="rounded-2xl border border-[var(--border-subtle)] p-4 space-y-4">
     {!selected?<div className="text-sm text-[var(--text-muted)]">Select an order to see its authoritative tracking information.</div>:<>
      <div className="flex justify-between gap-2">
       <div><h2 className="font-semibold text-lg">{selected.order_code||'#'+selected.id}</h2>
        <p className="text-xs">{paidStatus(selected.fulfillment_status)} · {selected.payment_status}</p></div>
       <Package size={22}/>
      </div>
      <p className="text-sm">Order total: PKR {selected.total_amount} · Delivery fee: PKR {selected.delivery_fee}</p>
      {lines.length>0&&<div className="space-y-2">
       <h3 className="font-semibold text-sm">Accepted physical SKU lines</h3>
       {lines.map(line=><div key={line.award_line_id} className="p-3 rounded-xl border border-[var(--border-subtle)] text-sm space-y-2">
        <p>SKU #{line.supplier_sku_id} · Ordered {line.quantity} {line.purchasing_unit} · PKR {line.subtotal}</p>
        {buyer&&['DISPATCHED','SUPPLIER_DELIVERED','EXCEPTION'].includes(selected.fulfillment_status)&&
         <div className="space-y-2">
          <label className="block text-xs">Actually received ({line.purchasing_unit})
           <input type="number" min="0" step="0.0001" placeholder="Actual received quantity"
            value={received[line.award_line_id]||''} onChange={e=>setReceived(x=>({...x,[line.award_line_id]:e.target.value}))}
            className="block w-full mt-1 rounded-lg border p-2 bg-transparent"/>
          </label>
          <label className="block text-xs">Evidence description (10+ characters)
           <textarea value={description} onChange={e=>setDescription(e.target.value)}
            className="block w-full rounded-lg border p-2 bg-transparent" rows={2}/>
          </label>
          <button disabled={busy} onClick={()=>reportShortage(line)} className="border rounded-lg px-3 py-2 text-xs">
           Report missing quantity</button>
         </div>}
       </div>)}
      </div>}
      {supplier&&nextStatus[selected.fulfillment_status]&&
       <div className="space-y-2">
        {nextStatus[selected.fulfillment_status]==='DISPATCHED'&&
         <label className="block text-xs">Delivery reference (optional)
          <input value={deliveryRef} onChange={e=>setDeliveryRef(e.target.value)} className="block rounded-lg border p-2 bg-transparent mt-1"/>
         </label>}
        <button disabled={busy} onClick={()=>execute('advance',{
         to_status:nextStatus[selected.fulfillment_status],
         ...(nextStatus[selected.fulfillment_status]==='DISPATCHED'?{
           delivery_method:'SUPPLIER_FLEET',supplier_delivery_reference:deliveryRef
         }:{})
        })} className="rounded-lg bg-emerald-700 text-white px-4 py-2 text-sm flex gap-2 items-center">
         <Truck size={15}/>Move to {paidStatus(nextStatus[selected.fulfillment_status])}</button>
       </div>}
      {buyer&&selected.fulfillment_status==='SUPPLIER_DELIVERED'&&
       <button disabled={busy} onClick={()=>execute('confirm',{})}
        className="rounded-lg bg-emerald-700 text-white px-4 py-2 text-sm flex gap-2 items-center">
        <ShieldCheck size={16}/>Confirm complete receipt</button>}
      {selected.fulfillment_status==='EXCEPTION'&&
       <p className="flex gap-2 items-center text-sm text-amber-700"><AlertTriangle size={16}/>
        Delivery exception active. No automatic refund or settlement is authorized.</p>}
      <button onClick={loadInvoice} className="border rounded-lg px-4 py-2 text-sm flex gap-2 items-center">
       <FileText size={16}/>View authorized invoice</button>
      {invoice&&<pre className="overflow-auto p-3 text-xs rounded-lg bg-[var(--bg-elevated)]">
       {JSON.stringify(invoice.invoice_snapshot_json||invoice,null,2)}</pre>}
      <div className="space-y-3">
       <h3 className="font-semibold text-sm">Delivery disputes and remediation</h3>
       {!disputes.filter(d=>Number(d.order_id)===Number(selected.id)).length&&
        <p className="text-xs text-[var(--text-muted)]">No disputes recorded for this order.</p>}
       {disputes.filter(d=>Number(d.order_id)===Number(selected.id)).map(d=>
        <div className="rounded-xl border border-[var(--border-subtle)] p-3 space-y-2" key={d.id}>
         <div className="text-xs font-semibold">{d.dispute_code} · {paidStatus(d.status)}</div>
         <p className="text-xs">Reason: {paidStatus(d.dispute_category)} · Claimed PKR {d.claimed_amount}</p>
         {supplier&&['OPEN','AWAITING_SUPPLIER_RESPONSE','SUPPLIER_RESPONSE'].includes(d.status)&&
          <div className="space-y-2">
           <label className="block text-xs">Supplier response (minimum 5 characters)
            <textarea value={supplierReply} onChange={e=>setSupplierReply(e.target.value)}
             className="block mt-1 w-full rounded-lg border bg-transparent p-2" rows={2}/>
           </label>
           <button disabled={busy||supplierReply.trim().length<5}
            className="border rounded-lg px-3 py-2 text-xs"
            onClick={()=>actOnDispute(d,'respond',{
             response:supplierReply,remediation_proposal:'DELIVER_MISSING_QUANTITY',
             remediation_details:'Supplier proposes delivering the documented missing SKU quantity.'
            })}>Propose missing-quantity remediation</button>
          </div>}
         {supplier&&d.remediation_status==='PROPOSED'&&
          <div className="space-y-2">
           <label className="block text-xs">Remediation delivery reference / notes
            <input value={remedyNotes} onChange={e=>setRemedyNotes(e.target.value)}
             className="block mt-1 rounded-lg border p-2 bg-transparent w-full"/>
           </label>
           <button disabled={busy} className="border rounded-lg px-3 py-2 text-xs"
            onClick={()=>actOnDispute(d,'dispatch',{
             tracking_reference:remedyNotes||undefined,notes:'Replacement/missing quantity dispatched'
            })}>Declare remediation dispatched</button>
          </div>}
         {buyer&&d.remediation_status==='IN_PROGRESS'&&
          <button disabled={busy} className="border rounded-lg px-3 py-2 text-xs"
           onClick={()=>actOnDispute(d,'confirm',{
            notes:'I received the documented missing goods.'
           })}>Confirm remediation goods received</button>}
        </div>)}
      </div>
      <h3 className="font-semibold text-sm">Tracking history</h3>
      {timeline.length===0?<p className="text-xs text-[var(--text-muted)]">No recorded milestones yet.</p>:
       <ol className="space-y-2">{timeline.map(ev=><li key={ev.id} className="text-xs p-2 border-l-2 border-emerald-600">
        {paidStatus(ev.to_status)} · {ev.actor_role} · {String(ev.created_at)}</li>)}</ol>}
     </>}
    </section>
   </div>
  </div>
 </AppShell>;
}
export default PostPurchasePage;
