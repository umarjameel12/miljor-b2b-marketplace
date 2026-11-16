'use strict';
// Mock SQL contract + real local HTTP routing tests. NOT MySQL/SQL evidence.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const express=require('express');
process.env.NODE_ENV='test';
const {ProcurementDeliveryEvidenceService,MAX_BYTES,MAX_FILES}=require('../src/services/procurementDeliveryEvidenceService');
const buyer={id:7,role:'BUYER'},supplier={id:11,role:'SUPPLIER'};
const png=Buffer.from('89504e470d0a1a0a00000000','hex');
const payload=(bytes=png,mime='image/png')=>({mime_type:mime,content_base64:bytes.toString('base64')});
function fixture({dbName='miljor_test_db',notifyFails=false,failSecondNotice=false}={}){
  const state={proofs:[],notices:[],orders:[{id:1,buyer_id:7,supplier_id:11,payment_status:'PAID',fulfillment_status:'DISPATCHED'},
    {id:2,buyer_id:7,supplier_id:11,payment_status:'PAID',fulfillment_status:'EXCEPTION'}],calls:[],commits:0,rollbacks:0,releases:0};
  let tail=Promise.resolve();
  const query=async function(sql,args=[]){
    state.calls.push(sql);
    if(sql==='SELECT DATABASE() AS db_name')return [[{db_name:dbName}]];
    if(sql.startsWith('SELECT id FROM users')){assert.match(sql,/ORDER BY id FOR UPDATE/);assert.deepEqual(args,[7,11]);return [[{id:7},{id:11}]];}
    if(sql.includes('FROM orders o')){
      if(this.active)assert.match(sql,/FOR UPDATE/);
      const column=sql.match(/o\.(buyer_id|supplier_id)=\?/)[1];
      return [state.orders.filter(row=>row.id===args[0]&&row[column]===args[1])];
    }
    const proofs=this.active?this.proofs:state.proofs;
    if(sql.includes('WHERE uploader_id=? AND idempotency_key=?'))return [proofs.filter(p=>p.uploader_id===args[0]&&p.idempotency_key===args[1])];
    if(sql.startsWith('SELECT COUNT(*)'))return [[{total:proofs.filter(p=>p.order_id===args[0]).length}]];
    if(sql.startsWith('INSERT INTO procurement_delivery_evidence')){
      assert.equal(this.active,true);
      const [order_id,uploader_id,proof_code,mime_type,byte_length,content_sha256,content_bytes,idempotency_key]=args;
      const row={id:proofs.length+1,order_id,uploader_id,proof_code,mime_type,byte_length,content_sha256,content_bytes:Buffer.from(content_bytes),idempotency_key,created_at:'2026-11-16 12:00:00'};
      proofs.push(row);return [{insertId:row.id}];
    }
    if(sql.includes('FROM procurement_delivery_evidence')){
      const found=proofs.filter(p=>p.order_id===args[0]&&(args[1]==null||p.id===args[1]));
      if(!sql.includes('content_bytes'))return [found.map(({content_bytes,idempotency_key,...metadata})=>metadata)];
      return [found];
    }
    throw Error('Unexpected mock SQL: '+sql);
  };
  const db={query,async getConnection(){return {query,active:false,
    async beginTransaction(){let unlock;const next=new Promise(resolve=>{unlock=resolve;});const before=tail;tail=next;await before;this.unlock=unlock;this.active=true;this.proofs=[...state.proofs];this.notices=[...state.notices];},
    async commit(){state.proofs=this.proofs;state.notices=this.notices;state.commits++;this.active=false;this.unlock();},
    async rollback(){state.rollbacks++;if(this.active){this.active=false;this.unlock();}},
    release(){state.releases++;}};}};
  const notifier={async enqueueEvent(conn,event){assert.equal(conn.active,true);assert.ok(conn.proofs.length>0);if(notifyFails||(failSecondNotice&&conn.notices.length===1))throw Error('outbox unavailable');conn.notices.push(event);}};
  return {state,service:new ProcurementDeliveryEvidenceService(db,notifier)};
}
const upload=(f,body=payload(),key='proof-intent-001',actor=buyer,orderId=1)=>f.service.upload({actor,orderId,input:body,idempotencyKey:key});
test('stores actual bytes/hash and atomically notifies both own parties; replay is stable',async()=>{
  const f=fixture(),first=await upload(f),again=await upload(f);
  assert.equal(first.is_replay,false);assert.equal(again.is_replay,true);
  assert.equal(first.proof.id,again.proof.id);assert.equal(f.state.proofs.length,1);
  assert.deepEqual(f.state.proofs[0].content_bytes,png);
  assert.equal(f.state.proofs[0].content_sha256,crypto.createHash('sha256').update(png).digest('hex'));
  assert.deepEqual(f.state.notices.map(e=>[e.userId,e.role,e.eventType,e.entityId]),[[7,'BUYER','PROOF_UPLOADED',1],[11,'SUPPLIER','PROOF_UPLOADED',1]]);
  assert.ok(f.state.notices.every(e=>e.eventKey.includes(first.proof.proof_code)));
  assert.equal('content_bytes' in first.proof,false);assert.equal('idempotency_key' in first.proof,false);
});
test('key reuse rejects changed order, MIME or content',async()=>{
  const f=fixture();await upload(f);
  for(const [body,oid] of [[payload(Buffer.concat([png,Buffer.from('x')])),1],[payload(png),2],
    [payload(Buffer.from('%PDF-1.7\n%%EOF'),'application/pdf'),1]])
    await assert.rejects(upload(f,body,'proof-intent-001',buyer,oid),{code:'EVIDENCE_KEY_CONFLICT'});
  assert.equal(f.state.proofs.length,1);assert.equal(f.state.notices.length,2);
});
test('rejects bad magic, MIME, base64, empty/oversize content and remote URL inputs before DB',async()=>{
  const f=fixture();
  for(const body of [payload(Buffer.from('not png')),payload(png,'text/html'),payload(Buffer.alloc(0)),
    {mime_type:'image/png',content_base64:'@@@@'}, {mime_type:'image/png',content_base64:'aGVsbG8'},
    payload(Buffer.alloc(MAX_BYTES+1)),{...payload(),url:'http://127.0.0.1/private'}])
    await assert.rejects(upload(f,body),e=>[400,413,415].includes(e.statusCode));
  assert.equal(f.state.calls.length,0);
});
test('accepts exactly 1 MiB and each allowed magic/MIME pair',async()=>{
  const f=fixture();
  const max=Buffer.alloc(MAX_BYTES);png.copy(max);
  await upload(f,payload(max),'max-size-001');
  await upload(f,payload(Buffer.from('ffd8ff0011','hex'),'image/jpeg'),'jpeg-proof-001');
  await upload(f,payload(Buffer.from('%PDF-1.7\n%%EOF'),'application/pdf'),'pdf-proof-001');
  assert.equal(f.state.proofs[0].byte_length,MAX_BYTES);assert.equal(f.state.proofs.length,3);
});
test('buyer/supplier ownership, paid and fulfillment gates fail closed',async()=>{
  const f=fixture();
  for(const actor of [{id:8,role:'BUYER'},{id:12,role:'SUPPLIER'},{id:7,role:'ADMIN'}])
    await assert.rejects(upload(f,payload(),'proof-intent-001',actor),e=>[403,404].includes(e.statusCode));
  f.state.orders[0].payment_status='PENDING';await assert.rejects(upload(f),{code:'EVIDENCE_ORDER_NOT_ELIGIBLE'});
  f.state.orders[0].payment_status='PAID';f.state.orders[0].fulfillment_status='PREPARING';
  await assert.rejects(upload(f),{code:'EVIDENCE_ORDER_NOT_ELIGIBLE'});
  f.state.orders[0].fulfillment_status='SUPPLIER_DELIVERED';await upload(f,payload(),'supplier-proof-001',supplier);
  assert.equal(f.state.proofs.length,1);
});
test('order cap is serialized in mock transactions; same-key replay bypasses full cap',async()=>{
  const f=fixture();
  const results=await Promise.allSettled(Array.from({length:MAX_FILES+1},(_,i)=>upload(f,payload(),'parallel-proof-'+i)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,MAX_FILES);
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'EVIDENCE_LIMIT_REACHED');
  assert.equal((await upload(f,payload(),'parallel-proof-0')).is_replay,true);
  assert.equal(f.state.proofs.length,MAX_FILES);
});
test('outbox failure rolls back proof and notifications',async()=>{
  for(const options of [{notifyFails:true},{failSecondNotice:true}]){
    const f=fixture(options);await assert.rejects(upload(f),/outbox unavailable/);
    assert.equal(f.state.proofs.length,0);assert.equal(f.state.notices.length,0);
    assert.equal(f.state.rollbacks,1);assert.equal(f.state.releases,1);
  }
});
test('simultaneous same-key retries create one proof in simulated transactions',async()=>{
  const f=fixture();const results=await Promise.all([upload(f),upload(f)]);
  assert.deepEqual(results.map(r=>r.is_replay),[false,true]);assert.equal(f.state.proofs.length,1);
  assert.equal(f.state.notices.length,2);
});
test('invalid key and actor ID cannot reach storage',async()=>{
  const f=fixture();
  for(const key of ['',null,'x'.repeat(121),'with spaces'])await assert.rejects(upload(f,payload(),key),{code:'EVIDENCE_KEY_REQUIRED'});
  await assert.rejects(upload(f,payload(),'valid-key',{id:'7 OR 1=1',role:'BUYER'}),{code:'INVALID_EVIDENCE_ID'});
  assert.equal(f.state.calls.length,0);
});
test('test-mode uploads reject protected database identity before writes',async()=>{
  const f=fixture({dbName:'miljor_db'});await assert.rejects(upload(f),{code:'EVIDENCE_TEST_DATABASE_REQUIRED'});
  assert.equal(f.state.proofs.length,0);assert.equal(f.state.releases,1);
});
test('private list omits bytes and download returns exact buffer for either owner',async()=>{
  const f=fixture();const result=await upload(f);
  for(const actor of [buyer,supplier]){
    const list=await f.service.list({actor,orderId:1});assert.equal(list.length,1);
    assert.equal('content_bytes' in list[0],false);assert.equal('content_base64' in list[0],false);
    const proof=await f.service.download({actor,orderId:1,evidenceId:result.proof.id});assert.deepEqual(proof.content_bytes,png);
  }
  for(const operation of ['list','download'])await assert.rejects(f.service[operation]({actor:{id:8,role:'BUYER'},orderId:1,evidenceId:1}),{statusCode:404});
  await assert.rejects(f.service.download({actor:buyer,orderId:2,evidenceId:1}),{statusCode:404});
});
test('corrupted stored bytes fail download integrity check',async()=>{
  const f=fixture();await upload(f);f.state.proofs[0].content_bytes=Buffer.alloc(png.length);
  await assert.rejects(f.service.download({actor:buyer,orderId:1,evidenceId:1}),{code:'EVIDENCE_INTEGRITY_ERROR'});
});
function router(service){
  const module={exports:{}};
  new Function('module','exports','require',fs.readFileSync(path.resolve(__dirname,'../src/routes/v1/procurementDeliveryEvidenceRoutes.js'),'utf8'))(module,module.exports,id=>{
    if(id==='express')return express;
    if(id==='../../services/procurementDeliveryEvidenceService')return service;
    if(id==='../../middlewares/authGuard')return {protect(req,res,next){
      const [role,actorId]=(req.headers['x-test-actor']||'').split(':');
      if(!actorId)return res.status(401).json({success:false});req.user={role,id:Number(actorId)};next();
    },authorizeStrict(...roles){return (req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({success:false});}};
    throw Error('Unexpected route dependency '+id);
  });return module.exports;
}
test('local HTTP API uploads, lists metadata, serves private attachments and rejects peers',async t=>{
  const f=fixture(),app=express();app.use('/api/v1',router(f.service));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>new Promise((resolve,reject)=>{server.close(e=>e?reject(e):resolve());server.closeAllConnections();}));
  const base=`http://127.0.0.1:${server.address().port}/api/v1/procurement/orders/1/evidence`;
  const headers={'x-test-actor':'BUYER:7','content-type':'application/json','X-Idempotency-Key':'api-proof-001'};
  const response=await fetch(base,{method:'POST',headers,body:JSON.stringify(payload())});
  assert.equal(response.status,201);const stored=await response.json();assert.equal(stored.success,true);
  const replay=await fetch(base,{method:'POST',headers,body:JSON.stringify(payload())});assert.equal(replay.status,200);await replay.text();
  const listing=await fetch(base,{headers});assert.equal(listing.status,200);assert.doesNotMatch(await listing.text(),/content_bytes|content_base64/);
  const file=await fetch(base+'/'+stored.data.proof.id,{headers:{'x-test-actor':'SUPPLIER:11'}});
  assert.equal(file.status,200);assert.match(file.headers.get('content-disposition'),/^attachment; filename="MJPROOF-[a-f0-9]+\.png"$/);
  assert.equal(file.headers.get('content-type'),'image/png');assert.equal(file.headers.get('x-content-type-options'),'nosniff');
  assert.match(file.headers.get('content-security-policy'),/sandbox/);assert.equal(file.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(Buffer.from(await file.arrayBuffer()),png);
  for(const actor of ['BUYER:8','SUPPLIER:12','ADMIN:7','']){
    const peer=await fetch(base+'/'+stored.data.proof.id,{headers:{'x-test-actor':actor}});assert.ok([401,403,404].includes(peer.status));await peer.text();
  }
  const oversized=await fetch(base,{method:'POST',headers,body:JSON.stringify(payload(Buffer.alloc(MAX_BYTES+100000)))});
  assert.equal(oversized.status,413);await oversized.text();
  const malformed=await fetch(base,{method:'POST',headers,body:'{invalid'});
  assert.equal(malformed.status,400);assert.equal((await malformed.json()).error.code,'INVALID_EVIDENCE_JSON');
  const ssrf=await fetch(base,{method:'POST',headers,body:JSON.stringify({...payload(),url:'http://169.254.169.254/'})});
  assert.equal(ssrf.status,400);await ssrf.text();
});
