'use strict';
// B7 post-purchase compatibility gate, strictly independent of B4/B5/UCP.
// Existing fulfillment/dispute integration suites are run unchanged and serially.
// No schema migration, settlement, refund, payout or production DB mutation.
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const mysql=require('mysql2/promise');
require('dotenv').config({path:path.resolve(__dirname,'../.env')});

const TEST_DB='miljor_test_db';
const suites=[
 'part4e4_fulfillment_gate.js',
 'part4e5_dispute_gate.js'
];

function blocked(code,detail){const e=new Error(code+': '+detail);e.code=code;throw e;}
async function preflight(){
 if(process.env.B7_ALLOW_ISOLATED_POSTPURCHASE_TESTS!=='YES')
  blocked('B7_TEST_NOT_AUTHORIZED','Set B7_ALLOW_ISOLATED_POSTPURCHASE_TESTS=YES after reviewing disposable fixtures');
 if(process.env.NODE_ENV!=='test'||process.env.TEST_DB_NAME!==TEST_DB)
  blocked('B7_WRONG_DATABASE','NODE_ENV=test and TEST_DB_NAME=miljor_test_db are mandatory');
 if(!process.env.DB_USER)
  blocked('B7_NO_TEST_CREDENTIALS','DB_USER must be supplied for test database');
 if(['miljor_db','miljor_sandbox_db'].includes(process.env.DB_NAME))
  blocked('B7_PROTECTED_DB_CONFIG','Do not carry a protected DB_NAME into this test session');
 const conn=await mysql.createConnection({
  host:process.env.DB_HOST||'localhost',
  user:process.env.DB_USER,
  password:process.env.DB_PASSWORD||'',
  database:TEST_DB
 });
 try{
  const [[row]]=await conn.query('SELECT DATABASE() AS db_name');
  if(row.db_name!==TEST_DB)blocked('B7_WRONG_DATABASE','Unexpected connected database');
  const [tables]=await conn.query(
   "SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('orders','payments','order_disputes','invoices')");
  if(tables.length!==4)blocked('B7_SCHEMA_INCOMPLETE','Expected basic order/payment/dispute/invoice tables');
  return row.db_name;
 }finally{await conn.end()}
}
async function main(){
 const database=await preflight();
 console.log('B7 ISOLATED DB PREFLIGHT PASS: '+database);
 const results=[];
 for(const name of suites){
  const p=path.join(__dirname,name);
  const run=spawnSync(process.execPath,[p],{
   cwd:path.resolve(__dirname,'..'),
   env:{...process.env,NODE_ENV:'test',TEST_DB_NAME:TEST_DB},
   timeout:180000,encoding:'utf8',maxBuffer:16*1024*1024
  });
  if(run.stdout)process.stdout.write(run.stdout);
  if(run.stderr)process.stderr.write(run.stderr);
  const result={suite:name,exit_code:run.status,signal:run.signal||null,
   error:run.error?.message||null,
   result:!run.error&&!run.signal&&run.status===0?'PASS':'FAIL'};
  results.push(result);
  if(result.result!=='PASS')break;
 }
 console.log('B7 POSTPURCHASE ACTUAL SUITE SUMMARY '+JSON.stringify(results));
 if(results.length!==suites.length||results.some(x=>x.result!=='PASS'))process.exitCode=1;
 else console.log('B7 existing fulfillment/dispute gates PASSED; integration with UCP/finance not implied.');
}
main().catch(err=>{console.error('B7 POSTPURCHASE BLOCKED/FAILED:',err.message);process.exitCode=1});
