'use strict';

/**
 * B6 pure buyer-facing quote preview. No quote acceptance, stock reservation,
 * financial authority, provider verification or database writes happen here.
 * Price calculations use MilJor's authoritative exact decimal helper.
 * Every candidate line must explicitly match the buyer's item specification.
 */
const exact = require('./exactDecimal');
const db = require('../config/db');

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
    requested.set(String(item.id), {
      quantity: quantity(item.quantity),unit,
      requirements:typeof item.requirements==='string'?item.requirements:null,
      allow_substitutions:item.allow_substitutions===true || item.allow_substitutions===1
    });
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
      try {
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
          unit: req.unit,
          supplier_sku_snapshot: line.supplier_sku_snapshot || null,
          buyer_requirements: req.requirements,
          buyer_allows_substitutions: req.allow_substitutions
        });
      } catch {
        invalid = true;
        break;
      }
    }
    if (invalid || !lines.size) {
      excluded.push({ quote_id: quoteId, reason: 'INCOMPATIBLE_OR_INVALID_LINES' });
      continue;
    }
    const deliveryFee = amount(quote.delivery_fee || '0', 'delivery_fee');
    const buyerFee = amount(quote.buyer_platform_fee || '0', 'buyer_platform_fee');
    eligible.push({ quote_id: quoteId, supplier_id: supplierId,
      lines, delivery_fee: deliveryFee, buyer_platform_fee: buyerFee,
      delivery_lead_days: Number.isSafeInteger(quote.delivery_lead_days) && quote.delivery_lead_days >= 0 ? quote.delivery_lead_days : 90 });
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
      supplier_count: used.length,
      estimated_delivery_days: Math.max(...used.map(x => x.delivery_lead_days)),
      supplier_quote_total_only: true,
      requires_specification_review: true
    });
  }
  ranked.sort((a,b) => {
    const delta = cents(a.total_delivered_cost) - cents(b.total_delivered_cost);
    return delta < 0n ? -1 : delta > 0n ? 1 :
      a.supplier_count - b.supplier_count;
  });
  return { options: ranked.slice(0, 10), excluded,
    blocked: null, eligible_quote_count: eligible.length,
    warning: 'Supplier-quoted delivered cost only: platform fees and taxes are NOT included. Verify grade, substitution, stock, delivery and checkout total at buyer award.' };
}

// B6-F read-only, tenant-scoped server comparison. The existing pure comparison
// above is the sole combinatorial engine; no duplicate pricing engine.
const cleanId = value => {
  const id=Number(value);
  if(!Number.isSafeInteger(id)||id<1||typeof value==='boolean'||value==null)
    throw fail('INVALID_REQUEST_ID','Request identifier must be a positive integer.');
  return id;
};
const sqlUtc = value => {
  if(value instanceof Date) return Number.isFinite(value.getTime())?value.toISOString():null;
  if(typeof value!=='string')return null;
  const raw=value.trim();
  if(/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?$/.test(raw))
    return raw.replace(' ','T')+'Z';
  return /(?:Z|[+-]\d\d:\d\d)$/i.test(raw)?raw:null;
};

async function compareForBuyer(buyerId,requestId,database=db) {
  const buyer=cleanId(buyerId),rid=cleanId(requestId);
  const [owned]=await database.query(
    'SELECT id,status,quote_deadline FROM procurement_requests WHERE id=? AND buyer_id=?',[rid,buyer]
  );
  if(!owned.length){
    const e=fail('REQUEST_NOT_FOUND','Request not found.');e.statusCode=404;throw e;
  }
  const [items]=await database.query(
    'SELECT id,family_id,quantity,unit,requirements,allow_substitutions FROM procurement_request_items WHERE request_id=? ORDER BY line_number',[rid]
  );
  const [rows]=await database.query(
    `SELECT q.id AS quote_id,q.supplier_id,q.status,q.current_version,
       v.valid_until,v.delivery_fee,v.delivery_lead_days,v.immutable_snapshot
     FROM procurement_quotes q JOIN procurement_quote_versions v
       ON v.quote_id=q.id AND v.version_number=q.current_version
     JOIN users u ON u.id=q.supplier_id AND u.role='SUPPLIER'
       AND u.is_verified=1 AND u.verification_status='VERIFIED'
     JOIN supplier_profiles sp ON sp.supplier_id=q.supplier_id
       AND sp.verification_status='VERIFIED'
     WHERE q.request_id=? ORDER BY q.id`,[rid]
  );
  const quotes=rows.map(q=>{
    const snapshot=typeof q.immutable_snapshot==='string'
      ?JSON.parse(q.immutable_snapshot):q.immutable_snapshot;
    const lines=(snapshot.lines||[]).map(line=>{
      const requested=items.find(item=>Number(item.id)===Number(line.request_item_id));
      const actualUnit=String(line.snapshot?.purchasing_unit||'').toLowerCase();
      return {
        request_item_id:line.request_item_id,quantity:line.quantity,
        unit:actualUnit,unit_price:line.unit_price,
        supplier_sku_snapshot:line.snapshot,
        // Mechanical matching ONLY. Free-text buyer brand/grade/requirements
        // are never silently treated as physically equivalent.
        specification_match:Boolean(requested &&
          Number(requested.family_id)===Number(line.snapshot?.family_id||requested.family_id) &&
          String(requested.unit).toLowerCase()===actualUnit)
      };
    });
    return {id:q.quote_id,supplier_id:q.supplier_id,
      status:q.status==='ACTIVE'?'SUBMITTED':'WITHDRAWN',
      valid_until:sqlUtc(q.valid_until),
      delivery_fee:q.delivery_fee, buyer_platform_fee:'0.00',
      delivery_lead_days:Number(q.delivery_lead_days), lines};
  });
  const result=compareQuoteOptions({items,quotes});
  const fastest=[...result.options].sort((a,b)=>
    a.estimated_delivery_days-b.estimated_delivery_days ||
    (cents(a.total_delivered_cost)<cents(b.total_delivered_cost)?-1:
      cents(a.total_delivered_cost)>cents(b.total_delivered_cost)?1:0));
  const bestValue=[...result.options].sort((a,b)=>
    a.supplier_count-b.supplier_count ||
    (cents(a.total_delivered_cost)<cents(b.total_delivered_cost)?-1:
      cents(a.total_delivered_cost)>cents(b.total_delivered_cost)?1:
      a.estimated_delivery_days-b.estimated_delivery_days));
  return {
    request_id:rid,
    coverage_status:result.blocked||null,
    excluded:result.excluded,
    eligible_quote_count:result.eligible_quote_count,
    options:result.options,
    recommendations:{
      lowest_supplier_quoted_cost:result.options[0]||null,
      fastest_supplier_estimated_delivery:fastest[0]||null,
      best_value_transparent_rule:bestValue[0]||null
    },
    best_value_rule:'Prefer fewer supplier deliveries; then lower supplier-quoted landed cost; then shorter declared lead time. Not a supplier quality rating.',
    platform_fees_calculated:false,
    physical_specifications_require_buyer_review:true,
    warning:result.warning||'Quote combinations capped to eight eligible quotes; refine selections before awarding.'
  };
}

module.exports = { compareQuoteOptions, compareForBuyer };
