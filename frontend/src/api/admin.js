// =============================================================================
// src/api/admin.js
// MilJor Administrative & Verification API Client
// Package E1.1 Gate B: Complete Admin Verification Operations
// =============================================================================
import apiClient from './client';

export const adminApi = {
  // 1. List pending supplier verification applications
  getPendingSuppliers: async () => {
    const res = await apiClient.get('/admin/suppliers/pending');
    return res.data;
  },

  // 2. Approve or Reject a supplier verification request
  verifySupplier: async (supplierId, verificationPayload) => {
    const res = await apiClient.put(`/admin/suppliers/${supplierId}/verify`, verificationPayload);
    return res.data;
  },

  // 3. Suspend a user
  suspendUser: async (userId, reason) => {
    const res = await apiClient.put(`/admin/users/${userId}/suspend`, { reason });
    return res.data;
  },

  // 4. Reactivate a suspended user
  reactivateUser: async (userId) => {
    const res = await apiClient.put(`/admin/users/${userId}/reactivate`);
    return res.data;
  },

  // 5. Pending verified supplier subscription approvals
  getPendingSubscriptions: async () => {
    const res = await apiClient.get('/admin/subscriptions/pending');
    return res.data;
  },

  approveSubscription: async (subscriptionId, notes = '') => {
    const res = await apiClient.post(`/admin/subscriptions/${subscriptionId}/approve`, { notes });
    return res.data;
  },

  rejectSubscription: async (subscriptionId, reason) => {
    const res = await apiClient.post(`/admin/subscriptions/${subscriptionId}/reject`, { reason });
    return res.data;
  },

  getSubscriptionRefunds: async () => {
    const res = await apiClient.get('/admin/subscriptions/refunds');
    return res.data;
  },

  retrySubscriptionRefund: async (subscriptionId) => {
    const res = await apiClient.post(`/admin/subscriptions/${subscriptionId}/refund/retry`);
    return res.data;
  },

  syncSubscriptionRefund: async (subscriptionId) => {
    const res = await apiClient.post(`/admin/subscriptions/${subscriptionId}/refund/sync`);
    return res.data;
  },

  manualReconcileSubscriptionRefund: async (subscriptionId, { provider_refund_reference, evidence_notes }) => {
    const res = await apiClient.post(`/admin/subscriptions/${subscriptionId}/refund/manual-reconcile`, {
      provider_refund_reference,
      evidence_notes
    });
    return res.data;
  }
};

export default adminApi;

