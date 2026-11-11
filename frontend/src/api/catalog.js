// =============================================================================
// src/api/catalog.js
// MilJor Canonical Catalog, Supplier Catalog Requests & Admin Moderation API
// Package E2: Canonical Hierarchy (Category -> Family -> Variant -> Offer)
// =============================================================================
import apiClient from './client';

export const catalogApi = {
  // ---------------------------------------------------------------------------
  // A. Public & Shared Canonical Catalog Discovery
  // ---------------------------------------------------------------------------
  getCategories: async (params = {}) => {
    const res = await apiClient.get('/catalog/categories', { params });
    return res.data;
  },

  getCategoryFamilies: async (categoryId) => {
    const res = await apiClient.get(`/catalog/categories/${categoryId}/families`);
    return res.data;
  },

  getFamilies: async (params = {}) => {
    const res = await apiClient.get('/catalog/families', { params });
    return res.data;
  },

  getFamilyById: async (familyId) => {
    const res = await apiClient.get(`/catalog/families/${familyId}`);
    return res.data;
  },

  getFamilyVariants: async (familyId, params = {}) => {
    const res = await apiClient.get(`/catalog/families/${familyId}/variants`, { params });
    return res.data;
  },

  getVariantById: async (variantId) => {
    const res = await apiClient.get(`/catalog/variants/${variantId}`);
    return res.data;
  },

  // ---------------------------------------------------------------------------
  // B. Supplier-Owned Products & Physical SKUs (6-Level Hierarchy)
  // ---------------------------------------------------------------------------
  createSupplierProduct: async (payload) => {
    const res = await apiClient.post('/catalog/supplier-products', payload);
    return res.data;
  },

  getMySupplierProducts: async (params = {}) => {
    const res = await apiClient.get('/catalog/supplier-products/me', { params });
    return res.data;
  },

  getSupplierProductById: async (productId) => {
    const res = await apiClient.get(`/catalog/supplier-products/${productId}`);
    return res.data;
  },

  updateSupplierProduct: async (productId, payload) => {
    const res = await apiClient.put(`/catalog/supplier-products/${productId}`, payload);
    return res.data;
  },

  publishSupplierProduct: async (productId) => {
    const res = await apiClient.post(`/catalog/supplier-products/${productId}/publish`);
    return res.data;
  },

  archiveSupplierProduct: async (productId) => {
    const res = await apiClient.post(`/catalog/supplier-products/${productId}/archive`);
    return res.data;
  },

  createSupplierSku: async (payload) => {
    const res = await apiClient.post('/catalog/supplier-skus', payload);
    return res.data;
  },

  getMySupplierSkus: async (params = {}) => {
    const res = await apiClient.get('/catalog/supplier-skus/me', { params });
    return res.data;
  },

  getSupplierSkuById: async (skuId) => {
    const res = await apiClient.get(`/catalog/supplier-skus/${skuId}`);
    return res.data;
  },

  updateSupplierSku: async (skuId, payload) => {
    const res = await apiClient.put(`/catalog/supplier-skus/${skuId}`, payload);
    return res.data;
  },

  publishSupplierSku: async (skuId) => {
    const res = await apiClient.post(`/catalog/supplier-skus/${skuId}/publish`);
    return res.data;
  },

  archiveSupplierSku: async (skuId) => {
    const res = await apiClient.post(`/catalog/supplier-skus/${skuId}/archive`);
    return res.data;
  },

  // ---------------------------------------------------------------------------
  // C. Supplier Catalog Requests (NEW_FAMILY / NEW_VARIANT)
  // ---------------------------------------------------------------------------
  createCatalogRequest: async (payload) => {
    const res = await apiClient.post('/catalog/requests', payload);
    return res.data;
  },

  getMyCatalogRequests: async (params = {}) => {
    const res = await apiClient.get('/catalog/requests/me', { params });
    return res.data;
  },

  getCatalogRequestById: async (requestId) => {
    const res = await apiClient.get(`/catalog/requests/${requestId}`);
    return res.data;
  },

  updateCatalogRequest: async (requestId, payload) => {
    const res = await apiClient.put(`/catalog/requests/${requestId}`, payload);
    return res.data;
  },

  // ---------------------------------------------------------------------------
  // C. Supplier Commercial Offers / Listings (Against Approved Variants)
  // ---------------------------------------------------------------------------
  getMyListings: async () => {
    const res = await apiClient.get('/listings/me');
    return res.data;
  },

  createSupplierListing: async (payload) => {
    const res = await apiClient.post('/listings', payload);
    return res.data;
  },

  updateSupplierListing: async (listingId, payload) => {
    const res = await apiClient.put(`/listings/${listingId}`, payload);
    return res.data;
  },

  updateSupplierListingStatus: async (listingId, status) => {
    const res = await apiClient.patch(`/listings/${listingId}/status`, { status });
    return res.data;
  },

  getSupplierListingPriceHistory: async (listingId) => {
    const res = await apiClient.get(`/listings/${listingId}/price-history`);
    return res.data;
  },

  // ---------------------------------------------------------------------------
  // D. Admin Catalog Governance & Moderation Queue
  // ---------------------------------------------------------------------------
  adminGetCategories: async () => {
    const res = await apiClient.get('/admin/catalog/categories');
    return res.data;
  },

  adminCreateCategory: async (payload) => {
    const res = await apiClient.post('/admin/catalog/categories', payload);
    return res.data;
  },

  adminUpdateCategory: async (categoryId, payload) => {
    const res = await apiClient.put(`/admin/catalog/categories/${categoryId}`, payload);
    return res.data;
  },

  adminGetFamilies: async (params = {}) => {
    const res = await apiClient.get('/admin/catalog/families', { params });
    return res.data;
  },

  adminCreateFamily: async (payload) => {
    const res = await apiClient.post('/admin/catalog/families', payload);
    return res.data;
  },

  adminUpdateFamily: async (familyId, payload) => {
    const res = await apiClient.put(`/admin/catalog/families/${familyId}`, payload);
    return res.data;
  },

  adminCreateVariant: async (payload) => {
    const res = await apiClient.post('/admin/catalog/variants', payload);
    return res.data;
  },

  adminGetCatalogRequests: async (params = {}) => {
    const res = await apiClient.get('/admin/catalog/requests', { params });
    return res.data;
  },

  adminGetCatalogRequestById: async (requestId) => {
    const res = await apiClient.get(`/admin/catalog/requests/${requestId}`);
    return res.data;
  },

  adminReviewCatalogRequest: async (requestId, payload = {}) => {
    const res = await apiClient.post(`/admin/catalog/requests/${requestId}/review`, payload);
    return res.data;
  },

  adminApproveCatalogRequest: async (requestId, payload = {}) => {
    const res = await apiClient.post(`/admin/catalog/requests/${requestId}/approve`, payload);
    return res.data;
  },

  adminRejectCatalogRequest: async (requestId, payload) => {
    const res = await apiClient.post(`/admin/catalog/requests/${requestId}/reject`, payload);
    return res.data;
  }
};

export default catalogApi;
