import apiClient from './client.js';

const unwrap = (res) => {
  if (!res?.data?.success || !res.data.data) {
    throw new Error(res?.data?.error?.message || 'Delivery operation failed.');
  }
  return res.data.data;
};

const makeKey = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const deliveryRunsApi = {
  getBuyerStop: async (orderId, { signal } = {}) =>
    unwrap(await apiClient.get(`/delivery-runs/buyer/orders/${encodeURIComponent(orderId)}/stop`, { signal })),

  recordBuyerReceipt: async (stopId, body, key = makeKey('receipt')) =>
    unwrap(await apiClient.post(`/delivery-runs/buyer/stops/${encodeURIComponent(stopId)}/receipt`, body, {
      headers: { 'X-Idempotency-Key': key }
    })),

  decideAmendment: async (amendmentId, body, key = makeKey('amend-dec')) =>
    unwrap(await apiClient.post(`/delivery-runs/amendments/${encodeURIComponent(amendmentId)}/decide`, body, {
      headers: { 'X-Idempotency-Key': key }
    })),

  getSupplierManifest: async ({ status, signal } = {}) =>
    unwrap(await apiClient.get('/delivery-runs/supplier/manifest', {
      params: status ? { status } : {},
      signal
    })),

  formRun: async (body, key = makeKey('form-run')) =>
    unwrap(await apiClient.post('/delivery-runs/supplier/runs', body, {
      headers: { 'X-Idempotency-Key': key }
    })),

  lockCutoff: async (runId, body = {}, key = makeKey('cutoff')) =>
    unwrap(await apiClient.post(`/delivery-runs/supplier/runs/${encodeURIComponent(runId)}/lock-cutoff`, body, {
      headers: { 'X-Idempotency-Key': key }
    })),

  dispatchRun: async (runId, body = {}, key = makeKey('dispatch')) =>
    unwrap(await apiClient.post(`/delivery-runs/supplier/runs/${encodeURIComponent(runId)}/dispatch`, body, {
      headers: { 'X-Idempotency-Key': key }
    })),

  updateRunEta: async (runId, body, key = makeKey('eta')) =>
    unwrap(await apiClient.post(`/delivery-runs/supplier/runs/${encodeURIComponent(runId)}/eta`, body, {
      headers: { 'X-Idempotency-Key': key }
    })),

  claimPickup: async (stopId, pickupCode, key = makeKey('pickup')) =>
    unwrap(await apiClient.post(`/delivery-runs/supplier/stops/${encodeURIComponent(stopId)}/claim-pickup`, { pickup_code: pickupCode }, {
      headers: { 'X-Idempotency-Key': key }
    })),

  markStopDelivered: async (stopId, notes, key = makeKey('delivered')) =>
    unwrap(await apiClient.post(`/delivery-runs/supplier/stops/${encodeURIComponent(stopId)}/mark-delivered`, { notes }, {
      headers: { 'X-Idempotency-Key': key }
    })),

  recordFailedAttempt: async (stopId, body, key = makeKey('attempt')) =>
    unwrap(await apiClient.post(`/delivery-runs/supplier/stops/${encodeURIComponent(stopId)}/failed-attempt`, body, {
      headers: { 'X-Idempotency-Key': key }
    })),

  proposeAmendment: async (body, key = makeKey('amend')) =>
    unwrap(await apiClient.post('/delivery-runs/amendments', body, {
      headers: { 'X-Idempotency-Key': key }
    })),

  getAdminExceptions: async ({ signal } = {}) =>
    unwrap(await apiClient.get('/delivery-runs/admin/exceptions', { signal })),

  adminRecoverStop: async (stopId, body, key = makeKey('admin-rec')) =>
    unwrap(await apiClient.post(`/delivery-runs/admin/stops/${encodeURIComponent(stopId)}/recover`, body, {
      headers: { 'X-Idempotency-Key': key }
    }))
};
