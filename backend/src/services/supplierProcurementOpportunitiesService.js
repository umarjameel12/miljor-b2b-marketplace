'use strict';
// PR61 Part 1: Read-only aggregation over canonical single and collective invitations.
// No payment, stock reservation, quote acceptance, or buyer contact details.
const matching = require('./procurementMatchingService');
const collective = require('./procurementCollectiveBidService');

const fail = (code, message) => Object.assign(new Error(message), { code, statusCode: 400 });
const cleanText = value => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100);

class SupplierProcurementOpportunitiesService {
  constructor(singleService = matching, groupedService = collective) {
    this.singleService = singleService;
    this.groupedService = groupedService;
  }
  async list(actor, filters = {}) {
    if (!actor || actor.role !== 'SUPPLIER') {
      throw Object.assign(new Error('Supplier access only'), { code: 'FORBIDDEN', statusCode: 403 });
    }
    const id = Number(actor.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw Object.assign(new Error('Invalid supplier identity'), { code: 'INVALID_SUPPLIER', statusCode: 400 });
    }
    const type = String(filters.type || 'all').toLowerCase();
    if (!['all','single','grouped'].includes(type)) throw fail('INVALID_FILTER', 'Filter must be all, single or grouped');
    const query = cleanText(filters.search).toLowerCase();
    const page = filters.page === undefined ? 1 : Number(filters.page);
    const limit = filters.limit === undefined ? 20 : Number(filters.limit);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw fail('INVALID_PAGE', 'Page must be a positive integer');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw fail('INVALID_LIMIT', 'Limit must be between 1 and 50');

    // Both canonical services enforce supplier ownership at the database query.
    const [singles, groups] = await Promise.all([
      this.singleService.inbox(id),
      this.groupedService.supplierInbox(id)
    ]);
    const singleRows = singles.map(i => ({
      type: 'single', key: 'single:' + i.invitation_id, invitation_id: i.invitation_id,
      request_id: i.request_id, status: i.status, request_code: i.request_code,
      quote_deadline: i.quote_deadline, invited_at: i.invited_at, items: i.items || [],
      eligible_offers: i.eligible_offers || [], action: i.status === 'INVITED' ? 'RESPOND' : 'VIEW'
    }));
    const groupRows = groups.map(i => ({
      type: 'grouped', key: 'grouped:' + i.invitation_id, invitation_id: i.invitation_id,
      group_id: i.group_id, status: i.status, join_deadline: i.join_deadline,
      quote_deadline: i.quote_deadline, minimum_buyers: i.minimum_buyers,
      delivery_area: i.delivery_area, participant_count: i.participant_count,
      items: i.items || [], action: 'BID'
    }));
    const matches = row => {
      if (type !== 'all' && row.type !== type) return false;
      if (!query) return true;
      const searchable = [row.request_code, row.request_id, row.group_id, row.status,
        row.delivery_area, ...(row.items || []).flatMap(item =>
          [item.family_id, item.unit, item.requirements, item.aggregate_quantity, item.quantity])]
        .join(' ').toLowerCase();
      return searchable.includes(query);
    };
    const filtered = [...singleRows, ...groupRows].filter(matches).sort((a,b) => {
      const left = Date.parse(a.quote_deadline || '') || Number.MAX_SAFE_INTEGER;
      const right = Date.parse(b.quote_deadline || '') || Number.MAX_SAFE_INTEGER;
      return left - right || String(a.key).localeCompare(String(b.key));
    });
    const total = filtered.length;
    const start = (page - 1) * limit;
    return {
      items: filtered.slice(start, start + limit),
      counts: { all: singles.length + groups.length, single: singles.length, grouped: groups.length },
      pagination: { page, limit, total, pages: Math.ceil(total / limit), has_more: start + limit < total },
      filters: { type, search: query },
      // These are active invitations only; history/closed states are not fabricated.
      scope: 'ACTIVE_INVITATIONS', no_payment_or_stock_change: true
    };
  }
}
module.exports = new SupplierProcurementOpportunitiesService();
module.exports.SupplierProcurementOpportunitiesService = SupplierProcurementOpportunitiesService;
