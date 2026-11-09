// =============================================================================
// src/routes/v1/geographicRoutes.js
// MilJor Special Phase G1: Lahore Geographic Intelligence API Routes
// =============================================================================
const express = require('express');
const router = express.Router();
const geoController = require('../../controllers/geographicController');

// All endpoints in this router are read-only / diagnostic query endpoints
router.get('/clusters', (req, res) => geoController.getClusters(req, res));
router.get('/clusters/:id', (req, res) => geoController.getClusterDetail(req, res));
router.get('/boundary', (req, res) => geoController.getBoundary(req, res));
router.get('/areas/search', (req, res) => geoController.searchAreas(req, res));
router.post('/validate-containment', (req, res) => geoController.validateContainment(req, res));
router.post('/resolve-address', (req, res) => geoController.resolveAddress(req, res));
router.post('/routing-estimate', (req, res) => geoController.estimateRouting(req, res));

module.exports = router;
