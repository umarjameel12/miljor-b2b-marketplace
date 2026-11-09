// =============================================================================
// src/pages/SupplierProfilePage.jsx
// MilJor Package E1: Supplier Business Portal & Profile Management
// Complete working page for wholesale commodity suppliers in Lahore
// =============================================================================
import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AppShell } from '../components/layout/AppShell';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { SupplierVerificationBadge } from '../components/supplier/SupplierVerificationBadge';
import { SupplierOnboardingWizard } from '../components/supplier/SupplierOnboardingWizard';
import SupplierDeliverySettingsForm from '../components/delivery/SupplierDeliverySettingsForm';
import supplierApi from '../api/supplier';
import {
  Building2,
  Truck,
  ShieldCheck,
  AlertCircle,
  Clock,
  Sparkles,
  CreditCard,
  FileText,
  Package,
  Layers,
  ArrowRight
} from 'lucide-react';
import { toast } from 'react-toastify';

export const SupplierProfilePage = () => {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [activeTab, setActiveTab] = useState('onboarding'); // 'onboarding', 'delivery', 'subscription'
  const [error, setError] = useState(null);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await supplierApi.getProfile();
      setProfile(res.data.profile);
    } catch (err) {
      console.error('Failed to load supplier profile:', err);
      setError(err.response?.data?.error?.message || err.message || 'Could not load profile');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login?redirect=/supplier/profile');
      return;
    }

    if (user && user.role !== 'SUPPLIER' && user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      toast.error('Supplier portal is restricted to authorized supplier accounts.');
      navigate('/profile');
      return;
    }

    fetchProfile();
  }, [isAuthenticated, user, navigate]);

  if (loading) {
    return (
      <AppShell title="Supplier Business Profile">
        <div className="max-w-5xl mx-auto space-y-6">
          <Skeleton className="h-32 w-full rounded-2xl" />
          <Skeleton className="h-96 w-full rounded-2xl" />
        </div>
      </AppShell>
    );
  }

  const isVerified = profile?.verification_status === 'VERIFIED';
  const isPending = profile?.verification_status === 'PENDING_REVIEW' || profile?.verification_status === 'UNDER_REVIEW';
  const isRejected = profile?.verification_status === 'REJECTED';

  return (
    <AppShell title="Supplier Business Portal">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Profile Hero Header Card */}
        <Card className="p-6 bg-[var(--bg-card)] border-[var(--border-subtle)] relative overflow-hidden">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="font-display text-xl sm:text-2xl font-bold text-[var(--text-primary)]">
                  {profile?.business_name || user?.business_name || 'Wholesale Supplier Portal'}
                </h1>
                <SupplierVerificationBadge
                  status={profile?.verification_status}
                  level={profile?.verification_level}
                  size="md"
                />
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                {profile?.business_type || 'Wholesale Commodity Distributor'} • {profile?.lahore_service_area || 'Lahore District'}
              </p>
            </div>

            {/* Quick Metrics */}
            <div className="flex items-center gap-3 self-stretch sm:self-auto border-t sm:border-t-0 pt-3 sm:pt-0 border-[var(--border-subtle)]">
              <div className="px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-center flex-1 sm:flex-initial">
                <span className="text-[10px] text-[var(--text-muted)] block uppercase tracking-wider">Plan</span>
                <span className="text-xs font-bold text-[var(--brand-accent)]">{profile?.subscription_plan || 'STARTER'}</span>
              </div>
              <div className="px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-center flex-1 sm:flex-initial">
                <span className="text-[10px] text-[var(--text-muted)] block uppercase tracking-wider">Fee Rate</span>
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{profile?.transaction_fee_percent}%</span>
              </div>
            </div>
          </div>

          {/* Rejection Alert Callout if Rejected */}
          {isRejected && (
            <div className="mt-4 p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-xs text-rose-700 dark:text-rose-300 space-y-1">
              <span className="font-semibold flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                Administrative Review Notice
              </span>
              <p className="leading-relaxed">
                {profile?.rejection_reason || 'Your application requires revisions. Please review the details below, make the necessary corrections, and resubmit for verification.'}
              </p>
            </div>
          )}

          {/* Pending Banner */}
          {isPending && (
            <div className="mt-4 p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2.5">
              <Clock className="w-4 h-4 shrink-0 text-amber-500 mt-0.5" />
              <div className="leading-relaxed">
                <span className="font-semibold block">Application Under Verification Review</span>
                Your business details were submitted on {new Date(profile?.submitted_at).toLocaleDateString()}. MilJor Lahore Operations is processing your trade credentials.
              </div>
            </div>
          )}

          {/* Verified Success Banner */}
          {isVerified && (
            <div className="mt-4 p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-800 dark:text-emerald-200 flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
              <div className="leading-relaxed">
                <span className="font-semibold block">Verified Commercial Supplier</span>
                Your business identity and payout credentials are verified. You are authorized to create listings, publish regular pools, and fulfill buyer orders across Lahore District.
              </div>
            </div>
          )}
        </Card>

        {/* Tab Navigation */}
        <div className="flex border-b border-[var(--border-subtle)] gap-2 sm:gap-4 overflow-x-auto pb-px">
          {[
            { id: 'onboarding', label: 'Business Profile & Verification', icon: Building2 },
            { id: 'delivery', label: 'Lahore Delivery Logistics', icon: Truck },
            { id: 'subscription', label: 'Subscription & Entitlements', icon: Layers },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 py-3 px-3.5 border-b-2 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                  isActive
                    ? 'border-[var(--brand-accent)] text-[var(--brand-accent)] bg-[var(--bg-surface)]'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* TAB 1: BUSINESS PROFILE & ONBOARDING */}
        {activeTab === 'onboarding' && (
          <div className="space-y-6">
            <SupplierOnboardingWizard
              initialProfile={profile}
              onProfileUpdated={(updated) => setProfile(updated)}
            />
          </div>
        )}

        {/* TAB 2: LAHORE DELIVERY LOGISTICS */}
        {activeTab === 'delivery' && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)]">
              <h3 className="font-display text-base font-bold text-[var(--text-primary)]">
                Clustered Delivery Fee Rates & Pickup Hubs
              </h3>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Configure your custom delivery fee matrix across Lahore's 12 geographic clusters and register warehouse physical pickup points.
              </p>
            </div>
            <SupplierDeliverySettingsForm onSaved={fetchProfile} />
          </div>
        )}

        {/* TAB 3: SUBSCRIPTION & ENTITLEMENTS */}
        {activeTab === 'subscription' && (
          <Card className="p-6 space-y-6 bg-[var(--bg-card)] border-[var(--border-subtle)]">
            <div>
              <h3 className="font-display text-lg font-bold text-[var(--text-primary)]">
                Supplier Package & Product Entitlements
              </h3>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                MilJor limits active listings by canonical product family (e.g. Basmati Rice, Wheat Flour, Canola Oil).
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Free Plan */}
              <div
                className={`p-4 rounded-xl border ${
                  profile?.subscription_plan === 'STARTER'
                    ? 'border-[var(--brand-accent)] bg-[var(--brand-accent)]/5 ring-1 ring-[var(--brand-accent)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-sm text-[var(--text-primary)]">Free / Starter</span>
                  {profile?.subscription_plan === 'STARTER' && (
                    <span className="text-[10px] font-bold text-[var(--brand-accent)] bg-[var(--brand-accent)]/10 px-2 py-0.5 rounded-full">
                      CURRENT
                    </span>
                  )}
                </div>
                <div className="text-xl font-bold text-[var(--text-primary)] mb-3">0 PKR</div>
                <ul className="text-xs text-[var(--text-secondary)] space-y-2">
                  <li>• <strong>4</strong> Active Product Families</li>
                  <li>• Multiple Variants per Family</li>
                  <li>• Standard Clustered Delivery</li>
                  <li>• 2.50% Platform Transaction Fee</li>
                </ul>
              </div>

              {/* Growth Plan */}
              <div
                className={`p-4 rounded-xl border ${
                  profile?.subscription_plan === 'GROWTH'
                    ? 'border-[var(--brand-accent)] bg-[var(--brand-accent)]/5 ring-1 ring-[var(--brand-accent)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-sm text-[var(--text-primary)]">Growth</span>
                  {profile?.subscription_plan === 'GROWTH' && (
                    <span className="text-[10px] font-bold text-[var(--brand-accent)] bg-[var(--brand-accent)]/10 px-2 py-0.5 rounded-full">
                      CURRENT
                    </span>
                  )}
                </div>
                <div className="text-xl font-bold text-[var(--text-primary)] mb-3">Enterprise</div>
                <ul className="text-xs text-[var(--text-secondary)] space-y-2">
                  <li>• <strong>13</strong> Active Product Families</li>
                  <li>• Priority Regular Pool Publishing</li>
                  <li>• Express Delivery Cutoffs</li>
                  <li>• 1.50% Platform Transaction Fee</li>
                </ul>
              </div>

              {/* Pro Plan */}
              <div
                className={`p-4 rounded-xl border ${
                  profile?.subscription_plan === 'BUSINESS'
                    ? 'border-[var(--brand-accent)] bg-[var(--brand-accent)]/5 ring-1 ring-[var(--brand-accent)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-sm text-[var(--text-primary)]">Pro / Business</span>
                  {profile?.subscription_plan === 'BUSINESS' && (
                    <span className="text-[10px] font-bold text-[var(--brand-accent)] bg-[var(--brand-accent)]/10 px-2 py-0.5 rounded-full">
                      CURRENT
                    </span>
                  )}
                </div>
                <div className="text-xl font-bold text-[var(--text-primary)] mb-3">Custom</div>
                <ul className="text-xs text-[var(--text-secondary)] space-y-2">
                  <li>• <strong>25</strong> Active Product Families</li>
                  <li>• Dedicated Key Account Manager</li>
                  <li>• Custom Settlement Schedules</li>
                  <li>• 1.00% Platform Transaction Fee</li>
                </ul>
              </div>
            </div>
          </Card>
        )}
      </div>
    </AppShell>
  );
};

export default SupplierProfilePage;
