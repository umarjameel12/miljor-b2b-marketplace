// =============================================================================
// src/services/geographicService.js
// MilJor Special Phase G1: Lahore District Geospatial Intelligence & Clustering
// =============================================================================
const geoRepo = require('../repositories/geographicRepository');

/**
 * Authoritative GeoJSON Boundary Polygon for Lahore District, Punjab, Pakistan
 * Refined v1.1 Provisional Geometry aligned with OpenStreetMap Administrative Level 6 (Relation 399879).
 * Corrects corner clipping for verified in-district peripheral hubs (Manga Mandi & Wagah Border Town)
 * while strictly excluding neighboring district controls (Kasur, Sheikhupura, Muridke, Nankana Sahib).
 * Coordinates format: [longitude, latitude] in GeoJSON standard
 */
const LAHORE_DISTRICT_GEOJSON = {
  type: 'Feature',
  properties: {
    district: 'Lahore',
    province: 'Punjab',
    country: 'Pakistan',
    admin_level: 6,
    dataset_version: 'v1.1-provisional-refined',
    authority: 'OpenStreetMap Administrative Level 6 (Relation 399879 Reference) / Provisional',
    notes: 'Provisional boundary refined to encompass verified peripheral hubs (Manga Mandi, Wagah Border Town, Sundar Industrial Estate) while strictly excluding neighboring district controls.'
  },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [74.260, 31.670],
        [74.310, 31.685],
        [74.390, 31.675],
        [74.480, 31.620],
        [74.550, 31.600],
        [74.580, 31.580], // Wagah Border & GT Road East Corridor
        [74.550, 31.540],
        [74.540, 31.450],
        [74.490, 31.350],
        [74.380, 31.260],
        [74.240, 31.220],
        [74.150, 31.220],
        [74.050, 31.260], // Manga Mandi Southwest Agri Corridor
        [74.040, 31.310], // Manga Mandi Bypass Inclusion
        [74.080, 31.350],
        [74.140, 31.390],
        [74.190, 31.470],
        [74.230, 31.580],
        [74.240, 31.630],
        [74.260, 31.670]
      ]
    ]
  }
};

// Envelope Bounding Box: [minLat, maxLat, minLng, maxLng]
const LAHORE_BBOX = {
  minLat: 31.200,
  maxLat: 31.700,
  minLng: 74.030,
  maxLng: 74.590
};

// Known neighboring non-Lahore keywords for immediate rejection
const OUTSIDE_DISTRICT_KEYWORDS = [
  'kasur', 'kot radha kishan', 'pattoki', 'chunian', 'raja jang', 'kanganpur',
  'sheikhupura', 'muridke', 'ferozewala', 'sharqpur', 'khanqah dogran', 'safdarabad',
  'nankana sahib', 'okara', 'gujranwala', 'kamoke', 'faisalabad', 'sialkot',
  'rawalpindi', 'islamabad', 'karachi', 'multan', 'peshawar', 'quetta'
];

class GeographicService {
  /**
   * Return Lahore District authoritative boundary GeoJSON and bounding box
   */
  getLahoreDistrictBoundary() {
    return {
      district: 'Lahore',
      bbox: LAHORE_BBOX,
      geojson: LAHORE_DISTRICT_GEOJSON
    };
  }

  /**
   * Calculate great-circle distance between two coordinates using Haversine formula
   * @returns distance in kilometers
   */
  calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Number((R * c).toFixed(2));
  }

  /**
   * Ray-casting algorithm to test point containment inside a polygon
   * @param {[number, number]} point [latitude, longitude]
   * @param {Array<[number, number]>} vs polygon vertices [[lat, lng], ...]
   */
  isPointInPolygon(point, vs) {
    const x = point[0]; // latitude
    const y = point[1]; // longitude
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
      const xi = vs[i][0], yi = vs[i][1];
      const xj = vs[j][0], yj = vs[j][1];
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /**
   * Check if coordinate point is strictly inside Lahore District
   */
  isWithinLahoreDistrict(latitude, longitude) {
    const lat = Number(latitude);
    const lng = Number(longitude);

    if (isNaN(lat) || isNaN(lng)) {
      return false;
    }

    // Fast bounding box pre-filter
    if (lat < LAHORE_BBOX.minLat || lat > LAHORE_BBOX.maxLat ||
        lng < LAHORE_BBOX.minLng || lng > LAHORE_BBOX.maxLng) {
      return false;
    }

    // Convert GeoJSON coordinates [lng, lat] to [lat, lng] for ray-caster
    const polygonVertices = LAHORE_DISTRICT_GEOJSON.geometry.coordinates[0].map(c => [c[1], c[0]]);
    return this.isPointInPolygon([lat, lng], polygonVertices);
  }

  /**
   * List all active clusters with hub metadata
   */
  async listClusters(connection) {
    return geoRepo.getAllActiveClusters(connection);
  }

  /**
   * Get cluster detail with member localities
   */
  async getClusterDetail(clusterId, connection) {
    return geoRepo.getClusterById(clusterId, connection);
  }

  /**
   * Search localities
   */
  async searchLocalities(term, limit = 20, connection) {
    if (!term || typeof term !== 'string' || term.trim().length === 0) {
      return [];
    }
    return geoRepo.searchLocalities(term.trim(), limit, connection);
  }

  /**
   * Full containment validation for geographical coordinates
   */
  async validateContainment(latitude, longitude, connection) {
    const lat = Number(latitude);
    const lng = Number(longitude);

    if (isNaN(lat) || isNaN(lng)) {
      return {
        status: 'INVALID_COORDINATES',
        is_in_lahore: false,
        message: 'Provided latitude and longitude must be valid floating point numbers.'
      };
    }

    const inDistrict = this.isWithinLahoreDistrict(lat, lng);

    if (!inDistrict) {
      return {
        status: 'OUTSIDE_LAHORE',
        is_in_lahore: false,
        coordinates: { latitude: lat, longitude: lng },
        message: 'Coordinates fall outside the administrative boundaries of Lahore District, Punjab. MilJor service is strictly restricted to Lahore District.'
      };
    }

    // Inside district — find nearest cluster and check if within operational coverage
    const clusters = await geoRepo.getAllActiveClusters(connection);
    let nearestCluster = null;
    let minDistance = Infinity;

    for (const cluster of clusters) {
      const dist = this.calculateHaversineDistance(lat, lng, cluster.hub_latitude, cluster.hub_longitude);
      if (dist < minDistance) {
        minDistance = dist;
        nearestCluster = { ...cluster, distance_km: dist };
      }
    }

    // Find nearest verified locality
    const localities = await geoRepo.getAllSupportedLocalities(connection);
    let nearestLocality = null;
    let minLocDist = Infinity;

    for (const loc of localities) {
      if (loc.status === 'VERIFIED') {
        const dist = this.calculateHaversineDistance(lat, lng, loc.latitude, loc.longitude);
        if (dist < minLocDist) {
          minLocDist = dist;
          nearestLocality = { ...loc, distance_km: dist };
        }
      }
    }

    const isWithinOperationalCoverage = nearestCluster && minDistance <= nearestCluster.coverage_radius_km;

    if (isWithinOperationalCoverage) {
      return {
        status: 'IN_LAHORE_SUPPORTED',
        is_in_lahore: true,
        cluster: {
          id: nearestCluster.id,
          cluster_code: nearestCluster.cluster_code,
          name: nearestCluster.name,
          region_code: nearestCluster.region_code,
          hub_name: nearestCluster.hub_name,
          distance_to_hub_km: nearestCluster.distance_km,
          coverage_radius_km: nearestCluster.coverage_radius_km
        },
        nearest_locality: nearestLocality ? {
          locality_code: nearestLocality.locality_code,
          name_en: nearestLocality.name_en,
          name_ur: nearestLocality.name_ur,
          distance_km: nearestLocality.distance_km
        } : null,
        message: 'Location verified inside Lahore District and covered by active operational cluster.'
      };
    } else {
      return {
        status: 'IN_LAHORE_UNSUPPORTED',
        is_in_lahore: true,
        nearest_cluster: nearestCluster ? {
          cluster_code: nearestCluster.cluster_code,
          name: nearestCluster.name,
          distance_to_hub_km: nearestCluster.distance_km,
          coverage_radius_km: nearestCluster.coverage_radius_km
        } : null,
        message: 'Location is inside Lahore District boundaries, but beyond current active operational cluster radii.'
      };
    }
  }

  /**
   * Address resolution service for Lahore addresses
   */
  async resolveAddress(addressString, connection) {
    if (!addressString || typeof addressString !== 'string' || addressString.trim().length === 0) {
      return {
        status: 'INVALID_INPUT',
        is_resolved: false,
        message: 'Address string must be a non-empty text.'
      };
    }

    const cleanAddress = addressString.toLowerCase().trim();

    // 1. Immediate rejection for explicit out-of-district markers
    for (const kw of OUTSIDE_DISTRICT_KEYWORDS) {
      // Check word boundary or substring
      const regex = new RegExp(`(^|\\b|\\s|,)${kw}(\\b|\\s|,|$)`, 'i');
      if (regex.test(cleanAddress)) {
        return {
          status: 'OUTSIDE_LAHORE',
          is_resolved: false,
          matched_district_anomaly: kw,
          message: `Address contains '${kw}', which belongs outside Lahore District. MilJor operations are strictly confined to Lahore District.`
        };
      }
    }

    // 2. Search against localities in database
    const allLocalities = await geoRepo.getAllSupportedLocalities(connection);
    const matched = [];

    for (const loc of allLocalities) {
      let isMatch = false;
      const nameEn = loc.name_en.toLowerCase();
      const nameUr = loc.name_ur ? loc.name_ur.toLowerCase() : '';

      if (cleanAddress.includes(nameEn) || (nameUr && cleanAddress.includes(nameUr))) {
        isMatch = true;
      }

      // Check aliases JSON
      if (!isMatch && loc.aliases) {
        try {
          const aliases = Array.isArray(loc.aliases) ? loc.aliases : JSON.parse(loc.aliases);
          for (const alias of aliases) {
            if (cleanAddress.includes(alias.toLowerCase())) {
              isMatch = true;
              break;
            }
          }
        } catch {
          // Ignore parse errors
        }
      }

      if (isMatch) {
        matched.push(loc);
      }
    }

    // 3. Evaluate matching results
    if (matched.length === 1) {
      const loc = matched[0];
      if (loc.status === 'OUTSIDE_DISTRICT') {
        return {
          status: 'OUTSIDE_LAHORE',
          is_resolved: false,
          matched_locality: loc.name_en,
          message: `${loc.name_en} is situated outside Lahore District.`
        };
      }

      return {
        status: 'IN_LAHORE_SUPPORTED',
        is_resolved: true,
        locality: {
          locality_code: loc.locality_code,
          name_en: loc.name_en,
          name_ur: loc.name_ur,
          region_code: loc.region_code,
          postal_code: loc.postal_code,
          latitude: loc.latitude,
          longitude: loc.longitude
        },
        cluster: {
          cluster_code: loc.cluster_code,
          name: loc.cluster_name
        },
        confidence: 'HIGH'
      };
    } else if (matched.length > 1) {
      // Prioritize the longest/most specific match
      matched.sort((a, b) => b.name_en.length - a.name_en.length);
      const topMatch = matched[0];

      return {
        status: 'IN_LAHORE_SUPPORTED',
        is_resolved: true,
        locality: {
          locality_code: topMatch.locality_code,
          name_en: topMatch.name_en,
          name_ur: topMatch.name_ur,
          region_code: topMatch.region_code,
          postal_code: topMatch.postal_code,
          latitude: topMatch.latitude,
          longitude: topMatch.longitude
        },
        cluster: {
          cluster_code: topMatch.cluster_code,
          name: topMatch.cluster_name
        },
        candidate_alternatives: matched.slice(1, 4).map(m => m.name_en),
        confidence: 'MEDIUM'
      };
    } else {
      // No direct match found: check if "Lahore" is mentioned
      if (cleanAddress.includes('lahore')) {
        return {
          status: 'AMBIGUOUS',
          is_resolved: false,
          message: 'The address specifies Lahore, but no recognized verified locality or landmark could be resolved. Please specify standard locality (e.g. Gulberg, Johar Town, DHA, Model Town).',
          suggested_search: cleanAddress.split(',')[0].trim()
        };
      } else {
        return {
          status: 'OUTSIDE_LAHORE',
          is_resolved: false,
          message: 'Address does not match any recognized Lahore locality or district jurisdiction.'
        };
      }
    }
  }

  /**
   * Road routing distance & duration estimator
   * Incorporates Lahore physical obstacles (River Ravi, Canal, Railways)
   * and practical road curvature factor
   */
  async estimateRouting(origin, destination) {
    const oLat = Number(origin.latitude);
    const oLng = Number(origin.longitude);
    const dLat = Number(destination.latitude);
    const dLng = Number(destination.longitude);

    if (isNaN(oLat) || isNaN(oLng) || isNaN(dLat) || isNaN(dLng)) {
      throw new Error('Origin and destination must provide valid latitude and longitude numbers.');
    }

    const haversineDist = this.calculateHaversineDistance(oLat, oLng, dLat, dLng);

    // Physical barrier analysis
    const barriers = [];
    
    // Ravi River crossing (Shahdara / Ravi North vs Central / South Lahore)
    const originIsNorthRavi = oLat > 31.60 && oLng < 74.32;
    const destIsNorthRavi = dLat > 31.60 && dLng < 74.32;
    if (originIsNorthRavi !== destIsNorthRavi) {
      barriers.push({
        type: 'RIVER_CROSSING',
        name: 'River Ravi Bottleneck',
        impact: 'High traffic bottleneck at Sagian or Old Ravi Bridge. Add ~15-25 min buffer for commercial vehicles.'
      });
    }

    // Lahore Canal crossing (traverses NE to SW)
    // Approximate line from [31.57, 74.40] to [31.45, 74.25]
    const originCanalSide = (oLat - 31.45) * (74.40 - 74.25) - (oLng - 74.25) * (31.57 - 31.45);
    const destCanalSide = (dLat - 31.45) * (74.40 - 74.25) - (dLng - 74.25) * (31.57 - 31.45);
    if ((originCanalSide > 0 && destCanalSide < 0) || (originCanalSide < 0 && destCanalSide > 0)) {
      barriers.push({
        type: 'CANAL_CROSSING',
        name: 'Lahore Canal (Bambawali BRB feeder)',
        impact: 'Traversal across Canal Bank Road underpasses/bridges required.'
      });
    }

    // Lahore road curvature factor (typically 1.30 to 1.40 for city grid)
    const detourFactor = barriers.length > 0 ? 1.38 : 1.28;
    const estimatedRoadKm = Number((haversineDist * detourFactor).toFixed(2));

    // Commercial vehicle average speed in Lahore (28 km/h in urban streets, 50 km/h on Ring Road)
    const avgSpeedKmH = estimatedRoadKm > 15 ? 38 : 28;
    let estimatedMinutes = Math.round((estimatedRoadKm / avgSpeedKmH) * 60);
    if (barriers.length > 0) {
      estimatedMinutes += 12; // Extra buffer for bottlenecks
    }

    return {
      direct_haversine_km: haversineDist,
      estimated_road_distance_km: estimatedRoadKm,
      estimated_driving_minutes: estimatedMinutes,
      detour_factor: detourFactor,
      identified_barriers: barriers,
      routing_engine: 'MILJOR_LAHORE_ROAD_MODEL_V1',
      osrm_compatible: true
    };
  }
}

module.exports = new GeographicService();
