'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

process.env.NODE_ENV = 'test';
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_NAME = 'miljor_test_db';
process.env.TEST_DB_NAME = 'miljor_test_db';
process.env.TRANSACTIONAL_EMAIL_MODE = 'mock';
process.env.EMAIL_MODE = 'mock';
process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT = 'false';
process.env.B6_FINANCIAL_GATE_ENABLED = 'false';
process.env.B6_B5_INVENTORY_RECONCILED = 'false';
process.env.B6_TAX_POLICY_APPROVED = 'false';
process.env.SAFEPAY_ENV = 'sandbox';
if (!process.env.DB_PASSWORD) {
  const fs = require('node:fs');
  const origEnv = 'C:/Users/Umar Jameel/OneDrive - Higher Education Commission/Documents/MilJor Project/backend/.env';
  if (fs.existsSync(origEnv)) require('dotenv').config({ path: origEnv, quiet: true });
}
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  process.env.JWT_SECRET = 'miljor-test-jwt-secret-placeholder-32-chars-min';
}

const db = require('../src/config/db');
const app = require('../server');

test('Unified Smart Procurement Hub: canonical modes, legacy visibility, dedup, privacy, validation, and concurrent conversion on miljor_test_db', async () => {
  const [[dbRow]] = await db.query('SELECT DATABASE() AS db');
  assert.equal(dbRow.db, 'miljor_test_db');

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;

  const createdLegacyIds = [];
  const createdReqIds = [];
  const createdUserIds = [];

  try {
    const tag = crypto.randomBytes(6).toString('hex');
    const password = `UnifiedTest!${tag}`;
    const hash = await bcrypt.hash(password, 10);

    const createActor = async (role, idx) => {
      const email = `unified-${tag}-${idx}@miljor.test`;
      const [res] = await db.query(
        "INSERT INTO users(full_name,email,password_hash,role,is_verified,verification_status,buyer_trust_status,city,area,address) VALUES (?,?,?,?,1,'VERIFIED','CONTACT_VERIFIED','Lahore','Gulberg','Lahore Test Address')",
        [`Unified ${role} ${idx}`, email, hash, role]
      );
      createdUserIds.push(res.insertId);
      const login = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: email, password })
      });
      const json = await login.json();
      assert.equal(login.status, 200, JSON.stringify(json));
      return { id: res.insertId, token: json.data.token };
    };

    const buyer1 = await createActor('BUYER', 1);
    const buyer2 = await createActor('BUYER', 2);
    const supp1 = await createActor('SUPPLIER', 3);

    const api = async (token, method, endpoint, body, extraHeaders = {}) => {
      const res = await fetch(`${baseUrl}${endpoint}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...extraHeaders
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const json = await res.json();
      return { status: res.status, json };
    };

    const [[rice]] = await db.query(
      "SELECT id, category_id FROM catalog_product_families WHERE is_active = 1 AND approval_status = 'APPROVED' AND JSON_CONTAINS(allowed_purchasing_units, JSON_QUOTE('bag')) LIMIT 1"
    );
    assert.ok(rice);
    const futureQuote = new Date(Date.now() + 5 * 86400000).toISOString();
    const futureJoin = new Date(Date.now() + 3 * 86400000).toISOString();

    // 1-3. Canonical Solo, Collective, and Recurring drafts appear in GET /procurement/requests
    for (const [label, payload] of [
      ['SOLO', { ownership: 'SINGLE_BUYER', frequency: 'ONE_TIME', delivery_area: 'Gulberg, Lahore', quote_deadline: futureQuote, items: [{ family_id: rice.id, quantity: 3, unit: 'bag', requirements: 'Unified test solo' }] }],
      ['COLLECTIVE', { ownership: 'COLLECTIVE', frequency: 'ONE_TIME', delivery_area: 'Model Town, Lahore', quote_deadline: futureQuote, join_deadline: futureJoin, items: [{ family_id: rice.id, quantity: 5, unit: 'bag', requirements: 'Unified test collective' }] }],
      ['RECURRING', { ownership: 'SINGLE_BUYER', frequency: 'WEEKLY', delivery_area: 'DHA, Lahore', quote_deadline: futureQuote, items: [{ family_id: rice.id, quantity: 4, unit: 'bag', requirements: 'Unified test recurring' }] }]
    ]) {
      const r = await api(buyer1.token, 'POST', '/procurement/requests', payload, { 'X-Idempotency-Key': `uni-${label}-${crypto.randomUUID()}` });
      assert.equal(r.status, 201, JSON.stringify(r.json));
      createdReqIds.push(r.json.data.request.id);
    }

    // 4. Legacy demand request created via compatibility POST /demand-requests appears in hub for Buyer 1 ONLY
    const legacyCreate = await api(buyer1.token, 'POST', '/demand-requests', {
      category_id: rice.category_id,
      family_id: rice.id,
      commodity_name: 'Rice',
      desired_specs: 'Private legacy Super Kernel spec',
      target_quantity: 12,
      target_unit: 'bag',
      notes: 'Private buyer1 note must not leak publicly'
    });
    assert.equal(legacyCreate.status, 201, JSON.stringify(legacyCreate.json));
    const legacyId = legacyCreate.json.data.demand_request.id;
    createdLegacyIds.push(legacyId);

    const list1 = await api(buyer1.token, 'GET', '/procurement/requests');
    assert.equal(list1.status, 200);
    for (const reqId of createdReqIds) {
      assert.ok(list1.json.data.requests.some(r => Number(r.id) === Number(reqId)));
    }
    const foundLegacy = list1.json.data.legacy_requests.find(r => Number(r.id) === Number(legacyId));
    assert.ok(foundLegacy, 'Buyer 1 legacy demand request must appear inside Smart Hub');
    assert.equal(foundLegacy.already_converted, false);
    assert.equal(foundLegacy.is_legacy, true);

    // 5. Public GET /demand-requests preserves privacy (no buyer_id, notes, or desired_specs)
    const pubList = await api(null, 'GET', '/demand-requests');
    assert.equal(pubList.status, 200);
    const pubRow = pubList.json.data.demand_requests.find(r => r.request_code === foundLegacy.request_code);
    assert.ok(pubRow);
    assert.equal(pubRow.buyer_id, undefined);
    assert.equal(pubRow.notes, undefined);
    assert.equal(pubRow.desired_specs, undefined);

    // 6. Cross-buyer isolation & unauthorized role rejection
    const list2 = await api(buyer2.token, 'GET', '/procurement/requests');
    assert.equal(list2.status, 200);
    assert.equal(list2.json.data.legacy_requests.some(r => Number(r.id) === Number(legacyId)), false);

    const crossConvert = await api(buyer2.token, 'POST', `/procurement/legacy-requests/${legacyId}/convert`, {
      confirm_conversion: true, delivery_area: 'Lahore', quote_deadline: futureQuote
    }, { 'X-Idempotency-Key': `cross-${crypto.randomUUID()}` });
    assert.equal(crossConvert.status, 403);

    const suppConvert = await api(supp1.token, 'POST', `/procurement/legacy-requests/${legacyId}/convert`, {
      confirm_conversion: true, delivery_area: 'Lahore', quote_deadline: futureQuote
    }, { 'X-Idempotency-Key': `supp-${crypto.randomUUID()}` });
    assert.equal(suppConvert.status, 403);

    // 7. Missing required fields / confirmation fail closed (no fabricated defaults)
    const noConfirm = await api(buyer1.token, 'POST', `/procurement/legacy-requests/${legacyId}/convert`, {
      delivery_area: 'Lahore', quote_deadline: futureQuote
    }, { 'X-Idempotency-Key': `noconf-${crypto.randomUUID()}` });
    assert.equal(noConfirm.status, 422);

    const missingArea = await api(buyer1.token, 'POST', `/procurement/legacy-requests/${legacyId}/convert`, {
      confirm_conversion: true
    }, { 'X-Idempotency-Key': `noarea-${crypto.randomUUID()}` });
    assert.equal(missingArea.status, 422);
    assert.equal(missingArea.json.error.code, 'LEGACY_CONVERSION_VALIDATION_REQUIRED');

    // 8. Concurrent conversion idempotency -> exactly 1 canonical DRAFT created, never auto-published
    const convBody = {
      confirm_conversion: true,
      ownership: 'SINGLE_BUYER',
      frequency: 'ONE_TIME',
      delivery_area: 'Johar Town, Lahore',
      quote_deadline: futureQuote
    };
    const [c1, c2] = await Promise.all([
      api(buyer1.token, 'POST', `/procurement/legacy-requests/${legacyId}/convert`, convBody, { 'X-Idempotency-Key': `c1-${crypto.randomUUID()}` }),
      api(buyer1.token, 'POST', `/procurement/legacy-requests/${legacyId}/convert`, convBody, { 'X-Idempotency-Key': `c2-${crypto.randomUUID()}` })
    ]);
    assert.ok([200, 201].includes(c1.status) && [200, 201].includes(c2.status));
    assert.equal(c1.json.data.request.id, c2.json.data.request.id);
    assert.equal(c1.json.data.request.status, 'DRAFT');
    createdReqIds.push(c1.json.data.request.id);

    // 9. Deduplication check: legacy_requests now links converted_request_id without duplicating
    const listAfter = await api(buyer1.token, 'GET', '/procurement/requests');
    const convertedLegacy = listAfter.json.data.legacy_requests.find(r => Number(r.id) === Number(legacyId));
    assert.equal(convertedLegacy.already_converted, true);
    assert.equal(Number(convertedLegacy.converted_request_id), Number(c1.json.data.request.id));

    // 10. Protected DBs untouched
    const [[p1]] = await db.query('SELECT (SELECT COUNT(*) FROM miljor_db.orders) AS orders, (SELECT COUNT(*) FROM miljor_db.payments) AS payments');
    const [[p2]] = await db.query('SELECT (SELECT COUNT(*) FROM miljor_sandbox_db.orders) AS orders, (SELECT COUNT(*) FROM miljor_sandbox_db.payments) AS payments');
    assert.deepEqual(p1, { orders: 0, payments: 0 });
    assert.deepEqual(p2, { orders: 0, payments: 0 });
  } finally {
    for (const rid of createdReqIds) {
      await db.query('DELETE FROM procurement_request_items WHERE request_id = ?', [rid]).catch(() => {});
      await db.query('DELETE FROM procurement_requests WHERE id = ?', [rid]).catch(() => {});
    }
    for (const lid of createdLegacyIds) {
      await db.query('DELETE FROM demand_pool_requests WHERE id = ?', [lid]).catch(() => {});
    }
    for (const uid of createdUserIds) {
      await db.query('DELETE FROM auth_sessions WHERE user_id = ?', [uid]).catch(() => {});
      await db.query('DELETE FROM users WHERE id = ?', [uid]).catch(() => {});
    }
    await new Promise((resolve) => server.close(resolve));
    await db.end();
  }
});
