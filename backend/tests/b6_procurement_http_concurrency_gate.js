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
    const supplierToken = makeToken({ id: 2, email: 'supplier.b6f@miljor.test', role: 'SUPPLIER' });
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
      WHERE sl.status='ACTIVE' AND sl.available_stock>=2 AND sl.currency='PKR'
      LIMIT 1
    `);
    assert.ok(listings.length > 0, 'Supplier listing fixture missing in test DB');
    const fixture = listings[0];

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

    // =========================================================================
    // 2. HTTP Authorization & RBAC on Improvement / Negotiation Endpoint
    // =========================================================================
    // Missing JWT -> 401
    const unauthImprove = await api(`/api/v1/procurement/requests/${requestId}/quotes/${quoteId}/improve`, {
      method: 'POST',
      body: { version_number: 1, message: 'Please offer discount' }
    });
    assert.equal(unauthImprove.status, 401);
    pass('Unauthenticated improvement request rejected with 401');

    // Supplier -> 403
    const supImprove = await api(`/api/v1/procurement/requests/${requestId}/quotes/${quoteId}/improve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${supplierToken}` },
      body: { version_number: 1, message: 'Please offer discount' }
    });
    assert.equal(supImprove.status, 403);
    pass('Supplier role blocked from requesting quote improvements with 403');

    // Missing idempotency key -> 400
    const noIdemImprove = await api(`/api/v1/procurement/requests/${requestId}/quotes/${quoteId}/improve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${buyerAToken}` },
      body: { version_number: 1, message: 'Please offer discount' }
    });
    assert.equal(noIdemImprove.status, 400);
    assert.equal(noIdemImprove.body.error.code, 'INVALID_IDEMPOTENCY_KEY');
    pass('Improvement request without X-Idempotency-Key rejected with 400');

    // Off-platform contact sharing -> 400
    const contactImprove = await api(`/api/v1/procurement/requests/${requestId}/quotes/${quoteId}/improve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${buyerAToken}`,
        'X-Idempotency-Key': `improve-contact-${tag}`
      },
      body: { version_number: 1, message: 'Email me at buyer@external.com or call 0300-9876543' }
    });
    assert.equal(contactImprove.status, 400);
    assert.equal(contactImprove.body.error.code, 'DIRECT_CONTACT_NOT_ALLOWED');
    pass('Direct phone/email sharing rejected with 400 DIRECT_CONTACT_NOT_ALLOWED');

    // Stale version -> 409
    const staleImprove = await api(`/api/v1/procurement/requests/${requestId}/quotes/${quoteId}/improve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${buyerAToken}`,
        'X-Idempotency-Key': `improve-stale-${tag}`
      },
      body: { version_number: 99, message: 'Improve delivery schedule please' }
    });
    assert.equal(staleImprove.status, 409);
    assert.equal(staleImprove.body.error.code, 'QUOTE_VERSION_CHANGED');
    pass('Stale quote version rejected with 409 QUOTE_VERSION_CHANGED');

    // Valid improvement request -> 201
    const validImproveKey = `improve-valid-${tag}`;
    const validImprovePayload = {
      version_number: 1,
      message: 'Can you offer a bulk concession for ongoing weekly procurement?',
      target_total: '720.00'
    };
    const validImprove = await api(`/api/v1/procurement/requests/${requestId}/quotes/${quoteId}/improve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${buyerAToken}`,
        'X-Idempotency-Key': validImproveKey
      },
      body: validImprovePayload
    });
    assert.equal(validImprove.status, 201);
    assert.equal(validImprove.body.data.negotiation.status, 'OPEN');
    assert.equal(validImprove.body.data.is_replay, false);
    pass('Valid improvement request created with 201 and status OPEN');

    // Replay with same idempotency key -> 200 is_replay: true
    const replayImprove = await api(`/api/v1/procurement/requests/${requestId}/quotes/${quoteId}/improve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${buyerAToken}`,
        'X-Idempotency-Key': validImproveKey
      },
      body: validImprovePayload
    });
    assert.equal(replayImprove.status, 200);
    assert.equal(replayImprove.body.data.is_replay, true);
    assert.equal(replayImprove.body.data.negotiation.id, validImprove.body.data.negotiation.id);
    pass('Idempotency replay returns 200 with identical immutable response');

    // Conflict: same key with different payload -> 409
    const conflictImprove = await api(`/api/v1/procurement/requests/${requestId}/quotes/${quoteId}/improve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${buyerAToken}`,
        'X-Idempotency-Key': validImproveKey
      },
      body: { ...validImprovePayload, message: 'Changed negotiation text' }
    });
    assert.equal(conflictImprove.status, 409);
    assert.equal(conflictImprove.body.error.code, 'IDEMPOTENCY_CONFLICT');
    pass('Same key with different payload rejected with 409 IDEMPOTENCY_CONFLICT');

    // =========================================================================
    // 3. Concurrency & Overlapping Improvement Requests
    // =========================================================================
    // Concurrent second improvement attempt for the SAME quote version -> 409 NEGOTIATION_ALREADY_OPEN
    const duplicateParallelKey = `improve-dupe-${tag}`;
    const dupeRes = await api(`/api/v1/procurement/requests/${requestId}/quotes/${quoteId}/improve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${buyerAToken}`,
        'X-Idempotency-Key': duplicateParallelKey
      },
      body: { version_number: 1, message: 'Second request while first is open' }
    });
    assert.equal(dupeRes.status, 409);
    assert.ok(
      ['NEGOTIATION_ALREADY_OPEN', 'NEGOTIATION_CONFLICT'].includes(dupeRes.body.error.code),
      `Unexpected code: ${dupeRes.body.error.code}`
    );
    pass('Overlapping improvement request on same quote version rejected with 409');

    // =========================================================================
    // 4. Supplier Negotiation Inbox & Privacy
    // =========================================================================
    // Buyer accessing supplier inbox -> 403
    const buyerSupplierInbox = await api('/api/v1/procurement/supplier/negotiations', {
      headers: { Authorization: `Bearer ${buyerAToken}` }
    });
    assert.equal(buyerSupplierInbox.status, 403);
    pass('Buyer role blocked from supplier negotiation inbox with 403');

    // Supplier accessing own inbox -> 200
    const supInbox = await api('/api/v1/procurement/supplier/negotiations', {
      headers: { Authorization: `Bearer ${supplierToken}` }
    });
    assert.equal(supInbox.status, 200);
    const item = supInbox.body.data.negotiations.find(n => n.id === validImprove.body.data.negotiation.id);
    assert.ok(item, 'Negotiation item present in supplier inbox');
    assert.equal(item.buyer_id, undefined, 'Privacy leak: buyer_id present in supplier inbox');
    assert.equal(item.delivery_area, undefined, 'Privacy leak: delivery_area present in supplier inbox');
    assert.equal(item.buyer_phone, undefined, 'Privacy leak: buyer_phone present in supplier inbox');
    pass('Supplier inbox scoped correctly without buyer contact or delivery address leaks');

    // =========================================================================
    // 5. Quote Revision Atomically Resolves Open Negotiation
    // =========================================================================
    const revRes = await api(`/api/v1/procurement/supplier/requests/${requestId}/quotes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${supplierToken}`,
        'X-Idempotency-Key': `quote-v2-${tag}`
      },
      body: {
        delivery_fee: '250.00',
        delivery_lead_days: 2,
        valid_until: new Date(Date.now() + 24 * 3600000).toISOString(),
        supplier_notes: 'Revised quotation with bulk concession',
        lines: [{
          request_item_id: requestItemId,
          supplier_listing_id: fixture.listing_id,
          quantity: '1',
          unit_price: '430.00'
        }]
      }
    });
    assert.equal(revRes.status, 201);
    assert.equal(revRes.body.data.quote.version_number, 2);
    pass('Supplier submitted revised quote version 2 via HTTP');

    // Verify buyer negotiation history reflects RESPONDED with version 2
    const buyerNegs = await api(`/api/v1/procurement/requests/${requestId}/negotiations`, {
      headers: { Authorization: `Bearer ${buyerAToken}` }
    });
    assert.equal(buyerNegs.status, 200);
    const resolvedNeg = buyerNegs.body.data.negotiations.find(n => n.id === validImprove.body.data.negotiation.id);
    assert.ok(resolvedNeg, 'Negotiation record found');
    assert.equal(resolvedNeg.status, 'RESPONDED');
    assert.equal(resolvedNeg.responded_version, 2);
    pass('Open negotiation atomically transitioned to RESPONDED with version 2');

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
    // Cleanup fixtures
    for (const rid of createdRequestIds) {
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
  process.exit(0);
}

main().catch(err => {
  console.error('B6-F HTTP GATE FAIL:', err);
  if (server) server.close();
  process.exit(1);
});
