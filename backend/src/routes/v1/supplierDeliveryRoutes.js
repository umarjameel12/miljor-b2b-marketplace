// =============================================================================
// src/routes/v1/supplierDeliveryRoutes.js
// MilJor Special Phase G2: Supplier Delivery Configuration Routes
// =============================================================================
const express = require('express');
const router = express.Router();
const supDelivController = require('../../controllers/supplierDeliveryController');
const { protect, authorize } = require('../../middlewares/authGuard');

router.use(protect);

router.get('/delivery-settings', authorize('SUPPLIER', 'ADMIN'), (req, res) => supDelivController.getSettings(req, res));
router.put('/delivery-settings', authorize('SUPPLIER', 'ADMIN'), (req, res) => supDelivController.updateSettings(req, res));
router.post('/pickup-points', authorize('SUPPLIER', 'ADMIN'), (req, res) => supDelivController.addPickupPoint(req, res));
router.patch('/pickup-points/:id', authorize('SUPPLIER', 'ADMIN'), (req, res) => supDelivController.updatePickupPoint(req, res));

module.exports = router;
