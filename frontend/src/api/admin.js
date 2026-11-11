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
  }
};

export default adminApi;

