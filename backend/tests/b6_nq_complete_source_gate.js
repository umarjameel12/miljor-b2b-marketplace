'use strict';
// B6-N/Q isolated gate. Every assertion is counted from the ACTUAL child output.
// No MySQL connection, API server, payment gateway or production data is touched here.
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');

const suites=Object.freeze([
  ['b6_collective_recurring_policy_gate.js',14],
  ['b6_collective_recurring_worker_gate.js',8],
  ['b6_delivery_group_policy_gate.js',16],
  ['b6_preorder_notification_policy_gate.js',12],
  ['b6_collective_cycle_join_gate.js',11],
  ['b6_collective_join_cutoff_gate.js',9],
  ['b6_paid_delivery_acceptance_gate.js',11]
]);
let actualTotal=0;
let failed=0;
const results=[];
for(const [file,expected] of suites){
  const target=path.join(__dirname,file);
  if(!fs.existsSync(target)){
    failed++;
    results.push({suite:file,status:'MISSING',actual:0,expected});
    console.error('FAIL missing suite: '+file);
    continue;
  }
  const child=spawnSync(process.execPath,[target],{
    cwd:path.resolve(__dirname,'..'),
    env:{...process.env,NODE_ENV:'test'},
    encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024
  });
  if(child.stdout)process.stdout.write(child.stdout);
  if(child.stderr)process.stderr.write(child.stderr);
  const actual=(child.stdout||'').split(/\r?\n/).filter(line=>/^PASS\s+\d+\s/.test(line)).length;
  actualTotal+=actual;
  const ok=!child.error&&!child.signal&&child.status===0&&actual===expected;
  if(!ok){
    failed++;
    console.error('FAIL '+file+': actual='+actual+' expected='+expected+
      ' exit='+child.status+' signal='+(child.signal||'none')+
      (child.error?' error='+child.error.message:''));
  }
  results.push({suite:file,status:ok?'PASS':'FAIL',actual,expected,exit_code:child.status});
}
const expectedTotal=suites.reduce((n,[,expected])=>n+expected,0);
console.log('B6-N/Q ISOLATED GATE SUMMARY '+JSON.stringify({
  executed_suites:results.length,passed_suites:results.length-failed,
  actual_assertions:actualTotal,expected_assertions:expectedTotal,
  result:failed===0&&actualTotal===expectedTotal?'PASS':'FAIL',
  suites:results
}));
if(failed||actualTotal!==expectedTotal)process.exitCode=1;
else console.log('SOURCE-ONLY PASS: NOT MySQL, HTTP, financial or browser acceptance.');
