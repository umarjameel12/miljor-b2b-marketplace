'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
// This is a repository-double unit test: importing the catalog must not open
// the application's default database pool, even when no test env is supplied.
const dbPath = require.resolve('../src/config/db');
const savedDb = require.cache[dbPath];
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query() { throw new Error('Unexpected database access in spec-code unit test'); },
  getConnection() { throw new Error('Unexpected database access in spec-code unit test'); }
} };
const specificationService = require('../src/services/specificationService');
const catalogService = require('../src/services/catalogService');
const productSpecRepo = require('../src/repositories/productSpecificationRepo');
if (savedDb) require.cache[dbPath] = savedDb;
else delete require.cache[dbPath];

test('generateSpecCode preserves deterministic idHint and uses 12-hex suffix otherwise', () => {
  assert.equal(specificationService.generateSpecCode('Grains & Rice', 'Basmati', 42), 'SPEC-G&R-BAS-42');
  const generated = specificationService.generateSpecCode('Grains & Rice', 'Basmati');
  assert.match(generated, /^SPEC-G&R-BAS-[A-F0-9]{12}$/);
  assert.ok(generated.length <= 50);
});

test('_createSpecWithUniqueCode retries only on spec_code ER_DUP_ENTRY and succeeds', async () => {
  const originalCreate = productSpecRepo.create;
  const seenCodes = [];
  let calls = 0;
  productSpecRepo.create = async (data) => {
    calls++;
    seenCodes.push(data.spec_code);
    if (calls === 1) {
      const err = new Error("Duplicate entry for key 'product_specifications.spec_code'");
      err.code = 'ER_DUP_ENTRY';
      err.errno = 1062;
      err.sqlMessage = "Duplicate entry 'SPEC-G&R-BAS-001' for key 'product_specifications.spec_code'";
      throw err;
    }
    return 777;
  };
  try {
    const id = await catalogService._createSpecWithUniqueCode({}, { title: 'Test' }, 'Grains & Rice', 'Basmati');
    assert.equal(id, 777);
    assert.equal(calls, 2);
    assert.notEqual(seenCodes[0], seenCodes[1]);
  } finally {
    productSpecRepo.create = originalCreate;
  }
});

test('_createSpecWithUniqueCode does not retry unrelated ER_DUP_ENTRY (spec_hash)', async () => {
  const originalCreate = productSpecRepo.create;
  let calls = 0;
  productSpecRepo.create = async () => {
    calls++;
    const err = new Error("Duplicate entry for key 'product_specifications.spec_hash'");
    err.code = 'ER_DUP_ENTRY';
    err.errno = 1062;
    err.sqlMessage = "Duplicate entry 'abc' for key 'product_specifications.spec_hash'";
    throw err;
  };
  try {
    await assert.rejects(
      () => catalogService._createSpecWithUniqueCode({}, { title: 'Test' }, 'Grains & Rice', 'Basmati'),
      { code: 'ER_DUP_ENTRY' }
    );
    assert.equal(calls, 1);
  } finally {
    productSpecRepo.create = originalCreate;
  }
});

test('_createSpecWithUniqueCode stops after 3 spec_code collisions without swallowing error', async () => {
  const originalCreate = productSpecRepo.create;
  let calls = 0;
  productSpecRepo.create = async () => {
    calls++;
    const err = new Error("Duplicate entry for key 'product_specifications.spec_code'");
    err.code = 'ER_DUP_ENTRY';
    err.errno = 1062;
    err.sqlMessage = "Duplicate entry 'dup' for key 'product_specifications.spec_code'";
    throw err;
  };
  try {
    await assert.rejects(
      () => catalogService._createSpecWithUniqueCode({}, { title: 'Test' }, 'Grains & Rice', 'Basmati'),
      { code: 'ER_DUP_ENTRY' }
    );
    assert.equal(calls, 3);
  } finally {
    productSpecRepo.create = originalCreate;
  }
});

test('_createSpecWithUniqueCode does not mistake a duplicate value for the constraint name', async () => {
  const originalCreate = productSpecRepo.create;
  try {
    for (const value of ['spec_code', "for key 'spec_code'"]) {
      let calls = 0;
      const error = Object.assign(new Error(`Duplicate entry '${value}' for key 'product_specifications.other_unique'`), {code:'ER_DUP_ENTRY', errno:1062});
      productSpecRepo.create = async () => { calls++; throw error; };
      await assert.rejects(() => catalogService._createSpecWithUniqueCode({}, {}, 'Grains', 'Rice'), e => e === error);
      assert.equal(calls, 1);
    }
  } finally { productSpecRepo.create = originalCreate; }
});

test('_createSpecWithUniqueCode immediately propagates non-duplicate SQL errors', async () => {
  const originalCreate = productSpecRepo.create;
  let calls = 0;
  const error = Object.assign(new Error("spec_code connection failed"), {code:'PROTOCOL_CONNECTION_LOST'});
  productSpecRepo.create = async () => { calls++; throw error; };
  try {
    await assert.rejects(() => catalogService._createSpecWithUniqueCode({}, {}, 'Grains', 'Rice'), e => e === error);
    assert.equal(calls, 1);
  } finally { productSpecRepo.create = originalCreate; }
});
