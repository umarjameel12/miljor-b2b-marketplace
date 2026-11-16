'use strict';
// PR61 Part 1: Read-only aggregation over canonical single and collective invitations.
// No payment, stock reservation, quote acceptance, or buyer contact details.
const matching = require('./procurementMatchingService');
const collective = require('./procurementCollectiveBidService');

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
    if (!['all','single','grouped'].includes(type)) {
      throw Object.assign(new Error('Filter must be all, single or grouped'), { code: 'INVALID_FILTER', statusCode: 400 });
    }
    // All reads must be owner-scoped in their authoritative services.
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
    const items = [...singleRows, ...groupRows].filter(row=>type==='all'||row.type===type).sort((a,b) =>
      new Date(a.quote_deadline).getTime() - new Date(b.quote_deadline).getTime());
    return {
      items,
      counts: { all: singles.length + groups.length, single: singles.length, grouped: groups.length },
      // Existing canonical invitations only. Other statuses require separate history reads.
      scope: 'ACTIVE_INVITATIONS', no_payment_or_stock_change: true
    };
  }
}
module.exports = new SupplierProcurementOpportunitiesService();
module.exports.SupplierProcurementOpportunitiesService = SupplierProcurementOpportunitiesService;
