import React,{useEffect,useRef,useState} from 'react';
import apiClient from '../../api/client';
import {deliveryApi} from '../../api/delivery';
import {useAuth} from '../../context/AuthContext';

// Preferences are requests only. Existing quote/award delivery gates set real fees.
export function RecurringCycleControls({contractId,cycle,onChanged}){
 const {user}=useAuth();
 const [open,setOpen]=useState(false),[record,setRecord]=useState(null),[items,setItems]=useState([]),[mode,setMode]=useState(''),[address,setAddress]=useState('');
 const [addresses,setAddresses]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const intent=useRef(new Map()),alive=useRef(true),request=useRef(null);
 const base=`/procurement/recurring/${contractId}/cycles/${cycle.id}`;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current?.abort();};},[]);
 const load=async()=>{
  request.current?.abort();const controller=new AbortController();request.current=controller;
  setBusy(true);setError('');setMessage('');
  try{
   const response=await apiClient.get(base+'/inputs',{signal:controller.signal});
   if(!response.data?.success)throw Error('Cycle inputs were not confirmed');
   if(alive.current&&!controller.signal.aborted){
    const value=response.data.data;setRecord(value);setItems(value.items);setMode(value.delivery_preference?.mode||'');setAddress(String(value.delivery_preference?.address_id||''));setOpen(true);
   }
   try{const saved=await deliveryApi.getBuyerAddresses();if(alive.current&&!controller.signal.aborted)setAddresses(saved.data||[]);}
   catch{if(alive.current&&!controller.signal.aborted)setError('Saved addresses unavailable. Refresh before selecting doorstep delivery.');}
  }catch(error){if(alive.current&&!controller.signal.aborted)setError(error.response?.data?.error?.message||error.message||'Cycle inputs unavailable.');}
  finally{if(alive.current&&!controller.signal.aborted)setBusy(false);}
 };
 const perform=async(action)=>{
  if(busy)return;setBusy(true);setError('');setMessage('');
  const body=action==='skip'?{}:{expected_revision:record.revision,items:items.map(item=>({template_item_id:item.template_item_id,quantity:item.quantity})),delivery_preference:mode?{mode,...(mode==='PICKUP'?{}:{address_id:Number(address)})}:null};
  const signature=JSON.stringify([user.id,contractId,cycle.id,action,body]);
  if(!intent.current.has(signature))intent.current.set(signature,'cycle-'+crypto.randomUUID());
  try{
   const response=await apiClient.request({url:base+(action==='skip'?'/skip':'/inputs'),method:action==='skip'?'POST':'PUT',data:body,headers:{'X-Idempotency-Key':intent.current.get(signature)},signal:request.current?.signal});
   if(!response.data?.success)throw Error('Cycle operation was not confirmed');
   if(alive.current){
    if(action!=='skip')setRecord(response.data.data);
    setMessage(action==='skip'?'Cycle skip confirmed.':'Cycle revision saved. Delivery still needs a fresh supplier quote and your approval.');
    await onChanged();
   }
  }catch(error){if(alive.current)setError(error.response?.data?.error?.message||'Action could not be confirmed. Refresh before retrying.');}
  finally{if(alive.current)setBusy(false);}
 };
 return <div role="group" className="basis-full space-y-2 text-xs" aria-label={`Cycle ${cycle.cycle_key} controls`}>
  <button type="button" disabled={busy} onClick={load} className="underline">{open?'Reload cycle inputs':'Review cycle quantities and delivery'}</button>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  {open&&record&&<fieldset disabled={busy||cycle.status!=='SCHEDULED'} className="space-y-2 p-3 border rounded-xl border-[var(--border-subtle)]">
   <p>Saved revision {record.revision}. Only this occurrence changes; the standing template stays unchanged.</p>
   {items.map((item,index)=><label className="block" key={item.template_item_id}>Product #{item.family_id} · {item.unit}<input aria-label={`Cycle quantity for item ${item.template_item_id}`} inputMode="decimal" type="number" min="0.0001" step={['bag','tin','carton','sack','bundle','pack'].includes(item.unit)?'1':'0.0001'} value={item.quantity} onChange={event=>setItems(values=>values.map((value,i)=>i===index?{...value,quantity:event.target.value}:value))} className="block p-2 border rounded-lg bg-[var(--bg-surface)]"/></label>)}
   <label className="block">Requested delivery mode<select aria-label="Cycle delivery preference" value={mode} onChange={event=>setMode(event.target.value)} className="block p-2 border rounded-lg bg-[var(--bg-surface)]"><option value="">Choose again when quoting</option><option value="STANDARD_CLUSTERED">Clustered doorstep</option><option value="EXPRESS">Express if supplier confirms</option><option value="PICKUP">Supplier pickup after quotation</option></select></label>
   {mode&&mode!=='PICKUP'&&<label className="block">Your saved address<select aria-label="Cycle delivery address" value={address} onChange={event=>setAddress(event.target.value)} className="block p-2 border rounded-lg bg-[var(--bg-surface)]"><option value="">Choose verified address</option>{addresses.filter(value=>value.geographic_match_status==='VERIFIED').map(value=><option key={value.id} value={value.id}>{value.full_address}</option>)}</select></label>}
   <p>Preference only: stock, route, delivery fee, supplier terms and buyer payment must be approved separately for every cycle.</p>
   <div className="flex gap-4"><button type="button" disabled={Boolean(mode&&mode!=='PICKUP'&&!address)} onClick={()=>perform('save')} className="underline">Save this cycle revision</button><button type="button" onClick={()=>perform('skip')} className="underline">Skip this cycle</button></div>
  </fieldset>}
 </div>;
}
