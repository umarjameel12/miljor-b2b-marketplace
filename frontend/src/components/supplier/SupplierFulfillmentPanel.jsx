import React,{useEffect,useRef,useState} from 'react';
import {useAuth} from '../../context/AuthContext';
import {ProcurementOrderOperations} from '../procurement/ProcurementOrderOperations';
import {supplierFulfillmentApi,nextSupplierMilestone,supplierDeliveryMethods,createSupplierIntentStore} from '../../api/supplierFulfillment';
import {SupplierDeliveryManifestPanel} from './SupplierDeliveryManifestPanel';
const labels={PREPARING:'Start preparation',READY_FOR_DISPATCH:'Mark ready for dispatch',DISPATCHED:'Record dispatch / pickup handoff',SUPPLIER_DELIVERED:'Report delivered / collected'};
export function SupplierFulfillmentPanel(){
  const {user}=useAuth();
  const [page,setPage]=useState(1),[orders,setOrders]=useState([]),[pagination,setPagination]=useState(null),[selected,setSelected]=useState(null);
  const [loading,setLoading]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [method,setMethod]=useState(''),[reference,setReference]=useState(''),[notes,setNotes]=useState('');
  const [reason,setReason]=useState('SUPPLIER_DELIVERY_DELAYED'),[description,setDescription]=useState(''),[invoice,setInvoice]=useState(null);
  const controller=useRef(null),intents=useRef(createSupplierIntentStore()),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort();};},[]);
  const load=async(signal)=>{
    setLoading(true);setError('');
    try{const result=await supplierFulfillmentApi.list({page,signal});if(alive.current&&!signal?.aborted){setOrders(result.orders);setPagination(result.pagination);}}
    catch(error){if(alive.current&&!signal?.aborted)setError(error.response?.data?.error?.message||'Unable to load the paid fulfillment queue.');}
    finally{if(alive.current&&!signal?.aborted)setLoading(false);}
  };
  useEffect(()=>{const request=new AbortController();controller.current=request;setSelected(null);load(request.signal);return()=>request.abort();},[page]);
  const open=async(order)=>{
    if(pending)return;
    setError('');setMessage('');setSelected(null);setInvoice(null);setNotes('');setReference('');setDescription('');setPending(true);
    try{
      const result=await supplierFulfillmentApi.detail(order.order_id,{signal:controller.current?.signal});
      if(alive.current){setSelected(result);setMethod(supplierDeliveryMethods(result.order)[0]);}
    }catch(error){if(alive.current)setError(error.response?.data?.error?.message||'Unable to open this order.');}
    finally{if(alive.current)setPending(false);}
  };
  const perform=async(action)=>{
    if(!selected||pending)return;
    const order=selected.order,next=nextSupplierMilestone(order);
    const body=action==='exception'?{reason,description:description.trim()}:{to_status:next,
      ...(next==='DISPATCHED'?{delivery_method:method,supplier_delivery_reference:reference.trim()}:{}),...(notes.trim()?{notes:notes.trim()}:{})};
    if(action==='transition'&&!next)return;
    if(action==='exception'&&!body.description){setError('Describe the actual fulfillment issue before submitting.');return;}
    const key=intents.current.get(user.id,order.order_id,action,body);
    setPending(true);setError('');setMessage('');
    try{
      await supplierFulfillmentApi[action](order.order_id,body,key,{signal:controller.current?.signal});
      const refreshed=await supplierFulfillmentApi.detail(order.order_id,{signal:controller.current?.signal});
      if(alive.current){setSelected(refreshed);setMessage('Backend state confirmed.');setNotes('');setDescription('');}
      await load(controller.current?.signal);
    }catch(error){if(alive.current)setError(error.response?.data?.error?.message||'The action could not be confirmed. Refresh before retrying; the same intent key is retained.');}
    finally{if(alive.current)setPending(false);}
  };
  const viewInvoice=async()=>{
    if(!selected||pending)return;setPending(true);setError('');
    try{const result=await supplierFulfillmentApi.invoice(selected.order.order_id,{signal:controller.current?.signal});if(alive.current)setInvoice(result.invoice);}
    catch(error){if(alive.current)setError(error.response?.data?.error?.message||'Invoice unavailable.');}
    finally{if(alive.current)setPending(false);}
  };
  const order=selected?.order,next=nextSupplierMilestone(order);
  return <section aria-label="Paid supplier fulfillment" className="space-y-4">
    <div className="flex justify-between gap-3"><p className="text-sm text-[var(--text-muted)]">Only verified paid orders assigned to your account can advance. Supplier delivery reporting remains separate from buyer receipt and settlement.</p>
      <button type="button" className="text-xs underline" disabled={loading||pending} onClick={()=>{setSelected(null);setMessage('');load(controller.current?.signal);}}>Refresh queue</button></div>
    {error&&<p role="alert" className="p-3 rounded-xl border border-[var(--border-subtle)]">{error}</p>}
    {message&&<p role="status">{message}</p>}
    {loading&&<p role="status">Loading paid orders…</p>}
    {!loading&&pagination&&orders.length===0&&<p>No paid orders in this queue.</p>}
    <div className="grid md:grid-cols-2 gap-3">{orders.map(item=><article key={item.order_id} className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] space-y-2">
      <p className="font-semibold">{item.order_code}</p><p className="text-xs">{item.fulfillment_status} · {item.delivery_type} · PKR {item.total_amount}</p>
      <button type="button" disabled={pending||loading} className="text-xs underline" onClick={()=>open(item)}>Manage {item.order_code}</button>
    </article>)}</div>
    {pagination&&<div className="flex gap-4 items-center text-xs"><button type="button" disabled={page<=1||pending||loading} onClick={()=>setPage(value=>value-1)}>Previous</button><span>Page {page} of {pagination.total_pages} · {pagination.total} paid orders</span><button type="button" disabled={page>=pagination.total_pages||pending||loading} onClick={()=>setPage(value=>value+1)}>Next</button></div>}
    {order&&<section aria-label="Selected fulfillment order" className="p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] space-y-4">
      <h2 className="font-serif text-lg font-semibold">{order.order_code}</h2><p className="text-sm">Confirmed state: {order.fulfillment_status}</p>
      <p className="text-xs">Destination: {order.delivery_address||'See agreed delivery terms'}</p>
      <fieldset disabled={pending||loading} className="space-y-3">
        {next==='DISPATCHED'&&<><label className="block text-xs">Delivery method<select className="block w-full p-2 rounded-lg border bg-[var(--bg-surface)]" value={method} onChange={event=>setMethod(event.target.value)}>{supplierDeliveryMethods(order).map(value=><option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></label>
          <label className="block text-xs">Dispatch / pickup reference<input value={reference} onChange={event=>setReference(event.target.value)} className="block w-full p-2 rounded-lg border bg-[var(--bg-surface)]"/></label></>}
        {next&&<><label className="block text-xs">Delivery evidence / operational notes<textarea value={notes} onChange={event=>setNotes(event.target.value)} className="block w-full p-2 rounded-lg border bg-[var(--bg-surface)]"/></label>
          <button type="button" onClick={()=>perform('transition')} className="px-3 py-2 rounded-lg text-sm bg-[var(--brand-accent)] text-[#072a21]">{labels[next]}</button></>}
        {!next&&<p className="text-xs">No supplier advancement is available in this state. Buyer receipt, dispute resolution and bank settlement require their own authorized workflows.</p>}
        {next&&<details><summary className="text-xs cursor-pointer">Report a real fulfillment issue</summary><div className="space-y-2 pt-3">
          <label className="block text-xs">Issue<select value={reason} onChange={event=>setReason(event.target.value)} className="block p-2 rounded-lg border bg-[var(--bg-surface)]">{['SUPPLIER_DELIVERY_DELAYED','SUPPLIER_LOGISTICS_FAILURE','SUPPLIER_INVENTORY_SHORTAGE'].map(value=><option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></label>
          <label className="block text-xs">Issue description<textarea value={description} onChange={event=>setDescription(event.target.value)} className="block w-full p-2 rounded-lg border bg-[var(--bg-surface)]"/></label><button type="button" className="text-xs underline" onClick={()=>perform('exception')}>Record issue for review</button>
        </div></details>}
        <button type="button" className="text-xs underline" onClick={viewInvoice}>View authoritative invoice</button>
      </fieldset>
      {invoice&&<div className="text-xs space-y-1" aria-label="Authoritative invoice"><p>{invoice.invoice_number}</p><p>Products: PKR {invoice.subtotal_amount} · Delivery: PKR {invoice.delivery_fee} · Buyer fee: PKR {invoice.buyer_platform_fee} · Tax: PKR {invoice.tax_amount}</p><p>Total: PKR {invoice.total_amount}</p></div>}
      <ProcurementOrderOperations key={`${user.id}:${order.order_id}`} orderId={order.order_id} role="SUPPLIER"/>
      <ol aria-label="Fulfillment timeline" className="text-xs space-y-1">{(selected.timeline||[]).map(event=><li key={event.id}>{event.to_status} · {event.actor_role} · {String(event.created_at)}{event.notes?` · ${event.notes}`:''}</li>)}</ol>
    </section>}
    <SupplierDeliveryManifestPanel />
  </section>;
}
