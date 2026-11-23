'use strict';

const crypto = require('node:crypto');
const db = require('../config/db');
const exactDecimal = require('./exactDecimal');
const supplierEligibilityPolicy = require('./supplierEligibilityPolicy');
const encryptionService = require('./encryptionService');
const ucpNotifications = require('./ucpTransactionalNotifications');

const DISCRETE_UNITS = new Set(['bag', 'bags', 'sack', 'sacks', 'tin', 'tins', 'carton', 'cartons', 'box', 'boxes', 'pack', 'packs', 'piece', 'pieces']);
const VALID_MODES = new Set(['STANDARD_CLUSTERED', 'EXPRESS', 'PICKUP']);
const VALID_COST_RESPONSIBILITIES = new Set([
  'BUYER_REQUESTED',
  'SUPPLIER_CARRIER_FAILURE',
  'PLATFORM_PROVIDER_FAULT',
  'DISPUTED_RESPONSIBILITY',
  'NO_EXTRA_COST'
]);
const VALID_AMENDMENT_TYPES = new Set([
  'REATTEMPT',
  'REROUTE',
  'ADDRESS_CHANGE',
  'MODE_CHANGE',
  'WINDOW_CHANGE',
  'ADMIN_RECOVERY'
]);

function fail(code, message, statusCode = 409) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

function posId(val, code = 'INVALID_ID') {
  if (!/^[1-9]\d*$/.test(String(val)) || !Number.isSafeInteger(Number(val))) {
    throw fail(code, 'Valid positive integer identifier required.', 400);
  }
  return Number(val);
}

function requireIdempotencyKey(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9:_-]{8,120}$/.test(key.trim())) {
    throw fail('IDEMPOTENCY_KEY_REQUIRED', 'A valid X-Idempotency-Key header (8-120 chars) is required.', 400);
  }
  return key.trim();
}

function sha256Hex(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

function normalizeSqlDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw fail('INVALID_DATETIME', 'Invalid date/time value.', 400);
    return value.toISOString().slice(0, 19).replace('T', ' ');
  }
  const str = String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str) ? str.replace(' ', 'T') + 'Z' : str;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) {
    throw fail('INVALID_DATETIME', 'Invalid date/time value.', 400);
  }
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function parseJson(val) {
  if (val == null) return null;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return null; }
  }
  return val;
}

class DeliveryRunService {
  constructor({ database = db, notifications = ucpNotifications, encryption = encryptionService } = {}) {
    this.db = database;
    this.notifications = notifications;
    this.encryption = encryption;
  }

  async _tx(work) {
    const conn = await this.db.getConnection();
    try {
      await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await conn.beginTransaction();
      const result = await work(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async _assertVerifiedSupplier(conn, actor) {
    if (!actor || !actor.id || actor.role !== 'SUPPLIER') {
      throw fail('UNAUTHORIZED_ROLE', 'Only verified suppliers can perform this action.', 403);
    }
    const [rows] = await conn.query(
      `SELECT u.id, u.role, u.is_verified, u.verification_status,
              sp.verification_status AS profile_verification_status
       FROM users u
       LEFT JOIN supplier_profiles sp ON u.id = sp.supplier_id
       WHERE u.id = ?`,
      [posId(actor.id, 'INVALID_ACTOR_ID')]
    );
    if (!rows.length) throw fail('SUPPLIER_NOT_FOUND', 'Supplier account not found.', 404);
    const elig = supplierEligibilityPolicy.evaluateSupplierEligibility(rows[0]);
    if (!elig.eligible) {
      throw fail(elig.code || 'SUPPLIER_NOT_VERIFIED', elig.reason || 'Supplier is not verified.', 403);
    }
    return rows[0];
  }

  _assertAdmin(actor) {
    if (!actor || !actor.id || !['ADMIN', 'SUPER_ADMIN'].includes(actor.role)) {
      throw fail('FORBIDDEN', 'Administrator authorization required.', 403);
    }
    return posId(actor.id, 'INVALID_ACTOR_ID');
  }

  async _recordOrderFulfillmentEvent(conn, { orderId, fromStatus, toStatus, action, actor, notes = null, metadata = null, idempotencyKey }) {
    const hash = crypto.createHash('sha256').update(`${orderId}:${action}:${idempotencyKey}`).digest('hex').slice(0, 20);
    const eventCode = `FE-ORD-${orderId}-${action.slice(0, 12)}-${hash}`;
    await conn.query(
      `INSERT IGNORE INTO order_fulfillment_events (
        order_id, event_code, from_status, to_status, action,
        actor_id, actor_role, notes, metadata, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        orderId,
        eventCode,
        fromStatus,
        toStatus,
        action,
        actor.id,
        ['BUYER', 'SUPPLIER', 'ADMIN', 'SYSTEM'].includes(actor.role) ? actor.role : 'ADMIN',
        notes,
        metadata ? JSON.stringify(metadata) : null,
        idempotencyKey
      ]
    );
  }

  async _emitStopNotification(conn, { type, stop, actor, transitionId, message, extraPayload = {} }) {
    const recipients = [
      { userId: Number(stop.buyer_id), role: 'BUYER' },
      { userId: Number(stop.supplier_id), role: 'SUPPLIER' }
    ];
    const titleMap = {
      'FULFILLMENT.CLUSTER_FORMED': 'Delivery cluster formed',
      'FULFILLMENT.CLUSTER_CUTOFF': 'Delivery cluster cutoff locked',
      'FULFILLMENT.CLUSTER_REROUTED': 'Delivery route amendment update',
      'FULFILLMENT.DISPATCHED': 'Order dispatched for delivery',
      'FULFILLMENT.ETA_CHANGED': 'Delivery ETA updated',
      'FULFILLMENT.READY_FOR_PICKUP': 'Order ready for pickup',
      'FULFILLMENT.PICKUP_CODE_ISSUED': 'Pickup claim issued',
      'FULFILLMENT.PICKED_UP': 'Order picked up at collection point',
      'FULFILLMENT.SUPPLIER_MARKED_DELIVERED': 'Supplier marked delivery complete',
      'FULFILLMENT.BUYER_CONFIRMATION_REQUIRED': 'Confirm your delivery receipt',
      'FULFILLMENT.BUYER_ACCEPTED': 'Buyer confirmed delivery receipt',
      'FULFILLMENT.PARTIAL_DELIVERY': 'Partial delivery recorded',
      'FULFILLMENT.SHORTAGE_RECORDED': 'Delivery shortage recorded',
      'FULFILLMENT.DELIVERY_ATTEMPTED': 'Delivery attempt recorded',
      'FULFILLMENT.DELIVERY_FAILED': 'Delivery attempt failed',
      'FULFILLMENT.SLA_BREACHED': 'Delivery SLA breached',
      'DISPUTE.OPENED': 'Delivery dispute opened'
    };
    await this.notifications.recordInAppOnConnection(conn, {
      type,
      aggregateId: `delivery-stop-${stop.id}`,
      aggregateVersion: Number(stop.version || 1),
      transitionId,
      recipients,
      title: titleMap[type] || 'Delivery update',
      message,
      payload: {
        order_id: Number(stop.order_id),
        delivery_id: Number(stop.id),
        mode: stop.mode,
        status: stop.status,
        notification_path: '/orders',
        ...extraPayload
      },
      actorId: Number(actor.id),
      actorRole: actor.role,
      schemaVersion: 2
    });
  }

  /**
   * Form a delivery run or assign paid eligible orders to an existing FORMING run.
   * Enforces compatibility (supplier, cluster, mode, handling_class, day, window),
   * operational capacity, and post-lock SQL cutoff validation.
   */
  async formOrAssignRun({
    actor,
    orderIds,
    clusterId,
    mode,
    handlingClass = 'AMBIENT',
    deliveryDay,
    deliveryWindow,
    cutoffAt,
    maxStops = 25,
    runId = null,
    idempotencyKey
  }) {
    const key = requireIdempotencyKey(idempotencyKey);
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      throw fail('ORDERS_REQUIRED', 'At least one order ID is required to form a delivery run.', 400);
    }
    if (!VALID_MODES.has(mode)) {
      throw fail('INVALID_DELIVERY_MODE', `Unsupported delivery mode '${mode}'.`, 400);
    }
    const cleanHandling = String(handlingClass || 'AMBIENT').trim().toUpperCase();
    if (!/^[A-Z0-9_]{2,32}$/.test(cleanHandling)) {
      throw fail('INVALID_HANDLING_CLASS', 'Invalid handling class.', 400);
    }
    const parsedClusterId = posId(clusterId, 'INVALID_CLUSTER_ID');
    const parsedMaxStops = Number(maxStops);
    if (!Number.isInteger(parsedMaxStops) || parsedMaxStops < 1 || parsedMaxStops > 100) {
      throw fail('INVALID_MAX_STOPS', 'max_stops must be an integer between 1 and 100.', 400);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(deliveryDay || ''))) {
      throw fail('INVALID_DELIVERY_DAY', 'delivery_day must be YYYY-MM-DD.', 400);
    }
    const cleanWindow = String(deliveryWindow || '').trim();
    if (cleanWindow.length < 3 || cleanWindow.length > 60) {
      throw fail('INVALID_DELIVERY_WINDOW', 'delivery_window is required (3-60 chars).', 400);
    }
    const cutoffSql = normalizeSqlDateTime(cutoffAt);
    if (!cutoffSql) {
      throw fail('CUTOFF_REQUIRED', 'cutoff_at is required.', 400);
    }

    const sortedOrderIds = [...new Set(orderIds.map(v => posId(v, 'INVALID_ORDER_ID')))].sort((a, b) => a - b);
    const reqHash = sha256Hex({
      orderIds: sortedOrderIds,
      clusterId: parsedClusterId,
      mode,
      handlingClass: cleanHandling,
      deliveryDay,
      deliveryWindow: cleanWindow,
      cutoffSql,
      maxStops: parsedMaxStops,
      runId: runId ? posId(runId) : null
    });

    return this._tx(async (conn) => {
      await this._assertVerifiedSupplier(conn, actor);
      const supplierId = Number(actor.id);

      // Idempotency replay check on delivery_runs
      const [existingRuns] = await conn.query(
        'SELECT * FROM delivery_runs WHERE supplier_id = ? AND idempotency_key = ? FOR UPDATE',
        [supplierId, key]
      );
      if (existingRuns.length > 0) {
        const existing = existingRuns[0];
        if (existing.request_hash !== reqHash) {
          throw fail('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for different delivery run parameters.', 409);
        }
        const [stops] = await conn.query('SELECT * FROM delivery_run_stops WHERE run_id = ? ORDER BY stop_sequence ASC', [existing.id]);
        return { is_replay: true, run: existing, stops };
      }

      // Validate cluster is active
      const [clusters] = await conn.query('SELECT id, name, is_active FROM geographic_clusters WHERE id = ?', [parsedClusterId]);
      if (!clusters.length || !clusters[0].is_active) {
        throw fail('INVALID_CLUSTER', 'Geographic cluster is missing or inactive.', 422);
      }

      // Lock target run if appending, otherwise create new run after order checks
      let run = null;
      if (runId) {
        const [runRows] = await conn.query('SELECT * FROM delivery_runs WHERE id = ? FOR UPDATE', [posId(runId)]);
        if (!runRows.length) throw fail('RUN_NOT_FOUND', 'Delivery run not found.', 404);
        run = runRows[0];
        if (Number(run.supplier_id) !== supplierId) {
          throw fail('FORBIDDEN', 'You do not own this delivery run.', 403);
        }
        if (run.status !== 'FORMING') {
          throw fail('RUN_LOCKED', `Delivery run is in '${run.status}' status and cannot accept new stops.`, 409);
        }
        if (
          Number(run.cluster_id) !== parsedClusterId ||
          run.mode !== mode ||
          run.handling_class !== cleanHandling ||
          String(run.delivery_day).slice(0, 10) !== deliveryDay ||
          run.delivery_window !== cleanWindow
        ) {
          throw fail('INCOMPATIBLE_RUN_GROUPING', 'Orders do not match the target delivery run cluster, mode, handling class, or window.', 422);
        }
        if (Number(run.planned_stops) + sortedOrderIds.length > Number(run.max_stops)) {
          throw fail('RUN_CAPACITY_EXCEEDED', 'Adding these orders exceeds the delivery run operational capacity.', 422);
        }
      } else if (sortedOrderIds.length > parsedMaxStops) {
        throw fail('RUN_CAPACITY_EXCEEDED', 'Order count exceeds max_stops operational capacity.', 422);
      }

      // Lock all candidate orders in deterministic ascending order
      const placeholders = sortedOrderIds.map(() => '?').join(',');
      const [orders] = await conn.query(
        `SELECT o.*, fdt.mode AS flash_mode, fdt.cluster_id AS flash_cluster_id,
                fdt.delivery_address_id AS flash_address_id, fdt.pickup_point_id AS flash_pickup_point_id,
                fdt.delivery_fee_pkr AS flash_fee_pkr, fdt.snapshot_json AS flash_snapshot_json
         FROM orders o
         LEFT JOIN flash_order_delivery_terms fdt ON fdt.order_id = o.id
         WHERE o.id IN (${placeholders})
         ORDER BY o.id ASC
         FOR UPDATE`,
        sortedOrderIds
      );
      if (orders.length !== sortedOrderIds.length) {
        throw fail('ORDER_NOT_FOUND', 'One or more requested orders do not exist.', 404);
      }
      for (const order of orders) {
        await require('./orderAdminApprovalService').assertOrderAdminApproved(conn, order.id);
      }

      // Post-lock SQL clock revalidation for cutoff!
      const effectiveCutoff = run ? normalizeSqlDateTime(run.cutoff_at) : cutoffSql;
      const [[clockCheck]] = await conn.query(
        'SELECT (? > UTC_TIMESTAMP()) AS before_cutoff, UTC_TIMESTAMP() AS now_utc',
        [effectiveCutoff]
      );
      if (Number(clockCheck.before_cutoff) !== 1) {
        throw fail('CLUSTER_CUTOFF_PASSED', 'Cluster cutoff deadline has already passed on the database clock.', 422);
      }

      // Check supplier pickup points if mode === 'PICKUP'
      const [supplierPickupPoints] = mode === 'PICKUP'
        ? await conn.query('SELECT id, cluster_id, is_active FROM supplier_pickup_points WHERE supplier_id = ? AND is_active = 1', [supplierId])
        : [[]];

      // Validate each order's ownership, paid status, mode/cluster/handling compatibility, and address/pickup
      const validatedOrders = [];
      for (const order of orders) {
        if (Number(order.supplier_id) !== supplierId) {
          throw fail('FORBIDDEN', `Order #${order.id} does not belong to your supplier account.`, 403);
        }
        if (order.payment_status !== 'PAID') {
          throw fail('UNPAID_ORDER_NOT_ELIGIBLE', `Order #${order.id} is not PAID (status: ${order.payment_status}).`, 422);
        }
        if (['CANCELLED', 'REFUNDED', 'DISPUTED'].includes(order.order_status) || order.fulfillment_status === 'EXCEPTION') {
          throw fail('ORDER_NOT_ELIGIBLE', `Order #${order.id} is not eligible for delivery clustering.`, 422);
        }

        // Check if order already has an active stop
        const [activeStops] = await conn.query(
          `SELECT id, run_id, status FROM delivery_run_stops
           WHERE order_id = ? AND status IN ('ASSIGNED', 'DISPATCHED', 'REATTEMPT_SCHEDULED', 'SUPPLIER_DELIVERED', 'REROUTED')
           FOR UPDATE`,
          [order.id]
        );
        if (activeStops.length > 0) {
          throw fail('ORDER_ALREADY_ASSIGNED', `Order #${order.id} is already assigned to active delivery stop #${activeStops[0].id}.`, 409);
        }

        // Determine order's authoritative mode & cluster
        const orderMode = order.flash_mode || (
          order.delivery_type === 'SUPPLIER_PICKUP'
            ? 'PICKUP'
            : (order.delivery_method === 'EXPRESS' ? 'EXPRESS' : 'STANDARD_CLUSTERED')
        );
        if (orderMode !== mode) {
          throw fail('INCOMPATIBLE_DELIVERY_MODE', `Order #${order.id} mode '${orderMode}' is incompatible with run mode '${mode}'.`, 422);
        }

        const orderClusterId = order.flash_cluster_id ? Number(order.flash_cluster_id) : parsedClusterId;
        if (orderClusterId !== parsedClusterId) {
          throw fail('INCOMPATIBLE_CLUSTER', `Order #${order.id} belongs to cluster #${orderClusterId}, not #${parsedClusterId}.`, 422);
        }

        // If Regular pool has explicit pool_delivery_clusters, verify cluster authorization
        if (order.pool_id && orderMode !== 'PICKUP') {
          const [pdcRows] = await conn.query(
            'SELECT cluster_id FROM pool_delivery_clusters WHERE pool_id = ?',
            [order.pool_id]
          );
          if (pdcRows.length > 0 && !pdcRows.some(r => Number(r.cluster_id) === parsedClusterId)) {
            throw fail('CLUSTER_NOT_AUTHORIZED_FOR_POOL', `Pool #${order.pool_id} does not authorize delivery to cluster #${parsedClusterId}.`, 422);
          }
        }

        let addressId = order.flash_address_id ? Number(order.flash_address_id) : null;
        let pickupPointId = order.flash_pickup_point_id ? Number(order.flash_pickup_point_id) : null;

        if (mode === 'PICKUP') {
          if (!pickupPointId) {
            if (!supplierPickupPoints.length) {
              throw fail('PICKUP_POINT_REQUIRED', `Order #${order.id} requires an active supplier pickup point.`, 422);
            }
            const clusterMatch = supplierPickupPoints.find(p => Number(p.cluster_id) === parsedClusterId) || supplierPickupPoints[0];
            pickupPointId = Number(clusterMatch.id);
          }
          addressId = null;
        } else {
          if (!addressId) {
            const [buyerAddrs] = await conn.query(
              `SELECT id, cluster_id FROM buyer_delivery_addresses
               WHERE user_id = ? AND cluster_id = ? ORDER BY is_default DESC, id DESC LIMIT 1`,
              [order.buyer_id, parsedClusterId]
            );
            if (buyerAddrs.length > 0) {
              addressId = Number(buyerAddrs[0].id);
            } else if (!order.delivery_address || !String(order.delivery_address).trim()) {
              throw fail('DELIVERY_ADDRESS_REQUIRED', `Order #${order.id} has no valid delivery address.`, 422);
            }
          }
        }

        const lockedFee = order.flash_fee_pkr != null
          ? exactDecimal.toCanonical(order.flash_fee_pkr, 2)
          : exactDecimal.toCanonical(order.delivery_fee || 0, 2);

        validatedOrders.push({
          order,
          addressId,
          pickupPointId,
          lockedFee
        });
      }

      if (!run) {
        const runCode = `RUN-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        const [insRun] = await conn.query(
          `INSERT INTO delivery_runs (
            run_code, supplier_id, cluster_id, mode, handling_class,
            delivery_day, delivery_window, cutoff_at, max_stops, planned_stops,
            status, idempotency_key, request_hash, snapshot_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'FORMING', ?, ?, ?)`,
          [
            runCode,
            supplierId,
            parsedClusterId,
            mode,
            cleanHandling,
            deliveryDay,
            cleanWindow,
            cutoffSql,
            parsedMaxStops,
            key,
            reqHash,
            JSON.stringify({
              cluster_id: parsedClusterId,
              cluster_name: clusters[0].name,
              mode,
              handling_class: cleanHandling,
              delivery_day: deliveryDay,
              delivery_window: cleanWindow,
              cutoff_at: cutoffSql
            })
          ]
        );
        const [createdRuns] = await conn.query('SELECT * FROM delivery_runs WHERE id = ?', [insRun.insertId]);
        run = createdRuns[0];
      }

      const createdStops = [];
      let nextSeq = Number(run.planned_stops || 0);
      for (const item of validatedOrders) {
        nextSeq += 1;
        const { order, addressId, pickupPointId, lockedFee } = item;

        let pickupCodeHash = null;
        let pickupCodeEncrypted = null;
        let pickupIssuedAt = null;
        if (mode === 'PICKUP') {
          const rawCode = crypto.randomBytes(4).toString('hex').toUpperCase();
          pickupCodeHash = crypto.createHash('sha256').update(rawCode).digest('hex');
          pickupCodeEncrypted = this.encryption.encrypt(rawCode);
          pickupIssuedAt = clockCheck.now_utc;
        }

        const stopSnapshot = {
          order_code: order.order_code,
          pool_id: order.pool_id || null,
          total_qty: String(order.total_qty),
          unit_price: String(order.unit_price),
          total_amount: String(order.total_amount),
          locked_delivery_fee_pkr: lockedFee,
          mode,
          cluster_id: parsedClusterId,
          handling_class: cleanHandling
        };

        const [insStop] = await conn.query(
          `INSERT INTO delivery_run_stops (
            run_id, order_id, buyer_id, supplier_id, cluster_id, mode,
            address_id, pickup_point_id, stop_sequence, status,
            locked_delivery_fee_pkr, ordered_qty, pickup_code_hash,
            pickup_code_encrypted, pickup_code_issued_at, snapshot_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ASSIGNED', ?, ?, ?, ?, ?, ?)`,
          [
            run.id,
            order.id,
            order.buyer_id,
            supplierId,
            parsedClusterId,
            mode,
            addressId,
            pickupPointId,
            nextSeq,
            lockedFee,
            exactDecimal.toCanonical(order.total_qty, 4),
            pickupCodeHash,
            pickupCodeEncrypted,
            pickupIssuedAt,
            JSON.stringify(stopSnapshot)
          ]
        );
        const [stopRows] = await conn.query('SELECT * FROM delivery_run_stops WHERE id = ?', [insStop.insertId]);
        const stop = stopRows[0];
        createdStops.push(stop);

        await this._emitStopNotification(conn, {
          type: 'FULFILLMENT.CLUSTER_FORMED',
          stop,
          actor,
          transitionId: `cluster-formed-${run.id}-${stop.id}`,
          message: `Order ${order.order_code} has been assigned to delivery run ${run.run_code} (${cleanWindow}).`
        });

        if (mode === 'PICKUP') {
          // Never include plaintext pickup code in notification payload/message!
          await this._emitStopNotification(conn, {
            type: 'FULFILLMENT.PICKUP_CODE_ISSUED',
            stop,
            actor,
            transitionId: `pickup-issued-${stop.id}`,
            message: `Pickup claim credentials are ready for order ${order.order_code}. Open your order in MilJor to view your private pickup code.`
          });
        }
      }

      await conn.query(
        'UPDATE delivery_runs SET planned_stops = ?, version = version + 1 WHERE id = ?',
        [nextSeq, run.id]
      );
      const [updatedRuns] = await conn.query('SELECT * FROM delivery_runs WHERE id = ?', [run.id]);

      return { is_replay: false, run: updatedRuns[0], stops: createdStops };
    });
  }

  /**
   * Lock a delivery run at or after cutoff using fresh SQL clock after FOR UPDATE lock.
   */
  async lockCutoff({ actor, runId, enforceCutoffClock = true, idempotencyKey }) {
    const key = requireIdempotencyKey(idempotencyKey);
    const parsedRunId = posId(runId, 'INVALID_RUN_ID');

    return this._tx(async (conn) => {
      const [runs] = await conn.query('SELECT * FROM delivery_runs WHERE id = ? FOR UPDATE', [parsedRunId]);
      if (!runs.length) throw fail('RUN_NOT_FOUND', 'Delivery run not found.', 404);
      const run = runs[0];

      if (actor.role === 'SUPPLIER') {
        await this._assertVerifiedSupplier(conn, actor);
        if (Number(run.supplier_id) !== Number(actor.id)) {
          throw fail('FORBIDDEN', 'You do not own this delivery run.', 403);
        }
      } else if (!['ADMIN', 'SUPER_ADMIN', 'SYSTEM'].includes(actor.role)) {
        throw fail('FORBIDDEN', 'Unauthorized role for cutoff lock.', 403);
      }

      if (run.status === 'CUTOFF_LOCKED') {
        return { is_replay: true, run };
      }
      if (run.status !== 'FORMING') {
        throw fail('INVALID_RUN_TRANSITION', `Cannot lock cutoff from status '${run.status}'.`, 409);
      }

      if (enforceCutoffClock) {
        const [[clock]] = await conn.query('SELECT (cutoff_at <= UTC_TIMESTAMP()) AS reached FROM delivery_runs WHERE id = ?', [parsedRunId]);
        if (Number(clock.reached) !== 1) {
          throw fail('CUTOFF_NOT_REACHED', 'Cluster cutoff time has not yet been reached on the database clock.', 422);
        }
      }

      await conn.query(
        `UPDATE delivery_runs
         SET status = 'CUTOFF_LOCKED', cutoff_locked_at = UTC_TIMESTAMP(), version = version + 1
         WHERE id = ?`,
        [parsedRunId]
      );

      const [stops] = await conn.query('SELECT * FROM delivery_run_stops WHERE run_id = ? ORDER BY id ASC FOR UPDATE', [parsedRunId]);
      for (const stop of stops) {
        await this._emitStopNotification(conn, {
          type: 'FULFILLMENT.CLUSTER_CUTOFF',
          stop,
          actor,
          transitionId: `cutoff-${parsedRunId}-${key}`,
          message: `Delivery run ${run.run_code} has reached cutoff and is locked for dispatch.`
        });
      }

      const [updated] = await conn.query('SELECT * FROM delivery_runs WHERE id = ?', [parsedRunId]);
      return { is_replay: false, run: updated[0] };
    });
  }

  /**
   * Dispatch a delivery run and all its assigned stops atomically.
   * Aligns orders.fulfillment_status -> 'DISPATCHED'.
   */
  async dispatchRun({ actor, runId, deliveryMethod = 'SUPPLIER_FLEET', reference = null, etaAt = null, notes = null, idempotencyKey }) {
    const key = requireIdempotencyKey(idempotencyKey);
    const parsedRunId = posId(runId, 'INVALID_RUN_ID');
    const etaSql = etaAt ? normalizeSqlDateTime(etaAt) : null;

    return this._tx(async (conn) => {
      await this._assertVerifiedSupplier(conn, actor);
      const [runs] = await conn.query('SELECT * FROM delivery_runs WHERE id = ? FOR UPDATE', [parsedRunId]);
      if (!runs.length) throw fail('RUN_NOT_FOUND', 'Delivery run not found.', 404);
      const run = runs[0];

      if (Number(run.supplier_id) !== Number(actor.id)) {
        throw fail('FORBIDDEN', 'You do not own this delivery run.', 403);
      }

      if (run.status === 'DISPATCHED') {
        return { is_replay: true, run };
      }
      if (!['FORMING', 'CUTOFF_LOCKED'].includes(run.status)) {
        throw fail('INVALID_RUN_TRANSITION', `Cannot dispatch run in '${run.status}' status.`, 409);
      }

      const [stops] = await conn.query(
        'SELECT * FROM delivery_run_stops WHERE run_id = ? ORDER BY id ASC FOR UPDATE',
        [parsedRunId]
      );
      if (!stops.length) {
        throw fail('EMPTY_DELIVERY_RUN', 'Cannot dispatch a delivery run with zero stops.', 422);
      }

      const newEtaVersion = etaSql ? Number(run.eta_version || 0) + 1 : Number(run.eta_version || 0);
      await conn.query(
        `UPDATE delivery_runs
         SET status = 'DISPATCHED',
             cutoff_locked_at = COALESCE(cutoff_locked_at, UTC_TIMESTAMP()),
             dispatched_at = UTC_TIMESTAMP(),
             eta_at = COALESCE(?, eta_at),
             eta_version = ?,
             version = version + 1
         WHERE id = ?`,
        [etaSql, newEtaVersion, parsedRunId]
      );

      for (const stop of stops) {
        if (stop.status !== 'ASSIGNED') continue;
        const methodToUse = stop.mode === 'PICKUP' ? 'BUYER_PICKUP' : deliveryMethod;

        const [orderRows] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [stop.order_id]);
        const order = orderRows[0];
        if (!order || order.payment_status !== 'PAID') {
          throw fail('UNPAID_ORDER_NOT_DISPATCHABLE', `Order #${stop.order_id} is not PAID.`, 422);
        }

        const nextStopStatus = stop.mode === 'PICKUP' ? 'ASSIGNED' : 'DISPATCHED';
        await conn.query(
          `UPDATE delivery_run_stops
           SET status = ?, eta_at = COALESCE(?, eta_at), eta_version = ?, version = version + 1
           WHERE id = ?`,
          [nextStopStatus, etaSql, newEtaVersion, stop.id]
        );

        const targetOrderStatus = stop.mode === 'PICKUP' ? 'READY_FOR_DISPATCH' : 'DISPATCHED';
        if (['AWAITING_SUPPLIER_ACKNOWLEDGEMENT', 'PREPARING', 'READY_FOR_DISPATCH'].includes(order.fulfillment_status)) {
          await require('./orderAdminApprovalService').assertOrderAdminApproved(conn, order.id);
          await conn.query(
            `UPDATE orders
             SET fulfillment_status = ?,
                 delivery_method = COALESCE(delivery_method, ?),
                 supplier_delivery_reference = COALESCE(?, supplier_delivery_reference),
                 ready_for_dispatch_at = COALESCE(ready_for_dispatch_at, NOW()),
                 dispatched_at = IF(? = 'DISPATCHED', COALESCE(dispatched_at, NOW()), dispatched_at),
                 updated_at = NOW()
             WHERE id = ?`,
            [targetOrderStatus, methodToUse, reference, targetOrderStatus, order.id]
          );
          await this._recordOrderFulfillmentEvent(conn, {
            orderId: order.id,
            fromStatus: order.fulfillment_status,
            toStatus: targetOrderStatus,
            action: stop.mode === 'PICKUP' ? 'READY_FOR_PICKUP' : 'DISPATCH_RUN',
            actor,
            notes,
            metadata: { run_id: parsedRunId, stop_id: stop.id, eta_at: etaSql },
            idempotencyKey: `${key}-stop-${stop.id}`
          });
        }

        const [freshStopRows] = await conn.query('SELECT * FROM delivery_run_stops WHERE id = ?', [stop.id]);
        await this._emitStopNotification(conn, {
          type: stop.mode === 'PICKUP' ? 'FULFILLMENT.READY_FOR_PICKUP' : 'FULFILLMENT.DISPATCHED',
          stop: freshStopRows[0],
          actor,
          transitionId: `dispatch-${parsedRunId}-${stop.id}-${key}`,
          message: stop.mode === 'PICKUP'
            ? `Order ${order.order_code} is ready for collection at the supplier pickup point.`
            : `Order ${order.order_code} has been dispatched on run ${run.run_code}.`
        });
      }

      const [updatedRuns] = await conn.query('SELECT * FROM delivery_runs WHERE id = ?', [parsedRunId]);
      const [updatedStops] = await conn.query('SELECT * FROM delivery_run_stops WHERE run_id = ? ORDER BY stop_sequence ASC', [parsedRunId]);
      return { is_replay: false, run: updatedRuns[0], stops: updatedStops };
    });
  }

  /**
   * Persist meaningful ETA updates (>= 15 min change or initial ETA) and notify affected buyers.
   */
  async updateRunEta({ actor, runId, etaAt, reason = null, idempotencyKey }) {
    const key = requireIdempotencyKey(idempotencyKey);
    const parsedRunId = posId(runId, 'INVALID_RUN_ID');
    const etaSql = normalizeSqlDateTime(etaAt);
    if (!etaSql) throw fail('ETA_REQUIRED', 'eta_at is required.', 400);

    return this._tx(async (conn) => {
      await this._assertVerifiedSupplier(conn, actor);
      const [runs] = await conn.query('SELECT * FROM delivery_runs WHERE id = ? FOR UPDATE', [parsedRunId]);
      if (!runs.length) throw fail('RUN_NOT_FOUND', 'Delivery run not found.', 404);
      const run = runs[0];

      if (Number(run.supplier_id) !== Number(actor.id)) {
        throw fail('FORBIDDEN', 'You do not own this delivery run.', 403);
      }
      if (['COMPLETED', 'CANCELLED', 'FAILED'].includes(run.status)) {
        throw fail('INVALID_RUN_STATE', `Cannot update ETA for run in '${run.status}' status.`, 409);
      }

      // Meaningful change check (prevent per-second spam)
      if (run.eta_at) {
        const prevMs = new Date(run.eta_at).getTime();
        const nextMs = new Date(etaSql.replace(' ', 'T') + 'Z').getTime();
        if (Math.abs(nextMs - prevMs) < 15 * 60 * 1000) {
          throw fail('ETA_CHANGE_NOT_MEANINGFUL', 'ETA updates require at least a 15-minute change.', 422);
        }
      }

      const nextEtaVer = Number(run.eta_version || 0) + 1;
      await conn.query(
        `UPDATE delivery_runs
         SET eta_at = ?, eta_version = ?, eta_reason = ?, version = version + 1
         WHERE id = ?`,
        [etaSql, nextEtaVer, reason ? String(reason).trim().slice(0, 255) : null, parsedRunId]
      );

      const [stops] = await conn.query(
        `SELECT * FROM delivery_run_stops
         WHERE run_id = ? AND status IN ('ASSIGNED', 'DISPATCHED', 'REATTEMPT_SCHEDULED')
         ORDER BY id ASC FOR UPDATE`,
        [parsedRunId]
      );

      for (const stop of stops) {
        await conn.query(
          'UPDATE delivery_run_stops SET eta_at = ?, eta_version = ?, version = version + 1 WHERE id = ?',
          [etaSql, nextEtaVer, stop.id]
        );
        const [fresh] = await conn.query('SELECT * FROM delivery_run_stops WHERE id = ?', [stop.id]);
        await this._emitStopNotification(conn, {
          type: 'FULFILLMENT.ETA_CHANGED',
          stop: fresh[0],
          actor,
          transitionId: `eta-${parsedRunId}-v${nextEtaVer}-${stop.id}-${key}`,
          message: `Updated estimated arrival for your delivery: ${etaSql} UTC.`
        });
      }

      const [updatedRuns] = await conn.query('SELECT * FROM delivery_runs WHERE id = ?', [parsedRunId]);
      return { run: updatedRuns[0], updated_stops: stops.length };
    });
  }

  /**
   * Owning supplier verifies buyer's pickup claim code without leaking secrets.
   * Marks SUPPLIER_DELIVERED only — does NOT mark BUYER_CONFIRMED or authorize settlement.
   */
  async claimPickupStop({ actor, stopId, pickupCode, idempotencyKey }) {
    const key = requireIdempotencyKey(idempotencyKey);
    const parsedStopId = posId(stopId, 'INVALID_STOP_ID');
    const cleanCode = String(pickupCode || '').trim().toUpperCase();
    if (!cleanCode) throw fail('PICKUP_CODE_REQUIRED', 'Pickup claim code is required.', 400);

    return this._tx(async (conn) => {
      await this._assertVerifiedSupplier(conn, actor);
      const [stops] = await conn.query('SELECT * FROM delivery_run_stops WHERE id = ? FOR UPDATE', [parsedStopId]);
      if (!stops.length) throw fail('STOP_NOT_FOUND', 'Delivery stop not found.', 404);
      const stop = stops[0];

      if (Number(stop.supplier_id) !== Number(actor.id)) {
        throw fail('FORBIDDEN', 'You do not own this delivery stop.', 403);
      }
      if (stop.mode !== 'PICKUP') {
        throw fail('NOT_A_PICKUP_STOP', 'Pickup claim is only valid for PICKUP stops.', 422);
      }
      if (stop.status === 'SUPPLIER_DELIVERED' || stop.status === 'BUYER_CONFIRMED') {
        return { is_replay: true, stop };
      }
      if (!['ASSIGNED', 'DISPATCHED', 'REATTEMPT_SCHEDULED'].includes(stop.status)) {
        throw fail('INVALID_STOP_TRANSITION', `Cannot claim pickup from '${stop.status}' status.`, 409);
      }

      const providedHash = crypto.createHash('sha256').update(cleanCode).digest('hex');
      const expectedBuf = Buffer.from(String(stop.pickup_code_hash || ''), 'utf8');
      const providedBuf = Buffer.from(providedHash, 'utf8');
      if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
        throw fail('INVALID_PICKUP_CODE', 'Provided pickup claim code does not match.', 403);
      }

      const [orderRows] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [stop.order_id]);
      const order = orderRows[0];

      await conn.query(
        `UPDATE delivery_run_stops
         SET status = 'SUPPLIER_DELIVERED',
             pickup_claimed_at = UTC_TIMESTAMP(),
             supplier_delivered_at = UTC_TIMESTAMP(),
             version = version + 1
         WHERE id = ?`,
        [parsedStopId]
      );

      await conn.query(
        `UPDATE orders
         SET fulfillment_status = 'SUPPLIER_DELIVERED',
             delivery_method = 'BUYER_PICKUP',
             supplier_delivered_at = COALESCE(supplier_delivered_at, NOW()),
             updated_at = NOW()
         WHERE id = ?`,
        [order.id]
      );

      await this._recordOrderFulfillmentEvent(conn, {
        orderId: order.id,
        fromStatus: order.fulfillment_status,
        toStatus: 'SUPPLIER_DELIVERED',
        action: 'PICKUP_CLAIMED',
        actor,
        metadata: { stop_id: parsedStopId },
        idempotencyKey: key
      });

      const [fresh] = await conn.query('SELECT * FROM delivery_run_stops WHERE id = ?', [parsedStopId]);
      await this._emitStopNotification(conn, {
        type: 'FULFILLMENT.PICKED_UP',
        stop: fresh[0],
        actor,
        transitionId: `pickup-claim-${parsedStopId}-${key}`,
        message: `Order ${order.order_code} was collected at the pickup point. Please confirm final receipt.`
      });
      await this._emitStopNotification(conn, {
        type: 'FULFILLMENT.BUYER_CONFIRMATION_REQUIRED',
        stop: fresh[0],
        actor,
        transitionId: `buyer-confirm-req-${parsedStopId}-${key}`,
        message: `Please confirm receipt for order ${order.order_code}.`
      });

      return { is_replay: false, stop: fresh[0] };
    });
  }

  /**
   * Owning supplier marks a stop as delivered.
   * Separate from buyer acceptance — never authorizes settlement on its own.
   */
  async markStopDeliveredBySupplier({ actor, stopId, notes = null, idempotencyKey }) {
    const key = requireIdempotencyKey(idempotencyKey);
    const parsedStopId = posId(stopId, 'INVALID_STOP_ID');

    return this._tx(async (conn) => {
      await this._assertVerifiedSupplier(conn, actor);
      const [stops] = await conn.query('SELECT * FROM delivery_run_stops WHERE id = ? FOR UPDATE', [parsedStopId]);
      if (!stops.length) throw fail('STOP_NOT_FOUND', 'Delivery stop not found.', 404);
      const stop = stops[0];

      if (Number(stop.supplier_id) !== Number(actor.id)) {
        throw fail('FORBIDDEN', 'You do not own this delivery stop.', 403);
      }
      if (stop.mode === 'PICKUP') {
        throw fail('PICKUP_CLAIM_REQUIRED', 'Pickup stops must be completed via pickup claim verification.', 422);
      }
      if (stop.status === 'SUPPLIER_DELIVERED') {
        return { is_replay: true, stop };
      }
      if (!['DISPATCHED', 'REATTEMPT_SCHEDULED'].includes(stop.status)) {
        throw fail('INVALID_STOP_TRANSITION', `Cannot mark delivered from '${stop.status}' status.`, 409);
      }

      const [orderRows] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [stop.order_id]);
      const order = orderRows[0];

      await conn.query(
        `UPDATE delivery_run_stops
         SET status = 'SUPPLIER_DELIVERED', supplier_delivered_at = UTC_TIMESTAMP(), version = version + 1
         WHERE id = ?`,
        [parsedStopId]
      );

      await conn.query(
        `UPDATE orders
         SET fulfillment_status = 'SUPPLIER_DELIVERED',
             supplier_delivered_at = COALESCE(supplier_delivered_at, NOW()),
             updated_at = NOW()
         WHERE id = ?`,
        [order.id]
      );

      await this._recordOrderFulfillmentEvent(conn, {
        orderId: order.id,
        fromStatus: order.fulfillment_status,
        toStatus: 'SUPPLIER_DELIVERED',
        action: 'SUPPLIER_MARKED_DELIVERED',
        actor,
        notes,
        metadata: { stop_id: parsedStopId },
        idempotencyKey: key
      });

      const [fresh] = await conn.query('SELECT * FROM delivery_run_stops WHERE id = ?', [parsedStopId]);
      await this._emitStopNotification(conn, {
        type: 'FULFILLMENT.SUPPLIER_MARKED_DELIVERED',
        stop: fresh[0],
        actor,
        transitionId: `supp-delivered-${parsedStopId}-${key}`,
        message: `Supplier reported order ${order.order_code} delivered. Buyer receipt confirmation is required.`
      });
      await this._emitStopNotification(conn, {
        type: 'FULFILLMENT.BUYER_CONFIRMATION_REQUIRED',
        stop: fresh[0],
        actor,
        transitionId: `buyer-confirm-req-${parsedStopId}-${key}`,
        message: `Please confirm receipt or report any shortage for order ${order.order_code}.`
      });

      return { is_replay: false, stop: fresh[0] };
    });
  }

  /**
   * Owning buyer records full or partial receipt (e.g. 100 ordered / 80 accepted / 20 disputed).
   * Preserves ordered quantity and invoice snapshot; creates dispute & blocks premature settlement on shortage.
   */
  async recordBuyerStopReceipt({
    actor,
    stopId,
    acceptedQty,
    missingQty = '0',
    rejectedQty = '0',
    reason = 'SHORT_QUANTITY',
    description = null,
    idempotencyKey
  }) {
    const key = requireIdempotencyKey(idempotencyKey);
    const parsedStopId = posId(stopId, 'INVALID_STOP_ID');
    if (!actor || !actor.id || actor.role !== 'BUYER') {
      throw fail('UNAUTHORIZED_ROLE', 'Only the owning buyer can record delivery receipt.', 403);
    }

    return this._tx(async (conn) => {
      const [stops] = await conn.query('SELECT * FROM delivery_run_stops WHERE id = ? FOR UPDATE', [parsedStopId]);
      if (!stops.length) throw fail('STOP_NOT_FOUND', 'Delivery stop not found.', 404);
      const stop = stops[0];

      if (Number(stop.buyer_id) !== Number(actor.id)) {
        throw fail('FORBIDDEN', 'You do not own this delivery stop.', 403);
      }

      const [orderRows] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [stop.order_id]);
      const order = orderRows[0];
      if (!order || order.payment_status !== 'PAID') {
        throw fail('UNPAID_ORDER', 'Only paid orders can record receipt.', 422);
      }

      // Idempotent replay check
      if (['BUYER_CONFIRMED', 'PARTIAL_CONFIRMED'].includes(stop.status)) {
        const [priorEvents] = await conn.query(
          'SELECT id FROM order_fulfillment_events WHERE order_id = ? AND idempotency_key = ? LIMIT 1',
          [order.id, key]
        );
        if (priorEvents.length > 0) {
          return { is_replay: true, stop, order_id: order.id, dispute_id: stop.dispute_id };
        }
        throw fail('RECEIPT_ALREADY_RECORDED', 'Buyer receipt has already been recorded for this stop.', 409);
      }

      if (!['SUPPLIER_DELIVERED', 'DISPATCHED'].includes(stop.status)) {
        throw fail('PREREQUISITE_NOT_MET', `Cannot record receipt from stop status '${stop.status}'.`, 422);
      }

      // Validate quantities exactly
      const orderedStr = exactDecimal.toCanonical(stop.ordered_qty, 4);
      let accStr, missStr, rejStr;
      try {
        accStr = exactDecimal.toCanonical(acceptedQty, 4);
        missStr = exactDecimal.toCanonical(missingQty ?? '0', 4);
        rejStr = exactDecimal.toCanonical(rejectedQty ?? '0', 4);
      } catch {
        throw fail('INVALID_DELIVERY_QUANTITY', 'Quantities must be valid non-negative decimals.', 422);
      }

      if (accStr.startsWith('-') || missStr.startsWith('-') || rejStr.startsWith('-')) {
        throw fail('NEGATIVE_DELIVERY_QUANTITY', 'Accepted, missing, and rejected quantities cannot be negative.', 422);
      }

      // Discrete unit check if order unit is discrete
      if (order.pool_id) {
        const [pools] = await conn.query('SELECT pool_unit FROM pools WHERE id = ?', [order.pool_id]);
        const unit = String(pools[0]?.pool_unit || '').trim().toLowerCase();
        if (DISCRETE_UNITS.has(unit)) {
          for (const [label, q] of [['accepted_qty', accStr], ['missing_qty', missStr], ['rejected_qty', rejStr]]) {
            if (!q.endsWith('.0000')) {
              throw fail('FRACTIONAL_DISCRETE_QUANTITY', `${label} must be a whole integer for discrete unit '${unit}'.`, 422);
            }
          }
        }
      }

      const sumStr = exactDecimal.exactDecimalSum([accStr, missStr, rejStr], 4);
      if (!exactDecimal.exactDecimalEquals(sumStr, orderedStr, 4)) {
        throw fail(
          'QUANTITY_SUM_MISMATCH',
          `accepted (${accStr}) + missing (${missStr}) + rejected (${rejStr}) must equal ordered quantity (${orderedStr}).`,
          422
        );
      }

      const disputedStr = exactDecimal.exactDecimalSum([missStr, rejStr], 4);
      const isPartial = !exactDecimal.exactDecimalEquals(disputedStr, '0', 4);

      if (!isPartial) {
        // Full receipt
        await conn.query(
          `UPDATE delivery_run_stops
           SET status = 'BUYER_CONFIRMED',
               accepted_qty = ?, missing_qty = 0.0000, rejected_qty = 0.0000, disputed_qty = 0.0000,
               buyer_confirmed_at = UTC_TIMESTAMP(), version = version + 1
           WHERE id = ?`,
          [accStr, parsedStopId]
        );
        await conn.query(
          `UPDATE orders
           SET fulfillment_status = 'BUYER_CONFIRMED',
               order_status = 'DELIVERED',
               buyer_confirmed_at = COALESCE(buyer_confirmed_at, NOW()),
               updated_at = NOW()
           WHERE id = ?`,
          [order.id]
        );
        await this._recordOrderFulfillmentEvent(conn, {
          orderId: order.id,
          fromStatus: order.fulfillment_status,
          toStatus: 'BUYER_CONFIRMED',
          action: 'BUYER_STOP_CONFIRMED',
          actor,
          metadata: { stop_id: parsedStopId, ordered_qty: orderedStr, accepted_qty: accStr },
          idempotencyKey: key
        });

        const [fresh] = await conn.query('SELECT * FROM delivery_run_stops WHERE id = ?', [parsedStopId]);
        await this._emitStopNotification(conn, {
          type: 'FULFILLMENT.BUYER_ACCEPTED',
          stop: fresh[0],
          actor,
          transitionId: `buyer-accept-${parsedStopId}-${key}`,
          message: `Buyer confirmed full delivery receipt for order ${order.order_code}.`
        });

        await this._syncRunStatusAfterStop(conn, stop.run_id);
        return { is_replay: false, stop: fresh[0], order_id: order.id, dispute_id: null };
      }

      // Partial delivery / shortage / dispute
      const cleanDesc = String(description || `Partial delivery: ${accStr} accepted, ${disputedStr} disputed out of ${orderedStr} ordered.`).trim();
      if (cleanDesc.length < 5) {
        throw fail('DESCRIPTION_REQUIRED', 'Discrepancy description is required for partial delivery.', 400);
      }

      const claimedAmount = exactDecimal.exactMultiplyRound(disputedStr, exactDecimal.toCanonical(order.unit_price, 2), 2);
      const disputeCode = `DSP-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
      const [insDispute] = await conn.query(
        `INSERT INTO order_disputes (
          dispute_code, order_id, buyer_id, supplier_id, reason, dispute_category, reporting_actor_role,
          description, expected_quantity, reported_quantity, disputed_quantity, claimed_amount,
          currency, evidence_metadata, status, idempotency_key
        ) VALUES (?, ?, ?, ?, ?, ?, 'BUYER', ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)`,
        [
          disputeCode,
          order.id,
          order.buyer_id,
          order.supplier_id,
          reason === 'DAMAGED_GOODS' ? 'DAMAGED_GOODS' : 'SHORTAGE_IN_QUANTITY',
          reason,
          cleanDesc,
          orderedStr,
          accStr,
          disputedStr,
          claimedAmount,
          order.currency || 'PKR',
          JSON.stringify({ stop_id: parsedStopId, accepted_qty: accStr, missing_qty: missStr, rejected_qty: rejStr }),
          `stop-receipt-${parsedStopId}-${key}`
        ]
      );
      const disputeId = insDispute.insertId;

      await conn.query(
        `UPDATE delivery_run_stops
         SET status = 'PARTIAL_CONFIRMED',
             accepted_qty = ?, missing_qty = ?, rejected_qty = ?, disputed_qty = ?,
             buyer_confirmed_at = UTC_TIMESTAMP(), dispute_id = ?, version = version + 1
         WHERE id = ?`,
        [accStr, missStr, rejStr, disputedStr, disputeId, parsedStopId]
      );

      // Keep order in EXCEPTION so premature full settlement is blocked until dispute resolution
      await conn.query(
        `UPDATE orders
         SET fulfillment_status = 'EXCEPTION',
             exception_reason = 'QUANTITY_MISMATCH',
             exception_details = ?,
             exception_recorded_at = NOW(),
             updated_at = NOW()
         WHERE id = ?`,
        [cleanDesc, order.id]
      );

      await this._recordOrderFulfillmentEvent(conn, {
        orderId: order.id,
        fromStatus: order.fulfillment_status,
        toStatus: 'EXCEPTION',
        action: 'BUYER_PARTIAL_RECEIPT',
        actor,
        notes: cleanDesc,
        metadata: {
          stop_id: parsedStopId,
          dispute_id: disputeId,
          ordered_qty: orderedStr,
          accepted_qty: accStr,
          missing_qty: missStr,
          rejected_qty: rejStr,
          disputed_qty: disputedStr
        },
        idempotencyKey: key
      });

      const [fresh] = await conn.query('SELECT * FROM delivery_run_stops WHERE id = ?', [parsedStopId]);
      await this._emitStopNotification(conn, {
        type: 'FULFILLMENT.PARTIAL_DELIVERY',
        stop: fresh[0],
        actor,
        transitionId: `partial-${parsedStopId}-${key}`,
        message: `Partial receipt recorded for ${order.order_code}: ${accStr} accepted, ${disputedStr} disputed.`,
        extraPayload: { dispute_id: disputeId, quantity: Number(disputedStr) }
      });
      await this._emitStopNotification(conn, {
        type: 'FULFILLMENT.SHORTAGE_RECORDED',
        stop: fresh[0],
        actor,
        transitionId: `shortage-${parsedStopId}-${key}`,
        message: `Shortage/discrepancy of ${disputedStr} recorded on ${order.order_code}.`,
        extraPayload: { dispute_id: disputeId, quantity: Number(disputedStr) }
      });
      await this._emitStopNotification(conn, {
        type: 'DISPUTE.OPENED',
        stop: fresh[0],
        actor,
        transitionId: `dispute-${disputeId}-${key}`,
        message: `Dispute #${disputeId} opened for order ${order.order_code}.`,
        extraPayload: { dispute_id: disputeId }
      });

      await this._syncRunStatusAfterStop(conn, stop.run_id);
      return { is_replay: false, stop: fresh[0], order_id: order.id, dispute_id: disputeId };
    });
  }

  async _syncRunStatusAfterStop(conn, runId) {
    const [stops] = await conn.query('SELECT status FROM delivery_run_stops WHERE run_id = ?', [runId]);
    if (!stops.length) return;
    const allDone = stops.every(s => ['BUYER_CONFIRMED', 'PARTIAL_CONFIRMED', 'FAILED', 'CANCELLED', 'REROUTED'].includes(s.status));
    if (!allDone) return;
    const hasPartialOrFail = stops.some(s => ['PARTIAL_CONFIRMED', 'FAILED'].includes(s.status));
    const allFailed = stops.every(s => s.status === 'FAILED');
    const nextRunStatus = allFailed ? 'FAILED' : (hasPartialOrFail ? 'PARTIAL' : 'COMPLETED');
    await conn.query('UPDATE delivery_runs SET status = ?, version = version + 1 WHERE id = ?', [nextRunStatus, runId]);
  }

  /**
   * Record a failed delivery attempt and optionally schedule a bounded reattempt.
   */
  async recordFailedAttempt({
    actor,
    stopId,
    reasonCode,
    notes = null,
    evidence = null,
    scheduleReattempt = false,
    newEtaAt = null,
    slaBreached = false,
    idempotencyKey
  }) {
    const key = requireIdempotencyKey(idempotencyKey);
    const parsedStopId = posId(stopId, 'INVALID_STOP_ID');
    const cleanReason = String(reasonCode || '').trim().toUpperCase();
    if (!/^[A-Z0-9_]{3,64}$/.test(cleanReason)) {
      throw fail('INVALID_FAILURE_REASON', 'Valid reason_code is required.', 400);
    }
    const newEtaSql = newEtaAt ? normalizeSqlDateTime(newEtaAt) : null;

    return this._tx(async (conn) => {
      if (actor.role === 'SUPPLIER') {
        await this._assertVerifiedSupplier(conn, actor);
      } else {
        this._assertAdmin(actor);
      }

      const [stops] = await conn.query('SELECT * FROM delivery_run_stops WHERE id = ? FOR UPDATE', [parsedStopId]);
      if (!stops.length) throw fail('STOP_NOT_FOUND', 'Delivery stop not found.', 404);
      const stop = stops[0];

      if (actor.role === 'SUPPLIER' && Number(stop.supplier_id) !== Number(actor.id)) {
        throw fail('FORBIDDEN', 'You do not own this delivery stop.', 403);
      }

      const [existingAttempt] = await conn.query(
        'SELECT * FROM delivery_attempts WHERE stop_id = ? AND idempotency_key = ?',
        [parsedStopId, key]
      );
      if (existingAttempt.length > 0) {
        return { is_replay: true, attempt: existingAttempt[0], stop };
      }

      if (!['DISPATCHED', 'REATTEMPT_SCHEDULED', 'ASSIGNED'].includes(stop.status)) {
        throw fail('INVALID_STOP_TRANSITION', `Cannot record failed attempt from status '${stop.status}'.`, 409);
      }

      const nextAttemptNo = Number(stop.attempt_count || 0) + 1;
      if (scheduleReattempt && nextAttemptNo > Number(stop.max_attempts || 3)) {
        throw fail('MAX_REATTEMPTS_EXCEEDED', `Maximum delivery attempts (${stop.max_attempts}) reached for this stop.`, 422);
      }

      const [insAttempt] = await conn.query(
        `INSERT INTO delivery_attempts (
          stop_id, run_id, order_id, attempt_number, outcome, reason_code,
          notes, evidence_json, actor_id, actor_role, idempotency_key
        ) VALUES (?, ?, ?, ?, 'FAILED', ?, ?, ?, ?, ?, ?)`,
        [
          parsedStopId,
          stop.run_id,
          stop.order_id,
          nextAttemptNo,
          cleanReason,
          notes ? String(notes).trim() : null,
          evidence ? JSON.stringify(evidence) : null,
          actor.id,
          actor.role,
          key
        ]
      );

      const nextStatus = scheduleReattempt ? 'REATTEMPT_SCHEDULED' : 'FAILED';
      await conn.query(
        `UPDATE delivery_run_stops
         SET status = ?,
             attempt_count = ?,
             eta_at = COALESCE(?, eta_at),
             eta_version = IF(? IS NOT NULL, eta_version + 1, eta_version),
             version = version + 1
         WHERE id = ?`,
        [nextStatus, nextAttemptNo, newEtaSql, newEtaSql, parsedStopId]
      );

      const [attemptRows] = await conn.query('SELECT * FROM delivery_attempts WHERE id = ?', [insAttempt.insertId]);
      const [freshStop] = await conn.query('SELECT * FROM delivery_run_stops WHERE id = ?', [parsedStopId]);

      await this._emitStopNotification(conn, {
        type: 'FULFILLMENT.DELIVERY_ATTEMPTED',
        stop: freshStop[0],
        actor,
        transitionId: `attempt-${parsedStopId}-${nextAttemptNo}`,
        message: `Delivery attempt #${nextAttemptNo} recorded (${cleanReason}).`
      });
      await this._emitStopNotification(conn, {
        type: 'FULFILLMENT.DELIVERY_FAILED',
        stop: freshStop[0],
        actor,
        transitionId: `failed-${parsedStopId}-${nextAttemptNo}`,
        message: scheduleReattempt
          ? `Delivery attempt #${nextAttemptNo} failed (${cleanReason}); reattempt scheduled.`
          : `Delivery attempt #${nextAttemptNo} failed (${cleanReason}).`
      });

      if (slaBreached) {
        await this._emitStopNotification(conn, {
          type: 'FULFILLMENT.SLA_BREACHED',
          stop: freshStop[0],
          actor,
          transitionId: `sla-breach-${parsedStopId}-${nextAttemptNo}`,
          message: `Promised delivery SLA was breached on stop #${parsedStopId}.`
        });
      }

      if (!scheduleReattempt) {
        await this._syncRunStatusAfterStop(conn, stop.run_id);
      }

      return { is_replay: false, attempt: attemptRows[0], stop: freshStop[0] };
    });
  }

  /**
   * Propose a versioned delivery amendment / reroute quote under the 2026-11-17 cost/consent policy.
   */
  async proposeAmendment({
    actor,
    orderId,
    stopId = null,
    amendmentType,
    costResponsibility,
    reason,
    newDeliveryFeePkr,
    deliveryTerms = {},
    proposedEtaAt = null,
    expiresAt,
    idempotencyKey
  }) {
    const key = requireIdempotencyKey(idempotencyKey);
    const parsedOrderId = posId(orderId, 'INVALID_ORDER_ID');
    if (!VALID_AMENDMENT_TYPES.has(amendmentType)) {
      throw fail('INVALID_AMENDMENT_TYPE', `Unsupported amendment type '${amendmentType}'.`, 400);
    }
    if (!VALID_COST_RESPONSIBILITIES.has(costResponsibility)) {
      throw fail('INVALID_COST_RESPONSIBILITY', `Unsupported cost_responsibility '${costResponsibility}'.`, 400);
    }
    const cleanReason = String(reason || '').trim();
    if (cleanReason.length < 5) {
      throw fail('REASON_REQUIRED', 'Meaningful amendment reason is required.', 400);
    }
    const expiresSql = normalizeSqlDateTime(expiresAt);
    if (!expiresSql) throw fail('EXPIRY_REQUIRED', 'Quote expires_at is required.', 400);
    const etaSql = proposedEtaAt ? normalizeSqlDateTime(proposedEtaAt) : null;

    return this._tx(async (conn) => {
      if (actor.role === 'SUPPLIER') {
        await this._assertVerifiedSupplier(conn, actor);
      } else if (!['ADMIN', 'SUPER_ADMIN', 'BUYER'].includes(actor.role)) {
        throw fail('FORBIDDEN', 'Unauthorized role for delivery amendment.', 403);
      }

      const [orders] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [parsedOrderId]);
      if (!orders.length) throw fail('ORDER_NOT_FOUND', 'Order not found.', 404);
      const order = orders[0];

      if (actor.role === 'SUPPLIER' && Number(order.supplier_id) !== Number(actor.id)) {
        throw fail('FORBIDDEN', 'You do not own this order.', 403);
      }
      if (actor.role === 'BUYER' && Number(order.buyer_id) !== Number(actor.id)) {
        throw fail('FORBIDDEN', 'You do not own this order.', 403);
      }

      // Idempotency replay check
      const [prior] = await conn.query(
        'SELECT * FROM delivery_amendments WHERE order_id = ? AND idempotency_key = ? FOR UPDATE',
        [parsedOrderId, key]
      );
      if (prior.length > 0) {
        return { is_replay: true, amendment: prior[0] };
      }

      // Post-lock SQL expiry check
      const [[clock]] = await conn.query('SELECT (? > UTC_TIMESTAMP()) AS valid_expiry', [expiresSql]);
      if (Number(clock.valid_expiry) !== 1) {
        throw fail('INVALID_QUOTE_EXPIRY', 'Amendment quote expires_at must be in the future.', 422);
      }

      let stop = null;
      if (stopId) {
        const [stops] = await conn.query('SELECT * FROM delivery_run_stops WHERE id = ? AND order_id = ? FOR UPDATE', [posId(stopId), parsedOrderId]);
        if (!stops.length) throw fail('STOP_NOT_FOUND', 'Delivery stop not found for this order.', 404);
        stop = stops[0];
      }

      const oldFeeStr = exactDecimal.toCanonical(stop ? stop.locked_delivery_fee_pkr : (order.delivery_fee || 0), 2);
      const newFeeStr = exactDecimal.toCanonical(newDeliveryFeePkr ?? oldFeeStr, 2);
      if (newFeeStr.startsWith('-')) {
        throw fail('INVALID_DELIVERY_FEE', 'Delivery fee cannot be negative.', 422);
      }

      const diffNum = Number(newFeeStr) - Number(oldFeeStr);
      const diffStr = exactDecimal.toCanonical(diffNum.toFixed(2), 2);

      // Selected cost & consent policy enforcement (2026-11-17):
      if (costResponsibility === 'SUPPLIER_CARRIER_FAILURE' && diffNum > 0) {
        throw fail('BUYER_EXTRA_CHARGE_PROHIBITED', 'Supplier/carrier failure remediation cannot impose an extra buyer charge.', 422);
      }
      if (['PLATFORM_PROVIDER_FAULT', 'DISPUTED_RESPONSIBILITY'].includes(costResponsibility) && diffNum !== 0) {
        throw fail('SUPPORT_RESOLUTION_REQUIRED', 'Platform/provider fault or disputed responsibility cannot auto-charge buyer or invent subsidy; use audited support resolution.', 422);
      }

      const [verRows] = await conn.query(
        'SELECT COALESCE(MAX(amendment_version), 0) AS max_ver FROM delivery_amendments WHERE order_id = ? FOR UPDATE',
        [parsedOrderId]
      );
      const nextVer = Number(verRows[0].max_ver) + 1;

      // Supersede any prior PENDING amendments for this order so stale quotes cannot be accepted later
      await conn.query(
        "UPDATE delivery_amendments SET decision = 'SUPERSEDED' WHERE order_id = ? AND decision = 'PENDING'",
        [parsedOrderId]
      );

      const skuSnapshot = {
        order_code: order.order_code,
        pool_id: order.pool_id || null,
        total_qty: String(order.total_qty),
        unit_price: String(order.unit_price),
        subtotal_amount: String(order.subtotal_amount)
      };

      const quoteHash = sha256Hex({
        order_id: parsedOrderId,
        amendment_version: nextVer,
        amendment_type: amendmentType,
        cost_responsibility: costResponsibility,
        sku_snapshot: skuSnapshot,
        old_amount_pkr: oldFeeStr,
        new_amount_pkr: newFeeStr,
        charge_diff_pkr: diffStr,
        delivery_terms: deliveryTerms || {},
        proposed_eta_at: etaSql,
        expires_at: expiresSql
      });

      const requiresBuyerConsent = (diffNum > 0 || ['REROUTE', 'ADDRESS_CHANGE', 'MODE_CHANGE', 'WINDOW_CHANGE'].includes(amendmentType)) ? 1 : 0;
      const amendCode = `AMD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

      const [ins] = await conn.query(
        `INSERT INTO delivery_amendments (
          amendment_code, order_id, stop_id, buyer_id, supplier_id,
          amendment_type, amendment_version, cost_responsibility,
          initiating_actor_id, initiating_actor_role, reason, sku_snapshot_json,
          old_amount_pkr, new_amount_pkr, charge_diff_pkr, delivery_terms_json,
          proposed_eta_at, expires_at, quote_hash, requires_buyer_consent,
          decision, idempotency_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
        [
          amendCode,
          parsedOrderId,
          stop ? stop.id : null,
          order.buyer_id,
          order.supplier_id,
          amendmentType,
          nextVer,
          costResponsibility,
          actor.id,
          actor.role,
          cleanReason,
          JSON.stringify(skuSnapshot),
          oldFeeStr,
          newFeeStr,
          diffStr,
          JSON.stringify(deliveryTerms || {}),
          etaSql,
          expiresSql,
          quoteHash,
          requiresBuyerConsent,
          key
        ]
      );

      const [created] = await conn.query('SELECT * FROM delivery_amendments WHERE id = ?', [ins.insertId]);

      if (stop) {
        await this._emitStopNotification(conn, {
          type: 'FULFILLMENT.CLUSTER_REROUTED',
          stop,
          actor,
          transitionId: `amend-prop-${ins.insertId}`,
          message: `Delivery amendment proposal ${amendCode} (v${nextVer}) created for order ${order.order_code}.`
        });
      }

      return { is_replay: false, amendment: created[0] };
    });
  }

  /**
   * Owning buyer accepts or declines a pending delivery amendment quote.
   * Revalidates ownership, expiry via fresh SQL clock, version, and quote_hash after locks.
   * Acceptance records consent only; it never marks payment PAID or allocates extra stock.
   */
  async decideAmendment({ actor, amendmentId, amendmentVersion, quoteHash, decision, idempotencyKey }) {
    const key = requireIdempotencyKey(idempotencyKey);
    const parsedId = posId(amendmentId, 'INVALID_AMENDMENT_ID');
    if (!actor || !actor.id || actor.role !== 'BUYER') {
      throw fail('UNAUTHORIZED_ROLE', 'Only the owning buyer can accept or decline a delivery amendment.', 403);
    }
    if (!['ACCEPTED', 'DECLINED'].includes(decision)) {
      throw fail('INVALID_DECISION', "decision must be 'ACCEPTED' or 'DECLINED'.", 400);
    }

    const conn = await this.db.getConnection();
    let committed = false;
    try {
      await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await conn.beginTransaction();

      const [rows] = await conn.query('SELECT * FROM delivery_amendments WHERE id = ? FOR UPDATE', [parsedId]);
      if (!rows.length) throw fail('AMENDMENT_NOT_FOUND', 'Delivery amendment not found.', 404);
      const amd = rows[0];

      if (Number(amd.buyer_id) !== Number(actor.id)) {
        throw fail('FORBIDDEN', 'You do not own this delivery amendment.', 403);
      }

      // Idempotent replay check
      if (amd.decision_idempotency_key === key) {
        await conn.commit();
        committed = true;
        return { is_replay: true, amendment: amd };
      }

      if (amd.decision !== 'PENDING') {
        throw fail('AMENDMENT_ALREADY_DECIDED', `Amendment is already '${amd.decision}'.`, 409);
      }

      if (Number(amendmentVersion) !== Number(amd.amendment_version)) {
        throw fail('AMENDMENT_VERSION_MISMATCH', 'Stale or mismatched amendment version.', 409);
      }
      if (String(quoteHash || '') !== String(amd.quote_hash)) {
        throw fail('QUOTE_HASH_MISMATCH', 'Quote hash does not match the current locked amendment.', 409);
      }

      // Post-lock SQL expiry revalidation
      const [[clock]] = await conn.query('SELECT (expires_at <= UTC_TIMESTAMP()) AS expired FROM delivery_amendments WHERE id = ?', [parsedId]);
      if (Number(clock.expired) === 1) {
        await conn.query(
          "UPDATE delivery_amendments SET decision = 'EXPIRED', decided_at = UTC_TIMESTAMP() WHERE id = ?",
          [parsedId]
        );
        await conn.commit();
        committed = true;
        throw fail('AMENDMENT_EXPIRED', 'This delivery amendment quote has expired.', 409);
      }

      await conn.query(
        `UPDATE delivery_amendments
         SET decision = ?, decided_by = ?, decided_at = UTC_TIMESTAMP(), decision_idempotency_key = ?
         WHERE id = ?`,
        [decision, actor.id, key, parsedId]
      );

      if (amd.stop_id) {
        const [stops] = await conn.query('SELECT * FROM delivery_run_stops WHERE id = ? FOR UPDATE', [amd.stop_id]);
        if (stops.length > 0) {
          const stop = stops[0];
          if (decision === 'ACCEPTED' && Number(amd.charge_diff_pkr) === 0 && amd.proposed_eta_at) {
            await conn.query(
              'UPDATE delivery_run_stops SET eta_at = ?, eta_version = eta_version + 1, version = version + 1 WHERE id = ?',
              [amd.proposed_eta_at, stop.id]
            );
          }
          const [freshStop] = await conn.query('SELECT * FROM delivery_run_stops WHERE id = ?', [stop.id]);
          await this._emitStopNotification(conn, {
            type: 'FULFILLMENT.CLUSTER_REROUTED',
            stop: freshStop[0],
            actor,
            transitionId: `amend-dec-${parsedId}-${decision}-${key}`,
            message: `Buyer ${decision.toLowerCase()} delivery amendment ${amd.amendment_code} (v${amd.amendment_version}).`
          });
        }
      }

      const [updated] = await conn.query('SELECT * FROM delivery_amendments WHERE id = ?', [parsedId]);
      await conn.commit();
      committed = true;
      return { is_replay: false, amendment: updated[0] };
    } catch (err) {
      if (!committed) await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Audited admin recovery for delivery exceptions without fabricating buyer consent.
   */
  async adminRecoverStop({ actor, stopId, action, reason, newClusterId = null, newDeliveryWindow = null, idempotencyKey }) {
    const key = requireIdempotencyKey(idempotencyKey);
    const adminId = this._assertAdmin(actor);
    const parsedStopId = posId(stopId, 'INVALID_STOP_ID');
    const cleanReason = String(reason || '').trim();
    if (cleanReason.length < 5) throw fail('REASON_REQUIRED', 'Audit reason is required for admin recovery.', 400);

    return this._tx(async (conn) => {
      const [stops] = await conn.query('SELECT * FROM delivery_run_stops WHERE id = ? FOR UPDATE', [parsedStopId]);
      if (!stops.length) throw fail('STOP_NOT_FOUND', 'Delivery stop not found.', 404);
      const stop = stops[0];

      if (!['SCHEDULE_REATTEMPT', 'MARK_SLA_BREACH', 'HOLD_FOR_DISPUTE'].includes(action)) {
        throw fail('INVALID_ADMIN_RECOVERY_ACTION', `Unsupported admin recovery action '${action}'.`, 400);
      }

      if (action === 'SCHEDULE_REATTEMPT') {
        if (Number(stop.attempt_count) >= Number(stop.max_attempts)) {
          throw fail('MAX_REATTEMPTS_EXCEEDED', 'Maximum reattempts reached.', 422);
        }
        await conn.query(
          "UPDATE delivery_run_stops SET status = 'REATTEMPT_SCHEDULED', version = version + 1 WHERE id = ?",
          [parsedStopId]
        );
      } else if (action === 'HOLD_FOR_DISPUTE') {
        await conn.query(
          "UPDATE delivery_run_stops SET status = 'FAILED', version = version + 1 WHERE id = ?",
          [parsedStopId]
        );
        await conn.query(
          "UPDATE orders SET fulfillment_status = 'EXCEPTION', exception_reason = 'ADMIN_DELIVERY_HOLD', exception_details = ?, updated_at = NOW() WHERE id = ?",
          [cleanReason, stop.order_id]
        );
      }

      await conn.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, new_value)
         VALUES (?, ?, ?, 'delivery_run_stops', ?, ?)`,
        [
          adminId,
          actor.role,
          `ADMIN_DELIVERY_${action}`,
          parsedStopId,
          JSON.stringify({ reason: cleanReason, new_cluster_id: newClusterId, new_delivery_window: newDeliveryWindow, idempotency_key: key })
        ]
      );

      const [fresh] = await conn.query('SELECT * FROM delivery_run_stops WHERE id = ?', [parsedStopId]);
      await this._emitStopNotification(conn, {
        type: action === 'MARK_SLA_BREACH' ? 'FULFILLMENT.SLA_BREACHED' : 'FULFILLMENT.CLUSTER_REROUTED',
        stop: fresh[0],
        actor,
        transitionId: `admin-rec-${parsedStopId}-${key}`,
        message: `Admin recovery (${action}) recorded on stop #${parsedStopId}: ${cleanReason}`
      });

      return { stop: fresh[0], action };
    });
  }

  /**
   * Supplier-owned manifest read model (strictly scoped to actor.id).
   */
  async getSupplierManifest({ actor, status = null }) {
    const conn = await this.db.getConnection();
    try {
      await this._assertVerifiedSupplier(conn, actor);
      const params = [actor.id];
      const filter = status ? 'AND status = ?' : '';
      if (status) params.push(status);

      const [runs] = await conn.query(
        `SELECT * FROM delivery_runs WHERE supplier_id = ? ${filter} ORDER BY id DESC LIMIT 50`,
        params
      );
      if (!runs.length) return { runs: [] };

      const runIds = runs.map(r => r.id);
      const [stops] = await conn.query(
        `SELECT s.id, s.run_id, s.order_id, s.buyer_id, s.cluster_id, s.mode,
                s.address_id, s.pickup_point_id, s.stop_sequence, s.status,
                s.locked_delivery_fee_pkr, s.ordered_qty, s.accepted_qty,
                s.missing_qty, s.rejected_qty, s.disputed_qty, s.eta_at,
                s.eta_version, s.attempt_count, s.max_attempts,
                s.pickup_code_issued_at, s.pickup_claimed_at,
                s.supplier_delivered_at, s.buyer_confirmed_at, s.dispute_id,
                o.order_code, o.fulfillment_status
         FROM delivery_run_stops s
         JOIN orders o ON o.id = s.order_id
         WHERE s.run_id IN (${runIds.map(() => '?').join(',')})
         ORDER BY s.run_id DESC, s.stop_sequence ASC`,
        runIds
      );

      const byRun = new Map();
      for (const s of stops) {
        if (!byRun.has(s.run_id)) byRun.set(s.run_id, []);
        byRun.get(s.run_id).push(s);
      }

      return {
        runs: runs.map(r => ({ ...r, stops: byRun.get(r.id) || [] }))
      };
    } finally {
      conn.release();
    }
  }

  /**
   * Buyer-owned stop view for an order. Strictly zero peer buyer leakage.
   * Decrypts pickup code ONLY for the owning buyer.
   */
  async getBuyerStopForOrder({ actor, orderId }) {
    if (!actor || !actor.id || actor.role !== 'BUYER') {
      throw fail('UNAUTHORIZED_ROLE', 'Buyer authorization required.', 403);
    }
    const parsedOrderId = posId(orderId, 'INVALID_ORDER_ID');

    const conn = await this.db.getConnection();
    try {
      const [orders] = await conn.query('SELECT id, buyer_id, order_code, fulfillment_status FROM orders WHERE id = ?', [parsedOrderId]);
      if (!orders.length) throw fail('ORDER_NOT_FOUND', 'Order not found.', 404);
      if (Number(orders[0].buyer_id) !== Number(actor.id)) {
        throw fail('FORBIDDEN', 'You do not own this order.', 403);
      }

      const [stops] = await conn.query(
        `SELECT s.*, r.run_code, r.delivery_day, r.delivery_window, r.status AS run_status, r.cutoff_at
         FROM delivery_run_stops s
         JOIN delivery_runs r ON r.id = s.run_id
         WHERE s.order_id = ?
         ORDER BY s.id DESC LIMIT 1`,
        [parsedOrderId]
      );

      const [amendments] = await conn.query(
        'SELECT * FROM delivery_amendments WHERE order_id = ? ORDER BY amendment_version DESC',
        [parsedOrderId]
      );

      if (!stops.length) {
        return { stop: null, attempts: [], amendments };
      }

      const stop = stops[0];
      const [attempts] = await conn.query(
        'SELECT id, attempt_number, outcome, reason_code, notes, created_at FROM delivery_attempts WHERE stop_id = ? ORDER BY attempt_number ASC',
        [stop.id]
      );

      let pickupCode = null;
      if (stop.mode === 'PICKUP' && stop.pickup_code_encrypted && !stop.pickup_claimed_at) {
        try { pickupCode = this.encryption.decrypt(stop.pickup_code_encrypted); } catch { pickupCode = null; }
      }

      const sanitizedStop = {
        id: stop.id,
        run_id: stop.run_id,
        run_code: stop.run_code,
        run_status: stop.run_status,
        order_id: stop.order_id,
        order_code: orders[0].order_code,
        cluster_id: stop.cluster_id,
        mode: stop.mode,
        delivery_day: stop.delivery_day,
        delivery_window: stop.delivery_window,
        cutoff_at: stop.cutoff_at,
        status: stop.status,
        locked_delivery_fee_pkr: stop.locked_delivery_fee_pkr,
        ordered_qty: stop.ordered_qty,
        accepted_qty: stop.accepted_qty,
        missing_qty: stop.missing_qty,
        rejected_qty: stop.rejected_qty,
        disputed_qty: stop.disputed_qty,
        eta_at: stop.eta_at,
        eta_version: stop.eta_version,
        attempt_count: stop.attempt_count,
        max_attempts: stop.max_attempts,
        pickup_code: pickupCode,
        pickup_claimed_at: stop.pickup_claimed_at,
        supplier_delivered_at: stop.supplier_delivered_at,
        buyer_confirmed_at: stop.buyer_confirmed_at,
        dispute_id: stop.dispute_id
      };

      return { stop: sanitizedStop, attempts, amendments };
    } finally {
      conn.release();
    }
  }

  /**
   * Admin operational view of delivery exceptions / failed stops.
   */
  async getAdminDeliveryExceptions({ actor }) {
    this._assertAdmin(actor);
    const conn = await this.db.getConnection();
    try {
      const [stops] = await conn.query(
        `SELECT s.id, s.run_id, s.order_id, s.buyer_id, s.supplier_id, s.cluster_id, s.mode,
                s.status, s.attempt_count, s.max_attempts, s.dispute_id, s.eta_at,
                o.order_code, r.run_code
         FROM delivery_run_stops s
         JOIN orders o ON o.id = s.order_id
         JOIN delivery_runs r ON r.id = s.run_id
         WHERE s.status IN ('FAILED', 'REATTEMPT_SCHEDULED', 'PARTIAL_CONFIRMED')
         ORDER BY s.updated_at DESC LIMIT 50`
      );
      return { stops };
    } finally {
      conn.release();
    }
  }
}

module.exports = new DeliveryRunService();
module.exports.DeliveryRunService = DeliveryRunService;
