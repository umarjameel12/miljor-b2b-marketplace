// =============================================================================
// src/pages/SupplierProfilePage.jsx
// MilJor Package E1: Supplier Business Portal & Profile Management
// =============================================================================
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Package,
  Layers,
  ArrowRight,
  Check,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'react-toastify';

const TABS = [
  { id: 'onboarding', label: 'Business Profile', icon: Building2 },
  { id: 'delivery', label: 'Delivery & Hubs', icon: Truck },
  { id: 'subscription', label: 'Plan & Limits', icon: Layers },
];

const PLANS = [
  {
    id: 'STARTER',
    name: 'Starter',
    price: '0 PKR',
    features: [
      '4 active product families',
      'Multiple variants per family',
      'Clustered Lahore delivery',
      '2.50% transaction fee',
    ],
  },
  {
    id: 'GROWTH',
    name: 'Growth',
    price: 'Enterprise',
    features: [
      '13 active product families',
      'Priority pool publishing',
      'Express delivery cutoffs',
      '1.50% transaction fee',
    ],
  },
  {
    id: 'BUSINESS',
    name: 'Business',
    price: 'Custom',
    features: [
      '25 active product families',
      'Dedicated account manager',
      'Custom settlement schedule',
      '1.00% transaction fee',
    ],
  },
];

export const SupplierProfilePage = () => {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [activeTab, setActiveTab] = useState('onboarding');
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
      <AppShell title="Supplier Profile">
        <div className="max-w-5xl mx-auto space-y-6">
          <Skeleton className="h-32 w-full rounded-2xl" />
          <Skeleton className="h-96 w-full rounded-2xl" />
        </div>
      </AppShell>
    );
  }

  if (error && !profile) {
    return (
      <AppShell title="Supplier Profile">
        <div className="max-w-5xl mx-auto">
          <Card className="p-8 bg-[var(--bg-card)] border-[var(--border-subtle)] text-center space-y-4">
            <AlertCircle className="w-6 h-6 mx-auto text-rose-500" />
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">Unable to load supplier profile</h2>
              <p className="text-xs text-[var(--text-secondary)]">{error}</p>
            </div>
            <Button size="sm" onClick={fetchProfile}>Try again</Button>
          </Card>
        </div>
      </AppShell>
    );
  }

  const status = profile?.verification_status;
  const isVerified = status === 'VERIFIED';
  const isPending = status === 'PENDING_REVIEW' || status === 'UNDER_REVIEW';
  const isRejected = status === 'REJECTED';

  const statusNotice = isRejected
    ? {
        dot: 'bg-rose-500',
        title: 'Verification needs updates',
        text: profile?.rejection_reason || 'Review your business details below and resubmit.',
      }
    : isPending
      ? {
          dot: 'bg-amber-500',
          title: 'Verification in review',
          text: profile?.submitted_at
            ? `Submitted ${new Date(profile.submitted_at).toLocaleDateString()}.`
            : 'Credentials are being reviewed by MilJor Operations.',
        }
      : isVerified
        ? {
            dot: 'bg-emerald-500',
            title: 'Verified supplier',
            text: 'Authorized to publish listings, open pools, and fulfill orders in Lahore.',
          }
        : null;

  return (
    <AppShell title="Supplier Profile">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Minimal Profile Header */}
        <Card className="p-6 sm:p-7 bg-[var(--bg-card)] border-[var(--border-subtle)] rounded-2xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
            <div className="space-y-1.5 min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="font-display text-xl sm:text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
                  {profile?.business_name || user?.business_name || 'Supplier Portal'}
                </h1>
                <SupplierVerificationBadge
                  status={profile?.verification_status}
                  level={profile?.verification_level}
                  size="md"
                />
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                {profile?.business_type || 'Wholesale Distributor'} · {profile?.lahore_service_area || 'Lahore'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 self-stretch sm:self-auto pt-3 sm:pt-0 border-t sm:border-t-0 border-[var(--border-subtle)]">
              <div className="px-3.5 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-center flex-1 sm:flex-initial">
                <span className="text-[10px] text-[var(--text-muted)] block uppercase tracking-wider">Plan</span>
                <span className="text-xs font-semibold text-[var(--text-primary)]">
                  {profile?.subscription_plan || 'STARTER'}
                </span>
              </div>
              <div className="px-3.5 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-center flex-1 sm:flex-initial">
                <span className="text-[10px] text-[var(--text-muted)] block uppercase tracking-wider">Fee</span>
                <span className="text-xs font-semibold tabular-nums text-[var(--text-primary)]">
                  {profile?.transaction_fee_percent ?? '2.5'}%
                </span>
              </div>
              <Button
                size="sm"
                onClick={() => navigate('/supplier/catalog')}
                className="text-xs whitespace-nowrap shrink-0"
              >
                Catalog &amp; Offers
              </Button>
            </div>
          </div>

          {statusNotice && (
            <div className="mt-5 pt-4 border-t border-[var(--border-subtle)] flex items-start gap-2.5 text-xs">
              <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${statusNotice.dot}`} aria-hidden="true" />
              <p className="text-[var(--text-secondary)] leading-relaxed">
                <span className="font-semibold text-[var(--text-primary)] mr-1.5">{statusNotice.title}.</span>
                {statusNotice.text}
              </p>
            </div>
          )}
        </Card>

        {/* Minimal Underline Tab Navigation */}
        <div className="flex border-b border-[var(--border-subtle)] gap-6 overflow-x-auto" role="tablist">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 py-3 px-1 border-b-2 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                  isActive
                    ? 'border-[var(--brand-accent)] text-[var(--text-primary)]'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* TAB 1: BUSINESS PROFILE */}
        {activeTab === 'onboarding' && (
          <SupplierOnboardingWizard
            initialProfile={profile}
            onProfileUpdated={(updated) => setProfile(updated)}
          />
        )}

        {/* TAB 2: DELIVERY & HUBS */}
        {activeTab === 'delivery' && (
          <div className="space-y-4">
            <div className="px-1">
              <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                Delivery Rates &amp; Pickup Hubs
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                Set cluster delivery fees and warehouse pickup locations across Lahore.
              </p>
            </div>
            <SupplierDeliverySettingsForm onSaved={fetchProfile} />
          </div>
        )}

        {/* TAB 3: PLAN & LIMITS */}
        {activeTab === 'subscription' && (
          <Card className="p-6 sm:p-7 space-y-6 bg-[var(--bg-card)] border-[var(--border-subtle)] rounded-2xl">
            <div>
              <h2 className="font-display text-lg font-semibold text-[var(--text-primary)]">
                Plan &amp; Product Limits
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                Active listings are counted by canonical product family.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {PLANS.map((plan) => {
                const isCurrent = profile?.subscription_plan === plan.id;
                return (
                  <div
                    key={plan.id}
                    className={`p-5 rounded-xl border transition-colors ${
                      isCurrent
                        ? 'border-[var(--brand-accent)] bg-[var(--bg-surface)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]/50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-sm text-[var(--text-primary)]">{plan.name}</span>
                      {isCurrent && (
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--brand-accent)]">
                          Current
                        </span>
                      )}
                    </div>
                    <div className="text-xl font-bold tabular-nums text-[var(--text-primary)] mb-4">
                      {plan.price}
                    </div>
                    <ul className="text-xs text-[var(--text-secondary)] space-y-2">
                      {plan.features.map((feat) => (
                        <li key={feat} className="flex items-center gap-2">
                          <Check className="w-3.5 h-3.5 shrink-0 text-[var(--brand-accent)]" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>
    </AppShell>
  );
};

export default SupplierProfilePage;
