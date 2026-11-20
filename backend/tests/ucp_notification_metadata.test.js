'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
// Prevent loading database configuration (including dotenv and mysql) at all.
const dbPath = require.resolve('../src/config/db');
require.cache[dbPath] = {id:dbPath,filename:dbPath,loaded:true,exports:{
  query(){throw Error('Real database forbidden');},getConnection(){throw Error('Real database forbidden');}
}};
const {NotificationService} = require('../src/services/notificationService');
const writer = require('../src/services/ucpTransactionalNotifications');
const service = new NotificationService({});
const sqlTime = '2026-11-16T12:34:56.123000Z';
function connection() {
  const rows = new Map(), calls = [];
  let snapshot;
  return {rows,calls,failRecipient:null,
    async beginTransaction(){snapshot = new Map(rows);},
    async commit(){snapshot = undefined;},
    async rollback(){rows.clear();for(const [key,value] of snapshot)rows.set(key,value);},
    async query(sql,args=[]) {
      calls.push({sql,args});
      if(sql.includes('UTC_TIMESTAMP(3)'))return [[{occurred_at:sqlTime}]];
      if(sql.includes('FROM users'))return [[{id:args[0],role:Number(args[0])===2?'SUPPLIER':'BUYER'}]];
      if(sql.includes('INSERT INTO procurement_notifications')) {
        if(args[0]===this.failRecipient)throw Error('INJECTED_OUTBOX_FAILURE');
        const key=args[0]+':'+args[2];
        if(rows.has(key))return [{affectedRows:0}];
        rows.set(key,JSON.parse(args[4]));return [{affectedRows:1}];
      }
      throw Error('Unexpected SQL: '+sql);
    }
  };
}
const legacy = () => ({userId:1,role:'BUYER',eventType:'PAYMENT.FAILED',eventKey:'event:1',entityId:9});
const metadata = () => ({...legacy(),schemaVersion:2,eventId:'event:1',aggregateId:'order-9',aggregateVersion:1,
  actorId:'SYSTEM',actorRole:'SYSTEM',causationId:'cause:1',correlationId:'order-9'});
const batch = () => ({type:'PAYMENT.FAILED',aggregateId:'order-9',aggregateVersion:1,transitionId:'transition:1',
  recipients:[{userId:1,role:'BUYER'},{userId:2,role:'SUPPLIER'}],title:'Payment failed',message:'Review your order',
  payload:{order_id:9,status:'FAILED'},actorId:'SYSTEM',actorRole:'SYSTEM'});

test('v1 direct and adapter callers retain their exact payload and do not read a clock',async()=>{
  const c=connection();await service.enqueueEvent(c,legacy());
  assert.deepEqual([...c.rows.values()],[{entityId:9,schemaVersion:1}]);
  const input=batch();delete input.actorId;delete input.actorRole;
  await writer.recordInAppOnConnection(c,input);
  assert.ok([...c.rows.values()].every(row=>JSON.stringify(row)==='{"entityId":9,"schemaVersion":1}'));
  assert.equal(c.calls.filter(call=>call.sql.includes('UTC_TIMESTAMP')).length,0);
});

const invalid = {
  'unsupported schema':{schemaVersion:3},'string schema':{schemaVersion:'2'},'v1 downgrade':{schemaVersion:1},
  'missing event ID':{eventId:undefined},'different event ID':{eventId:'other'},'long event ID':{eventId:'a'.repeat(129)},
  'missing aggregate':{aggregateId:undefined},'empty aggregate':{aggregateId:''},'long aggregate':{aggregateId:'a'.repeat(121)},
  'object aggregate':{aggregateId:{}},'control ID':{causationId:'a\n'},'whitespace ID':{correlationId:' '},
  'long causation':{causationId:'a'.repeat(129)},'long correlation':{correlationId:'a'.repeat(129)},
  'missing causation':{causationId:undefined},'missing correlation':{correlationId:undefined},
  'null causation':{causationId:null},'null correlation':{correlationId:null},
  'missing version':{aggregateVersion:undefined},'negative version':{aggregateVersion:-1},
  'string version':{aggregateVersion:'1'},'fractional version':{aggregateVersion:1.2},
  'NaN version':{aggregateVersion:NaN},'unsafe version':{aggregateVersion:Number.MAX_SAFE_INTEGER+1},
  'missing actor':{actorId:undefined},'null actor':{actorId:null},'zero actor':{actorId:0},
  'NaN actor':{actorId:NaN},'object actor':{actorId:{}},'negative actor':{actorId:-1},
  'unsafe actor':{actorId:Number.MAX_SAFE_INTEGER+1},'fractional actor':{actorId:1.1},
  'missing role':{actorRole:undefined},'system role mismatch':{actorRole:'BUYER'},
  'NaN system role':{actorRole:NaN},'NaN user role':{actorId:1,actorRole:NaN},
  'user claiming system':{actorId:1},'persisted role mismatch':{actorId:1,actorRole:'SUPPLIER'},
  'unknown role':{actorId:1,actorRole:'ROOT'},'null time':{occurredAt:null},'empty time':{occurredAt:''},
  'numeric time':{occurredAt:1},'date-only time':{occurredAt:'2026-11-16'},
  'invalid calendar date':{occurredAt:'2026-02-30T12:00:00Z'},'invalid time':{occurredAt:'not-a-time'}
};
for(const [name,patch] of Object.entries(invalid))test('rejects '+name+' without writing',async()=>{
  const c=connection();await assert.rejects(service.enqueueEvent(c,{...metadata(),...patch}),/Invalid notification/);
  assert.equal(c.rows.size,0);
});

test('direct v2 requires both causation and correlation properties',async()=>{
  for(const field of ['causationId','correlationId']){
    const c=connection(),input=metadata();delete input[field];
    await assert.rejects(service.enqueueEvent(c,input),new RegExp('Invalid notification '+field));
    assert.equal(c.rows.size,0);
  }
});

test('same-key changed actor is deduplicated, never inserted or substituted for original evidence',async()=>{
  const c=connection();await service.enqueueEvent(c,metadata());
  const original=structuredClone([...c.rows]);
  const [result]=await service.enqueueEvent(c,{...metadata(),actorId:2,actorRole:'SUPPLIER'});
  assert.equal(result.affectedRows,0);
  assert.deepEqual([...c.rows],original);
  assert.equal([...c.rows.values()][0].actorId,'SYSTEM');
});

test('fallback occurrence replay preserves first evidence when the SQL clock advances',async()=>{
  const c=connection();await service.enqueueEvent(c,metadata());
  const original=structuredClone([...c.rows]),query=c.query.bind(c);
  c.query=(sql,args)=>sql.includes('UTC_TIMESTAMP(3)')?
    Promise.resolve([[{occurred_at:'2026-11-17T00:00:00.000000Z'}]]):query(sql,args);
  const [result]=await service.enqueueEvent(c,metadata());
  assert.equal(result.affectedRows,0);assert.deepEqual([...c.rows],original);
});

test('every metadata field opts into v2 rather than silently dropping incomplete metadata',async()=>{
  for(const patch of [{schemaVersion:2},{actorRole:'SYSTEM'},{aggregateVersion:1},{occurredAt:sqlTime}]) {
    const c=connection();await assert.rejects(service.enqueueEvent(c,{...legacy(),...patch}),/Invalid notification/);
    assert.equal(c.rows.size,0);
  }
});
test('SQL clock fills missing time; valid user actor is checked on the supplied transaction',async()=>{
  const c=connection();await service.enqueueEvent(c,{...metadata(),actorId:'2',actorRole:'SUPPLIER',aggregateVersion:0});
  const row=[...c.rows.values()][0];
  assert.equal(row.occurredAt,'2026-11-16T12:34:56.123Z');assert.equal(row.actorId,2);assert.equal(row.aggregateVersion,0);
  assert.ok(c.calls.some(call=>call.sql.includes('FROM users')&&call.args[0]===2));
});
test('explicit occurrence is validated and preserved without a clock query',async()=>{
  const c=connection();await service.enqueueEvent(c,{...metadata(),occurredAt:'2026-11-15T10:20:30.456Z'});
  assert.equal([...c.rows.values()][0].occurredAt,'2026-11-15T10:20:30.456Z');
  assert.equal(c.calls.filter(call=>call.sql.includes('UTC_TIMESTAMP')).length,0);
});
test('missing actor record is rejected',async()=>{
  const c=connection(),query=c.query.bind(c);
  c.query=(sql,args)=>sql.includes('FROM users')&&args[0]===3?Promise.resolve([[]]):query(sql,args);
  await assert.rejects(service.enqueueEvent(c,{...metadata(),actorId:3,actorRole:'BUYER'}),/Invalid notification actor/);
  assert.equal(c.rows.size,0);
});
test('adapter shares SQL occurrence and deterministic identity across recipients; replay keeps original evidence',async()=>{
  const c=connection(),input=batch(),original=structuredClone(input);
  const first=await writer.recordInAppOnConnection(c,input);
  const evidence=[...c.rows.values()].map(row=>({...row}));
  assert.equal(first.inserted,2);assert.equal(evidence[0].eventId,first.eventKey);
  assert.deepEqual(evidence[0],evidence[1]);assert.equal(evidence[0].occurredAt,'2026-11-16T12:34:56.123Z');
  assert.equal(c.calls.filter(call=>call.sql.includes('UTC_TIMESTAMP')).length,1);
  const replay=await writer.recordInAppOnConnection(c,{...input,occurredAt:'2026-11-17T00:00:00Z'});
  assert.equal(replay.inserted,0);assert.equal(replay.eventKey,first.eventKey);
  assert.deepEqual([...c.rows.values()],evidence);assert.deepEqual(input,original);
});
test('adapter rejects incomplete actor, invalid identity and explicit invalid optional IDs',async()=>{
  for(const patch of [{actorId:undefined},{actorRole:undefined},{aggregateId:{}},{aggregateId:'a'.repeat(121)},
    {transitionId:{}},{transitionId:'a'.repeat(129)},{causationId:''},{correlationId:null},{schemaVersion:3},
    {schemaVersion:1},{occurredAt:''}]) {
    const c=connection();await assert.rejects(writer.recordInAppOnConnection(c,{...batch(),...patch}));
    assert.equal(c.rows.size,0);
  }
});
test('caller rollback removes all recipient writes and its domain mutation after a later enqueue failure',async()=>{
  const c=connection();c.rows.set('existing',{evidence:'preserved'});await c.beginTransaction();
  c.rows.set('domain',{status:'FAILED'});c.failRecipient=2;
  await assert.rejects(writer.recordInAppOnConnection(c,batch()),/INJECTED_OUTBOX_FAILURE/);
  assert.equal(c.rows.size,3,'failure occurs after the domain mutation and first recipient insert');
  await c.rollback();assert.deepEqual([...c.rows],[['existing',{evidence:'preserved'}]]);
  c.failRecipient=null;await c.beginTransaction();
  assert.equal((await writer.recordInAppOnConnection(c,batch())).inserted,2);await c.commit();
});
