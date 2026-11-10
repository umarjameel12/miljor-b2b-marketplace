import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AppShell } from '../components/layout/AppShell';
import {
  TrendingUp,
  Package,
  Layers,
  FileText,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  Zap,
  CheckCircle2,
  Clock,
  Sparkles
} from 'lucide-react';
import { toast } from 'react-toastify';

export const SupplierDashboardPage = () => {
  const { user, token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState(null);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [subRes, profRes] = await Promise.all([
          fetch('/api/v1/supplier/subscription', {
            headers: { Authorization: `Bearer ${token}` }
          }),
          fetch('/api/v1/supplier/profile', {
            headers: { Authorization: `Bearer ${token}` }
          })
        ]);

        if (subRes.ok) {
          const subData = await subRes.json();
          setSubscription(subData.data.entitlements);
        }
        if (profRes.ok) {
          const profData = await profRes.json();
          setProfile(profData.data.profile);
        }
      } catch (err) {
        toast.error('Failed to load supplier dashboard data');
      } finally {
        setLoading(false);
      }
    };

    if (token) {
      fetchData();
    }
  }, [token]);

  const maxFam = subscription?.max_families || 4;
  const usedFam = subscription?.used_distinct_families || 0;
  const remainingFam = subscription?.remaining_slots !== undefined ? subscription.remaining_slots : Math.max(0, maxFam - usedFam);
  const percentUsed = Math.min(100, Math.round((usedFam / maxFam) * 100));

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {/* Welcome Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs uppercase tracking-wider font-semibold text-[var(--brand-accent)]">
                Supplier Operations Hub
              </span>
              {profile?.verification_status === 'VERIFIED' && (
                <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-medium">
                  <ShieldCheck className="w-3.5 h-3.5" /> Verified Supplier
                </span>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-serif font-bold text-[var(--text-primary)]">
              {profile?.business_name || user?.business_name || user?.full_name || 'Supplier Portal'}
            </h1>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              Manage product catalog, active family slots, pools, RFQs, and collective delivery logistics across Lahore.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              to="/supplier/catalog"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--brand-accent)] text-stone-900 text-sm font-semibold hover:opacity-95 shadow-xs transition-opacity"
            >
              <Package className="w-4 h-4" />
              Manage Catalog
            </Link>
          </div>
        </div>

        {/* Over limit warning */}
        {subscription?.is_over_limit && (
          <div className="mb-6 p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                Active Catalog Exceeds Current Plan Allowance
              </h4>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                You currently have {usedFam} active canonical families published, but your plan limit is {maxFam}.
                Existing published products and pools remain live, but publishing new families is paused until you upgrade.
              </p>
              <Link
                to="/supplier/subscription"
                className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400 hover:underline mt-2"
              >
                Upgrade to Growth or Business Plan <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        )}

        {/* Grid Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {/* Entitlements Card */}
          <div className="p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Catalog Allowance
              </span>
              <span className="text-xs px-2.5 py-1 rounded-full font-bold bg-[var(--brand-accent)]/15 text-[var(--brand-accent)]">
                {subscription?.current_plan || 'STARTER'}
              </span>
            </div>
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-3xl font-serif font-bold text-[var(--text-primary)]">
                {usedFam}
              </span>
              <span className="text-sm text-[var(--text-muted)]">
                / {maxFam} families used
              </span>
            </div>
            {/* Progress Bar */}
            <div className="w-full bg-[var(--bg-card)] h-2 rounded-full overflow-hidden mb-3">
              <div
                className={`h-full transition-all duration-300 ${
                  percentUsed >= 100 ? 'bg-amber-500' : 'bg-emerald-500'
                }`}
                style={{ width: `${percentUsed}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
              <span>{remainingFam} slots available</span>
              <Link to="/supplier/subscription" className="text-[var(--brand-accent)] hover:underline font-medium">
                Manage Plan
              </Link>
            </div>
          </div>

          {/* Quick Actions Card */}
          <div className="p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xs flex flex-col justify-between">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] block mb-3">
                Procurement Channels
              </span>
              <div className="space-y-2">
                <Link
                  to="/rfqs"
                  className="flex items-center justify-between p-2.5 rounded-xl hover:bg-[var(--bg-card)] transition-colors text-xs font-medium text-[var(--text-primary)]"
                >
                  <span className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-emerald-600" /> Open RFQs & Quotes
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                </Link>
                <Link
                  to="/flash-pools"
                  className="flex items-center justify-between p-2.5 rounded-xl hover:bg-[var(--bg-card)] transition-colors text-xs font-medium text-[var(--text-primary)]"
                >
                  <span className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-500" /> Flash Clearance Deals
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                </Link>
                <Link
                  to="/demand-requests"
                  className="flex items-center justify-between p-2.5 rounded-xl hover:bg-[var(--bg-card)] transition-colors text-xs font-medium text-[var(--text-primary)]"
                >
                  <span className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-blue-500" /> Buyer Requested Pools
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                </Link>
              </div>
            </div>
          </div>

          {/* Verification & Trust */}
          <div className="p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xs flex flex-col justify-between">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] block mb-3">
                Trust & Verification
              </span>
              <div className="flex items-center gap-3 mb-3">
                <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-600">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <div className="text-sm font-bold text-[var(--text-primary)]">
                    {profile?.verification_status === 'VERIFIED' ? 'Verified Tier 1 Supplier' : 'Verification In Progress'}
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    NTN: {profile?.tax_ntn || 'Verified at Onboarding'}
                  </div>
                </div>
              </div>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                Bank IBAN encrypted with AES-256-GCM. Payouts processed automatically upon buyer delivery confirmation.
              </p>
            </div>
            <Link
              to="/supplier/profile"
              className="mt-4 text-xs font-semibold text-[var(--brand-accent)] hover:underline inline-flex items-center gap-1"
            >
              View Verified Profile & Banking <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
};
