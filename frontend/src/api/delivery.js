// =============================================================================
// src/api/delivery.js
// MilJor Special Phase G2: Delivery, Address & Fulfillment API Client
// =============================================================================
import apiClient from './client';

export const deliveryApi = {
  // --- Buyer Delivery Addresses ---
  getBuyerAddresses: async () => {
    const res = await apiClient.get('/buyer/addresses');
    return res.data;
  },

  createBuyerAddress: async (addressData) => {
    const res = await apiClient.post('/buyer/addresses', addressData);
    return res.data;
  },

  updateBuyerAddress: async (id, updateData) => {
    const res = await apiClient.patch(`/buyer/addresses/${id}`, updateData);
    return res.data;
  },

  deleteBuyerAddress: async (id) => {
    const res = await apiClient.delete(`/buyer/addresses/${id}`);
    return res.data;
  },

  // --- Supplier Delivery Settings ---
  getSupplierDeliverySettings: async () => {
    const res = await apiClient.get('/supplier/delivery-settings');
    return res.data;
  },

  updateSupplierDeliverySettings: async (settingsData) => {
    const res = await apiClient.put('/supplier/delivery-settings', settingsData);
    return res.data;
  },

  addPickupPoint: async (pointData) => {
    const res = await apiClient.post('/supplier/pickup-points', pointData);
    return res.data;
  },

  updatePickupPoint: async (id, pointData) => {
    const res = await apiClient.patch(`/supplier/pickup-points/${id}`, pointData);
    return res.data;
  },

  // --- Delivery Quotation & Eligibility ---
  getPoolDeliveryOptions: async (poolId, params) => {
    const res = await apiClient.get(`/pools/${poolId}/delivery-options`, { params });
    return res.data;
  },

  createDeliveryQuote: async (quotePayload) => {
    const res = await apiClient.post('/delivery/quote', quotePayload);
    return res.data;
  },

  acceptDeliveryQuote: async (quoteCode) => {
    const res = await apiClient.post('/delivery/quote/accept', { quote_code: quoteCode });
    return res.data;
  }
};
