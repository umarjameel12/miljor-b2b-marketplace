'use strict';
// Exact, side-effect-free buyer receipt quantity policy.
// A one-line quantity discrepancy records evidence only: never refunds,
// changes stock, or authorizes supplier settlement.
function invalid(code, message) {
  const e = new Error(message);
  e.code = code;
  e.statusCode = 422;
  return e;
}
function asHundredths(value, field) {
  if ((typeof value !== 'string' && typeof value !== 'number') ||
      !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(String(value))) {
    throw invalid('INVALID_DELIVERY_QUANTITY', field + ' must be a non-negative decimal with at most 2 places');
  }
  const [whole, fraction=''] = String(value).split('.');
  // Stay within the exact SQL DECIMAL range used for an order line.
  if (whole.length > 12) throw invalid('INVALID_DELIVERY_QUANTITY', field + ' exceeds supported precision');
  return BigInt(whole) * 100n + BigInt((fraction+'00').slice(0,2));
}
function display(value) {
  return (value/100n).toString()+'.'+(value%100n).toString().padStart(2,'0');
}
function calculateShortage(orderedQuantity, receivedQuantity) {
  const ordered = asHundredths(orderedQuantity, 'ordered_quantity');
  const received = asHundredths(receivedQuantity, 'received_quantity');
  if (ordered <= 0n) throw invalid('INVALID_ORDER_QUANTITY','Order must contain a positive quantity');
  if (received > ordered) throw invalid('RECEIVED_QUANTITY_EXCEEDS_ORDER','Received quantity cannot exceed ordered quantity');
  if (received === ordered) throw invalid('NO_QUANTITY_SHORTAGE','Received quantity equals ordered quantity; no shortage to report');
  return Object.freeze({
    ordered_quantity: display(ordered),
    received_quantity: display(received),
    short_quantity: display(ordered-received)
  });
}
module.exports = {calculateShortage};
