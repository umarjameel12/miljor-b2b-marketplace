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
function asTenThousandths(value, field) {
  if ((typeof value !== 'string' && typeof value !== 'number') ||
      !/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(String(value))) {
    throw invalid('INVALID_DELIVERY_QUANTITY', field + ' must be a non-negative decimal with at most 4 places');
  }
  const [whole, fraction=''] = String(value).split('.');
  // MySQL order quantities are DECIMAL(12,4): at most 8 integer digits.
  if (whole.length > 8) throw invalid('INVALID_DELIVERY_QUANTITY', field + ' exceeds supported precision');
  return BigInt(whole) * 10000n + BigInt((fraction+'0000').slice(0,4));
}
function display(value) {
  const raw=(value%10000n).toString().padStart(4,'0');
  return (value/10000n).toString()+'.'+raw.replace(/0+$/,'').padEnd(2,'0');
}
function calculateShortage(orderedQuantity, receivedQuantity) {
  const ordered = asTenThousandths(orderedQuantity, 'ordered_quantity');
  const received = asTenThousandths(receivedQuantity, 'received_quantity');
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
