// =============================================================================
// src/services/supplierDeliveryService.js
// MilJor Special Phase G2: Supplier-Controlled Delivery Mode & Pricing Service
// =============================================================================
const supDelivRepo = require('../repositories/supplierDeliveryRepository');
const geoRepo = require('../repositories/geographicRepository');

class SupplierDeliveryService {
  /**
   * Fetch supplier's complete delivery configuration, rates and pickup points
   */
  async getSupplierSettings(supplierId, connection) {
    let config = await supDelivRepo.getSupplierConfiguration(supplierId, connection);

    // If never configured, provide clean default template
    if (!config) {
      config = {
        supplier_id: supplierId,
        standard_delivery_enabled: true,
        pickup_enabled: false,
        express_enabled: false,
        express_cutoff_time: '14:00:00',
        express_fulfillment_hours: 4,
        version: 1
      };
    }

    const [clusterRates, pickupPoints] = await Promise.all([
      supDelivRepo.getSupplierClusterRates(supplierId, connection),
      supDelivRepo.getSupplierPickupPoints(supplierId, connection)
    ]);

    return {
      configuration: config,
      cluster_rates: clusterRates,
      pickup_points: pickupPoints
    };
  }

  /**
   * Update supplier fulfillment modes and cluster rates
   */
  async updateSupplierSettings(supplierId, payload, connection) {
    const {
      standard_delivery_enabled = true,
      pickup_enabled = false,
      express_enabled = false,
      express_cutoff_time = '14:00:00',
      express_fulfillment_hours = 4,
      cluster_rates = [],
      is_draft = false
    } = payload;

    // Invariant: At least one delivery mode must be enabled for active offers.
    // Incomplete drafts during onboarding may have zero modes.
    if (!is_draft && !standard_delivery_enabled && !pickup_enabled && !express_enabled) {
      const err = new Error('A supplier must enable at least one fulfillment mode (Standard, Pickup, or Express).');
      err.code = 'AT_LEAST_ONE_MODE_REQUIRED';
      err.statusCode = 422;
      throw err;
    }

    // Process and validate cluster-specific rates upfront before mutating configuration
    const validatedRates = [];
    if (Array.isArray(cluster_rates) && cluster_rates.length > 0) {
      for (const rate of cluster_rates) {
        const clusterId = Number(rate.cluster_id);
        const mode = rate.mode;
        const feePkr = Number(rate.fee_pkr);
        const isEligible = rate.is_eligible !== undefined ? Boolean(rate.is_eligible) : true;

        if (isNaN(clusterId) || !['STANDARD_CLUSTERED', 'EXPRESS'].includes(mode)) {
          const err = new Error(`Invalid cluster rate specification for cluster_id: ${rate.cluster_id}`);
          err.code = 'INVALID_RATE_SPECIFICATION';
          err.statusCode = 400;
          throw err;
        }

        // Validate fee constraints: non-negative, finite, valid number
        if (isNaN(feePkr) || !isFinite(feePkr) || feePkr < 0) {
          const err = new Error(`Delivery fee for cluster ${clusterId} (${mode}) must be a valid non-negative number.`);
          err.code = 'INVALID_DELIVERY_FEE';
          err.statusCode = 400;
          throw err;
        }

        validatedRates.push({
          supplier_id: supplierId,
          cluster_id: clusterId,
          mode,
          is_eligible: isEligible,
          fee_pkr: Number(feePkr.toFixed(2))
        });
      }
    }

    // Save mode configuration only after all rate validations pass
    const savedConfig = await supDelivRepo.upsertSupplierConfiguration(supplierId, {
      standard_delivery_enabled: Boolean(standard_delivery_enabled),
      pickup_enabled: Boolean(pickup_enabled),
      express_enabled: Boolean(express_enabled),
      express_cutoff_time,
      express_fulfillment_hours: Number(express_fulfillment_hours) || 4
    }, connection);

    // Save validated rates
    for (const vRate of validatedRates) {
      await supDelivRepo.upsertSupplierClusterRate(vRate, connection);
    }

    return this.getSupplierSettings(supplierId, connection);
  }

  /**
   * Add a pickup point for supplier
   */
  async addPickupPoint(supplierId, pointData, connection) {
    const {
      point_name,
      cluster_id,
      address_line,
      operating_hours = 'Mon-Sat 09:00 - 18:00',
      pickup_handling_fee_pkr = 0.00,
      collection_instructions = null
    } = pointData;

    if (!point_name || typeof point_name !== 'string' || point_name.trim().length === 0) {
      const err = new Error('Pickup point name is required.');
      err.code = 'POINT_NAME_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    if (!cluster_id || isNaN(Number(cluster_id))) {
      const err = new Error('Pickup point cluster ID is required.');
      err.code = 'CLUSTER_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    const cluster = await geoRepo.getClusterById(Number(cluster_id), connection);
    if (!cluster || !cluster.is_active) {
      const err = new Error('Pickup point cluster does not exist or is inactive.');
      err.code = 'INVALID_CLUSTER';
      err.statusCode = 422;
      throw err;
    }

    if (!address_line || typeof address_line !== 'string' || address_line.trim().length === 0) {
      const err = new Error('Pickup point address is required.');
      err.code = 'ADDRESS_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    const fee = Number(pickup_handling_fee_pkr);
    if (isNaN(fee) || !isFinite(fee) || fee < 0) {
      const err = new Error('Pickup handling fee must be a valid non-negative number (PKR 0.00 is allowed).');
      err.code = 'INVALID_PICKUP_FEE';
      err.statusCode = 400;
      throw err;
    }

    const pointId = await supDelivRepo.createPickupPoint({
      supplier_id: supplierId,
      point_name: point_name.trim(),
      cluster_id: Number(cluster_id),
      address_line: address_line.trim(),
      operating_hours: operating_hours.trim(),
      pickup_handling_fee_pkr: Number(fee.toFixed(2)),
      collection_instructions: collection_instructions ? collection_instructions.trim() : null
    }, connection);

    const points = await supDelivRepo.getSupplierPickupPoints(supplierId, connection);
    return points.find(p => p.id === pointId);
  }

  /**
   * Update pickup point
   */
  async updatePickupPoint(pointId, supplierId, updateData, connection) {
    if (updateData.pickup_handling_fee_pkr !== undefined) {
      const fee = Number(updateData.pickup_handling_fee_pkr);
      if (isNaN(fee) || !isFinite(fee) || fee < 0) {
        const err = new Error('Pickup handling fee must be a valid non-negative number.');
        err.code = 'INVALID_PICKUP_FEE';
        err.statusCode = 400;
        throw err;
      }
      updateData.pickup_handling_fee_pkr = Number(fee.toFixed(2));
    }

    const success = await supDelivRepo.updatePickupPoint(pointId, supplierId, updateData, connection);
    if (!success) {
      const err = new Error('Pickup point not found or unauthorized.');
      err.code = 'PICKUP_POINT_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const points = await supDelivRepo.getSupplierPickupPoints(supplierId, connection);
    return points.find(p => p.id === Number(pointId));
  }
}

module.exports = new SupplierDeliveryService();
