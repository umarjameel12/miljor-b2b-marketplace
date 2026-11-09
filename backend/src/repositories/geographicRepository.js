// =============================================================================
// src/repositories/geographicRepository.js
// MilJor Special Phase G1: Lahore Geographic Data Repository
// =============================================================================
const defaultDb = require('../config/db');

class GeographicRepository {
  /**
   * Fetch all active delivery clusters in Lahore
   */
  async getAllActiveClusters(connection) {
    const db = connection || defaultDb;
    const [rows] = await db.query(
      `SELECT 
        id,
        cluster_code,
        name,
        district,
        region_code,
        hub_name,
        CAST(hub_latitude AS DOUBLE) AS hub_latitude,
        CAST(hub_longitude AS DOUBLE) AS hub_longitude,
        CAST(coverage_radius_km AS DOUBLE) AS coverage_radius_km,
        is_active,
        metadata,
        created_at
       FROM geographic_clusters
       WHERE is_active = TRUE
       ORDER BY cluster_code ASC`
    );
    return rows;
  }

  /**
   * Fetch single cluster by ID with its member localities
   */
  async getClusterById(clusterId, connection) {
    const db = connection || defaultDb;
    const [clusterRows] = await db.query(
      `SELECT 
        id,
        cluster_code,
        name,
        district,
        region_code,
        hub_name,
        CAST(hub_latitude AS DOUBLE) AS hub_latitude,
        CAST(hub_longitude AS DOUBLE) AS hub_longitude,
        CAST(coverage_radius_km AS DOUBLE) AS coverage_radius_km,
        is_active,
        metadata,
        created_at
       FROM geographic_clusters
       WHERE id = ?`,
      [clusterId]
    );

    if (clusterRows.length === 0) {
      return null;
    }

    const cluster = clusterRows[0];
    const [localities] = await db.query(
      `SELECT 
        id,
        locality_code,
        cluster_id,
        name_en,
        name_ur,
        region_code,
        postal_code,
        CAST(latitude AS DOUBLE) AS latitude,
        CAST(longitude AS DOUBLE) AS longitude,
        status,
        is_supported,
        aliases
       FROM geographic_localities
       WHERE cluster_id = ?
       ORDER BY name_en ASC`,
      [clusterId]
    );

    cluster.localities = localities;
    return cluster;
  }

  /**
   * Fetch cluster by its code (e.g. LHR-CORE-COMMERCIAL)
   */
  async getClusterByCode(clusterCode, connection) {
    const db = connection || defaultDb;
    const [rows] = await db.query(
      `SELECT 
        id,
        cluster_code,
        name,
        district,
        region_code,
        hub_name,
        CAST(hub_latitude AS DOUBLE) AS hub_latitude,
        CAST(hub_longitude AS DOUBLE) AS hub_longitude,
        CAST(coverage_radius_km AS DOUBLE) AS coverage_radius_km,
        is_active,
        metadata
       FROM geographic_clusters
       WHERE cluster_code = ?`,
      [clusterCode]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Fetch all supported localities with cluster info
   */
  async getAllSupportedLocalities(connection) {
    const db = connection || defaultDb;
    const [rows] = await db.query(
      `SELECT 
        l.id,
        l.locality_code,
        l.cluster_id,
        l.name_en,
        l.name_ur,
        l.region_code,
        l.postal_code,
        CAST(l.latitude AS DOUBLE) AS latitude,
        CAST(l.longitude AS DOUBLE) AS longitude,
        l.status,
        l.is_supported,
        l.aliases,
        c.cluster_code,
        c.name AS cluster_name
       FROM geographic_localities l
       LEFT JOIN geographic_clusters c ON l.cluster_id = c.id
       ORDER BY l.name_en ASC`
    );
    return rows;
  }

  /**
   * Search localities by English name, Urdu name, code, or postal code
   */
  async searchLocalities(term, limit = 20, connection) {
    const db = connection || defaultDb;
    const searchTerm = `%${term}%`;
    const [rows] = await db.query(
      `SELECT 
        l.id,
        l.locality_code,
        l.cluster_id,
        l.name_en,
        l.name_ur,
        l.region_code,
        l.postal_code,
        CAST(l.latitude AS DOUBLE) AS latitude,
        CAST(l.longitude AS DOUBLE) AS longitude,
        l.status,
        l.is_supported,
        l.aliases,
        c.cluster_code,
        c.name AS cluster_name
       FROM geographic_localities l
       LEFT JOIN geographic_clusters c ON l.cluster_id = c.id
       WHERE l.name_en LIKE ? 
          OR l.name_ur LIKE ? 
          OR l.locality_code LIKE ?
          OR l.postal_code LIKE ?
       ORDER BY (l.name_en = ?) DESC, l.is_supported DESC, l.name_en ASC
       LIMIT ?`,
      [searchTerm, searchTerm, searchTerm, searchTerm, term, Number(limit)]
    );
    return rows;
  }

  /**
   * Fetch single locality by code
   */
  async getLocalityByCode(localityCode, connection) {
    const db = connection || defaultDb;
    const [rows] = await db.query(
      `SELECT 
        l.id,
        l.locality_code,
        l.cluster_id,
        l.name_en,
        l.name_ur,
        l.region_code,
        l.postal_code,
        CAST(l.latitude AS DOUBLE) AS latitude,
        CAST(l.longitude AS DOUBLE) AS longitude,
        l.status,
        l.is_supported,
        l.aliases,
        c.cluster_code,
        c.name AS cluster_name
       FROM geographic_localities l
       LEFT JOIN geographic_clusters c ON l.cluster_id = c.id
       WHERE l.locality_code = ?`,
      [localityCode]
    );
    return rows.length > 0 ? rows[0] : null;
  }
}

module.exports = new GeographicRepository();
