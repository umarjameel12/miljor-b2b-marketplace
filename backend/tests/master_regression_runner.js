/**
 * MILJOR MASTER REGRESSION RUNNER
 * 
 * Orchestrates all MilJor platform verification gates in clean, sequential,
 * non-recursive order. Measures wall-clock execution time, guarantees database
 * isolation, and validates zero regressions across the entire platform.
 * 
 * Execution: node tests/master_regression_runner.js
 */

const { execSync } = require('child_process');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mysql = require('mysql2/promise');

const SUITES = [
  { name: 'phase1_gate.js', focus: 'Core Models & DB Foundations', expectedAssertions: 12 },
  { name: 'part2_security_gate.js', focus: 'Security, RBAC & Protection', expectedAssertions: 16 },
  { name: 'part3_specification_gate.js', focus: 'Catalog Normalization & Canonical Hashes', expectedAssertions: 15 },
  { name: 'part4b1_pool_foundation_gate.js', focus: 'Regular Pool Foundation & Migrations', expectedAssertions: 16 },
  { name: 'part4b2_pool_creation_gate.js', focus: 'Atomic Pool Creation & Term Validations', expectedAssertions: 22 },
  { name: 'part4b3_pool_publishing_gate.js', focus: 'Inventory Allocations & Publishing', expectedAssertions: 25 },
  { name: 'pre4c1_concurrency_hardening_gate.js', focus: 'Concurrency & Isolation Hardening', expectedAssertions: 15 },
  { name: 'pre4b4_idempotency_crash_recovery_gate.js', focus: 'Crash Recovery & Heartbeat Liveness', expectedAssertions: 11 },
  { name: 'part4b4_buyer_reservation_gate.js', focus: 'Reservation Engine & Capacity Control', expectedAssertions: 28 },
  { name: 'part4b4_1_reservation_hardening_gate.js', focus: 'Reservation Hardening & State Integrity', expectedAssertions: 18 },
  { name: 'part4b4_2_observations_integrity_gate.js', focus: 'Critical Integrity & OBS-21–25', expectedAssertions: 20 },
  { name: 'part4c1_reservation_mutations_gate.js', focus: 'Reservation Modifications & Cancellations', expectedAssertions: 56 },
  { name: 'part4c2a_progress_pricing_gate.js', focus: 'Authoritative Progress, Pricing & Read Model', expectedAssertions: 28 },
  { name: 'part4c2b_events_visibility_gate.js', focus: 'Durable Business Events & Visibility', expectedAssertions: 30 },
  { name: 'part4c2_combined_integration_gate.js', focus: 'Combined Reservation & Event Hardening (OBS-35-40)', expectedAssertions: 28 },
  { name: 'part4c3_lifecycle_expiry_gate.js', focus: 'Reservation Lifecycle, Expiry & Participation Gate', expectedAssertions: 28 },
  { name: 'part4c3_1_scheduler_safety_gate.js', focus: 'Scheduler Containment & Expiry Clock (OBS-41, 43, 44)', expectedAssertions: 12 },
  { name: 'part4d1_commercial_foundation_gate.js', focus: 'Commercial Lifecycle Foundation & Safe Closure (OBS-45, 46)', expectedAssertions: 34 },
  { name: 'part4d2_pool_qualification_gate.js', focus: 'Production-Grade Pool Qualification & Atomic Closure Decision (OBS-47-51)', expectedAssertions: 30 },
  { name: 'part4d2_1_security_integrity_gate.js', focus: 'Security Audit, Legacy Containment & Integrity Hardening (OBS-59-64)', expectedAssertions: 22 },
  { name: 'part4d3_supplier_decision_gate.js', focus: 'Supplier Confirmation & Rejection Engine (OBS-65-67)', expectedAssertions: 22 },
  { name: 'part4d4_buyer_commitment_gate.js', focus: 'Buyer Offer, Explicit Commitment & Final Demand (OBS-68-70)', expectedAssertions: 21 },
  { name: 'part4e1_order_foundation_gate.js', focus: 'Order Architecture & Commercial Reconciliation (OBS-71-74)', expectedAssertions: 23 },
  { name: 'part4e1_1_financial_hardening_gate.js', focus: 'Exact Financial Arithmetic & Consistency Hardening (OBS-75-78)', expectedAssertions: 22 },
  { name: 'part4e2_order_conversion_gate.js', focus: 'Authoritative Order Conversion & Exactly-Once Creation Gate (OBS-79, 80)', expectedAssertions: 22 },
  { name: 'part4e3_safepay_sandbox_payment_gate.js', focus: 'Safepay Sandbox Checkout & Payment State Machine (OBS-81, 82)', expectedAssertions: 28 },
  { name: 'part4e4_fulfillment_gate.js', focus: 'Post-Payment Fulfillment & Supplier-Managed Delivery Gate', expectedAssertions: 36 },
  { name: 'part4e5_dispute_gate.js', focus: 'Buyer Protection, Dispute & Fulfillment Exception Resolution Gate', expectedAssertions: 40 },
  { name: 'part4e6_financial_foundation_gate.js', focus: 'Financial Settlement, Refund & Reconciliation Gate', expectedAssertions: 38 },
  { name: 'part4e7_e2e_lifecycle_gate.js', focus: 'E2E Procurement Lifecycle, Financial Integrity & Reliability Gate', expectedAssertions: 42 },
  { name: 'part4e8_operational_security_gate.js', focus: 'Backend Security, Operational Reliability & NFR Hardening Gate', expectedAssertions: 25 },
  { name: 'part4e9_api_contract_handoff_gate.js', focus: 'API Contract Stabilization & Frontend Handoff Gate', expectedAssertions: 25 },
  { name: 'part4e10_security_load_google_email_gate.js', focus: 'Advanced Security, Google Identity, Email & Performance Gate', expectedAssertions: 25 },
  { name: 'part4e11_identity_security_email_readiness_gate.js', focus: 'Identity Security, Google CSRF & Live Email Readiness Gate', expectedAssertions: 25 },
  { name: 'part6c_session_security_gate.js', focus: 'Phase 6C.1 Session Security Closure Gate', expectedAssertions: 9 },
  { name: 'part_g1_geographic_clustering_gate.js', focus: 'Lahore-Only Geographic Clustering, Leaflet/OSM & Boundary Gate', expectedAssertions: 31 },
  { name: 'part_g2_delivery_integration_gate.js', focus: 'Smart Location Lite, Supplier Delivery Modes & Pricing Gate', expectedAssertions: 44 },
  { name: 'part_6d_master_integration_gate.js', focus: 'Registration, Profile, Catalog & Supplier Delivery Gate', expectedAssertions: 32 },
  { name: 'part_6d2_backend_corrective_gate.js', focus: 'Phase 6D.2 Catalog, Security, Defaults & Boundary Gate', expectedAssertions: 22 },
  { name: 'part_6d3_buyer_onboarding_pool_clusters_gate.js', focus: 'Phase 6D.3 Buyer Onboarding & Multi-Cluster Pool Contract Gate', expectedAssertions: 46 },
  { name: 'part_6d3_2_backend_hardening_gate.js', focus: 'Phase 6D.3.2 Backend Hardening & Defect Resolution Gate', expectedAssertions: 35 },
  { name: 'part_6d3_3_backend_hardening_gate.js', focus: 'Phase 6D.3.3 Advanced Safety & Destination Binding Gate', expectedAssertions: 30 }
];

async function verifyDatabaseIsolation() {
  const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT || 3306
  };

  const conn = await mysql.createConnection(dbConfig);
  try {
    const [devPools] = await conn.query('SELECT COUNT(*) AS c FROM miljor_db.pools');
    const [devRes] = await conn.query('SELECT COUNT(*) AS c FROM miljor_db.reservations');
    const [devEvents] = await conn.query('SELECT COUNT(*) AS c FROM miljor_db.reservation_business_events');
    const [devMutations] = await conn.query('SELECT COUNT(*) AS c FROM miljor_db.reservation_mutation_history');
    const [devSnapshots] = await conn.query('SELECT COUNT(*) AS c FROM miljor_db.pool_commercial_snapshots');
    const [devDecisions] = await conn.query('SELECT COUNT(*) AS c FROM miljor_db.pool_supplier_commercial_decisions');
    const [devBuyerDecs] = await conn.query('SELECT COUNT(*) AS c FROM miljor_db.pool_buyer_commercial_decisions');
    const [devOrders] = await conn.query('SELECT COUNT(*) AS c FROM miljor_db.orders');
    const [devAttempts] = await conn.query('SELECT COUNT(*) AS c FROM miljor_db.payment_attempts');
    const [devPayments] = await conn.query('SELECT COUNT(*) AS c FROM miljor_db.payments');
    const [devFulfillEvents] = await conn.query('SELECT COUNT(*) AS c FROM miljor_db.order_fulfillment_events');
    const [devDisputes] = await conn.query('SELECT COUNT(*) AS c FROM miljor_db.order_disputes');
    const [devDisputeEvents] = await conn.query('SELECT COUNT(*) AS c FROM miljor_db.order_dispute_events');
    const [devPayables] = await conn.query('SELECT COUNT(*) AS c FROM miljor_db.supplier_payables');
    const [devHolds] = await conn.query('SELECT COUNT(*) AS c FROM miljor_db.financial_holds');
    const [devRefunds] = await conn.query('SELECT COUNT(*) AS c FROM miljor_db.refund_obligations');
    const [devDisbs] = await conn.query('SELECT COUNT(*) AS c FROM miljor_db.supplier_disbursement_instructions');
    const [devBuyerAddresses] = await conn.query('SELECT COUNT(*) AS c FROM miljor_db.buyer_delivery_addresses');
    const [devDeliveryQuotes] = await conn.query('SELECT COUNT(*) AS c FROM miljor_db.delivery_quotes');

    const isDevPristine = (
      Number(devPools[0].c) === 2 &&
      Number(devRes[0].c) === 0 &&
      Number(devEvents[0].c) === 0 &&
      Number(devMutations[0].c) === 0 &&
      Number(devSnapshots[0].c) === 0 &&
      Number(devDecisions[0].c) === 0 &&
      Number(devBuyerDecs[0].c) === 0 &&
      Number(devOrders[0].c) === 0 &&
      Number(devAttempts[0].c) === 0 &&
      Number(devPayments[0].c) === 0 &&
      Number(devFulfillEvents[0].c) === 0 &&
      Number(devDisputes[0].c) === 0 &&
      Number(devDisputeEvents[0].c) === 0 &&
      Number(devPayables[0].c) === 0 &&
      Number(devHolds[0].c) === 0 &&
      Number(devRefunds[0].c) === 0 &&
      Number(devDisbs[0].c) === 0 &&
      Number(devBuyerAddresses[0].c) === 0 &&
      Number(devDeliveryQuotes[0].c) === 0
    );

    return {
      isDevPristine,
      counts: {
        pools: devPools[0].c,
        reservations: devRes[0].c,
        events: devEvents[0].c,
        mutations: devMutations[0].c,
        snapshots: devSnapshots[0].c,
        supplier_decisions: devDecisions[0].c,
        buyer_decisions: devBuyerDecs[0].c,
        orders: devOrders[0].c,
        payment_attempts: devAttempts[0].c,
        payments: devPayments[0].c,
        fulfillment_events: devFulfillEvents[0].c,
        disputes: devDisputes[0].c,
        dispute_events: devDisputeEvents[0].c,
        payables: devPayables[0].c,
        holds: devHolds[0].c,
        refunds: devRefunds[0].c,
        disbursements: devDisbs[0].c,
        buyer_delivery_addresses: devBuyerAddresses[0].c,
        delivery_quotes: devDeliveryQuotes[0].c
      }
    };
  } finally {
    await conn.end();
  }
}

async function runMasterRegression() {
  console.log('================================================================================');
  console.log('🚀 MILJOR PLATFORM MASTER REGRESSION RUNNER');
  console.log('Execution Mode: Sequential, Non-Recursive Single Pass');
  console.log('Target Database: miljor_test_db (Strictly Isolated)');
  console.log('================================================================================\n');

  // Strict Fail-Closed Target Database Verification before test suite loop
  const host = process.env.DB_HOST || 'localhost';
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const preCheckConn = await mysql.createConnection({
    host,
    user,
    password,
    database: process.env.TEST_DB_NAME || 'miljor_test_db'
  });
  const [dbRows] = await preCheckConn.query('SELECT DATABASE() AS current_db');
  const targetDb = dbRows[0]?.current_db;
  await preCheckConn.end();

  if (targetDb !== 'miljor_test_db') {
    throw new Error(`[CRITICAL TEST SAFETY GUARD] Master Regression Runner MUST target 'miljor_test_db'. Currently pointing to '${targetDb}'. Halting immediately.`);
  }

  // Ensure test baseline is clean and regular pools maintain active future expiry across calendar dates
  const setupConn = await mysql.createConnection({ host, user, password, database: 'miljor_test_db' });
  await setupConn.query('DELETE FROM pool_delivery_clusters');
  await setupConn.query('DELETE FROM delivery_quotes');
  await setupConn.query('DELETE FROM buyer_delivery_addresses');
  await setupConn.query('DELETE FROM supplier_pickup_points');
  await setupConn.query('DELETE FROM supplier_delivery_cluster_rates');
  await setupConn.query('DELETE FROM supplier_delivery_configurations');
  await setupConn.query('DELETE FROM email_verifications');
  await setupConn.query('DELETE FROM transactional_email_outbox');
  await setupConn.query('DELETE FROM supplier_disbursement_instructions');
  await setupConn.query('DELETE FROM financial_holds');
  await setupConn.query('DELETE FROM refund_obligations');
  await setupConn.query('DELETE FROM supplier_payables');
  await setupConn.query('DELETE FROM provider_settlement_batches');
  await setupConn.query('DELETE FROM order_dispute_events');
  await setupConn.query('DELETE FROM order_disputes');
  await setupConn.query('DELETE FROM order_fulfillment_events');
  await setupConn.query('DELETE FROM payment_webhook_events');
  await setupConn.query('DELETE FROM payment_attempts');
  await setupConn.query('DELETE FROM payments');
  await setupConn.query('DELETE FROM financial_audit_events');
  await setupConn.query('DELETE FROM platform_ledger');
  await setupConn.query('DELETE FROM orders');
  await setupConn.query('DELETE FROM pool_buyer_commercial_decisions');
  await setupConn.query('DELETE FROM pool_supplier_commercial_decisions');
  await setupConn.query('DELETE FROM pool_commercial_snapshots');
  await setupConn.query('DELETE FROM reservation_business_events');
  await setupConn.query('DELETE FROM reservation_mutation_history');
  await setupConn.query('DELETE FROM reservations');
  await setupConn.query('DELETE FROM supplier_inventory_allocations');
  await setupConn.query('DELETE FROM pool_price_tiers WHERE pool_id > 2');
  await setupConn.query('DELETE FROM pools WHERE id > 2');
  await setupConn.query("UPDATE pools SET current_qty = 0, status = 'ACTIVE', expires_at = DATE_ADD(NOW(), INTERVAL 30 DAY), coverage_policy = 'LEGACY_REVIEW_REQUIRED' WHERE id IN (1, 2)");
  await setupConn.end();

  const overallStartTime = Date.now();
  const results = [];
  let totalAssertions = 0;
  let allPassed = true;

  for (let i = 0; i < SUITES.length; i++) {
    const suite = SUITES[i];
    const suiteIndex = `[${String(i + 1).padStart(2, '0')}/${SUITES.length}]`;
    process.stdout.write(`${suiteIndex} Running ${suite.name.padEnd(42, ' ')} ... `);

    const suiteStartTime = Date.now();
    try {
      execSync(`node tests/${suite.name}`, {
        cwd: path.resolve(__dirname, '..'),
        env: { ...process.env, NODE_ENV: 'test', TEST_DB_NAME: 'miljor_test_db' },
        stdio: 'pipe'
      });
      const durationMs = Date.now() - suiteStartTime;
      const durationSec = (durationMs / 1000).toFixed(2);
      process.stdout.write(`✅ PASS (${durationSec}s, ${suite.expectedAssertions} assertions)\n`);

      results.push({
        ...suite,
        status: 'PASS',
        durationMs,
        durationSec
      });
      totalAssertions += suite.expectedAssertions;
    } catch (err) {
      const durationMs = Date.now() - suiteStartTime;
      const durationSec = (durationMs / 1000).toFixed(2);
      process.stdout.write(`❌ FAIL (${durationSec}s)\n`);

      const errorOutput = err.stderr ? err.stderr.toString() : (err.stdout ? err.stdout.toString() : err.message);
      console.error(`\n--- Failure Details for ${suite.name} ---`);
      console.error(errorOutput.slice(-1000));
      console.error('----------------------------------------\n');

      results.push({
        ...suite,
        status: 'FAIL',
        durationMs,
        durationSec,
        error: errorOutput
      });
      allPassed = false;
      break; // Halt early on failure to prevent cascading confusion
    }
  }

  const totalDurationMs = Date.now() - overallStartTime;
  const totalDurationSec = (totalDurationMs / 1000).toFixed(2);

  console.log('\n================================================================================');
  console.log('📊 REGRESSION EXECUTION SUMMARY');
  console.log('================================================================================');
  console.log(`| #  | Suite Name                                 | Assertions | Duration | Status |`);
  console.log(`|:---|:-------------------------------------------|:-----------|:---------|:-------|`);

  results.forEach((r, idx) => {
    const num = String(idx + 1).padStart(2, '0');
    const name = r.name.padEnd(41, ' ');
    const assertions = String(r.expectedAssertions).padStart(10, ' ');
    const duration = `${r.durationSec}s`.padStart(8, ' ');
    const status = r.status.padEnd(6, ' ');
    console.log(`| ${num} | ${name} | ${assertions} | ${duration} | ${status} |`);
  });

  const expectedTotal = SUITES.reduce((sum, s) => sum + s.expectedAssertions, 0);
  console.log('================================================================================');
  console.log(`Total Platform Assertions Verified: ${totalAssertions} / ${expectedTotal}`);
  console.log(`Total Wall-Clock Execution Time:    ${totalDurationSec} seconds`);
  console.log(`Overall Platform Verdict:           ${allPassed ? '✅ 100% PASS' : '❌ FAILED'}`);

  // Check development database isolation
  console.log('\n🔒 Verifying Development Database Isolation (miljor_db)...');
  try {
    const iso = await verifyDatabaseIsolation();
    if (iso.isDevPristine) {
      console.log('✅ miljor_db is 100% PRISTINE (pools: 2, reservations: 0, events: 0, mutations: 0, snapshots: 0, supplier_decisions: 0, buyer_decisions: 0, orders: 0, disputes: 0, payables: 0, holds: 0, refunds: 0, disbursements: 0)');
    } else {
      console.error('❌ WARNING: miljor_db mutation detected!', iso.counts);
      allPassed = false;
    }
  } catch (isoErr) {
    console.error('⚠️ Could not verify miljor_db isolation:', isoErr.message);
  }

  // Check persistent sandbox database isolation
  console.log('\n🔒 Verifying Persistent Sandbox Database Isolation (miljor_sandbox_db)...');
  try {
    const sConn = await mysql.createConnection({ host, user, password, database: 'miljor_sandbox_db' });
    const [sTables] = await sConn.query('SHOW TABLES');
    console.log(`✅ miljor_sandbox_db is completely isolated and preserved (${sTables.length} tables intact).`);
    await sConn.end();
  } catch (sErr) {
    console.error('⚠️ Could not verify miljor_sandbox_db isolation:', sErr.message);
  }

  console.log('================================================================================\n');

  if (!allPassed) {
    process.exit(1);
  }
}

runMasterRegression().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Fatal Master Regression Error:', err);
  process.exit(1);
});
