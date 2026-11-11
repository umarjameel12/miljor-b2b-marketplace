// =============================================================================
// src/services/specificationService.js
// MilJor Product Specification & Canonical Catalog Validation Service
// Canonical normalization, attribute validation, cross-commodity integrity,
// hashing and deduplication (Package E2)
// =============================================================================
const crypto = require('crypto');

class SpecificationService {
  // Normalize text string cleanly (collapse whitespace, trim)
  normalizeText(str) {
    if (typeof str !== 'string') return '';
    return str.trim().replace(/\s+/g, ' ');
  }

  // Generate URL-safe slug from text
  slugify(str) {
    return this.normalizeText(str)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // Normalize structured attributes object with deterministic key order and normalized values
  normalizeAttributes(attrs) {
    if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return null;
    const sorted = {};
    for (const key of Object.keys(attrs).sort()) {
      let val = attrs[key];
      if (val === undefined || val === null || val === '') continue;
      if (typeof val === 'string') {
        val = val.trim().toLowerCase().replace(/\s+/g, ' ');
      } else if (typeof val === 'number') {
        if (!Number.isFinite(val)) continue;
        val = Number(val.toFixed(4));
      } else if (typeof val === 'boolean') {
        val = Boolean(val);
      } else {
        continue; // disallow nested objects/arrays inside scalar attribute map
      }
      sorted[key.trim().toLowerCase()] = val;
    }
    return Object.keys(sorted).length > 0 ? sorted : null;
  }

  // Strictly validate positive decimal pack_size (reject '25kg', 'NaN', Infinity, <=0, >10000)
  validatePackSize(rawPackSize) {
    if (rawPackSize === null || rawPackSize === undefined || rawPackSize === '' || typeof rawPackSize === 'boolean' || typeof rawPackSize === 'object') {
      return { valid: false, message: 'Pack size must be a valid positive number.' };
    }
    const str = String(rawPackSize).trim();
    if (!/^\d+(\.\d{1,2})?$/.test(str)) {
      return { valid: false, message: 'Pack size must be a positive numeric value (up to 2 decimal places) without unit text.' };
    }
    const num = Number(str);
    if (!Number.isFinite(num) || num <= 0 || num > 10000) {
      return { valid: false, message: 'Pack size must be greater than 0 and at most 10,000.' };
    }
    return { valid: true, value: Number(num.toFixed(2)) };
  }

  // Canonicalize unit string
  normalizeUnit(unit) {
    if (typeof unit !== 'string') return '';
    const raw = unit.trim();
    const lower = raw.toLowerCase();
    if (['kg', 'kilogram', 'kilograms', 'kilo'].includes(lower)) return 'kg';
    if (['g', 'gm', 'gram', 'grams'].includes(lower)) return 'g';
    if (['l', 'ltr', 'litre', 'liter', 'litres', 'liters'].includes(lower)) return 'L';
    if (['ml', 'millilitre', 'milliliter', 'millilitres', 'milliliters'].includes(lower)) return 'mL';
    return raw;
  }

  // Compute canonical deterministic hash representing all commercially significant physical attributes
  // Backward compatible with existing 16 specifications in product_specifications
  computeSpecHash({
    productId,
    brand,
    variety,
    cropYear,
    processingMethod,
    qualityGrade,
    packagingType,
    packSize,
    packUnit,
    purchasingUnit,
    specAttributes
  }) {
    const normAttrs = this.normalizeAttributes(specAttributes);
    const attrString = normAttrs ? JSON.stringify(normAttrs) : '';

    const norm = [
      Number(productId),
      (brand || '').trim().toLowerCase().replace(/\s+/g, ' '),
      (variety || '').trim().toLowerCase().replace(/\s+/g, ' '),
      (cropYear || '').trim().toLowerCase().replace(/\s+/g, ' '),
      (processingMethod || '').trim().toLowerCase().replace(/\s+/g, ' '),
      (qualityGrade || '').trim().toLowerCase().replace(/\s+/g, ' '),
      (packagingType || '').trim().toLowerCase().replace(/\s+/g, ' '),
      Number(packSize).toFixed(2),
      (packUnit || '').trim().toLowerCase(),
      (purchasingUnit || '').trim().toLowerCase(),
      attrString
    ].join('|');

    return crypto.createHash('sha256').update(norm).digest('hex');
  }

  // Compute deterministic deduplication hash for catalog requests (NEW_FAMILY or NEW_VARIANT)
  computeCatalogRequestHash({
    requestType,
    categoryId,
    familyId,
    proposedFamilyName,
    brand,
    variety,
    cropYear,
    processingMethod,
    qualityGrade,
    packagingType,
    packSize,
    packUnit,
    purchasingUnit,
    specAttributes
  }) {
    const type = String(requestType || '').trim().toUpperCase();
    if (type === 'NEW_FAMILY') {
      const normFamily = this.slugify(proposedFamilyName || '');
      const raw = `NEW_FAMILY|${Number(categoryId)}|${normFamily}`;
      return crypto.createHash('sha256').update(raw).digest('hex');
    }

    const normAttrs = this.normalizeAttributes(specAttributes);
    const attrString = normAttrs ? JSON.stringify(normAttrs) : '';
    const normUnit = this.normalizeUnit(packUnit || '').toLowerCase();

    const norm = [
      'NEW_VARIANT',
      Number(categoryId || 0),
      Number(familyId || 0),
      (brand || '').trim().toLowerCase().replace(/\s+/g, ' '),
      (variety || '').trim().toLowerCase().replace(/\s+/g, ' '),
      (cropYear || 'N/A').trim().toLowerCase().replace(/\s+/g, ' '),
      (processingMethod || 'N/A').trim().toLowerCase().replace(/\s+/g, ' '),
      (qualityGrade || 'Standard').trim().toLowerCase().replace(/\s+/g, ' '),
      (packagingType || '').trim().toLowerCase().replace(/\s+/g, ' '),
      Number(packSize || 0).toFixed(2),
      normUnit,
      (purchasingUnit || '').trim().toLowerCase(),
      attrString
    ].join('|');

    return crypto.createHash('sha256').update(norm).digest('hex');
  }

  // Generate readable specification code
  generateSpecCode(category, variety, idHint = null) {
    const catPrefix = (category || 'GEN')
      .split(/\s+/)
      .map(w => w[0])
      .join('')
      .toUpperCase()
      .substring(0, 4);

    const varPrefix = (variety || 'ITEM')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase()
      .substring(0, 3);

    const rand = idHint || Math.floor(100 + Math.random() * 900);
    return `SPEC-${catPrefix}-${varPrefix}-${rand}`;
  }

  // Cross-commodity semantic guardrails: prevents absurd combinations like
  // Rice attributes under Sugar, Gur under Sugar, or Litres for Rice/Sugar/Flour
  validateFamilyAndCommodityCoherence({
    categorySlug = '',
    categoryName = '',
    familySlug = '',
    familyName = '',
    brand = '',
    variety = '',
    processingMethod = '',
    qualityGrade = '',
    packagingType = '',
    packSize = null,
    packUnit = '',
    purchasingUnit = '',
    specAttributes = null,
    allowedPackUnits = null
  }) {
    const packCheck = this.validatePackSize(packSize);
    if (!packCheck.valid) {
      return packCheck;
    }

    const canonicalUnit = this.normalizeUnit(packUnit);
    if (!['kg', 'g', 'L', 'mL'].includes(canonicalUnit)) {
      return {
        valid: false,
        code: 'INVALID_PACK_UNIT',
        message: `Pack unit '${packUnit}' is not supported. Allowed canonical units: kg, g, L, mL.`
      };
    }

    // Check family-specific allowed pack units if provided
    if (Array.isArray(allowedPackUnits) && allowedPackUnits.length > 0) {
      const normalizedAllowed = allowedPackUnits.map(u => this.normalizeUnit(u));
      if (!normalizedAllowed.includes(canonicalUnit)) {
        return {
          valid: false,
          code: 'INCOMPATIBLE_FAMILY_UNIT',
          message: `Pack unit '${canonicalUnit}' is invalid for product family '${familyName || familySlug}'. Allowed units: ${normalizedAllowed.join(', ')}.`
        };
      }
    }

    const fam = `${familySlug} ${familyName}`.toLowerCase();
    const cat = `${categorySlug} ${categoryName}`.toLowerCase();
    const combinedText = `${brand} ${variety} ${processingMethod} ${qualityGrade}`.toLowerCase();
    const attrs = this.normalizeAttributes(specAttributes) || {};
    const attrKeys = Object.keys(attrs);
    const attrValuesText = Object.values(attrs).join(' ').toLowerCase();

    // 1. Cooking Oil vs Banaspati Ghee unit & commodity checks
    if (fam.includes('cooking-oil') || fam.includes('cooking oil')) {
      if (!['L', 'mL'].includes(canonicalUnit)) {
        return {
          valid: false,
          code: 'INCOMPATIBLE_FAMILY_UNIT',
          message: 'Cooking Oil variants must use liquid volume units (L or mL), not weight units.'
        };
      }
      if (/\b(basmati|sella|kainat|irri|daal|lentil|chakki|maida|besan|icumsa|jaggery|gur)\b/i.test(combinedText)) {
        return {
          valid: false,
          code: 'COMMODITY_FAMILY_MISMATCH',
          message: 'Submitted variety or processing attributes do not belong to Cooking Oil.'
        };
      }
    }

    if (fam.includes('banaspati') || fam.includes('ghee')) {
      if (!['kg', 'g'].includes(canonicalUnit)) {
        return {
          valid: false,
          code: 'INCOMPATIBLE_FAMILY_UNIT',
          message: 'Banaspati Ghee variants must use weight units (kg or g).'
        };
      }
    }

    // 2. Dry commodities (Rice, Flour, Pulses, Sugar, Gur) must NEVER use L or mL
    const isDryCommodity =
      cat.includes('rice') ||
      cat.includes('grain') ||
      cat.includes('flour') ||
      cat.includes('pulse') ||
      cat.includes('legume') ||
      cat.includes('sugar') ||
      cat.includes('sweetener') ||
      fam.includes('rice') ||
      fam.includes('atta') ||
      fam.includes('maida') ||
      fam.includes('besan') ||
      fam.includes('daal') ||
      fam.includes('chana') ||
      fam.includes('sugar') ||
      fam.includes('gur');

    if (isDryCommodity && ['L', 'mL'].includes(canonicalUnit)) {
      return {
        valid: false,
        code: 'INCOMPATIBLE_FAMILY_UNIT',
        message: `Dry commodity family '${familyName || familySlug}' cannot be measured in liquid volume (${canonicalUnit}). Use kg or g.`
      };
    }

    // 3. Sugar vs Gur / Jaggery separation & cross-commodity pollution checks
    if (fam.includes('sugar') && !fam.includes('gur')) {
      if (/\b(gur|jaggery|shakkar|peshawari gur)\b/i.test(combinedText) || /\b(gur|jaggery)\b/i.test(attrValuesText)) {
        return {
          valid: false,
          code: 'COMMODITY_FAMILY_MISMATCH',
          message: 'Gur / Jaggery is a distinct product family and cannot be registered as a variant under Refined Sugar.'
        };
      }
      if (/\b(basmati|sella|kainat|pk-386|irri|broken_ratio|grain_length|daal|masoor|moong|chana|canola|olein)\b/i.test(combinedText + ' ' + attrKeys.join(' ') + ' ' + attrValuesText)) {
        return {
          valid: false,
          code: 'COMMODITY_FAMILY_MISMATCH',
          message: 'Rice, pulse, or oil attributes/varieties cannot be submitted under the Sugar product family.'
        };
      }
    }

    if (fam.includes('gur') || fam.includes('jaggery')) {
      if (/\b(icumsa|refined white crystal|s-30|m-30|basmati|sella|kainat|canola)\b/i.test(combinedText + ' ' + attrValuesText)) {
        return {
          valid: false,
          code: 'COMMODITY_FAMILY_MISMATCH',
          message: 'Refined crystal sugar or unrelated commodity attributes cannot be submitted under Gur / Jaggery.'
        };
      }
    }

    // 4. Rice family cross-commodity checks
    if (fam.includes('rice')) {
      if (/\b(icumsa|jaggery|canola|palm olein|banaspati|masoor|moong|kabuli|besan|maida)\b/i.test(combinedText + ' ' + attrValuesText)) {
        return {
          valid: false,
          code: 'COMMODITY_FAMILY_MISMATCH',
          message: 'Non-rice commodity attributes (Sugar, Oil, Pulses, Flour) cannot be submitted under the Rice product family.'
        };
      }
    }

    // 5. Flour & Milling cross-commodity checks
    if (fam.includes('atta') || fam.includes('maida') || fam.includes('besan')) {
      if (/\b(basmati|sella|kainat|icumsa|palm olein|canola|kabuli)\b/i.test(combinedText + ' ' + attrValuesText)) {
        return {
          valid: false,
          code: 'COMMODITY_FAMILY_MISMATCH',
          message: 'Incompatible commodity attributes detected for Flour & Milling family.'
        };
      }
    }

    // 6. Pulses & Legumes cross-commodity checks
    if (fam.includes('daal') || fam.includes('chana')) {
      if (/\b(basmati|kainat|icumsa|palm olein|canola|banaspati)\b/i.test(combinedText + ' ' + attrValuesText)) {
        return {
          valid: false,
          code: 'COMMODITY_FAMILY_MISMATCH',
          message: 'Incompatible commodity attributes detected for Pulses & Legumes family.'
        };
      }
    }

    return {
      valid: true,
      normalizedPackSize: packCheck.value,
      normalizedPackUnit: canonicalUnit,
      normalizedAttributes: Object.keys(attrs).length > 0 ? attrs : null
    };
  }

  // Validate category-specific attributes (Backward-compatible entry point)
  validateSpecificationInput(data, categoryName = '', familyContext = null, options = {}) {
    const {
      product_id,
      brand,
      is_unbranded,
      variety,
      crop_year,
      processing_method,
      quality_grade,
      packaging_type,
      pack_size,
      pack_unit,
      purchasing_unit,
      spec_attributes
    } = data;

    const allowOptional = Boolean(options.allowOptionalBrandAndGrade);

    if (!product_id && !familyContext) {
      return { valid: false, message: 'Base product ID (product_id) or family is required' };
    }
    if (!allowOptional && (!brand || typeof brand !== 'string' || !brand.trim()) && !is_unbranded) {
      return { valid: false, message: 'Brand is required' };
    }
    if (!variety || typeof variety !== 'string' || !variety.trim()) {
      return { valid: false, message: 'Variety is required' };
    }
    if (!allowOptional && (!processing_method || typeof processing_method !== 'string' || !processing_method.trim())) {
      return { valid: false, message: 'Processing method is required' };
    }
    if (!allowOptional && (!quality_grade || typeof quality_grade !== 'string' || !quality_grade.trim())) {
      return { valid: false, message: 'Quality grade is required' };
    }
    if (!packaging_type || typeof packaging_type !== 'string' || !packaging_type.trim()) {
      return { valid: false, message: 'Packaging type is required' };
    }
    const packCheck = this.validatePackSize(pack_size);
    if (!packCheck.valid) {
      return packCheck;
    }
    if (!pack_unit || typeof pack_unit !== 'string' || !pack_unit.trim()) {
      return { valid: false, message: 'Pack unit (e.g. kg, L) is required' };
    }

    const coherence = this.validateFamilyAndCommodityCoherence({
      categorySlug: familyContext?.category_slug || '',
      categoryName: categoryName || familyContext?.category_name || '',
      familySlug: familyContext?.slug || '',
      familyName: familyContext?.name || '',
      brand: brand || '',
      variety,
      processingMethod: processing_method || '',
      qualityGrade: quality_grade || '',
      packagingType: packaging_type,
      packSize: pack_size,
      packUnit: pack_unit,
      purchasingUnit: purchasing_unit,
      specAttributes: spec_attributes,
      allowedPackUnits: familyContext?.allowed_pack_units || null
    });

    if (!coherence.valid) {
      return coherence;
    }

    return {
      valid: true,
      normalizedPackSize: coherence.normalizedPackSize,
      normalizedPackUnit: coherence.normalizedPackUnit,
      normalizedAttributes: coherence.normalizedAttributes
    };
  }

  // Validate Supplier-Owned Product (Level 3: Brand & Grade are OPTIONAL)
  validateSupplierProductInput(data, categoryName = '', familyContext = null) {
    const {
      brand,
      is_unbranded,
      variety,
      processing_method,
      quality_grade,
      origin,
      crop_year,
      commodity_attributes,
      description
    } = data || {};

    const cleanVariety = this.normalizeText(variety);
    if (!cleanVariety || cleanVariety.length < 2) {
      return {
        valid: false,
        code: 'VARIETY_REQUIRED',
        message: 'Product variety or commercial type is required (minimum 2 characters).'
      };
    }

    const cleanBrand = is_unbranded ? null : (this.normalizeText(brand) || null);
    const normalizedUnbranded = (!cleanBrand || Boolean(is_unbranded)) ? 1 : 0;
    const cleanProcessing = this.normalizeText(processing_method) || null;
    const cleanGrade = this.normalizeText(quality_grade) || null;
    const cleanOrigin = this.normalizeText(origin) || null;
    const cleanCropYear = this.normalizeText(crop_year) || null;
    const cleanDesc = this.normalizeText(description) || null;
    const normAttrs = this.normalizeAttributes(commodity_attributes);

    // Check cross-commodity coherence using a dummy valid pack size/unit for family
    const defaultUnit = Array.isArray(familyContext?.allowed_pack_units) && familyContext.allowed_pack_units.length > 0
      ? familyContext.allowed_pack_units[0]
      : 'kg';

    const coherence = this.validateFamilyAndCommodityCoherence({
      categorySlug: familyContext?.category_slug || '',
      categoryName: categoryName || familyContext?.category_name || '',
      familySlug: familyContext?.slug || '',
      familyName: familyContext?.name || '',
      brand: cleanBrand || '',
      variety: cleanVariety,
      processingMethod: cleanProcessing || '',
      qualityGrade: cleanGrade || '',
      packagingType: 'Bag',
      packSize: 25,
      packUnit: defaultUnit,
      purchasingUnit: 'bag',
      specAttributes: normAttrs,
      allowedPackUnits: familyContext?.allowed_pack_units || null
    });

    if (!coherence.valid) {
      return coherence;
    }

    return {
      valid: true,
      normalized: {
        brand: cleanBrand,
        is_unbranded: normalizedUnbranded,
        variety: cleanVariety,
        processing_method: cleanProcessing,
        quality_grade: cleanGrade,
        origin: cleanOrigin,
        crop_year: cleanCropYear,
        commodity_attributes: normAttrs,
        description: cleanDesc
      }
    };
  }

  // Compute deterministic Supplier Product Identity Hash
  computeSupplierProductIdentityHash({
    supplierId,
    categoryId,
    familyId,
    brand,
    isUnbranded,
    variety,
    processingMethod,
    qualityGrade,
    origin,
    cropYear,
    commodityAttributes
  }) {
    const normAttrs = this.normalizeAttributes(commodityAttributes);
    const attrString = normAttrs ? JSON.stringify(normAttrs) : '';
    const brandVal = isUnbranded || !brand ? '__unbranded__' : this.normalizeText(brand).toLowerCase();

    const raw = [
      Number(supplierId),
      Number(categoryId),
      Number(familyId),
      brandVal,
      this.normalizeText(variety).toLowerCase(),
      this.normalizeText(processingMethod || '').toLowerCase(),
      this.normalizeText(qualityGrade || '').toLowerCase(),
      this.normalizeText(origin || '').toLowerCase(),
      this.normalizeText(cropYear || '').toLowerCase(),
      attrString
    ].join('|');

    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  // Compute deterministic Supplier Physical SKU Hash (distinguishes 25kg vs 50kg, etc.)
  computeSupplierSkuHash({
    supplierId,
    supplierProductId,
    packagingType,
    packSize,
    packUnit,
    purchasingUnit,
    skuAttributes
  }) {
    const normAttrs = this.normalizeAttributes(skuAttributes);
    const attrString = normAttrs ? JSON.stringify(normAttrs) : '';
    const raw = [
      Number(supplierId),
      Number(supplierProductId),
      this.normalizeText(packagingType).toLowerCase(),
      Number(packSize).toFixed(2),
      this.normalizeUnit(packUnit).toLowerCase(),
      this.normalizeText(purchasingUnit || 'bag').toLowerCase(),
      attrString
    ].join('|');

    return crypto.createHash('sha256').update(raw).digest('hex');
  }
}

module.exports = new SpecificationService();
