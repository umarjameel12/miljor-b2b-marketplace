'use strict';
const assert = require('node:assert/strict');
const { SupplierProcurementOpportunitiesService } = require('../src/services/supplierProcurementOpportunitiesService');

async function run() {
  const calls = [];
  const singles = [
    { invitation_id: 1, request_id: 11, request_code: 'RFQ-11', status: 'INVITED',
      quote_deadline: '2026-12-01T10:00:00Z', items: [{ family_id: 4, unit: 'kg', quantity: '100' }] },
    { invitation_id: 2, request_id: 12, request_code: 'RFQ-12', status: 'INTERESTED',
      quote_deadline: '2026-12-02T10:00:00Z', items: [{ family_id: 5, unit: 'kg', quantity: '50' }] }
  ];
  const groups = [
    { invitation_id: 7, group_id: 70, status: 'INVITED', quote_deadline: '2026-12-03T10:00:00Z',
      participant_count: 4, minimum_buyers: 3, delivery_area: 'Lahore',
      items: [{ family_id: 4, unit: 'kg', aggregate_quantity: '400' }] }
  ];
  const service = new SupplierProcurementOpportunitiesService(
    { inbox: async id => { calls.push(['single', id]); return singles; } },
    { supplierInbox: async id => { calls.push(['grouped', id]); return groups; } }
  );

  await assert.rejects(() => service.list({ id: 4, role: 'BUYER' }), e => e.code === 'FORBIDDEN');
  await assert.rejects(() => service.list({ id: 4, role: 'SUPPLIER' }, { type: 'flash' }), e => e.code === 'INVALID_FILTER');
  await assert.rejects(() => service.list({ id: 4, role: 'SUPPLIER' }, { page: 0 }), e => e.code === 'INVALID_PAGE');
  await assert.rejects(() => service.list({ id: 4, role: 'SUPPLIER' }, { limit: 51 }), e => e.code === 'INVALID_LIMIT');

  const first = await service.list({ id: 42, role: 'SUPPLIER' }, { type: 'all', page: 1, limit: 2 });
  assert.equal(first.items.length, 2);
  assert.deepEqual(first.counts, { all: 3, single: 2, grouped: 1 });
  assert.deepEqual(first.pagination, { page: 1, limit: 2, total: 3, pages: 2, has_more: true });
  assert.equal(first.no_payment_or_stock_change, true);
  assert.equal(first.items[0].type, 'single');
  assert.equal(first.items[0].action, 'RESPOND');

  const second = await service.list({ id: 42, role: 'SUPPLIER' }, { type: 'grouped', page: 1, limit: 20 });
  assert.equal(second.items.length, 1);
  assert.equal(second.items[0].participant_count, 4);
  assert.equal(second.items[0].items[0].aggregate_quantity, '400');

  const search = await service.list({ id: 42, role: 'SUPPLIER' }, { search: 'rfq-12' });
  assert.equal(search.items.length, 1);
  assert.equal(search.items[0].request_code, 'RFQ-12');

  assert.deepEqual(calls, [
    ['single', 42], ['grouped', 42],
    ['single', 42], ['grouped', 42],
    ['single', 42], ['grouped', 42]
  ]);
  console.log('PR61 Part 1 supplier opportunities service: 11 assertions PASS');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
