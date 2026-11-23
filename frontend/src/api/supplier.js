// =============================================================================
// src/api/supplier.js
// MilJor Supplier Portal API Client
// Package E1: Business Profile, Onboarding & Verification
// =============================================================================
import apiClient from './client';

export const supplierApi = {
  // 1. Get Authenticated Supplier Business Profile
  getProfile: async () => {
    const res = await apiClient.get('/supplier/profile');
    return res.data;
  },

  // Read authoritative active-family entitlement counts, never infer from listing caps.
  getSubscription: async () => {
    const res = await apiClient.get('/supplier/subscription');
    return res.data;
  },

  getSubscriptionPlans: async () => {
    const res = await apiClient.get('/supplier/subscription/plans');
    return res.data;
  },

  initiateSubscriptionCheckout: async ({ planCode, idempotencyKey }) => {
    const res = await apiClient.post('/supplier/subscription/checkout', {
      plan_code: planCode,
      idempotency_key: idempotencyKey
    });
    return res.data;
  },

  reconcileSubscriptionCheckout: async (attemptId) => {
    const res = await apiClient.post(`/supplier/subscription/checkout/${attemptId}/reconcile`);
    return res.data;
  },

  scheduleSubscriptionDowngrade: async (targetPlanCode) => {
    const res = await apiClient.post('/supplier/subscription/downgrade', {
      target_plan_code: targetPlanCode
    });
    return res.data;
  },

  cancelSubscription: async (reason) => {
    const res = await apiClient.post('/supplier/subscription/cancel', { reason });
    return res.data;
  },

  // 2. Update Supplier Business Profile (Save Draft or Update)
  updateProfile: async (profileData) => {
    const res = await apiClient.put('/supplier/profile', profileData);
    return res.data;
  },

  // 3. Submit Profile for Verification Review
  submitVerification: async () => {
    const res = await apiClient.post('/supplier/verification/submit');
    return res.data;
  },

  // 4. Get Lightweight Verification Status
  getVerificationStatus: async () => {
    const res = await apiClient.get('/supplier/verification/status');
    return res.data;
  },

  // 5. Delivery Logistics Settings (Special Phase G2)
  getDeliverySettings: async () => {
    const res = await apiClient.get('/supplier/delivery-settings');
    return res.data;
  },

  updateDeliverySettings: async (settings) => {
    const res = await apiClient.put('/supplier/delivery-settings', settings);
    return res.data;
  },

  addPickupPoint: async (point) => {
    const res = await apiClient.post('/supplier/pickup-points', point);
    return res.data;
  },

  updatePickupPoint: async (id, point) => {
    const res = await apiClient.patch(`/supplier/pickup-points/${id}`, point);
    return res.data;
  }
};

export default supplierApi;
