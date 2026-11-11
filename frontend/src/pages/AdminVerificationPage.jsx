// =============================================================================
// src/pages/AdminVerificationPage.jsx
// MilJor Package E1.1 Gate B: Complete Admin Verification Interface
// Authorized for: SUPER_ADMIN, VERIFICATION_ADMIN, ADMIN
// =============================================================================
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AppShell } from '../components/layout/AppShell';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import adminApi from '../api/admin';
import {
  ShieldCheck,
  AlertCircle,
  Clock,
  CheckCircle,
  XCircle,
  Building2,
  Phone,
  Mail,
  MapPin,
  CreditCard,
  FileText,
  User,
  RefreshCw,
  X,
  AlertTriangle
} from 'lucide-react';
import { toast } from 'react-toastify';

export const AdminVerificationPage = () => {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [suppliers, setSuppliers] = useState([]);
  const [error, setError] = useState(null);

  // Modal states
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [modalMode, setModalMode] = useState(null); // 'approve' | 'reject' | null
  const [submitting, setSubmitting] = useState(false);

  // Plan-to-default listings mapping (MilJor Package E: Starter 4, Growth 13, Business 25)
  const PLAN_LISTING_CAPS = {
    STARTER: 4,
    GROWTH: 13,
    BUSINESS: 25
  };

  // Approval form state
  const [approvalForm, setApprovalForm] = useState({
    verification_level: 'LEVEL_2_BUSINESS',
    subscription_plan: 'GROWTH',
    max_active_listings: 13,
    transaction_fee_percent: 1.5
  });

  // Rejection form state
  const [rejectionReason, setRejectionReason] = useState('');

  const isAuthorizedAdmin =
    user && ['SUPER_ADMIN', 'VERIFICATION_ADMIN', 'ADMIN'].includes(user.role);

  const fetchPendingSuppliers = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await adminApi.getPendingSuppliers();
      setSuppliers(res.data.suppliers || []);
    } catch (err) {
      console.error('Failed to load pending suppliers:', err);
      setError(
        err.response?.data?.error?.message ||
        err.message ||
        'Failed to fetch pending applications'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated && isAuthorizedAdmin) {
      fetchPendingSuppliers();
    }
  }, [isAuthenticated, isAuthorizedAdmin]);

  const handleOpenApprove = (supplier) => {
    setSelectedSupplier(supplier);
    const plan = supplier.subscription_plan || 'GROWTH';
    setApprovalForm({
      verification_level: supplier.verification_level || 'LEVEL_2_BUSINESS',
      subscription_plan: plan,
      max_active_listings: supplier.max_active_listings || PLAN_LISTING_CAPS[plan] || 13,
      transaction_fee_percent: supplier.transaction_fee_percent || 1.5
    });
    setModalMode('approve');
  };

  const handlePlanChange = (newPlan) => {
    setApprovalForm((prev) => ({
      ...prev,
      subscription_plan: newPlan,
      max_active_listings: PLAN_LISTING_CAPS[newPlan] || 4
    }));
  };

  const handleOpenReject = (supplier, mode = 'reject') => {
    setSelectedSupplier(supplier);
    setRejectionReason('');
    setModalMode(mode);
  };

  const handleCloseModal = () => {
    setSelectedSupplier(null);
    setModalMode(null);
    setRejectionReason('');
  };

  const handleSubmitApproval = async (e) => {
    e.preventDefault();
    if (!selectedSupplier) return;

    try {
      setSubmitting(true);
      await adminApi.verifySupplier(selectedSupplier.supplier_id, {
        verification_status: 'VERIFIED',
        verification_level: approvalForm.verification_level,
        subscription_plan: approvalForm.subscription_plan,
        max_active_listings: parseInt(approvalForm.max_active_listings, 10),
        transaction_fee_percent: parseFloat(approvalForm.transaction_fee_percent)
      });

      toast.success(
        `Supplier "${selectedSupplier.business_name || selectedSupplier.full_name}" successfully verified!`
      );
      handleCloseModal();
      fetchPendingSuppliers();
    } catch (err) {
      console.error('Verification error:', err);
      toast.error(
        err.response?.data?.error?.message ||
        err.message ||
        'Failed to verify supplier'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitRejection = async (e) => {
    e.preventDefault();
    if (!selectedSupplier) return;

    if (!rejectionReason.trim()) {
      toast.error('Please specify a rejection reason for the supplier.');
      return;
    }

    try {
      setSubmitting(true);
      await adminApi.verifySupplier(selectedSupplier.supplier_id, {
        verification_status: modalMode === 'request-info' ? 'MORE_INFORMATION_REQUIRED' : 'REJECTED',
        rejection_reason: rejectionReason.trim()
      });

      toast.info(modalMode === 'request-info' ? 'More information requested. Supplier can see the guidance.' : 'Application rejected and reason recorded.');
      handleCloseModal();
      fetchPendingSuppliers();
    } catch (err) {
      console.error('Rejection error:', err);
      toast.error(
        err.response?.data?.error?.message ||
        err.message ||
        'Failed to reject application'
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!isAuthenticated || !isAuthorizedAdmin) {
    return (
      <AppShell>
        <div className="max-w-4xl mx-auto px-4 py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 text-red-500 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Administrative Access Required</h1>
          <p className="text-sm opacity-70 mb-6 max-w-md mx-auto">
            You must be logged in with VERIFICATION_ADMIN, SUPER_ADMIN or authorized role credentials to access this portal.
          </p>
          <Button onClick={() => navigate('/login')}>Sign in with Admin Credentials</Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[var(--border-subtle)]">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400">
                Administration
              </span>
              <span className="text-xs text-[var(--text-muted)]">• Package E1.1 Gate B</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
              Supplier Verification Queue
            </h1>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              Review and decision Lahore wholesale supplier business onboarding submissions.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/admin/catalog')}
              className="gap-2"
            >
              Catalog Governance & Requests
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchPendingSuppliers}
              disabled={loading}
              className="gap-2"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <div className="px-3.5 py-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] text-xs font-semibold">
              Pending Reviews: <span className="text-[var(--brand-accent)]">{suppliers.length}</span>
            </div>
          </div>
        </div>

        {/* Content Body */}
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-40 w-full rounded-2xl" />
            <Skeleton className="h-40 w-full rounded-2xl" />
          </div>
        ) : error ? (
          <div className="p-6 rounded-2xl border border-red-500/20 bg-red-500/5 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-red-500 mx-auto" />
            <p className="text-sm font-semibold text-red-500">{error}</p>
            <Button size="sm" onClick={fetchPendingSuppliers}>Retry</Button>
          </div>
        ) : suppliers.length === 0 ? (
          <Card className="p-12 text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center mx-auto">
              <CheckCircle className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-lg font-bold">Verification Queue Clear</h3>
              <p className="text-xs opacity-70 mt-1 max-w-sm mx-auto">
                There are no pending supplier verification submissions awaiting review at this time.
              </p>
            </div>
          </Card>
        ) : (
          <div className="space-y-4">
            {suppliers.map((s) => {
              const isSelf = user?.id === s.supplier_id;
              const isReadyForReview = s.verification_status === 'PENDING_REVIEW';

              return (
                <Card
                  key={s.supplier_id}
                  className="p-6 transition-all hover:border-[var(--brand-accent)]/50"
                >
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
                    {/* Left: Supplier info */}
                    <div className="space-y-4 flex-1">
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-lg font-bold text-[var(--text-primary)]">
                          {s.business_name || s.full_name}
                        </h3>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                            s.verification_status === 'PENDING_REVIEW'
                              ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400'
                              : s.verification_status === 'UNDER_REVIEW'
                              ? 'bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400'
                              : 'bg-zinc-500/10 border-zinc-500/30 text-zinc-600 dark:text-zinc-400'
                          }`}
                        >
                          {s.verification_status.replace(/_/g, ' ')}
                        </span>
                        {s.business_type && (
                          <span className="px-2 py-0.5 rounded-md text-[11px] bg-black/5 dark:bg-white/5 font-medium">
                            {s.business_type}
                          </span>
                        )}
                      </div>

                      {s.business_description && (
                        <p className="text-xs text-[var(--text-secondary)] line-clamp-2">
                          {s.business_description}
                        </p>
                      )}

                      {/* Detail Grids */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                        <div className="p-3 rounded-xl bg-black/5 dark:bg-white/5 space-y-1">
                          <span className="font-semibold text-[var(--text-muted)] flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5" /> Contact Person
                          </span>
                          <p className="font-medium text-[var(--text-primary)]">
                            {s.contact_person_name || s.full_name}
                          </p>
                          <p className="text-[11px] text-[var(--text-secondary)] flex items-center gap-1">
                            <Phone className="w-3 h-3" /> {s.contact_person_phone || s.phone || 'N/A'}
                          </p>
                          <p className="text-[11px] text-[var(--text-secondary)] flex items-center gap-1 truncate">
                            <Mail className="w-3 h-3" /> {s.email}
                          </p>
                        </div>

                        <div className="p-3 rounded-xl bg-black/5 dark:bg-white/5 space-y-1">
                          <span className="font-semibold text-[var(--text-muted)] flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5" /> Logistics & Location
                          </span>
                          <p className="font-medium text-[var(--text-primary)] truncate">
                            Area: {s.lahore_service_area || s.area || 'All Lahore'}
                          </p>
                          <p className="text-[11px] text-[var(--text-secondary)] line-clamp-2">
                            Pickup: {s.warehouse_address || s.address || 'Address unlisted'}
                          </p>
                        </div>

                        <div className="p-3 rounded-xl bg-black/5 dark:bg-white/5 space-y-1">
                          <span className="font-semibold text-[var(--text-muted)] flex items-center gap-1.5">
                            <CreditCard className="w-3.5 h-3.5" /> Banking & Tax
                          </span>
                          <p className="font-medium text-[var(--text-primary)] truncate">
                            {s.bank_name || 'No Bank'} • {s.bank_account_title || 'N/A'}
                          </p>
                          <p className="text-[11px] text-[var(--text-secondary)] font-mono">
                            IBAN: {s.bank_iban_masked || 'Not on file'}
                          </p>
                          <p className="text-[11px] text-[var(--text-secondary)]">
                            NTN: <span className="font-mono">{s.tax_ntn || 'Exempt / Not Provided'}</span>
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-4 text-[11px] text-[var(--text-muted)] pt-1">
                        <span>Submitted: {s.submitted_at ? new Date(s.submitted_at).toLocaleString() : 'Draft stage'}</span>
                        <span>•</span>
                        <span>Registered: {new Date(s.created_at).toLocaleDateString()}</span>
                        {s.food_license_type && (
                          <>
                            <span>•</span>
                            <span className="font-medium text-[var(--brand-accent)]">
                              License: {s.food_license_type}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex flex-col sm:flex-row lg:flex-col gap-2 min-w-[180px] shrink-0 border-t lg:border-t-0 lg:border-l border-[var(--border-subtle)] pt-4 lg:pt-0 lg:pl-6 justify-center">
                      {isSelf && (
                        <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-[11px] font-medium flex items-center gap-1.5 mb-1">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          Self-approval prohibited
                        </div>
                      )}

                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => handleOpenApprove(s)}
                        disabled={isSelf}
                        className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                      >
                        <CheckCircle className="w-4 h-4" />
                        Approve Supplier
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenReject(s, 'request-info')}
                        disabled={isSelf}
                        className="gap-2"
                      >
                        <FileText className="w-4 h-4" />
                        Request Info
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenReject(s)}
                        disabled={isSelf}
                        className="gap-2 border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10"
                      >
                        <XCircle className="w-4 h-4" />
                        Reject
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Approve Modal */}
      {modalMode === 'approve' && selectedSupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] w-full max-w-lg rounded-2xl shadow-2xl p-6 space-y-5 animate-in fade-in-50 zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)]">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-base text-[var(--text-primary)]">
                  Approve Supplier Verification
                </h3>
              </div>
              <button
                onClick={handleCloseModal}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-[var(--text-secondary)]">
              You are approving <span className="font-bold text-[var(--text-primary)]">{selectedSupplier.business_name || selectedSupplier.full_name}</span> as a verified wholesale seller on MilJor.
            </p>

            <form onSubmit={handleSubmitApproval} className="space-y-4 text-xs">
              <div>
                <label className="font-semibold block mb-1">Verification Level</label>
                <select
                  value={approvalForm.verification_level}
                  onChange={(e) =>
                    setApprovalForm({ ...approvalForm, verification_level: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)]"
                >
                  <option value="LEVEL_1_CONTACT">Level 1: Contact & Identity Verified</option>
                  <option value="LEVEL_2_BUSINESS">Level 2: Business & Warehouse Verified (Standard)</option>
                  <option value="LEVEL_3_QUALITY">Level 3: Full Food Quality & Safety Certified</option>
                </select>
              </div>

              <div>
                <label className="font-semibold block mb-1">Subscription Plan</label>
                <select
                  value={approvalForm.subscription_plan}
                  onChange={(e) => handlePlanChange(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)]"
                >
                  <option value="STARTER">Starter Tier (Up to 4 active listings — Free)</option>
                  <option value="GROWTH">Growth Tier (Up to 13 active listings)</option>
                  <option value="BUSINESS">Business Tier (Up to 25 active listings — Pro)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold block mb-1">Max Active Listings</label>
                  <input
                    type="number"
                    value={approvalForm.max_active_listings}
                    onChange={(e) =>
                      setApprovalForm({ ...approvalForm, max_active_listings: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)]"
                    min="1"
                    max={PLAN_LISTING_CAPS[approvalForm.subscription_plan] || 4}
                  />
                  <span className="text-[10px] text-[var(--text-muted)] block mt-0.5">
                    Authorized cap: {PLAN_LISTING_CAPS[approvalForm.subscription_plan] || 4}
                  </span>
                </div>
                <div>
                  <label className="font-semibold block mb-1">Transaction Fee %</label>
                  <input
                    type="number"
                    step="0.01"
                    value={approvalForm.transaction_fee_percent}
                    onChange={(e) =>
                      setApprovalForm({
                        ...approvalForm,
                        transaction_fee_percent: e.target.value
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)]"
                    min="0"
                    max="10"
                  />
                </div>
              </div>

              <div className="pt-4 flex justify-end gap-3 border-t border-[var(--border-subtle)]">
                <Button type="button" variant="outline" onClick={handleCloseModal} disabled={submitting}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={submitting}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                >
                  {submitting ? 'Approving...' : 'Confirm Approval'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {(modalMode === 'reject' || modalMode === 'request-info') && selectedSupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] w-full max-w-lg rounded-2xl shadow-2xl p-6 space-y-5 animate-in fade-in-50 zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)]">
              <div className="flex items-center gap-2">
                <XCircle className="w-5 h-5 text-red-600" />
                <h3 className="font-bold text-base text-[var(--text-primary)]">
                  {modalMode === 'request-info' ? 'Request Additional Information' : 'Reject Supplier Application'}
                </h3>
              </div>
              <button
                onClick={handleCloseModal}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-[var(--text-secondary)]">
              Specify the explicit reason for rejecting or requiring resubmission from{' '}
              <span className="font-bold text-[var(--text-primary)]">
                {selectedSupplier.business_name || selectedSupplier.full_name}
              </span>
              . This will be visible on their onboarding portal.
            </p>

            <form onSubmit={handleSubmitRejection} className="space-y-4 text-xs">
              <div>
                <label className="font-semibold block mb-1">
                  Rejection Reason / Guidance <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={4}
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="e.g. Please provide a clear copy of your Food Business License or update your warehouse pickup address with your valid Lahore zone..."
                  className="w-full px-3 py-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)]"
                  required
                />
              </div>

              <div className="pt-4 flex justify-end gap-3 border-t border-[var(--border-subtle)]">
                <Button type="button" variant="outline" onClick={handleCloseModal} disabled={submitting}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={submitting}
                  className="bg-red-600 hover:bg-red-700 text-white font-semibold"
                >
                  {submitting ? 'Submitting...' : (modalMode === 'request-info' ? 'Request Information' : 'Reject Application')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
};

export default AdminVerificationPage;
