import React, { useCallback, useEffect, useState } from 'react';
import { AppShell } from '../components/layout/AppShell';
import { useAuth } from '../context/AuthContext';
import { Check, Clock3, ShieldCheck, AlertCircle, RefreshCw } from 'lucide-react';

const TIER_NAMES = { STARTER: 'Starter', GROWTH: 'Growth', BUSINESS: 'Business' };
const FAMILY_CAPS = { STARTER: 4, GROWTH: 13, BUSINESS: 25 };
const order = ['STARTER', 'GROWTH', 'BUSINESS'];
const formatPKR = (value) => new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(Number(value || 0));
const formatDate = (value) => value ? new Date(value).toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' }) : null;

export const SupplierSubscriptionPage = () => {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [current, available] = await Promise.all([
        fetch('/api/v1/supplier/subscription', { headers }),
        fetch('/api/v1/supplier/subscription/plans', { headers })
      ]);
      if (!current.ok || !available.ok) throw new Error('Unable to load subscription details.');
      const a = await current.json();
      const b = await available.json();
      if (!a.success || !b.success) throw new Error('Unable to load subscription details.');
      setData(a.data);
      setPlans(b.data.plans || []);
    } catch (err) {
      setError(err.message || 'Unable to load subscription details.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { refresh(); }, [refresh]);

  const cancelRenewal = async () => {
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/v1/supplier/subscription/cancel-renewal', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error?.message || 'Unable to cancel renewal.');
      setNotice('Renewal cancelled. Your current plan remains active until its period ends.');
      setConfirmCancel(false);
      await refresh();
    } catch (err) {
      setError(err.message || 'Unable to cancel renewal.');
    } finally {
      setSubmitting(false);
    }
  };

  const entitlement = data?.entitlements;
  const history = data?.billing_history || [];
  const latest = history[0] || null;
  const currentPlan = entitlement?.plan_code || 'STARTER';
  const paid = currentPlan !== 'STARTER';
  const periodEnd = latest?.current_period_end;
  const alreadyScheduled = latest?.pending_plan_code === 'STARTER';
  const usage = entitlement?.active_families_count ?? 0;
  const quota = entitlement?.max_allowed_families ?? FAMILY_CAPS[currentPlan];
  const eligibleToCancel = paid && latest?.status === 'ACTIVE' && periodEnd && new Date(periodEnd).getTime() > Date.now() && !alreadyScheduled;

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-12 space-y-8 text-[var(--text-primary)]">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--brand-accent)]">Supplier account</p>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">Your subscription</h1>
          <p className="text-sm text-[var(--text-muted)]">Manage your plan and product-family allowance.</p>
        </header>

        {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-400/30 p-3 text-sm"><AlertCircle size={18} className="shrink-0 text-red-500"/>{error}</div>}
        {notice && <div role="status" className="rounded-xl border border-[var(--brand-accent)]/40 p-3 text-sm">{notice}</div>}
        {loading ? (
          <div role="status" className="rounded-2xl border border-[var(--border-subtle)] p-8 text-sm text-[var(--text-muted)]">Loading subscription…</div>
        ) : entitlement ? (
          <>
            <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 sm:p-7 space-y-4" aria-label="Current subscription">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs text-[var(--text-muted)]">Current plan</p>
                  <h2 className="font-display text-2xl font-semibold mt-1">{TIER_NAMES[currentPlan] || currentPlan}</h2>
                </div>
                <span className="rounded-full border border-[var(--brand-accent)]/45 bg-[var(--brand-accent-soft)] px-3 py-1 text-xs font-medium">Active</span>
              </div>
              <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
                <div><p className="text-[var(--text-muted)] text-xs">Product families</p><p className="font-semibold mt-1">{usage} / {quota}</p></div>
                {periodEnd && <div><p className="text-[var(--text-muted)] text-xs">Current period ends</p><p className="font-semibold mt-1">{formatDate(periodEnd)}</p></div>}
                <div><p className="text-[var(--text-muted)] text-xs">Renewal</p><p className="font-semibold mt-1">{alreadyScheduled ? 'Cancelled' : paid ? 'Not configured' : 'Free plan'}</p></div>
              </div>
              <div className="h-1.5 rounded-full bg-[var(--bg-card)] overflow-hidden" aria-label="Product-family quota usage">
                <div className="h-full rounded-full bg-[var(--brand-accent)]" style={{width: `${quota ? Math.min(100, 100 * usage / quota) : 0}%`}}/>
              </div>
              {alreadyScheduled && <p className="flex gap-2 items-start text-sm text-[var(--text-secondary)]"><Clock3 size={16} className="shrink-0 mt-0.5"/>Your plan changes to Starter after {formatDate(periodEnd)}. Existing orders and historical records remain intact.</p>}
              {entitlement.is_over_limit && <p className="text-sm text-[var(--text-secondary)]">You're above your plan's family allowance. Existing commitments remain; new families cannot be published until usage is within the limit.</p>}
              {eligibleToCancel && (
                <button type="button" onClick={() => setConfirmCancel(true)} className="text-sm font-medium underline underline-offset-4 hover:text-[var(--brand-accent)]">
                  Cancel renewal
                </button>
              )}
            </section>

            <section className="space-y-4" aria-label="Available plans">
              <h2 className="font-display text-2xl font-semibold">Plans</h2>
              <div className="grid gap-4 md:grid-cols-3">
                {order.map(code => {
                  const plan = plans.find(p => p.plan_code === code);
                  const isCurrent = code === currentPlan;
                  const fee = plan?.monthly_price_pkr;
                  return <article key={code} className={`rounded-2xl border bg-[var(--bg-surface)] p-5 flex flex-col gap-4 ${isCurrent ? 'border-[var(--brand-accent)]' : 'border-[var(--border-subtle)]'}`}>
                    <div className="flex justify-between items-start gap-2">
                      <h3 className="font-display text-xl font-semibold">{TIER_NAMES[code]}</h3>
                      {isCurrent && <span className="text-xs text-[var(--brand-accent)] font-medium">Current</span>}
                    </div>
                    <div>
                      <p className="text-2xl font-semibold tabular-nums">{code === 'STARTER' ? 'Free' : fee != null ? formatPKR(fee) : 'Pricing unavailable'}</p>
                      {code !== 'STARTER' && fee != null && <p className="text-xs text-[var(--text-muted)]">Monthly</p>}
                    </div>
                    <p className="flex gap-2 text-sm items-center"><Check size={17} className="text-[var(--brand-accent)]"/>{plan?.max_active_families ?? FAMILY_CAPS[code]} product families</p>
                    <div className="mt-auto pt-2">
                      {isCurrent ? <span className="block rounded-xl bg-[var(--bg-card)] p-3 text-center text-sm text-[var(--text-muted)]">Your active plan</span> :
                        <span className="block rounded-xl border border-[var(--border-subtle)] p-3 text-center text-sm text-[var(--text-muted)]">
                          {code === 'STARTER' && paid ? alreadyScheduled ? 'Scheduled for period end' : 'Use Cancel renewal above' :
                            'Checkout not available yet'}
                        </span>}
                    </div>
                  </article>;
                })}
              </div>
              <p className="text-xs text-[var(--text-muted)]">Paid plan changes require verified Safepay subscription checkout. Until it is available, paid upgrades and paid-to-paid downgrades cannot be activated.</p>
            </section>

            {history.length > 0 && <section className="space-y-3" aria-label="Subscription history">
              <h2 className="font-display text-xl font-semibold">History</h2>
              <div className="overflow-x-auto rounded-2xl border border-[var(--border-subtle)]">
                <table className="w-full text-sm text-left">
                  <thead className="bg-[var(--bg-card)] text-[var(--text-muted)]"><tr><th className="p-3 font-medium">Plan</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium">Started</th></tr></thead>
                  <tbody>{history.slice(0, 10).map(h => <tr key={h.id} className="border-t border-[var(--border-subtle)]"><td className="p-3">{TIER_NAMES[h.plan_code] || h.plan_code}</td><td className="p-3">{h.pending_plan_code ? 'Cancellation scheduled' : h.status}</td><td className="p-3">{formatDate(h.current_period_start) || '—'}</td></tr>)}</tbody>
                </table>
              </div>
            </section>}
          </>
        ) : null}

        {confirmCancel && <div role="presentation" className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="cancel-renewal-title" className="w-full max-w-md rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-xl space-y-4">
            <ShieldCheck size={24} className="text-[var(--brand-accent)]"/>
            <h2 id="cancel-renewal-title" className="font-display text-2xl font-semibold">Cancel renewal?</h2>
            <p className="text-sm text-[var(--text-secondary)]">Your paid plan stays active until {formatDate(periodEnd)}. Then it becomes Starter. Existing orders, pools and records stay intact; new family publication follows Starter limits.</p>
            <div className="flex flex-wrap gap-3 justify-end">
              <button type="button" onClick={() => setConfirmCancel(false)} disabled={submitting} className="rounded-xl border border-[var(--border-subtle)] px-4 py-2.5 text-sm font-medium">Keep plan</button>
              <button type="button" onClick={cancelRenewal} disabled={submitting} className="rounded-xl bg-[var(--brand-accent)] text-stone-900 px-4 py-2.5 text-sm font-semibold disabled:opacity-50">{submitting ? 'Processing…' : 'Confirm cancellation'}</button>
            </div>
          </div>
        </div>}
      </main>
    </AppShell>
  );
};

export default SupplierSubscriptionPage;
