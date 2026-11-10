'use strict';

/**
 * B6 pure buyer-facing quote preview. No quote acceptance, stock reservation,
 * financial authority, provider verification or database writes happen here.
 * Price calculations use MilJor's authoritative exact decimal helper.
 * Every candidate line must explicitly match the buyer's item specification.
 */
const exact = require('./exactDecimal');

const fail = (code, message) => {
  const e = new Error(message);
  e.code = code;
  e.statusCode = 400;
  return e;
};
const cents = value => BigInt(exact.toCanonical(value, 2).replace('.', ''));
const positiveId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0
  && typeof value !== 'boolean' && value !== null && value !== undefined;
const amount = (raw, field) => {
  try {
    const value = exact.toCanonical(raw, 2);
    if (!exact.exactDecimalGte(value, '0.00', 2) || value.split('.')[0].length > 10) throw Error('range');
    return value;
  } catch {
    throw fail('INVALID_QUOTE_AMOUNT', field + ' must be an exact nonnegative PKR amount.');
  }
};
const quantity = raw => {
  try {
    const value = exact.toCanonical(raw, 4);
    if (!exact.exactDecimalGte(value, '0.0001', 4)) throw Error('range');
    return value;
  } catch {
    throw fail('INVALID_QUOTE_QUANTITY', 'Quantity must be a positive decimal with up to four places.');
  }
};
const serializedDeadline = raw => {
  if (typeof raw !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/i.test(raw)) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

function compareQuoteOptions({ items, quotes, now = new Date().toISOString(), maxSuppliers = 8 }) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 50
      || !Array.isArray(quotes) || quotes.length > 30) {
    throw fail('INVALID_COMPARISON_INPUT', 'Provide 1–50 requested items and at most 30 quotes.');
  }
  const current = serializedDeadline(now);
  if (current === null) throw fail('INVALID_COMPARISON_CLOCK', 'Use an explicit-offset UTC timestamp.');
  if (!Number.isInteger(maxSuppliers) || maxSuppliers < 1 || maxSuppliers > 8) {
    throw fail('INVALID_COMPARISON_LIMIT', 'Maximum supplier count must be 1 to 8.');
  }

  const requested = new Map();
  for (const item of items) {
    if (!positiveId(item?.id) || requested.has(String(item.id))) {
      throw fail('INVALID_REQUEST_ITEMS', 'Each requested item needs a unique positive identifier.');
    }
    const unit = typeof item.unit === 'string' ? item.unit.toLowerCase().trim() : '';
    if (!unit) throw fail('INVALID_REQUEST_UNIT', 'A purchasing unit is required.');
    requested.set(String(item.id), { quantity: quantity(item.quantity), unit });
  }

  const eligible = [];
  const excluded = [];
  for (const quote of quotes) {
    const quoteId = quote?.id;
    const supplierId = quote?.supplier_id;
    if (!positiveId(quoteId) || !positiveId(supplierId)) {
      throw fail('INVALID_QUOTE_IDENTITY', 'Quote and supplier IDs must be positive integers.');
    }
    const validity = serializedDeadline(quote.valid_until);
    if (quote.status !== 'SUBMITTED' || validity === null || validity <= current) {
      excluded.push({ quote_id: quoteId, reason: 'NOT_ACTIVE_OR_EXPIRED' });
      continue;
    }
    if (!Array.isArray(quote.lines) || !quote.lines.length) {
      excluded.push({ quote_id: quoteId, reason: 'NO_QUOTED_LINES' });
      continue;
    }
    const lines = new Map();
    let invalid = false;
    for (const line of quote.lines) {
      const id = String(line?.request_item_id);
      const req = requested.get(id);
      const matched = line?.specification_match === true;
      if (!req || lines.has(id) || !matched || String(line.unit || '').toLowerCase().trim() !== req.unit) {
        invalid = true;
        break;
      }
      // Buyer-facing quote covers the requested volume exactly. Split of a
      // single item across multiple suppliers is a separately gated feature.
      if (!exact.exactDecimalEquals(req.quantity, quantity(line.quantity), 4)) {
        invalid = true;
        break;
      }
      const unitPrice = amount(line.unit_price, 'unit_price');
      if (!exact.exactDecimalGte(unitPrice, '0.01', 2)) {
        invalid = true;
        break;
      }
      lines.set(id, {
        request_item_id: line.request_item_id,
        unit_price: unitPrice,
        subtotal: exact.exactMultiplyRound(req.quantity, unitPrice, 2),
        quantity: req.quantity,
        unit: req.unit
      });
    }
    if (invalid || !lines.size) {
      excluded.push({ quote_id: quoteId, reason: 'INCOMPATIBLE_OR_INVALID_LINES' });
      continue;
    }
    const deliveryFee = amount(quote.delivery_fee || '0', 'delivery_fee');
    const buyerFee = amount(quote.buyer_platform_fee || '0', 'buyer_platform_fee');
    eligible.push({ quote_id: quoteId, supplier_id: supplierId,
      lines, delivery_fee: deliveryFee, buyer_platform_fee: buyerFee });
  }

  const ranked = [];
  // Each quote is a supplier-level basket offer. Select at most one quote
  // from each supplier, and never count the same requested line twice.
  // Bound combinations by selecting at most eight eligible quotes to avoid
  // exponential CPU growth; when larger, return an explicit LIMIT result.
  if (eligible.length > 8) {
    return { options: [], excluded,
      blocked: 'TOO_MANY_QUOTES_FOR_EXACT_COMBINATION',
      eligible_quote_count: eligible.length };
  }
  for (let mask = 1; mask < (1 << eligible.length); mask++) {
    const selected = eligible.filter((_, index) => mask & (1 << index));
    if (selected.length > maxSuppliers) continue;
    const distinctSuppliers = new Set(selected.map(x => String(x.supplier_id)));
    if (distinctSuppliers.size !== selected.length) continue;
    const coverage = new Map();
    for (const quote of selected) {
      for (const [itemId, line] of quote.lines) {
        const previous = coverage.get(itemId);
        if (!previous || cents(line.subtotal) < cents(previous.line.subtotal) ||
            (cents(line.subtotal) === cents(previous.line.subtotal) &&
             Number(quote.quote_id) < Number(previous.quote.quote_id))) {
          coverage.set(itemId, { quote, line });
        }
      }
    }
    if (coverage.size !== requested.size) continue;
    // Do not charge a supplier's delivery fee if none of their lines won.
    const used = [...new Set([...coverage.values()].map(x => x.quote))];
    if (used.length !== selected.length) continue;
    const itemTotal = exact.exactDecimalSum([...coverage.values()].map(x => x.line.subtotal), 2);
    const deliveryTotal = exact.exactDecimalSum(used.map(x => x.delivery_fee), 2);
    const platformTotal = exact.exactDecimalSum(used.map(x => x.buyer_platform_fee), 2);
    const total = exact.exactDecimalSum([itemTotal, deliveryTotal, platformTotal], 2);
    ranked.push({
      quote_ids: used.map(x => x.quote_id),
      supplier_ids: used.map(x => x.supplier_id),
      lines: [...coverage.values()].map(x => ({
        ...x.line, quote_id: x.quote.quote_id, supplier_id: x.quote.supplier_id
      })),
      item_subtotal: itemTotal,
      delivery_fee_total: deliveryTotal,
      buyer_platform_fee_total: platformTotal,
      total_delivered_cost: total,
      supplier_count: used.length
    });
  }
  ranked.sort((a,b) => {
    const delta = cents(a.total_delivered_cost) - cents(b.total_delivered_cost);
    return delta < 0n ? -1 : delta > 0n ? 1 :
      a.supplier_count - b.supplier_count;
  });
  return { options: ranked.slice(0, 10), excluded,
    blocked: null, eligible_quote_count: eligible.length,
    warning: 'Quote preview only. Revalidate SKU, price, stock and delivery fees before award.' };
}
module.exports = { compareQuoteOptions };
