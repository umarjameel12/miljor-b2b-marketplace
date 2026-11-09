// =============================================================================
// src/services/deliveryEligibilityService.js
// MilJor Special Phase G2.2: Centralized Delivery Option Eligibility & Quotation Engine
// =============================================================================
const crypto = require('crypto');
const db = require('../config/db');
const supDelivRepo = require('../repositories/supplierDeliveryRepository');
const supDelivService = require('./supplierDeliveryService');
const geoRepo = require('../repositories/geographicRepository');

/**
 * Computes a deterministic SHA-256 fingerprint for a canonical delivery address
 */
function computeAddressFingerprint(address) {
  if (!address) return null;
  const normStr = (val) => (val || '').toString().trim().normalize('NFC').replace(/\s+/g, ' ').toLowerCase();
  const clusterId = Number(address.cluster_id || 0);
  const society = normStr(address.society_area);
  const fullAddr = normStr(address.full_address);
  const lat = address.pin_latitude !== null && address.pin_latitude !== undefined ? Number(address.pin_latitude).toFixed(6) : 'null';
  const lng = address.pin_longitude !== null && address.pin_longitude !== undefined ? Number(address.pin_longitude).toFixed(6) : 'null';

  const canonicalString = `cid:${clusterId}|soc:${society}|addr:${fullAddr}|lat:${lat}|lng:${lng}`;
  return crypto.createHash('sha256').update(canonicalString, 'utf8').digest('hex');
}

class DeliveryEligibilityService {
  /**
   * Evaluate fulfillment option eligibility for a buyer's cluster against a supplier
   * Supports authoritative pool-binding and Asia/Karachi cutoff verification
   */
  async getDeliveryOptions(buyerId, params, connection) {
    const { supplier_id, cluster_id, pool_id, address_id, currentTime } = params;

    let sId = supplier_id ? Number(supplier_id) : null;
    let pool = null;
    const activeDb = connection || db;

    // Authoritative Pool Resolution (DEFECT-G2-02 Fix)
    if (pool_id !== undefined && pool_id !== null) {
      const poolNum = Number(pool_id);
      if (isNaN(poolNum)) {
        const err = new Error('Pool ID must be a valid number.');
        err.code = 'INVALID_POOL_ID';
        err.statusCode = 400;
        throw err;
      }

      const [poolRows] = await activeDb.query('SELECT * FROM pools WHERE id = ?', [poolNum]);
      if (poolRows.length === 0) {
        const err = new Error(`Pool #${pool_id} does not exist.`);
        err.code = 'POOL_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }
      pool = poolRows[0];

      if (pool.status !== 'ACTIVE') {
        const err = new Error(`Pool #${pool_id} is not active (current status: ${pool.status}).`);
        err.code = 'POOL_INACTIVE';
        err.statusCode = 422;
        throw err;
      }

      const testNow = currentTime ? new Date(currentTime) : new Date();
      if (pool.expires_at && new Date(pool.expires_at) <= testNow) {
        const err = new Error(`Pool #${pool_id} has already expired (expired at ${pool.expires_at}).`);
        err.code = 'POOL_EXPIRED';
        err.statusCode = 422;
        throw err;
      }

      // If supplier_id was passed, verify it matches the pool's authoritative supplier
      if (sId && sId !== pool.supplier_id) {
        const err = new Error('The specified supplier does not match the pool listing.');
        err.code = 'POOL_SUPPLIER_MISMATCH';
        err.statusCode = 422;
        throw err;
      }

      // Authoritatively derive supplier_id from the pool
      sId = pool.supplier_id;
    }

    if (!sId || isNaN(sId)) {
      const err = new Error('A valid supplier_id or pool_id must be provided.');
      err.code = 'SUPPLIER_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    const cId = Number(cluster_id);
    if (isNaN(cId)) {
      const err = new Error('Delivery cluster_id must be a valid number.');
      err.code = 'INVALID_CLUSTER';
      err.statusCode = 400;
      throw err;
    }

    const cluster = await geoRepo.getClusterById(cId, connection);
    if (!cluster || !cluster.is_active) {
      const err = new Error('Delivery cluster not found or inactive.');
      err.code = 'INVALID_CLUSTER';
      err.statusCode = 422;
      throw err;
    }

    // Fetch supplier delivery settings
    const settings = await supDelivService.getSupplierSettings(sId, connection);
    const { configuration, cluster_rates, pickup_points } = settings;

    // Check pool-specific multi-cluster authorization & coverage policy (Phase 6D.3 & 6D.3.2)
    let poolAuthorizedClusterIds = null;
    let poolCoveragePolicy = pool ? (pool.coverage_policy || 'EXPLICIT_CLUSTERS') : null;
    if (pool) {
      const [pdcRows] = await activeDb.query(
        'SELECT cluster_id FROM pool_delivery_clusters WHERE pool_id = ?',
        [pool.id]
      );
      if (pdcRows.length > 0) {
        poolAuthorizedClusterIds = pdcRows.map(r => r.cluster_id);
      }
    }

    const eligibleModes = [];
    const ineligibleModes = [];

    // 1. STANDARD_CLUSTERED Evaluation
    if (poolCoveragePolicy === 'LEGACY_REVIEW_REQUIRED') {
      ineligibleModes.push({
        mode: 'STANDARD_CLUSTERED',
        reason_code: 'LEGACY_COVERAGE_REVIEW_REQUIRED',
        message: 'Legacy pool requires explicit coverage review before new delivery quotes can be generated.'
      });
    } else if (poolCoveragePolicy === 'PICKUP_ONLY' || (pool && pool.delivery_type === 'SUPPLIER_PICKUP')) {
      ineligibleModes.push({
        mode: 'STANDARD_CLUSTERED',
        reason_code: 'POOL_IS_PICKUP_ONLY',
        message: 'Pool is configured for supplier pickup only.'
      });
    } else if (configuration.standard_delivery_enabled) {
      const isPoolAuthorized = poolCoveragePolicy === 'LEGACY_KNOWN'
        ? true
        : (poolAuthorizedClusterIds !== null && poolAuthorizedClusterIds.includes(cId));

      if (pool && !isPoolAuthorized) {
        ineligibleModes.push({
          mode: 'STANDARD_CLUSTERED',
          reason_code: 'CLUSTER_NOT_AUTHORIZED_FOR_POOL',
          message: `Pool #${pool.id} has not authorized standard delivery to ${cluster.name}.`
        });
      } else {
        const rate = cluster_rates.find(r => r.cluster_id === cId && r.mode === 'STANDARD_CLUSTERED');
        if (rate && rate.is_eligible) {
          eligibleModes.push({
            mode: 'STANDARD_CLUSTERED',
            label: 'Standard Clustered Delivery',
            fee_pkr: Number(rate.fee_pkr.toFixed(2)),
            description: 'Consolidated delivery to your selected Lahore cluster drop zone.',
            cluster_id: cId,
            cluster_name: cluster.name
          });
        } else {
          ineligibleModes.push({
            mode: 'STANDARD_CLUSTERED',
            reason_code: 'CLUSTER_NOT_COVERED_BY_SUPPLIER',
            message: `Supplier does not currently offer standard delivery to ${cluster.name}.`
          });
        }
      }
    } else {
      ineligibleModes.push({
        mode: 'STANDARD_CLUSTERED',
        reason_code: 'MODE_DISABLED_BY_SUPPLIER',
        message: 'Supplier has disabled standard delivery for this listing.'
      });
    }

    // 2. PICKUP Evaluation (Independent of buyer destination cluster)
    if (poolCoveragePolicy === 'LEGACY_REVIEW_REQUIRED') {
      ineligibleModes.push({
        mode: 'PICKUP',
        reason_code: 'LEGACY_COVERAGE_REVIEW_REQUIRED',
        message: 'Legacy pool requires explicit coverage review before new delivery quotes can be generated.'
      });
    } else if (pool && pool.delivery_type === 'DOORSTEP_ONLY') {
      ineligibleModes.push({
        mode: 'PICKUP',
        reason_code: 'POOL_DOES_NOT_SUPPORT_PICKUP',
        message: 'Pool does not support self-pickup.'
      });
    } else if (configuration.pickup_enabled) {
      const activePickupPoints = pickup_points.filter(p => p.is_active);
      if (activePickupPoints.length > 0) {
        eligibleModes.push({
          mode: 'PICKUP',
          label: 'Self Pickup / Collection',
          pickup_points: activePickupPoints.map(p => ({
            id: p.id,
            point_name: p.point_name,
            cluster_name: p.cluster_name,
            address_line: p.address_line,
            operating_hours: p.operating_hours,
            handling_fee_pkr: Number(Number(p.pickup_handling_fee_pkr || 0).toFixed(2)),
            collection_instructions: p.collection_instructions
          })),
          description: 'Collect your order directly from supplier approved warehouse/distribution point.'
        });
      } else {
        ineligibleModes.push({
          mode: 'PICKUP',
          reason_code: 'NO_ACTIVE_PICKUP_POINTS',
          message: 'Pickup is enabled but supplier has no active pickup locations available.'
        });
      }
    } else {
      ineligibleModes.push({
        mode: 'PICKUP',
        reason_code: 'MODE_DISABLED_BY_SUPPLIER',
        message: 'Supplier does not offer self-pickup for this listing.'
      });
    }

    // 3. EXPRESS Evaluation (DEFECT-G2-05 Fix: Asia/Karachi Cutoff Verification)
    if (poolCoveragePolicy === 'LEGACY_REVIEW_REQUIRED') {
      ineligibleModes.push({
        mode: 'EXPRESS',
        reason_code: 'LEGACY_COVERAGE_REVIEW_REQUIRED',
        message: 'Legacy pool requires explicit coverage review before new delivery quotes can be generated.'
      });
    } else if (poolCoveragePolicy === 'PICKUP_ONLY' || (pool && pool.delivery_type === 'SUPPLIER_PICKUP')) {
      ineligibleModes.push({
        mode: 'EXPRESS',
        reason_code: 'POOL_IS_PICKUP_ONLY',
        message: 'Pool is configured for supplier pickup only.'
      });
    } else if (configuration.express_enabled) {
      const isPoolAuthorized = poolCoveragePolicy === 'LEGACY_KNOWN'
        ? true
        : (poolAuthorizedClusterIds !== null && poolAuthorizedClusterIds.includes(cId));

      if (pool && !isPoolAuthorized) {
        ineligibleModes.push({
          mode: 'EXPRESS',
          reason_code: 'CLUSTER_NOT_AUTHORIZED_FOR_POOL',
          message: `Pool #${pool.id} has not authorized express delivery to ${cluster.name}.`
        });
      } else {
        const rate = cluster_rates.find(r => r.cluster_id === cId && r.mode === 'EXPRESS');
        const testNow = currentTime ? new Date(currentTime) : new Date();
        
        // Determine wall-clock time in Asia/Karachi
        const karachiTimeStr = testNow.toLocaleTimeString('en-GB', { timeZone: 'Asia/Karachi', hour12: false });
        const cutoffTimeStr = configuration.express_cutoff_time || '14:00:00';
        const isPastCutoff = karachiTimeStr > cutoffTimeStr;

        if (isPastCutoff) {
          ineligibleModes.push({
            mode: 'EXPRESS',
            reason_code: 'EXPRESS_CUTOFF_PASSED',
            cutoff_time: cutoffTimeStr,
            current_karachi_time: karachiTimeStr.slice(0, 5),
            message: `Express order cutoff for today (${cutoffTimeStr} PKT) has passed in Asia/Karachi timezone. Current PKT is ${karachiTimeStr.slice(0, 5)}.`
          });
        } else if (rate && rate.is_eligible) {
          eligibleModes.push({
            mode: 'EXPRESS',
            label: 'Express Dedicated Delivery',
            fee_pkr: Number(rate.fee_pkr.toFixed(2)),
            fulfillment_hours: configuration.express_fulfillment_hours || 4,
            cutoff_time: cutoffTimeStr,
            description: `Direct expedited dispatch within ${configuration.express_fulfillment_hours || 4} hours starting from commercial release.`,
            cluster_id: cId,
            cluster_name: cluster.name
          });
        } else {
          ineligibleModes.push({
            mode: 'EXPRESS',
            reason_code: 'EXPRESS_UNAVAILABLE_FOR_CLUSTER',
            message: `Express delivery is not available for ${cluster.name}.`
          });
        }
      }
    } else {
      ineligibleModes.push({
        mode: 'EXPRESS',
        reason_code: 'MODE_DISABLED_BY_SUPPLIER',
        message: 'Supplier has not authorized express delivery.'
      });
    }

    return {
      buyer_cluster: {
        id: cluster.id,
        cluster_code: cluster.cluster_code,
        name: cluster.name
      },
      supplier_id: sId,
      pool_id: pool_id ? Number(pool_id) : null,
      address_id: address_id ? Number(address_id) : null,
      eligible_modes: eligibleModes,
      ineligible_modes: ineligibleModes,
      supplier_config_version: configuration.version || 1,
      pool
    };
  }

  /**
   * Generate an authoritative server-side delivery quote
   * Immune to client-side tampering of fees or disabled modes
   * Supports dynamic expiration alignment (DEFECT-G2-03)
   */
  async createAuthoritativeQuote(buyerId, payload, connection) {
    const {
      supplier_id,
      pool_id = null,
      cluster_id,
      address_id = null,
      mode,
      pickup_point_id = null,
      currentTime
    } = payload;

    const activeDb = connection || db;

    if (!['STANDARD_CLUSTERED', 'PICKUP', 'EXPRESS'].includes(mode)) {
      const err = new Error(`Invalid fulfillment mode '${mode}'. Must be STANDARD_CLUSTERED, PICKUP, or EXPRESS.`);
      err.code = 'INVALID_MODE';
      err.statusCode = 400;
      throw err;
    }

    // 0. Delivery Address Enforcement (Phase 6D.3: Mandatory for STANDARD_CLUSTERED & EXPRESS, NOT required for PICKUP)
    if (mode === 'STANDARD_CLUSTERED' || mode === 'EXPRESS') {
      let hasAddress = false;
      if (address_id) {
        const [addrRows] = await activeDb.query(
          'SELECT id FROM buyer_delivery_addresses WHERE id = ? AND user_id = ?',
          [Number(address_id), buyerId]
        );
        if (addrRows.length === 0) {
          const err = new Error('Specified delivery address does not exist or does not belong to you.');
          err.code = 'INVALID_ADDRESS';
          err.statusCode = 422;
          throw err;
        }
        hasAddress = true;
      } else {
        const [addrRows] = await activeDb.query(
          'SELECT id FROM buyer_delivery_addresses WHERE user_id = ? LIMIT 1',
          [buyerId]
        );
        if (addrRows.length > 0) {
          hasAddress = true;
        } else {
          const [userRows] = await activeDb.query(
            'SELECT address, city FROM users WHERE id = ?',
            [buyerId]
          );
          if (userRows.length > 0 && userRows[0].address && userRows[0].address.trim().length > 0) {
            hasAddress = true;
          }
        }
      }

      if (!hasAddress) {
        const err = new Error('A verified Lahore delivery address is required before generating or accepting delivery quotes.');
        err.code = 'DELIVERY_ADDRESS_REQUIRED';
        err.statusCode = 422;
        throw err;
      }
    }

    // Recheck eligibility server-side with pool-binding
    const eligibility = await this.getDeliveryOptions(buyerId, {
      supplier_id,
      cluster_id,
      pool_id,
      address_id,
      currentTime
    }, connection);

    const matchedMode = eligibility.eligible_modes.find(m => m.mode === mode);
    if (!matchedMode) {
      const ineligibilityReason = eligibility.ineligible_modes.find(m => m.mode === mode);
      const err = new Error(ineligibilityReason ? ineligibilityReason.message : `Fulfillment mode '${mode}' is not available for this cluster.`);
      err.code = ineligibilityReason ? ineligibilityReason.reason_code : 'MODE_NOT_ELIGIBLE';
      err.statusCode = 422;
      throw err;
    }

    let quotedFee = 0.00;
    let selectedPickupId = null;

    if (mode === 'STANDARD_CLUSTERED' || mode === 'EXPRESS') {
      quotedFee = typeof matchedMode.fee_pkr === 'number' ? matchedMode.fee_pkr : 0.00;
    } else if (mode === 'PICKUP') {
      if (!pickup_point_id) {
        selectedPickupId = matchedMode.pickup_points[0].id;
        quotedFee = typeof matchedMode.pickup_points[0].handling_fee_pkr === 'number'
          ? matchedMode.pickup_points[0].handling_fee_pkr
          : 0.00;
      } else {
        const point = matchedMode.pickup_points.find(p => p.id === Number(pickup_point_id));
        if (!point) {
          const err = new Error('Specified pickup point does not belong to this supplier.');
          err.code = 'INVALID_PICKUP_POINT';
          err.statusCode = 422;
          throw err;
        }
        selectedPickupId = point.id;
        quotedFee = typeof point.handling_fee_pkr === 'number' ? point.handling_fee_pkr : 0.00;
      }
    }

    // Capture destination address snapshot for delivery modes (Phase 6D.3.2 & 6D.3.3)
    let destinationAddressSnapshot = null;
    let destinationFingerprint = null;
    if (mode === 'STANDARD_CLUSTERED' || mode === 'EXPRESS') {
      let addr = null;
      if (address_id) {
        const [addrRows] = await activeDb.query(
          'SELECT id, cluster_id, society_area, full_address, pin_latitude, pin_longitude, geographic_match_status, revision FROM buyer_delivery_addresses WHERE id = ? AND user_id = ?',
          [Number(address_id), buyerId]
        );
        if (addrRows.length > 0) addr = addrRows[0];
      } else {
        const [addrRows] = await activeDb.query(
          'SELECT id, cluster_id, society_area, full_address, pin_latitude, pin_longitude, geographic_match_status, revision FROM buyer_delivery_addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC LIMIT 1',
          [buyerId]
        );
        if (addrRows.length > 0) addr = addrRows[0];
      }

      if (addr) {
        destinationFingerprint = computeAddressFingerprint(addr);
        destinationAddressSnapshot = {
          address_id: addr.id,
          revision: addr.revision || 1,
          cluster_id: addr.cluster_id,
          society_area: addr.society_area,
          full_address: addr.full_address,
          pin_latitude: addr.pin_latitude,
          pin_longitude: addr.pin_longitude,
          geographic_match_status: addr.geographic_match_status,
          fingerprint: destinationFingerprint
        };
      }
    }

    // Dynamic Quote Expiration Alignment (DEFECT-G2-03 Fix)
    const maxTtlMs = 24 * 60 * 60 * 1000;
    const nowMs = currentTime ? new Date(currentTime).getTime() : Date.now();
    let quoteExpiresAtMs = nowMs + maxTtlMs;

    if (eligibility.pool && eligibility.pool.expires_at) {
      const poolExpiresAtMs = new Date(eligibility.pool.expires_at).getTime();
      if (poolExpiresAtMs <= nowMs) {
        const err = new Error(`Cannot generate delivery quote for an expired pool (closed at ${eligibility.pool.expires_at}).`);
        err.code = 'POOL_EXPIRED';
        err.statusCode = 422;
        throw err;
      }
      if (poolExpiresAtMs < quoteExpiresAtMs) {
        // Cap quote expiration by pool closing time
        quoteExpiresAtMs = poolExpiresAtMs;
      }
    }

    const expiresAt = new Date(quoteExpiresAtMs);

    // Generate unique quote code with high entropy
    const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
    const quoteCode = `DLV-QTE-${Date.now().toString().slice(-6)}-${rand}`;

    const quoteRecord = await supDelivRepo.createDeliveryQuote({
      quote_code: quoteCode,
      buyer_id: buyerId,
      supplier_id: eligibility.supplier_id,
      pool_id: eligibility.pool_id,
      cluster_id: Number(cluster_id),
      address_id: address_id ? Number(address_id) : null,
      destination_address_snapshot: destinationAddressSnapshot,
      destination_fingerprint: destinationFingerprint,
      mode,
      quoted_delivery_fee_pkr: Number(quotedFee.toFixed(2)),
      pickup_point_id: selectedPickupId,
      supplier_config_version: eligibility.supplier_config_version,
      expires_at: expiresAt
    }, connection);

    return quoteRecord;
  }

  /**
   * Verify and atomically accept an authoritative delivery quote (DEFECT-G2-04 Fix & Phase 6D.3.3 Advanced Safety)
   */
  async verifyAndAcceptQuote(buyerId, quoteCode, options = {}, connection) {
    const isExternalConn = Boolean(connection);
    const activeDb = connection || await db.getConnection();
    if (!isExternalConn) await activeDb.beginTransaction();

    try {
      // 1. Lock the parent user row to serialize concurrent address modifications and quote acceptance
      await activeDb.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [buyerId]);

      // 2. Fetch and lock the quote row
      const [quotes] = await activeDb.query(
        'SELECT * FROM delivery_quotes WHERE quote_code = ? FOR UPDATE',
        [quoteCode]
      );

      if (quotes.length === 0) {
        const err = new Error(`Delivery quote '${quoteCode}' not found.`);
        err.code = 'QUOTE_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const quote = quotes[0];

      // Validate Buyer Ownership
      if (quote.buyer_id !== Number(buyerId)) {
        const err = new Error('Unauthorized. You do not own this delivery quote.');
        err.code = 'QUOTE_FORBIDDEN';
        err.statusCode = 403;
        throw err;
      }

      // Validate Single-Use / Replay Prevention
      if (quote.status === 'ACCEPTED') {
        const err = new Error('This delivery quote has already been accepted (replay prevented).');
        err.code = 'QUOTE_ALREADY_ACCEPTED';
        err.statusCode = 409;
        throw err;
      }

      if (quote.status !== 'PENDING') {
        const err = new Error(`Delivery quote cannot be accepted in status '${quote.status}'.`);
        err.code = 'QUOTE_NOT_PENDING';
        err.statusCode = 422;
        throw err;
      }

      // Validate Expiration
      const now = options.currentTime ? new Date(options.currentTime) : new Date();
      if (new Date(quote.expires_at) <= now) {
        await activeDb.query("UPDATE delivery_quotes SET status = 'EXPIRED' WHERE id = ?", [quote.id]);
        const err = new Error('Delivery quote has expired.');
        err.code = 'QUOTE_EXPIRED';
        err.statusCode = 422;
        throw err;
      }

      // Validate Pool Lifecycle (if linked)
      if (quote.pool_id) {
        const [poolRows] = await activeDb.query('SELECT * FROM pools WHERE id = ?', [quote.pool_id]);
        if (poolRows.length > 0) {
          const p = poolRows[0];
          if (p.status !== 'ACTIVE' || (p.expires_at && new Date(p.expires_at) <= now)) {
            await activeDb.query("UPDATE delivery_quotes SET status = 'SUPERSEDED' WHERE id = ?", [quote.id]);
            const err = new Error(`Pool #${quote.pool_id} is no longer active.`);
            err.code = 'POOL_INACTIVE';
            err.statusCode = 422;
            throw err;
          }
        }
      }

      // Validate Destination Address for Delivery Modes (Phase 6D.3.2 & 6D.3.3)
      if (quote.mode === 'STANDARD_CLUSTERED' || quote.mode === 'EXPRESS') {
        let snap = null;
        if (quote.destination_address_snapshot) {
          snap = typeof quote.destination_address_snapshot === 'string'
            ? JSON.parse(quote.destination_address_snapshot)
            : quote.destination_address_snapshot;
        }

        const targetAddressId = quote.address_id || (snap && snap.address_id) || null;

        if (targetAddressId) {
          const [addrRows] = await activeDb.query(
            'SELECT id, cluster_id, society_area, full_address, pin_latitude, pin_longitude, geographic_match_status, revision FROM buyer_delivery_addresses WHERE id = ? AND user_id = ?',
            [targetAddressId, buyerId]
          );

          if (addrRows.length === 0) {
            const err = new Error('The delivery address associated with this quote no longer exists.');
            err.code = 'ADDRESS_NOT_FOUND';
            err.statusCode = 422;
            throw err;
          }

          const currentAddr = addrRows[0];

          // 1. Cluster check
          if (Number(currentAddr.cluster_id) !== Number(quote.cluster_id)) {
            const err = new Error(`Delivery address cluster (${currentAddr.cluster_id}) does not match quoted destination cluster (${quote.cluster_id}). Please request a new quote.`);
            err.code = 'ADDRESS_CLUSTER_MISMATCH';
            err.statusCode = 422;
            throw err;
          }

          // 2. Destination Fingerprint check
          const currentFingerprint = computeAddressFingerprint(currentAddr);
          const quotedFingerprint = quote.destination_fingerprint || (snap && snap.fingerprint) || null;

          if (quotedFingerprint && currentFingerprint !== quotedFingerprint) {
            const err = new Error('Delivery destination address has been modified since quote generation. Please request a new delivery quote.');
            err.code = 'ADDRESS_DESTINATION_MISMATCH';
            err.statusCode = 422;
            throw err;
          }

          // 3. Address Revision check
          if (snap && snap.revision !== undefined && currentAddr.revision !== undefined) {
            if (currentAddr.revision !== snap.revision) {
              const err = new Error('Delivery destination address revision has changed since quote generation. Please request a new delivery quote.');
              err.code = 'ADDRESS_DESTINATION_MISMATCH';
              err.statusCode = 422;
              throw err;
            }
          }
        } else {
          // If no specific address_id, verify buyer has a delivery address
          const [addrRows] = await activeDb.query(
            'SELECT id FROM buyer_delivery_addresses WHERE user_id = ? LIMIT 1',
            [buyerId]
          );
          if (addrRows.length === 0) {
            const [userRows] = await activeDb.query('SELECT address FROM users WHERE id = ?', [buyerId]);
            if (!userRows.length || !userRows[0].address || !userRows[0].address.trim()) {
              const err = new Error('A verified Lahore delivery address is required before generating or accepting delivery quotes.');
              err.code = 'DELIVERY_ADDRESS_REQUIRED';
              err.statusCode = 422;
              throw err;
            }
          }
        }
      }

      // Atomic single-use state transition: PENDING -> ACCEPTED
      const [result] = await activeDb.query(
        "UPDATE delivery_quotes SET status = 'ACCEPTED' WHERE quote_code = ? AND status = 'PENDING'",
        [quote.quote_code]
      );

      if (result.affectedRows === 0) {
        const [currentRows] = await activeDb.query(
          'SELECT status FROM delivery_quotes WHERE quote_code = ?',
          [quote.quote_code]
        );
        if (currentRows.length > 0 && currentRows[0].status === 'ACCEPTED') {
          const err = new Error('This delivery quote has already been accepted (replay prevented).');
          err.code = 'QUOTE_ALREADY_ACCEPTED';
          err.statusCode = 409;
          throw err;
        }
        const err = new Error('Quote acceptance conflict: quote was updated concurrently.');
        err.code = 'CONCURRENT_QUOTE_ACCEPTANCE';
        err.statusCode = 409;
        throw err;
      }

      const [updatedQuotes] = await activeDb.query('SELECT * FROM delivery_quotes WHERE id = ?', [quote.id]);
      if (!isExternalConn) await activeDb.commit();
      return updatedQuotes[0];
    } catch (err) {
      if (!isExternalConn) await activeDb.rollback();
      throw err;
    } finally {
      if (!isExternalConn) activeDb.release();
    }
  }
}

module.exports = new DeliveryEligibilityService();
