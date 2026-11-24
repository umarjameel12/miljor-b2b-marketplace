import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AppShell } from '../components/layout/AppShell';
import {
  Check,
  Shield,
  Zap,
  Crown,
  Sparkles,
  HelpCircle,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Clock
} from 'lucide-react';
import { toast } from 'react-toastify';

const PLAN_VISUALS = {
  STARTER: {
    icon: Shield,
    tagline: 'Ideal for independent producers & single-commodity millers',
    popular: false,
    highlights: [
      'Up to 4 active canonical product families',
      'Unlimited physical SKUs within allowed families',
      'Standard Lahore cluster order routing',
      'Direct bank escrow settlement (T+2)',
    ],
  },
  GROWTH: {
    icon: Zap,
    tagline: 'For established distributors expanding bulk B2B restaurant reach',
    popular: true,
    highlights: [
      'Up to 13 active canonical product families',
      'Reduced 2% supplier transaction fee',
      'Priority matching on Sourcing Hub open requests',
      'Flash pool clearance & multi-hub cluster routing',
    ],
  },
  BUSINESS: {
    icon: Crown,
    tagline: 'For major mills, commodity importers & large-scale FMCG wholesalers',
    popular: false,
    highlights: [
      'Up to 25 active canonical product families',
      'Lowest 1.5% supplier transaction fee',
      'Full Sourcing Hub open-market & collective access',
      'Dedicated Lahore account & demand intelligence',
    ],
  },
};

export const SupplierSubscriptionPage = () => {
  const { token } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [submittingPlan, setSubmittingPlan] = useState(null);
  const [verifyingTracker, setVerifyingTracker] = useState(false);

  const [plans, setPlans] = useState([]);
  const [subscription, setSubscription] = useState(null);
  const [billingHistory, setBillingHistory] = useState([]);
  const [payments, setPayments] = useState([]);
  const [pendingCheckout, setPendingCheckout] = useState(null);

  const loadSubscriptionData = useCallback(async () => {
    if (!token) {
      setLoading(false);
      setLoadError('Please sign in with your supplier account to view subscription plans.');
      return;
    }
    try {
      setLoading(true);
      setLoadError('');
      const [plansRes, subRes] = await Promise.all([
        fetch('/api/v1/supplier/subscription/plans', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/v1/supplier/subscription', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      const plansBody = await plansRes.json().catch(() => ({}));
      const subBody = await subRes.json().catch(() => ({}));

      if (plansRes.status === 401 || subRes.status === 401) {
        throw new Error('Your session has expired. Please sign in again to manage your subscription.');
      }
      if (!plansRes.ok) {
        throw new Error(plansBody.error?.message || 'Unable to load subscription plans.');
      }
      if (!subRes.ok) {
        throw new Error(subBody.error?.message || 'Unable to load your subscription status.');
      }

      setPlans(plansBody.data?.plans || []);
      setSubscription(subBody.data?.entitlements || null);
      setBillingHistory(subBody.data?.billing_history || []);
      setPayments(subBody.data?.payments || []);
    } catch (err) {
      setLoadError(err.message || 'Failed to load subscription details.');
      setSubscription(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadSubscriptionData();
  }, [loadSubscriptionData]);

  // Handle return from Safepay checkout (?payment_status=verify&tracker=... or cancelled)
  useEffect(() => {
    if (!token) return;
    const paymentStatus = searchParams.get('payment_status');
    const tracker = searchParams.get('tracker');
    const orderCode = searchParams.get('order_code');
    if (!paymentStatus) return;

    const handleReturn = async () => {
      try {
        setVerifyingTracker(true);
        if (paymentStatus === 'cancelled' && orderCode) {
          await fetch('/api/v1/supplier/subscription/cancel', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ order_code: orderCode }),
          });
          toast.info('Subscription checkout was cancelled. No plan changes were made.');
        } else if (tracker) {
          const res = await fetch('/api/v1/supplier/subscription/verify', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ tracker_token: tracker }),
          });
          const body = await res.json();
          if (!res.ok) {
            throw new Error(body.error?.message || 'Payment verification failed.');
          }
          if (body.data?.activated || body.data?.already_verified) {
            toast.success('Safepay payment verified! Your subscription plan is now active.');
          } else if (body.data?.status === 'PENDING') {
            toast.info('Payment is still pending confirmation from Safepay. Click Verify Status shortly.');
          } else {
            toast.error(`Payment status: ${body.data?.status || 'FAILED'}. Plan was not activated.`);
          }
        }
        await loadSubscriptionData();
      } catch (err) {
        toast.error(err.message);
      } finally {
        setVerifyingTracker(false);
        setSearchParams({}, { replace: true });
      }
    };

    handleReturn();
  }, [token, searchParams, setSearchParams, loadSubscriptionData]);

  const handlePlanAction = async (targetPlanCode) => {
    if (!subscription || targetPlanCode === subscription.plan_code) return;

    // Downgrade to free STARTER plan
    if (targetPlanCode === 'STARTER') {
      try {
        setSubmittingPlan('STARTER');
        const res = await fetch('/api/v1/supplier/subscription/upgrade', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ targetPlan: 'STARTER', billing_cycle: 'MONTHLY' }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error?.message || 'Downgrade failed.');
        }
        toast.success('Switched to Starter plan. Existing products remain preserved.');
        await loadSubscriptionData();
      } catch (err) {
        toast.error(err.message);
      } finally {
        setSubmittingPlan(null);
      }
      return;
    }

    // Paid plans (GROWTH / BUSINESS) initiate verified Safepay checkout
    try {
      setSubmittingPlan(targetPlanCode);
      const idempotencyKey = `sub-${targetPlanCode}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const res = await fetch('/api/v1/supplier/subscription/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          plan_code: targetPlanCode,
          billing_cycle: 'MONTHLY',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Could not initiate Safepay subscription checkout.');
      }
      setPendingCheckout(data.data);
      toast.info('Safepay checkout session created. Complete payment to activate your plan.');
      if (data.data?.checkout_url && /^https:\/\//i.test(data.data.checkout_url)) {
        window.open(data.data.checkout_url, '_blank', 'noopener,noreferrer');
      }
      await loadSubscriptionData();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmittingPlan(null);
    }
  };

  const handleVerifyPending = async (payment) => {
    try {
      setVerifyingTracker(true);
      const res = await fetch('/api/v1/supplier/subscription/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ payment_id: payment.id }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error?.message || 'Verification failed.');
      }
      if (body.data?.activated || body.data?.already_verified) {
        toast.success(`Payment verified! ${payment.plan_code} plan is now active.`);
        setPendingCheckout(null);
      } else if (body.data?.status === 'PENDING') {
        toast.info('Payment is still pending on Safepay.');
      } else {
        toast.error(`Payment ${body.data?.status || 'FAILED'}. You can retry checkout anytime.`);
      }
      await loadSubscriptionData();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setVerifyingTracker(false);
    }
  };

  const currentPlan = subscription?.plan_code || null;
  const usedFamilies = subscription?.active_families_count ?? 0;
  const maxFamilies = subscription?.max_allowed_families ?? 0;
  const remainingSlots = subscription?.remaining_family_slots ?? 0;
  const latestPendingPayment = payments.find((p) => p.status === 'PENDING' || p.status === 'INITIATED');

  return (
    <AppShell title="Supplier Subscription">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-8">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto space-y-2">
          <span className="miljor-section-kicker text-xs uppercase tracking-wider font-semibold block">
            Supplier Subscription &amp; Family Entitlements
          </span>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-[var(--text-primary)]">
            Scale Your Wholesale Food Distribution
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Monthly plans billed in PKR via Safepay. Transaction fees apply separately per settled order.
          </p>
        </div>

        {/* Loading / Error State — never silently pretend STARTER on API failure */}
        {loading ? (
          <div className="max-w-xl mx-auto p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-center text-sm text-[var(--text-secondary)]">
            Loading live subscription plans &amp; entitlements...
          </div>
        ) : loadError ? (
          <div
            role="alert"
            className="max-w-xl mx-auto p-6 rounded-2xl border border-rose-300 dark:border-rose-800 bg-[var(--bg-surface)] text-center space-y-3"
          >
            <AlertTriangle className="w-6 h-6 text-rose-600 dark:text-rose-400 mx-auto" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">{loadError}</p>
            <button
              type="button"
              onClick={loadSubscriptionData}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border border-[var(--border-default)] bg-[var(--bg-card)] cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        ) : (
          <>
            {/* Expiry / Pending Warnings */}
            {subscription?.is_expired && (
              <div className="max-w-3xl mx-auto p-4 rounded-2xl border border-amber-400/50 bg-[var(--bg-surface)] flex items-start gap-3 text-xs">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-[var(--text-primary)]">
                    Your {subscription.configured_plan} subscription has expired.
                  </p>
                  <p className="text-[var(--text-secondary)] mt-0.5">
                    Account entitlements reverted to Starter limits (4 families, 3% fee). Renew via Safepay below.
                  </p>
                </div>
              </div>
            )}

            {(pendingCheckout?.payment || latestPendingPayment) && (
              <div className="max-w-3xl mx-auto p-4 rounded-2xl border border-[var(--brand-accent)] bg-[var(--bg-surface)] flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-start gap-2.5">
                  <Clock className="w-4 h-4 text-[var(--brand-accent)] shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-[var(--text-primary)]">
                      Pending Safepay Checkout ({(pendingCheckout?.payment || latestPendingPayment).plan_code} — PKR{' '}
                      {Number((pendingCheckout?.payment || latestPendingPayment).amount_pkr).toLocaleString()})
                    </p>
                    <p className="text-[var(--text-secondary)]">
                      Order {(pendingCheckout?.payment || latestPendingPayment).order_code} · Complete payment on Safepay, then verify status.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {(pendingCheckout?.checkout_url || latestPendingPayment?.checkout_url) && (
                    <a
                      href={pendingCheckout?.checkout_url || latestPendingPayment?.checkout_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] font-semibold text-[var(--text-primary)]"
                    >
                      <span>Open Safepay</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  <button
                    type="button"
                    disabled={verifyingTracker}
                    onClick={() => handleVerifyPending(pendingCheckout?.payment || latestPendingPayment)}
                    className="landing-gradient-cta px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50"
                  >
                    {verifyingTracker ? 'Verifying...' : 'Verify Payment'}
                  </button>
                </div>
              </div>
            )}

            {/* Current status summary */}
            {subscription && (
              <div className="max-w-2xl mx-auto p-4 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] flex flex-wrap items-center justify-between gap-3 text-xs">
                <div>
                  <span className="text-[var(--text-secondary)]">Current Plan: </span>
                  <span className="font-bold text-[var(--text-primary)]">
                    {subscription.plan_name} ({subscription.plan_code})
                  </span>
                  {subscription.current_period_end && !subscription.is_expired && (
                    <span className="text-[var(--text-muted)] ml-2">
                      · Renews {new Date(subscription.current_period_end).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <div>
                  <span className="text-[var(--text-secondary)]">Families: </span>
                  <span className="font-bold text-[var(--text-primary)]">
                    {usedFamilies} / {maxFamilies}
                  </span>
                  <span className="text-[var(--text-muted)] ml-1.5">
                    ({remainingSlots} slots left · {Number(subscription.transaction_fee_pct)}% fee)
                  </span>
                </div>
              </div>
            )}

            {/* Live Pricing Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {plans.map((p) => {
                const visual = PLAN_VISUALS[p.plan_code] || PLAN_VISUALS.STARTER;
                const Icon = visual.icon;
                const isCurrent = currentPlan === p.plan_code;
                const monthlyPrice = Number(p.monthly_price_pkr || 0);
                const feePct = Number(p.transaction_fee_pct || 0);
                const busy = submittingPlan === p.plan_code;

                return (
                  <div
                    key={p.plan_code}
                    className={`relative rounded-3xl p-7 border transition-all duration-200 flex flex-col justify-between bg-[var(--bg-surface)] ${
                      isCurrent
                        ? 'border-[var(--brand-accent)] ring-2 ring-[var(--brand-accent)]/20 shadow-md'
                        : 'border-[var(--border-default)]'
                    }`}
                  >
                    {visual.popular && !isCurrent && (
                      <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[11px] font-bold bg-[var(--brand-accent)] text-[#17332a] shadow-xs flex items-center gap-1">
                        <Sparkles className="w-3 h-3" /> Most Popular
                      </div>
                    )}
                    {isCurrent && (
                      <div className="miljor-badge-verified absolute -top-3.5 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[11px] font-bold border shadow-xs">
                        Current Plan
                      </div>
                    )}

                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <div className="p-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
                          <Icon className="w-5 h-5 text-emerald-800 dark:text-champagne" />
                        </div>
                        <span className="text-xs font-semibold text-[var(--text-secondary)]">
                          {feePct}% Transaction Fee
                        </span>
                      </div>

                      <h3 className="text-xl font-serif font-bold text-[var(--text-primary)] mb-1">
                        {p.name}
                      </h3>
                      <p className="text-xs text-[var(--text-secondary)] mb-5 min-h-[2.25rem]">
                        {visual.tagline}
                      </p>

                      <div className="flex items-baseline gap-1.5 mb-6">
                        <span className="text-3xl font-serif font-bold text-[var(--text-primary)]">
                          {monthlyPrice === 0 ? 'PKR 0' : `PKR ${monthlyPrice.toLocaleString()}`}
                        </span>
                        <span className="text-xs text-[var(--text-muted)]">
                          {monthlyPrice === 0 ? '/ Free' : '/ month'}
                        </span>
                      </div>

                      <div className="border-t border-[var(--border-subtle)] pt-5 mb-6">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">
                          Included Entitlements ({p.max_active_families} Families)
                        </div>
                        <ul className="space-y-2.5">
                          {visual.highlights.map((feat, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-xs text-[var(--text-primary)]">
                              <Check className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
                              <span>{feat}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isCurrent || Boolean(submittingPlan)}
                      onClick={() => handlePlanAction(p.plan_code)}
                      className={`w-full py-3 px-4 rounded-xl text-xs font-bold transition-all cursor-pointer disabled:cursor-not-allowed ${
                        isCurrent
                          ? 'bg-[var(--bg-card)] text-[var(--text-muted)] border border-[var(--border-subtle)]'
                          : monthlyPrice === 0
                            ? 'border border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-primary)] hover:border-[var(--brand-accent)]'
                            : 'landing-gradient-cta shadow-xs'
                      }`}
                    >
                      {isCurrent
                        ? 'Active Plan'
                        : busy
                          ? 'Processing...'
                          : monthlyPrice === 0
                            ? 'Downgrade to Starter'
                            : `Pay PKR ${monthlyPrice.toLocaleString()} via Safepay`}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Subscription & Payment History */}
            {(payments.length > 0 || billingHistory.length > 0) && (
              <div className="rounded-3xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-6 space-y-4">
                <h2 className="text-base font-serif font-bold text-[var(--text-primary)]">
                  Subscription &amp; Payment History
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-[var(--border-subtle)] text-[var(--text-muted)]">
                        <th className="py-2 pr-4 font-semibold">Reference</th>
                        <th className="py-2 pr-4 font-semibold">Plan</th>
                        <th className="py-2 pr-4 font-semibold">Amount</th>
                        <th className="py-2 pr-4 font-semibold">Status</th>
                        <th className="py-2 pr-4 font-semibold">Date</th>
                        <th className="py-2 font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)]">
                      {payments.map((pay) => (
                        <tr key={`pay-${pay.id}`}>
                          <td className="py-2.5 pr-4 font-mono text-[11px] text-[var(--text-primary)]">
                            {pay.order_code}
                          </td>
                          <td className="py-2.5 pr-4 font-semibold text-[var(--text-primary)]">{pay.plan_code}</td>
                          <td className="py-2.5 pr-4 tabular-nums text-[var(--text-primary)]">
                            PKR {Number(pay.amount_pkr).toLocaleString()}
                          </td>
                          <td className="py-2.5 pr-4">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                                pay.status === 'VERIFIED'
                                  ? 'miljor-badge-verified'
                                  : pay.status === 'PENDING' || pay.status === 'INITIATED'
                                    ? 'miljor-badge-provisional'
                                    : 'border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                              }`}
                            >
                              {pay.status === 'VERIFIED' ? (
                                <CheckCircle2 className="w-3 h-3" />
                              ) : pay.status === 'PENDING' || pay.status === 'INITIATED' ? (
                                <Clock className="w-3 h-3" />
                              ) : (
                                <XCircle className="w-3 h-3" />
                              )}
                              <span>{pay.status}</span>
                            </span>
                          </td>
                          <td className="py-2.5 pr-4 text-[var(--text-secondary)]">
                            {new Date(pay.verified_at || pay.created_at).toLocaleDateString()}
                          </td>
                          <td className="py-2.5">
                            {(pay.status === 'PENDING' || pay.status === 'INITIATED') && (
                              <button
                                type="button"
                                disabled={verifyingTracker}
                                onClick={() => handleVerifyPending(pay)}
                                className="text-[var(--brand-accent)] font-semibold hover:underline cursor-pointer"
                              >
                                Verify
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {billingHistory.slice(0, 5).map((sub) => (
                        <tr key={`sub-${sub.id}`}>
                          <td className="py-2.5 pr-4 text-[var(--text-muted)]">SUB-{sub.id}</td>
                          <td className="py-2.5 pr-4 font-semibold text-[var(--text-primary)]">{sub.plan_code}</td>
                          <td className="py-2.5 pr-4 tabular-nums text-[var(--text-primary)]">
                            PKR {Number(sub.price_pkr || 0).toLocaleString()}
                          </td>
                          <td className="py-2.5 pr-4 text-[var(--text-secondary)]">{sub.status}</td>
                          <td className="py-2.5 pr-4 text-[var(--text-secondary)]">
                            {new Date(sub.current_period_start || sub.created_at).toLocaleDateString()}
                          </td>
                          <td className="py-2.5 text-[var(--text-muted)]">
                            {sub.current_period_end ? `Ends ${new Date(sub.current_period_end).toLocaleDateString()}` : 'Ongoing'}
                          </td>
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
              <div className="text-xs text-[var(--text-secondary)] space-y-1">
                <h5 className="font-semibold text-[var(--text-primary)]">
                  Historical Record Preservation Guarantee
                </h5>
                <p>
                  Upgrading activates your new family quota immediately after Safepay verification. If you downgrade to
                  Starter, existing published products remain preserved and only new additions beyond the cap are gated.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
};

export default SupplierSubscriptionPage;
