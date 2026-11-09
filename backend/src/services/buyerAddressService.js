// =============================================================================
// src/services/buyerAddressService.js
// MilJor Special Phase G2: Buyer Smart Location Lite Service
// =============================================================================
const buyerAddrRepo = require('../repositories/buyerAddressRepository');
const geoRepo = require('../repositories/geographicRepository');
const geoService = require('./geographicService');

class BuyerAddressService {
  /**
   * List saved addresses for a buyer
   */
  async getBuyerAddresses(userId, connection) {
    return buyerAddrRepo.getAddressesByUserId(userId, connection);
  }

  /**
   * Save a new delivery address with smart mismatch & boundary validation
   */
  async createBuyerAddress(userId, payload, connection) {
    const {
      city = 'Lahore',
      cluster_id,
      society_area,
      full_address,
      pin_latitude,
      pin_longitude,
      is_default = false
    } = payload;

    // 1. Fixed city validation: strictly Lahore
    if (!city || city.trim().toLowerCase() !== 'lahore') {
      const err = new Error('City must strictly be Lahore. Launch operations are confined to Lahore District.');
      err.code = 'INVALID_CITY';
      err.statusCode = 422;
      throw err;
    }

    // 2. Predefined cluster selection validation
    if (!cluster_id || isNaN(Number(cluster_id))) {
      const err = new Error('A valid predefined Lahore delivery cluster must be selected.');
      err.code = 'CLUSTER_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    const cluster = await geoRepo.getClusterById(Number(cluster_id), connection);
    if (!cluster || !cluster.is_active) {
      const err = new Error('Selected delivery cluster is inactive or does not exist.');
      err.code = 'INVALID_CLUSTER';
      err.statusCode = 422;
      throw err;
    }

    // 3. Free-text society / area validation
    if (!society_area || typeof society_area !== 'string' || society_area.trim().length === 0) {
      const err = new Error('Society / Area is required as free-text (e.g. Johar Town Block G1, DHA Phase 6).');
      err.code = 'SOCIETY_AREA_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    const cleanArea = society_area.trim();
    if (cleanArea.length > 255) {
      const err = new Error('Society / Area text cannot exceed 255 characters.');
      err.code = 'SOCIETY_AREA_TOO_LONG';
      err.statusCode = 400;
      throw err;
    }

    // 4. Free-text complete address validation
    if (!full_address || typeof full_address !== 'string' || full_address.trim().length === 0) {
      const err = new Error('Complete delivery address is required (shop/building, street, landmark).');
      err.code = 'FULL_ADDRESS_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    const cleanFullAddress = full_address.trim();

    // 5. Context-Aware Out-of-District Boundary Validation (DEFECT-G2-01 Fix)
    const OUTSIDE_DISTRICTS = ['kasur', 'kot radha kishan', 'pattoki', 'sheikhupura', 'muridke', 'ferozewala', 'nankana sahib', 'okara', 'gujranwala', 'chunian'];
    const ROAD_SUFFIX_REGEX = /\b(road|rd|highway|expressway|bypass)\b/i;
    const BIZ_SUFFIX_REGEX = /\b(traders|trading|store|stores|shop|sweets|foods|feed|mills|mill|enterprises|enterprise|corp|corporation)\b/i;

    function isRoadContext(text, kw) {
      const pattern = new RegExp(`(?:main\\s+)?${kw}\\s+${ROAD_SUFFIX_REGEX.source}|${ROAD_SUFFIX_REGEX.source}\\s+(?:of\\s+)?${kw}`, 'i');
      return pattern.test(text);
    }

    function isBusinessContext(text, kw) {
      const pattern = new RegExp(`(?:main\\s+)?${kw}\\s+${BIZ_SUFFIX_REGEX.source}|${BIZ_SUFFIX_REGEX.source}\\s+(?:of\\s+)?${kw}`, 'i');
      return pattern.test(text);
    }

    const cleanAreaLower = cleanArea.toLowerCase();
    const cleanFullAddressLower = cleanFullAddress.toLowerCase();

    // Check if society_area is an outright non-Lahore settlement without verified arterial road context
    for (const outKw of OUTSIDE_DISTRICTS) {
      const exactKwRegex = new RegExp(`(^|\\b|\\s|,)${outKw}(\\b|\\s|,|$)`, 'i');
      if (exactKwRegex.test(cleanAreaLower)) {
        if (!isRoadContext(cleanAreaLower, outKw)) {
          const err = new Error(`Location '${outKw}' belongs outside Lahore District. MilJor service is strictly restricted to Lahore District.`);
          err.code = 'OUTSIDE_LAHORE';
          err.statusCode = 422;
          throw err;
        }
      }

      // Check if full_address explicitly states the city/town is outside Lahore (e.g. "Kasur City", "Sheikhupura City")
      const outsideCityRegex = new RegExp(`\\b${outKw}\\s+(city|town|mandi|district)\\b|\\b(city|town|mandi)\\s+${outKw}\\b`, 'i');
      if (outsideCityRegex.test(cleanFullAddressLower) && !isRoadContext(cleanFullAddressLower, outKw) && !isBusinessContext(cleanFullAddressLower, outKw)) {
        const err = new Error(`Location '${outKw}' belongs outside Lahore District. MilJor service is strictly restricted to Lahore District.`);
        err.code = 'OUTSIDE_LAHORE';
        err.statusCode = 422;
        throw err;
      }
    }

    // 6. Smart Mismatch Detection & Structured Confidence Classification
    let geographicMatchStatus = 'PROVISIONAL';
    let manualReviewRequired = false;
    let mismatchDetails = null;

    const allLocalities = await geoRepo.getAllSupportedLocalities(connection);
    let matchedLocalityInOtherCluster = null;

    for (const loc of allLocalities) {
      if (loc.status === 'VERIFIED') {
        const nameEn = loc.name_en.toLowerCase();
        if (cleanAreaLower.includes(nameEn) || cleanFullAddressLower.includes(nameEn)) {
          if (loc.cluster_id && loc.cluster_id !== Number(cluster_id)) {
            matchedLocalityInOtherCluster = loc;
            break;
          } else if (loc.cluster_id === Number(cluster_id)) {
            geographicMatchStatus = 'VERIFIED';
          }
        }
      }
    }

    if (matchedLocalityInOtherCluster) {
      mismatchDetails = {
        mismatch_detected: true,
        selected_cluster: cluster.name,
        detected_locality: matchedLocalityInOtherCluster.name_en,
        suggested_cluster_code: matchedLocalityInOtherCluster.cluster_code,
        suggested_cluster_name: matchedLocalityInOtherCluster.cluster_name,
        message: `Your entered area '${matchedLocalityInOtherCluster.name_en}' normally belongs to cluster '${matchedLocalityInOtherCluster.cluster_name}'. Please verify your cluster selection.`
      };
      manualReviewRequired = true;
      geographicMatchStatus = 'AMBIGUOUS';
    } else {
      // Check if full_address mentions an outside district without verified arterial road context
      for (const outKw of OUTSIDE_DISTRICTS) {
        const exactKwRegex = new RegExp(`(^|\\b|\\s|,)${outKw}(\\b|\\s|,|$)`, 'i');
        if (exactKwRegex.test(cleanFullAddressLower) && !isRoadContext(cleanFullAddressLower, outKw) && !isBusinessContext(cleanFullAddressLower, outKw)) {
          // If the user selected a valid Lahore cluster and society is in Lahore,
          // flag address as AMBIGUOUS with review flag instead of hard-rejecting
          mismatchDetails = {
            mismatch_detected: true,
            warning_type: 'POTENTIAL_OUTSIDE_DISTRICT_REFERENCE',
            selected_cluster: cluster.name,
            referenced_district: outKw,
            message: `Address text references '${outKw}'. Manual confirmation required before binding delivery commitment.`
          };
          manualReviewRequired = true;
          geographicMatchStatus = 'AMBIGUOUS';
          break;
        }
      }
    }

    // 7. Optional Map Pin Validation
    let validPinLat = null;
    let validPinLng = null;

    if (pin_latitude !== undefined && pin_latitude !== null && pin_longitude !== undefined && pin_longitude !== null) {
      const lat = Number(pin_latitude);
      const lng = Number(pin_longitude);

      if (isNaN(lat) || isNaN(lng)) {
        const err = new Error('Optional map pin coordinates must be valid numeric floating point numbers.');
        err.code = 'INVALID_PIN_COORDINATES';
        err.statusCode = 400;
        throw err;
      }

      // Validate district containment
      const inDistrict = geoService.isWithinLahoreDistrict(lat, lng);
      if (!inDistrict) {
        const err = new Error('Placed map pin falls outside Lahore District boundaries.');
        err.code = 'PIN_OUTSIDE_LAHORE';
        err.statusCode = 422;
        throw err;
      }

      validPinLat = lat;
      validPinLng = lng;
    }

    // 8. Persist Address
    const addressId = await buyerAddrRepo.createAddress({
      user_id: userId,
      city: 'Lahore',
      cluster_id: Number(cluster_id),
      cluster_version: cluster.cluster_version || 1,
      society_area: cleanArea,
      full_address: cleanFullAddress,
      pin_latitude: validPinLat,
      pin_longitude: validPinLng,
      geographic_match_status: geographicMatchStatus,
      user_confirmation_status: 'CONFIRMED',
      business_verification_status: 'NOT_REQUIRED',
      manual_review_required: manualReviewRequired,
      is_default: Boolean(is_default)
    }, connection);

    const saved = await buyerAddrRepo.getAddressById(addressId, userId, connection);

    return {
      address: saved,
      mismatch: mismatchDetails
    };
  }

  /**
   * Update an existing address
   */
  async updateBuyerAddress(userId, addressId, updatePayload, connection) {
    const existing = await buyerAddrRepo.getAddressById(addressId, userId, connection);
    if (!existing) {
      const err = new Error('Address not found or unauthorized.');
      err.code = 'ADDRESS_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    // If cluster_id updated, verify cluster
    if (updatePayload.cluster_id) {
      const cluster = await geoRepo.getClusterById(Number(updatePayload.cluster_id), connection);
      if (!cluster || !cluster.is_active) {
        const err = new Error('Updated cluster is invalid or inactive.');
        err.code = 'INVALID_CLUSTER';
        err.statusCode = 422;
        throw err;
      }
      updatePayload.cluster_version = cluster.cluster_version || 1;
    }

    await buyerAddrRepo.updateAddress(addressId, userId, updatePayload, connection);
    return buyerAddrRepo.getAddressById(addressId, userId, connection);
  }

  /**
   * Delete an address
   */
  async deleteBuyerAddress(userId, addressId, connection) {
    const existing = await buyerAddrRepo.getAddressById(addressId, userId, connection);
    if (!existing) {
      const err = new Error('Address not found or unauthorized.');
      err.code = 'ADDRESS_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }
    return buyerAddrRepo.deleteAddress(addressId, userId, connection);
  }
}

module.exports = new BuyerAddressService();
