// =============================================================================
// src/routes/v1/buyerAddressRoutes.js
// MilJor Special Phase G2: Buyer Delivery Addresses Routes
// =============================================================================
const express = require('express');
const router = express.Router();
const buyerAddrController = require('../../controllers/buyerAddressController');
const { protect, authorize } = require('../../middlewares/authGuard');

router.use(protect);

router.get('/', authorize('BUYER', 'ADMIN'), (req, res) => buyerAddrController.getAddresses(req, res));
router.post('/', authorize('BUYER', 'ADMIN'), (req, res) => buyerAddrController.createAddress(req, res));
router.patch('/:id', authorize('BUYER', 'ADMIN'), (req, res) => buyerAddrController.updateAddress(req, res));
router.delete('/:id', authorize('BUYER', 'ADMIN'), (req, res) => buyerAddrController.deleteAddress(req, res));

module.exports = router;
