'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
function load(getReport){
  let registered;
  const protect=()=>{},authorizeStrict=(...roles)=>{assert.deepEqual(roles,['BUYER','SUPPLIER']);return ()=>{};};
  const router={get:(...args)=>{registered=args;}};
  const module={exports:{}};
  new Function('module','exports','require',fs.readFileSync(path.resolve(__dirname,'../src/routes/v1/procurementReportingRoutes.js'),'utf8'))(
    module,module.exports,id=>{
      if(id==='express')return {Router:()=>router};
      if(id==='../../middlewares/authGuard')return {protect,authorizeStrict};
      if(id==='../../services/procurementReportingService')return {getReport};
      throw Error('Unexpected dependency '+id);
    });
  assert.equal(registered[0],'/procurement/reports/reliability');
  assert.equal(registered[1],protect);assert.equal(registered.length,4);
  return registered[3];
}
function response(){return {statusCode:200,headers:{},set(k,v){this.headers[k]=v;return this;},
  status(value){this.statusCode=value;return this;},json(value){this.body=value;return this;}};}
test('route forwards authenticated actor only and disables report caching',async()=>{
  const actor={id:7,role:'BUYER'},res=response();
  const handler=load(async(...args)=>{assert.deepEqual(args,[actor]);return {scope:'OWN_BUYER_ORDERS'};});
  await handler({user:actor,query:{buyer_id:8,supplier_id:12},body:{id:99}},res);
  assert.equal(res.statusCode,200);assert.equal(res.headers['Cache-Control'],'no-store');
  assert.deepEqual(res.body,{success:true,data:{scope:'OWN_BUYER_ORDERS'}});
});
test('unexpected SQL failure cannot expose schema or account details',async()=>{
  const handler=load(async()=>{throw Object.assign(Error('secret SQL and database identity'),{code:'ER_NO_SUCH_TABLE'});});
  const res=response();await handler({user:{id:7,role:'BUYER'}},res);
  assert.equal(res.statusCode,500);assert.equal(res.body.success,false);
  assert.equal(res.body.error.code,'PROCUREMENT_REPORT_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(res.body),/secret|ER_NO_SUCH_TABLE/);
});
test('service authorization error retains its safe status',async()=>{
  const handler=load(async()=>{throw Object.assign(Error('Forbidden'),{statusCode:403,code:'REPORT_ACCESS_FORBIDDEN'});});
  const res=response();await handler({user:{id:7,role:'ADMIN'}},res);
  assert.equal(res.statusCode,403);assert.equal(res.body.error.code,'REPORT_ACCESS_FORBIDDEN');
});
