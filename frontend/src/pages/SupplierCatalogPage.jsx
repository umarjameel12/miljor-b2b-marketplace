// =============================================================================
// src/pages/SupplierCatalogPage.jsx
// MilJor Package E2: Supplier Canonical Catalog, Commercial Offers & Request Portal
// Hierarchy: Category -> Product Family -> Approved Physical Variant -> Supplier Offer
// =============================================================================
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AppShell } from '../components/layout/AppShell';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { SupplierVerificationBadge } from '../components/supplier/SupplierVerificationBadge';
import catalogApi from '../api/catalog';
import supplierApi from '../api/supplier';
import {
  Layers,
  Package,
  Plus,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  Tag,
  Search,
  RefreshCw,
  Edit3,
  Send,
  ShieldCheck,
  Building2,
  ArrowLeft,
  Sparkles,
  FileText,
  X
} from 'lucide-react';
import { toast } from 'react-toastify';

// Category-aware dynamic attribute hints & presets
const FAMILY_ATTRIBUTE_HINTS = {
  'rice': {
    placeholderVariety: 'e.g., 1121 Kainat Steam, Super Kernel Basmati, PK-386',
    processingOptions: ['Steam', 'Sella (Parboiled)', 'White Raw', 'Silky Sortexed'],
    gradeOptions: ['XXL Long Grain (Export)', 'Grade A Commercial', 'Standard Sortexed', 'Tota / Broken'],
    packagingOptions: ['PP Woven Bag', 'Jute Sack', 'Master Carton', 'Non-Woven Fabric Bag'],
    extraAttrLabel: 'Grain Length / Broken % (Optional)',
    extraAttrKey: 'grain_profile'
  },
  'cooking-oil': {
    placeholderVariety: 'e.g., Refined Canola Oil, RBD Palm Olein, Blended Frying Oil',
    processingOptions: ['Double Refined', 'RBD Olein', 'Winterized', 'Standard Refined'],
    gradeOptions: ['Grade A Foodservice', 'Commercial Frying Grade', 'Premium Retail'],
    packagingOptions: ['5-Ply Pouch Carton', 'G.I Tin', 'HDPE Jerrycan'],
    extraAttrLabel: 'Oil Base / Smoke Point (Optional)',
    extraAttrKey: 'oil_composition'
  },
  'banaspati-ghee': {
    placeholderVariety: 'e.g., Danedar Banaspati Ghee, Commercial Bakery Ghee',
    processingOptions: ['Danedar', 'Smooth / Bakery', 'Vitamin Fortified'],
    gradeOptions: ['Grade A Commercial', 'Premium Danedar', 'Bakery Grade'],
    packagingOptions: ['G.I Tin', 'Pouch Carton', 'Plastic Bucket'],
    extraAttrLabel: 'Melting Point / Texture (Optional)',
    extraAttrKey: 'texture_type'
  },
  'sugar': {
    placeholderVariety: 'e.g., Refined White Cane Sugar S-30, Medium Crystal M-30',
    processingOptions: ['Refined Sulphurless', 'Double Refined', 'Standard Mill White'],
    gradeOptions: ['ICUMSA-45', 'S-30 Commercial', 'M-30 Bold Crystal'],
    packagingOptions: ['PP Woven Laminated Bag', 'Jute Sack'],
    extraAttrLabel: 'Crystal Grade / ICUMSA (Optional)',
    extraAttrKey: 'icumsa_grade'
  },
  'gur-jaggery': {
    placeholderVariety: 'e.g., Peshawari Desi Gur, Shakkar Powder, Charsadda Gur Cones',
    processingOptions: ['Chemical-Free Desi Pan', 'Traditional Block', 'Granulated Shakkar'],
    gradeOptions: ['Grade A Golden', 'Organic Dark', 'Standard Commercial'],
    packagingOptions: ['PP Woven Bag', 'Corrugated Carton', 'Jute Sack'],
    extraAttrLabel: 'Origin / Form (Optional)',
    extraAttrKey: 'gur_origin'
  },
  'default': {
    placeholderVariety: 'e.g., Commercial Grade Variety / Type',
    processingOptions: ['Standard', 'Sortexed / Cleaned', 'Stone-Ground', 'Machine Washed', 'Refined'],
    gradeOptions: ['Grade A Commercial', 'Premium Export', 'Standard Wholesale'],
    packagingOptions: ['PP Woven Bag', 'Jute Sack', 'Carton', 'Tin', 'Jerrycan'],
    extraAttrLabel: 'Additional Physical Spec Note (Optional)',
    extraAttrKey: 'spec_note'
  }
};

export const SupplierCatalogPage = () => {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [categories, setCategories] = useState([]);
  const [families, setFamilies] = useState([]);
  const [variants, setVariants] = useState([]);
  const [myListings, setMyListings] = useState([]);
  const [myRequests, setMyRequests] = useState([]);
  const [catalogUsage, setCatalogUsage] = useState({ total_offers: 0, active_offers: 0, active_distinct_families: 0 });

  // Active view tab: 'browse' | 'offers' | 'requests'
  const [activeTab, setActiveTab] = useState('browse');

  // Cascading Selection State
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [selectedFamilyId, setSelectedFamilyId] = useState('');
  const [variantSearch, setVariantSearch] = useState('');

  // Modal 1: Publish / Edit Commercial Offer against an Approved Variant
  const [offerModalVariant, setOfferModalVariant] = useState(null);
  const [editingListing, setEditingListing] = useState(null);
  const [offerSubmitting, setOfferSubmitting] = useState(false);
  const [offerForm, setOfferForm] = useState({
    base_unit_price: '',
    available_stock: '100',
    buyer_min_qty: '5',
    supplier_min_qty: '20',
    delivery_fee_policy: 'INCLUDED_IN_PRICE',
    fulfilment_lead_time_days: '2',
    notes: ''
  });

  // Modal 2: Submit or Edit Missing Family / Missing Variant Request
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [editingRequestId, setEditingRequestId] = useState(null);
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestForm, setRequestForm] = useState({
    request_type: 'NEW_VARIANT',
    category_id: '',
    family_id: '',
    proposed_family_name: '',
    brand: '',
    variety: '',
    crop_year: '2026',
    processing_method: 'Standard',
    quality_grade: 'Grade A Commercial',
    packaging_type: 'PP Woven Bag',
    pack_size: '',
    pack_unit: 'kg',
    purchasing_unit: 'bag',
    extra_attribute_value: '',
    supporting_notes: ''
  });

  const isVerifiedSupplier = profile?.verification_status === 'VERIFIED';

  // Load initial portal data
  const loadPortalData = async () => {
    try {
      setLoading(true);
      const [profRes, catRes, famRes, listRes, reqRes] = await Promise.all([
        supplierApi.getProfile().catch(() => ({ data: { profile: null } })),
        catalogApi.getCategories(),
        catalogApi.getFamilies(),
        catalogApi.getMyListings().catch(() => ({ data: { listings: [], catalog_usage: {} } })),
        catalogApi.getMyCatalogRequests().catch(() => ({ data: { requests: [], catalog_usage: {} } }))
      ]);

      const loadedCategories = catRes.data?.categories || [];
      const loadedFamilies = famRes.data?.families || [];

      setProfile(profRes.data?.profile || null);
      setCategories(loadedCategories);
      setFamilies(loadedFamilies);
      setMyListings(listRes.data?.listings || []);
      setMyRequests(reqRes.data?.requests || []);
      setCatalogUsage(listRes.data?.catalog_usage || reqRes.data?.catalog_usage || {
        total_offers: 0,
        active_offers: 0,
        active_distinct_families: 0
      });

      if (loadedCategories.length > 0 && !selectedCategoryId) {
        const defaultCatId = String(loadedCategories[0].id);
        setSelectedCategoryId(defaultCatId);
        const firstFam = loadedFamilies.find(f => String(f.category_id) === defaultCatId);
        if (firstFam) {
          setSelectedFamilyId(String(firstFam.id));
        }
      }
    } catch (err) {
      console.error('Failed to load supplier catalog portal:', err);
      toast.error(err.response?.data?.error?.message || 'Failed to load catalog data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login?redirect=/supplier/catalog');
      return;
    }
    if (user && !['SUPPLIER', 'SUPER_ADMIN', 'OPERATIONS_ADMIN', 'ADMIN'].includes(user.role)) {
      toast.error('Supplier catalog portal is restricted to supplier accounts.');
      navigate('/profile');
      return;
    }
    loadPortalData();
  }, [isAuthenticated, user, navigate]);

  // Fetch approved variants whenever selectedFamilyId changes
  useEffect(() => {
    if (!selectedFamilyId) {
      setVariants([]);
      return;
    }
    let active = true;
    (async () => {
      try {
        const res = await catalogApi.getFamilyVariants(Number(selectedFamilyId));
        if (active) {
          setVariants(res.data?.variants || []);
        }
      } catch (err) {
        console.error('Error loading variants for family:', err);
      }
    })();
    return () => { active = false; };
  }, [selectedFamilyId]);

  // Dependent Reset Rule: Changing Category resets Family & Variant selection
  const handleSelectCategory = (catIdStr) => {
    setSelectedCategoryId(catIdStr);
    const matchingFamilies = families.filter(f => String(f.category_id) === String(catIdStr));
    if (matchingFamilies.length > 0) {
      setSelectedFamilyId(String(matchingFamilies[0].id));
    } else {
      setSelectedFamilyId('');
      setVariants([]);
    }
  };

  const filteredFamiliesForCategory = useMemo(() => {
    if (!selectedCategoryId) return [];
    return families.filter(f => String(f.category_id) === String(selectedCategoryId));
  }, [families, selectedCategoryId]);

  const currentFamily = useMemo(() => {
    return families.find(f => String(f.id) === String(selectedFamilyId)) || null;
  }, [families, selectedFamilyId]);

  const filteredVariants = useMemo(() => {
    if (!variantSearch.trim()) return variants;
    const q = variantSearch.toLowerCase();
    return variants.filter(v =>
      (v.variant_title || '').toLowerCase().includes(q) ||
      (v.brand || '').toLowerCase().includes(q) ||
      (v.variety || '').toLowerCase().includes(q) ||
      (v.spec_code || '').toLowerCase().includes(q)
    );
  }, [variants, variantSearch]);

  // Dynamic attribute configuration for Request Modal based on selected family in modal
  const modalSelectedFamily = useMemo(() => {
    return families.find(f => String(f.id) === String(requestForm.family_id)) || null;
  }, [families, requestForm.family_id]);

  const modalHints = useMemo(() => {
    const slug = modalSelectedFamily?.slug || 'default';
    return FAMILY_ATTRIBUTE_HINTS[slug] || FAMILY_ATTRIBUTE_HINTS['default'];
  }, [modalSelectedFamily]);

  const modalFamiliesForCategory = useMemo(() => {
    if (!requestForm.category_id) return [];
    return families.filter(f => String(f.category_id) === String(requestForm.category_id));
  }, [families, requestForm.category_id]);

  // Dependent Reset inside Request Modal when Category or Family changes
  const handleRequestCategoryChange = (newCatId) => {
    const fams = families.filter(f => String(f.category_id) === String(newCatId));
    const defaultFam = fams[0] || null;
    const defaultUnit = defaultFam?.allowed_pack_units?.[0] || 'kg';
    const defaultPurchUnit = defaultFam?.allowed_purchasing_units?.[0] || 'bag';
    const hints = FAMILY_ATTRIBUTE_HINTS[defaultFam?.slug || 'default'] || FAMILY_ATTRIBUTE_HINTS['default'];

    setRequestForm(prev => ({
      ...prev,
      category_id: String(newCatId),
      family_id: defaultFam ? String(defaultFam.id) : '',
      variety: '',
      processing_method: hints.processingOptions[0] || 'Standard',
      quality_grade: hints.gradeOptions[0] || 'Grade A Commercial',
      packaging_type: hints.packagingOptions[0] || 'PP Woven Bag',
      pack_unit: defaultUnit,
      purchasing_unit: defaultPurchUnit,
      extra_attribute_value: ''
    }));
  };

  const handleRequestFamilyChange = (newFamId) => {
    const fam = families.find(f => String(f.id) === String(newFamId)) || null;
    const defaultUnit = fam?.allowed_pack_units?.[0] || 'kg';
    const defaultPurchUnit = fam?.allowed_purchasing_units?.[0] || 'bag';
    const hints = FAMILY_ATTRIBUTE_HINTS[fam?.slug || 'default'] || FAMILY_ATTRIBUTE_HINTS['default'];

    setRequestForm(prev => ({
      ...prev,
      family_id: String(newFamId),
      variety: '',
      processing_method: hints.processingOptions[0] || 'Standard',
      quality_grade: hints.gradeOptions[0] || 'Grade A Commercial',
      packaging_type: hints.packagingOptions[0] || 'PP Woven Bag',
      pack_unit: defaultUnit,
      purchasing_unit: defaultPurchUnit,
      extra_attribute_value: ''
    }));
  };

  // Open Request Modal for new missing Family or Variant
  const openNewRequestModal = (type = 'NEW_VARIANT') => {
    const catId = selectedCategoryId || (categories[0] ? String(categories[0].id) : '');
    const fams = families.filter(f => String(f.category_id) === String(catId));
    const fam = currentFamily || fams[0] || null;
    const defaultUnit = fam?.allowed_pack_units?.[0] || 'kg';
    const defaultPurchUnit = fam?.allowed_purchasing_units?.[0] || 'bag';
    const hints = FAMILY_ATTRIBUTE_HINTS[fam?.slug || 'default'] || FAMILY_ATTRIBUTE_HINTS['default'];

    setEditingRequestId(null);
    setRequestForm({
      request_type: type,
      category_id: catId,
      family_id: fam ? String(fam.id) : '',
      proposed_family_name: '',
      brand: '',
      variety: '',
      crop_year: '2026',
      processing_method: hints.processingOptions[0] || 'Standard',
      quality_grade: hints.gradeOptions[0] || 'Grade A Commercial',
      packaging_type: hints.packagingOptions[0] || 'PP Woven Bag',
      pack_size: defaultUnit === 'L' ? '16' : '25',
      pack_unit: defaultUnit,
      purchasing_unit: defaultPurchUnit,
      extra_attribute_value: '',
      supporting_notes: ''
    });
    setRequestModalOpen(true);
  };

  // Open Request Modal to edit & resubmit a REJECTED or DRAFT request
  const openEditRequestModal = (reqItem) => {
    setEditingRequestId(reqItem.id);
    const attrs = reqItem.spec_attributes || {};
    const firstAttrVal = Object.values(attrs)[0] || '';

    setRequestForm({
      request_type: reqItem.request_type,
      category_id: String(reqItem.category_id || ''),
      family_id: reqItem.family_id ? String(reqItem.family_id) : '',
      proposed_family_name: reqItem.proposed_family_name || '',
      brand: reqItem.brand || '',
      variety: reqItem.variety || '',
      crop_year: reqItem.crop_year || '2026',
      processing_method: reqItem.processing_method || 'Standard',
      quality_grade: reqItem.quality_grade || 'Grade A Commercial',
      packaging_type: reqItem.packaging_type || 'PP Woven Bag',
      pack_size: reqItem.pack_size ? String(reqItem.pack_size) : '',
      pack_unit: reqItem.pack_unit || 'kg',
      purchasing_unit: reqItem.purchasing_unit || 'bag',
      extra_attribute_value: String(firstAttrVal),
      supporting_notes: reqItem.supporting_notes || ''
    });
    setRequestModalOpen(true);
  };

  const handleSubmitCatalogRequest = async (saveAsDraft = false) => {
    try {
      setRequestSubmitting(true);

      const payload = {
        request_type: requestForm.request_type,
        category_id: Number(requestForm.category_id),
        supporting_notes: requestForm.supporting_notes,
        save_as_draft: saveAsDraft
      };

      if (requestForm.request_type === 'NEW_FAMILY') {
        payload.proposed_family_name = requestForm.proposed_family_name;
      } else {
        payload.family_id = Number(requestForm.family_id);
        payload.brand = requestForm.brand;
        payload.variety = requestForm.variety;
        payload.crop_year = requestForm.crop_year;
        payload.processing_method = requestForm.processing_method;
        payload.quality_grade = requestForm.quality_grade;
        payload.packaging_type = requestForm.packaging_type;
        payload.pack_size = requestForm.pack_size;
        payload.pack_unit = requestForm.pack_unit;
        payload.purchasing_unit = requestForm.purchasing_unit;

        if (requestForm.extra_attribute_value.trim()) {
          payload.spec_attributes = {
            [modalHints.extraAttrKey]: requestForm.extra_attribute_value.trim()
          };
        }
      }

      if (editingRequestId) {
        await catalogApi.updateCatalogRequest(editingRequestId, payload);
        toast.success(saveAsDraft ? 'Draft request updated.' : 'Catalog request resubmitted for review!');
      } else {
        await catalogApi.createCatalogRequest(payload);
        toast.success(saveAsDraft ? 'Request saved as draft.' : 'Catalog request submitted to Admin Moderation Queue!');
      }

      setRequestModalOpen(false);
      setEditingRequestId(null);
      await loadPortalData();
      setActiveTab('requests');
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message || 'Failed to submit catalog request.';
      toast.error(msg);
    } finally {
      setRequestSubmitting(false);
    }
  };

  // Open Commercial Offer Modal for an Approved Variant
  const openCreateOfferModal = (variant) => {
    if (!isVerifiedSupplier) {
      toast.warning('Only VERIFIED suppliers can publish active commercial offers. You may still browse the catalog or submit catalog requests.');
      return;
    }
    const existingOffer = myListings.find(l => Number(l.product_spec_id) === Number(variant.id));
    if (existingOffer) {
      setEditingListing(existingOffer);
      setOfferModalVariant(variant);
      setOfferForm({
        base_unit_price: String(existingOffer.base_unit_price || ''),
        available_stock: String(existingOffer.available_stock || '100'),
        buyer_min_qty: String(existingOffer.buyer_min_qty || '5'),
        supplier_min_qty: String(existingOffer.supplier_min_qty || '20'),
        delivery_fee_policy: existingOffer.delivery_fee_policy || 'INCLUDED_IN_PRICE',
        fulfilment_lead_time_days: String(existingOffer.fulfilment_lead_time_days || '2'),
        notes: existingOffer.notes || ''
      });
    } else {
      setEditingListing(null);
      setOfferModalVariant(variant);
      setOfferForm({
        base_unit_price: '',
        available_stock: '100',
        buyer_min_qty: '5',
        supplier_min_qty: '20',
        delivery_fee_policy: 'INCLUDED_IN_PRICE',
        fulfilment_lead_time_days: '2',
        notes: ''
      });
    }
  };

  const handleSaveOffer = async (e) => {
    e.preventDefault();
    if (!offerModalVariant) return;
    try {
      setOfferSubmitting(true);
      const payload = {
        product_spec_id: offerModalVariant.id,
        base_unit_price: Number(offerForm.base_unit_price),
        available_stock: Number(offerForm.available_stock),
        buyer_min_qty: Number(offerForm.buyer_min_qty),
        supplier_min_qty: Number(offerForm.supplier_min_qty),
        delivery_fee_policy: offerForm.delivery_fee_policy,
        fulfilment_lead_time_days: Number(offerForm.fulfilment_lead_time_days),
        notes: offerForm.notes
      };

      if (editingListing) {
        await catalogApi.updateSupplierListing(editingListing.id, {
          ...payload,
          price_change_reason: 'Updated via Supplier Catalog Portal'
        });
        toast.success('Commercial offer updated successfully!');
      } else {
        await catalogApi.createSupplierListing(payload);
        toast.success('Commercial offer published against approved variant!');
      }

      setOfferModalVariant(null);
      setEditingListing(null);
      await loadPortalData();
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message || 'Failed to save commercial offer.';
      toast.error(msg);
    } finally {
      setOfferSubmitting(false);
    }
  };

  const handleToggleListingStatus = async (listing) => {
    const nextStatus = listing.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    try {
      await catalogApi.updateSupplierListingStatus(listing.id, nextStatus);
      toast.success(`Offer status changed to ${nextStatus}.`);
      await loadPortalData();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to update offer status.');
    }
  };

  if (loading) {
    return (
      <AppShell title="Supplier Catalog & Offers">
        <div className="max-w-6xl mx-auto space-y-6">
          <Skeleton className="h-32 w-full rounded-2xl" />
          <Skeleton className="h-96 w-full rounded-2xl" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Canonical Catalog & Supplier Offers">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Top Header Banner */}
        <Card className="p-6 bg-[var(--bg-card)] border-[var(--border-subtle)]">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <Link
                  to="/supplier/profile"
                  className="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Business Profile
                </Link>
                <span className="text-[var(--border-subtle)]">•</span>
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  Package E2 Canonical Catalog
                </span>
                <SupplierVerificationBadge
                  status={profile?.verification_status}
                  level={profile?.verification_level}
                  size="sm"
                />
              </div>
              <h1 className="font-display text-xl sm:text-2xl font-bold text-[var(--text-primary)]">
                Catalog Hierarchy, Approved Variants & Commercial Offers
              </h1>
              <p className="text-xs text-[var(--text-secondary)] max-w-2xl">
                Select a canonical <strong>Category → Product Family → Approved Physical Variant</strong> to publish your commercial price and MOQ offer, or submit a moderated request for a missing product family or physical specification.
              </p>
            </div>

            {/* E3-Ready Family Slot & Offer Summary */}
            <div className="flex flex-wrap items-center gap-3 self-stretch lg:self-auto">
              <div className="px-3.5 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-center">
                <span className="text-[10px] text-[var(--text-muted)] block uppercase tracking-wider">Active Families</span>
                <span className="text-sm font-bold text-[var(--text-primary)]">
                  {catalogUsage.active_distinct_families} / {profile?.max_active_listings || 4}
                </span>
              </div>
              <div className="px-3.5 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-center">
                <span className="text-[10px] text-[var(--text-muted)] block uppercase tracking-wider">Active Offers</span>
                <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                  {catalogUsage.active_offers}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openNewRequestModal('NEW_VARIANT')}
                className="flex items-center gap-1.5 text-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                Request Missing Variant / Family
              </Button>
            </div>
          </div>

          {!isVerifiedSupplier && (
            <div className="mt-4 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="text-xs text-[var(--text-secondary)]">
                <span className="font-semibold text-amber-700 dark:text-amber-300">Verification Required for Live Offers: </span>
                Your supplier account is currently <strong>{profile?.verification_status || 'UNVERIFIED'}</strong>. You can explore the canonical catalog and submit new variant/family requests now, and publish live commercial offers once approved.
              </div>
            </div>
          )}
        </Card>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('browse')}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 ${
                activeTab === 'browse'
                  ? 'bg-[var(--brand-primary)] text-white shadow-sm'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
              }`}
            >
              <Layers className="w-4 h-4" />
              1. Browse Canonical Catalog ({variants.length} Variants)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('offers')}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 ${
                activeTab === 'offers'
                  ? 'bg-[var(--brand-primary)] text-white shadow-sm'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
              }`}
            >
              <Tag className="w-4 h-4" />
              2. My Commercial Offers ({myListings.length})
            </button>
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
              3. My Catalog Requests ({myRequests.length})
            </button>
          </div>

          <button
            type="button"
            onClick={loadPortalData}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>

        {/* TAB 1: CASCADING CANONICAL CATALOG BROWSER */}
        {activeTab === 'browse' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Step 1 (Category) & Step 2 (Product Family) */}
            <div className="lg:col-span-4 space-y-4">
              <Card className="p-4 bg-[var(--bg-card)] border-[var(--border-subtle)] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Step 1 • Select Category ({categories.length})
                  </span>
                </div>
                <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                  {categories.map((cat) => {
                    const isSelected = String(cat.id) === String(selectedCategoryId);
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => handleSelectCategory(String(cat.id))}
                        className={`w-full text-left px-3 py-2.5 rounded-xl border text-xs transition-all flex items-center justify-between ${
                          isSelected
                            ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 font-semibold'
                            : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)] hover:border-emerald-500/30'
                        }`}
                      >
                        <div>
                          <div className="font-semibold">{cat.name}</div>
                          {cat.urdu_name && (
                            <div className="text-[11px] text-[var(--text-muted)]">{cat.urdu_name}</div>
                          )}
                        </div>
                        <span className="px-2 py-0.5 rounded-full text-[10px] bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                          {cat.active_family_count} families
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Card>

              <Card className="p-4 bg-[var(--bg-card)] border-[var(--border-subtle)] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Step 2 • Product Family ({filteredFamiliesForCategory.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => openNewRequestModal('NEW_FAMILY')}
                    className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    Missing Family?
                  </button>
                </div>

                {filteredFamiliesForCategory.length === 0 ? (
                  <div className="p-4 rounded-xl bg-[var(--bg-elevated)] text-center space-y-2">
                    <p className="text-xs text-[var(--text-muted)]">
                      No approved product families in this category yet.
                    </p>
                    <Button size="sm" variant="outline" onClick={() => openNewRequestModal('NEW_FAMILY')}>
                      Request New Family
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {filteredFamiliesForCategory.map((fam) => {
                      const isSelected = String(fam.id) === String(selectedFamilyId);
                      return (
                        <button
                          key={fam.id}
                          type="button"
                          onClick={() => setSelectedFamilyId(String(fam.id))}
                          className={`w-full text-left px-3 py-2.5 rounded-xl border text-xs transition-all flex items-center justify-between ${
                            isSelected
                              ? 'bg-[var(--brand-primary)] text-white border-[var(--brand-primary)] font-semibold'
                              : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)] hover:border-[var(--brand-primary)]/40'
                          }`}
                        >
                          <div>
                            <div>{fam.name}</div>
                            <div className={`text-[10px] ${isSelected ? 'text-white/80' : 'text-[var(--text-muted)]'}`}>
                              Units: {(fam.allowed_pack_units || ['kg']).join(', ')}
                            </div>
                          </div>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] ${
                            isSelected ? 'bg-white/20 text-white' : 'bg-[var(--bg-card)] text-[var(--text-secondary)]'
                          }`}>
                            {fam.approved_variant_count || 0} specs
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>

            {/* Right Column: Step 3 (Approved Physical Variants under Family) */}
            <div className="lg:col-span-8 space-y-4">
              <Card className="p-5 bg-[var(--bg-card)] border-[var(--border-subtle)] space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                      Step 3 • Approved Physical Variants
                    </span>
                    <h2 className="text-lg font-bold text-[var(--text-primary)]">
                      {currentFamily ? `${currentFamily.name} Specifications` : 'Select a Product Family'}
                    </h2>
                    {currentFamily?.description && (
                      <p className="text-xs text-[var(--text-secondary)] mt-0.5">{currentFamily.description}</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => openNewRequestModal('NEW_VARIANT')}
                    className="flex items-center gap-1.5 text-xs shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Request Missing Variant
                  </Button>
                </div>

                {/* Search Filter */}
                <div className="relative">
                  <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={variantSearch}
                    onChange={(e) => setVariantSearch(e.target.value)}
                    placeholder="Filter variants by brand, variety, grade, or pack size..."
                    className="w-full pl-9 pr-4 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-emerald-500"
                  />
                </div>

                {filteredVariants.length === 0 ? (
                  <div className="p-8 rounded-2xl bg-[var(--bg-elevated)] border border-dashed border-[var(--border-subtle)] text-center space-y-3">
                    <Package className="w-8 h-8 text-[var(--text-muted)] mx-auto" />
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-[var(--text-primary)]">
                        No Approved Physical Variants Found
                      </p>
                      <p className="text-xs text-[var(--text-secondary)] max-w-md mx-auto">
                        Don&apos;t see your exact brand, variety, grade, or pack size under {currentFamily?.name || 'this family'}? Submit a catalog variant request for moderation.
                      </p>
                    </div>
                    <Button size="sm" onClick={() => openNewRequestModal('NEW_VARIANT')}>
                      Request Missing Physical Variant
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredVariants.map((variant) => {
                      const myExistingOffer = myListings.find(l => Number(l.product_spec_id) === Number(variant.id));
                      return (
                        <div
                          key={variant.id}
                          className="p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-emerald-500/40 transition-all"
                        >
                          <div className="space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-muted)]">
                                {variant.spec_code}
                              </span>
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                APPROVED SPEC
                              </span>
                              {myExistingOffer && (
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400">
                                  YOUR OFFER: PKR {Number(myExistingOffer.base_unit_price).toLocaleString()} ({myExistingOffer.status})
                                </span>
                              )}
                            </div>
                            <h3 className="text-sm font-bold text-[var(--text-primary)]">
                              {variant.variant_title || variant.title}
                            </h3>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]">
                              <span><strong>Brand:</strong> {variant.brand}</span>
                              <span><strong>Variety:</strong> {variant.variety}</span>
                              <span><strong>Grade:</strong> {variant.quality_grade}</span>
                              <span><strong>Process:</strong> {variant.processing_method}</span>
                              <span><strong>Pack:</strong> {variant.pack_size}{variant.pack_unit} ({variant.packaging_type})</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <Button
                              size="sm"
                              variant={myExistingOffer ? 'outline' : 'primary'}
                              onClick={() => openCreateOfferModal(variant)}
                              className="text-xs"
                            >
                              {myExistingOffer ? 'Edit My Offer' : 'Publish Offer'}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}

        {/* TAB 2: MY COMMERCIAL OFFERS */}
        {activeTab === 'offers' && (
          <Card className="p-6 bg-[var(--bg-card)] border-[var(--border-subtle)] space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-[var(--text-primary)]">My Commercial Offers & Listings</h2>
                <p className="text-xs text-[var(--text-secondary)]">
                  Manage your wholesale pricing, available stock, and minimum order quantities (MOQ) linked to canonical variants.
                </p>
              </div>
              <Button size="sm" onClick={() => setActiveTab('browse')}>
                + Add Offer from Catalog
              </Button>
            </div>

            {myListings.length === 0 ? (
              <div className="p-8 rounded-2xl bg-[var(--bg-elevated)] text-center space-y-3">
                <Tag className="w-8 h-8 text-[var(--text-muted)] mx-auto" />
                <p className="text-sm font-semibold text-[var(--text-primary)]">No Commercial Offers Yet</p>
                <p className="text-xs text-[var(--text-secondary)]">
                  Select an approved physical specification in the Canonical Catalog tab to publish your first wholesale offer.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {myListings.map((listing) => (
                  <div
                    key={listing.id}
                    className="p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                          {listing.listing_code}
                        </span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                          {listing.category_name || listing.product_category} → {listing.family_name || 'Canonical Family'}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          listing.status === 'ACTIVE'
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                            : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                        }`}>
                          {listing.status}
                        </span>
                      </div>
                      <h3 className="text-sm font-bold text-[var(--text-primary)]">
                        {listing.variant_title || listing.spec_title}
                      </h3>
                      <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--text-secondary)]">
                        <span><strong>Price:</strong> PKR {Number(listing.base_unit_price).toLocaleString()} / {listing.pricing_unit}</span>
                        <span><strong>Stock:</strong> {listing.available_stock} packs</span>
                        <span><strong>Buyer MOQ:</strong> {listing.buyer_min_qty}</span>
                        <span><strong>Batch Dispatch Min:</strong> {listing.supplier_min_qty}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openCreateOfferModal({
                          id: listing.product_spec_id,
                          spec_code: listing.spec_code,
                          variant_title: listing.variant_title || listing.spec_title,
                          pack_size: listing.pack_size,
                          pack_unit: listing.pack_unit,
                          purchasing_unit: listing.purchasing_unit
                        })}
                      >
                        Edit Price / Stock
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleToggleListingStatus(listing)}
                      >
                        {listing.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* TAB 3: MY CATALOG REQUESTS HISTORY */}
        {activeTab === 'requests' && (
          <Card className="p-6 bg-[var(--bg-card)] border-[var(--border-subtle)] space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-[var(--text-primary)]">My Catalog Addition Requests</h2>
                <p className="text-xs text-[var(--text-secondary)]">
                  Track moderation status for missing product families and physical variants. Rejected or draft requests can be edited and resubmitted.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => openNewRequestModal('NEW_FAMILY')}>
                  + Request New Family
                </Button>
                <Button size="sm" onClick={() => openNewRequestModal('NEW_VARIANT')}>
                  + Request New Variant
                </Button>
              </div>
            </div>

            {myRequests.length === 0 ? (
              <div className="p-8 rounded-2xl bg-[var(--bg-elevated)] text-center space-y-2">
                <FileText className="w-8 h-8 text-[var(--text-muted)] mx-auto" />
                <p className="text-sm font-semibold text-[var(--text-primary)]">No Catalog Requests Submitted</p>
                <p className="text-xs text-[var(--text-secondary)]">
                  Whenever you need a new product family or physical pack variant added to the MilJor catalog, submit a request here.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {myRequests.map((reqItem) => {
                  const canEdit = ['DRAFT', 'REJECTED'].includes(reqItem.status);
                  return (
                    <div
                      key={reqItem.id}
                      className="p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] space-y-2"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
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
                            {reqItem.category_name} {reqItem.family_name ? `→ ${reqItem.family_name}` : ''}
                          </span>
                        </div>

                        {canEdit && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEditRequestModal(reqItem)}
                            className="text-xs flex items-center gap-1"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            Edit & Resubmit
                          </Button>
                        )}
                      </div>

                      <h3 className="text-sm font-bold text-[var(--text-primary)]">
                        {reqItem.request_type === 'NEW_FAMILY'
                          ? `Proposed Family: ${reqItem.proposed_family_name}`
                          : reqItem.proposed_variant_title || `${reqItem.brand} — ${reqItem.variety} — ${reqItem.pack_size}${reqItem.pack_unit}`}
                      </h3>

                      {reqItem.supporting_notes && (
                        <p className="text-xs text-[var(--text-secondary)]">
                          <strong>Supplier Notes:</strong> {reqItem.supporting_notes}
                        </p>
                      )}

                      {reqItem.status === 'REJECTED' && reqItem.rejection_reason && (
                        <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700 dark:text-rose-300">
                          <strong>Admin Rejection Reason:</strong> {reqItem.rejection_reason}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        )}

        {/* MODAL 1: PUBLISH / EDIT COMMERCIAL OFFER */}
        {offerModalVariant && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <Card className="w-full max-w-lg p-6 bg-[var(--bg-card)] border-[var(--border-subtle)] space-y-4">
              <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] pb-3">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                    {editingListing ? 'Update Commercial Offer' : 'Publish Commercial Offer'}
                  </span>
                  <h3 className="text-base font-bold text-[var(--text-primary)]">
                    {offerModalVariant.variant_title || offerModalVariant.title}
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">Spec Code: {offerModalVariant.spec_code}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOfferModalVariant(null)}
                  className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSaveOffer} className="space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                      Base Price per {offerModalVariant.purchasing_unit || 'pack'} (PKR) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={offerForm.base_unit_price}
                      onChange={(e) => setOfferForm({ ...offerForm, base_unit_price: e.target.value })}
                      placeholder="e.g. 7200"
                      className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                      Available Stock (Packs) *
                    </label>
                    <input
                      type="number"
                      required
                      value={offerForm.available_stock}
                      onChange={(e) => setOfferForm({ ...offerForm, available_stock: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                      Buyer Min Order Qty (MOQ) *
                    </label>
                    <input
                      type="number"
                      required
                      value={offerForm.buyer_min_qty}
                      onChange={(e) => setOfferForm({ ...offerForm, buyer_min_qty: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                      Supplier Dispatch Batch Min *
                    </label>
                    <input
                      type="number"
                      required
                      value={offerForm.supplier_min_qty}
                      onChange={(e) => setOfferForm({ ...offerForm, supplier_min_qty: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                    Commercial Notes (Optional)
                  </label>
                  <input
                    type="text"
                    value={offerForm.notes}
                    onChange={(e) => setOfferForm({ ...offerForm, notes: e.target.value })}
                    placeholder="e.g., Fresh 2026 crop stock ready at Akbari Mandi warehouse"
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setOfferModalVariant(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={offerSubmitting}>
                    {offerSubmitting ? 'Saving...' : editingListing ? 'Update Offer' : 'Publish Offer'}
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        )}

        {/* MODAL 2: REQUEST MISSING FAMILY OR PHYSICAL VARIANT */}
        {requestModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
            <Card className="w-full max-w-2xl p-6 bg-[var(--bg-card)] border-[var(--border-subtle)] space-y-4 my-8">
              <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] pb-3">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                    Moderated Catalog Governance
                  </span>
                  <h3 className="text-base font-bold text-[var(--text-primary)]">
                    {editingRequestId ? 'Edit & Resubmit Catalog Request' : 'Request Missing Product Family or Physical Variant'}
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)]">
                    All catalog additions are reviewed by MilJor Catalog Admins to prevent duplicate or inconsistent SKUs.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setRequestModalOpen(false)}
                  className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Request Type Switcher */}
              {!editingRequestId && (
                <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
                  <button
                    type="button"
                    onClick={() => setRequestForm(prev => ({ ...prev, request_type: 'NEW_VARIANT' }))}
                    className={`py-2 rounded-lg text-xs font-semibold transition-all ${
                      requestForm.request_type === 'NEW_VARIANT'
                        ? 'bg-[var(--brand-primary)] text-white'
                        : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    Request Missing Variant (Under Existing Family)
                  </button>
                  <button
                    type="button"
                    onClick={() => setRequestForm(prev => ({ ...prev, request_type: 'NEW_FAMILY' }))}
                    className={`py-2 rounded-lg text-xs font-semibold transition-all ${
                      requestForm.request_type === 'NEW_FAMILY'
                        ? 'bg-[var(--brand-primary)] text-white'
                        : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    Request New Product Family
                  </button>
                </div>
              )}

              <div className="space-y-3.5">
                {/* Category Selector (Triggers Dependent Reset) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                      1. Canonical Category *
                    </label>
                    <select
                      value={requestForm.category_id}
                      onChange={(e) => handleRequestCategoryChange(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>

                  {requestForm.request_type === 'NEW_VARIANT' ? (
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                        2. Canonical Product Family *
                      </label>
                      <select
                        value={requestForm.family_id}
                        onChange={(e) => handleRequestFamilyChange(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                      >
                        {modalFamiliesForCategory.map((f) => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                        2. Proposed Product Family Name *
                      </label>
                      <input
                        type="text"
                        value={requestForm.proposed_family_name}
                        onChange={(e) => setRequestForm({ ...requestForm, proposed_family_name: e.target.value })}
                        placeholder="e.g., Corn Flour, Black Chickpeas (Kala Chana)"
                        className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                      />
                    </div>
                  )}
                </div>

                {/* Variant-Specific Physical Attributes */}
                {requestForm.request_type === 'NEW_VARIANT' && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                          Brand / Mill Name *
                        </label>
                        <input
                          type="text"
                          value={requestForm.brand}
                          onChange={(e) => setRequestForm({ ...requestForm, brand: e.target.value })}
                          placeholder="e.g., Guard, Falak, Dalda, Ittefaq Mills"
                          className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                          Variety / Sub-Type *
                        </label>
                        <input
                          type="text"
                          value={requestForm.variety}
                          onChange={(e) => setRequestForm({ ...requestForm, variety: e.target.value })}
                          placeholder={modalHints.placeholderVariety}
                          className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                          Processing Method *
                        </label>
                        <select
                          value={requestForm.processing_method}
                          onChange={(e) => setRequestForm({ ...requestForm, processing_method: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                        >
                          {modalHints.processingOptions.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                          Quality Grade *
                        </label>
                        <select
                          value={requestForm.quality_grade}
                          onChange={(e) => setRequestForm({ ...requestForm, quality_grade: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                        >
                          {modalHints.gradeOptions.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                          Packaging Type *
                        </label>
                        <select
                          value={requestForm.packaging_type}
                          onChange={(e) => setRequestForm({ ...requestForm, packaging_type: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                        >
                          {modalHints.packagingOptions.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                          Pack Size (Numeric) *
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={requestForm.pack_size}
                          onChange={(e) => setRequestForm({ ...requestForm, pack_size: e.target.value })}
                          placeholder="e.g., 25 or 16"
                          className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                          Allowed Pack Unit *
                        </label>
                        <select
                          value={requestForm.pack_unit}
                          onChange={(e) => setRequestForm({ ...requestForm, pack_unit: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                        >
                          {(modalSelectedFamily?.allowed_pack_units || ['kg', 'g']).map((u) => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                          Purchasing Unit *
                        </label>
                        <select
                          value={requestForm.purchasing_unit}
                          onChange={(e) => setRequestForm({ ...requestForm, purchasing_unit: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                        >
                          {(modalSelectedFamily?.allowed_purchasing_units || ['bag', 'sack', 'carton', 'tin']).map((u) => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                        {modalHints.extraAttrLabel}
                      </label>
                      <input
                        type="text"
                        value={requestForm.extra_attribute_value}
                        onChange={(e) => setRequestForm({ ...requestForm, extra_attribute_value: e.target.value })}
                        placeholder="Optional commodity-specific attribute detail"
                        className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                      />
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                    Supporting Commercial Notes for Admin Reviewer
                  </label>
                  <textarea
                    rows={2}
                    value={requestForm.supporting_notes}
                    onChange={(e) => setRequestForm({ ...requestForm, supporting_notes: e.target.value })}
                    placeholder="Explain why this family or pack variant is needed for Lahore wholesale buyers..."
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
                  <Button type="button" variant="outline" size="sm" onClick={() => setRequestModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={requestSubmitting}
                    onClick={() => handleSubmitCatalogRequest(true)}
                  >
                    Save as Draft
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={requestSubmitting}
                    onClick={() => handleSubmitCatalogRequest(false)}
                  >
                    {requestSubmitting ? 'Submitting...' : editingRequestId ? 'Resubmit for Approval' : 'Submit Request'}
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default SupplierCatalogPage;
