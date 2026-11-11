'use strict';
// Explicit B6/Package E release gate. Test DB only: no protected business DB writes.
// Run from backend with: node tests/b6_release_gate.js
const { spawnSync }=require('node:child_process');
const path=require('node:path');
const mysql=require('mysql2/promise');
require('dotenv').config({path:path.resolve(__dirname,'../.env')});
const root=path.resolve(__dirname,'..');
const TEST_DB='miljor_test_db';
const suites=[
  // Pure policy, source safety and canonical family UI checks.
  'b6_backend_hardening_source_gate.js',
  'canonical_family_discovery_gate.js',
  'b6_procurement_request_policy_gate.js',
  'b6_quote_comparison_gate.js',
  'b6_procurement_schedule_policy_gate.js',
  'b6_procurement_award_policy_gate.js',
  'b6_procurement_collective_policy_gate.js',
  'b6_collective_bid_policy_gate.js',
  // Database integration, after migrations 033–047 & B6 fixtures.
  'package_e2_catalog_foundation_gate.js',
  'package_e2_catalog_moderation_gate.js',
  'package_e2_catalog_security_gate.js',
  'package_e2_product_ownership_and_immutable_pools_gate.js',
  'package_e3_entitlements_and_supplier_portal_gate.js',
  'b6_procurement_request_lifecycle_gate.js',
  'b6_supplier_matching_gate.js',
  'b6_supplier_quote_gate.js',
  'b6_quote_negotiation_gate.js',
  'b6_procurement_collective_lifecycle_gate.js',
  'b6_collective_bid_lifecycle_gate.js',
  'b6_procurement_recurring_lifecycle_gate.js',
  'b6_recurring_cycle_draft_gate.js',
  'b6_recurring_worker_gate.js',
  'b6_procurement_http_concurrency_gate.js',
  'b6_supplier_matching_gate.js'
];
(async()=>{
  process.env.NODE_ENV='test';
  process.env.TEST_DB_NAME=TEST_DB;
  if(process.env.DB_NAME===TEST_DB && process.env.NODE_ENV==='production')
    throw Error('Unexpected production configuration');
  const connection=await mysql.createConnection({
    host:process.env.DB_HOST||'localhost',
    user:process.env.DB_USER||'root',
    password:process.env.DB_PASSWORD||'',
    database:TEST_DB
  });
  try {
    const [[identity]]=await connection.query('SELECT DATABASE() AS database_name');
    if(identity.database_name!==TEST_DB)throw Error('Refusing to run on protected database');
    for(const table of ['catalog_product_families','supplier_skus','procurement_requests','procurement_award_lines','schema_migrations']){
      const [existing]=await connection.query(
        'SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?',[table]);
      if(!existing.length)throw Error('Migration preflight BLOCKED; table missing: '+table);
    }
    const [migrations]=await connection.query(
      'SELECT version FROM schema_migrations WHERE version IN (?,?) ORDER BY version',
      ['046','047']
    );
    if(migrations.length!==2)throw Error('Migrations 046–047 have not both been applied to test DB');
  } finally { await connection.end(); }
  console.log('B6 release database identity and migration preflight passed');
  let passed=0;
  for(const file of [...new Set(suites)]) {
    console.log('Running '+file);
    const result=spawnSync(process.execPath,[path.join(root,'tests',file)],{
      cwd:root,env:{...process.env,NODE_ENV:'test',TEST_DB_NAME:TEST_DB},stdio:'inherit'
    });
    if(result.error)throw result.error;
    if(result.status!==0)throw Error('FAIL: '+file+' (exit '+result.status+')');
    passed++;
  }
  console.log('B6 RELEASE SUITES PASSED: '+passed+'/'+[...new Set(suites)].length);
})().catch(error=>{console.error('B6 RELEASE GATE BLOCKED/FAILED:',error.message);process.exitCode=1;});
