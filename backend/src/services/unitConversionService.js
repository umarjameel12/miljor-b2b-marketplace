// =============================================================================
// src/services/unitConversionService.js
// MilJor Packaging & Unit Conversion Service
// Enforces strict physical dimension integrity (Mass vs Volume separation)
// =============================================================================

class UnitConversionService {
  constructor() {
    this.MASS_UNITS = new Set(['kg', 'g', 'gram', 'kilogram', 'ton']);
    this.VOLUME_UNITS = new Set(['l', 'litre', 'liter', 'ml', 'millilitre', 'milliliter']);
    this.DISCRETE_PACKAGING_UNITS = new Set(['bag', 'tin', 'carton', 'box', 'piece', 'can', 'pack']);
  }

  // Normalize unit strings to canonical form
  normalizeUnit(unit) {
    if (!unit || typeof unit !== 'string') return '';
    const u = unit.trim().toLowerCase();
    if (['kg', 'kilogram'].includes(u)) return 'kg';
    if (['g', 'gram'].includes(u)) return 'g';
    if (['l', 'litre', 'liter'].includes(u)) return 'L';
    if (['ml', 'millilitre', 'milliliter'].includes(u)) return 'mL';
    if (['bag', 'bags'].includes(u)) return 'bag';
    if (['tin', 'tins'].includes(u)) return 'tin';
    if (['carton', 'cartons'].includes(u)) return 'carton';
    if (['piece', 'pieces', 'pc'].includes(u)) return 'piece';
    if (['can', 'cans'].includes(u)) return 'can';
    return u;
  }

  isMassUnit(unit) {
    return this.MASS_UNITS.has(this.normalizeUnit(unit).toLowerCase());
  }

  isVolumeUnit(unit) {
    return this.VOLUME_UNITS.has(this.normalizeUnit(unit).toLowerCase());
  }

  isDiscreteUnit(unit) {
    const normalized = this.normalizeUnit(unit).toLowerCase();
    if (this.DISCRETE_PACKAGING_UNITS.has(normalized)) return true;
    // B4-G: Suppliers may name physical purchasing packs (e.g. bundle, drum,
    // sack). Any valid non-mass/non-volume purchasing unit is indivisible.
    return Boolean(normalized && /^[a-z][a-z0-9_-]{0,29}$/.test(normalized) &&
      !this.isMassUnit(normalized) && !this.isVolumeUnit(normalized));
  }

  // Check if two units are physically dimensionally compatible
  areUnitsCompatible(fromUnit, toUnit) {
    const from = this.normalizeUnit(fromUnit);
    const to = this.normalizeUnit(toUnit);

    if (from === to) return true;

    const fromMass = this.isMassUnit(from);
    const toMass = this.isMassUnit(to);
    if (fromMass && toMass) return true;

    const fromVol = this.isVolumeUnit(from);
    const toVol = this.isVolumeUnit(to);
    if (fromVol && toVol) return true;

    return false;
  }

  // Convert quantity between compatible units
  convertQuantity(quantity, fromUnit, toUnit, spec = null) {
    const qty = Number(quantity);
    if (isNaN(qty) || qty <= 0) {
      throw new Error('Quantity must be a positive number');
    }

    const from = this.normalizeUnit(fromUnit);
    const to = this.normalizeUnit(toUnit);

    if (from === to) return qty;

    // Strict validation: NEVER allow converting Mass (kg/g) directly to Volume (L/mL) without physical density
    if ((this.isMassUnit(from) && this.isVolumeUnit(to)) || (this.isVolumeUnit(from) && this.isMassUnit(to))) {
      throw new Error(`Incompatible unit dimensions: Cannot convert between mass (${from}) and volume (${to}). 16L is not 16kg.`);
    }

    // Mass conversion
    if (this.isMassUnit(from) && this.isMassUnit(to)) {
      if (from === 'kg' && to === 'g') return qty * 1000;
      if (from === 'g' && to === 'kg') return qty / 1000;
    }

    // Volume conversion
    if (this.isVolumeUnit(from) && this.isVolumeUnit(to)) {
      if (from === 'L' && to === 'mL') return qty * 1000;
      if (from === 'mL' && to === 'L') return qty / 1000;
    }

    // Discrete packaging conversion using specification pack_size
    if (spec && spec.pack_size && spec.pack_unit) {
      const packSize = Number(spec.pack_size);
      const packUnit = this.normalizeUnit(spec.pack_unit);

      // From packs (e.g., bags/tins) to base units (e.g. kg, L)
      const skuPurchasingUnit = this.normalizeUnit(spec.purchasing_unit);
      const matchesPurchasing = (unit) => skuPurchasingUnit === unit ||
        (this.DISCRETE_PACKAGING_UNITS.has(unit.toLowerCase()) && !skuPurchasingUnit);
      if (this.isDiscreteUnit(from) && matchesPurchasing(from) && to === packUnit) {
        return qty * packSize;
      }

      // From base units to packs; do not accept any arbitrary unrelated unit.
      if (from === packUnit && this.isDiscreteUnit(to) && matchesPurchasing(to)) {
        return qty / packSize;
      }
    }

    throw new Error(`Unsupported conversion from '${fromUnit}' to '${toUnit}'`);
  }

  // Validate price and quantity inputs for sanity
  validateQuantityAndPrice(quantity, price) {
    const q = Number(quantity);
    const p = Number(price);

    if (isNaN(q) || q <= 0) {
      return { valid: false, code: 'INVALID_QUANTITY', message: 'Quantity must be a strictly positive number' };
    }
    if (isNaN(p) || p <= 0) {
      return { valid: false, code: 'INVALID_PRICE', message: 'Price must be a strictly positive number greater than zero' };
    }
    return { valid: true };
  }
}

module.exports = new UnitConversionService();
