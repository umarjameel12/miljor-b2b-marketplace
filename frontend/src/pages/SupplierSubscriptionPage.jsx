import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AppShell } from '../components/layout/AppShell';
import {
  Check,
  Shield,
  Zap,
  Crown,
  ArrowRight,
  Sparkles,
  HelpCircle,
  AlertTriangle
} from 'lucide-react';
import { toast } from 'react-toastify';

export const SupplierSubscriptionPage = () => {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [subscription, setSubscription] = useState(null);

  const fetchSubscription = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/v1/supplier/subscription', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSubscription(data.data.entitlements);
      }
    } catch (err) {
      toast.error('Failed to load subscription status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) fetchSubscription();
  }, [token]);

  const handleUpgrade = async (targetPlan) => {
    if (targetPlan === subscription?.current_plan) return;
    try {
      setSubmitting(true);
      const res = await fetch('/api/v1/supplier/subscription/upgrade', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ targetPlan })
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 402) {
          throw new Error(data.error?.message || 'Paid subscription plans require Safepay payment verification. Please complete payment checkout.');
        }
        throw new Error(data.error?.message || 'Plan update failed');
      }
      toast.success(`Successfully updated subscription to ${targetPlan} plan!`);
      await fetchSubscription();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const currentPlan = subscription?.plan_code || subscription?.current_plan || 'STARTER';
  const usedFamilies = subscription?.active_families_count ?? subscription?.used_distinct_families ?? 0;
  const maxFamilies = subscription?.max_allowed_families ?? subscription?.max_families ?? 4;
  const remainingSlots = subscription?.remaining_family_slots ?? subscription?.remaining_slots ?? Math.max(0, maxFamilies - usedFamilies);

  const plans = [
    {
      code: 'STARTER',
      name: 'Starter Plan',
      tagline: 'Ideal for independent producers & single-commodity millers',
      price: 'Free',
      period: 'Standard',
      fee: '5.0%',
      families: 4,
      features: [
        'Up to 4 active canonical product families',
        'Unlimited physical SKUs within allowed families',
        'Standard Lahore cluster order routing',
        'Direct bank escrow settlement (T+2)',
        'Basic operational metrics'
      ],
      icon: Shield,
      popular: false
    },
    {
      code: 'GROWTH',
      name: 'Growth Plan',
      tagline: 'For established distributors expanding bulk B2B restaurant reach',
      price: 'Pricing pending confirmation',
      period: '',
      fee: 'Fee policy pending Phase B11',
      families: 13,
      features: [
        'Up to 13 active canonical product families',
        'Online automated subscription billing scheduled for Phase B11',
        'Priority matching on buyer RFQs & Demand Requests',
        'Flash pool clearance capability',
        'Dedicated dispatch & multi-hub cluster routing',
        'Comprehensive sales & demand forecasting analytics'
      ],
      icon: Zap,
      popular: true
    },
    {
      code: 'BUSINESS',
      name: 'Business Enterprise',
      tagline: 'For major mills, commodity importers & large-scale FMCG wholesalers',
      price: 'Pricing pending confirmation',
      period: '',
      fee: 'Fee policy pending Phase B11',
      families: 25,
      features: [
        'Up to 25 active canonical product families',
        'Online automated subscription billing scheduled for Phase B11',
        'Sponsored catalog placements & promotions',
        'Dedicated Lahore account coordinator',
        'Custom recurring procurement contracts',
        'Standard escrow settlement & API catalog sync'
      ],
      icon: Crown,
      popular: false
    }
  ];

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <span className="text-xs uppercase tracking-wider font-semibold text-[var(--brand-accent)] block mb-2">
            Supplier Subscription & Family Entitlements
          </span>
          <h1 className="text-3xl sm:text-4xl font-serif font-bold text-[var(--text-primary)]">
            Scale Your Wholesale Food Distribution
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-2">
            Each plan grants distinct canonical product family slots. You can publish unlimited pack sizes, brands,
            and SKUs within your authorized family quota.
          </p>
        </div>

        {/* Current status chip */}
        <div className="max-w-xl mx-auto mb-10 p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-center">
          <span className="text-xs text-[var(--text-muted)]">Active Allocation:</span>{' '}
          <span className="font-semibold text-sm text-[var(--text-primary)]">
            {usedFamilies} / {maxFamilies} canonical families active
          </span>
          <span className="text-xs text-[var(--text-muted)] ml-2">
            ({remainingSlots} slots remaining)
          </span>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
          {plans.map((p) => {
            const isCurrent = currentPlan === p.code;
            const Icon = p.icon;

            return (
              <div
                key={p.code}
                className={`relative rounded-3xl p-8 border transition-all duration-200 flex flex-col justify-between ${
                  isCurrent
                    ? 'border-[var(--brand-accent)] bg-[var(--bg-surface)] ring-2 ring-[var(--brand-accent)]/20 shadow-md'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-default)]'
                }`}
              >
                {p.popular && !isCurrent && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[11px] font-bold bg-[var(--brand-accent)] text-stone-900 shadow-xs flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Most Popular
                  </div>
                )}
                {isCurrent && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[11px] font-bold bg-emerald-600 text-white shadow-xs">
                    Current Plan
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 rounded-2xl bg-[var(--bg-card)] text-[var(--brand-accent)]">
                      <Icon className="w-6 h-6" />
                    </div>
                    <span className="text-xs font-semibold text-[var(--text-muted)]">
                      {p.fee} Platform Fee
                    </span>
                  </div>

                  <h3 className="text-xl font-serif font-bold text-[var(--text-primary)] mb-1">
                    {p.name}
                  </h3>
                  <p className="text-xs text-[var(--text-muted)] mb-6 h-10">
                    {p.tagline}
                  </p>

                  <div className="flex items-baseline gap-1 mb-6">
                    <span className="text-3xl font-serif font-bold text-[var(--text-primary)]">
                      {p.price}
                    </span>
                    <span className="text-xs text-[var(--text-muted)]">{p.period}</span>
                  </div>

                  <div className="border-t border-[var(--border-subtle)] pt-6 mb-6">
                    <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">
                      Plan Highlights
                    </div>
                    <ul className="space-y-3">
                      {p.features.map((feat, idx) => (
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
                  disabled={isCurrent || submitting}
                  onClick={() => handleUpgrade(p.code)}
                  className={`w-full py-3 px-4 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    isCurrent
                      ? 'bg-[var(--bg-card)] text-[var(--text-muted)] cursor-not-allowed'
                      : 'bg-[var(--brand-accent)] text-stone-900 hover:opacity-95 shadow-xs'
                  }`}
                >
                  {isCurrent ? 'Active Plan' : submitting ? 'Processing...' : `Switch to ${p.name}`}
                </button>
              </div>
            );
          })}
        </div>

        {/* Business Rule Guarantee */}
        <div className="p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] max-w-3xl mx-auto flex items-start gap-4">
          <HelpCircle className="w-5 h-5 text-[var(--brand-accent)] shrink-0 mt-0.5" />
          <div className="text-xs text-[var(--text-muted)] space-y-1">
            <h5 className="font-semibold text-[var(--text-primary)]">
              Historical Record Preservation Guarantee
            </h5>
            <p>
              When upgrading, your new family limits take effect immediately without interrupting ongoing pools.
              If you ever downgrade, MilJor never deletes or truncates existing products or historical records.
              Any existing published families remain live, and only subsequent additions beyond the new cap are gated.
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
};
