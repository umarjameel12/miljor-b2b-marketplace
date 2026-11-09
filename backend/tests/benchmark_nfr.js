/**
 * MILJOR NFR CONTROLLED PERFORMANCE BENCHMARK
 * Measures p50, p95, p99 latencies, error rate, and throughput across representative
 * backend endpoints using controlled local workloads against miljor_test_db.
 *
 * Execution: node tests/benchmark_nfr.js
 */

const http = require('http');
const path = require('path');
process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'miljor_test_db';
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = require('../server');

function makeRequest(serverUrl, path) {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    http.get(`${serverUrl}${path}`, (res) => {
      res.on('data', () => {});
      res.on('end', () => {
        const end = process.hrtime.bigint();
        const durationMs = Number(end - start) / 1e6;
        resolve({ statusCode: res.statusCode, durationMs });
      });
    }).on('error', (err) => {
      const end = process.hrtime.bigint();
      const durationMs = Number(end - start) / 1e6;
      resolve({ statusCode: 500, error: err.message, durationMs });
    });
  });
}

function calculatePercentiles(durations) {
  const sorted = [...durations].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.50)] || 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;
  const avg = sorted.reduce((sum, d) => sum + d, 0) / (sorted.length || 1);
  return {
    p50: p50.toFixed(2),
    p95: p95.toFixed(2),
    p99: p99.toFixed(2),
    avg: avg.toFixed(2),
    min: (sorted[0] || 0).toFixed(2),
    max: (sorted[sorted.length - 1] || 0).toFixed(2)
  };
}

async function runBenchmark() {
  console.log('================================================================================');
  console.log('🚀 MILJOR CONTROLLED NFR BENCHMARK (Local Workload)');
  console.log('================================================================================\n');

  const server = app.listen(0);
  const port = server.address().port;
  const serverUrl = `http://127.0.0.1:${port}`;

  const endpoints = [
    { name: 'Liveness Probe (/health/live)', path: '/health/live', count: 100 },
    { name: 'Legacy Health (/health)', path: '/health', count: 100 },
    { name: 'Readiness Probe (/health/ready - DB ping)', path: '/health/ready', count: 100 },
    { name: 'Pool Catalog Listing (/api/v1/pools)', path: '/api/v1/pools', count: 50 }
  ];

  const benchmarkSummary = [];

  for (const ep of endpoints) {
    process.stdout.write(`Benchmarking ${ep.name.padEnd(45, ' ')} (${ep.count} reqs) ... `);
    const durations = [];
    let errors = 0;
    const testStartTime = Date.now();

    for (let i = 0; i < ep.count; i++) {
      const res = await makeRequest(serverUrl, ep.path);
      durations.push(res.durationMs);
      if (res.statusCode >= 400) {
        errors++;
      }
    }

    const totalTimeSec = (Date.now() - testStartTime) / 1000;
    const rps = (ep.count / (totalTimeSec || 0.001)).toFixed(1);
    const metrics = calculatePercentiles(durations);

    benchmarkSummary.push({
      endpoint: ep.name,
      requests: ep.count,
      rps: `${rps} req/s`,
      errorRate: `${((errors / ep.count) * 100).toFixed(1)}%`,
      p50: `${metrics.p50}ms`,
      p95: `${metrics.p95}ms`,
      p99: `${metrics.p99}ms`,
      avg: `${metrics.avg}ms`
    });

    console.log(`✅ p50: ${metrics.p50}ms | p95: ${metrics.p95}ms | p99: ${metrics.p99}ms | RPS: ${rps}`);
  }

  await new Promise((resolve) => server.close(resolve));

  console.log('\n================================================================================');
  console.log('📊 NFR BENCHMARK RESULTS SUMMARY');
  console.log('================================================================================');
  console.table(benchmarkSummary);
  console.log('================================================================================\n');

  return benchmarkSummary;
}

if (require.main === module) {
  runBenchmark()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal Benchmark Error:', err);
      process.exit(1);
    });
}

module.exports = { runBenchmark };
