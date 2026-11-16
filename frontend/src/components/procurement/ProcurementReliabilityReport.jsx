import React,{useEffect,useState} from 'react';
import apiClient from '../../api/client';
import {useAuth} from '../../context/AuthContext';

export function ProcurementReliabilityReport(){
  const {user}=useAuth();
  const [result,setResult]=useState(null);
  const [revision,setRevision]=useState(0);
  const userId=user?.id,role=user?.role;
  const allowed=Boolean(userId&&['BUYER','SUPPLIER'].includes(role));
  const requestKey=JSON.stringify([userId,role,revision]);
  const state=!allowed?{report:null,error:'Sign in as a buyer or supplier to view your report.',loading:false}:
    result?.key===requestKey?result:{report:null,error:'',loading:true};
  useEffect(()=>{
    const controller=new AbortController();
    if(!allowed)return ()=>controller.abort();
    apiClient.get('/procurement/reports/reliability',{signal:controller.signal})
      .then(response=>{
        if(!response.data?.success)throw Error('Report was not confirmed.');
        if(!controller.signal.aborted)setResult({key:requestKey,report:response.data.data,error:'',loading:false});
      })
      .catch(error=>{
        if(!controller.signal.aborted)setResult({key:requestKey,report:null,error:error.response?.data?.error?.message||'Report unavailable. Please retry.',loading:false});
      });
    return ()=>controller.abort();
  },[allowed,requestKey]);
  const report=state.report,r=report?.reliability;
  return <section aria-label="Procurement reliability report" aria-busy={state.loading} className="space-y-3 rounded-xl border border-[var(--border-subtle)] p-4 bg-[var(--bg-surface)]">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="font-semibold">Procurement reliability</h3>
      <button type="button" className="text-sm underline" disabled={state.loading} onClick={()=>setRevision(value=>value+1)}>Refresh report</button>
    </div>
    {state.loading&&<p role="status" className="text-sm">Loading your recorded procurement outcomes…</p>}
    {state.error&&<p role="alert" className="text-sm">{state.error}</p>}
    {report&&<>
      <p className="text-sm">{report.scope==='OWN_BUYER_ORDERS'?'Your purchases':'Your supplier orders'} · All recorded procurement orders · {r.total_orders} orders</p>
      <p className="text-sm"><strong>{r.on_time_percent==null?'On-time rate unavailable':`${r.on_time_percent}% on time`}</strong> · {r.on_time} of {r.denominator} eligible orders</p>
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        {Object.entries({Early:r.early,Late:r.late,Partial:r.partial,Missed:r.missed,Cancelled:r.cancelled,Pending:r.pending,'Unclassified (no window)':r.unscorable,Unpaid:r.unpaid,'Other exceptions':r.exceptions}).map(([label,value])=><div key={label}><dt>{label}</dt><dd className="font-semibold">{value}</dd></div>)}
      </dl>
      <p className="text-sm">Recorded savings: unavailable. {report.savings.reason}</p>
      <details className="text-sm">
        <summary className="cursor-pointer underline">How this report is calculated</summary>
        <div className="mt-2 space-y-2">{Object.entries(report.methodology).map(([key,value])=><p key={key}>{value}</p>)}
          <p>{report.evidence.award_lines} recorded award lines · {report.evidence.orders_with_invoice} orders with an existing invoice.</p>
        </div>
      </details>
      <p className="text-xs">As of {new Date(report.as_of).toLocaleString()}</p>
    </>}
  </section>;
}
export default ProcurementReliabilityReport;
