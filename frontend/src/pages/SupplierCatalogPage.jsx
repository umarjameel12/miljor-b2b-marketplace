// =============================================================================
// src/pages/SupplierCatalogPage.jsx
// MilJor Package E2: Supplier Canonical Catalog, Supplier-Owned Products & SKUs,
// Commercial Offers, Immutable Regular Pools (24-72h Delivery SLA) & Requests
// 6-Level Hierarchy: Category -> Family -> Supplier Product -> Physical SKU -> Offer -> Pool
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
import { poolsApi } from '../api/pools';
import {
  Layers,
  Package,
  Plus,
  CheckCircle2,
  Clock,
  AlertCircle,
  Tag,
  Search,
  RefreshCw,
  Edit3,
  ArrowLeft,
  FileText,
  Lock,
  Archive,
  Truck,
  X
} from 'lucide-react';
import { toast } from 'react-toastify';

// Category-aware dynamic attribute hints & presets
const FAMILY_ATTRIBUTE_HINTS = {
  'rice': {
    placeholderVariety: 'e.g., 1121 Kainat Steam, Super Kernel Basmati, PK-386',
    processingOptions: ['', 'Steam', 'Sella (Parboiled)', 'White Raw', 'Silky Sortexed'],
    gradeOptions: ['', 'XXL Long Grain (Export)', 'Grade A Commercial', 'Standard Sortexed', 'Tota / Broken'],
    packagingOptions: ['PP Woven Bag', 'Jute Sack', 'Master Carton', 'Non-Woven Fabric Bag'],
    extraAttrLabel: 'Grain Length / Broken % (Optional)',
    extraAttrKey: 'grain_profile'
  },
  'cooking-oil': {
    placeholderVariety: 'e.g., Refined Canola Oil, RBD Palm Olein, Blended Frying Oil',
    processingOptions: ['', 'Double Refined', 'RBD Olein', 'Winterized', 'Standard Refined'],
    gradeOptions: ['', 'Grade A Foodservice', 'Commercial Frying Grade', 'Premium Retail'],
    packagingOptions: ['5-Ply Pouch Carton', 'G.I Tin', 'HDPE Jerrycan'],
    extraAttrLabel: 'Oil Base / Smoke Point (Optional)',
    extraAttrKey: 'oil_composition'
  },
  'banaspati-ghee': {
    placeholderVariety: 'e.g., Danedar Banaspati Ghee, Commercial Bakery Ghee',
    processingOptions: ['', 'Danedar', 'Smooth / Bakery', 'Vitamin Fortified'],
    gradeOptions: ['', 'Grade A Commercial', 'Premium Danedar', 'Bakery Grade'],
    packagingOptions: ['G.I Tin', 'Pouch Carton', 'Plastic Bucket'],
    extraAttrLabel: 'Melting Point / Texture (Optional)',
    extraAttrKey: 'texture_type'
  },
  'sugar': {
    placeholderVariety: 'e.g., Refined White Cane Sugar S-30, Medium Crystal M-30',
    processingOptions: ['', 'Refined Sulphurless', 'Double Refined', 'Standard Mill White'],
    gradeOptions: ['', 'ICUMSA-45', 'S-30 Commercial', 'M-30 Bold Crystal'],
    packagingOptions: ['PP Woven Laminated Bag', 'Jute Sack'],
    extraAttrLabel: 'Crystal Grade / ICUMSA (Optional)',
    extraAttrKey: 'icumsa_grade'
  },
  'gur-jaggery': {
    placeholderVariety: 'e.g., Peshawari Desi Gur, Shakkar Powder, Charsadda Gur Cones',
    processingOptions: ['', 'Chemical-Free Desi Pan', 'Traditional Block', 'Granulated Shakkar'],
    gradeOptions: ['', 'Grade A Golden', 'Organic Dark', 'Standard Commercial'],
    packagingOptions: ['PP Woven Bag', 'Corrugated Carton', 'Jute Sack'],
    extraAttrLabel: 'Origin / Form (Optional)',
    extraAttrKey: 'gur_origin'
  },
  'default': {
    placeholderVariety: 'e.g., Commercial Variety / Commodity Type',
    processingOptions: ['', 'Standard', 'Sortexed / Cleaned', 'Stone-Ground', 'Machine Washed', 'Refined'],
    gradeOptions: ['', 'Grade A Commercial', 'Premium Export', 'Standard Wholesale'],
    packagingOptions: ['PP Woven Bag', 'Jute Sack', 'Carton', 'Tin', 'Jerrycan'],
    extraAttrLabel: 'Additional Physical Spec Note (Optional)',
    extraAttrKey: 'spec_note'
  }
};

const toDatetimeLocalString = (dateObj) => {
  if (!dateObj) return '';
  const d = new Date(dateObj);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const SupplierCatalogPage = () => {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [categories, setCategories] = useState([]);
  const [families, setFamilies] = useState([]);
  const [variants, setVariants] = useState([]);
  const [mySupplierProducts, setMySupplierProducts] = useState([]);
  const [mySupplierSkus, setMySupplierSkus] = useState([]);
  const [myListings, setMyListings] = useState([]);
  const [myPools, setMyPools] = useState([]);
  const [myRequests, setMyRequests] = useState([]);
  const [familyEntitlements, setFamilyEntitlements] = useState(null);
  const [catalogUsage, setCatalogUsage] = useState({
    total_offers: 0,
    active_offers: 0,
    active_distinct_families: 0,
    published_supplier_products: 0,
    published_supplier_skus: 0
  });

  // Active view tab: 'browse' | 'my-skus' | 'offers' | 'pools' | 'requests'
  const [activeTab, setActiveTab] = useState('browse');

  // Cascading Selection State
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [selectedFamilyId, setSelectedFamilyId] = useState('');
  const [variantSearch, setVariantSearch] = useState('');

  // Modal A: Create / Edit Supplier-Owned Product (Level 3)
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingSupplierProduct, setEditingSupplierProduct] = useState(null);
  const [productSubmitting, setProductSubmitting] = useState(false);
  const [productForm, setProductForm] = useState({
    category_id: '',
    family_id: '',
    is_unbranded: false,
    brand: '',
    variety: '',
    quality_grade: '',
    processing_method: '',
    crop_year: '',
    origin: '',
    description: ''
  });

  // Modal B: Create / Edit Supplier-Owned Physical SKU (Level 4)
  const [skuModalOpen, setSkuModalOpen] = useState(false);
  const [editingSupplierSku, setEditingSupplierSku] = useState(null);
  const [skuSubmitting, setSkuSubmitting] = useState(false);
  const [skuForm, setSkuForm] = useState({
    supplier_product_id: '',
    packaging_type: '',
    pack_size: '',
    pack_unit: 'kg',
    purchasing_unit: '',
    pack_specification: '',
    storage_requirements: '',
    shelf_life_days: ''
  });
  const [confirmPublishSku, setConfirmPublishSku] = useState(null);
  const [confirmArchive, setConfirmArchive] = useState(null);
  const [archiveSubmitting, setArchiveSubmitting] = useState(false);

  // Modal 1: Publish / Edit Commercial Offer against an Approved Variant or Published Supplier SKU
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
    is_unbranded: false,
    brand: '',
    variety: '',
    crop_year: '2026',
    processing_method: '',
    quality_grade: '',
    packaging_type: 'PP Woven Bag',
    pack_size: '',
    pack_unit: 'kg',
    purchasing_unit: 'bag',
    extra_attribute_value: '',
    supporting_notes: ''
  });

  // Modal 3: Create / Edit Draft Regular Pool & Publish Confirmation Modal
  const [poolModalOpen, setPoolModalOpen] = useState(false);
  const [editingDraftPool, setEditingDraftPool] = useState(null);
  const [poolSubmitting, setPoolSubmitting] = useState(false);
  const [confirmPublishPool, setConfirmPublishPool] = useState(null);
  const [viewingLockedPool, setViewingLockedPool] = useState(null);
  const [poolForm, setPoolForm] = useState({
    supplier_listing_id: '',
    target_qty: '50',
    supplier_min_qty: '20',
    buyer_min_qty: '2',
    max_capacity: '100',
    delivery_type: 'DOORSTEP',
    scheduled_close_at: '',
    promised_delivery_at: '',
    tier1_price: '',
    tier2_price: ''
  });

  const isVerifiedSupplier = profile?.verification_status === 'VERIFIED';

  // Load initial portal data
  const loadPortalData = async () => {
    try {
      setLoading(true);
      const [profRes, catRes, famRes, spRes, skuRes, listRes, poolRes, reqRes, entRes] = await Promise.all([
        supplierApi.getProfile().catch(() => ({ data: { profile: null } })),
        catalogApi.getCategories(),
        catalogApi.getFamilies(),
        catalogApi.getMySupplierProducts().catch(() => ({ data: { products: [] } })),
        catalogApi.getMySupplierSkus().catch(() => ({ data: { skus: [] } })),
        catalogApi.getMyListings().catch(() => ({ data: { listings: [], catalog_usage: {} } })),
        poolsApi.getMyPools().catch(() => ({ data: { pools: [] } })),
        catalogApi.getMyCatalogRequests().catch(() => ({ data: { requests: [], catalog_usage: {} } })),
        supplierApi.getSubscription().catch(() => ({ data: { entitlements: null } }))
      ]);

      const loadedCategories = catRes.data?.categories || [];
      const loadedFamilies = famRes.data?.families || [];

      setProfile(profRes.data?.profile || null);
      setCategories(loadedCategories);
      setFamilies(loadedFamilies);
      setMySupplierProducts(spRes.data?.products || []);
      setMySupplierSkus(skuRes.data?.skus || []);
      setMyListings(listRes.data?.listings || []);
      setMyPools(poolRes.data?.pools || []);
      setMyRequests(reqRes.data?.requests || []);
      setFamilyEntitlements(entRes.data?.entitlements || null);
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

  // ---------------------------------------------------------------------------
  // Supplier-Owned Product Handlers (Level 3)
  // ---------------------------------------------------------------------------
  const openCreateSupplierProductModal = () => {
    const catId = selectedCategoryId || (categories[0] ? String(categories[0].id) : '');
    const fams = families.filter(f => String(f.category_id) === String(catId));
    const fam = currentFamily || fams[0] || null;
    setEditingSupplierProduct(null);
    setProductForm({
      category_id: catId,
      family_id: fam ? String(fam.id) : '',
      is_unbranded: false,
      brand: '',
      variety: '',
      quality_grade: '',
      processing_method: '',
      crop_year: '',
      origin: '',
      description: ''
    });
    setProductModalOpen(true);
  };

  const openEditSupplierProductModal = (sp) => {
    setEditingSupplierProduct(sp);
    setProductForm({
      category_id: String(sp.category_id || ''),
      family_id: String(sp.family_id || ''),
      is_unbranded: Boolean(sp.is_unbranded),
      brand: sp.brand || '',
      variety: sp.variety || '',
      quality_grade: sp.quality_grade || '',
      processing_method: sp.processing_method || '',
      crop_year: sp.crop_year || '',
      origin: sp.origin || '',
      description: sp.description || ''
    });
    setProductModalOpen(true);
  };

  const handleSaveSupplierProduct = async (e) => {
    e.preventDefault();
    try {
      setProductSubmitting(true);
      const payload = {
        family_id: Number(productForm.family_id),
        is_unbranded: productForm.is_unbranded,
        brand: productForm.is_unbranded ? null : (productForm.brand.trim() || null),
        variety: productForm.variety.trim(),
        quality_grade: productForm.quality_grade.trim() || null,
        processing_method: productForm.processing_method.trim() || null,
        crop_year: productForm.crop_year.trim() || null,
        origin: productForm.origin.trim() || null,
        description: productForm.description.trim() || null
      };

      if (editingSupplierProduct) {
        await catalogApi.updateSupplierProduct(editingSupplierProduct.id, payload);
        toast.success('Draft supplier product updated!');
      } else {
        await catalogApi.createSupplierProduct(payload);
        toast.success('Supplier product created in DRAFT status!');
      }
      setProductModalOpen(false);
      await loadPortalData();
      setActiveTab('my-skus');
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to save supplier product.');
    } finally {
      setProductSubmitting(false);
    }
  };

  const handleArchiveSupplierProduct = async (productId) => {
    try {
      await catalogApi.archiveSupplierProduct(productId);
      toast.success('Supplier product archived.');
      await loadPortalData();
      return true;
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to archive supplier product.');
      return false;
    }
  };

  // ---------------------------------------------------------------------------
  // Supplier-Owned Physical SKU Handlers (Level 4)
  // ---------------------------------------------------------------------------
  const openCreateSkuModal = (sp) => {
    const fam = families.find(f => Number(f.id) === Number(sp.family_id));
    const defaultPackUnit = fam?.allowed_pack_units?.[0] || 'kg';
    setEditingSupplierSku(null);
    setSkuForm({
      supplier_product_id: String(sp.id),
      packaging_type: '',
      pack_size: '',
      pack_unit: defaultPackUnit,
      purchasing_unit: '',
      pack_specification: '',
      storage_requirements: '',
      shelf_life_days: ''
    });
    setSkuModalOpen(true);
  };

  const openEditSkuModal = (sku) => {
    setEditingSupplierSku(sku);
    setSkuForm({
      supplier_product_id: String(sku.supplier_product_id),
      packaging_type: sku.packaging_type || '',
      pack_size: sku.pack_size !== null && sku.pack_size !== undefined ? String(sku.pack_size) : '',
      pack_unit: sku.pack_unit || 'kg',
      purchasing_unit: sku.purchasing_unit || 'bag',
      pack_specification: sku.pack_specification || '',
      storage_requirements: sku.storage_requirements || '',
      shelf_life_days: sku.shelf_life_days == null ? '' : String(sku.shelf_life_days)
    });
    setSkuModalOpen(true);
  };

  const handleSaveSupplierSku = async (e) => {
    e.preventDefault();
    try {
      setSkuSubmitting(true);
      const payload = {
        supplier_product_id: Number(skuForm.supplier_product_id),
        packaging_type: skuForm.packaging_type,
        pack_size: Number(skuForm.pack_size),
        pack_unit: skuForm.pack_unit,
        purchasing_unit: skuForm.purchasing_unit,
        pack_specification: skuForm.pack_specification.trim() || null,
        storage_requirements: skuForm.storage_requirements.trim() || null,
        shelf_life_days: skuForm.shelf_life_days === '' ? null : Number(skuForm.shelf_life_days)
      };
      if (editingSupplierSku) {
        await catalogApi.updateSupplierSku(editingSupplierSku.id, payload);
        toast.success('Draft physical SKU updated!');
      } else {
        await catalogApi.createSupplierSku(payload);
        toast.success('Physical SKU created in DRAFT status!');
      }
      setSkuModalOpen(false);
      await loadPortalData();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to save physical SKU.');
    } finally {
      setSkuSubmitting(false);
    }
  };

  const handleConfirmPublishSku = async () => {
    if (!confirmPublishSku) return;
    try {
      await catalogApi.publishSupplierSku(confirmPublishSku.id);
      toast.success('Physical SKU published! Physical identity is now permanently locked for commercial listings and pools.');
      setConfirmPublishSku(null);
      await loadPortalData();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to publish physical SKU.');
    }
  };

  const handleArchiveSku = async (skuId) => {
    try {
      await catalogApi.archiveSupplierSku(skuId);
      toast.success('Physical SKU archived.');
      await loadPortalData();
      return true;
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to archive SKU.');
      return false;
    }
  };

  const handleConfirmArchive = async () => {
    if (!confirmArchive || archiveSubmitting) return;
    setArchiveSubmitting(true);
    try {
      const ok = confirmArchive.kind === 'product'
        ? await handleArchiveSupplierProduct(confirmArchive.id)
        : await handleArchiveSku(confirmArchive.id);
      if (ok) setConfirmArchive(null);
    } finally {
      setArchiveSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Catalog Request Modal Helpers
  // ---------------------------------------------------------------------------
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
      processing_method: '',
      quality_grade: '',
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
      processing_method: '',
      quality_grade: '',
      packaging_type: hints.packagingOptions[0] || 'PP Woven Bag',
      pack_unit: defaultUnit,
      purchasing_unit: defaultPurchUnit,
      extra_attribute_value: ''
    }));
  };

  const openNewRequestModal = (type = 'NEW_FAMILY') => {
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
      is_unbranded: false,
      brand: '',
      variety: '',
      crop_year: '2026',
      processing_method: '',
      quality_grade: '',
      packaging_type: hints.packagingOptions[0] || 'PP Woven Bag',
      pack_size: defaultUnit === 'L' ? '16' : '25',
      pack_unit: defaultUnit,
      purchasing_unit: defaultPurchUnit,
      extra_attribute_value: '',
      supporting_notes: ''
    });
    setRequestModalOpen(true);
  };

  const openEditRequestModal = (reqItem) => {
    setEditingRequestId(reqItem.id);
    const attrs = reqItem.spec_attributes || {};
    const firstAttrVal = Object.values(attrs)[0] || '';

    setRequestForm({
      request_type: reqItem.request_type,
      category_id: String(reqItem.category_id || ''),
      family_id: reqItem.family_id ? String(reqItem.family_id) : '',
      proposed_family_name: reqItem.proposed_family_name || '',
      is_unbranded: !reqItem.brand,
      brand: reqItem.brand || '',
      variety: reqItem.variety || '',
      crop_year: reqItem.crop_year || '2026',
      processing_method: reqItem.processing_method || '',
      quality_grade: reqItem.quality_grade || '',
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
        payload.is_unbranded = requestForm.is_unbranded;
        payload.brand = requestForm.is_unbranded ? null : (requestForm.brand.trim() || null);
        payload.variety = requestForm.variety;
        payload.crop_year = requestForm.crop_year;
        payload.processing_method = requestForm.processing_method || null;
        payload.quality_grade = requestForm.quality_grade || null;
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

  // ---------------------------------------------------------------------------
  // Commercial Offer Handlers (Level 5)
  // ---------------------------------------------------------------------------
  const openCreateOfferModal = (variantOrSku) => {
    if (!isVerifiedSupplier) {
      toast.warning('Only VERIFIED suppliers can publish active commercial offers.');
      return;
    }
    const specId = variantOrSku.linked_spec_id || variantOrSku.id;
    const existingOffer = myListings.find(l => Number(l.product_spec_id) === Number(specId));
    if (existingOffer) {
      setEditingListing(existingOffer);
      setOfferModalVariant(variantOrSku);
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
      setOfferModalVariant(variantOrSku);
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
        product_spec_id: offerModalVariant.linked_spec_id || offerModalVariant.id,
        supplier_sku_id: offerModalVariant.sku_code ? offerModalVariant.id : undefined,
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
        toast.success('Commercial offer published!');
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

  // ---------------------------------------------------------------------------
  // Regular Pool Draft Creation, Editing & Publishing (Level 6 — Rules P1–P12)
  // ---------------------------------------------------------------------------
  const openCreatePoolModal = (listing) => {
    const defaultClose = new Date(Date.now() + 3 * 24 * 3600 * 1000); // +3 days
    const defaultPromised = new Date(defaultClose.getTime() + 48 * 3600 * 1000); // +48h after close (within 24-72h SLA)
    const basePrice = Number(listing?.base_unit_price || 5000);
    setEditingDraftPool(null);
    setPoolForm({
      supplier_listing_id: listing ? String(listing.id) : (myListings[0] ? String(myListings[0].id) : ''),
      target_qty: '50',
      supplier_min_qty: String(listing?.supplier_min_qty || '20'),
      buyer_min_qty: String(listing?.buyer_min_qty || '2'),
      max_capacity: '100',
      delivery_type: 'DOORSTEP',
      scheduled_close_at: toDatetimeLocalString(defaultClose),
      promised_delivery_at: toDatetimeLocalString(defaultPromised),
      tier1_price: String(basePrice),
      tier2_price: String(Math.max(1, Math.round(basePrice * 0.96)))
    });
    setPoolModalOpen(true);
  };

  const openEditDraftPoolModal = (pool) => {
    if (pool.status !== 'DRAFT' || pool.is_terms_locked) {
      setViewingLockedPool(pool);
      return;
    }
    setEditingDraftPool(pool);
    const t1 = pool.price_tiers?.[0]?.price_per_unit || pool.current_price_per_unit || '';
    const t2 = pool.price_tiers?.[1]?.price_per_unit || pool.next_tier_price || '';
    setPoolForm({
      supplier_listing_id: String(pool.supplier_listing_id || ''),
      target_qty: String(pool.target_qty || '50'),
      supplier_min_qty: String(pool.supplier_min_qty || '20'),
      buyer_min_qty: String(pool.buyer_min_qty || '2'),
      max_capacity: String(pool.max_capacity || pool.target_qty || '100'),
      delivery_type: pool.delivery_type || 'DOORSTEP',
      scheduled_close_at: toDatetimeLocalString(pool.scheduled_close_at || pool.expires_at),
      promised_delivery_at: toDatetimeLocalString(pool.promised_delivery_at),
      tier1_price: String(t1),
      tier2_price: String(t2)
    });
    setPoolModalOpen(true);
  };

  // Real-time 24–72 hour Delivery SLA calculation for UI validation
  const poolSlaStatus = useMemo(() => {
    if (!poolForm.scheduled_close_at || !poolForm.promised_delivery_at) {
      return { valid: false, message: 'Both participation close and promised delivery timestamps are required.' };
    }
    const closeDate = new Date(poolForm.scheduled_close_at);
    const delivDate = new Date(poolForm.promised_delivery_at);
    const diffHours = (delivDate.getTime() - closeDate.getTime()) / (3600 * 1000);
    if (diffHours <= 0) {
      return { valid: false, diffHours, message: 'Promised delivery must be after pool participation cutoff.' };
    }
    if (diffHours < 24) {
      return { valid: false, diffHours, message: `Too early (${diffHours.toFixed(1)}h after close). Minimum SLA is 24 hours (1 day).` };
    }
    if (diffHours > 72) {
      return { valid: false, diffHours, message: `Too late (${diffHours.toFixed(1)}h after close). Maximum SLA is 72 hours (3 days).` };
    }
    return { valid: true, diffHours, message: `Valid SLA: +${diffHours.toFixed(1)} hours (${(diffHours / 24).toFixed(1)} days) after pool close.` };
  }, [poolForm.scheduled_close_at, poolForm.promised_delivery_at]);

  const handleSaveDraftPool = async (e) => {
    e.preventDefault();
    if (!poolSlaStatus.valid) {
      toast.error(poolSlaStatus.message);
      return;
    }
    try {
      setPoolSubmitting(true);
      const selectedListing = myListings.find(l => String(l.id) === String(poolForm.supplier_listing_id));
      const targetQty = Number(poolForm.target_qty);
      const suppMin = Number(poolForm.supplier_min_qty);
      const maxCap = Number(poolForm.max_capacity);
      const unit = selectedListing?.pricing_unit || 'bag';

      const tiers = [];
      if (poolForm.tier1_price) {
        if (poolForm.tier2_price && Number(poolForm.tier2_price) < Number(poolForm.tier1_price) && targetQty > suppMin) {
          tiers.push({ min_qty: suppMin, max_qty: targetQty - 1, price_per_unit: Number(poolForm.tier1_price), pricing_unit: unit });
          tiers.push({ min_qty: targetQty, max_qty: maxCap, price_per_unit: Number(poolForm.tier2_price), pricing_unit: unit });
        } else {
          tiers.push({ min_qty: suppMin, max_qty: maxCap, price_per_unit: Number(poolForm.tier1_price), pricing_unit: unit });
        }
      }

      const payload = {
        product_id: selectedListing?.product_id,
        product_spec_id: selectedListing?.product_spec_id,
        supplier_sku_id: selectedListing?.supplier_sku_id || undefined,
        supplier_listing_id: Number(poolForm.supplier_listing_id),
        target_qty: targetQty,
        supplier_min_qty: suppMin,
        buyer_min_qty: Number(poolForm.buyer_min_qty),
        max_capacity: maxCap,
        pool_unit: unit,
        delivery_type: poolForm.delivery_type,
        scheduled_close_at: new Date(poolForm.scheduled_close_at).toISOString(),
        promised_delivery_at: new Date(poolForm.promised_delivery_at).toISOString(),
        price_tiers: tiers
      };

      if (editingDraftPool) {
        await poolsApi.updateDraftPool(editingDraftPool.id, payload);
        toast.success('Draft Regular Pool updated!');
      } else {
        await poolsApi.createPool(payload);
        toast.success('Draft Regular Pool created!');
      }
      setPoolModalOpen(false);
      await loadPortalData();
      setActiveTab('pools');
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to save draft pool.');
    } finally {
      setPoolSubmitting(false);
    }
  };

  const handleConfirmPublishPool = async () => {
    if (!confirmPublishPool) return;
    try {
      await poolsApi.publishPool(confirmPublishPool.id, {
        promised_delivery_at: confirmPublishPool.promised_delivery_at
      });
      toast.success('Regular Pool published! Commercial terms and 1–3 day delivery promise are now permanently locked.');
      setConfirmPublishPool(null);
      await loadPortalData();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to publish pool.');
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
    <AppShell title="Canonical Catalog, Supplier SKUs & Immutable Pools">
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
                  Package E2 • 6-Level Product & Immutable Pool Architecture
                </span>
                <SupplierVerificationBadge
                  status={profile?.verification_status}
                  level={profile?.verification_level}
                  size="sm"
                />
              </div>
              <h1 className="font-display text-xl sm:text-2xl font-bold text-[var(--text-primary)]">
                Supplier Products, Physical SKUs, Commercial Offers & Regular Pools
              </h1>
              <p className="text-xs text-[var(--text-secondary)] max-w-2xl">
                Manage your 6-level procurement hierarchy: <strong>Category → Canonical Family → Supplier Product (Optional Brand & Grade) → Physical SKU → Commercial Offer → Immutable Pool (1–3 Day Delivery SLA)</strong>.
              </p>
            </div>

            {/* E3-Ready Family Slot & Offer Summary */}
            <div className="flex flex-wrap items-center gap-3 self-stretch lg:self-auto">
              <div className="px-3.5 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-center">
                <span className="text-[10px] text-[var(--text-muted)] block uppercase tracking-wider">Active Families</span>
                <span className="text-sm font-bold text-[var(--text-primary)]">
                  {familyEntitlements?.active_families_count ?? catalogUsage.active_distinct_families} / {familyEntitlements?.max_allowed_families ?? (profile?.subscription_plan === 'BUSINESS' ? 25 : profile?.subscription_plan === 'GROWTH' ? 13 : 4)}
                </span>
              </div>
              <div className="px-3.5 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-center">
                <span className="text-[10px] text-[var(--text-muted)] block uppercase tracking-wider">My SKUs</span>
                <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                  {mySupplierSkus.length}
                </span>
              </div>
              <Button
                size="sm"
                onClick={openCreateSupplierProductModal}
                className="flex items-center gap-1.5 text-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                Create Supplier Product
              </Button>
            </div>
          </div>
        </Card>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('browse')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 ${
                activeTab === 'browse'
                  ? 'bg-[var(--brand-primary)] text-white shadow-sm'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
              }`}
            >
              <Layers className="w-4 h-4" />
              1. Canonical Catalog ({variants.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('my-skus')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 ${
                activeTab === 'my-skus'
                  ? 'bg-[var(--brand-primary)] text-white shadow-sm'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
              }`}
            >
              <Package className="w-4 h-4" />
              2. My Products & SKUs ({mySupplierProducts.length} / {mySupplierSkus.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('offers')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 ${
                activeTab === 'offers'
                  ? 'bg-[var(--brand-primary)] text-white shadow-sm'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
              }`}
            >
              <Tag className="w-4 h-4" />
              3. Commercial Offers ({myListings.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('pools')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 ${
                activeTab === 'pools'
                  ? 'bg-[var(--brand-primary)] text-white shadow-sm'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
              }`}
            >
              <Truck className="w-4 h-4" />
              4. Regular Pools ({myPools.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('requests')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 ${
                activeTab === 'requests'
                  ? 'bg-[var(--brand-primary)] text-white shadow-sm'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
              }`}
            >
              <FileText className="w-4 h-4" />
              5. Family Requests ({myRequests.length})
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
            <div className="lg:col-span-4 space-y-4">
              <Card className="p-4 bg-[var(--bg-card)] border-[var(--border-subtle)] space-y-3">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Step 1 • Select Category ({categories.length})
                </span>
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
                          {cat.urdu_name && <div className="text-[11px] text-[var(--text-muted)]">{cat.urdu_name}</div>}
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
                            Allowed Units: {(fam.allowed_pack_units || ['kg']).join(', ')}
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
              </Card>
            </div>

            <div className="lg:col-span-8 space-y-4">
              <Card className="p-5 bg-[var(--bg-card)] border-[var(--border-subtle)] space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                      Step 3 • Approved Specifications & Supplier Product Creation
                    </span>
                    <h2 className="text-lg font-bold text-[var(--text-primary)]">
                      {currentFamily ? `${currentFamily.name} Specifications` : 'Select a Product Family'}
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={openCreateSupplierProductModal} className="text-xs">
                      + Define My Supplier Product
                    </Button>
                  </div>
                </div>

                <div className="relative">
                  <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={variantSearch}
                    onChange={(e) => setVariantSearch(e.target.value)}
                    placeholder="Filter specifications by brand, variety, grade, or pack size..."
                    className="w-full pl-9 pr-4 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                  />
                </div>

                <div className="space-y-3">
                  {filteredVariants.map((variant) => {
                    const myExistingOffer = myListings.find(l => Number(l.product_spec_id) === Number(variant.id));
                    return (
                      <div
                        key={variant.id}
                        className="p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                      >
                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-muted)]">
                              {variant.spec_code}
                            </span>
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                              {variant.lifecycle_status === 'PUBLISHED' ? 'SUPPLIER SKU' : 'LEGACY GLOBAL SPEC'}
                            </span>
                          </div>
                          <h3 className="text-sm font-bold text-[var(--text-primary)]">
                            {variant.variant_title || variant.title}
                          </h3>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]">
                            <span><strong>Brand:</strong> {variant.brand || 'Unbranded'}</span>
                            <span><strong>Variety:</strong> {variant.variety}</span>
                            {variant.quality_grade && <span><strong>Grade:</strong> {variant.quality_grade}</span>}
                            <span><strong>Pack:</strong> {variant.pack_size}{variant.pack_unit} ({variant.packaging_type})</span>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant={myExistingOffer ? 'outline' : 'primary'}
                          onClick={() => openCreateOfferModal(variant)}
                          className="text-xs shrink-0"
                        >
                          {myExistingOffer ? 'Edit My Offer' : 'Publish Offer'}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* TAB 2: SUPPLIER-OWNED PRODUCTS & PHYSICAL SKUS */}
        {activeTab === 'my-skus' && (
          <Card className="p-6 bg-[var(--bg-card)] border-[var(--border-subtle)] space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
              <div>
                <h2 className="text-lg font-bold text-[var(--text-primary)]">
                  My Supplier-Owned Products & Physical SKUs
                </h2>
                <p className="text-xs text-[var(--text-secondary)]">
                  Define branded or unbranded products with optional quality grades, then add separate physical package SKUs (e.g., 25kg bag vs 50kg bag). Once a SKU is published, its physical identity is permanently locked.
                </p>
              </div>
              <Button size="sm" onClick={openCreateSupplierProductModal}>
                + New Supplier Product
              </Button>
            </div>

            {mySupplierProducts.length === 0 ? (
              <div className="p-8 rounded-2xl bg-[var(--bg-elevated)] text-center space-y-3">
                <Package className="w-8 h-8 text-[var(--text-muted)] mx-auto" />
                <p className="text-sm font-semibold text-[var(--text-primary)]">No Supplier-Owned Products Yet</p>
                <p className="text-xs text-[var(--text-secondary)]">
                  Create your first branded or unbranded product under any approved canonical family.
                </p>
                <Button size="sm" onClick={openCreateSupplierProductModal}>
                  Create First Supplier Product
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {mySupplierProducts.map((sp) => {
                  const productSkus = mySupplierSkus.filter(s => Number(s.supplier_product_id) === Number(sp.id));
                  return (
                    <div key={sp.id} className="p-4 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                              {sp.product_code}
                            </span>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                              {sp.category_name} → {sp.family_name}
                            </span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded inline-flex items-center gap-1 ${
                              sp.status === 'PUBLISHED'
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                : sp.status === 'ARCHIVED'
                                ? 'bg-stone-500/15 text-stone-500'
                                : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                            }`}>
                              {sp.status === 'PUBLISHED' && <Lock className="w-3 h-3" />}
                              {sp.status}
                            </span>
                          </div>
                          <h3 className="text-sm font-bold text-[var(--text-primary)]">{sp.display_title}</h3>
                          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)]">
                            <span><strong>Brand:</strong> {sp.is_unbranded || !sp.brand ? 'Unbranded / Commodity' : sp.brand}</span>
                            <span><strong>Variety:</strong> {sp.variety}</span>
                            {sp.quality_grade && <span><strong>Grade:</strong> {sp.quality_grade}</span>}
                            {sp.processing_method && <span><strong>Process:</strong> {sp.processing_method}</span>}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {sp.status === 'DRAFT' && (
                            <Button size="sm" variant="outline" onClick={() => openEditSupplierProductModal(sp)}>
                              Edit Draft
                            </Button>
                          )}
                          {sp.status !== 'ARCHIVED' && (
                            <Button size="sm" onClick={() => openCreateSkuModal(sp)}>
                              + Add Pack SKU
                            </Button>
                          )}
                          {sp.status !== 'ARCHIVED' && (
                            <Button size="sm" variant="outline" onClick={() => setConfirmArchive({ kind: 'product', id: sp.id, title: sp.display_title || sp.title })}>
                              <Archive className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Physical SKUs under this Supplier Product */}
                      <div className="pl-3 border-l-2 border-emerald-500/30 space-y-2">
                        {productSkus.length === 0 ? (
                          <p className="text-xs text-[var(--text-muted)] italic">
                            No physical SKUs yet. Click &quot;+ Add Pack SKU&quot; and enter your own packaging, positive pack size and compatible unit.
                          </p>
                        ) : (
                          productSkus.map((sku) => (
                            <div
                              key={sku.id}
                              className="p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                            >
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-mono text-[var(--text-muted)]">{sku.sku_code}</span>
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded inline-flex items-center gap-1 ${
                                    sku.status === 'PUBLISHED'
                                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                      : sku.status === 'ARCHIVED'
                                      ? 'bg-stone-500/15 text-stone-500'
                                      : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                                  }`}>
                                    {sku.status === 'PUBLISHED' && <Lock className="w-2.5 h-2.5" />}
                                    {sku.status}
                                  </span>
                                </div>
                                <div className="text-xs font-bold text-[var(--text-primary)]">{sku.sku_title}</div>
                                <div className="text-[11px] text-[var(--text-secondary)]">
                                  Pack: <strong>{sku.pack_size}{sku.pack_unit}</strong> ({sku.packaging_type}) • Purchasing Unit: <strong>{sku.purchasing_unit}</strong>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                {sku.status === 'DRAFT' && (
                                  <>
                                    <Button size="sm" variant="outline" onClick={() => openEditSkuModal(sku)}>
                                      Edit SKU
                                    </Button>
                                    <Button size="sm" onClick={() => setConfirmPublishSku(sku)}>
                                      Publish & Lock SKU
                                    </Button>
                                  </>
                                )}
                                {sku.status === 'PUBLISHED' && (
                                  <Button size="sm" onClick={() => openCreateOfferModal(sku)}>
                                    Create / Edit Offer
                                  </Button>
                                )}
                                {sku.status !== 'ARCHIVED' && (
                                  <Button size="sm" variant="outline" onClick={() => setConfirmArchive({ kind: 'sku', id: sku.id, title: sku.sku_title || sku.sku_code })}>
                                    Archive
                                  </Button>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        )}

        {/* TAB 3: MY COMMERCIAL OFFERS */}
        {activeTab === 'offers' && (
          <Card className="p-6 bg-[var(--bg-card)] border-[var(--border-subtle)] space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-[var(--text-primary)]">My Commercial Offers & Listings</h2>
                <p className="text-xs text-[var(--text-secondary)]">
                  Manage wholesale pricing, available stock, and MOQs, or launch a Regular Pool from any active offer.
                </p>
              </div>
              <Button size="sm" onClick={() => setActiveTab('my-skus')}>
                + Offer from My SKUs
              </Button>
            </div>

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

                  <div className="flex flex-wrap items-center gap-2">
                    {listing.status === 'ACTIVE' && (
                      <Button size="sm" onClick={() => openCreatePoolModal(listing)}>
                        + Create Regular Pool
                      </Button>
                    )}
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
                    <Button size="sm" variant="outline" onClick={() => handleToggleListingStatus(listing)}>
                      {listing.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* TAB 4: MY REGULAR POOLS (DRAFT -> PUBLISHED IMMUTABLE + 1-3 DAY DELIVERY SLA) */}
        {activeTab === 'pools' && (
          <Card className="p-6 bg-[var(--bg-card)] border-[var(--border-subtle)] space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-[var(--text-primary)]">
                  My Regular Pools (Immutable Published Terms & 1–3 Day Delivery SLA)
                </h2>
                <p className="text-xs text-[var(--text-secondary)]">
                  Pools are editable only in <strong>DRAFT</strong> status. Once published, all commercial terms and the 24–72 hour promised delivery timestamp are permanently locked.
                </p>
              </div>
              {myListings.length > 0 && (
                <Button size="sm" onClick={() => openCreatePoolModal(myListings[0])}>
                  + Create Draft Pool
                </Button>
              )}
            </div>

            {myPools.length === 0 ? (
              <div className="p-8 rounded-2xl bg-[var(--bg-elevated)] text-center space-y-3">
                <Truck className="w-8 h-8 text-[var(--text-muted)] mx-auto" />
                <p className="text-sm font-semibold text-[var(--text-primary)]">No Regular Pools Created Yet</p>
                <p className="text-xs text-[var(--text-secondary)]">
                  Create a Regular Pool from any active commercial offer and configure your 1–3 day delivery promise.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {myPools.map((pool) => {
                  const isLocked = pool.status !== 'DRAFT' || Boolean(pool.is_terms_locked);
                  return (
                    <div
                      key={pool.id}
                      className="p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                            {pool.pool_code}
                          </span>
                          <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded inline-flex items-center gap-1 ${
                            isLocked
                              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                              : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                          }`}>
                            {isLocked && <Lock className="w-3 h-3" />}
                            {pool.status} {isLocked ? '(TERMS LOCKED)' : '(EDITABLE DRAFT)'}
                          </span>
                        </div>
                        <h3 className="text-sm font-bold text-[var(--text-primary)]">
                          {pool.product_name || 'Wholesale Pool'} — Target: {pool.target_qty} {pool.pool_unit}
                        </h3>
                        <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--text-secondary)]">
                          <span><strong>Closes:</strong> {new Date(pool.scheduled_close_at || pool.expires_at).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</span>
                          {pool.promised_delivery_at && (
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                              <strong>Promised Delivery:</strong> {new Date(pool.promised_delivery_at).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {!isLocked ? (
                          <>
                            <Button size="sm" variant="outline" onClick={() => openEditDraftPoolModal(pool)}>
                              Edit Draft Terms
                            </Button>
                            <Button size="sm" onClick={() => setConfirmPublishPool(pool)}>
                              Publish & Lock Pool
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => setViewingLockedPool(pool)}>
                            <Lock className="w-3.5 h-3.5 mr-1" />
                            View Locked Terms
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        )}

        {/* TAB 5: MY CATALOG REQUESTS HISTORY */}
        {activeTab === 'requests' && (
          <Card className="p-6 bg-[var(--bg-card)] border-[var(--border-subtle)] space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-[var(--text-primary)]">My Catalog Addition Requests</h2>
                <p className="text-xs text-[var(--text-secondary)]">
                  Request missing commodity families here. Create physical product variants directly in My Products & SKUs; no admin approval is required for ordinary SKUs.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => openNewRequestModal('NEW_FAMILY')}>
                  + Request New Family
                </Button>

              </div>
            </div>

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
                        <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
                          {reqItem.status}
                        </span>
                      </div>
                      {canEdit && (
                        <Button size="sm" variant="outline" onClick={() => openEditRequestModal(reqItem)}>
                          <Edit3 className="w-3.5 h-3.5 mr-1" />
                          Edit & Resubmit
                        </Button>
                      )}
                    </div>
                    <h3 className="text-sm font-bold text-[var(--text-primary)]">
                      {reqItem.request_type === 'NEW_FAMILY'
                        ? `Proposed Family: ${reqItem.proposed_family_name}`
                        : reqItem.proposed_variant_title || `${reqItem.brand || 'Unbranded'} — ${reqItem.variety} — ${reqItem.pack_size}${reqItem.pack_unit}`}
                    </h3>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* MODAL A: CREATE / EDIT SUPPLIER-OWNED PRODUCT */}
        {productModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
            <Card className="w-full max-w-xl p-6 bg-[var(--bg-card)] border-[var(--border-subtle)] space-y-4">
              <div className="flex items-start justify-between border-b border-[var(--border-subtle)] pb-3">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                    Supplier-Owned Product Identity (Level 3)
                  </span>
                  <h3 className="text-base font-bold text-[var(--text-primary)]">
                    {editingSupplierProduct ? 'Edit Draft Supplier Product' : 'Define Supplier-Owned Product'}
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)]">
                    Brand and quality grade are completely optional. Unbranded commodities are first-class citizens.
                  </p>
                </div>
                <button type="button" onClick={() => setProductModalOpen(false)} className="p-1 text-[var(--text-muted)]">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSaveSupplierProduct} className="space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                      Canonical Family *
                    </label>
                    <select
                      value={productForm.family_id}
                      onChange={(e) => setProductForm({ ...productForm, family_id: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                    >
                      {families.map((f) => (
                        <option key={f.id} value={f.id}>{f.category_name} → {f.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                      Variety / Commodity Sub-Type *
                    </label>
                    <input
                      type="text"
                      required
                      value={productForm.variety}
                      onChange={(e) => setProductForm({ ...productForm, variety: e.target.value })}
                      placeholder="e.g., 1121 Kainat Steam, Fine Chakki Atta, RBD Palm Olein"
                      className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                    />
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] space-y-2">
                  <label className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={productForm.is_unbranded}
                      onChange={(e) => setProductForm({ ...productForm, is_unbranded: e.target.checked, brand: e.target.checked ? '' : productForm.brand })}
                    />
                    <span>This is an Unbranded / Mill-Direct Commodity (No Brand Name)</span>
                  </label>
                  {!productForm.is_unbranded && (
                    <div>
                      <label className="block text-xs text-[var(--text-secondary)] mb-1">
                        Brand / Mill Label (Optional — leave blank if unbranded)
                      </label>
                      <input
                        type="text"
                        value={productForm.brand}
                        onChange={(e) => setProductForm({ ...productForm, brand: e.target.value })}
                        placeholder="Optional: e.g., Guard, Sufi, or your own mill name"
                        className="w-full px-3 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                      />
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                      Quality Grade (Optional)
                    </label>
                    <input
                      type="text"
                      value={productForm.quality_grade}
                      onChange={(e) => setProductForm({ ...productForm, quality_grade: e.target.value })}
                      placeholder="Optional (leave blank if no grade)"
                      className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                      Processing Method (Optional)
                    </label>
                    <input
                      type="text"
                      value={productForm.processing_method}
                      onChange={(e) => setProductForm({ ...productForm, processing_method: e.target.value })}
                      placeholder="Optional (e.g., Sortexed, Double Refined)"
                      className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block text-xs text-[var(--text-secondary)]">
                    Crop Year (Optional)
                    <input type="text" maxLength={30} value={productForm.crop_year}
                      onChange={(e) => setProductForm({ ...productForm, crop_year: e.target.value })}
                      placeholder="Supplier-defined, if relevant"
                      className="mt-1 w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]" />
                  </label>
                  <label className="block text-xs text-[var(--text-secondary)]">
                    Origin (Optional)
                    <input type="text" maxLength={120} value={productForm.origin}
                      onChange={(e) => setProductForm({ ...productForm, origin: e.target.value })}
                      placeholder="Actual origin, if known"
                      className="mt-1 w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]" />
                  </label>
                </div>
                <label className="block text-xs text-[var(--text-secondary)]">
                  Description (Optional)
                  <textarea rows={2} value={productForm.description}
                    onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                    placeholder="Describe the actual product without invented claims"
                    className="mt-1 w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]" />
                </label>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setProductModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={productSubmitting}>
                    {productSubmitting ? 'Saving...' : 'Save Supplier Product (DRAFT)'}
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        )}

        {/* MODAL B: CREATE / EDIT SUPPLIER PHYSICAL SKU */}
        {skuModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <Card className="w-full max-w-md p-6 bg-[var(--bg-card)] border-[var(--border-subtle)] space-y-4">
              <div className="flex items-start justify-between border-b border-[var(--border-subtle)] pb-3">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                    Physical Package SKU (Level 4)
                  </span>
                  <h3 className="text-base font-bold text-[var(--text-primary)]">
                    {editingSupplierSku ? 'Edit Draft Physical SKU' : 'Add Physical Package SKU'}
                  </h3>
                </div>
                <button type="button" onClick={() => setSkuModalOpen(false)} className="p-1 text-[var(--text-muted)]">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSaveSupplierSku} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                    Packaging Type *
                  </label>
                  <input
                    type="text"
                    required
                    value={skuForm.packaging_type}
                    onChange={(e) => setSkuForm({ ...skuForm, packaging_type: e.target.value })}
                    placeholder="e.g., PP Woven Bag, Jute Sack, G.I Tin, Pouch Carton"
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                      Pack Size *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={skuForm.pack_size}
                      onChange={(e) => setSkuForm({ ...skuForm, pack_size: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                      Pack Unit *
                    </label>
                    <select
                      value={skuForm.pack_unit}
                      onChange={(e) => setSkuForm({ ...skuForm, pack_unit: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                    >
                      <option value="kg">kg (Mass)</option>
                      <option value="g">g (Mass)</option>
                      <option value="L">L (Volume)</option>
                      <option value="mL">mL (Volume)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                      Purchasing Unit *
                    </label>
                    <input
                      type="text"
                      required
                      value={skuForm.purchasing_unit}
                      onChange={(e) => setSkuForm({ ...skuForm, purchasing_unit: e.target.value })}
                      placeholder="e.g., bag, sack, tin, drum, carton"
                      className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                    />
                  </div>
                </div>

                <label className="block text-xs text-[var(--text-secondary)]">
                  Packaging Specification (Optional)
                  <input type="text" maxLength={200} value={skuForm.pack_specification}
                    onChange={(e) => setSkuForm({ ...skuForm, pack_specification: e.target.value })}
                    placeholder="e.g., heat-sealed food-grade tin"
                    className="mt-1 w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]" />
                </label>
                <label className="block text-xs text-[var(--text-secondary)]">
                  Storage Requirements (Optional)
                  <input type="text" maxLength={255} value={skuForm.storage_requirements}
                    onChange={(e) => setSkuForm({ ...skuForm, storage_requirements: e.target.value })}
                    placeholder="Supplier-defined storage instructions"
                    className="mt-1 w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]" />
                </label>
                <label className="block text-xs text-[var(--text-secondary)]">
                  Shelf Life in Days (Optional)
                  <input type="number" min="1" max="36500" step="1" value={skuForm.shelf_life_days}
                    onChange={(e) => setSkuForm({ ...skuForm, shelf_life_days: e.target.value })}
                    className="mt-1 w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]" />
                </label>
                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setSkuModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={skuSubmitting}>
                    {skuSubmitting ? 'Saving...' : 'Save SKU (DRAFT)'}
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        )}

        {/* B2: Archiving is intentionally explicit and does not bypass open pools. */}
        {confirmArchive && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <Card className="w-full max-w-md p-6 bg-[var(--bg-card)] border-[var(--border-subtle)] space-y-4">
              <h3 className="text-base font-bold text-[var(--text-primary)]">Archive {confirmArchive.kind === 'product' ? 'Product' : 'SKU'}?</h3>
              <p className="text-xs text-[var(--text-secondary)]">
                {confirmArchive.title} will stop accepting new commercial offers. Published physical identity and historical records remain locked.
                Archiving is blocked if any related non-terminal pool still has commitments.
              </p>
              <div className="flex items-center justify-end gap-2">
                <Button size="sm" variant="outline" disabled={archiveSubmitting} onClick={() => setConfirmArchive(null)}>Keep Active</Button>
                <Button size="sm" disabled={archiveSubmitting} onClick={handleConfirmArchive}>{archiveSubmitting ? 'Archiving...' : 'Confirm Archive'}</Button>
              </div>
            </Card>
          </div>
        )}

        {/* CONFIRM PUBLISH SKU MODAL */}
        {confirmPublishSku && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <Card className="w-full max-w-md p-6 bg-[var(--bg-card)] border-[var(--border-subtle)] space-y-4">
              <div className="flex items-center gap-2 text-amber-500">
                <Lock className="w-5 h-5" />
                <h3 className="text-base font-bold text-[var(--text-primary)]">Publish & Lock Physical SKU?</h3>
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                Once published, the physical identity of <strong>{confirmPublishSku.sku_title}</strong> (variety, brand/unbranded status, grade, pack size, and unit) is permanently locked and cannot be edited.
              </p>
              <div className="flex items-center justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setConfirmPublishSku(null)}>
                  Keep as Draft
                </Button>
                <Button size="sm" onClick={handleConfirmPublishSku}>
                  Confirm & Lock SKU
                </Button>
              </div>
            </Card>
          </div>
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
                    {offerModalVariant.sku_title || offerModalVariant.variant_title || offerModalVariant.title}
                  </h3>
                </div>
                <button type="button" onClick={() => setOfferModalVariant(null)} className="p-1 text-[var(--text-muted)]">
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

        {/* MODAL 3: CREATE / EDIT DRAFT REGULAR POOL (WITH 24-72H DELIVERY SLA) */}
        {poolModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
            <Card className="w-full max-w-xl p-6 bg-[var(--bg-card)] border-[var(--border-subtle)] space-y-4">
              <div className="flex items-start justify-between border-b border-[var(--border-subtle)] pb-3">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                    Regular Pool Configuration (DRAFT)
                  </span>
                  <h3 className="text-base font-bold text-[var(--text-primary)]">
                    {editingDraftPool ? 'Edit Draft Regular Pool' : 'Create Regular Pool Draft'}
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)]">
                    Configure participation cutoff and promised delivery timestamp (strictly 24 to 72 hours after pool close).
                  </p>
                </div>
                <button type="button" onClick={() => setPoolModalOpen(false)} className="p-1 text-[var(--text-muted)]">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSaveDraftPool} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                    Active Commercial Offer *
                  </label>
                  <select
                    value={poolForm.supplier_listing_id}
                    onChange={(e) => setPoolForm({ ...poolForm, supplier_listing_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                  >
                    {myListings.filter(l => l.status === 'ACTIVE').map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.listing_code} — {l.variant_title || l.spec_title} (PKR {l.base_unit_price}/{l.pricing_unit})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">Supplier Min *</label>
                    <input
                      type="number"
                      required
                      value={poolForm.supplier_min_qty}
                      onChange={(e) => setPoolForm({ ...poolForm, supplier_min_qty: e.target.value })}
                      className="w-full px-2.5 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">Target Qty *</label>
                    <input
                      type="number"
                      required
                      value={poolForm.target_qty}
                      onChange={(e) => setPoolForm({ ...poolForm, target_qty: e.target.value })}
                      className="w-full px-2.5 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">Max Capacity *</label>
                    <input
                      type="number"
                      required
                      value={poolForm.max_capacity}
                      onChange={(e) => setPoolForm({ ...poolForm, max_capacity: e.target.value })}
                      className="w-full px-2.5 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">Buyer Min *</label>
                    <input
                      type="number"
                      required
                      value={poolForm.buyer_min_qty}
                      onChange={(e) => setPoolForm({ ...poolForm, buyer_min_qty: e.target.value })}
                      className="w-full px-2.5 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs"
                    />
                  </div>
                </div>

                {/* Schedule & Mandatory 24-72h Delivery SLA */}
                <div className="p-3.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                        1. Pool Participation Close (PKT) *
                      </label>
                      <input
                        type="datetime-local"
                        required
                        value={poolForm.scheduled_close_at}
                        onChange={(e) => setPoolForm({ ...poolForm, scheduled_close_at: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                        2. Promised Delivery (+24h to +72h) *
                      </label>
                      <input
                        type="datetime-local"
                        required
                        value={poolForm.promised_delivery_at}
                        onChange={(e) => setPoolForm({ ...poolForm, promised_delivery_at: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs"
                      />
                    </div>
                  </div>
                  <div className={`text-xs font-medium flex items-center gap-1.5 ${
                    poolSlaStatus.valid ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                  }`}>
                    {poolSlaStatus.valid ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                    <span>{poolSlaStatus.message}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                      Tier 1 Price (PKR) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={poolForm.tier1_price}
                      onChange={(e) => setPoolForm({ ...poolForm, tier1_price: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                      Tier 2 Discount Price (PKR)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={poolForm.tier2_price}
                      onChange={(e) => setPoolForm({ ...poolForm, tier2_price: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setPoolModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={poolSubmitting || !poolSlaStatus.valid}>
                    {poolSubmitting ? 'Saving...' : 'Save Pool Draft'}
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        )}

        {/* MANDATORY PUBLISH POOL CONFIRMATION MODAL */}
        {confirmPublishPool && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <Card className="w-full max-w-md p-6 bg-[var(--bg-card)] border-[var(--border-subtle)] space-y-4">
              <div className="flex items-center gap-2 text-amber-500">
                <Lock className="w-5 h-5" />
                <h3 className="text-base font-bold text-[var(--text-primary)]">Publish & Permanently Lock Pool?</h3>
              </div>
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-[var(--text-primary)] font-medium">
                Once published, this pool&apos;s commercial terms and delivery promise cannot be changed.
              </div>
              <div className="text-xs text-[var(--text-secondary)] space-y-1">
                <div><strong>Pool Code:</strong> {confirmPublishPool.pool_code}</div>
                <div><strong>Target / Min Qty:</strong> {confirmPublishPool.target_qty} / {confirmPublishPool.supplier_min_qty} {confirmPublishPool.pool_unit}</div>
                <div><strong>Participation Cutoff:</strong> {new Date(confirmPublishPool.scheduled_close_at || confirmPublishPool.expires_at).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</div>
                <div><strong>Promised Delivery:</strong> {confirmPublishPool.promised_delivery_at ? new Date(confirmPublishPool.promised_delivery_at).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }) : 'Not set'}</div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setConfirmPublishPool(null)}>
                  Keep as Draft
                </Button>
                <Button size="sm" onClick={handleConfirmPublishPool}>
                  Publish & Lock Terms
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* READ-ONLY LOCKED PUBLISHED POOL VIEW MODAL */}
        {viewingLockedPool && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <Card className="w-full max-w-lg p-6 bg-[var(--bg-card)] border-[var(--border-subtle)] space-y-4">
              <div className="flex items-start justify-between border-b border-[var(--border-subtle)] pb-3">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-emerald-600" />
                  <h3 className="text-base font-bold text-[var(--text-primary)]">
                    Locked Published Pool ({viewingLockedPool.pool_code})
                  </h3>
                </div>
                <button type="button" onClick={() => setViewingLockedPool(null)} className="p-1 text-[var(--text-muted)]">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-700 dark:text-emerald-300">
                This pool is published ({viewingLockedPool.status}). All commercial parameters, price tiers, clusters, and the promised delivery timestamp are permanently immutable.
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs text-[var(--text-secondary)]">
                <div><strong>Target Qty:</strong> {viewingLockedPool.target_qty} {viewingLockedPool.pool_unit}</div>
                <div><strong>Supplier Min:</strong> {viewingLockedPool.supplier_min_qty} {viewingLockedPool.pool_unit}</div>
                <div><strong>Buyer Min:</strong> {viewingLockedPool.buyer_min_qty} {viewingLockedPool.pool_unit}</div>
                <div><strong>Delivery Mode:</strong> {viewingLockedPool.delivery_type}</div>
                <div className="col-span-2">
                  <strong>Participation Cutoff:</strong> {new Date(viewingLockedPool.scheduled_close_at || viewingLockedPool.expires_at).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}
                </div>
                <div className="col-span-2 text-emerald-600 dark:text-emerald-400">
                  <strong>Promised Delivery SLA:</strong> {viewingLockedPool.promised_delivery_at ? new Date(viewingLockedPool.promised_delivery_at).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }) : 'N/A'}
                </div>
              </div>
              <div className="flex justify-end">
                <Button size="sm" variant="outline" onClick={() => setViewingLockedPool(null)}>
                  Close Read-Only View
                </Button>
              </div>
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
                    {editingRequestId ? 'Edit & Resubmit Catalog Request' : 'Request Missing Product Family'}
                  </h3>
                </div>
                <button type="button" onClick={() => setRequestModalOpen(false)} className="p-1 text-[var(--text-muted)]">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3.5">
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

                {requestForm.request_type === 'NEW_VARIANT' && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                          Brand / Mill Name (Optional — leave blank if unbranded)
                        </label>
                        <input
                          type="text"
                          value={requestForm.brand}
                          onChange={(e) => setRequestForm({ ...requestForm, brand: e.target.value })}
                          placeholder="Optional: e.g., Guard, Sufi, or leave blank"
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
                          Quality Grade (Optional)
                        </label>
                        <input
                          type="text"
                          value={requestForm.quality_grade}
                          onChange={(e) => setRequestForm({ ...requestForm, quality_grade: e.target.value })}
                          placeholder="Optional"
                          className="w-full px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                          Pack Size *
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={requestForm.pack_size}
                          onChange={(e) => setRequestForm({ ...requestForm, pack_size: e.target.value })}
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
                    </div>
                  </>
                )}

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
                  <Button type="button" variant="outline" size="sm" onClick={() => setRequestModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="button" variant="outline" size="sm" disabled={requestSubmitting} onClick={() => handleSubmitCatalogRequest(true)}>
                    Save as Draft
                  </Button>
                  <Button type="button" size="sm" disabled={requestSubmitting} onClick={() => handleSubmitCatalogRequest(false)}>
                    {requestSubmitting ? 'Submitting...' : 'Submit Request'}
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
