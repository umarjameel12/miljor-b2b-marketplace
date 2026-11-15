'use strict';
// Owned fixtures remain in a rolled-back transaction; no protected database access.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
assert.equal(process.env.DB_NAME,'miljor_test_db');
assert.equal(process.env.NODE_ENV,'test');
const db=require('../src/config/db');
const {SupplierOperationsService}=require('../src/services/supplierOperationsService');
async function main(){
  const connection=await db.getConnection();
  try{
    assert.equal((await connection.query('SELECT DATABASE() AS name'))[0][0].name,'miljor_test_db');
    await connection.beginTransaction();
    const tag=crypto.randomUUID(),ids=[];
    for(const role of ['BUYER','SUPPLIER','SUPPLIER']){
      const [result]=await connection.query("INSERT INTO users(full_name,email,role,is_verified,verification_status) VALUES (?,?,?,1,'VERIFIED')",['Operations fixture',`${ids.length}-${tag}@example.invalid`,role]);ids.push(result.insertId);
    }
    const [buyer,supplier,other]=ids;
    for(const id of [supplier,other])await connection.query("INSERT INTO supplier_profiles(supplier_id,verification_status) VALUES (?,'VERIFIED')",[id]);
    const service=new SupplierOperationsService({getConnection:async()=>({query:connection.query.bind(connection),release(){}})});
    const actor={id:supplier,role:'SUPPLIER'};
    assert.ok(Object.values((await service.get(actor)).counts).every(value=>value===0));
    const [request]=await connection.query("INSERT INTO procurement_requests(buyer_id,request_code,delivery_area,status,quote_deadline,idempotency_key,request_hash) VALUES (?,?,'Lahore','OPEN',DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR),?,?)",[buyer,'OPS-'+tag,tag,'a'.repeat(64)]);
    await connection.query("INSERT INTO procurement_supplier_invitations(request_id,supplier_id,eligible_line_ids) VALUES (?,?,'[]')",[request.insertId,supplier]);
    const [group]=await connection.query("INSERT INTO procurement_collective_groups(request_id,organizer_buyer_id,join_deadline,status) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR),'QUOTING')",[request.insertId,buyer]);
    await connection.query('INSERT INTO procurement_collective_supplier_invitations(group_id,supplier_id) VALUES (?,?)',[group.insertId,supplier]);
    for(const [index,payment,status] of [[0,'PAID','PREPARING'],[1,'AWAITING_PAYMENT','PREPARING'],[2,'PAID','SUPPLIER_DELIVERED'],[3,'PAID','EXCEPTION']]){
      await connection.query('INSERT INTO orders(order_code,buyer_id,supplier_id,total_qty,unit_price,subtotal_amount,total_amount,payment_status,fulfillment_status) VALUES (?,?,?,1,100,100,100,?,?)',['OPS'+tag.slice(0,8)+index,buyer,supplier,payment,status]);
    }
    const counts=(await service.get(actor)).counts;
    assert.equal(counts.rfq_invitations,1);assert.equal(counts.collective_requests,1);
    assert.equal(counts.paid_to_fulfill,1);assert.equal(counts.awaiting_buyer_receipt,1);assert.equal(counts.fulfillment_exceptions,1);
    assert.ok(Object.values((await service.get({id:other,role:'SUPPLIER'})).counts).every(value=>value===0));
    await connection.query('UPDATE procurement_requests SET quote_deadline=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE id=?',[request.insertId]);
    const expired=(await service.get(actor)).counts;assert.equal(expired.rfq_invitations,0);assert.equal(expired.collective_requests,0);
    await connection.query('UPDATE users SET is_verified=0 WHERE id=?',[supplier]);
    await assert.rejects(()=>service.get(actor),error=>error.statusCode===403);
    console.log('PASS supplier operations real MySQL: query schema, live/expired invitations, paid-only states, tenant isolation, verification revocation; all fixtures rolled back');
  }finally{await connection.rollback();connection.release();await db.end();}
}
main().catch(error=>{console.error(error.code||'OPERATIONS_GATE_FAILED',error.message);process.exitCode=1;});
