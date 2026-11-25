// =============================================================================
// src/pages/SupplierOnboardingPage.jsx
// MilJor Package E1: Supplier Dedicated Onboarding Flow
// Clean focused onboarding flow for new or unverified suppliers
// =============================================================================
import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AppShell } from '../components/layout/AppShell';
import { Card } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { SupplierVerificationBadge } from '../components/supplier/SupplierVerificationBadge';
import { SupplierOnboardingWizard } from '../components/supplier/SupplierOnboardingWizard';
import supplierApi from '../api/supplier';
import { ShieldCheck, ArrowLeft } from 'lucide-react';
import { toast } from 'react-toastify';

export const SupplierOnboardingPage = () => {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      const res = await supplierApi.getProfile();
      setProfile(res.data.profile);
    } catch (err) {
      console.error('Failed to load supplier profile for onboarding:', err);
      toast.error('Could not load profile. Please sign in as a supplier.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login?redirect=/supplier/onboarding');
      return;
    }

    if (user && user.role !== 'SUPPLIER' && user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      toast.error('Supplier onboarding is reserved for supplier accounts.');
      navigate('/profile');
      return;
    }

    fetchProfile();
  }, [isAuthenticated, user, navigate]);

  if (loading) {
    return (
      <AppShell title="Supplier Onboarding">
        <div className="max-w-4xl mx-auto space-y-6">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-96 w-full rounded-2xl" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Supplier Verification Onboarding">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <Link
            to="/supplier/profile"
            className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Supplier Portal</span>
          </Link>
          <SupplierVerificationBadge
            status={profile?.verification_status}
            level={profile?.verification_level}
            size="sm"
          />
        </div>

        <div className="space-y-1">
          <h1 className="font-display text-2xl font-bold text-[var(--text-primary)]">
            Wholesale Supplier Verification Onboarding
          </h1>
          <p className="text-xs text-[var(--text-secondary)]">
            Complete your trade credentials and payout banking details to publish commodities across Lahore District.
          </p>
        </div>

        <SupplierOnboardingWizard
          initialProfile={profile}
          onProfileUpdated={(updated) => setProfile(updated)}
        />
      </div>
    </AppShell>
  );
};

export default SupplierOnboardingPage;
