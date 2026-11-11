#!/usr/bin/env node
'use strict';
// MilJor non-destructive demo readiness check. GET-only; no SQL mutations.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const root = path.resolve(__dirname, '../..');
const backend = process.env.DEMO_BACKEND_URL || 'http://127.0.0.1:5000';
const frontend = process.env.DEMO_FRONTEND_URL || 'http://127.0.0.1:5173';
const results = [];
function record(name, state, detail) { results.push({name,state,detail}); }
function urlFor(base, endpoint) {
  const url = new URL(endpoint, base.endsWith('/') ? base : base + '/');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('Unsafe demo URL');
  if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname) && process.env.DEMO_ALLOW_REMOTE !== 'true') throw Error('Remote URL requires DEMO_ALLOW_REMOTE=true');
  return url;
}
function get(u) {
  const transport = u.protocol === 'https:' ? https : http;
  return new Promise((resolve,reject) => {
    const req = transport.get(u,{timeout:3500,headers:{accept:'application/json,text/html'}},res=>{
      let body='';
      res.on('data',chunk=>{if(body.length<8192)body+=chunk.toString('utf8')});
      res.on('end',()=>resolve({status:res.statusCode,body}));
    });
    req.on('timeout',()=>req.destroy(new Error('Timeout')));
    req.on('error',reject);
  });
}
async function probe(name,base,endpoint,expected) {
  try {
    const result=await get(urlFor(base,endpoint));
    record(name,expected(result)?'PASS':'FAIL','HTTP '+result.status);
  } catch(error){record(name,'BLOCKED',error.code||error.message)}
}
async function main(){
  // Validate both endpoints even when DB is not configured.
  try { urlFor(backend,'/');urlFor(frontend,'/'); }
  catch(e){record('Endpoint configuration','BLOCKED',e.message);}
  if(['miljor_test_db','miljor_sandbox_db'].includes(process.env.DB_NAME))
    record('Requested demo database','PASS',process.env.DB_NAME);
  else record('Approved demo database','BLOCKED','Set DB_NAME explicitly to miljor_test_db (preferred) or miljor_sandbox_db. Never use protected miljor_db.');
  const files=[
    'backend/server.js',
    'backend/src/routes/v1/orderRoutes.js',
    'backend/src/routes/v1/paymentRoutes.js',
    'backend/src/routes/v1/fulfillmentRoutes.js',
    'frontend/src/App.jsx',
    'frontend/src/pages/PoolsPage.jsx',
    'frontend/src/pages/OrdersPage.jsx',
    'frontend/src/pages/SupplierPoolsPage.jsx',
    'frontend/src/pages/SupplierCatalogPage.jsx'
  ];
  for(const file of files)record('Source '+file,fs.existsSync(path.join(root,file))?'PASS':'FAIL',file);
  await probe('Express liveness',backend,'/health/live',r=>r.status===200);
  await probe('MySQL-backed readiness',backend,'/health/ready',r=>r.status===200);
  await probe('Vite frontend',frontend,'/',r=>r.status===200&&/<html|<!doctype/i.test(r.body));
  console.log('MilJor Morning Demo — read-only preflight');
  for(const r of results)console.log('['+r.state+'] '+r.name+': '+r.detail);
  const failed=results.filter(r=>r.state!=='PASS');
  console.log('PASS '+(results.length-failed.length)+'/'+results.length+'; unresolved '+failed.length);
  console.log('NOTE: DB_NAME is a caller-declared target, not proof of the running backend database. Verify backend/.env and live DB connection separately.');
  console.log('NOTE: No purchase, payment, browser E2E or migration was executed by this script.');
  if(failed.length)process.exitCode=1;
}
main().catch(e=>{console.error('BLOCKED: '+e.message);process.exitCode=1});
