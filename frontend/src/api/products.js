// =============================================================================
// src/api/products.js
// MilJor Product Catalog & Supplier Listings API Client
// =============================================================================
import apiClient from './client';

export const productsApi = {
  // Fetch all authorized catalog products (public/buyer)
  getAllProducts: async (params = {}) => {
    const res = await apiClient.get('/products', { params });
    return res.data;
  },

  // Fetch product by ID
  getProductById: async (id) => {
    const res = await apiClient.get(`/products/${id}`);
    return res.data;
  },

  // Create new product specification (Supplier/Admin)
  createProduct: async (productData) => {
    const res = await apiClient.post('/products', productData);
    return res.data;
  },

  // Fetch public supplier listings
  getAllListings: async (params = {}) => {
    const res = await apiClient.get('/listings', { params });
    return res.data;
  },

  // Fetch authenticated supplier's own listings
  getMyListings: async () => {
    const res = await apiClient.get('/listings/me');
    return res.data;
  },

  // Fetch listing detail
  getListingById: async (id) => {
    const res = await apiClient.get(`/listings/${id}`);
    return res.data;
  },

  // Create new supplier listing
  createListing: async (listingData) => {
    const res = await apiClient.post('/listings', listingData);
    return res.data;
  },

  // Update existing listing
  updateListing: async (id, updateData) => {
    const res = await apiClient.put(`/listings/${id}`, updateData);
    return res.data;
  },

  // Update listing status (ACTIVE, PAUSED, etc.)
  updateListingStatus: async (id, status) => {
    const res = await apiClient.patch(`/listings/${id}/status`, { status });
    return res.data;
  }
};

export default productsApi;
