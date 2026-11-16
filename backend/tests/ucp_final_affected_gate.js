'use strict';
// One consolidated, bounded affected-suite gate. Full provider/browser acceptance
// is separate; passing this runner must never be presented as a full release.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
for(const [key,value] of Object.entries({NODE_ENV:'test',DB_NAME:'miljor_test_db',
  TEST_DB_NAME:'miljor_test_db',MILJOR_TEST_ONLY_MIGRATIONS:'1',ALLOW_EXTERNAL_MONEY_MOVEMENT:'false'}))
  assert.equal(process.env[key],value,'Explicit test isolation required: '+key);
const directory=path.resolve(__dirname,'../logs/ucp-affected-gate');
fs.mkdirSync(directory,{recursive:true});
const npm=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const gates=[
  ['migration-audit',['database/readOnlyMigrationAudit.js','--test-only']],
  ['source',[npm,'run','test:ucp']],
  ['completion',[npm,'run','test:ucp:completion']],
  ['phase-ab-contract',[npm,'run','test:ucp:phaseab']],
  ['review-regressions',[npm,'run','test:ucp:reviewfixes']],
  ['native-notification-actions',[npm,'run','test:ucp:nativeactions']],
  ['notification-mysql',['tests/ucp_notification_mysql_gate.js']],
  ['notification-controls-mysql',['tests/ucp_notification_controls_mysql_gate.js']],
  ['checkout-initiation-mysql',['tests/checkout_initiation_isolated_mysql_gate.js']],
  ['regular-recovery-mysql',['tests/ucp_regular_recovery_mysql_gate.js']],
  ['flash-delivery-stock-50',['tests/part5_flash_pool_gate.js']],
  ['payment-fulfillment-settlement',['tests/p0_payment_fulfillment_settlement_http_e2e.js'],{SAFEPAY_WEBHOOK_SECRET:'p0-only-synthetic-safepay-callback-key-2026'}],
  ['payment-refund-concurrency',['tests/sandbox_payment_refund_stress_gate.js'],{SAFEPAY_WEBHOOK_SECRET:'ci-synthetic-safepay-stress-only-2026'}],
  ['regular-flash-shared-stock',['tests/p0_same_sku_publication_stress_gate.js']]
];
const resultsFile=path.join(directory,'results.json');
const resume=process.env.UCP_AFFECTED_FROM_GATE;
const startIndex=resume?gates.findIndex(gate=>gate[0]===resume):0;
assert.ok(startIndex>=0,'Unknown affected gate resume point');
let results=[];
if(startIndex){
  const previous=JSON.parse(fs.readFileSync(resultsFile,'utf8'));
  results=previous.slice(0,startIndex);
  assert.equal(results.length,startIndex,'Missing earlier gate evidence');
  results.forEach((entry,index)=>assert.ok(entry.name===gates[index][0]&&entry.status==='PASS','Earlier gate did not pass'));
  fs.writeFileSync(path.join(directory,'results-before-resume-'+Date.now()+'.json'),JSON.stringify(previous,null,2));
}
for(const [name,args,environment={}] of gates.slice(startIndex)){
  const start=Date.now();
  const result=spawnSync(process.execPath,args,{cwd:path.resolve(__dirname,'..'),env:{...process.env,...environment},
    encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});
  const log=path.join(directory,name+'.log');
  fs.writeFileSync(log,(result.stdout||'')+(result.stderr||''));
  const entry={name,status:result.status===0?'PASS':'FAIL',exitCode:result.status,
    durationMs:Date.now()-start,log,error:result.error?.code||null};
  results.push(entry);
  console.log(JSON.stringify(entry));
  fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify(results,null,2));
  if(entry.status==='FAIL'){
    console.error(fs.readFileSync(log,'utf8').slice(-5000));
    process.exitCode=1;break;
  }
}
