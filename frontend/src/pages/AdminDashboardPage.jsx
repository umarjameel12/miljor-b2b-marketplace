import React, { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ShieldCheck, Users, FolderCheck, RefreshCw, AlertTriangle, ArrowRight, LockKeyhole, CheckCircle2, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AppShell } from '../components/layout/AppShell';
import adminApi from '../api/admin';
import { toast } from 'react-toastify';

const VERIFIERS = ['SUPER_ADMIN', 'VERIFICATION_ADMIN', 'ADMIN'];
const ADMINS = [...VERIFIERS, 'OPERATIONS_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN'];
const CATALOG = ['SUPER_ADMIN', 'VERIFICATION_ADMIN', 'OPERATIONS_ADMIN', 'ADMIN'];
const SUB_APPROVERS = ['SUPER_ADMIN', 'OPERATIONS_ADMIN', 'FINANCE_ADMIN', 'ADMIN'];

export function AdminDashboardPage() {
  const { user, isAuthenticated } = useAuth();
  const [pending, setPending] = useState([]);
  const [pendingSubs, setPendingSubs] = useState([]);
  const [subRefunds, setSubRefunds] = useState([]);
  const [subBusyId, setSubBusyId] = useState(null);
  const [refundBusyId, setRefundBusyId] = useState(null);
  const [rejectReasons, setRejectReasons] = useState({});
  const [manualRefundForms, setManualRefundForms] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const role = user?.role;
  const canVerify = VERIFIERS.includes(role);
  const canCatalog = CATALOG.includes(role);
  const canApproveSubs = SUB_APPROVERS.includes(role);

  const refresh = async () => {
    setLoading(true); setError('');
    try {
      const [supRes, subRes, refundRes] = await Promise.all([
        canVerify ? adminApi.getPendingSuppliers() : Promise.resolve(null),
        canApproveSubs ? adminApi.getPendingSubscriptions() : Promise.resolve(null),
        canApproveSubs ? adminApi.getSubscriptionRefunds() : Promise.resolve(null),
      ]);
      if (supRes) setPending(supRes?.data?.suppliers || []);
      if (subRes) setPendingSubs(subRes?.data?.pending || []);
      if (refundRes) setSubRefunds(refundRes?.data?.refunds || []);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Unable to load pending admin items.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (isAuthenticated && (canVerify || canApproveSubs)) refresh(); }, [isAuthenticated, canVerify, canApproveSubs]);

  const handleApproveSub = async (subId) => {
    try {
      setSubBusyId(subId);
      await adminApi.approveSubscription(subId, 'Verified Safepay payment approved by admin');
      toast.success('Subscription approved and activated.');
      await refresh();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to approve subscription.');
    } finally {
      setSubBusyId(null);
    }
  };

  const handleRejectSub = async (subId) => {
    const reason = String(rejectReasons[subId] || '').trim();
    if (reason.length < 5) {
      toast.error('Enter a rejection reason (at least 5 characters).');
      return;
    }
    try {
      setSubBusyId(subId);
      const res = await adminApi.rejectSubscription(subId, reason);
      const refundStatus = res?.data?.refund?.status || 'REFUND_PENDING';
      if (refundStatus === 'REFUNDED') {
        toast.info('Subscription rejected and full refund confirmed by Safepay.');
      } else if (refundStatus === 'REFUND_FAILED') {
        toast.warning('Subscription rejected; Safepay refund failed and is queued for retry.');
      } else {
        toast.info(`Subscription rejected; refund status: ${refundStatus}.`);
      }
      await refresh();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to reject subscription.');
    } finally {
      setSubBusyId(null);
    }
  };

  const handleRetryRefund = async (subscriptionId) => {
    try {
      setRefundBusyId(subscriptionId);
      const res = await adminApi.retrySubscriptionRefund(subscriptionId);
      const st = res?.data?.refund?.status || 'REFUND_PENDING';
      if (st === 'REFUNDED') {
        toast.success('Full refund confirmed by Safepay.');
      } else if (st === 'REFUND_FAILED') {
        toast.error(res?.data?.refund?.failure_reason || 'Safepay refund retry failed.');
      } else {
        toast.info(`Refund status updated: ${st}.`);
      }
      await refresh();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to retry refund.');
    } finally {
      setRefundBusyId(null);
    }
  };

  const handleSyncRefund = async (subscriptionId) => {
    try {
      setRefundBusyId(subscriptionId);
      const res = await adminApi.syncSubscriptionRefund(subscriptionId);
      const st = res?.data?.refund?.status || 'REFUND_PROCESSING';
      toast.info(`Synced Safepay refund status: ${st}.`);
      await refresh();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to sync refund status.');
    } finally {
      setRefundBusyId(null);
    }
  };

  const handleManualReconcileRefund = async (subscriptionId) => {
    const form = manualRefundForms[subscriptionId] || {};
    const ref = String(form.ref || '').trim();
    const notes = String(form.notes || '').trim();
    if (ref.length < 6 || notes.length < 10) {
      toast.error('Enter Safepay refund reference (6+ chars) and verification evidence notes (10+ chars).');
      return;
    }
    try {
      setRefundBusyId(subscriptionId);
      await adminApi.manualReconcileSubscriptionRefund(subscriptionId, {
        provider_refund_reference: ref,
        evidence_notes: notes
      });
      toast.success('Manual Safepay refund recorded and confirmed REFUNDED.');
      await refresh();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to record manual refund reconciliation.');
    } finally {
      setRefundBusyId(null);
    }
  };

  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: { pathname: '/admin' } }} />;
  if (!ADMINS.includes(role)) return (
    <AppShell>
      <div className="mx-auto max-w-xl p-8 sm:p-12">
        <div className="rounded-3xl border p-8 space-y-4" style={{background:'var(--bg-surface)',borderColor:'var(--border-subtle)'}}>
          <LockKeyhole className="h-9 w-9 text-amber-600" />
          <h1 className="text-2xl font-bold">Administrator access required</h1>
          <p className="text-sm opacity-75">Your signed-in account is not assigned an administrative role. Business ownership does not automatically grant administrative access. Use a separately provisioned administrator account.</p>
          <Link className="inline-flex text-sm font-semibold underline" to="/login" state={{ from: { pathname: '/admin' } }}>Sign in as an administrator</Link>
        </div>
      </div>
    </AppShell>
  );

  return (
    <AppShell>
      <main className="mx-auto max-w-6xl w-full min-w-0 overflow-x-hidden p-4 sm:p-8 space-y-7">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--brand-accent)' }}>
              <ShieldCheck className="w-4 h-4" /> MilJor Administration
            </div>
            <h1 className="font-display mt-2 text-2xl sm:text-3xl font-bold tracking-tight">Operations overview</h1>
            <p className="mt-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>Verification, supplier trust, and catalog governance for Lahore.</p>
          </div>
        </div>

        {canVerify && (
          <section className="rounded-2xl border p-5 sm:p-6" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
            <div className="flex flex-wrap justify-between items-center gap-3">
              <div className="flex items-center gap-3">
                <Users className="w-6 h-6" style={{ color: 'var(--brand-accent)' }} />
                <div>
                  <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Supplier verification</p>
                  <p className="text-2xl font-bold tabular-nums">{loading ? '…' : pending.length} <span className="text-xs font-normal" style={{ color: 'var(--text-secondary)' }}>applications awaiting review</span></p>
                </div>
              </div>
              <button type="button" onClick={refresh} disabled={loading} className="inline-flex gap-2 items-center px-3 py-2 text-xs font-medium rounded-lg border cursor-pointer hover:border-[var(--brand-accent)] transition-colors disabled:opacity-50" style={{ borderColor: 'var(--border-subtle)' }}>
                <RefreshCw className="w-4 h-4" /> Refresh
              </button>
            </div>
            {error && <p role="alert" className="mt-4 text-sm text-red-600 flex gap-2 items-center"><AlertTriangle className="w-4 h-4" /> {error}</p>}
            <div className="mt-5 flex flex-wrap gap-2">
              {['PENDING_REVIEW', 'UNDER_REVIEW', 'MORE_INFORMATION_REQUIRED'].map(status => {
                const count = pending.filter(s => s.verification_status === status).length;
                return <span key={status} className="text-xs px-3 py-1.5 rounded-full border tabular-nums" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>{status.replaceAll('_', ' ')}: <strong style={{ color: 'var(--text-primary)' }}>{count}</strong></span>;
              })}
            </div>
            <Link to="/admin/verifications" className="landing-gradient-cta mt-5 inline-flex items-center rounded-full px-5 py-2.5 text-sm font-semibold" style={{ color: 'var(--text-on-champagne)' }}>
              Review suppliers
            </Link>
          </section>
        )}

        {canApproveSubs && (
          <section className="rounded-2xl border p-5 sm:p-6 space-y-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
            <div className="flex flex-wrap justify-between items-center gap-3">
              <div>
                <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Verified Safepay subscriptions</p>
                <h2 className="text-lg font-bold tabular-nums">Pending approvals ({pendingSubs.length})</h2>
              </div>
              <button type="button" onClick={refresh} disabled={loading} className="inline-flex gap-2 items-center px-3 py-2 text-xs font-medium rounded-lg border cursor-pointer hover:border-[var(--brand-accent)] transition-colors disabled:opacity-50" style={{ borderColor: 'var(--border-subtle)' }}>
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </button>
            </div>
            {pendingSubs.length === 0 ? (
              <p className="text-xs opacity-70">No verified paid subscriptions awaiting approval.</p>
            ) : (
              <div className="space-y-3">
                {pendingSubs.map((sub) => (
                  <div key={sub.id} className="p-4 rounded-xl border flex flex-col lg:flex-row lg:items-center justify-between gap-4 min-w-0" style={{borderColor:'var(--border-subtle)',background:'var(--bg-card)'}}>
                    <div className="space-y-1 text-xs min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-sm">{sub.business_name || sub.full_name || `Supplier #${sub.supplier_id}`}</span>
                        <span className="miljor-badge-verified px-2 py-0.5 rounded-full text-[10px] font-semibold border">
                          {sub.payment_status || 'VERIFIED'}
                        </span>
                      </div>
                      <p className="opacity-75 break-words">{sub.email} · Supplier #{sub.supplier_id}</p>
                      <p>
                        Plan: <strong>{sub.plan_code}</strong> · Amount: <strong>{sub.currency || 'PKR'} {Number(sub.amount_pkr || sub.price_pkr).toLocaleString()}</strong>
                      </p>
                      <p className="font-mono text-[11px] opacity-75 break-all">
                        Order: {sub.order_code} · Tracker: {sub.tracker_token} · Ref: {sub.provider_reference || 'N/A'}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={subBusyId === sub.id}
                        onClick={() => handleApproveSub(sub.id)}
                        className="landing-gradient-cta inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Approve &amp; Activate
                      </button>
                      <input
                        type="text"
                        placeholder="Rejection reason..."
                        value={rejectReasons[sub.id] || ''}
                        onChange={(e) => setRejectReasons((old) => ({ ...old, [sub.id]: e.target.value }))}
                        className="w-full sm:w-auto px-2.5 py-1.5 rounded-lg border text-xs"
                        style={{borderColor:'var(--border-subtle)',background:'var(--bg-surface)'}}
                      />
                      <button
                        type="button"
                        disabled={subBusyId === sub.id}
                        onClick={() => handleRejectSub(sub.id)}
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 cursor-pointer disabled:opacity-50"
                      >
                        <XCircle className="w-3.5 h-3.5" /> Reject &amp; Refund
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {canApproveSubs && (() => {
          const visibleRefunds = subRefunds.filter((rf) => !['REFUND_FAILED', 'FAILED'].includes(String(rf.refund_status || '').toUpperCase()));
          if (visibleRefunds.length === 0) return null;
          return (
          <section className="rounded-2xl border p-5 sm:p-6 space-y-4" style={{borderColor:'var(--border-subtle)',background:'var(--bg-surface)'}}>
            <div>
              <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Post-rejection refunds</p>
              <h2 className="text-lg font-bold tabular-nums">Rejected Subscription Refunds ({visibleRefunds.length})</h2>
            </div>
            <div className="space-y-3">
              {visibleRefunds.map((rf) => (
                <div key={rf.refund_id} className="p-4 rounded-xl border flex flex-col lg:flex-row lg:items-center justify-between gap-4 min-w-0" style={{borderColor:'var(--border-subtle)',background:'var(--bg-card)'}}>
                  <div className="space-y-1 text-xs min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-sm">{rf.business_name || rf.full_name || `Supplier #${rf.supplier_id}`}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                        rf.refund_status === 'REFUNDED'
                          ? 'miljor-badge-verified'
                          : rf.refund_status === 'REFUND_FAILED'
                            ? 'border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                            : 'miljor-badge-provisional'
                      }`}>
                        {rf.refund_status}
                      </span>
                    </div>
                    <p>
                      Plan: <strong>{rf.plan_code}</strong> · Full Refund: <strong>{rf.currency || 'PKR'} {Number(rf.amount_pkr).toLocaleString()}</strong> · Attempts: <strong>{rf.attempt_count}</strong>
                    </p>
                    <p className="opacity-80 break-words">Rejection reason: {rf.rejection_reason}</p>
                    <p className="font-mono text-[11px] opacity-75">
                      Order: <span className="break-all">{rf.order_code}</span> · Tracker: <span className="break-all">{rf.tracker_token}</span> · Orig Ref: <span className="break-all">{rf.original_provider_reference || 'N/A'}</span> · Refund Ref: <span className="break-all">{rf.provider_refund_reference || 'Pending'}</span>
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                      Last attempt: {rf.last_attempted_at ? new Date(rf.last_attempted_at).toLocaleString() : 'N/A'}
                      {rf.confirmed_at ? ` · Confirmed: ${new Date(rf.confirmed_at).toLocaleString()}` : ''}
                    </p>
                    {rf.failure_reason && (
                      <p className="text-rose-600 dark:text-rose-400 font-medium break-words">
                        Failure: {rf.failure_reason}
                      </p>
                    )}
                    {rf.refund_status !== 'REFUNDED' && (
                      <div className="pt-2 flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          placeholder="Safepay refund ref (e.g. sfpy_ref_...)"
                          value={manualRefundForms[rf.subscription_id]?.ref || ''}
                          onChange={(e) => setManualRefundForms((old) => ({
                            ...old,
                            [rf.subscription_id]: { ...(old[rf.subscription_id] || {}), ref: e.target.value }
                          }))}
                          className="w-full sm:w-auto sm:min-w-[230px] px-2.5 py-1.5 rounded-lg border text-xs font-mono"
                          style={{borderColor:'var(--border-subtle)',background:'var(--bg-surface)'}}
                        />
                        <input
                          type="text"
                          placeholder="Safepay Dashboard refund evidence notes..."
                          value={manualRefundForms[rf.subscription_id]?.notes || ''}
                          onChange={(e) => setManualRefundForms((old) => ({
                            ...old,
                            [rf.subscription_id]: { ...(old[rf.subscription_id] || {}), notes: e.target.value }
                          }))}
                          className="w-full sm:w-auto sm:min-w-[220px] flex-1 px-2.5 py-1.5 rounded-lg border text-xs"
                          style={{borderColor:'var(--border-subtle)',background:'var(--bg-surface)'}}
                        />
                        <button
                          type="button"
                          disabled={refundBusyId === rf.subscription_id}
                          onClick={() => handleManualReconcileRefund(rf.subscription_id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-emerald-400 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 cursor-pointer disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Confirm Manual Refund
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {['REFUND_FAILED', 'REFUND_PENDING'].includes(rf.refund_status) && (
                      <button
                        type="button"
                        disabled={refundBusyId === rf.subscription_id}
                        onClick={() => handleRetryRefund(rf.subscription_id)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border cursor-pointer disabled:opacity-50 whitespace-nowrap"
                        style={{borderColor:'var(--border-subtle)',background:'var(--bg-surface)'}}
                      >
                        <RefreshCw className="w-3.5 h-3.5" /> Retry Refund
                      </button>
                    )}
                    {rf.refund_status === 'REFUND_PROCESSING' && (
                      <button
                        type="button"
                        disabled={refundBusyId === rf.subscription_id}
                        onClick={() => handleSyncRefund(rf.subscription_id)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border cursor-pointer disabled:opacity-50 whitespace-nowrap"
                        style={{borderColor:'var(--border-subtle)',background:'var(--bg-surface)'}}
                      >
                        <RefreshCw className="w-3.5 h-3.5" /> Sync Status
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
          );
        })()}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {canCatalog && <Link to="/admin/catalog" className="rounded-2xl border p-6 hover:border-[var(--brand-accent)] transition-colors space-y-2.5" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <FolderCheck className="w-6 h-6" style={{ color: 'var(--brand-accent)' }} />
            <h2 className="text-base font-bold">Catalog governance</h2>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>Moderate supplier catalog requests, families, and categories.</p>
            <span className="text-xs font-semibold inline-flex items-center" style={{ color: 'var(--brand-accent)' }}>Open catalog</span>
          </Link>}
          {canVerify && <Link to="/admin/verifications" className="rounded-2xl border p-6 hover:border-[var(--brand-accent)] transition-colors space-y-2.5" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <ShieldCheck className="w-6 h-6" style={{ color: 'var(--brand-accent)' }} />
            <h2 className="text-base font-bold">Business verification</h2>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>Inspect business details, set verification level, and review applications.</p>
            <span className="text-xs font-semibold inline-flex items-center" style={{ color: 'var(--brand-accent)' }}>Open verification</span>
          </Link>}
        </div>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Verification and settlement actions are server-enforced.</p>
      </main>
    </AppShell>
  );
}
export default AdminDashboardPage;
