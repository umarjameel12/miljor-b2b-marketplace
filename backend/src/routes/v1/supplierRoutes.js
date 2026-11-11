// =============================================================================
// src/routes/v1/supplierRoutes.js
// MilJor Supplier Portal Routes
// Package E1: Profile, Onboarding, Verification & Delivery Logistics
// =============================================================================
const express = require('express');
const router = express.Router();
const profileController = require('../../controllers/supplierProfileController');
const supDelivController = require('../../controllers/supplierDeliveryController');
const subscriptionController = require('../../controllers/subscriptionController');
const { protect, authorize, authorizeStrict } = require('../../middlewares/authGuard');

// All supplier portal routes require authenticated session
router.use(protect);

// Unified supplier management READ MODEL only. Mutations stay on B4/B5 routes.
router.get('/pools/overview', authorizeStrict('SUPPLIER'), async (req,res)=>{
  try {
    const data=await require('../../services/unifiedSupplierPoolsService').list(req.user.id);
    return res.json({success:true,data});
  } catch(error) {
    return res.status(error.statusCode||500).json({success:false,error:{
      code:error.statusCode?error.code:'POOL_OVERVIEW_UNAVAILABLE',
      message:error.statusCode?error.message:'Unable to load your pools'
    }});
  }
});


// UCP-3/UCP-5: read-only supplier-owned pool operations.
for (const [route,action] of [
  ['/pools/delivery-context','deliveryContext'],
  ['/pools/inventory','inventory'],
  ['/pools/insights','insights'],
  ['/pools/alerts','alerts']
]) {
  router.get(route,authorizeStrict('SUPPLIER'),async(req,res)=>{
    try {
      const data=await require('../../services/poolOperationsService')[action](req.user.id);
      res.json({success:true,data});
    }catch(error){
      const code=error.statusCode||500;
      res.status(code).json({success:false,error:{
        code:code<500?error.code:'POOL_OPERATION_UNAVAILABLE',
        message:code<500?error.message:'Unable to retrieve supplier pool operations'
      }});
    }
  });
}

// ---------------------------------------------------------------------------
// 1. Supplier Business Profile & Onboarding (Package E1)
// ---------------------------------------------------------------------------
router.get('/profile', authorize('SUPPLIER', 'ADMIN', 'SUPER_ADMIN'), (req, res) => profileController.getProfile(req, res));
router.put('/profile', authorizeStrict('SUPPLIER'), (req, res) => profileController.updateProfile(req, res));
router.post('/verification/submit', authorizeStrict('SUPPLIER'), (req, res) => profileController.submitVerification(req, res));
router.get('/verification/status', authorize('SUPPLIER', 'ADMIN', 'SUPER_ADMIN'), (req, res) => profileController.getVerificationStatus(req, res));

// ---------------------------------------------------------------------------
// 2. Supplier Subscriptions & Entitlements (Package E3)
// ---------------------------------------------------------------------------
router.get('/subscription', authorize('SUPPLIER', 'ADMIN', 'SUPER_ADMIN'), (req, res) => subscriptionController.getMySubscription(req, res));
router.post('/subscription/upgrade', authorize('SUPPLIER', 'ADMIN', 'SUPER_ADMIN'), (req, res) => subscriptionController.changePlan(req, res));
router.get('/subscription/plans', (req, res) => subscriptionController.getPlans(req, res));

// ---------------------------------------------------------------------------
// 3. Supplier Delivery Settings & Pickup Points (Special Phase G2 Backward Compatibility)
// ---------------------------------------------------------------------------
router.get('/delivery-settings', authorize('SUPPLIER', 'ADMIN', 'SUPER_ADMIN'), (req, res) => supDelivController.getSettings(req, res));
router.put('/delivery-settings', authorizeStrict('SUPPLIER'), (req, res) => supDelivController.updateSettings(req, res));
router.post('/pickup-points', authorizeStrict('SUPPLIER'), (req, res) => supDelivController.addPickupPoint(req, res));
router.patch('/pickup-points/:id', authorizeStrict('SUPPLIER'), (req, res) => supDelivController.updatePickupPoint(req, res));

module.exports = router;
