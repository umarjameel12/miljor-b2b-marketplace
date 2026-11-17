'use strict';

const express = require('express');
const deliveryRunService = require('../../services/deliveryRunService');
const { protect, authorizeStrict, authorizeAdmin } = require('../../middlewares/authGuard');
const idempotencyGuard = require('../../middlewares/idempotencyGuard');

function createDeliveryRunRouter(service = deliveryRunService) {
  const router = express.Router();

  const handle = (work, status = 200) => async (req, res) => {
    try {
      const data = await work(req);
      return res.status(status).json({ success: true, data });
    } catch (error) {
      const code = error.statusCode || 500;
      return res.status(code).json({
        success: false,
        error: {
          code: error.code || 'DELIVERY_RUN_ERROR',
          message: code < 500 ? error.message : 'Delivery operation could not be completed.'
        }
      });
    }
  };

  router.use(protect);

  // Supplier manifest & run operations
  router.get('/supplier/manifest', authorizeStrict('SUPPLIER'),
    handle(req => service.getSupplierManifest({ actor: req.user, status: req.query.status || null })));

  router.post('/supplier/runs', authorizeStrict('SUPPLIER'), idempotencyGuard.required,
    handle(req => service.formOrAssignRun({
      actor: req.user,
      orderIds: req.body?.order_ids,
      clusterId: req.body?.cluster_id,
      mode: req.body?.mode,
      handlingClass: req.body?.handling_class,
      deliveryDay: req.body?.delivery_day,
      deliveryWindow: req.body?.delivery_window,
      cutoffAt: req.body?.cutoff_at,
      maxStops: req.body?.max_stops,
      runId: req.body?.run_id || null,
      idempotencyKey: req.idempotency.key
    }), 201));

  router.post('/supplier/runs/:runId/lock-cutoff', authorizeStrict('SUPPLIER'), idempotencyGuard.required,
    handle(req => service.lockCutoff({
      actor: req.user,
      runId: req.params.runId,
      enforceCutoffClock: req.body?.enforce_cutoff_clock !== false,
      idempotencyKey: req.idempotency.key
    })));

  router.post('/supplier/runs/:runId/dispatch', authorizeStrict('SUPPLIER'), idempotencyGuard.required,
    handle(req => service.dispatchRun({
      actor: req.user,
      runId: req.params.runId,
      deliveryMethod: req.body?.delivery_method || 'SUPPLIER_FLEET',
      reference: req.body?.supplier_delivery_reference || null,
      etaAt: req.body?.eta_at || null,
      notes: req.body?.notes || null,
      idempotencyKey: req.idempotency.key
    })));

  router.post('/supplier/runs/:runId/eta', authorizeStrict('SUPPLIER'), idempotencyGuard.required,
    handle(req => service.updateRunEta({
      actor: req.user,
      runId: req.params.runId,
      etaAt: req.body?.eta_at,
      reason: req.body?.reason || null,
      idempotencyKey: req.idempotency.key
    })));

  router.post('/supplier/stops/:stopId/claim-pickup', authorizeStrict('SUPPLIER'), idempotencyGuard.required,
    handle(req => service.claimPickupStop({
      actor: req.user,
      stopId: req.params.stopId,
      pickupCode: req.body?.pickup_code,
      idempotencyKey: req.idempotency.key
    })));

  router.post('/supplier/stops/:stopId/mark-delivered', authorizeStrict('SUPPLIER'), idempotencyGuard.required,
    handle(req => service.markStopDeliveredBySupplier({
      actor: req.user,
      stopId: req.params.stopId,
      notes: req.body?.notes || null,
      idempotencyKey: req.idempotency.key
    })));

  router.post('/supplier/stops/:stopId/failed-attempt', authorizeStrict('SUPPLIER'), idempotencyGuard.required,
    handle(req => service.recordFailedAttempt({
      actor: req.user,
      stopId: req.params.stopId,
      reasonCode: req.body?.reason_code,
      notes: req.body?.notes || null,
      evidence: req.body?.evidence || null,
      scheduleReattempt: Boolean(req.body?.schedule_reattempt),
      newEtaAt: req.body?.new_eta_at || null,
      slaBreached: Boolean(req.body?.sla_breached),
      idempotencyKey: req.idempotency.key
    })));

  // Buyer own stop, partial/full receipt, and amendment consent
  router.get('/buyer/orders/:orderId/stop', authorizeStrict('BUYER'),
    handle(req => service.getBuyerStopForOrder({ actor: req.user, orderId: req.params.orderId })));

  router.post('/buyer/stops/:stopId/receipt', authorizeStrict('BUYER'), idempotencyGuard.required,
    handle(req => service.recordBuyerStopReceipt({
      actor: req.user,
      stopId: req.params.stopId,
      acceptedQty: req.body?.accepted_qty,
      missingQty: req.body?.missing_qty ?? '0',
      rejectedQty: req.body?.rejected_qty ?? '0',
      reason: req.body?.reason || 'SHORT_QUANTITY',
      description: req.body?.description || null,
      idempotencyKey: req.idempotency.key
    })));

  router.post('/amendments', authorizeStrict('BUYER', 'SUPPLIER', 'ADMIN', 'SUPER_ADMIN'), idempotencyGuard.required,
    handle(req => service.proposeAmendment({
      actor: req.user,
      orderId: req.body?.order_id,
      stopId: req.body?.stop_id || null,
      amendmentType: req.body?.amendment_type,
      costResponsibility: req.body?.cost_responsibility,
      reason: req.body?.reason,
      newDeliveryFeePkr: req.body?.new_delivery_fee_pkr,
      deliveryTerms: req.body?.delivery_terms || {},
      proposedEtaAt: req.body?.proposed_eta_at || null,
      expiresAt: req.body?.expires_at,
      idempotencyKey: req.idempotency.key
    }), 201));

  router.post('/amendments/:amendmentId/decide', authorizeStrict('BUYER'), idempotencyGuard.required,
    handle(req => service.decideAmendment({
      actor: req.user,
      amendmentId: req.params.amendmentId,
      amendmentVersion: req.body?.amendment_version,
      quoteHash: req.body?.quote_hash,
      decision: req.body?.decision,
      idempotencyKey: req.idempotency.key
    })));

  // Admin exception visibility and audited recovery
  router.get('/admin/exceptions', authorizeAdmin,
    handle(req => service.getAdminDeliveryExceptions({ actor: req.user })));

  router.post('/admin/stops/:stopId/recover', authorizeAdmin, idempotencyGuard.required,
    handle(req => service.adminRecoverStop({
      actor: req.user,
      stopId: req.params.stopId,
      action: req.body?.action,
      reason: req.body?.reason,
      newClusterId: req.body?.new_cluster_id || null,
      newDeliveryWindow: req.body?.new_delivery_window || null,
      idempotencyKey: req.idempotency.key
    })));

  return router;
}

module.exports = createDeliveryRunRouter();
module.exports.createDeliveryRunRouter = createDeliveryRunRouter;
