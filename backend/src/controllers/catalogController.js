// =============================================================================
// src/controllers/catalogController.js
// MilJor Canonical Catalog, Supplier Catalog Requests & Admin Moderation Controller
// (Package E2)
// =============================================================================
const catalogRepo = require('../repositories/catalogRepository');
const catalogService = require('../services/catalogService');
const listingRepo = require('../repositories/supplierListingRepo');

class CatalogController {
  // ---------------------------------------------------------------------------
  // Helper: Standardized Error Response
  // ---------------------------------------------------------------------------
  _handleError(res, err, contextLabel) {
    const status = err.status || 500;
    const code = err.code || 'SERVER_ERROR';
    if (status >= 500) {
      console.error(`[CatalogController:${contextLabel}]`, err);
    }
    const payload = {
      success: false,
      error: {
        code,
        message: err.message || 'An unexpected catalog error occurred.'
      }
    };
    if (err.existingFamily) payload.error.existing_family = err.existingFamily;
    if (err.existingSpecification) payload.error.existing_specification = err.existingSpecification;
    if (err.existingRequest) payload.error.existing_request = err.existingRequest;
    return res.status(status).json(payload);
  }

  // ===========================================================================
  // A. PUBLIC / SHARED CATALOG DISCOVERY ENDPOINTS
  // ===========================================================================

  // GET /api/v1/catalog/categories
  async getCategories(req, res) {
    try {
      const includeInactive = req.query.include_inactive === 'true' && req.user && ['SUPER_ADMIN', 'OPERATIONS_ADMIN', 'VERIFICATION_ADMIN', 'ADMIN'].includes(req.user.role);
      const categories = await catalogRepo.findCategories({ includeInactive });
      return res.status(200).json({
        success: true,
        count: categories.length,
        data: { categories }
      });
    } catch (err) {
      return this._handleError(res, err, 'getCategories');
    }
  }

  // GET /api/v1/catalog/categories/:id/families
  async getCategoryFamilies(req, res) {
    try {
      const categoryId = Number(req.params.id);
      if (!Number.isInteger(categoryId) || categoryId <= 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_CATEGORY_ID', message: 'Valid numeric category ID is required.' }
        });
      }

      const category = await catalogRepo.findCategoryById(categoryId);
      if (!category) {
        return res.status(404).json({
          success: false,
          error: { code: 'CATEGORY_NOT_FOUND', message: 'Catalog category not found.' }
        });
      }

      const families = await catalogRepo.findFamilies({ categoryId });
      return res.status(200).json({
        success: true,
        count: families.length,
        data: { category, families }
      });
    } catch (err) {
      return this._handleError(res, err, 'getCategoryFamilies');
    }
  }

  // GET /api/v1/catalog/families
  async getFamilies(req, res) {
    try {
      const { category_id, search } = req.query;
      const families = await catalogRepo.findFamilies({
        categoryId: category_id ? Number(category_id) : null,
        search: search || null
      });
      return res.status(200).json({
        success: true,
        count: families.length,
        data: { families }
      });
    } catch (err) {
      return this._handleError(res, err, 'getFamilies');
    }
  }

  // GET /api/v1/catalog/families/:id
  async getFamilyById(req, res) {
    try {
      const familyId = Number(req.params.id);
      if (!Number.isInteger(familyId) || familyId <= 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_FAMILY_ID', message: 'Valid numeric family ID is required.' }
        });
      }

      const family = await catalogRepo.findFamilyById(familyId);
      if (!family) {
        return res.status(404).json({
          success: false,
          error: { code: 'FAMILY_NOT_FOUND', message: 'Product family not found.' }
        });
      }

      const variants = await catalogRepo.findVariants({ familyId });
      return res.status(200).json({
        success: true,
        data: { family, variants }
      });
    } catch (err) {
      return this._handleError(res, err, 'getFamilyById');
    }
  }

  // GET /api/v1/catalog/families/:id/variants
  async getFamilyVariants(req, res) {
    try {
      const familyId = Number(req.params.id);
      if (!Number.isInteger(familyId) || familyId <= 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_FAMILY_ID', message: 'Valid numeric family ID is required.' }
        });
      }

      const family = await catalogRepo.findFamilyById(familyId);
      if (!family) {
        return res.status(404).json({
          success: false,
          error: { code: 'FAMILY_NOT_FOUND', message: 'Product family not found.' }
        });
      }

      const variants = await catalogRepo.findVariants({ familyId, search: req.query.search || null });
      return res.status(200).json({
        success: true,
        count: variants.length,
        data: { family, variants }
      });
    } catch (err) {
      return this._handleError(res, err, 'getFamilyVariants');
    }
  }

  // GET /api/v1/catalog/variants/:id
  async getVariantById(req, res) {
    try {
      const variantId = Number(req.params.id);
      if (!Number.isInteger(variantId) || variantId <= 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_VARIANT_ID', message: 'Valid numeric variant ID is required.' }
        });
      }

      const variant = await catalogRepo.findVariantById(variantId);
      if (!variant) {
        return res.status(404).json({
          success: false,
          error: { code: 'VARIANT_NOT_FOUND', message: 'Approved physical variant not found.' }
        });
      }

      return res.status(200).json({
        success: true,
        data: { variant }
      });
    } catch (err) {
      return this._handleError(res, err, 'getVariantById');
    }
  }

  // ===========================================================================
  // B. SUPPLIER CATALOG REQUEST ENDPOINTS
  // ===========================================================================

  // POST /api/v1/catalog/requests
  async createCatalogRequest(req, res) {
    try {
      const supplierId = req.user.id;
      const created = await catalogService.createSupplierCatalogRequest(supplierId, req.body, req.user.role);
      return res.status(201).json({
        success: true,
        message: created.status === 'DRAFT'
          ? 'Catalog request saved as draft.'
          : 'Catalog request submitted for admin moderation.',
        data: { request: created }
      });
    } catch (err) {
      return this._handleError(res, err, 'createCatalogRequest');
    }
  }

  // GET /api/v1/catalog/requests/me
  async getMyCatalogRequests(req, res) {
    try {
      const supplierId = req.user.id;
      const { status, request_type } = req.query;
      const [requests, usageSummary] = await Promise.all([
        catalogRepo.findSupplierCatalogRequests(supplierId, {
          status: status || null,
          requestType: request_type || null
        }),
        listingRepo.getSupplierCatalogUsageSummary(supplierId)
      ]);
      return res.status(200).json({
        success: true,
        count: requests.length,
        data: {
          requests,
          catalog_usage: usageSummary
        }
      });
    } catch (err) {
      return this._handleError(res, err, 'getMyCatalogRequests');
    }
  }

  // GET /api/v1/catalog/requests/:id
  async getCatalogRequestById(req, res) {
    try {
      const requestId = Number(req.params.id);
      if (!Number.isInteger(requestId) || requestId <= 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_REQUEST_ID', message: 'Valid numeric request ID is required.' }
        });
      }

      const request = await catalogRepo.findCatalogRequestById(requestId);
      if (!request) {
        return res.status(404).json({
          success: false,
          error: { code: 'REQUEST_NOT_FOUND', message: 'Catalog request not found.' }
        });
      }

      // Suppliers may only view their own requests; Admins may view any
      const isAdmin = ['SUPER_ADMIN', 'OPERATIONS_ADMIN', 'VERIFICATION_ADMIN', 'ADMIN'].includes(req.user.role);
      if (!isAdmin && Number(request.supplier_id) !== Number(req.user.id)) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You are not authorized to view another supplier\'s catalog request.' }
        });
      }

      const logs = await catalogRepo.findModerationLogsByRequestId(requestId);
      return res.status(200).json({
        success: true,
        data: { request, moderation_logs: logs }
      });
    } catch (err) {
      return this._handleError(res, err, 'getCatalogRequestById');
    }
  }

  // PUT /api/v1/catalog/requests/:id
  async updateCatalogRequest(req, res) {
    try {
      const requestId = Number(req.params.id);
      if (!Number.isInteger(requestId) || requestId <= 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_REQUEST_ID', message: 'Valid numeric request ID is required.' }
        });
      }

      const updated = await catalogService.updateSupplierCatalogRequest(
        req.user.id,
        requestId,
        req.body,
        req.user.role
      );

      return res.status(200).json({
        success: true,
        message: updated.status === 'SUBMITTED'
          ? 'Catalog request updated and resubmitted for review.'
          : 'Catalog request draft updated.',
        data: { request: updated }
      });
    } catch (err) {
      return this._handleError(res, err, 'updateCatalogRequest');
    }
  }

  // ===========================================================================
  // C. ADMIN CATALOG GOVERNANCE & MODERATION ENDPOINTS
  // ===========================================================================

  // GET /api/v1/admin/catalog/categories
  async adminGetCategories(req, res) {
    try {
      const categories = await catalogRepo.findCategories({ includeInactive: true });
      return res.status(200).json({
        success: true,
        count: categories.length,
        data: { categories }
      });
    } catch (err) {
      return this._handleError(res, err, 'adminGetCategories');
    }
  }

  // POST /api/v1/admin/catalog/categories
  async adminCreateCategory(req, res) {
    try {
      const created = await catalogService.createAdminCategory(req.user.id, req.user.role, req.body || {});
      return res.status(201).json({
        success: true,
        message: 'Catalog category created successfully.',
        data: { category: created }
      });
    } catch (err) {
      return this._handleError(res, err, 'adminCreateCategory');
    }
  }

  // PUT /api/v1/admin/catalog/categories/:id
  async adminUpdateCategory(req, res) {
    try {
      const id = Number(req.params.id);
      const existing = await catalogRepo.findCategoryById(id);
      if (!existing) {
        return res.status(404).json({
          success: false,
          error: { code: 'CATEGORY_NOT_FOUND', message: 'Catalog category not found.' }
        });
      }
      const updated = await catalogRepo.updateCategory(id, req.body || {});
      return res.status(200).json({
        success: true,
        message: 'Catalog category updated successfully.',
        data: { category: updated }
      });
    } catch (err) {
      return this._handleError(res, err, 'adminUpdateCategory');
    }
  }

  // GET /api/v1/admin/catalog/families
  async adminGetFamilies(req, res) {
    try {
      const { category_id, search } = req.query;
      const families = await catalogRepo.findFamilies({
        categoryId: category_id ? Number(category_id) : null,
        includeInactive: true,
        search: search || null
      });
      return res.status(200).json({
        success: true,
        count: families.length,
        data: { families }
      });
    } catch (err) {
      return this._handleError(res, err, 'adminGetFamilies');
    }
  }

  // POST /api/v1/admin/catalog/families
  async adminCreateFamily(req, res) {
    try {
      const created = await catalogService.createAdminFamily(req.user.id, req.user.role, req.body || {});
      return res.status(201).json({
        success: true,
        message: 'Product family created successfully.',
        data: { family: created }
      });
    } catch (err) {
      return this._handleError(res, err, 'adminCreateFamily');
    }
  }

  // PUT /api/v1/admin/catalog/families/:id
  async adminUpdateFamily(req, res) {
    try {
      const id = Number(req.params.id);
      const existing = await catalogRepo.findFamilyById(id);
      if (!existing) {
        return res.status(404).json({
          success: false,
          error: { code: 'FAMILY_NOT_FOUND', message: 'Product family not found.' }
        });
      }
      const updated = await catalogRepo.updateFamily(id, req.body || {});
      return res.status(200).json({
        success: true,
        message: 'Product family updated successfully.',
        data: { family: updated }
      });
    } catch (err) {
      return this._handleError(res, err, 'adminUpdateFamily');
    }
  }

  // POST /api/v1/admin/catalog/variants
  async adminCreateVariant(req, res) {
    try {
      const created = await catalogService.createAdminVariant(req.user.id, req.user.role, req.body || {});
      return res.status(201).json({
        success: true,
        message: 'Approved physical variant created successfully.',
        data: { variant: created }
      });
    } catch (err) {
      return this._handleError(res, err, 'adminCreateVariant');
    }
  }

  // GET /api/v1/admin/catalog/requests
  async adminGetCatalogRequests(req, res) {
    try {
      const { status, request_type, category_id, supplier_id } = req.query;
      const requests = await catalogRepo.findAllCatalogRequests({
        status: status || null,
        requestType: request_type || null,
        categoryId: category_id ? Number(category_id) : null,
        supplierId: supplier_id ? Number(supplier_id) : null
      });
      return res.status(200).json({
        success: true,
        count: requests.length,
        data: { requests }
      });
    } catch (err) {
      return this._handleError(res, err, 'adminGetCatalogRequests');
    }
  }

  // GET /api/v1/admin/catalog/requests/:id
  async adminGetCatalogRequestById(req, res) {
    try {
      const requestId = Number(req.params.id);
      const request = await catalogRepo.findCatalogRequestById(requestId);
      if (!request) {
        return res.status(404).json({
          success: false,
          error: { code: 'REQUEST_NOT_FOUND', message: 'Catalog request not found.' }
        });
      }
      const logs = await catalogRepo.findModerationLogsByRequestId(requestId);
      return res.status(200).json({
        success: true,
        data: { request, moderation_logs: logs }
      });
    } catch (err) {
      return this._handleError(res, err, 'adminGetCatalogRequestById');
    }
  }

  // POST /api/v1/admin/catalog/requests/:id/review
  async adminReviewCatalogRequest(req, res) {
    try {
      const requestId = Number(req.params.id);
      const updated = await catalogService.markRequestUnderReview(
        requestId,
        req.user.id,
        req.user.role,
        req.body?.review_notes || null
      );
      return res.status(200).json({
        success: true,
        message: 'Catalog request marked as UNDER_REVIEW.',
        data: { request: updated }
      });
    } catch (err) {
      return this._handleError(res, err, 'adminReviewCatalogRequest');
    }
  }

  // POST /api/v1/admin/catalog/requests/:id/approve
  async adminApproveCatalogRequest(req, res) {
    try {
      const requestId = Number(req.params.id);
      const result = await catalogService.approveCatalogRequest(
        requestId,
        req.user.id,
        req.user.role,
        req.body || {}
      );
      return res.status(200).json({
        success: true,
        message: result.alreadyApproved
          ? 'Catalog request was already approved.'
          : 'Catalog request approved and canonical catalog entity created.',
        data: {
          request: result.request,
          approved_family: result.approvedFamily || null,
          approved_variant: result.approvedSpec || null
        }
      });
    } catch (err) {
      return this._handleError(res, err, 'adminApproveCatalogRequest');
    }
  }

  // POST /api/v1/admin/catalog/requests/:id/reject
  async adminRejectCatalogRequest(req, res) {
    try {
      const requestId = Number(req.params.id);
      const { rejection_reason, review_notes } = req.body || {};
      const updated = await catalogService.rejectCatalogRequest(
        requestId,
        req.user.id,
        req.user.role,
        rejection_reason,
        review_notes || null
      );
      return res.status(200).json({
        success: true,
        message: 'Catalog request rejected with reason.',
        data: { request: updated }
      });
    } catch (err) {
      return this._handleError(res, err, 'adminRejectCatalogRequest');
    }
  }
}

module.exports = new CatalogController();
