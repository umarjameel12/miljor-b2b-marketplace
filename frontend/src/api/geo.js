// =============================================================================
// src/api/geo.js
// MilJor Special Phase G1: Lahore Geographic Intelligence API Client
// =============================================================================
import apiClient from './client';

export const geoApi = {
  // Fetch all active delivery clusters in Lahore
  getClusters: async () => {
    const res = await apiClient.get('/geo/clusters');
    return res.data;
  },

  // Fetch cluster details with localities
  getClusterById: async (clusterId) => {
    const res = await apiClient.get(`/geo/clusters/${clusterId}`);
    return res.data;
  },

  // Fetch Lahore District GeoJSON boundary & bounding box
  getBoundary: async () => {
    const res = await apiClient.get('/geo/boundary');
    return res.data;
  },

  // Search localities by query string
  searchAreas: async (query, limit = 20) => {
    const res = await apiClient.get('/geo/areas/search', { params: { q: query, limit } });
    return res.data;
  },

  // Validate coordinate containment inside Lahore District
  validateContainment: async (latitude, longitude) => {
    const res = await apiClient.post('/geo/validate-containment', { latitude, longitude });
    return res.data;
  },

  // Resolve freeform text address to verified Lahore locality/cluster
  resolveAddress: async (address) => {
    const res = await apiClient.post('/geo/resolve-address', { address });
    return res.data;
  },

  // Estimate road driving distance, duration and physical barrier analysis
  estimateRouting: async (origin, destination) => {
    const res = await apiClient.post('/geo/routing-estimate', { origin, destination });
    return res.data;
  }
};
