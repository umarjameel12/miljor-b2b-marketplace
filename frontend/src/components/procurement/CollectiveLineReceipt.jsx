import React,{useEffect,useState} from 'react';
import apiClient from '../../api/client';

export function CollectiveLineReceipt({orderId}){
 const [contract,setContract]=useState(null),[quantities,setQuantities]=useState({});
 const [receipt,setReceipt]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [refunds,setRefunds]=useState([]),[refundBusy,setRefundBusy]=useState(null);
 useEffect(()=>{
  let alive=true;
  Promise.all([
   apiClient.get(`/procurement/collectives/orders/${orderId}/lines`),
   apiClient.get(`/procurement/collectives/orders/${orderId}/receipt`)
    .then(r=>r.data.data).catch(e=>e.response?.status===404?null:Promise.reject(e))
  ]).then(([response,prior])=>{
   if(!alive)return;
   const data=response.data.data;
   setContract(data);setReceipt(prior);
   if(prior?.status==='EXCEPTION'){
     apiClient.get('/settlements/refunds/my',{params:{order_id:orderId}})
       .then(res=>{if(alive)setRefunds(res.data?.data?.refunds||res.data?.data?.items||[]);})
       .catch(()=>{});
   }
   setQuantities(Object.fromEntries((data.lines||[]).map(l=>[l.line_id,String(l.ordered_quantity)])));
  }).catch(e=>{if(alive)setError(e.response?.data?.error?.message||'Could not load receipt contract');});
  return()=>{alive=false};
 },[orderId]);
 async function requestRefund(line){
  if(!line?.dispute||refundBusy)return;
  setRefundBusy(line.collective_order_line_id);setError('');
  try{
   await apiClient.post('/settlements/refunds/assess',{
     order_id:orderId,dispute_id:line.dispute.dispute_id,
     disputed_quantity:String(line.dispute.disputed_quantity),
     refund_type:'PARTIAL',
     reason:'Buyer-confirmed collective SKU shortage on receipt '+receipt.id
   },{headers:{'X-Idempotency-Key':'collective-refund-'+crypto.randomUUID()}});
   const response=await apiClient.get('/settlements/refunds/my',{params:{order_id:orderId}});
   setRefunds(response.data?.data?.refunds||response.data?.data?.items||[]);
  }catch(e){setError(e.response?.data?.error?.message||'Cannot assess refund');}
  finally{setRefundBusy(null);}
 }
 async function submit(){
  if(busy||!contract?.lines?.length)return;
  setBusy(true);setError('');
  try{
   const lines=contract.lines.map(l=>({line_id:l.line_id,received_quantity:quantities[l.line_id]}));
   const result=await apiClient.post(`/procurement/collectives/orders/${orderId}/receipt`,
     {lines},{headers:{'X-Idempotency-Key':'group-receipt-'+crypto.randomUUID()}});
   setReceipt(result.data.data);
  }catch(e){setError(e.response?.data?.error?.message||'Receipt could not be submitted');}
  finally{setBusy(false);}
 }
 if(contract?.fulfillment_status!=='SUPPLIER_DELIVERED'&&!receipt)return null;
 return <section aria-label="Own itemized delivery receipt" className="rounded-xl border border-[var(--border-subtle)] p-3 space-y-3">
  <h5 className="text-sm font-semibold">Confirm your actual received quantities</h5>
  <p className="text-xs text-[var(--text-muted)]">Record each SKU independently. A short delivery is held for dispute and refund assessment, not automatically settled.</p>
  {error&&<p role="alert" className="text-xs text-red-600">{error}</p>}
  {receipt?<div className="space-y-3">
    <p role="status" className="text-xs">Receipt {receipt.status} · Shortfall PKR {receipt.shortage_value}. No automatic refund or supplier payout.</p>
    {receipt.status==='EXCEPTION'&&(receipt.lines||[]).filter(l=>l.dispute).map(line=>{
      const claimed=line.dispute;
      const assessed=refunds.some(r=>Number(r.dispute_id)===Number(claimed.dispute_id));
      return <div key={line.collective_order_line_id}
        className="rounded-lg border border-[var(--border-subtle)] p-3 space-y-2 text-xs">
        <p>SKU line #{line.collective_order_line_id} · Short {line.shortage_quantity} {line.unit}</p>
        <p>Verified dispute #{claimed.dispute_id} · Claim PKR {claimed.claimed_amount}</p>
        <button type="button" disabled={refundBusy!==null||assessed}
          onClick={()=>requestRefund(line)}
          className="rounded-lg border border-[var(--border-subtle)] px-3 py-2 font-semibold">
          {assessed?'Refund assessment already requested':refundBusy===line.collective_order_line_id?'Requesting…':'Request exact refund assessment'}
        </button>
      </div>;
    })}
    <p className="text-xs text-[var(--text-muted)]">Refund requests require payment proof and administrative review. External refunds are not executed automatically.</p>
  </div>:
   <>
    {(contract?.lines||[]).map(line=><label className="block text-xs" key={line.line_id}>
      SKU #{line.supplier_sku_id} · Ordered {line.ordered_quantity} {line.unit}
      <input className="mt-1 block w-full rounded-lg border border-[var(--border-subtle)] p-2 bg-[var(--bg-surface)]"
        inputMode="decimal" value={quantities[line.line_id]??''}
        onChange={e=>setQuantities(v=>({...v,[line.line_id]:e.target.value}))}/>
    </label>)}
    <button type="button" onClick={submit} disabled={busy||!contract?.lines?.length}
      className="rounded-xl bg-[var(--brand-accent)] px-4 py-2 text-xs font-semibold text-stone-900 disabled:opacity-50">
      {busy?'Recording…':'Confirm exact received quantities'}
    </button>
   </>}
 </section>;
}
