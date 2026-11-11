'use strict';

// B6 Smart Procurement Hub: pure request-input policy.
// Does NOT create orders, reserve inventory, accept quotes or touch databases.
// All quantities are exact decimal strings and must be checked again against
// the published supplier SKU purchasing-unit/increment when quotes are awarded.
const exact = require('./exactDecimal');

const OWNERSHIP = new Set(['SINGLE_BUYER', 'COLLECTIVE']);
const FREQUENCY = new Set(['ONE_TIME', 'WEEKLY', 'MONTHLY']);
const AWARD = new Set(['FULL_BASKET', 'SPLIT_ALLOWED']);
const PRIORITY = new Set(['LOWEST_DELIVERED_COST', 'FASTEST_DELIVERY', 'BEST_VALUE']);
const UNIT = new Set(['kg', 'g', 'l', 'ml', 'bag', 'tin', 'carton', 'sack', 'bundle', 'pack']);
const DISCRETE = new Set(['bag', 'tin', 'carton', 'sack', 'bundle', 'pack']);
const MAX_ITEMS = 50;
const err = (code, message) => {
  const e = new Error(message);
  e.code = code;
  e.statusCode = 400;
  return e;
};
const requiredEnum = (raw, allowed, field, defaultValue) => {
  const value = raw === undefined || raw === null || raw === '' ? defaultValue : raw;
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw err('INVALID_PROCUREMENT_MODE', `Invalid ${field}`);
  }
  return value;
};
const textField = (value, field, max, required = false) => {
  if (value === undefined || value === null) {
    if (required) throw err('PROCUREMENT_FIELD_REQUIRED', `${field} is required`);
    return null;
  }
  if (typeof value !== 'string') throw err('INVALID_PROCUREMENT_TEXT', `${field} must be text`);
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > max) {
    throw err('INVALID_PROCUREMENT_TEXT', `Invalid ${field}`);
  }
  return normalized || null;
};
const exactQuantity = (raw, unit) => {
  let value;
  try {
    value = exact.toCanonical(raw, 4);
    if (!exact.exactDecimalGte(value, '0.0001', 4)) throw new Error('nonpositive');
    if (value.split('.')[0].length > 8) throw new Error('excess');
    if (DISCRETE.has(unit) && !/^\d+\.0000$/.test(value)) throw new Error('fractional pack');
  } catch {
    throw err('INVALID_PROCUREMENT_QUANTITY', 'Enter a positive quantity with at most four decimals; packs must be whole.');
  }
  return value;
};
const deadline = raw => {
  if (typeof raw !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/i.test(raw)) {
    throw err('INVALID_PROCUREMENT_DEADLINE', 'Specify an ISO timestamp with explicit UTC offset.');
  }
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp) || timestamp <= Date.now() + 60000) {
    throw err('INVALID_PROCUREMENT_DEADLINE', 'Deadline must be more than one minute in the future.');
  }
  return new Date(timestamp).toISOString();
};

function normalizeRequestDraft(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw err('INVALID_PROCUREMENT_REQUEST', 'An object is required.');
  }
  const ownership = requiredEnum(payload.ownership, OWNERSHIP, 'ownership', 'SINGLE_BUYER');
  const frequency = requiredEnum(payload.frequency, FREQUENCY, 'frequency', 'ONE_TIME');
  const awardPolicy = requiredEnum(payload.award_policy, AWARD, 'award_policy', 'SPLIT_ALLOWED');
  const priority = requiredEnum(payload.priority, PRIORITY, 'priority', 'BEST_VALUE');
  if (!Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > MAX_ITEMS) {
    throw err('INVALID_PROCUREMENT_ITEMS', `Provide 1 to ${MAX_ITEMS} items.`);
  }
  const items = payload.items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw err('INVALID_PROCUREMENT_ITEM', `Item ${index + 1} must be an object.`);
    }
    const unit = typeof item.unit === 'string' ? item.unit.trim().toLowerCase() : '';
    if (!UNIT.has(unit)) throw err('INVALID_PROCUREMENT_UNIT', `Item ${index + 1} purchasing unit is invalid.`);
    const familyId = Number(item.family_id);
    if (!Number.isSafeInteger(familyId) || familyId <= 0 || typeof item.family_id === 'boolean') {
      throw err('INVALID_PROCUREMENT_FAMILY', `Item ${index + 1} requires a valid product family.`);
    }
    return {
      family_id: familyId,
      quantity: exactQuantity(item.quantity, unit),
      unit,
      requirements: textField(item.requirements, 'requirements', 2000),
      allow_substitutions: item.allow_substitutions === true,
    };
  });
  const quoteDeadline = payload.quote_deadline == null ? null : deadline(payload.quote_deadline);
  const joinDeadline = payload.join_deadline == null ? null : deadline(payload.join_deadline);
  if (ownership === 'SINGLE_BUYER' && joinDeadline) {
    throw err('INVALID_PROCUREMENT_JOIN', 'Only collective requests may have join deadlines.');
  }
  if (ownership === 'COLLECTIVE' && !joinDeadline) {
    throw err('PROCUREMENT_JOIN_DEADLINE_REQUIRED', 'Collective requests need a join deadline.');
  }
  if (quoteDeadline && joinDeadline && Date.parse(quoteDeadline) <= Date.parse(joinDeadline)) {
    throw err('INVALID_PROCUREMENT_DEADLINE', 'Quote deadline must follow the collective join deadline.');
  }
  return {
    ownership,
    frequency,
    award_policy: awardPolicy,
    priority,
    items,
    quote_deadline: quoteDeadline,
    join_deadline: joinDeadline,
    delivery_area: textField(payload.delivery_area, 'delivery_area', 255, true),
    notes: textField(payload.notes, 'notes', 2000),
    // IMPORTANT: recurring is opt-in only; contract and charges are never
    // created by this pure normalization function.
    recurring_requires_explicit_consent: frequency !== 'ONE_TIME',
    participant_payment_separation: ownership === 'COLLECTIVE',
  };
}

module.exports = { normalizeRequestDraft };
