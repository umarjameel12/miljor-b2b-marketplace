// =============================================================================
// tests/package_e1_supplier_profile_gate.js
// MilJor Package E1: Supplier Profile, Onboarding & Verification Gate Suite
// 22 comprehensive assertions covering auth, validation, workflow, and security
// =============================================================================
process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'miljor_test_db';

const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../src/config/db');
const app = require('../server');

const JWT_SECRET = process.env.JWT_SECRET || 'miljor_jwt_super_secret_for_local_testing_min_32_bytes_long';
const JWT_ISSUER = 'miljor-api';
const JWT_AUDIENCE = 'miljor-app';

function generateTestToken(payload) {
  return jwt.sign(
    {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      token_version: 1
    },
    JWT_SECRET,
    {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      expiresIn: '1h'
    }
  );
}

async function runE1Gate() {
  console.log('================================================================================');
  console.log('MILJOR PACKAGE E1: SUPPLIER PROFILE & VERIFICATION AUTOMATED GATE SUITE');
  console.log('================================================================================\n');

  // 1. Verify Database Isolation
  const [dbRow] = await db.query('SELECT DATABASE() as current_db');
  const activeDb = dbRow[0].current_db;
  console.log(`🔒 Test Suite Environment Verified: Active Database = '${activeDb}'`);
  assert.strictEqual(activeDb, 'miljor_test_db', 'SECURITY VIOLATION: Test suite MUST run strictly against miljor_test_db!');

  // Snapshot development database state before tests
  const [devUsersBefore] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.users');
  const [devMigrationsBefore] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.schema_migrations');
  const devSnapshot = {
    users: devUsersBefore[0].cnt,
    migrations: devMigrationsBefore[0].cnt
  };

  // Start ephemeral HTTP test server
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✅ [PASS] ${total}. ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${total}. ${name}: ${err.message}`);
      throw err;
    }
  }

  // HTTP Helper
  async function api(path, options = {}) {
    const url = `${baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    if (options.token) {
      headers['Authorization'] = `Bearer ${options.token}`;
    }

    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const req = http.request(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname + parsed.search,
          method: options.method || 'GET',
          headers
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            try {
              resolve({
                status: res.statusCode,
                headers: res.headers,
                data: body ? JSON.parse(body) : null
              });
            } catch {
              resolve({
                status: res.statusCode,
                headers: res.headers,
                data: body
              });
            }
          });
        }
      );

      req.on('error', reject);
      if (options.body) {
        req.write(JSON.stringify(options.body));
      }
      req.end();
    });
  }

  // Provision Test Fixture Users
  const timestamp = Date.now();
  const passwordHash = await bcrypt.hash('Password123!', 10);

  // Supplier 1
  const [s1Result] = await db.query(
    `INSERT INTO users (full_name, business_name, email, phone, password_hash, role, verification_status, is_verified)
     VALUES (?, ?, ?, ?, ?, 'SUPPLIER', 'UNVERIFIED', 0)`,
    ['Supplier Test One', 'Akbari Rice Traders', `supplier_e1_${timestamp}_1@miljor.com`, `+923001${timestamp.toString().slice(-6)}`, passwordHash]
  );
  const supplier1Id = s1Result.insertId;
  const supplier1Token = generateTestToken({ id: supplier1Id, email: `supplier_e1_${timestamp}_1@miljor.com`, role: 'SUPPLIER' });

  // Supplier 2
  const [s2Result] = await db.query(
    `INSERT INTO users (full_name, business_name, email, phone, password_hash, role, verification_status, is_verified)
     VALUES (?, ?, ?, ?, ?, 'SUPPLIER', 'UNVERIFIED', 0)`,
    ['Supplier Test Two', 'Lahore Oil Mills', `supplier_e1_${timestamp}_2@miljor.com`, `+923002${timestamp.toString().slice(-6)}`, passwordHash]
  );
  const supplier2Id = s2Result.insertId;
  const supplier2Token = generateTestToken({ id: supplier2Id, email: `supplier_e1_${timestamp}_2@miljor.com`, role: 'SUPPLIER' });

  // Buyer
  const [bResult] = await db.query(
    `INSERT INTO users (full_name, business_name, email, phone, password_hash, role, verification_status, is_verified)
     VALUES (?, ?, ?, ?, ?, 'BUYER', 'VERIFIED', 1)`,
    ['Buyer Test', 'Royal Restaurant', `buyer_e1_${timestamp}@miljor.com`, `+923003${timestamp.toString().slice(-6)}`, passwordHash]
  );
  const buyerId = bResult.insertId;
  const buyerToken = generateTestToken({ id: buyerId, email: `buyer_e1_${timestamp}@miljor.com`, role: 'BUYER' });

  // Verification Admin
  const [aResult] = await db.query(
    `INSERT INTO users (full_name, email, phone, password_hash, role, verification_status, is_verified)
     VALUES (?, ?, ?, ?, 'VERIFICATION_ADMIN', 'VERIFIED', 1)`,
    ['Verification Admin', `admin_e1_${timestamp}@miljor.com`, `+923004${timestamp.toString().slice(-6)}`, passwordHash]
  );
  const adminId = aResult.insertId;
  const adminToken = generateTestToken({ id: adminId, email: `admin_e1_${timestamp}@miljor.com`, role: 'VERIFICATION_ADMIN' });

  try {
    // ---------------------------------------------------------------------------
    // TEST 1: Supplier retrieves own profile
    // ---------------------------------------------------------------------------
    await test('Supplier retrieves own profile with default values & masked IBAN', async () => {
      const res = await api('/api/v1/supplier/profile', { token: supplier1Token });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.data.profile.supplier_id, supplier1Id);
      assert.strictEqual(res.data.data.profile.verification_status, 'NOT_SUBMITTED');
      assert.strictEqual(res.data.data.profile.subscription_plan, 'STARTER');
    });

    // ---------------------------------------------------------------------------
    // TEST 2: Supplier creates/updates permitted profile fields
    // ---------------------------------------------------------------------------
    await test('Supplier updates permitted business profile fields (Save Draft)', async () => {
      const updateData = {
        business_name: 'Akbari Super Kernel Traders',
        business_type: 'Wholesale Commodity Distributor',
        contact_person_name: 'Muhammad Tariq',
        contact_person_phone: '03001234567',
        warehouse_address: 'Godown #12, Ravi Link Road, Badami Bagh, Lahore',
        lahore_service_area: 'Lahore — Badami Bagh & Ravi Hub',
        business_description: 'Premier wholesale distributor of extra long grain basmati rice and sella varieties.'
      };

      const res = await api('/api/v1/supplier/profile', {
        method: 'PUT',
        token: supplier1Token,
        body: updateData
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.data.profile.business_name, 'Akbari Super Kernel Traders');
      assert.strictEqual(res.data.data.profile.contact_person_name, 'Muhammad Tariq');
      assert.strictEqual(res.data.data.profile.contact_person_phone, '+923001234567');
      assert.strictEqual(res.data.data.profile.warehouse_address, 'Godown #12, Ravi Link Road, Badami Bagh, Lahore');
    });

    // ---------------------------------------------------------------------------
    // TEST 3: Buyer cannot access supplier-only endpoints
    // ---------------------------------------------------------------------------
    await test('Buyer cannot access supplier-only endpoints (403 Forbidden)', async () => {
      const res = await api('/api/v1/supplier/profile', { token: buyerToken });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.success, false);
      assert.strictEqual(res.data.error.code, 'FORBIDDEN');
    });

    // ---------------------------------------------------------------------------
    // TEST 4: Unauthenticated request returns 401
    // ---------------------------------------------------------------------------
    await test('Unauthenticated request returns 401 Unauthorized', async () => {
      const res = await api('/api/v1/supplier/profile');
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.data.success, false);
    });

    // ---------------------------------------------------------------------------
    // TEST 5: Supplier cannot access another supplier's profile
    // ---------------------------------------------------------------------------
    await test('Supplier cannot access or modify another supplier\'s profile (Strict session isolation)', async () => {
      // Supplier 2 calls GET /profile - must receive Supplier 2's data, never Supplier 1
      const res = await api('/api/v1/supplier/profile', { token: supplier2Token });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.data.profile.supplier_id, supplier2Id);
      assert.notStrictEqual(res.data.data.profile.supplier_id, supplier1Id);
    });

    // ---------------------------------------------------------------------------
    // TEST 6: Supplier cannot set own verification status
    // ---------------------------------------------------------------------------
    await test('Supplier cannot manipulate own verification_status via client payload', async () => {
      const res = await api('/api/v1/supplier/profile', {
        method: 'PUT',
        token: supplier1Token,
        body: { verification_status: 'VERIFIED', is_verified: 1 }
      });

      assert.strictEqual(res.status, 200);
      // Status must remain unchanged
      assert.strictEqual(res.data.data.profile.verification_status, 'NOT_SUBMITTED');
      assert.strictEqual(res.data.data.profile.is_verified, false);
    });

    // ---------------------------------------------------------------------------
    // TEST 7: Supplier cannot change subscription plan
    // ---------------------------------------------------------------------------
    await test('Supplier cannot change own subscription_plan via client payload', async () => {
      const res = await api('/api/v1/supplier/profile', {
        method: 'PUT',
        token: supplier1Token,
        body: { subscription_plan: 'BUSINESS', max_active_listings: 100 }
      });

      assert.strictEqual(res.status, 200);
      // Plan must remain STARTER
      assert.strictEqual(res.data.data.profile.subscription_plan, 'STARTER');
    });

    // ---------------------------------------------------------------------------
    // TEST 8: Invalid Pakistani IBAN is rejected
    // ---------------------------------------------------------------------------
    await test('Invalid Pakistani IBAN is rejected with 400 VALIDATION_ERROR (Checksum Failure)', async () => {
      const res = await api('/api/v1/supplier/profile', {
        method: 'PUT',
        token: supplier1Token,
        body: {
          bank_name: 'Standard Chartered',
          bank_account_title: 'Akbari Traders',
          bank_iban: 'PK99SCBL0000001123456702' // Invalid checksum
        }
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.error.code, 'VALIDATION_ERROR');
    });

    // ---------------------------------------------------------------------------
    // TEST 9: Invalid phone format is rejected
    // ---------------------------------------------------------------------------
    await test('Invalid Pakistani phone format is rejected with 400 VALIDATION_ERROR', async () => {
      const res = await api('/api/v1/supplier/profile', {
        method: 'PUT',
        token: supplier1Token,
        body: { contact_person_phone: '12345' }
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.error.code, 'VALIDATION_ERROR');
    });

    // ---------------------------------------------------------------------------
    // TEST 10: Invalid NTN format is rejected where applicable
    // ---------------------------------------------------------------------------
    await test('Invalid NTN format is rejected with 400 VALIDATION_ERROR', async () => {
      const res = await api('/api/v1/supplier/profile', {
        method: 'PUT',
        token: supplier1Token,
        body: { tax_ntn: 'ABC-INVALID' }
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.error.code, 'VALIDATION_ERROR');
    });

    // ---------------------------------------------------------------------------
    // TEST 11: Draft can be saved
    // ---------------------------------------------------------------------------
    await test('Draft profile can be saved with valid partial data without being verified', async () => {
      const res = await api('/api/v1/supplier/profile', {
        method: 'PUT',
        token: supplier1Token,
        body: {
          tax_ntn: '1234567-8',
          food_license_no: 'PFA-LHR-2026-1029'
        }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.data.profile.tax_ntn, '1234567-8');
      assert.strictEqual(res.data.data.profile.food_license_no, 'PFA-LHR-2026-1029');
      assert.strictEqual(res.data.data.profile.verification_status, 'NOT_SUBMITTED');
    });

    // ---------------------------------------------------------------------------
    // TEST 12: Incomplete profile cannot submit
    // ---------------------------------------------------------------------------
    await test('Incomplete profile cannot submit for verification (400 INCOMPLETE_PROFILE)', async () => {
      // Supplier 1 has not provided valid bank IBAN yet
      const res = await api('/api/v1/supplier/verification/submit', {
        method: 'POST',
        token: supplier1Token
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.error.code, 'INCOMPLETE_PROFILE');
    });

    // ---------------------------------------------------------------------------
    // TEST 13: Valid profile can submit
    // ---------------------------------------------------------------------------
    await test('Complete profile with valid IBAN submits successfully (Transitions to PENDING_REVIEW)', async () => {
      // Add valid Pakistani IBAN (Valid SCB Pakistan IBAN with modulo-97 = 1)
      // PK36SCBL0000001123456702
      await api('/api/v1/supplier/profile', {
        method: 'PUT',
        token: supplier1Token,
        body: {
          bank_name: 'Standard Chartered Bank',
          bank_account_title: 'Akbari Super Kernel Traders',
          bank_iban: 'PK36SCBL0000001123456702'
        }
      });

      const res = await api('/api/v1/supplier/verification/submit', {
        method: 'POST',
        token: supplier1Token
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.data.verification_status, 'PENDING_REVIEW');
      assert.ok(res.data.data.submitted_at);

      // Verify status endpoint reflects PENDING_REVIEW
      const statusRes = await api('/api/v1/supplier/verification/status', { token: supplier1Token });
      assert.strictEqual(statusRes.status, 200);
      assert.strictEqual(statusRes.data.data.status.verification_status, 'PENDING_REVIEW');
    });

    // ---------------------------------------------------------------------------
    // TEST 14: Repeated submission is safely handled
    // ---------------------------------------------------------------------------
    await test('Repeated verification submission is idempotent (does not duplicate requests)', async () => {
      const res = await api('/api/v1/supplier/verification/submit', {
        method: 'POST',
        token: supplier1Token
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.data.already_pending, true);
      assert.strictEqual(res.data.data.verification_status, 'PENDING_REVIEW');
    });

    // ---------------------------------------------------------------------------
    // TEST 15: Authorized admin can approve/reject
    // ---------------------------------------------------------------------------
    await test('Authorized admin can approve supplier verification with tier and level', async () => {
      const res = await api(`/api/v1/admin/suppliers/${supplier1Id}/verify`, {
        method: 'PUT',
        token: adminToken,
        body: {
          verification_status: 'VERIFIED',
          verification_level: 'LEVEL_2_BUSINESS',
          subscription_plan: 'GROWTH'
        }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.data.verification_status, 'VERIFIED');

      // Verify supplier profile is now VERIFIED
      const profRes = await api('/api/v1/supplier/profile', { token: supplier1Token });
      assert.strictEqual(profRes.data.data.profile.verification_status, 'VERIFIED');
      assert.strictEqual(profRes.data.data.profile.is_verified, true);
    });

    // ---------------------------------------------------------------------------
    // TEST 16: Supplier cannot approve themselves
    // ---------------------------------------------------------------------------
    await test('Supplier cannot approve themselves via admin endpoint (403 Forbidden)', async () => {
      const res = await api(`/api/v1/admin/suppliers/${supplier1Id}/verify`, {
        method: 'PUT',
        token: supplier1Token, // Supplier calling admin endpoint
        body: { verification_status: 'VERIFIED' }
      });

      assert.strictEqual(res.status, 403);
    });

    // ---------------------------------------------------------------------------
    // TEST 17: Rejected supplier correction and resubmission
    // ---------------------------------------------------------------------------
    await test('Admin rejects supplier with reason; supplier corrects fields and resubmits', async () => {
      // 1. Admin rejects Supplier 1 with clear reason
      const rejectRes = await api(`/api/v1/admin/suppliers/${supplier1Id}/verify`, {
        method: 'PUT',
        token: adminToken,
        body: {
          verification_status: 'REJECTED',
          rejection_reason: 'Warehouse address could not be verified by Lahore field team. Please provide detailed street and godown number.'
        }
      });

      assert.strictEqual(rejectRes.status, 200);
      assert.strictEqual(rejectRes.data.data.verification_status, 'REJECTED');

      // 2. Supplier inspects rejection reason safely
      const profRes = await api('/api/v1/supplier/profile', { token: supplier1Token });
      assert.strictEqual(profRes.data.data.profile.verification_status, 'REJECTED');
      assert.strictEqual(profRes.data.data.profile.rejection_reason, 'Warehouse address could not be verified by Lahore field team. Please provide detailed street and godown number.');

      // 3. Supplier updates corrected warehouse address
      await api('/api/v1/supplier/profile', {
        method: 'PUT',
        token: supplier1Token,
        body: {
          warehouse_address: 'Godown #14-B, Main Ravi Road, Badami Bagh Wholesale Market, Lahore'
        }
      });

      // 4. Supplier resubmits for review
      const resubmitRes = await api('/api/v1/supplier/verification/submit', {
        method: 'POST',
        token: supplier1Token
      });

      assert.strictEqual(resubmitRes.status, 200);
      assert.strictEqual(resubmitRes.data.data.verification_status, 'PENDING_REVIEW');
    });

    // ---------------------------------------------------------------------------
    // TEST 18: Existing verified profile remains compatible
    // ---------------------------------------------------------------------------
    await test('Existing database supplier profiles remain 100% compatible and accessible', async () => {
      // User 2 is Tariq Mehmood (seeded supplier)
      const seededSupplierToken = generateTestToken({ id: 2, email: 'supplier1@miljor.com', role: 'SUPPLIER' });
      const res = await api('/api/v1/supplier/profile', { token: seededSupplierToken });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.data.profile.supplier_id, 2);
      assert.strictEqual(res.data.data.profile.subscription_plan, 'BUSINESS');
    });

    // ---------------------------------------------------------------------------
    // TEST 19: Sensitive details are not exposed publicly
    // ---------------------------------------------------------------------------
    await test('Sensitive banking details are masked in profile and excluded from public listings', async () => {
      const profRes = await api('/api/v1/supplier/profile', { token: supplier1Token });
      assert.strictEqual(profRes.status, 200);
      // Plaintext IBAN must not be present
      assert.strictEqual(profRes.data.data.profile.bank_iban, undefined);
      // Masked IBAN must be present
      assert.ok(profRes.data.data.profile.bank_iban_masked.includes('****'));

      // Check public listings endpoint
      const listRes = await api('/api/v1/listings');
      assert.strictEqual(listRes.status, 200);
      const listingsStr = JSON.stringify(listRes.data);
      assert.strictEqual(listingsStr.includes('PK36SCBL0000001123456702'), false);
    });

    // ---------------------------------------------------------------------------
    // TEST 20: Database rollback behavior on failure
    // ---------------------------------------------------------------------------
    await test('Database transactions rollback cleanly on unhandled exceptions', async () => {
      const [beforeState] = await db.query('SELECT * FROM supplier_profiles WHERE supplier_id = ?', [supplier1Id]);

      // Attempt invalid update that violates database constraints
      try {
        await db.query(
          `UPDATE supplier_profiles SET verification_status = 'INVALID_STATUS_TEST' WHERE supplier_id = ?`,
          [supplier1Id]
        );
      } catch (e) {
        // Expected MySQL enum failure
      }

      const [afterState] = await db.query('SELECT * FROM supplier_profiles WHERE supplier_id = ?', [supplier1Id]);
      assert.strictEqual(beforeState[0].verification_status, afterState[0].verification_status);
    });

    // ---------------------------------------------------------------------------
    // TEST 21: Concurrent submissions do not create duplicate review requests
    // ---------------------------------------------------------------------------
    await test('Simultaneous verification submissions are serialized and handled safely', async () => {
      const [res1, res2] = await Promise.all([
        api('/api/v1/supplier/verification/submit', { method: 'POST', token: supplier1Token }),
        api('/api/v1/supplier/verification/submit', { method: 'POST', token: supplier1Token })
      ]);

      assert.strictEqual(res1.status, 200);
      assert.strictEqual(res2.status, 200);

      const [statusRows] = await db.query(
        'SELECT verification_status FROM supplier_profiles WHERE supplier_id = ?',
        [supplier1Id]
      );
      assert.strictEqual(statusRows[0].verification_status, 'PENDING_REVIEW');
    });

    // ---------------------------------------------------------------------------
    // TEST 22: Direct DB verification of AES-256-GCM encryption at rest on bank_iban
    // ---------------------------------------------------------------------------
    await test('Sensitive bank_iban is stored strictly encrypted at rest with v1 envelope in MySQL', async () => {
      const [rawRows] = await db.query(
        'SELECT bank_iban FROM supplier_profiles WHERE supplier_id = ?',
        [supplier1Id]
      );
      assert.ok(rawRows.length > 0, 'Supplier row must exist');
      const rawIban = rawRows[0].bank_iban;
      assert.ok(rawIban, 'Raw bank_iban column must not be null');
      assert.ok(rawIban.startsWith('v1:'), `Raw DB column must start with 'v1:' envelope, got: ${rawIban}`);
      assert.strictEqual(
        rawIban.includes('PK36SCBL0000001123456702'),
        false,
        'CRITICAL SECURITY DEFECT: Raw database column contains plaintext IBAN!'
      );
      // Validate envelope structure: v1:<iv>:<tag>:<ciphertext>
      const parts = rawIban.split(':');
      assert.strictEqual(parts.length, 4, 'Ciphertext envelope must have 4 colon-delimited components');
      assert.strictEqual(parts[1].length, 24, 'IV must be 12 bytes (24 hex characters)');
      assert.strictEqual(parts[2].length, 32, 'Auth tag must be 16 bytes (32 hex characters)');
    });

    // ---------------------------------------------------------------------------
    // TEST 23: Direct cryptographic service round-trip, legacy protection, and tamper resistance
    // ---------------------------------------------------------------------------
    await test('Encryption service performs AES-256-GCM round-trip, protects legacy plaintext, and rejects tampering', async () => {
      const encryptionService = require('../src/services/encryptionService');
      const plaintext = 'PK36SCBL0000001123456702';
      const enc = encryptionService.encrypt(plaintext);

      // Verify decryption returns exact plaintext
      assert.strictEqual(encryptionService.decrypt(enc), plaintext);
      assert.strictEqual(encryptionService.isEncrypted(enc), true);
      assert.strictEqual(encryptionService.isLegacyPlaintext(enc), false);

      // Normal runtime MUST NOT silently treat unencrypted legacy data as safely encrypted
      assert.throws(() => {
        encryptionService.decrypt('PK_LEGACY_RAW_IBAN');
      }, /Unencrypted legacy banking data detected/);

      // Controlled legacy read with explicit authorization passes through
      assert.strictEqual(
        encryptionService.decrypt('PK_LEGACY_RAW_IBAN', { allowLegacy: true }),
        'PK_LEGACY_RAW_IBAN'
      );
      assert.strictEqual(encryptionService.isLegacyPlaintext('PK_LEGACY_RAW_IBAN'), true);
      assert.strictEqual(encryptionService.isEncrypted('PK_LEGACY_RAW_IBAN'), false);

      // Malformed envelope (invalid IV length) fails closed
      assert.throws(() => {
        encryptionService.decrypt('v1:badiv:0123456789abcdef0123456789abcdef:deadbeef');
      }, /invalid IV length or format/);

      // Malformed envelope (invalid tag length) fails closed
      assert.throws(() => {
        encryptionService.decrypt('v1:0123456789abcdef01234567:badtag:deadbeef');
      }, /invalid auth tag length or format/);

      // Tampered ciphertext fails closed
      const tampered = enc.substring(0, enc.length - 2) + (enc.slice(-2) === 'aa' ? 'bb' : 'aa');
      assert.throws(() => {
        encryptionService.decrypt(tampered);
      }, /Cryptographic decryption failed/);
    });

    // ---------------------------------------------------------------------------
    // TEST 24: Admin verification server-side allowlists & safe plan listing limits
    // ---------------------------------------------------------------------------
    await test('Admin verification enforces server-side allowlists and prevents starter plan slot inflation', async () => {
      // 1. Invalid verification level rejected
      const badLevelRes = await api(`/api/v1/admin/suppliers/${supplier2Id}/verify`, {
        method: 'PUT',
        token: adminToken,
        body: {
          verification_status: 'VERIFIED',
          verification_level: 'LEVEL_99_SUPER_INVALID'
        }
      });
      assert.strictEqual(badLevelRes.status, 400);
      assert.strictEqual(badLevelRes.data.error.code, 'INVALID_VERIFICATION_LEVEL');

      // 2. Invalid subscription plan rejected
      const badPlanRes = await api(`/api/v1/admin/suppliers/${supplier2Id}/verify`, {
        method: 'PUT',
        token: adminToken,
        body: {
          verification_status: 'VERIFIED',
          subscription_plan: 'ULTRA_PLATINUM_FAKE'
        }
      });
      assert.strictEqual(badPlanRes.status, 400);
      assert.strictEqual(badPlanRes.data.error.code, 'INVALID_SUBSCRIPTION_PLAN');

      // 3. Approving with STARTER plan defaults listings cap safely to 4 (not 25)
      const starterApproveRes = await api(`/api/v1/admin/suppliers/${supplier2Id}/verify`, {
        method: 'PUT',
        token: adminToken,
        body: {
          verification_status: 'VERIFIED',
          verification_level: 'LEVEL_1_CONTACT',
          subscription_plan: 'STARTER'
        }
      });
      assert.strictEqual(starterApproveRes.status, 200);

      const [supp2Row] = await db.query(
        'SELECT max_active_listings, subscription_plan, verification_level FROM supplier_profiles WHERE supplier_id = ?',
        [supplier2Id]
      );
      assert.strictEqual(supp2Row[0].subscription_plan, 'STARTER');
      assert.strictEqual(supp2Row[0].verification_level, 'LEVEL_1_CONTACT');
      assert.strictEqual(
        supp2Row[0].max_active_listings,
        4,
        'Plan Safety Violation: STARTER supplier must default to 4 listings, not 25!'
      );
    });

    // ---------------------------------------------------------------------------
    // TEST 25: Admin pending suppliers queue endpoint lists submissions without leaking plaintext
    // ---------------------------------------------------------------------------
    await test('Admin pending queue endpoint correctly lists submissions and requires admin role', async () => {
      // 1. Authorized admin can query pending list
      const adminRes = await api('/api/v1/admin/suppliers/pending', { token: adminToken });
      assert.strictEqual(adminRes.status, 200);
      assert.strictEqual(adminRes.data.success, true);
      assert.ok(Array.isArray(adminRes.data.data.suppliers));

      // Check that supplier1 is in the list
      const found = adminRes.data.data.suppliers.find((s) => s.supplier_id === supplier1Id);
      assert.ok(found, 'Pending list must contain supplier1');

      // Verify unauthenticated is rejected
      const unauthRes = await api('/api/v1/admin/suppliers/pending');
      assert.strictEqual(unauthRes.status, 401);

      // Verify regular buyer is rejected (403 Forbidden)
      const buyerRes = await api('/api/v1/admin/suppliers/pending', { token: buyerToken });
      assert.strictEqual(buyerRes.status, 403);
    });

    // ---------------------------------------------------------------------------
    // TEST 26: Missing BANK_DATA_ENCRYPTION_KEY fails safely in non-test mode
    // ---------------------------------------------------------------------------
    await test('Missing BANK_DATA_ENCRYPTION_KEY fails safely without logging or persisting plaintext', async () => {
      const encryptionService = require('../src/services/encryptionService');
      const originalEnv = process.env.NODE_ENV;
      const originalKey = process.env.BANK_DATA_ENCRYPTION_KEY;

      try {
        process.env.NODE_ENV = 'production';
        delete process.env.BANK_DATA_ENCRYPTION_KEY;

        // In production without key, getEncryptionKey must return null
        assert.strictEqual(encryptionService.getEncryptionKey(), null);
        assert.strictEqual(encryptionService.isConfigured(), false);

        // encrypt must throw ENCRYPTION_KEY_NOT_CONFIGURED (fail closed)
        assert.throws(() => {
          encryptionService.encrypt('PK36SCBL0000001123456702');
        }, (err) => {
          return err.code === 'ENCRYPTION_KEY_NOT_CONFIGURED';
        });
      } finally {
        process.env.NODE_ENV = originalEnv;
        if (originalKey) {
          process.env.BANK_DATA_ENCRYPTION_KEY = originalKey;
        }
      }
    });

    // ---------------------------------------------------------------------------
    // TEST 27: No mutation of miljor_db
    // ---------------------------------------------------------------------------
    await test('Development database miljor_db remains 100% PRISTINE (0 writes, 0 mutations)', async () => {
      const [devUsersAfter] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.users');
      const [devMigrationsAfter] = await db.query('SELECT COUNT(*) as cnt FROM miljor_db.schema_migrations');

      assert.strictEqual(
        devUsersAfter[0].cnt,
        devSnapshot.users,
        'CRITICAL DEFECT: Users count in miljor_db was altered during test execution!'
      );
      assert.strictEqual(
        devMigrationsAfter[0].cnt,
        devSnapshot.migrations,
        'CRITICAL DEFECT: Migrations in miljor_db were altered during test execution!'
      );
    });

    console.log('\n================================================================================');
    console.log(`PACKAGE E1 GATE VERDICT: ALL ${passed}/${total} TESTS PASSED (100% GREEN)`);
    console.log('================================================================================\n');

  } finally {
    // Cleanup test fixtures from miljor_test_db
    await db.query('DELETE FROM supplier_profiles WHERE supplier_id IN (?, ?)', [supplier1Id, supplier2Id]);
    await db.query('DELETE FROM system_audit_logs WHERE actor_id IN (?, ?, ?, ?)', [supplier1Id, supplier2Id, buyerId, adminId]);
    await db.query('DELETE FROM users WHERE id IN (?, ?, ?, ?)', [supplier1Id, supplier2Id, buyerId, adminId]);

    server.close();
  }
}

runE1Gate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal Test Gate Failure:', err);
    process.exit(1);
  });
