// =============================================================================
// src/pages/AdminCatalogPage.jsx
// MilJor Package E2: Admin Catalog Governance & Moderation Queue Interface
// Authorized for: SUPER_ADMIN, OPERATIONS_ADMIN, VERIFICATION_ADMIN, ADMIN
// =============================================================================
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AppShell } from '../components/layout/AppShell';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import catalogApi from '../api/catalog';
import {
  ShieldCheck,
  Layers,
  Package,
  FileText,
  CheckCircle2,
  XCircle,
  Clock,
  Plus,
  RefreshCw,
  AlertTriangle,
  ArrowLeft,
  Eye,
  X
} from 'lucide-react';
import { toast } from 'react-toastify';

export const AdminCatalogPage = () => {
  const { user, isAuthenticated } = useAuth();

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('requests'); // 'requests' | 'families' | 'categories'

  const [requests, setRequests] = useState([]);
  const [categories, setCategories] = useState([]);
  const [families, setFamilies] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');

  // Reject Modal State
  const [rejectingRequest, setRejectingRequest] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [submittingAction, setSubmittingAction] = useState(false);

  // Create Category Modal
  const [createCategoryOpen, setCreateCategoryOpen] = useState(false);
  const [newCategoryForm, setNewCategoryForm] = useState({
    name: '',
    urdu_name: '',
    description: '',
    display_order: 100
  });

  // Create Family Modal
  const [createFamilyOpen, setCreateFamilyOpen] = useState(false);
  const [newFamilyForm, setNewFamilyForm] = useState({
    category_id: '',
    name: '',
    urdu_name: '',
    description: '',
    allowed_pack_units: 'kg, g',
    allowed_purchasing_units: 'bag, sack'
  });

  const isAuthorizedAdmin =
    user && ['SUPER_ADMIN', 'OPERATIONS_ADMIN', 'VERIFICATION_ADMIN', 'ADMIN'].includes(user.role);

  const loadAdminCatalogData = async () => {
    try {
      setLoading(true);
      const [reqRes, catRes, famRes] = await Promise.all([
        catalogApi.adminGetCatalogRequests(statusFilter ? { status: statusFilter } : {}),
        catalogApi.adminGetCategories(),
        catalogApi.adminGetFamilies()
      ]);

      const loadedCats = catRes.data?.categories || [];
      setRequests(reqRes.data?.requests || []);
      setCategories(loadedCats);
      setFamilies(famRes.data?.families || []);

      if (loadedCats.length > 0 && !newFamilyForm.category_id) {
        setNewFamilyForm(prev => ({ ...prev, category_id: String(loadedCats[0].id) }));
      }
    } catch (err) {
      console.error('Failed to load admin catalog data:', err);
      toast.error(err.response?.data?.error?.message || 'Failed to load catalog moderation data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated && isAuthorizedAdmin) {
      loadAdminCatalogData();
    } else {
      setLoading(false);
    }
  }, [isAuthenticated, isAuthorizedAdmin, statusFilter]);

  if (!isAuthenticated || !isAuthorizedAdmin) {
    return (
      <AppShell title="Catalog Governance Restricted">
        <div className="max-w-xl mx-auto py-16">
          <Card className="p-8 text-center space-y-4">
            <AlertTriangle className="w-10 h-10 text-rose-500 mx-auto" />
            <h1 className="text-xl font-bold text-[var(--text-primary)]">
              Administrative Privileges Required
            </h1>
            <p className="text-xs text-[var(--text-secondary)]">
              This governance console is restricted to authorized MilJor Catalog & Verification Administrators.
            </p>
          </Card>
        </div>
      </AppShell>
    );
  }

  const handleMarkUnderReview = async (reqItem) => {
    try {
      setSubmittingAction(true);
      await catalogApi.adminReviewCatalogRequest(reqItem.id, {
        review_notes: 'Under review by Catalog Governance team'
      });
      toast.info(`Request ${reqItem.request_code} marked as UNDER_REVIEW.`);
      await loadAdminCatalogData();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to mark request under review.');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleApproveRequest = async (reqItem) => {
    try {
      setSubmittingAction(true);
      await catalogApi.adminApproveCatalogRequest(reqItem.id, {
        review_notes: 'Approved into canonical MilJor catalog'
      });
      toast.success(`Request ${reqItem.request_code} APPROVED and added to canonical catalog!`);
      await loadAdminCatalogData();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to approve catalog request.');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleConfirmReject = async (e) => {
    e.preventDefault();
    if (!rejectingRequest) return;
    if (!rejectionReason.trim() || rejectionReason.trim().length < 5) {
      toast.error('Please provide a clear rejection reason (minimum 5 characters).');
      return;
    }
    try {
      setSubmittingAction(true);
      await catalogApi.adminRejectCatalogRequest(rejectingRequest.id, {
        rejection_reason: rejectionReason.trim(),
        review_notes: reviewNotes.trim() || null
      });
      toast.success(`Request ${rejectingRequest.request_code} rejected with reason.`);
      setRejectingRequest(null);
      setRejectionReason('');
      setReviewNotes('');
      await loadAdminCatalogData();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to reject request.');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleToggleCategoryActive = async (cat) => {
    try {
      await catalogApi.adminUpdateCategory(cat.id, { is_active: !cat.is_active });
      toast.success(`Category '${cat.name}' ${!cat.is_active ? 'activated' : 'deactivated'}.`);
      await loadAdminCatalogData();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to update category.');
    }
  };

  const handleToggleFamilyActive = async (fam) => {
    try {
      await catalogApi.adminUpdateFamily(fam.id, { is_active: !fam.is_active });
      toast.success(`Product family '${fam.name}' ${!fam.is_active ? 'activated' : 'archived'}.`);
      await loadAdminCatalogData();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to update product family.');
    }
  };

  const handleCreateCategory = async (e) => {
    e.preventDefault();
    try {
      setSubmittingAction(true);
      await catalogApi.adminCreateCategory(newCategoryForm);
      toast.success('Canonical category created!');
      setCreateCategoryOpen(false);
      setNewCategoryForm({ name: '', urdu_name: '', description: '', display_order: 100 });
      await loadAdminCatalogData();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to create category.');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleCreateFamily = async (e) => {
    e.preventDefault();
    try {
      setSubmittingAction(true);
      const packUnits = newFamilyForm.allowed_pack_units.split(',').map(s => s.trim()).filter(Boolean);
      const purchUnits = newFamilyForm.allowed_purchasing_units.split(',').map(s => s.trim()).filter(Boolean);
      await catalogApi.adminCreateFamily({
        category_id: Number(newFamilyForm.category_id),
        name: newFamilyForm.name,
        urdu_name: newFamilyForm.urdu_name,
        description: newFamilyForm.description,
        allowed_pack_units: packUnits.length > 0 ? packUnits : ['kg', 'g'],
        allowed_purchasing_units: purchUnits.length > 0 ? purchUnits : ['bag', 'sack']
      });
      toast.success('Canonical product family created!');
      setCreateFamilyOpen(false);
      setNewFamilyForm(prev => ({ ...prev, name: '', urdu_name: '', description: '' }));
      await loadAdminCatalogData();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to create product family.');
    } finally {
      setSubmittingAction(false);
    }
  };

  const pendingCount = requests.filter(r => ['SUBMITTED', 'UNDER_REVIEW'].includes(r.status)).length;

  return (
    <AppShell title="Admin Catalog Governance & Moderation">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Top Header Card */}
        <Card className="p-6 bg-[var(--bg-card)] border-[var(--border-subtle)]">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Link
                  to="/admin/suppliers/verification"
                  className="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Supplier Verification Queue
                </Link>
                <span className="text-[var(--border-subtle)]">•</span>
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  Package E2 Catalog Governance
                </span>
              </div>
              <h1 className="font-display text-xl sm:text-2xl font-bold text-[var(--text-primary)]">
                Canonical Catalog Taxonomy & Supplier Request Moderation
              </h1>
              <p className="text-xs text-[var(--text-secondary)]">
                Review supplier-submitted Product Family and Physical Variant requests, prevent duplicate SKUs, and manage the 8 canonical categories and product families.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="px-3.5 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-center">
                <span className="text-[10px] text-[var(--text-muted)] block uppercase">Pending Review</span>
                <span className="text-sm font-bold text-amber-500">{pendingCount}</span>
              </div>
              <div className="px-3.5 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-center">
                <span className="text-[10px] text-[var(--text-muted)] block uppercase">Families</span>
                <span className="text-sm font-bold text-[var(--text-primary)]">{families.length}</span>
              </div>
              <div className="px-3.5 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-center">
                <span className="text-[10px] text-[var(--text-muted)] block uppercase">Categories</span>
                <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{categories.length}</span>
              </div>
            </div>
          </div>
        </Card>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('requests')}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 ${
                activeTab === 'requests'
                  ? 'bg-[var(--brand-primary)] text-white shadow-sm'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
              }`}
            >
              <FileText className="w-4 h-4" />
              Moderation Queue ({requests.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('families')}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 ${
                activeTab === 'families'
                  ? 'bg-[var(--brand-primary)] text-white shadow-sm'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
              }`}
            >
              <Package className="w-4 h-4" />
              Product Families ({families.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('categories')}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 ${
                activeTab === 'categories'
                  ? 'bg-[var(--brand-primary)] text-white shadow-sm'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
              }`}
            >
              <Layers className="w-4 h-4" />
              Canonical Categories ({categories.length})
            </button>
          </div>

          <button
            type="button"
            onClick={loadAdminCatalogData}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] inline-flex items-center gap-1.5 px-2.5 py-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>

        {loading ? (
          <Skeleton className="h-80 w-full rounded-2xl" />
        ) : (
          <>
            {/* TAB 1: MODERATION QUEUE */}
            {activeTab === 'requests' && (
              <Card className="p-6 bg-[var(--bg-card)] border-[var(--border-subtle)] space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-[var(--text-primary)]">
                      Supplier Catalog Addition Requests
                    </h2>
                    <p className="text-xs text-[var(--text-secondary)]">
                      Approve requests to atomically create canonical Product Families or Approved Physical Variants.
                    </p>
                  </div>

                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="px-3 py-1.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                  >
                    <option value="">All Statuses</option>
                    <option value="SUBMITTED">SUBMITTED</option>
                    <option value="UNDER_REVIEW">UNDER_REVIEW</option>
                    <option value="APPROVED">APPROVED</option>
                    <option value="REJECTED">REJECTED</option>
                  </select>
                </div>

                {requests.length === 0 ? (
                  <div className="p-8 rounded-2xl bg-[var(--bg-elevated)] text-center space-y-2">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                    <p className="text-sm font-semibold text-[var(--text-primary)]">No Catalog Requests Found</p>
                    <p className="text-xs text-[var(--text-secondary)]">
                      The catalog moderation queue is clear for the selected filter.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {requests.map((reqItem) => {
                      const isActionable = ['SUBMITTED', 'UNDER_REVIEW'].includes(reqItem.status);
                      return (
                        <div
                          key={reqItem.id}
                          className="p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                        >
                          <div className="space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                                {reqItem.request_code}
                              </span>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400">
                                {reqItem.request_type}
                              </span>
                              <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                                reqItem.status === 'APPROVED'
                                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                  : reqItem.status === 'REJECTED'
                                  ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                                  : reqItem.status === 'UNDER_REVIEW'
                                  ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                                  : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                              }`}>
                                {reqItem.status}
                              </span>
                              <span className="text-xs text-[var(--text-muted)]">
                                Supplier: <strong>{reqItem.supplier_business_name || reqItem.supplier_name}</strong>
                              </span>
                            </div>

                            <h3 className="text-sm font-bold text-[var(--text-primary)]">
                              {reqItem.request_type === 'NEW_FAMILY'
                                ? `Proposed Family: ${reqItem.proposed_family_name} (Category: ${reqItem.category_name})`
                                : reqItem.proposed_variant_title || `${reqItem.brand} — ${reqItem.variety} — ${reqItem.pack_size}${reqItem.pack_unit}`}
                            </h3>

                            {reqItem.request_type === 'NEW_VARIANT' && (
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]">
                                <span><strong>Hierarchy:</strong> {reqItem.category_name} → {reqItem.family_name}</span>
                                <span><strong>Brand:</strong> {reqItem.brand}</span>
                                <span><strong>Variety:</strong> {reqItem.variety}</span>
                                <span><strong>Grade:</strong> {reqItem.quality_grade}</span>
                                <span><strong>Process:</strong> {reqItem.processing_method}</span>
                                <span><strong>Pack:</strong> {reqItem.pack_size}{reqItem.pack_unit} ({reqItem.packaging_type})</span>
                              </div>
                            )}

                            {reqItem.supporting_notes && (
                              <p className="text-xs text-[var(--text-secondary)]">
                                <strong>Supplier Notes:</strong> {reqItem.supporting_notes}
                              </p>
                            )}

                            {reqItem.rejection_reason && (
                              <p className="text-xs text-rose-600 dark:text-rose-400">
                                <strong>Rejection Reason:</strong> {reqItem.rejection_reason}
                              </p>
                            )}
                          </div>

                          {isActionable && (
                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              {reqItem.status === 'SUBMITTED' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={submittingAction}
                                  onClick={() => handleMarkUnderReview(reqItem)}
                                >
                                  Mark Under Review
                                </Button>
                              )}
                              <Button
                                size="sm"
                                disabled={submittingAction}
                                onClick={() => handleApproveRequest(reqItem)}
                              >
                                Approve & Create
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={submittingAction}
                                onClick={() => {
                                  setRejectingRequest(reqItem);
                                  setRejectionReason('');
                                  setReviewNotes('');
                                }}
                                className="border-rose-500/40 text-rose-600 dark:text-rose-400"
                              >
                                Reject
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            )}

            {/* TAB 2: PRODUCT FAMILIES */}
            {activeTab === 'families' && (
              <Card className="p-6 bg-[var(--bg-card)] border-[var(--border-subtle)] space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-bold text-[var(--text-primary)]">Canonical Product Families</h2>
                    <p className="text-xs text-[var(--text-secondary)]">
                      Each product family defines allowed measurement units and groups approved physical variants.
                    </p>
                  </div>
                  <Button size="sm" onClick={() => setCreateFamilyOpen(true)}>
                    + Add Product Family
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {families.map((fam) => (
                    <div
                      key={fam.id}
                      className="p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex items-start justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                            {fam.family_code}
                          </span>
                          <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                            {fam.category_name}
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            fam.is_active ? 'bg-emerald-500/15 text-emerald-600' : 'bg-rose-500/15 text-rose-500'
                          }`}>
                            {fam.is_active ? 'ACTIVE' : 'ARCHIVED'}
                          </span>
                        </div>
                        <h3 className="text-sm font-bold text-[var(--text-primary)]">
                          {fam.name} {fam.urdu_name ? `(${fam.urdu_name})` : ''}
                        </h3>
                        <p className="text-xs text-[var(--text-secondary)]">{fam.description}</p>
                        <div className="text-[11px] text-[var(--text-muted)]">
                          Allowed Units: <strong>{(fam.allowed_pack_units || []).join(', ')}</strong> • Approved Variants: <strong>{fam.approved_variant_count || 0}</strong>
                        </div>
                      </div>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleToggleFamilyActive(fam)}
                        className="text-xs shrink-0"
                      >
                        {fam.is_active ? 'Archive' : 'Activate'}
                      </Button>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* TAB 3: CANONICAL CATEGORIES */}
            {activeTab === 'categories' && (
              <Card className="p-6 bg-[var(--bg-card)] border-[var(--border-subtle)] space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-bold text-[var(--text-primary)]">Canonical Categories</h2>
                    <p className="text-xs text-[var(--text-secondary)]">
                      Top-level food and beverage procurement categories for Lahore wholesale buyers and suppliers.
                    </p>
                  </div>
                  <Button size="sm" onClick={() => setCreateCategoryOpen(true)}>
                    + Add Category
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {categories.map((cat) => (
                    <div
                      key={cat.id}
                      className="p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex items-start justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                            {cat.category_code}
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            cat.is_active ? 'bg-emerald-500/15 text-emerald-600' : 'bg-rose-500/15 text-rose-500'
                          }`}>
                            {cat.is_active ? 'ACTIVE' : 'INACTIVE'}
                          </span>
                        </div>
                        <h3 className="text-sm font-bold text-[var(--text-primary)]">
                          {cat.name} {cat.urdu_name ? `(${cat.urdu_name})` : ''}
                        </h3>
                        <p className="text-xs text-[var(--text-secondary)]">{cat.description}</p>
                        <div className="text-[11px] text-[var(--text-muted)]">
                          Families: <strong>{cat.active_family_count}</strong> • Approved Variants: <strong>{cat.active_variant_count}</strong>
                        </div>
                      </div>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleToggleCategoryActive(cat)}
                        className="text-xs shrink-0"
                      >
                        {cat.is_active ? 'Deactivate' : 'Activate'}
                      </Button>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}

        {/* REJECT REQUEST MODAL */}
        {rejectingRequest && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <Card className="w-full max-w-md p-6 bg-[var(--bg-card)] border-[var(--border-subtle)] space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase text-rose-500">Reject Catalog Request</span>
                  <h3 className="text-base font-bold text-[var(--text-primary)]">
                    {rejectingRequest.request_code}
                  </h3>
                </div>
                <button type="button" onClick={() => setRejectingRequest(null)}>
                  <X className="w-5 h-5 text-[var(--text-muted)]" />
                </button>
              </div>

              <form onSubmit={handleConfirmReject} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                    Rejection Reason (Visible to Supplier) *
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder="Explain clearly why this request was rejected and how the supplier can correct it..."
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setRejectingRequest(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={submittingAction}>
                    {submittingAction ? 'Rejecting...' : 'Confirm Rejection'}
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        )}

        {/* CREATE CATEGORY MODAL */}
        {createCategoryOpen && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <Card className="w-full max-w-md p-6 bg-[var(--bg-card)] border-[var(--border-subtle)] space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-[var(--text-primary)]">Create Canonical Category</h3>
                <button type="button" onClick={() => setCreateCategoryOpen(false)}>
                  <X className="w-5 h-5 text-[var(--text-muted)]" />
                </button>
              </div>
              <form onSubmit={handleCreateCategory} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">Category Name *</label>
                  <input
                    type="text"
                    required
                    value={newCategoryForm.name}
                    onChange={(e) => setNewCategoryForm({ ...newCategoryForm, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Urdu Name</label>
                  <input
                    type="text"
                    value={newCategoryForm.urdu_name}
                    onChange={(e) => setNewCategoryForm({ ...newCategoryForm, urdu_name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Description</label>
                  <textarea
                    rows={2}
                    value={newCategoryForm.description}
                    onChange={(e) => setNewCategoryForm({ ...newCategoryForm, description: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setCreateCategoryOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={submittingAction}>
                    Create Category
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        )}

        {/* CREATE FAMILY MODAL */}
        {createFamilyOpen && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <Card className="w-full max-w-md p-6 bg-[var(--bg-card)] border-[var(--border-subtle)] space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-[var(--text-primary)]">Create Product Family</h3>
                <button type="button" onClick={() => setCreateFamilyOpen(false)}>
                  <X className="w-5 h-5 text-[var(--text-muted)]" />
                </button>
              </div>
              <form onSubmit={handleCreateFamily} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">Category *</label>
                  <select
                    value={newFamilyForm.category_id}
                    onChange={(e) => setNewFamilyForm({ ...newFamilyForm, category_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Family Name *</label>
                  <input
                    type="text"
                    required
                    value={newFamilyForm.name}
                    onChange={(e) => setNewFamilyForm({ ...newFamilyForm, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Allowed Pack Units (comma-separated) *</label>
                  <input
                    type="text"
                    value={newFamilyForm.allowed_pack_units}
                    onChange={(e) => setNewFamilyForm({ ...newFamilyForm, allowed_pack_units: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Description</label>
                  <textarea
                    rows={2}
                    value={newFamilyForm.description}
                    onChange={(e) => setNewFamilyForm({ ...newFamilyForm, description: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setCreateFamilyOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={submittingAction}>
                    Create Family
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default AdminCatalogPage;
