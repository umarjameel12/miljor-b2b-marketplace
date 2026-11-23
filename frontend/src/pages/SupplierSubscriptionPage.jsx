import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Check,
  Shield,
  Zap,
  Crown,
  HelpCircle,
  AlertTriangle,
  Clock,
  ExternalLink,
  RefreshCw,
  XCircle
} from 'lucide-react';
import { toast } from 'react-toastify';
import { useAuth } from '../context/AuthContext';
import { AppShell } from '../components/layout/AppShell';
import supplierApi from '../api/supplier';

const PLAN_RANK = { STARTER: 1, GROWTH: 2, BUSINESS: 3 };
const PLAN_META = {
  STARTER: {
    icon: Shield,
    tagline: 'Ideal for independent producers & single-commodity millers',
    highlights: [
      'Up to 4 active canonical product families',
      'Unlimited physical SKUs within allowed families',
      'Standard Lahore cluster order routing',
      'Direct bank escrow settlement (T+2)'
    ]
  },
  GROWTH: {
    icon: Zap,
    tagline: 'For established distributors expanding bulk B2B restaurant reach',
    popular: true,
    highlights: [
      'Up to 13 active canonical product families',
      'Safepay v3 verified monthly billing',
      'Priority matching on Smart Procurement Hub requests',
      'Flash pool clearance capability'
    ]
  },
  BUSINESS: {
    icon: Crown,
    tagline: 'For major mills, commodity importers & large-scale FMCG wholesalers',
    highlights: [
      'Up to 25 active canonical product families',
      'Safepay v3 verified monthly billing',
      'Dedicated Lahore account coordinator',
      'Custom recurring procurement contracts'
    ]
  }
};

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' });
}

function makeIdempotencyKey(planCode) {
  return `sub-${planCode.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const SupplierSubscriptionPage = () => {
  const { token } = useAuth();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [error, setError] = useState('');
  const [overview, setOverview] = useState(null);
  const [plans, setPlans] = useState([]);

  const fetchSubscriptionData = async () => {
    try {
      setLoading(true);
      setError('');
      const [subRes, plansRes] = await Promise.all([
        supplierApi.getSubscription(),
        supplierApi.getSubscriptionPlans()
      ]);
      setOverview(subRes?.data || null);
      setPlans(plansRes?.data?.plans || []);
    } catch (err) {
      const msg = err.response?.data?.error?.message || 'Failed to load subscription status';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) fetchSubscriptionData();
  }, [token]);

  const entitlements = overview?.entitlements || null;
  const billingHistory = overview?.billing_history || [];
  const paymentAttempts = overview?.payment_attempts || [];
  const renewalNotice = overview?.renewal_price_notice || null;

  const currentPlan = entitlements?.plan_code || entitlements?.current_plan || 'STARTER';
  const subStatus = entitlements?.subscription_status || 'STARTER_ACTIVE';
  const usedFamilies = entitlements?.active_families_count ?? entitlements?.used_distinct_families ?? 0;
  const maxFamilies = entitlements?.max_allowed_families ?? entitlements?.max_families ?? 4;
  const remainingSlots = entitlements?.remaining_family_slots ?? Math.max(0, maxFamilies - usedFamilies);
  const pendingCheckout = entitlements?.pending_checkout || null;
  const returnedAttemptId = searchParams.get('checkout_attempt');

  const handlePlanAction = async (targetPlanCode) => {
    if (targetPlanCode === currentPlan && subStatus === 'ACTIVE') return;
    const targetRank = PLAN_RANK[targetPlanCode] || 1;
    const currentRank = PLAN_RANK[currentPlan] || 1;

    try {
      setSubmitting(true);
      setError('');

      if (targetRank < currentRank) {
        const res = await supplierApi.scheduleSubscriptionDowngrade(targetPlanCode);
        toast.info(res?.message || `Downgrade to ${targetPlanCode} scheduled for end of paid period.`);
        await fetchSubscriptionData();
        return;
      }

      const idempotencyKey = makeIdempotencyKey(targetPlanCode);
      const res = await supplierApi.initiateSubscriptionCheckout({
        planCode: targetPlanCode,
        idempotencyKey
      });
      const attempt = res?.data?.attempt;
      toast.info(
        `Safepay checkout created for ${targetPlanCode} (PKR ${Number(attempt?.amount_pkr || 0).toLocaleString()}). Complete payment and verify status — subscription activates only after verified payment & admin approval.`
      );
      await fetchSubscriptionData();
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message || 'Unable to process subscription request';
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAcceptRenewalAndCheckout = async () => {
    if (!renewalNotice) return;
    try {
      setSubmitting(true);
      setError('');
      const consentRes = await supplierApi.recordRenewalConsent({
        subscriptionId: renewalNotice.subscription_id,
        expectedNewPricePkr: renewalNotice.current_catalogue_price_pkr
      });
      const consentToken = consentRes?.data?.consent_token;
      const res = await supplierApi.initiateSubscriptionCheckout({
        planCode: renewalNotice.plan_code,
        idempotencyKey: makeIdempotencyKey(`${renewalNotice.plan_code}-renew`),
        renewalConsentToken: consentToken
      });
      const attempt = res?.data?.attempt;
      toast.info(
        `Renewal price accepted and Safepay checkout created for ${renewalNotice.plan_code} (PKR ${Number(attempt?.amount_pkr || 0).toLocaleString()}).`
      );
      await fetchSubscriptionData();
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message || 'Unable to record renewal price consent';
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReconcile = async (attemptId) => {
    try {
      setReconciling(true);
      setError('');
      const res = await supplierApi.reconcileSubscriptionCheckout(attemptId);
      const data = res?.data;
      if (data?.verified) {
        toast.success('Payment verified with Safepay! Subscription is now queued for admin approval.');
      } else {
        toast.info(data?.message || 'Payment is still pending confirmation from Safepay.');
      }
      await fetchSubscriptionData();
    } catch (err) {
      const msg = err.response?.data?.error?.message || 'Payment reconciliation failed';
      setError(msg);
      toast.error(msg);
    } finally {
      setReconciling(false);
    }
  };

  const handleCancelRenewal = async () => {
    try {
      setSubmitting(true);
      setError('');
      const res = await supplierApi.cancelSubscription('Supplier requested period-end cancellation');
      toast.info(res?.message || 'Auto-renewal disabled. Your paid plan stays active until period end.');
      await fetchSubscriptionData();
    } catch (err) {
      const msg = err.response?.data?.error?.message || 'Unable to schedule cancellation';
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const renderPlans = plans;

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full space-y-10">
        <div className="text-center max-w-3xl mx-auto">
          <span className="text-xs uppercase tracking-wider font-semibold text-[var(--brand-accent)] block mb-2">
            Supplier Subscription &amp; Family Entitlements
          </span>
          <h1 className="text-3xl sm:text-4xl font-serif font-bold text-[var(--text-primary)]">
            Scale Your Wholesale Food Distribution
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-2">
            Each plan grants distinct canonical product family slots. Paid upgrades require verified Safepay Sandbox
            payment and administrator activation review.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="max-w-3xl mx-auto p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Current Subscription & Lifecycle Summary */}
        <div className="max-w-4xl mx-auto p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] space-y-4">
          {loading ? (
            <div className="text-xs text-[var(--text-muted)] text-center py-4">Loading subscription status…</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Active Plan &amp; Status</div>
                  <div className="text-xl font-serif font-bold text-[var(--text-primary)] flex items-center gap-2 mt-0.5">
                    <span>{entitlements?.plan_name || currentPlan}</span>
                    <span className="text-[11px] font-sans font-semibold px-2.5 py-0.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)]">
                      {subStatus}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-[var(--text-muted)]">Canonical Family Quota</div>
                  <div className="text-base font-bold text-[var(--text-primary)]">
                    {usedFamilies} / {maxFamilies} active{' '}
                    <span className="text-xs font-normal text-[var(--text-muted)]">({remainingSlots} remaining)</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-[var(--border-subtle)] text-xs">
                <div>
                  <div className="text-[var(--text-muted)]">Period Start</div>
                  <div className="font-semibold text-[var(--text-primary)]">{formatDate(entitlements?.current_period_start)}</div>
                </div>
                <div>
                  <div className="text-[var(--text-muted)]">Period End / Renewal</div>
                  <div className="font-semibold text-[var(--text-primary)]">{formatDate(entitlements?.current_period_end)}</div>
                </div>
                <div>
                  <div className="text-[var(--text-muted)]">Pending Plan Change</div>
                  <div className="font-semibold text-[var(--text-primary)]">
                    {entitlements?.pending_plan_code
                      ? `${entitlements.pending_plan_code} at period end`
                      : entitlements?.cancel_at_period_end
                        ? 'Cancelling at period end'
                        : 'None'}
                  </div>
                </div>
                <div>
                  <div className="text-[var(--text-muted)]">Admin Review</div>
                  <div className="font-semibold text-[var(--text-primary)]">{entitlements?.admin_approval_status || 'NOT_REQUIRED'}</div>
                </div>
              </div>

              {entitlements?.is_over_limit && (
                <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Your published catalog ({usedFamilies} families) exceeds your current plan cap ({maxFamilies}).
                    Existing products remain intact, and adding new product families is paused until you upgrade or reduce active families.
                  </span>
                </div>
              )}

              {currentPlan !== 'STARTER' && subStatus === 'ACTIVE' && !entitlements?.cancel_at_period_end && (
                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleCancelRenewal}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    <XCircle className="w-3.5 h-3.5" /> Cancel Auto-Renewal at Period End
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Renewal Price Change Consent Notice */}
        {renewalNotice?.requires_consent && (
          <div className="max-w-4xl mx-auto p-5 rounded-2xl border border-amber-500/40 bg-amber-500/10 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Renewal Price Update Requires Your Explicit Consent</span>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              Your previous agreed monthly price for {renewalNotice.plan_code} was{' '}
              <strong>
                {renewalNotice.previous_agreed_price_pkr
                  ? `PKR ${Number(renewalNotice.previous_agreed_price_pkr).toLocaleString()}`
                  : 'unavailable'}
              </strong>
              . The current monthly renewal price is{' '}
              <strong>PKR {Number(renewalNotice.current_catalogue_price_pkr).toLocaleString()} / month</strong>.
              Accepting updates your monthly renewal price for future billing cycles; existing historical payments are unchanged.
            </p>
            <button
              type="button"
              disabled={submitting || Boolean(pendingCheckout)}
              onClick={handleAcceptRenewalAndCheckout}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-[var(--brand-accent)] text-stone-900 disabled:opacity-50"
            >
              Accept New Renewal Price &amp; Start Checkout
            </button>
          </div>
        )}

        {/* Pending Safepay Checkout Banner */}
        {(pendingCheckout || returnedAttemptId) && (
          <div className="max-w-4xl mx-auto p-5 rounded-2xl border border-amber-500/40 bg-amber-500/10 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
                <Clock className="w-4 h-4 text-amber-600" />
                <span>
                  Pending Safepay Checkout{' '}
                  {pendingCheckout ? `— ${pendingCheckout.target_plan_code} (PKR ${Number(pendingCheckout.amount_pkr || 0).toLocaleString()})` : `#${returnedAttemptId}`}
                </span>
              </div>
              <span className="text-xs font-mono text-[var(--text-muted)]">
                Status: {pendingCheckout?.status || 'PENDING_VERIFICATION'}
              </span>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              Browser redirects alone never activate a paid plan. After completing Safepay Sandbox checkout, reconcile status with Safepay.
            </p>
            <div className="flex flex-wrap gap-3">
              {pendingCheckout?.checkout_url && (
                <a
                  href={pendingCheckout.checkout_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-[var(--brand-accent)] text-stone-900"
                >
                  Open Safepay Checkout <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              <button
                type="button"
                disabled={reconciling}
                onClick={() => handleReconcile(pendingCheckout?.id || Number(returnedAttemptId))}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
              >
                <RefreshCw className="w-3.5 h-3.5" /> {reconciling ? 'Verifying with Safepay…' : 'Verify Payment Status'}
              </button>
            </div>
          </div>
        )}

        {/* Plan Catalogue Cards */}
        {!loading && renderPlans.length === 0 ? (
          <div className="max-w-3xl mx-auto p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-center space-y-2">
            <h2 className="text-lg font-serif font-bold text-[var(--text-primary)]">Pricing unavailable</h2>
            <p className="text-xs text-[var(--text-muted)]">
              Authoritative subscription pricing could not be loaded from the server. Please refresh to retry.
            </p>
          </div>
        ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {renderPlans.map((plan) => {
            const code = plan.plan_code;
            const meta = PLAN_META[code] || PLAN_META.STARTER;
            const Icon = meta.icon;
            const isCurrent = currentPlan === code;
            const targetRank = PLAN_RANK[code] || 1;
            const currentRank = PLAN_RANK[currentPlan] || 1;
            const isDowngrade = targetRank < currentRank;
            const monthlyPrice = Number(plan.monthly_price_pkr || 0);

            return (
              <div
                key={code}
                className={`relative rounded-3xl p-8 border transition-all duration-200 flex flex-col justify-between ${
                  isCurrent
                    ? 'border-[var(--brand-accent)] bg-[var(--bg-surface)] ring-2 ring-[var(--brand-accent)]/20 shadow-md'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]'
                }`}
              >
                {meta.popular && !isCurrent && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[11px] font-bold bg-[var(--brand-accent)] text-stone-900">
                    Recommended Growth
                  </div>
                )}
                {isCurrent && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[11px] font-bold bg-emerald-600 text-white">
                    Current Plan
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 rounded-2xl bg-[var(--bg-card)] text-[var(--brand-accent)]">
                      <Icon className="w-6 h-6" />
                    </div>
                    <span className="text-xs font-semibold text-[var(--text-muted)]">
                      {Number(plan.transaction_fee_pct || 0).toFixed(2)}% Transaction Fee (separate)
                    </span>
                  </div>

                  <h3 className="text-xl font-serif font-bold text-[var(--text-primary)] mb-1">{plan.name}</h3>
                  <p className="text-xs text-[var(--text-muted)] mb-6 min-h-[2.5rem]">{meta.tagline}</p>

                  <div className="flex items-baseline gap-1 mb-6">
                    <span className="text-3xl font-serif font-bold text-[var(--text-primary)]">
                      {monthlyPrice === 0 ? 'Free' : `PKR ${monthlyPrice.toLocaleString()}`}
                    </span>
                    <span className="text-xs text-[var(--text-muted)]">
                      {monthlyPrice === 0 ? 'Standard' : '/ month'}
                    </span>
                  </div>

                  <div className="border-t border-[var(--border-subtle)] pt-6 mb-6">
                    <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">
                      {plan.max_active_families} Canonical Product Families
                    </div>
                    <ul className="space-y-3">
                      {meta.highlights.map((feat, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-xs text-[var(--text-primary)]">
                          <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={(isCurrent && subStatus === 'ACTIVE') || submitting || Boolean(pendingCheckout)}
                  onClick={() => handlePlanAction(code)}
                  className={`w-full py-3 px-4 rounded-xl text-xs font-bold transition-all ${
                    isCurrent && subStatus === 'ACTIVE'
                      ? 'bg-[var(--bg-card)] text-[var(--text-muted)] cursor-not-allowed'
                      : 'bg-[var(--brand-accent)] text-stone-900 hover:opacity-95'
                  }`}
                >
                  {isCurrent && subStatus === 'ACTIVE'
                    ? 'Active Plan'
                    : isDowngrade
                      ? `Schedule Downgrade to ${code}`
                      : submitting
                        ? 'Processing…'
                        : `Subscribe / Upgrade to ${code}`}
                </button>
              </div>
            );
          })}
        </div>
        )}

        {/* Payment & Subscription History */}
        {(paymentAttempts.length > 0 || billingHistory.length > 0) && (
          <div className="max-w-5xl mx-auto p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] space-y-4">
            <h2 className="text-base font-serif font-bold text-[var(--text-primary)]">
              Subscription &amp; Safepay Payment History
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-[var(--text-muted)]">
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Plan</th>
                    <th className="py-2 pr-4">Amount</th>
                    <th className="py-2 pr-4">Payment / Status</th>
                    <th className="py-2">Admin Review</th>
                  </tr>
                </thead>
                <tbody>
                  {billingHistory.map((row) => (
                    <tr key={`sub-${row.id}`} className="border-b border-[var(--border-subtle)]/60">
                      <td className="py-2 pr-4">{formatDate(row.created_at)}</td>
                      <td className="py-2 pr-4 font-semibold">{row.plan_code}</td>
                      <td className="py-2 pr-4">PKR {Number(row.price_pkr || 0).toLocaleString()}</td>
                      <td className="py-2 pr-4">{row.status}</td>
                      <td className="py-2">{row.admin_approval_status || 'NOT_REQUIRED'}</td>
                    </tr>
                  ))}
                  {paymentAttempts.map((att) => (
                    <tr key={`att-${att.id}`} className="border-b border-[var(--border-subtle)]/60">
                      <td className="py-2 pr-4">{formatDate(att.created_at)}</td>
                      <td className="py-2 pr-4 font-semibold">{att.target_plan_code} ({att.change_type})</td>
                      <td className="py-2 pr-4">PKR {Number(att.amount_pkr || 0).toLocaleString()}</td>
                      <td className="py-2 pr-4">Checkout: {att.status}</td>
                      <td className="py-2 font-mono text-[11px]">{att.tracker_token || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Business Rule Guarantee */}
        <div className="p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] max-w-3xl mx-auto flex items-start gap-4">
          <HelpCircle className="w-5 h-5 text-[var(--brand-accent)] shrink-0 mt-0.5" />
          <div className="text-xs text-[var(--text-muted)] space-y-1">
            <h5 className="font-semibold text-[var(--text-primary)]">Historical Record Preservation Guarantee</h5>
            <p>
              Upgrades take effect only after verified Safepay payment and administrator approval. Downgrades and
              cancellations take effect at the end of your current paid period without deleting existing products or
              published specifications.
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
};
