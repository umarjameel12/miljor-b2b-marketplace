import apiClient from './client';

const makeIdempotencyKey = (prefix = 'pool') =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const poolsApi = {
  // Fetch published active pools with dynamic tier progress
  getActivePools: async (params = {}) => {
    const res = await apiClient.get('/pools', { params });
    return res.data;
  },

  // Fetch full details and progress snapshot of a single pool
  getPoolById: async (id) => {
    const res = await apiClient.get(`/pools/${id}`);
    return res.data;
  },

  // Supplier: fetch own pools (draft, active, etc.)
  getMyPools: async () => {
    const res = await apiClient.get('/pools/supplier/my');
    return res.data;
  },

  // Supplier: create a new Regular Pool in DRAFT status
  createPool: async (payload, idempotencyKey) => {
    const res = await apiClient.post('/pools', payload, {
      headers: { 'X-Idempotency-Key': idempotencyKey || makeIdempotencyKey('pool-create') }
    });
    return res.data;
  },

  // Supplier: update an existing DRAFT Regular Pool
  updateDraftPool: async (poolId, payload, idempotencyKey) => {
    const res = await apiClient.put(`/pools/${poolId}`, payload, {
      headers: { 'X-Idempotency-Key': idempotencyKey || makeIdempotencyKey('pool-update') }
    });
    return res.data;
  },

  // Supplier: update DRAFT pool delivery clusters
  updatePoolClusters: async (poolId, deliveryClusters) => {
    const res = await apiClient.put(`/pools/${poolId}/clusters`, {
      delivery_clusters: deliveryClusters
    });
    return res.data;
  },

  // Supplier: publish DRAFT pool to ACTIVE (locks commercial terms & 24-72h delivery SLA)
  publishPool: async (poolId, payload = {}, idempotencyKey) => {
    const res = await apiClient.post(`/pools/${poolId}/publish`, payload, {
      headers: { 'X-Idempotency-Key': idempotencyKey || makeIdempotencyKey('pool-publish') }
    });
    return res.data;
  }
};


