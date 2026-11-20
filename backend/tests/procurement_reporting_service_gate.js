'use strict';
// Real reporting service, deterministic mysql2 query contract; no DB/provider imports.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const filename=path.resolve(__dirname,'../src/services/procurementReportingService.js');
const now=new Date('2026-11-16T12:00:00Z');
function load(database){
  const module={exports:{}};
  new Function('module','exports','require',fs.readFileSync(filename,'utf8'))(
    module,module.exports,name=>{assert.equal(name,'../config/db');return database;});
  return new module.exports.ProcurementReportingService(database);
}
const order=(id,extra={})=>({order_id:id,buyer_id:7,supplier_id:11,payment_status:'PAID',
  order_status:'PAID',fulfillment_status:'PREPARING',exception_reason:null,
  delivery_day:'2026-11-15',delivery_window:'09:00-17:00',mode:'STANDARD_CLUSTERED',delivery_confirmed:1,
  supplier_delivered_at:null,event_delivered_at:null,has_partial:0,line_count:2,invoice_count:1,
  ...extra});
function adapter(rows){
  const calls=[];
  return {calls,async query(sql,args){
    calls.push({sql,args});
    assert.match(sql,/^\s*SELECT\b/i);
    assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|FOR UPDATE)\b/i);
    assert.match(sql,/JOIN procurement_awards a ON a.id=ao.award_id AND a.buyer_id=o.buyer_id/);
    assert.match(sql,/ao.supplier_id=o.supplier_id/);
    assert.match(sql,/procurement_award_lines/);
    assert.match(sql,/order_fulfillment_events/);
    assert.match(sql,/invoices/);
    assert.match(sql,/EXISTS\(SELECT 1 FROM procurement_delivery_stops ds\s+JOIN procurement_delivery_runs dr ON dr.id=ds.run_id/);
    assert.match(sql,/ds.order_id=o.id AND ds.buyer_id=o.buyer_id/);
    assert.match(sql,/dr.supplier_id=o.supplier_id/);
    assert.match(sql,/dr.status IN \('CONFIRMED','DISPATCHED','DELIVERED'\)/);
    assert.match(sql,/dr.delivery_day=d.delivery_day/);
    assert.match(sql,/SUBSTRING_INDEX\(dr.delivery_window,'-',1\)>=SUBSTRING_INDEX\(d.delivery_window,'-',1\)/);
    assert.match(sql,/SUBSTRING_INDEX\(dr.delivery_window,'-',-1\)<=SUBSTRING_INDEX\(d.delivery_window,'-',-1\)/);
    assert.match(sql,/procurement_delivery_run_events re.*re.event_type='ROUTE_CONFIRMED'/);
    assert.match(sql,/procurement_line_receipts lr WHERE lr.order_id=o.id AND lr.disputed_quantity>0/);
    assert.match(sql,/dr.mode=d.mode\s+\) AS delivery_confirmed/);
    assert.doesNotMatch(sql,/JOIN procurement_delivery_run_events/); // EXISTS must never multiply orders.
    assert.equal(args.length,1);
    const column=sql.match(/WHERE o\.(buyer_id|supplier_id)=\?/)[1];
    return [rows.filter(row=>row[column]===args[0])];
  }};
}
test('buyer and supplier reports cannot include peer-owned orders',async()=>{
  const db=adapter([order(1),order(2,{buyer_id:8}),order(3,{supplier_id:12})]);
  const service=load(db);
  assert.equal((await service.getReport({id:7,role:'BUYER'},{now})).reliability.total_orders,2);
  assert.equal((await service.getReport({id:11,role:'SUPPLIER'},{now})).reliability.total_orders,2);
  assert.deepEqual(db.calls.map(call=>call.args),[[7],[11]]);
});
test('invalid identities and unsupported roles fail before SQL',async()=>{
  const db=adapter([]),service=load(db);
  for(const actor of [null,{id:7,role:'ADMIN'},{id:'7 OR 1=1',role:'BUYER'},{id:true,role:'BUYER'}])
    await assert.rejects(service.getReport(actor,{now}),error=>error.statusCode===403);
  assert.equal(db.calls.length,0);
});
test('denominator is orders, not lines, invoices or events; outcomes stay separate',async()=>{
  const service=load(adapter([
    order(1,{supplier_delivered_at:'2026-11-15 12:00:00',line_count:9,invoice_count:3}), // end inclusive UTC
    order(2,{supplier_delivered_at:'2026-11-15 12:00:01'}),
    order(3,{has_partial:1,supplier_delivered_at:'2026-11-15 10:00:00'}),
    order(4), // overdue, no delivery
    order(5,{order_status:'CANCELLED'}),
    order(6,{delivery_day:'2026-11-17'}),
    order(7,{delivery_window:null}),
    order(8,{payment_status:'AWAITING_PAYMENT'})
  ]));
  const report=await service.getReport({id:7,role:'BUYER'},{now});
  const r=report.reliability;
  assert.equal(r.total_orders,8);
  assert.equal(r.denominator,4);
  assert.equal(r.on_time,1);assert.equal(r.late,1);assert.equal(r.partial,1);
  assert.equal(r.missed,1);assert.equal(r.cancelled,1);assert.equal(r.pending,1);
  assert.equal(r.unscorable,1);assert.equal(r.unpaid,1);assert.equal(r.on_time_percent,25);
});
test('no comparable baseline means no savings percentage even with invoices',async()=>{
  const report=await load(adapter([order(1)])).getReport({id:7,role:'BUYER'},{now});
  assert.equal(report.savings.status,'UNAVAILABLE');
  assert.equal(report.savings.percent,null);assert.equal(report.savings.amount,null);
  assert.match(report.savings.reason,/baseline/i);
});
test('empty report has unavailable rate, not zero reliability',async()=>{
  const report=await load(adapter([])).getReport({id:7,role:'BUYER'},{now});
  assert.equal(report.reliability.denominator,0);
  assert.equal(report.reliability.on_time_percent,null);
});
test('malformed, unknown and pickup windows are unscorable',async()=>{
  for(const extra of [{delivery_window:'ANYTIME'},{delivery_window:'25:00-26:00'},
    {delivery_window:'17:00-09:00'},{delivery_day:'2026-02-30'},
    {mode:'PICKUP'},{delivery_window:null}]){
    const r=(await load(adapter([order(1,extra)])).getReport({id:7,role:'BUYER'},{now})).reliability;
    assert.equal(r.denominator,0);assert.equal(r.unscorable,1);
  }
});
test('unconfirmed buyer windows never score delivery or overdue non-delivery',async()=>{
  for(const delivery_confirmed of [0,null,undefined]){
    const r=(await load(adapter([
      order(1,{delivery_confirmed,supplier_delivered_at:'2026-11-15 10:00:00'}),
      order(2,{delivery_confirmed})
    ])).getReport({id:7,role:'BUYER'},{now})).reliability;
    assert.equal(r.total_orders,2);assert.equal(r.denominator,0);
    assert.equal(r.on_time,0);assert.equal(r.missed,0);
    assert.equal(r.unscorable,2);assert.equal(r.on_time_percent,null);
  }
});
test('unconfirmed partial and exception outcomes stay visible outside denominator',async()=>{
  const r=(await load(adapter([
    order(1,{delivery_confirmed:0,has_partial:1}),
    order(2,{delivery_confirmed:0,fulfillment_status:'EXCEPTION',exception_reason:'DELIVERY_NOT_RECEIVED'})
  ])).getReport({id:7,role:'BUYER'},{now})).reliability;
  assert.equal(r.partial,1);assert.equal(r.missed,1);assert.equal(r.denominator,0);
  assert.equal(r.on_time_percent,null);
});
test('early deliveries are outside the accepted window; future deadlines are pending',async()=>{
  const r=(await load(adapter([
    order(1,{supplier_delivered_at:'2026-11-15 03:59:59'}),
    order(2,{delivery_day:'2026-11-16'}), // exactly at end, not missed until end passes
    order(3,{event_delivered_at:'2026-11-15 04:00:00'})
  ])).getReport({id:7,role:'BUYER'},{now})).reliability;
  assert.equal(r.early,1);assert.equal(r.pending,1);assert.equal(r.on_time,1);
  assert.equal(r.denominator,2);assert.equal(r.on_time_percent,50);
});
test('unresolved exceptions are not full deliveries, even with supplier timestamp',async()=>{
  const r=(await load(adapter([order(1,{fulfillment_status:'EXCEPTION',
    exception_reason:'DAMAGED_GOODS',supplier_delivered_at:'2026-11-15 10:00:00'})]))
    .getReport({id:7,role:'BUYER'},{now})).reliability;
  assert.equal(r.exceptions,1);assert.equal(r.denominator,1);assert.equal(r.on_time,0);
});
test('parallel reads preserve independent owners without mutable state',async()=>{
  const db=adapter([order(1),order(2,{buyer_id:8}),order(3,{buyer_id:8})]);
  const service=load(db);
  const reports=await Promise.all([7,8].map(id=>service.getReport({id,role:'BUYER'},{now})));
  assert.deepEqual(reports.map(r=>r.reliability.total_orders),[1,2]);
});
