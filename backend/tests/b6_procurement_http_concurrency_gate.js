'use strict';
// =============================================================================
// B6-F Express HTTP Authorization, Concurrency & Security Gate
// Exercises real HTTP endpoints with JWTs: BUYER, SUPPLIER, ADMIN, outsider, missing auth
// Strictly scoped to miljor_test_db; clean tear-down of all test fixtures.
// =============================================================================
process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'miljor_test_db';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const app = require('../server');
const db = require('../src/config/db');

let server;
let baseUrl;
let count = 0;

function pass(msg) {
  count++;
  console.log(`PASS ${count}: ${msg}`);
}

function makeToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET || 'miljor_jwt_secret_dev_key_2026',
    { expiresIn: '1h', issuer: 'miljor-api', audience: 'miljor-app' }
  );
}

async function api(path, options = {}) {
  const method = options.method || 'GET';
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request(url, { method, headers }, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let body = {};
        try { body = raw ? JSON.parse(raw) : {}; } catch { body = { raw }; }
        resolve({ status: res.statusCode, body, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (options.body !== undefined) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function main() {
  const [[dbName]] = await db.query('SELECT DATABASE() AS d');
  assert.equal(dbName.d, 'miljor_test_db', 'PROTECTED DB ABORT: Execution refused.');
  pass('Test database identity verified');

  // Verify baseline financial counters
  const [[beforeOrders]] = await db.query('SELECT COUNT(*) AS c FROM orders');
  const [[beforePayments]] = await db.query('SELECT COUNT(*) AS c FROM payments');
  const [[beforeInvoices]] = await db.query('SELECT COUNT(*) AS c FROM invoices');

  server = await new Promise(resolve => {
    const s = app.listen(0, () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const createdRequestIds = [];

  try {
    // Verified Buyer A (owner), Buyer B (outsider), Verified Supplier, Admin
    const buyerAToken = makeToken({ id: 5, email: 'buyer.b6f.a@miljor.test', role: 'BUYER' });
    const buyerBToken = makeToken({ id: 6, email: 'buyer.b6f.b@miljor.test', role: 'BUYER' });
    const adminToken = makeToken({ id: 1, email: 'admin.b6f@miljor.test', role: 'ADMIN' });

    // Ensure fixture exists
    const [listings] = await db.query(`
      SELECT sl.id AS listing_id, sl.supplier_id, sk.family_id, sk.purchasing_unit, sl.delivery_zones
      FROM supplier_listings sl
      JOIN supplier_skus sk ON sk.id=sl.supplier_sku_id AND sk.status='PUBLISHED'
      JOIN supplier_products sp ON sp.id=sk.supplier_product_id AND sp.status='PUBLISHED'
      JOIN product_specifications ps ON ps.id=sl.product_spec_id AND ps.supplier_sku_id=sk.id
        AND ps.is_active=1 AND ps.approval_status='APPROVED' AND ps.lifecycle_status='PUBLISHED'
      JOIN users u ON u.id=sl.supplier_id AND u.role='SUPPLIER' AND u.is_verified=1 AND u.verification_status='VERIFIED'
      JOIN supplier_profiles sf ON sf.supplier_id=u.id AND sf.verification_status='VERIFIED'
      WHERE sl.supplier_id=2 AND sl.status='ACTIVE' AND sl.available_stock>=2 AND sl.currency='PKR'
      LIMIT 1
    `);
    assert.ok(listings.length > 0, 'Supplier listing fixture missing in test DB');
    const fixture = listings[0];
    const supplierToken = makeToken({ id: fixture.supplier_id, email: 'supplier.b6f@miljor.test', role: 'SUPPLIER' });

    // Create a request via API as Buyer A
    const tag = crypto.randomUUID().slice(0, 8);
    const createRes = await api('/api/v1/procurement/requests', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${buyerAToken}`,
        'X-Idempotency-Key': `create-req-${tag}`
      },
      body: {
        delivery_area: 'Johar Town, Lahore',
        quote_deadline: new Date(Date.now() + 48 * 3600000).toISOString(),
        items: [{
          family_id: fixture.family_id,
          quantity: '1',
          unit: String(fixture.purchasing_unit).toLowerCase(),
          requirements: 'High grade commercial supply'
        }]
      }
    });
    assert.equal(createRes.status, 201, JSON.stringify(createRes.body));
    const requestId = createRes.body.data.request.id;
    const requestItemId = createRes.body.data.request.items[0].id;
    createdRequestIds.push(requestId);
    pass('Buyer A created multi-item procurement request via HTTP');

    // Publish request
    const pubRes = await api(`/api/v1/procurement/requests/${requestId}/publish`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${buyerAToken}`,
        'X-Idempotency-Key': `pub-req-${tag}`
      },
      body: { version_number: 1 }
    });
    assert.equal(pubRes.status, 200, JSON.stringify(pubRes.body));
    pass('Buyer A published procurement request via HTTP');

    // Invite supplier
    const invRes = await api(`/api/v1/procurement/requests/${requestId}/invitations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${buyerAToken}`,
        'X-Idempotency-Key': `inv-${tag}`
      },
      body: { supplier_id: fixture.supplier_id }
    });
    assert.equal(invRes.status, 201);
    const invitationId = invRes.body.data.invitation.id;

    // Supplier accepts invitation
    const respRes = await api(`/api/v1/procurement/supplier/invitations/${invitationId}/respond`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${supplierToken}`,
        'X-Idempotency-Key': `resp-${tag}`
      },
      body: { decision: 'INTERESTED' }
    });
    assert.equal(respRes.status, 200);
    pass('Supplier received and accepted private invitation via HTTP');

    // Supplier submits initial quote v1
    const quoteRes = await api(`/api/v1/procurement/supplier/requests/${requestId}/quotes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${supplierToken}`,
        'X-Idempotency-Key': `quote-v1-${tag}`
      },
      body: {
        delivery_fee: '350.00',
        delivery_lead_days: 2,
        valid_until: new Date(Date.now() + 24 * 3600000).toISOString(),
        supplier_notes: 'Initial quotation',
        lines: [{
          request_item_id: requestItemId,
          supplier_listing_id: fixture.listing_id,
          quantity: '1',
          unit_price: '450.00'
        }]
      }
    });
    assert.equal(quoteRes.status, 201);
    const quoteId = quoteRes.body.data.quote.id || quoteRes.body.data.quote.quote_id;
    pass('Supplier submitted quote v1 via HTTP');

    // =========================================================================
    // 1. HTTP Authorization & RBAC on Comparison Endpoint
    // =========================================================================
    // Missing JWT -> 401
    const unauthCompare = await api(`/api/v1/procurement/requests/${requestId}/compare`);
    assert.equal(unauthCompare.status, 401);
    pass('Unauthenticated comparison request rejected with 401');

    // Supplier JWT -> 403 (strict BUYER)
    const supCompare = await api(`/api/v1/procurement/requests/${requestId}/compare`, {
      headers: { Authorization: `Bearer ${supplierToken}` }
    });
    assert.equal(supCompare.status, 403);
    pass('Supplier role blocked from buyer comparison with 403');

    // Admin JWT -> 403 (strict BUYER)
    const adminCompare = await api(`/api/v1/procurement/requests/${requestId}/compare`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(adminCompare.status, 403);
    pass('Admin role blocked from buyer comparison with 403 (strict BUYER RBAC)');

    // Buyer B (outsider) -> 404
    const outsiderCompare = await api(`/api/v1/procurement/requests/${requestId}/compare`, {
      headers: { Authorization: `Bearer ${buyerBToken}` }
    });
    assert.equal(outsiderCompare.status, 404);
    pass('Non-owning buyer blocked from private comparison with 404');

    // Owning Buyer A -> 200
    const ownerCompare = await api(`/api/v1/procurement/requests/${requestId}/compare`, {
      headers: { Authorization: `Bearer ${buyerAToken}` }
    });
    assert.equal(ownerCompare.status, 200);
    assert.equal(ownerCompare.body.data.recommendations.lowest_supplier_quoted_cost.total_delivered_cost, '800.00');
    assert.equal(ownerCompare.body.data.platform_fees_calculated, false);
    pass('Owning Buyer A successfully retrieves quote comparison and transparent rankings');

    // Numeric product counteroffers replace deprecated free-text improvement.
    const legacyPath = `/api/v1/procurement/requests/${requestId}/quotes/${quoteId}/improve`;
    const counterPath = `/api/v1/procurement/requests/${requestId}/quotes/${quoteId}/counteroffers`;
    const buyerHistoryPath = `/api/v1/procurement/requests/${requestId}/counteroffers`;
    const supplierInboxPath = '/api/v1/procurement/supplier/counteroffers';
    const payload = { version_number: 1, lines: [{ request_item_id: requestItemId, proposed_unit_price: '420.00' }] };
    const post = (path, token, key, body) => api(path, {
      method: 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(key ? { 'X-Idempotency-Key': key } : {}) },
      body
    });
    const expectError = (response, status, code) => {
      assert.equal(response.status, status, JSON.stringify(response.body));
      if (code) assert.equal(response.body.error.code, code);
    };
    const assertNoLegacy = async () => {
      const [[legacy]] = await db.query('SELECT COUNT(*) AS c FROM procurement_quote_negotiations WHERE request_id=?', [requestId]);
      assert.equal(legacy.c, 0, 'Legacy free-text negotiation was inserted');
    };
    expectError(await post(legacyPath, null, null, { version_number: 1, message: 'Please offer discount' }), 401);
    expectError(await post(legacyPath, supplierToken, null, { version_number: 1, message: 'Please offer discount' }), 403);
    for (const key of [null, `legacy-disabled-${tag}`]) {
      expectError(await post(legacyPath, buyerAToken, key,
        { version_number: 1, message: 'Please offer discount', target_total: '720.00' }),
      410, 'LEGACY_FREE_TEXT_NEGOTIATION_DISABLED');
    }
    await assertNoLegacy();
    pass('Legacy improve preserves authentication/RBAC and returns authenticated 410 without inserting negotiations');

    expectError(await post(counterPath, null, null, payload), 401);
    for (const token of [supplierToken, adminToken]) {
      expectError(await post(counterPath, token, `counter-rbac-${tag}`, payload), 403);
    }
    expectError(await post(counterPath, buyerBToken, `counter-outsider-${tag}`, payload), 404, 'REQUEST_NOT_FOUND');
    expectError(await post(counterPath, buyerAToken, null, payload), 400, 'INVALID_IDEMPOTENCY_KEY');
    pass('Numeric counteroffers enforce authentication, strict buyer RBAC, ownership and idempotency keys');

    // All free text is forbidden, including off-platform contact fields at either level.
    for (const body of [
      { ...payload, message: 'Email me at buyer@external.com or call 0300-9876543' },
      { ...payload, lines: [{ ...payload.lines[0], message: 'Call 0300-9876543' }] }
    ]) {
      expectError(await post(counterPath, buyerAToken, `counter-contact-${tag}`, body), 400, 'UNSUPPORTED_COUNTER_FIELD');
    }
    expectError(await post(counterPath, buyerAToken, `counter-invalid-${tag}`,
      { ...payload, lines: [{ request_item_id: requestItemId, proposed_unit_price: 'Please offer discount' }] }),
    400, 'INVALID_COUNTER_PRICE');
    expectError(await post(counterPath, buyerAToken, `counter-stale-${tag}`, { ...payload, version_number: 99 }), 409, 'QUOTE_STALE');
    const [[noOffers]] = await db.query('SELECT COUNT(*) AS c FROM procurement_product_counteroffers WHERE request_id=?', [requestId]);
    assert.equal(noOffers.c, 0, 'Rejected submissions inserted counteroffers');
    pass('Free text/contact sharing, nonnumeric prices and stale quote versions fail without inserting offers');

    // Real simultaneous submissions: exactly one row wins the per-product/version constraint.
    const raceKeys = [`counter-race-a-${tag}`, `counter-race-b-${tag}`];
    const submissions = await Promise.all(raceKeys.map(key => post(counterPath, buyerAToken, key, payload)));
    assert.deepEqual(submissions.map(r => r.status).sort(), [201, 409]);
    const winnerIndex = submissions.findIndex(r => r.status === 201);
    const created = submissions[winnerIndex];
    expectError(submissions[1 - winnerIndex], 409, 'COUNTEROFFER_CONFLICT');
    assert.equal(created.body.data.is_replay, false);
    assert.equal(created.body.data.counteroffers.length, 1);
    const offer = created.body.data.counteroffers[0];
    assert.equal(offer.decision, 'OPEN');
    assert.equal(offer.buyer_proposed_unit_price, '420.00');
    const [[oneOffer]] = await db.query('SELECT COUNT(*) AS c FROM procurement_product_counteroffers WHERE request_id=?', [requestId]);
    assert.equal(oneOffer.c, 1);
    pass('Concurrent numeric submissions create exactly one OPEN offer and reject the competing write');

    const replay = await post(counterPath, buyerAToken, raceKeys[winnerIndex], payload);
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.data.is_replay, true);
    assert.deepEqual(replay.body.data.counteroffers, created.body.data.counteroffers);
    expectError(await post(counterPath, buyerAToken, raceKeys[winnerIndex],
      { ...payload, lines: [{ request_item_id: requestItemId, proposed_unit_price: '410.00' }] }),
    409, 'IDEMPOTENCY_CONFLICT');
    expectError(await post(counterPath, buyerAToken, `counter-dupe-${tag}`, payload), 409, 'COUNTEROFFER_CONFLICT');
    pass('Replay preserves the immutable offer; changed payload and overlapping offers conflict');

    expectError(await api(supplierInboxPath, { headers: { Authorization: `Bearer ${buyerAToken}` } }), 403);
    expectError(await api(buyerHistoryPath, { headers: { Authorization: `Bearer ${buyerBToken}` } }), 404, 'REQUEST_NOT_FOUND');
    const inbox = await api(supplierInboxPath, { headers: { Authorization: `Bearer ${supplierToken}` } });
    assert.equal(inbox.status, 200);
    const item = inbox.body.data.counteroffers.find(n => n.id === offer.id);
    assert.ok(item, 'Own counteroffer missing from supplier inbox');
    for (const field of ['buyer_id', 'delivery_area', 'buyer_phone', 'buyer_email', 'buyer_name', 'delivery_address']) {
      assert.equal(Object.hasOwn(item, field), false, `Privacy leak: ${field}`);
    }
    // Use an existing different supplier; never create or alter shared user fixtures.
    const [otherSuppliers] = await db.query("SELECT id FROM users WHERE role='SUPPLIER' AND id<>? AND verification_status<>'BLOCKED' AND (buyer_trust_status IS NULL OR buyer_trust_status<>'SUSPENDED') LIMIT 1", [fixture.supplier_id]);
    assert.ok(otherSuppliers.length, 'Different supplier fixture required for ownership checks');
    const otherSupplierToken = makeToken({ id: otherSuppliers[0].id, email: 'outsider.b6f@miljor.test', role: 'SUPPLIER' });
    const otherInbox = await api(supplierInboxPath, { headers: { Authorization: `Bearer ${otherSupplierToken}` } });
    assert.equal(otherInbox.status, 200);
    assert.equal(otherInbox.body.data.counteroffers.some(n => n.id === offer.id), false);
    const responsePath = `/api/v1/procurement/supplier/counteroffers/${offer.id}/respond`;
    expectError(await post(responsePath, null, null, { decision: 'ACCEPT' }), 401);
    for (const token of [buyerAToken, adminToken]) {
      expectError(await post(responsePath, token, null, { decision: 'ACCEPT' }), 403);
    }
    expectError(await post(responsePath, otherSupplierToken, null, { decision: 'ACCEPT' }), 404, 'COUNTEROFFER_NOT_FOUND');
    expectError(await post(responsePath, supplierToken, null,
      { decision: 'ACCEPT', message: 'Email supplier@external.com' }), 400, 'UNSUPPORTED_COUNTER_FIELD');
    pass('Supplier inbox and response enforce role/owner isolation and hide buyer contact/address fields');

    // Deterministic expiry fixtures only touch this test's request and quote version.
    for (const kind of ['request', 'quote']) {
      const sql = kind === 'request'
        ? 'UPDATE procurement_requests SET quote_deadline=? WHERE id=?'
        : 'UPDATE procurement_quote_versions SET valid_until=? WHERE quote_id=? AND version_number=1';
      const id = kind === 'request' ? requestId : quoteId;
      const [[saved]] = await db.query(kind === 'request'
        ? 'SELECT quote_deadline AS deadline FROM procurement_requests WHERE id=?'
        : 'SELECT valid_until AS deadline FROM procurement_quote_versions WHERE quote_id=? AND version_number=1', [id]);
      await db.query(sql, [new Date(Date.now() - 3600000), id]);
      try {
        const code = kind === 'request' ? 'REQUEST_CLOSED' : 'QUOTE_EXPIRED';
        expectError(await post(counterPath, buyerAToken, `counter-expiry-${kind}-${tag}`, payload), 409, code);
        expectError(await post(responsePath, supplierToken, null, { decision: 'ACCEPT' }), 409, code);
        const [[unchanged]] = await db.query('SELECT decision FROM procurement_product_counteroffers WHERE id=?', [offer.id]);
        assert.equal(unchanged.decision, 'OPEN');
      } finally {
        await db.query(sql, [saved.deadline, id]);
      }
    }
    pass('Expired requests and quotes reject both buyer submissions and supplier responses without resolving offers');

    const decisions = await Promise.all(['ACCEPT', 'REJECT'].map(decision => post(responsePath, supplierToken, null, { decision })));
    assert.deepEqual(decisions.map(r => r.status).sort(), [200, 409]);
    const resolved = decisions.find(r => r.status === 200).body.data;
    expectError(decisions.find(r => r.status === 409), 409, 'COUNTEROFFER_ALREADY_DECIDED');
    assert.ok(['ACCEPT', 'REJECT'].includes(resolved.counteroffer.decision));
    assert.equal(resolved.requires_revised_quote, resolved.counteroffer.decision === 'ACCEPT');
    const history = await api(buyerHistoryPath, { headers: { Authorization: `Bearer ${buyerAToken}` } });
    assert.equal(history.status, 200);
    assert.equal(history.body.data.counteroffers.find(n => n.id === offer.id).decision, resolved.counteroffer.decision);
    const unchangedCompare = await api(`/api/v1/procurement/requests/${requestId}/compare`, { headers: { Authorization: `Bearer ${buyerAToken}` } });
    assert.equal(unchangedCompare.status, 200);
    assert.equal(unchangedCompare.body.data.recommendations.lowest_supplier_quoted_cost.total_delivered_cost, '800.00');
    pass('Concurrent supplier decisions resolve exactly once; nonbinding responses do not change quoted prices');

    // Supplier must publish a new immutable quote before comparison prices change.
    const revRes = await api(`/api/v1/procurement/supplier/requests/${requestId}/quotes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${supplierToken}`, 'X-Idempotency-Key': `quote-v2-${tag}` },
      body: {
        delivery_fee: '250.00', delivery_lead_days: 2,
        valid_until: new Date(Date.now() + 24 * 3600000).toISOString(),
        supplier_notes: 'Revised quotation with bulk concession',
        lines: [{ request_item_id: requestItemId, supplier_listing_id: fixture.listing_id, quantity: '1', unit_price: '430.00' }]
      }
    });
    assert.equal(revRes.status, 201, JSON.stringify(revRes.body));
    assert.equal(revRes.body.data.quote.version_number, 2);
    expectError(await post(counterPath, buyerAToken, `counter-old-version-${tag}`, payload), 409, 'QUOTE_STALE');
    await assertNoLegacy();
    pass('Supplier revision publishes version 2, invalidates old-version submissions and inserts no legacy negotiation');

    // Comparison reflects updated price
    const updatedCompare = await api(`/api/v1/procurement/requests/${requestId}/compare`, {
      headers: { Authorization: `Bearer ${buyerAToken}` }
    });
    assert.equal(updatedCompare.status, 200);
    assert.equal(updatedCompare.body.data.recommendations.lowest_supplier_quoted_cost.total_delivered_cost, '680.00');
    pass('Quote comparison dynamically reflects updated version 2 pricing (680.00 PKR)');

    // =========================================================================
    // 6. Zero Financial or Order Mutation Invariant Check
    // =========================================================================
    const [[afterOrders]] = await db.query('SELECT COUNT(*) AS c FROM orders');
    const [[afterPayments]] = await db.query('SELECT COUNT(*) AS c FROM payments');
    const [[afterInvoices]] = await db.query('SELECT COUNT(*) AS c FROM invoices');
    assert.equal(afterOrders.c, beforeOrders.c, 'Financial breach: orders created');
    assert.equal(afterPayments.c, beforePayments.c, 'Financial breach: payments created');
    assert.equal(afterInvoices.c, beforeInvoices.c, 'Financial breach: invoices created');
    pass('Zero orders, payments, or invoices created throughout entire negotiation lifecycle');

  } finally {
    // Cleanup only this run's request IDs; queued events must never outlive fixtures.
    for (const rid of createdRequestIds) {
      await db.query("DELETE FROM procurement_notifications WHERE JSON_UNQUOTE(JSON_EXTRACT(payload,'$.entityId'))=?", [String(rid)]);
      await db.query('DELETE FROM procurement_product_counteroffers WHERE request_id=?', [rid]);
      await db.query('DELETE FROM procurement_quote_negotiations WHERE request_id=?', [rid]);
      const [quotes] = await db.query('SELECT id FROM procurement_quotes WHERE request_id=?', [rid]);
      for (const q of quotes) {
        await db.query('DELETE FROM procurement_quote_lines WHERE quote_version_id IN (SELECT id FROM procurement_quote_versions WHERE quote_id=?)', [q.id]);
        await db.query('DELETE FROM procurement_quote_versions WHERE quote_id=?', [q.id]);
      }
      await db.query('DELETE FROM procurement_quotes WHERE request_id=?', [rid]);
      await db.query('DELETE FROM procurement_supplier_invitations WHERE request_id=?', [rid]);
      await db.query('DELETE FROM procurement_request_mutations WHERE request_id=?', [rid]);
      await db.query('DELETE FROM procurement_request_items WHERE request_id=?', [rid]);
      await db.query('DELETE FROM procurement_requests WHERE id=?', [rid]);
    }
    if (server) await new Promise(resolve => server.close(resolve));
  }

  console.log(`\n================================================================================`);
  console.log(`B6-F HTTP & CONCURRENCY GATE: ${count}/${count} PASSED (100% GREEN)`);
  console.log(`================================================================================\n`);

}

main().catch(err => {
  console.error('B6-F HTTP GATE FAIL:', err);
  if (server) server.close();
  process.exitCode = 1;
}).finally(async () => {
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  await db.end();
});
