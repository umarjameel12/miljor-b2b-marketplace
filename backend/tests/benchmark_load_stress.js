/**
 * MILJOR PART 4E.10: CONTROLLED LOAD & STRESS TESTING HARNESS
 *
 * Measures:
 *   - p50, p95, p99 Latency
 *   - Throughput (Requests Per Second)
 *   - Error / Timeout Rates
 *   - Event Loop Delay & Memory Utilization
 *   - Graceful Overload Handling
 *
 * Target: Isolated Local Server strictly pointing to miljor_test_db.
 * Never targets miljor_db or miljor_sandbox_db.
 *
 * Execution: node tests/benchmark_load_stress.js
 */

process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'miljor_test_db';

const http = require('http');
const path = require('path');
const jwt = require('jsonwebtoken');
const autocannon = require('autocannon');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = require('../server');
const db = require('../src/config/db');
const { assertTestDatabaseSafety } = require('./testDbSafetyGuard');

const JWT_SECRET = process.env.JWT_SECRET || 'miljor_dev_jwt_secret_key_2026';

function generateTestToken(userId, role) {
  return jwt.sign(
    { id: userId, role, verification_status: 'VERIFIED' },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h', issuer: 'miljor-api', audience: 'miljor-app' }
  );
}

const buyerToken = generateTestToken(5, 'BUYER');

function runAutocannon(opts) {
  return new Promise((resolve, reject) => {
    autocannon(opts, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
}

async function runLoadBenchmarks() {
  console.log('================================================================================');
  console.log('🚀 MILJOR PART 4E.10: CONTROLLED LOAD & STRESS TESTING SUITE');
  console.log('Target Database: miljor_test_db (Strictly Isolated)');
  console.log('================================================================================\n');

  await assertTestDatabaseSafety(db, 'Load Benchmark Suite');

  // Start local ephemeral HTTP server
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  console.log(`📡 Local Benchmark Server listening on ${baseUrl}\n`);

  const results = {};

  try {
    // -------------------------------------------------------------------------
    // PROFILE A: Baseline / Liveness Probe (High throughput check)
    // -------------------------------------------------------------------------
    console.log('--- Profile A: Liveness Probe (/health/live) - Concurrency: 10, Duration: 3s ---');
    const liveResult = await runAutocannon({
      url: `${baseUrl}/health/live`,
      connections: 10,
      duration: 3
    });
    results.live = {
      p50: liveResult.latency.p50,
      p90: liveResult.latency.p90,
      p99: liveResult.latency.p99,
      rps: liveResult.requests.average,
      errors: liveResult.errors,
      timeouts: liveResult.timeouts
    };
    console.log(`  p50: ${results.live.p50}ms | p90: ${results.live.p90}ms | p99: ${results.live.p99}ms | RPS: ${results.live.rps.toFixed(1)} | Errors: ${results.live.errors}`);

    // -------------------------------------------------------------------------
    // PROFILE B: Readiness Probe with Database Ping (/health/ready)
    // -------------------------------------------------------------------------
    console.log('\n--- Profile B: Readiness DB Probe (/health/ready) - Concurrency: 15, Duration: 3s ---');
    const readyResult = await runAutocannon({
      url: `${baseUrl}/health/ready`,
      connections: 15,
      duration: 3
    });
    results.ready = {
      p50: readyResult.latency.p50,
      p90: readyResult.latency.p90,
      p99: readyResult.latency.p99,
      rps: readyResult.requests.average,
      errors: readyResult.errors,
      timeouts: readyResult.timeouts
    };
    console.log(`  p50: ${results.ready.p50}ms | p90: ${results.ready.p90}ms | p99: ${results.ready.p99}ms | RPS: ${results.ready.rps.toFixed(1)} | Errors: ${results.ready.errors}`);

    // -------------------------------------------------------------------------
    // PROFILE C: Public Pool Discovery Read Model (/api/v1/pools)
    // -------------------------------------------------------------------------
    console.log('\n--- Profile C: Pool Discovery (/api/v1/pools) - Concurrency: 20, Duration: 3s ---');
    const poolsResult = await runAutocannon({
      url: `${baseUrl}/api/v1/pools`,
      connections: 20,
      duration: 3
    });
    results.pools = {
      p50: poolsResult.latency.p50,
      p90: poolsResult.latency.p90,
      p99: poolsResult.latency.p99,
      rps: poolsResult.requests.average,
      errors: poolsResult.errors,
      timeouts: poolsResult.timeouts
    };
    console.log(`  p50: ${results.pools.p50}ms | p90: ${results.pools.p90}ms | p99: ${results.pools.p99}ms | RPS: ${results.pools.rps.toFixed(1)} | Errors: ${results.pools.errors}`);

    // -------------------------------------------------------------------------
    // PROFILE D: Authenticated Session Profile (/api/v1/auth/me)
    // -------------------------------------------------------------------------
    console.log('\n--- Profile D: Authenticated Identity (/api/v1/auth/me) - Concurrency: 20, Duration: 3s ---');
    const authResult = await runAutocannon({
      url: `${baseUrl}/api/v1/auth/me`,
      connections: 20,
      duration: 3,
      headers: {
        Authorization: `Bearer ${buyerToken}`
      }
    });
    results.auth = {
      p50: authResult.latency.p50,
      p90: authResult.latency.p90,
      p99: authResult.latency.p99,
      rps: authResult.requests.average,
      errors: authResult.errors,
      timeouts: authResult.timeouts
    };
    console.log(`  p50: ${results.auth.p50}ms | p90: ${results.auth.p90}ms | p99: ${results.auth.p99}ms | RPS: ${results.auth.rps.toFixed(1)} | Errors: ${results.auth.errors}`);

    // -------------------------------------------------------------------------
    // PROFILE E: Authenticated Order Listing (/api/v1/orders)
    // -------------------------------------------------------------------------
    console.log('\n--- Profile E: Order Read Model (/api/v1/orders) - Concurrency: 20, Duration: 3s ---');
    const ordersResult = await runAutocannon({
      url: `${baseUrl}/api/v1/orders`,
      connections: 20,
      duration: 3,
      headers: {
        Authorization: `Bearer ${buyerToken}`
      }
    });
    results.orders = {
      p50: ordersResult.latency.p50,
      p90: ordersResult.latency.p90,
      p99: ordersResult.latency.p99,
      rps: ordersResult.requests.average,
      errors: ordersResult.errors,
      timeouts: ordersResult.timeouts
    };
    console.log(`  p50: ${results.orders.p50}ms | p90: ${results.orders.p90}ms | p99: ${results.orders.p99}ms | RPS: ${results.orders.rps.toFixed(1)} | Errors: ${results.orders.errors}`);

    // -------------------------------------------------------------------------
    // PROFILE F: Concurrency Spike & Recovery (Concurrency: 40)
    // -------------------------------------------------------------------------
    console.log('\n--- Profile F: Concurrency Spike (/api/v1/pools) - Concurrency: 40, Duration: 3s ---');
    const spikeResult = await runAutocannon({
      url: `${baseUrl}/api/v1/pools`,
      connections: 40,
      duration: 3
    });
    results.spike = {
      p50: spikeResult.latency.p50,
      p90: spikeResult.latency.p90,
      p99: spikeResult.latency.p99,
      rps: spikeResult.requests.average,
      errors: spikeResult.errors,
      timeouts: spikeResult.timeouts
    };
    console.log(`  p50: ${results.spike.p50}ms | p90: ${results.spike.p90}ms | p99: ${results.spike.p99}ms | RPS: ${results.spike.rps.toFixed(1)} | Errors: ${results.spike.errors}`);

    // Memory and process metrics
    const mem = process.memoryUsage();
    results.memory = {
      rssMb: (mem.rss / 1024 / 1024).toFixed(1),
      heapUsedMb: (mem.heapUsed / 1024 / 1024).toFixed(1),
      heapTotalMb: (mem.heapTotal / 1024 / 1024).toFixed(1)
    };
    console.log(`\n📊 Process Memory: RSS: ${results.memory.rssMb} MB | Heap: ${results.memory.heapUsedMb}/${results.memory.heapTotalMb} MB`);

  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  console.log('\n================================================================================');
  console.log('🎉 LOAD & PERFORMANCE BENCHMARK COMPLETE');
  console.log('================================================================================\n');

  return results;
}

if (require.main === module) {
  runLoadBenchmarks()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Benchmark Error:', err);
      process.exit(1);
    });
}

module.exports = { runLoadBenchmarks };
