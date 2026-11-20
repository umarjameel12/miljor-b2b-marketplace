'use strict';
process.env.NODE_ENV='test';
const assert=require('node:assert/strict');
const test=require('node:test');
const dbPath=require.resolve('../src/config/db');
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{}};
const {ProcurementRequestService}=require('../src/services/procurementRequestService');
function fixture(failOutbox=false){
  const events=[];let committed=false,rolledBack=false;
  const connection={async beginTransaction(){},async commit(){committed=true;},async rollback(){rolledBack=true;events.length=0;},release(){},
    async query(sql,args=[]){
      if(sql.includes('FROM procurement_requests WHERE buyer_id=?'))return [[]];
      if(sql.includes('FROM users'))return [[{id:7,role:'BUYER'}]];
      if(sql.includes('INSERT INTO procurement_requests'))return [{insertId:42}];
      if(sql.includes('INSERT INTO procurement_notifications')){if(failOutbox)throw Error('notification capture unavailable');events.push(args);return [{insertId:1}];}
      if(sql.includes('INSERT INTO procurement_request_items')||sql.includes('UPDATE procurement_requests'))return [{affectedRows:1}];
      throw Error('Unexpected SQL '+sql);
    }
  };
  const service=new ProcurementRequestService({getConnection:async()=>connection});
  service._buyer=async()=>{};service._validateFamilies=async()=>{};
  service._load=async()=>({id:42,buyer_id:7,status:'DRAFT'});
  return {service,events,committed:()=>committed,rolledBack:()=>rolledBack};
}
const input={delivery_area:'Lahore',items:[{family_id:1,unit:'kg',quantity:'2'}]};
test('genuine createDraft captures owner event before commit',async()=>{
  const state=fixture();
  await state.service.createDraft(7,input,'request-test-intent-123');
  assert.equal(state.committed(),true);
  assert.equal(state.events.length,1);
  assert.deepEqual(state.events[0].slice(0,4),[7,'BUYER','request:42:created','REQUEST_CREATED']);
  assert.deepEqual(JSON.parse(state.events[0][4]),{entityId:42,schemaVersion:1});
});
test('outbox failure rejects and rolls back genuine createDraft',async()=>{
  const state=fixture(true);
  await assert.rejects(()=>state.service.createDraft(7,input,'request-test-intent-123'),/notification capture unavailable/);
  assert.equal(state.committed(),false);assert.equal(state.rolledBack(),true);assert.equal(state.events.length,0);
});
