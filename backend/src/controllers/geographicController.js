// =============================================================================
// src/controllers/geographicController.js
// MilJor Special Phase G1: Lahore Geographic Intelligence Controller
// =============================================================================
const geoService = require('../services/geographicService');

class GeographicController {
  /**
   * GET /api/v1/geo/clusters
   * List all active delivery clusters in Lahore
   */
  async getClusters(req, res) {
    try {
      const clusters = await geoService.listClusters();
      return res.status(200).json({
        success: true,
        data: {
          district: 'Lahore',
          total_clusters: clusters.length,
          clusters
        }
      });
    } catch (error) {
      console.error('[GeographicController] getClusters error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to retrieve geographic clusters.' }
      });
    }
  }

  /**
   * GET /api/v1/geo/clusters/:id
   * Get cluster details and member localities
   */
  async getClusterDetail(req, res) {
    try {
      const clusterId = Number(req.params.id);
      if (isNaN(clusterId)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_CLUSTER_ID', message: 'Cluster ID must be a numeric integer.' }
        });
      }

      const cluster = await geoService.getClusterDetail(clusterId);
      if (!cluster) {
        return res.status(404).json({
          success: false,
          error: { code: 'CLUSTER_NOT_FOUND', message: `Cluster with ID ${clusterId} not found.` }
        });
      }

      return res.status(200).json({
        success: true,
        data: cluster
      });
    } catch (error) {
      console.error('[GeographicController] getClusterDetail error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to retrieve cluster details.' }
      });
    }
  }

  /**
   * GET /api/v1/geo/boundary
   * Return authoritative Lahore District GeoJSON boundary & Bounding Box
   */
  async getBoundary(req, res) {
    try {
      const boundary = geoService.getLahoreDistrictBoundary();
      return res.status(200).json({
        success: true,
        data: boundary
      });
    } catch (error) {
      console.error('[GeographicController] getBoundary error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to retrieve boundary specification.' }
      });
    }
  }

  /**
   * GET /api/v1/geo/areas/search?q=...
   * Search localities by English name, Urdu name, or code
   */
  async searchAreas(req, res) {
    try {
      const query = req.query.q || '';
      const limit = Number(req.query.limit) || 20;

      if (!query || query.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'QUERY_REQUIRED', message: 'Search query parameter ?q= is required.' }
        });
      }

      const results = await geoService.searchLocalities(query, limit);
      return res.status(200).json({
        success: true,
        data: {
          query,
          match_count: results.length,
          localities: results
        }
      });
    } catch (error) {
      console.error('[GeographicController] searchAreas error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Search execution failed.' }
      });
    }
  }

  /**
   * POST /api/v1/geo/validate-containment
   * Body: { latitude, longitude }
   */
  async validateContainment(req, res) {
    try {
      const { latitude, longitude } = req.body || {};
      if (latitude === undefined || longitude === undefined) {
        return res.status(400).json({
          success: false,
          error: { code: 'COORDINATES_REQUIRED', message: 'Both latitude and longitude are required in body.' }
        });
      }

      const result = await geoService.validateContainment(latitude, longitude);
      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('[GeographicController] validateContainment error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Containment verification failed.' }
      });
    }
  }

  /**
   * POST /api/v1/geo/resolve-address
   * Body: { address: "..." }
   */
  async resolveAddress(req, res) {
    try {
      const { address } = req.body || {};
      if (!address || typeof address !== 'string' || address.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'ADDRESS_REQUIRED', message: 'Field "address" is required as non-empty string.' }
        });
      }

      const resolution = await geoService.resolveAddress(address);
      return res.status(200).json({
        success: true,
        data: resolution
      });
    } catch (error) {
      console.error('[GeographicController] resolveAddress error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Address resolution failed.' }
      });
    }
  }

  /**
   * POST /api/v1/geo/routing-estimate
   * Body: { origin: { latitude, longitude }, destination: { latitude, longitude } }
   */
  async estimateRouting(req, res) {
    try {
      const { origin, destination } = req.body || {};
      if (!origin || !destination) {
        return res.status(400).json({
          success: false,
          error: { code: 'ORIGIN_DESTINATION_REQUIRED', message: 'Both origin and destination objects with latitude/longitude are required.' }
        });
      }

      const estimate = await geoService.estimateRouting(origin, destination);
      return res.status(200).json({
        success: true,
        data: estimate
      });
    } catch (error) {
      console.error('[GeographicController] estimateRouting error:', error);
      return res.status(400).json({
        success: false,
        error: { code: 'ROUTING_ERROR', message: error.message }
      });
    }
  }
}

module.exports = new GeographicController();
