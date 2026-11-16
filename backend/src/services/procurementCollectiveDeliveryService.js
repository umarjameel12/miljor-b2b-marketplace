'use strict';
// PR61 Part 2: supplier-proposed cluster delivery is not a buyer commitment.
// Each paid buyer approves their own schedule; supplier dispatch is blocked
// until every proposed paid stop independently consents.
const crypto=require('node:crypto');
const db=require('../config/db');
const exact=require('./exactDecimal');
const notify=require('./notificationService');
const fail=(code,message,statusCode=409)=>Object.assign(new Error(message),{code,statusCode});
const id=v=>{
 if(v==null||typeof v==='boolean'||!/^[1-9]\d*$/.test(String(v))||
    !Number.isSafeInteger(Number(v)))throw fail('INVALID_ID','Positive integer required',400);
 return Number(v);
};
const key=v=>{
 if(typeof v!=='string'||!/^[A-Za-z0-9:_-]{12,120}$/.test(v))
   throw fail('INVALID_IDEMPOTENCY_KEY','Valid 12–120 character key required',400);
 return v;
};
const unpack=v=>typeof v==='string'?JSON.parse(v):v;
class ProcurementCollectiveDeliveryService{
 constructor(database=db){this.database=database;}
 async propose(supplierId,groupId,input,rawKey){
  const supplier=id(supplierId),gid=id(groupId),idem=key(rawKey);
  const date=input?.delivery_day,window=input?.delivery_window;
  if(typeof date!=='string'||!/^\d{4}-\d\d-\d\d$/.test(date))
    throw fail('INVALID_DELIVERY_DAY','Delivery day must be YYYY-MM-DD',400);
  if(typeof window!=='string'||!/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/.test(window)||
     window.slice(0,5)>=window.slice(6))
    throw fail('INVALID_DELIVERY_WINDOW','Choose a valid forward local time window',400);
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify({supplier,gid,date,window})).digest('hex');
  const conn=await this.database.getConnection();
  try{
   await conn.beginTransaction();
   const [groups]=await conn.query('SELECT id,status,qualification_snapshot FROM procurement_collective_groups WHERE id=? FOR UPDATE',[gid]);
   const group=groups[0];
   if(!group||group.status!=='QUALIFIED')throw fail('GROUP_NOT_QUALIFIED','Only a qualified group may schedule');
   const qualification=unpack(group.qualification_snapshot);
   if(Number(qualification?.supplier_id)!==supplier)throw fail('SUPPLIER_NOT_ASSIGNED','Only the winning supplier may propose delivery',403);
   const [prior]=await conn.query(`SELECT r.id,r.idempotency_key,r.request_hash,r.status
    FROM procurement_collective_delivery_routes c JOIN procurement_delivery_runs r ON r.id=c.run_id
    WHERE c.group_id=? FOR UPDATE`,[gid]);
   if(prior.length){
    if(prior[0].idempotency_key!==idem||prior[0].request_hash!==fingerprint)
      throw fail('DELIVERY_ROUTE_ALREADY_PROPOSED','Existing route needs explicit resolution before rescheduling');
    await conn.commit();return {run_id:prior[0].id,status:prior[0].status,is_replay:true};
   }
   const [[clock]]=await conn.query(`SELECT (? >= UTC_DATE() AND ? <= DATE_ADD(UTC_DATE(),INTERVAL 14 DAY)) AS day_valid`,
     [date,date]);
   if(Number(clock.day_valid)!==1)throw fail('DELIVERY_DAY_OUT_OF_RANGE','Choose a delivery day within the next 14 days');
   const [members]=await conn.query(`SELECT buyer_id FROM procurement_collective_participants WHERE group_id=? AND status='LOCKED' ORDER BY buyer_id`,[gid]);
   const [orders]=await conn.query(`SELECT co.order_id,co.buyer_id,co.supplier_id,co.delivery_fee,
     co.accepted_delivery_snapshot,o.payment_status,o.fulfillment_status,
     o.order_status FROM procurement_collective_buyer_orders co
     JOIN orders o ON o.id=co.order_id WHERE co.group_id=? ORDER BY co.order_id FOR UPDATE`,[gid]);
   if(members.length<2||orders.length!==members.length||
      orders.some(o=>o.payment_status!=='PAID'||o.fulfillment_status==='EXCEPTION')||
      members.some(m=>!orders.some(o=>Number(o.buyer_id)===Number(m.buyer_id))))
     throw fail('GROUP_PAYMENTS_INCOMPLETE',
       'All independently confirmed group buyer payments must be provider verified before scheduling');
   const [disputes]=await conn.query(`SELECT COUNT(*) AS count FROM order_disputes
     WHERE order_id IN (SELECT order_id FROM procurement_collective_buyer_orders WHERE group_id=?)
       AND status NOT IN ('CLOSED','RESOLVED_REJECTED','SUPPLIER_REMEDIATION_COMPLETED')`,[gid]);
   if(Number(disputes[0]?.count)>0)throw fail('GROUP_DISPUTE_UNRESOLVED','Unresolved disputes block group dispatch planning');
   const destinations=orders.map(o=>({...o,destination:unpack(o.accepted_delivery_snapshot)}));
   const cluster=Number(destinations[0].destination.cluster_id);
   if(!Number.isSafeInteger(cluster)||cluster<1||
      destinations.some(o=>Number(o.destination.cluster_id)!==cluster||
        o.destination.delivery_mode!=='STANDARD_CLUSTERED'))
     throw fail('CLUSTER_NOT_COMPATIBLE','All buyer destinations must share a confirmed cluster');
   for(const row of destinations){
    const d=row.destination;
    const [addresses]=await conn.query(`SELECT id,revision,cluster_id,user_confirmation_status,
      manual_review_required FROM buyer_delivery_addresses WHERE id=? AND user_id=? FOR UPDATE`,
      [d.address_id,row.buyer_id]);
    if(addresses.length!==1||Number(addresses[0].revision)!==Number(d.address_revision)||
       Number(addresses[0].cluster_id)!==cluster||
       addresses[0].user_confirmation_status!=='CONFIRMED'||
       Number(addresses[0].manual_review_required)!==0)
      throw fail('DELIVERY_ADDRESS_CHANGED','Buyer delivery address changed since order acceptance');
   }
   const totalFee=exact.exactDecimalSum(destinations.map(d=>String(d.delivery_fee)),2);
   const snapshot={group_id:gid,cluster_id:cluster,delivery_day:date,
     delivery_window:window,mode:'STANDARD_CLUSTERED',order_ids:destinations.map(o=>o.order_id),
     accepted_by_buyers:false,external_payment_mutation:false};
   const [run]=await conn.query(`INSERT INTO procurement_delivery_runs
    (supplier_id,cluster_id,delivery_day,delivery_window,mode,handling_class,
     status,locked_delivery_fee_total,planned_stops,idempotency_key,request_hash,snapshot)
    VALUES (?,?,?,?,'STANDARD_CLUSTERED','AMBIENT','PROPOSED',?,?,?,?,?)`,
    [supplier,cluster,date,window,totalFee,destinations.length,idem,fingerprint,JSON.stringify(snapshot)]);
   const [link]=await conn.query(`INSERT INTO procurement_collective_delivery_routes(group_id,run_id,supplier_id)
     VALUES (?,?,?)`,[gid,run.insertId,supplier]);
   for(const order of destinations){
    const d=order.destination;
    const [stop]=await conn.query(`INSERT INTO procurement_delivery_stops
       (run_id,order_id,buyer_id,address_id,locked_delivery_fee,status,snapshot)
       VALUES (?,?,?,?,?,'ASSIGNED',?)`,
       [run.insertId,order.order_id,order.buyer_id,d.address_id,order.delivery_fee,
        JSON.stringify({group_id:gid,cluster_id:cluster,delivery_day:date,
          window,order_id:order.order_id,address_revision:d.address_revision})]);
    await conn.query(`INSERT INTO procurement_collective_route_acceptances
       (route_id,stop_id,buyer_id,status) VALUES (?,?,?,'PENDING')`,
       [link.insertId,stop.insertId,order.buyer_id]);
    await notify.enqueueEvent(conn,{userId:order.buyer_id,role:'BUYER',
      eventType:'ROUTE_ASSIGNED',eventKey:'collective:'+gid+':route:'+run.insertId+':buyer:'+order.buyer_id,
      entityId:order.order_id});
   }
   await conn.commit();
   return {run_id:run.insertId,group_id:gid,status:'PROPOSED',cluster_id:cluster,
     delivery_day:date,delivery_window:window,planned_stops:destinations.length,
     supplier_may_dispatch:false,is_replay:false};
  }catch(error){await conn.rollback();if(error.code==='ER_DUP_ENTRY')
    throw fail('ROUTE_CREATION_CONFLICT','Concurrent route already proposed');
    throw error;}finally{conn.release();}
 }
 async getBuyer(buyerId,groupId){
  const buyer=id(buyerId),gid=id(groupId);
  const [rows]=await this.database.query(`SELECT r.id AS run_id,r.delivery_day,r.delivery_window,
    r.status AS run_status,r.cluster_id,s.order_id,s.status AS stop_status,
    a.status AS approval_status,a.accepted_at
    FROM procurement_collective_delivery_routes cr
    JOIN procurement_delivery_runs r ON r.id=cr.run_id
    JOIN procurement_delivery_stops s ON s.run_id=r.id AND s.buyer_id=?
    JOIN procurement_collective_route_acceptances a ON a.route_id=cr.id
      AND a.stop_id=s.id AND a.buyer_id=?
    WHERE cr.group_id=?`,[buyer,buyer,gid]);
  if(!rows.length)throw fail('ROUTE_NOT_FOUND','No buyer-owned delivery route',404);
  return rows[0];
 }
 async decide(buyerId,groupId,input){
  const buyer=id(buyerId),gid=id(groupId);
  if(input?.decision!=='ACCEPT'&&input?.decision!=='REJECT')
    throw fail('INVALID_DECISION','Accept or reject the proposed delivery window',400);
  const expectedRun=id(input.run_id);
  const conn=await this.database.getConnection();
  try{
   await conn.beginTransaction();
   const [links]=await conn.query(`SELECT cr.id,cr.run_id,r.status,r.delivery_day,r.delivery_window
     FROM procurement_collective_delivery_routes cr JOIN procurement_delivery_runs r
     ON r.id=cr.run_id WHERE cr.group_id=? FOR UPDATE`,[gid]);
   const route=links[0];
   if(!route||Number(route.run_id)!==expectedRun)throw fail('ROUTE_CHANGED','Delivery route changed');
   const [rows]=await conn.query(`SELECT a.id,a.status AS decision_status,a.buyer_id,
     s.order_id,o.payment_status FROM procurement_collective_route_acceptances a
     JOIN procurement_delivery_stops s ON s.id=a.stop_id
     JOIN orders o ON o.id=s.order_id WHERE a.route_id=? AND a.buyer_id=? FOR UPDATE`,
     [route.id,buyer]);
   const mine=rows[0];
   if(!mine)throw fail('ROUTE_NOT_OWNED','You are not a buyer on this route',403);
   if(mine.payment_status!=='PAID')
     throw fail('BUYER_PAYMENT_NOT_VERIFIED','Only the owner of a verified paid order may accept delivery');
   const decision=input.decision==='ACCEPT'?'ACCEPTED':'REJECTED';
   if(mine.decision_status===decision){
    await conn.commit();return {run_id:route.run_id,decision,status:route.status,is_replay:true};
   }
   if(mine.decision_status!=='PENDING'||route.status!=='PROPOSED')
     throw fail('ROUTE_DECISION_LOCKED','Route decision has already been recorded');
   if(decision==='REJECTED' &&
     (typeof input.reason!=='string'||input.reason.trim().length<8||input.reason.length>500))
     throw fail('REJECTION_REASON_REQUIRED','Provide a reason of 8–500 characters',400);
   const snapshot={run_id:route.run_id,buyer_id:buyer,order_id:mine.order_id,
     day:route.delivery_day,window:route.delivery_window,decision};
   await conn.query(`UPDATE procurement_collective_route_acceptances SET status=?,
     accepted_snapshot=?,accepted_at=CASE WHEN ?='ACCEPTED' THEN UTC_TIMESTAMP() ELSE NULL END,
     rejection_reason=? WHERE id=?`,
     [decision,JSON.stringify(snapshot),decision,
      decision==='REJECTED'?input.reason.trim():null,mine.id]);
   if(decision==='REJECTED'){
    await conn.query("UPDATE procurement_delivery_runs SET status='EXCEPTION' WHERE id=?",
      [route.run_id]);
   }else{
    const [pending]=await conn.query(`SELECT status FROM procurement_collective_route_acceptances
      WHERE route_id=? FOR UPDATE`,[route.id]);
    if(pending.length>=2&&pending.every(p=>p.status==='ACCEPTED')){
      await conn.query("UPDATE procurement_delivery_runs SET status='CONFIRMED' WHERE id=? AND status='PROPOSED'",
        [route.run_id]);
      const [allStops]=await conn.query(`SELECT order_id,buyer_id FROM procurement_delivery_stops WHERE run_id=?`,
        [route.run_id]);
      for(const stop of allStops)await notify.enqueueEvent(conn,{
        userId:stop.buyer_id,role:'BUYER',eventType:'DISPATCH_SCHEDULED',
        eventKey:'collective:'+gid+':run:'+route.run_id+':confirmed:'+stop.buyer_id,
        entityId:stop.order_id});
    }
   }
   await conn.commit();
   return {run_id:route.run_id,decision,is_replay:false,
     status:decision==='REJECTED'?'EXCEPTION':'ACCEPTED_PENDING_GROUP_CONFIRMATION'};
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
 }
 async assertDispatchReady(conn,orderId){
  const oid=id(orderId);
  const [groupRows]=await conn.query('SELECT id FROM procurement_collective_buyer_orders WHERE order_id=?',[oid]);
  if(!groupRows.length)return {is_collective:false};
  const [runs]=await conn.query(`SELECT r.status,a.status AS consent
    FROM procurement_collective_buyer_orders co
    LEFT JOIN procurement_delivery_stops s ON s.order_id=co.order_id
    LEFT JOIN procurement_collective_route_acceptances a ON a.stop_id=s.id
    LEFT JOIN procurement_delivery_runs r ON r.id=s.run_id
    WHERE co.order_id=?`,[oid]);
  if(runs.length!==1||!['CONFIRMED','DISPATCHED'].includes(runs[0].status)||
     runs[0].consent!=='ACCEPTED')
    throw fail('COLLECTIVE_ROUTE_CONSENT_REQUIRED',
      'All buyer delivery window approvals must be complete before dispatch');
  return {is_collective:true};
 }
 async syncFulfillment(conn,orderId,toStatus){
  const oid=id(orderId);
  const [links]=await conn.query(`SELECT s.id AS stop_id,s.run_id
     FROM procurement_delivery_stops s JOIN procurement_collective_buyer_orders co
     ON co.order_id=s.order_id WHERE s.order_id=?`,[oid]);
  if(!links.length)return {handled:false};
  const stop=links[0];
  const map={
    DISPATCHED:'DISPATCHED',SUPPLIER_DELIVERED:'SUPPLIER_DELIVERED',
    BUYER_CONFIRMED:'BUYER_CONFIRMED',EXCEPTION:'EXCEPTION'
  };
  if(!map[toStatus])return {handled:false};
  await conn.query('UPDATE procurement_delivery_stops SET status=? WHERE id=?',
    [map[toStatus],stop.stop_id]);
  const [all]=await conn.query('SELECT status FROM procurement_delivery_stops WHERE run_id=?',
    [stop.run_id]);
  if(all.some(row=>row.status==='EXCEPTION'))
    await conn.query("UPDATE procurement_delivery_runs SET status='EXCEPTION' WHERE id=?",
      [stop.run_id]);
  else if(all.length>=2&&all.every(row=>row.status==='BUYER_CONFIRMED'))
    await conn.query("UPDATE procurement_delivery_runs SET status='DELIVERED' WHERE id=?",
      [stop.run_id]);
  else if(all.some(row=>['DISPATCHED','SUPPLIER_DELIVERED','BUYER_CONFIRMED'].includes(row.status)))
    await conn.query("UPDATE procurement_delivery_runs SET status='DISPATCHED' WHERE id=? AND status='CONFIRMED'",
      [stop.run_id]);
  return {handled:true,run_id:stop.run_id};
 }
}
module.exports=new ProcurementCollectiveDeliveryService();
module.exports.ProcurementCollectiveDeliveryService=ProcurementCollectiveDeliveryService;
