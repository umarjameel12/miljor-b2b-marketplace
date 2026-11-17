import React, { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, LockKeyhole, ReceiptText, ShieldCheck } from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { useAuth } from '../context/AuthContext';
import apiClient from '../api/client';

// Internal finance read-only diagnostic. No refund, disbursement or bank action.
const ROLES = new Set(['ADMIN', 'SUPER_ADMIN', 'FINANCE_ADMIN']);
export function AdminFinancePage() {
  const { isAuthenticated, user } = useAuth();
  const [refundId, setRefundId] = useState('');
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  if (!isAuthenticated) return <Navigate to="/login" replace state={{from:{pathname:'/admin/finance'}}} />;
  if (!ROLES.has(user?.role)) return (
    <AppShell><main className="mx-auto max-w-2xl p-8">
      <div className="rounded-2xl border p-7 space-y-3" style={{background:'var(--bg-surface)',borderColor:'var(--border-subtle)'}}>
        <LockKeyhole className="h-8 w-8" style={{color:'var(--brand-accent)'}} />
        <h1 className="text-xl font-bold">Finance authorization required</h1>
        <p className="text-sm opacity-70">Only approved finance administrators may inspect refund readiness.</p>
        <Link to="/admin" className="text-sm font-semibold underline">Return to administration</Link>
      </div>
    </main></AppShell>
  );
  const check=async event=>{
    event.preventDefault();
    setReport(null);setError('');
    if(!/^[1-9]\d{0,14}$/.test(refundId)){
      setError('Enter a valid positive refund obligation ID.');return;
    }
    setLoading(true);
    try{
      const response=await apiClient.get(`/settlements/refunds/${refundId}/provider-readiness`);
      const result=response?.data?.data;
      if(!result)throw Error('No financial readiness data returned');
      setReport(result);
    }catch(err){
      setError(err.response?.data?.error?.message||err.message||'Unable to assess refund readiness.');
    }finally{setLoading(false);}
  };
  return <AppShell><main className="mx-auto max-w-4xl p-5 sm:p-8 space-y-6">
    <Link to="/admin" className="inline-flex items-center gap-2 text-sm opacity-80 hover:opacity-100">
      <ArrowLeft className="h-4 w-4" /> Administration
    </Link>
    <header className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider" style={{color:'var(--brand-accent)'}}>
        <ShieldCheck className="h-4 w-4" /> Internal finance / Safepay Sandbox
      </div>
      <h1 className="text-2xl sm:text-3xl font-bold">Refund readiness review</h1>
      <p className="text-sm opacity-75">Inspect an individual buyer's refund obligation and captured payment boundaries. This view never issues money movement.</p>
    </header>
    <section className="rounded-2xl border p-5 sm:p-6 space-y-4" style={{background:'var(--bg-surface)',borderColor:'var(--border-subtle)'}}>
      <form onSubmit={check} className="flex flex-col sm:flex-row gap-3 sm:items-end">
        <label className="flex-1 text-sm font-semibold space-y-2">
          <span>Refund obligation ID</span>
          <input value={refundId} onChange={event=>setRefundId(event.target.value.trim())} inputMode="numeric"
            autoComplete="off" className="block w-full rounded-xl border p-3 bg-transparent font-normal"
            style={{borderColor:'var(--border-subtle)'}} placeholder="e.g. 102" aria-label="Refund obligation ID" />
        </label>
        <button type="submit" disabled={loading} className="rounded-xl px-5 py-3 text-sm font-bold disabled:opacity-50"
          style={{background:'var(--brand-accent)',color:'var(--text-on-champagne)'}}>
          {loading?'Checking…':'Check readiness'}
        </button>
      </form>
      {error&&<p role="alert" className="text-sm text-red-600 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" />{error}</p>}
      {report&&<div className="border-t pt-5 space-y-4" style={{borderColor:'var(--border-subtle)'}}>
        <div className="flex gap-3 items-start">
          <ReceiptText className="h-6 w-6 shrink-0" style={{color:'var(--brand-accent)'}} />
          <div>
            <h2 className="font-bold">Refund #{report.refund_id} · Order #{report.order_id}</h2>
            <p className="text-sm opacity-75">Internal financial check: <strong>{report.internal_financial_check}</strong></p>
          </div>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div><dt className="opacity-60">Approved/requested amount</dt><dd className="font-bold">PKR {report.requested_amount_pkr}</dd></div>
          <div><dt className="opacity-60">Safepay v3 minor-unit preview</dt><dd className="font-bold">{report.v3_refund_amount_minor_preview} paisa</dd></div>
          <div><dt className="opacity-60">Provider action to review</dt><dd className="font-semibold">{report.recommended_provider_action?.replaceAll('_',' ')}</dd></div>
          <div><dt className="opacity-60">External execution</dt><dd className="font-bold">{report.external_execution_status}</dd></div>
        </dl>
        {report.blocking_reasons?.length>0&&<div>
          <p className="text-sm font-bold mb-2">Blocking conditions</p>
          <ul className="list-disc pl-5 text-sm space-y-1">
            {report.blocking_reasons.map(reason=><li key={reason}>{reason.replaceAll('_',' ')}</li>)}
          </ul>
        </div>}
        <p className="text-xs opacity-75 border-t pt-4" style={{borderColor:'var(--border-subtle)'}}>
          No external refund or supplier payout can be executed here. Genuine Safepay provider verification and a supported refund gateway are still required before financial completion.
        </p>
      </div>}
    </section>
  </main></AppShell>;
}
export default AdminFinancePage;
