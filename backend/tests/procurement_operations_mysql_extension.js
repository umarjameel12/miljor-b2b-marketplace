'use strict';
// Called inside the collective gate's rollback-only paid-policy transaction.
// Synthetic provider evidence below tests SQL contracts, NOT Safepay delivery.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
module.exports=async({conn,db,orderIds,buyers,supplier,outsider,pass})=>{
 assert.equal((await conn.query('SELECT DATABASE() name'))[0][0].name,'miljor_test_db');
 let serial=0;
 const adapter={query:conn.query.bind(conn),getConnection:async()=>{
  let savepoint;
  return {query:(sql,args)=>/^SET TRANSACTION/i.test(sql)?Promise.resolve([[]]):conn.query(sql,args),beginTransaction:async()=>{savepoint='operations_'+(++serial);await conn.query('SAVEPOINT '+savepoint);},commit:async()=>{if(savepoint){await conn.query('RELEASE SAVEPOINT '+savepoint);savepoint=null;}},rollback:async()=>{if(savepoint){await conn.query('ROLLBACK TO SAVEPOINT '+savepoint);await conn.query('RELEASE SAVEPOINT '+savepoint);savepoint=null;}},release:()=>{}};
 }};
 const supplierActor={id:supplier,role:'SUPPLIER'},buyerActors=buyers.map(id=>({id,role:'BUYER'}));
 const {ProcurementDeliveryRunService}=require('../src/services/procurementDeliveryRunService');
 const {ProcurementDeliveryAttemptService}=require('../src/services/procurementDeliveryAttemptService');
 const {ProcurementDeliveryEvidenceService}=require('../src/services/procurementDeliveryEvidenceService');
 const {ProcurementLineReceiptService}=require('../src/services/procurementLineReceiptService');
 const {ProcurementReportingService}=require('../src/services/procurementReportingService');
 const delivery=new ProcurementDeliveryRunService(adapter),attempts=new ProcurementDeliveryAttemptService(adapter),evidence=new ProcurementDeliveryEvidenceService(adapter),receipts=new ProcurementLineReceiptService(adapter),reporting=new ProcurementReportingService(adapter);
 const intent=()=>crypto.randomUUID(),denied=(action,code)=>assert.rejects(action,error=>error.code===code);
 const [[cluster]]=await conn.query('SELECT id FROM geographic_clusters WHERE is_active=1 ORDER BY id LIMIT 1');assert.ok(cluster);
 const [[clock]]=await conn.query("SELECT DATE_FORMAT(DATE_ADD(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','+05:00'),INTERVAL 2 DAY),'%Y-%m-%d') day");
 const addresses=[];
 for(const buyer of buyers){const [address]=await conn.query("INSERT INTO buyer_delivery_addresses(user_id,cluster_id,society_area,full_address,geographic_match_status) VALUES (?,?,'Test area','Owned buyer destination, Lahore','VERIFIED')",[buyer,cluster.id]);addresses.push(address.insertId);}
 if(process.env.SMART_HUB_CLOSING_GATE==='1')await require('./procurement_closing_mysql_extension').individualPricing({conn,oid:orderIds[0],buyerId:buyers[0],supplierId:supplier,addressId:addresses[0],clusterId:cluster.id,pass});
 await conn.query("UPDATE orders SET fulfillment_status='READY_FOR_DISPATCH' WHERE id IN (?,?)",orderIds);
 const vehicle=await delivery.saveVehicle(supplierActor,{vehicle_reference:'Owned test vehicle '+intent(),max_weight_kg:'150',max_volume_l:'0',handling_class:'AMBIENT'});
 for(let i=0;i<orderIds.length;i++){
  const body={mode:'STANDARD_CLUSTERED',address_id:addresses[i],delivery_day:clock.day,delivery_window:'09:00-12:00',handling_class:'AMBIENT',explicit_consent:true,expected_revision:0},key=intent();
  const choice=await delivery.choose(buyerActors[i],orderIds[i],body,key);assert.equal(choice.revision,1);assert.equal((await delivery.choose(buyerActors[i],orderIds[i],body,key)).is_replay,true);
  await denied(()=>delivery.choose(buyerActors[i],orderIds[i],{...body,delivery_window:'10:00-12:00'},key),'IDEMPOTENCY_CONFLICT');
 }
 await denied(()=>delivery.buyerContext({id:outsider,role:'BUYER'},orderIds[0]),'ORDER_NOT_FOUND');
 const before=await reporting.getReport(buyerActors[0]);assert.equal(before.reliability.denominator,0);
 const runBody={order_ids:orderIds,vehicle_id:vehicle.vehicle_id,planned_cost_pkr:'40.00',handling_confirmed:true},runKey=intent();
 const run=await delivery.createRun(supplierActor,runBody,runKey);assert.equal(run.status,'PROPOSED');assert.equal(run.weight_kg,'125.0000');assert.equal((await delivery.createRun(supplierActor,runBody,runKey)).is_replay,true);
 await denied(()=>delivery.createRun(supplierActor,runBody,intent()),'ORDER_ALREADY_ROUTED');
 await conn.query('SAVEPOINT cancel_route');const cancelKey=intent();
 assert.equal((await delivery.transition(supplierActor,run.run_id,'CANCEL',cancelKey)).status,'CANCELLED');
 assert.equal((await delivery.transition(supplierActor,run.run_id,'CANCEL',cancelKey)).is_replay,true);
 assert.equal((await conn.query('SELECT COUNT(*) n FROM procurement_delivery_stops WHERE run_id=? AND is_current=1',[run.run_id]))[0][0].n,0);
 await conn.query('ROLLBACK TO SAVEPOINT cancel_route');await conn.query('RELEASE SAVEPOINT cancel_route');
 await conn.query('UPDATE buyer_delivery_addresses SET revision=revision+1 WHERE id=?',[addresses[0]]);
 await denied(()=>delivery.transition(supplierActor,run.run_id,'CONFIRM',intent()),'DELIVERY_ADDRESS_REAPPROVAL_REQUIRED');
 await conn.query('UPDATE buyer_delivery_addresses SET revision=revision-1 WHERE id=?',[addresses[0]]);
 await delivery.transition(supplierActor,run.run_id,'CONFIRM',intent());
 const own=await delivery.buyerContext(buyerActors[0],orderIds[0]);assert.equal(own.delivery.status,'CONFIRMED');assert.equal(own.other_buyers_disclosed,false);assert.ok(!JSON.stringify(own).includes(String(addresses[1])+'"'));
 await denied(()=>delivery.transition(supplierActor,run.run_id,'DISPATCH',intent()),'ORDER_DISPATCH_REQUIRED');
 await conn.query("UPDATE orders SET fulfillment_status='DISPATCHED' WHERE id IN (?,?)",orderIds);
 await delivery.transition(supplierActor,run.run_id,'DISPATCH',intent());
 await delivery.updateEta(supplierActor,run.run_id,orderIds[0],clock.day+'T13:00:00+05:00',intent());
 pass('R3 real SQL: owned choices/replay, physical capacity route, destination revision, dispatch prerequisites and private ETA');
 const proofInput={mime_type:'application/pdf',content_base64:Buffer.from('%PDF-1.4\nOwned test proof').toString('base64')},proofKey=intent();
 const proof=await evidence.upload({actor:supplierActor,orderId:orderIds[0],input:proofInput,idempotencyKey:proofKey});assert.equal((await evidence.upload({actor:supplierActor,orderId:orderIds[0],input:proofInput,idempotencyKey:proofKey})).is_replay,true);
 const file=await evidence.download({actor:buyerActors[0],orderId:orderIds[0],evidenceId:proof.proof.id});assert.equal(file.content_bytes.toString(),'%PDF-1.4\nOwned test proof');
 await denied(()=>evidence.list({actor:buyerActors[1],orderId:orderIds[0]}),'EVIDENCE_ORDER_NOT_FOUND');
 const broken=new ProcurementDeliveryEvidenceService(adapter,{enqueueEvent:async()=>{throw Error('outbox rollback test');}});
 await assert.rejects(()=>broken.upload({actor:supplierActor,orderId:orderIds[0],input:proofInput,idempotencyKey:intent()}),/outbox rollback test/);
 assert.equal((await conn.query('SELECT COUNT(*) n FROM procurement_delivery_evidence WHERE order_id=?',[orderIds[0]]))[0][0].n,1);
 pass('R3 real SQL: actual private proof bytes, duplicate prevention, foreign denial and outbox atomic rollback');
 const failureKey=intent(),failed=await attempts.failAttempt(supplierActor,orderIds[0],{description:'Actual test fixture logistics failure'},failureKey);assert.equal((await attempts.failAttempt(supplierActor,orderIds[0],{description:'Actual test fixture logistics failure'},failureKey)).is_replay,true);
 await conn.query("UPDATE orders SET fulfillment_status='SUPPLIER_DELIVERED',supplier_delivered_at=UTC_TIMESTAMP() WHERE id=?",[orderIds[1]]);
 await delivery.transition(supplierActor,run.run_id,'CLOSE_WITH_EXCEPTIONS',intent());
 const slot={start_utc:clock.day+'T09:00:00+05:00',end_utc:clock.day+'T12:00:00+05:00',extra_fee:'10.00',expected_version:0};
 await attempts.propose(supplierActor,orderIds[0],failed.attempt_id,slot,intent());
 await denied(()=>attempts.approve(buyerActors[1],orderIds[0],failed.attempt_id,{proposal_version:1,accepted_extra_fee:'10',explicit_consent:true},intent()),'ORDER_NOT_FOUND');
 await attempts.approve(buyerActors[0],orderIds[0],failed.attempt_id,{proposal_version:1,accepted_extra_fee:'10',explicit_consent:true},intent());
 await denied(()=>attempts.resume(supplierActor,orderIds[0],failed.attempt_id,intent()),'SUPPLEMENTAL_PAYMENT_REQUIRED');
 pass('R3 real SQL: failed attempt preserves canonical event, exact buyer proposal consent, extra fee dispatch stays blocked');
 // Different attempt scenario uses a savepoint so no paid provider records or
 // failure-policy changes escape this parent transaction.
 await conn.query('SAVEPOINT free_reattempt');
 await conn.query("UPDATE procurement_delivery_attempts SET status='FAILED',proposal_version=0,buyer_consent_snapshot=NULL WHERE id=?",[failed.attempt_id]);
 await attempts.propose(supplierActor,orderIds[0],failed.attempt_id,{...slot,extra_fee:'0.00'},intent());
 await attempts.approve(buyerActors[0],orderIds[0],failed.attempt_id,{proposal_version:1,accepted_extra_fee:'0',explicit_consent:true},intent());
 const resumed=await attempts.resume(supplierActor,orderIds[0],failed.attempt_id,intent());assert.equal(resumed.status,'RESUMED');
 assert.equal((await conn.query('SELECT is_current FROM procurement_delivery_stops WHERE order_id=?',[orderIds[0]]))[0][0].is_current,0);
 await conn.query('ROLLBACK TO SAVEPOINT free_reattempt');await conn.query('RELEASE SAVEPOINT free_reattempt');
 pass('R3 real SQL: buyer-approved zero-fee recovery preserves historical stop and requires fresh choice');
 // A PAID status alone must be insufficient for receipt financial operations.
 const [awardLines]=await conn.query('SELECT al.* FROM procurement_award_lines al JOIN procurement_award_orders ao ON ao.id=al.award_order_id WHERE ao.order_id=?',[orderIds[0]]);
 const line=awardLines[0],receiptKey=intent(),receiptInput={orderId:orderIds[0],actor:buyerActors[0],idempotencyKey:receiptKey,feePolicy:{version:'R4_ACCEPTED_MERCHANDISE_V1',accepted:true},lines:[{award_line_id:line.id,received_quantity:'1',accepted_quantity:'1',disputed_quantity:'1',reason:'QUANTITY_MISMATCH',evidence_notes:'One of two bags accepted in rollback-only fixture'}]};
 await denied(()=>receipts.recordBuyerReceipt(receiptInput),'VERIFIED_PAYMENT_REQUIRED');
 for(let i=0;i<orderIds.length;i++){
  const [[order]]=await conn.query('SELECT * FROM orders WHERE id=?',[orderIds[i]]),token='rollback_'+intent();
  const [attempt]=await conn.query("INSERT INTO payment_attempts(attempt_code,order_id,buyer_id,provider_tracker_token,amount,currency,status) VALUES (?,?,?,?,?,?,'COMPLETED')",['TEST-'+intent().slice(0,25),order.id,order.buyer_id,token,order.total_amount,order.currency]);
  await conn.query("INSERT INTO payments(payment_code,order_id,buyer_id,amount,status,transaction_ref) VALUES (?,?,?,?,'PAID',?)",['TEST-'+intent().slice(0,20),order.id,order.buyer_id,order.total_amount,token]);
  await conn.query("INSERT INTO payment_webhook_events(event_id,event_type,order_id,attempt_id,provider_tracker_token,signature,timestamp_header,raw_payload,processed_status) VALUES (?,'payment.completed',?,?,?,?,?,'{}','PROCESSED')",['rollback-'+intent(),order.id,attempt.insertId,token,'SYNTHETIC_NOT_PROVIDER','rollback']);
 }
 if(process.env.SMART_HUB_CLOSING_GATE==='1')await require('./procurement_closing_mysql_extension').supplemental({conn,db,adapter,oid:orderIds[0],attemptId:failed.attempt_id,buyer:buyerActors[0],supplier:supplierActor,receipts,attempts,pass});
 const orderBefore=(await conn.query('SELECT subtotal_amount,delivery_fee,buyer_platform_fee,total_amount,supplier_commission_percent FROM orders WHERE id=?',[orderIds[0]]))[0][0];
 const brokenReceipt=new ProcurementLineReceiptService(adapter,{notifications:{enqueueEvent:async()=>{throw Error('receipt outbox rollback');}}});
 await assert.rejects(()=>brokenReceipt.recordBuyerReceipt({...receiptInput,idempotencyKey:intent()}),/receipt outbox rollback/);
 for(const table of ['procurement_line_receipts','refund_obligations','financial_holds'])assert.equal((await conn.query('SELECT COUNT(*) n FROM '+table+' WHERE order_id=?',[orderIds[0]]))[0][0].n,0);
 const recorded=await receipts.recordBuyerReceipt(receiptInput);assert.equal(recorded.receipt.financial_status,'INTERNAL_RECORDED');assert.equal(recorded.receipt.accepted_merchandise_amount,'100.00');assert.equal(recorded.receipt.accepted_commission_amount,'2.50');assert.equal(recorded.receipt.settlement_authorized,false);
 assert.equal((await receipts.recordBuyerReceipt(receiptInput)).is_replay,true);
 const [notices]=await conn.query("SELECT recipient_id,recipient_role,event_type FROM procurement_notifications WHERE event_key LIKE 'line-receipt:%' AND recipient_id IN (?,?) ORDER BY recipient_id,event_type",[buyers[0],supplier]);assert.equal(notices.length,4);assert.ok(notices.every(event=>[buyers[0],supplier].includes(event.recipient_id)));
 assert.deepEqual((await conn.query('SELECT subtotal_amount,delivery_fee,buyer_platform_fee,total_amount,supplier_commission_percent FROM orders WHERE id=?',[orderIds[0]]))[0][0],orderBefore);
 await denied(()=>receipts.assertFullyAcceptedWithinTransaction(conn,orderIds[0]),'LINE_RECEIPTS_NOT_FULLY_ACCEPTED');
 const [holds]=await conn.query('SELECT * FROM financial_holds WHERE order_id=?',[orderIds[0]]);assert.ok(holds.length>=2);assert.ok(holds.every(row=>row.status==='ACTIVE'));
 const [refunds]=await conn.query('SELECT * FROM refund_obligations WHERE order_id=?',[orderIds[0]]);assert.equal(refunds.length,1);assert.equal(refunds[0].external_execution_status,'DISABLED');assert.equal(refunds[0].total_refund_amount,'100.00');
 const orderB=await receipts.getBuyerReceipts({orderId:orderIds[1],actor:buyerActors[1]});
 const full=await receipts.recordBuyerReceipt({orderId:orderIds[1],actor:buyerActors[1],idempotencyKey:intent(),feePolicy:receiptInput.feePolicy,lines:orderB.lines.map(row=>({award_line_id:row.award_line_id,received_quantity:row.ordered_quantity,accepted_quantity:row.ordered_quantity,disputed_quantity:'0'}))});
 assert.equal(full.receipt.financial_status,'CANONICAL_FULL_RECEIPT');await receipts.assertFullyAcceptedWithinTransaction(conn,orderIds[1]);assert.equal((await conn.query('SELECT COUNT(*) n FROM financial_holds WHERE order_id=?',[orderIds[1]]))[0][0].n,0);
 const report=await reporting.getReport(buyerActors[0]);assert.equal(report.reliability.total_orders,1);assert.equal(report.reliability.partial,1);assert.equal(report.savings.status,'UNAVAILABLE');
 const contender=await db.getConnection();try{await contender.beginTransaction();await assert.rejects(()=>contender.query('SELECT id FROM orders WHERE id=? FOR UPDATE NOWAIT',[orderIds[0]]),error=>error.errno===3572);}finally{await contender.rollback();contender.release();}
 pass('R4/R5 real SQL: per-line receipt/commission, linked refund/fee holds, full acceptance path, own reporting and independent-session lock exclusion; synthetic payment evidence rolls back');
 if(process.env.SMART_HUB_CLOSING_GATE==='1')await require('./procurement_closing_mysql_extension').partialReview({conn,db,adapter,oid:orderIds[0],buyer:buyerActors[0],pass});
};
