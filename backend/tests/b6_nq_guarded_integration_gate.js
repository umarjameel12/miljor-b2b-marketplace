'use strict';
// B6-only controlled integration launcher. Never migrates a database.
// Explicitly refuses release verification unless the test DB and original B6
// migration identities are present. No production DB connection is attempted.
const {spawnSync}=require('node:child_process');
const path=require('node:path');
require('dotenv').config({path:path.join(__dirname,'..','.env')});
const mysql=require('mysql2/promise');

const TEST_DB='miljor_test_db';
const expected=new Map([
  ['046','046_recurring_collective_cycles.sql'],
  ['047','047_procurement_delivery_runs.sql'],
  ['048','048_procurement_notification_outbox.sql']
]);
const suites=[
  'b6_procurement_request_lifecycle_gate.js',
  'b6_procurement_collective_lifecycle_gate.js',
  'b6_collective_bid_lifecycle_gate.js',
  'b6_procurement_recurring_lifecycle_gate.js',
  'b6_recurring_cycle_draft_gate.js',
  'b6_procurement_http_concurrency_gate.js'
];
function blocked(reason){
  const err=new Error('B6_INTEGRATION_BLOCKED: '+reason);
  err.code='B6_INTEGRATION_BLOCKED';
  throw err;
}
async function validateReadOnly(){
  if(process.env.B6_ALLOW_TEST_DB_INTEGRATION!=='YES')
    blocked('explicit B6_ALLOW_TEST_DB_INTEGRATION=YES required');
  if(process.env.DB_NAME!==TEST_DB || process.env.TEST_DB_NAME!==TEST_DB)
    blocked('both DB_NAME and TEST_DB_NAME must explicitly equal miljor_test_db');
  if(!process.env.DB_HOST||!process.env.DB_USER)
    blocked('DB_HOST and DB_USER must be configured for isolated test database');
  const conn=await mysql.createConnection({
    host:process.env.DB_HOST,user:process.env.DB_USER,
    password:process.env.DB_PASSWORD||'',database:TEST_DB
  });
  try{
    const [[identity]]=await conn.query('SELECT DATABASE() AS db_name');
    if(identity.db_name!==TEST_DB)blocked('connected database name mismatch');
    const [rows]=await conn.query(
      "SELECT version,name FROM schema_migrations WHERE version IN ('046','047','048')");
    const actual=new Map(rows.map(row=>[String(row.version).padStart(3,'0'),row.name]));
    for(const [version,filename] of expected){
      if(actual.get(version)!==filename)
        blocked('migration '+version+' missing or incompatible: expected '+filename+
          ', observed '+(actual.get(version)||'NOT_APPLIED'));
    }
    const [tables]=await conn.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('procurement_recurring_collectives','procurement_recurring_collective_cycles','procurement_delivery_runs','procurement_delivery_stops','procurement_notifications')");
    if(tables.length!==5)blocked('one or more B6-N/Q schema tables missing');
    // Do not create/update migration records or touch protected databases.
    return {database:identity.db_name,migrations:Object.fromEntries(actual)};
  }finally{await conn.end()}
}
async function main(){
  const preflight=await validateReadOnly();
  console.log('B6 TEST DATABASE PREFLIGHT PASS '+JSON.stringify(preflight));
  for(const file of suites){
    const child=spawnSync(process.execPath,[path.join(__dirname,file)],{
      cwd:path.join(__dirname,'..'),encoding:'utf8',
      env:{...process.env,DB_NAME:TEST_DB,TEST_DB_NAME:TEST_DB,NODE_ENV:'test'},
      timeout:180000,maxBuffer:8*1024*1024
    });
    if(child.stdout)process.stdout.write(child.stdout);
    if(child.stderr)process.stderr.write(child.stderr);
    if(child.error||child.signal||child.status!==0){
      blocked('integration gate '+file+' failed: '+(child.error?.message||child.signal||child.status));
    }
    console.log('B6 TEST DB SUITE EXIT 0: '+file);
  }
  console.log('B6 DB/HTTP LAUNCHER COMPLETED; release still requires frontend, payment, shared stock and cross-branch migration reconciliation.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
