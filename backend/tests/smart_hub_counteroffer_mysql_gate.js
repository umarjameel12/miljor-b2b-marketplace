'use strict';
// Isolated real-MySQL acceptance for the Smart Hub product counteroffer service.
// Only an ephemeral miljor_test_db on CI; never reaches the protected miljor_db.
process.env.NODE_ENV='test';
process.env.TEST_DB_NAME='miljor_test_db';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const mysql=require('mysql2/promise');
const {ProcurementProductCounterofferService}=require('../src/services/procurementProductCounterofferService');
const rejects=(fn,code)=>assert.rejects(fn,e=>e.code===code,code);
const stamp=offset=>new Date(Date.now()+offset).toISOString().slice(0,19).replace('T',' ');
async function run(){
  const options={host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),
    user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||''};
  const admin=await mysql.createConnection({...options,multipleStatements:false});
  // A hard-coded disposable name, not a user-provided target.
  await admin.query('CREATE DATABASE IF NOT EXISTS miljor_test_db');
  const [[identity]]=await admin.query("SELECT 'miljor_test_db' AS db");
  assert.equal(identity.db,'miljor_test_db');
  const database=mysql.createPool({...options,database:'miljor_test_db',connectionLimit:4,timezone:'Z'});
  const queries=[
    'CREATE TABLE procurement_requests (id BIGINT NOT NULL PRIMARY KEY,buyer_id INT NOT NULL,status VARCHAR(20) NOT NULL,quote_deadline DATETIME NOT NULL) ENGINE=InnoDB',
    'CREATE TABLE procurement_quotes (id BIGINT NOT NULL PRIMARY KEY,request_id BIGINT NOT NULL,supplier_id INT NOT NULL,current_version INT NOT NULL,status VARCHAR(20) NOT NULL) ENGINE=InnoDB',
    'CREATE TABLE procurement_quote_versions (id BIGINT NOT NULL PRIMARY KEY,quote_id BIGINT NOT NULL,version_number INT NOT NULL,valid_until DATETIME NOT NULL) ENGINE=InnoDB',
    'CREATE TABLE procurement_quote_lines (id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,quote_version_id BIGINT NOT NULL,request_item_id BIGINT NOT NULL,unit_price DECIMAL(12,2) NOT NULL) ENGINE=InnoDB'
  ];
  try{
    const [[current]]=await database.query('SELECT DATABASE() AS name');
    assert.equal(current.name,'miljor_test_db','FAIL CLOSED: cannot run outside isolated test database');
    // Fresh disposable schema: refuse to overwrite any pre-existing tables.
    const [preexisting]=await database.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE()");
    assert.equal(preexisting.length,0,'Refuse to overwrite an existing test database');
    for(const sql of queries)await database.query(sql);
    const migration=fs.readFileSync(path.resolve(__dirname,'../database/migrations/090_smart_procurement_product_counteroffers.sql'),'utf8');
    await database.query(migration);
    const [tables]=await database.query("SHOW TABLE STATUS LIKE 'procurement_product_counteroffers'");
    assert.equal(tables.length,1);assert.equal(tables[0].Engine,'InnoDB');
    await database.query('INSERT INTO procurement_requests VALUES (10,100,?,?)',['OPEN',stamp(86400000)]);
    await database.query('INSERT INTO procurement_quotes VALUES (20,10,200,1,?)',['ACTIVE']);
    await database.query('INSERT INTO procurement_quote_versions VALUES (30,20,1,?)',[stamp(7200000)]);
    await database.query('INSERT INTO procurement_quote_lines (quote_version_id,request_item_id,unit_price) VALUES (30,11,290.00),(30,12,510.00)');
    const svc=new ProcurementProductCounterofferService(database);
    const offer={version_number:1,lines:[
      {request_item_id:11,proposed_unit_price:'270.00'},
      {request_item_id:12,proposed_unit_price:'490.00'}]};
    await rejects(()=>svc.submit(101,10,20,offer,'test-other-buyer-123456'),'REQUEST_NOT_FOUND');
    await rejects(()=>svc.submit(100,10,20,{...offer,message:'free text'},'test-message-123456'),'UNSUPPORTED_COUNTER_FIELD');
    await rejects(()=>svc.submit(100,10,20,{...offer,version_number:9},'test-stale-123456'),'QUOTE_STALE');
    const created=await svc.submit(100,10,20,offer,'test-buyer-123456');
    assert.equal(created.is_replay,false);assert.equal(created.counteroffers.length,2);
    const replay=await svc.submit(100,10,20,offer,'test-buyer-123456');
    assert.equal(replay.is_replay,true);assert.deepEqual(
      replay.counteroffers.map(x=>Number(x.id)),created.counteroffers.map(x=>Number(x.id)));
    await rejects(()=>svc.submit(100,10,20,{version_number:1,lines:[
      {request_item_id:11,proposed_unit_price:'269.00'}]},'test-buyer-123456'),'IDEMPOTENCY_CONFLICT');
    await rejects(()=>svc.submit(100,10,20,offer,'test-new-key-123456'),'COUNTEROFFER_CONFLICT');
    const inbox=await svc.forSupplier(200);
    assert.equal(inbox.length,2);
    assert.equal(Object.hasOwn(inbox[0],'buyer_id'),false);
    assert.equal((await svc.forSupplier(201)).length,0);
    await rejects(()=>svc.respond(201,created.counteroffers[0].id,{decision:'ACCEPT'}),'COUNTEROFFER_NOT_FOUND');
    const accepted=await svc.respond(200,created.counteroffers[0].id,{decision:'ACCEPT'});
    assert.equal(accepted.counteroffer.decision,'ACCEPT');
    assert.equal(accepted.requires_revised_quote,true);
    const countered=await svc.respond(200,created.counteroffers[1].id,
      {decision:'COUNTER_AGAIN',proposed_unit_price:'500.00'});
    assert.equal(countered.counteroffer.decision,'COUNTER_AGAIN');
    assert.equal(String(countered.counteroffer.supplier_proposed_unit_price),'500.00');
    await rejects(()=>svc.respond(200,created.counteroffers[1].id,{decision:'REJECT'}),'COUNTEROFFER_ALREADY_DECIDED');
    const buyerHistory=await svc.forBuyer(100,10);assert.equal(buyerHistory.length,2);
    await rejects(()=>svc.forBuyer(101,10),'REQUEST_NOT_FOUND');
    // New supplier quotation version invalidates stale proposals and allows a fresh round.
    await database.query('UPDATE procurement_quotes SET current_version=2 WHERE id=20');
    await database.query('INSERT INTO procurement_quote_versions VALUES (31,20,2,?)',[stamp(7200000)]);
    await database.query('INSERT INTO procurement_quote_lines (quote_version_id,request_item_id,unit_price) VALUES (31,11,285.00),(31,12,505.00)');
    await rejects(()=>svc.submit(100,10,20,offer,'test-version-stale-123456'),'QUOTE_STALE');
    const roundTwo={version_number:2,lines:[{request_item_id:11,proposed_unit_price:'260.00'}]};
    const roundTwoOffer=await svc.submit(100,10,20,roundTwo,'test-round-two-123456');
    assert.equal(roundTwoOffer.counteroffers.length,1);
    const rejected=await svc.respond(200,roundTwoOffer.counteroffers[0].id,{decision:'REJECT'});
    assert.equal(rejected.counteroffer.decision,'REJECT');
    assert.equal(rejected.requires_revised_quote,false);
    const concurrent={version_number:2,lines:[{request_item_id:12,proposed_unit_price:'470.00'}]};
    const simultaneous=await Promise.allSettled([
      svc.submit(100,10,20,concurrent,'test-race-first-123456'),
      svc.submit(100,10,20,concurrent,'test-race-second-123456')
    ]);
    assert.equal(simultaneous.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(simultaneous.filter(r=>r.status==='rejected').length,1);
    assert.equal(simultaneous.find(r=>r.status==='rejected').reason.code,'COUNTEROFFER_CONFLICT');
    // Legacy financial workflows are untouched: no order, payment, stock or settlement tables in this fixture.
    const [all]=await database.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('orders','payments','payment_ledger')");
    assert.equal(all.length,0);
    console.log('SMART_HUB_MYSQL_INTEGRATION_PASS: migration, permissions, 2-item offers, replay, conflict, accept, re-counter, reject, stale-version and concurrency gates, history, no financial mutation');
  }finally{
    await database.end();
    await admin.end();
  }
}
run().catch(e=>{console.error('SMART_HUB_MYSQL_INTEGRATION_FAIL',e);process.exitCode=1;});
