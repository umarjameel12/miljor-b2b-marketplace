'use strict';
const db=require('../config/db'),crypto=require('node:crypto');
const exact=require('./exactDecimal'),notifications=require('./notificationService');
const {normalizeWindow,measureLines,compatibleRun}=require('./procurementDeliveryRunPolicy');
const fail=(code,message,statusCode=409)=>Object.assign(Error(message),{code,statusCode});
const id=value=>{if(!/^[1-9]\d*$/.test(String(value))||!Number.isSafeInteger(Number(value)))throw fail('INVALID_DELIVERY_ID','Positive identifier required',400);return Number(value);};
const key=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9:_-]{12,120}$/.test(value))throw fail('INVALID_IDEMPOTENCY_KEY','Stable 12–120 character intent key required',400);return value;};
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const day=value=>value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);
class ProcurementDeliveryRunService{
 constructor(database=db,notifier=notifications){this.db=database;this.notifications=notifier;}
 async _order(conn,actor,orderId){
  if(!actor||!['BUYER','SUPPLIER'].includes(actor.role))throw fail('DELIVERY_FORBIDDEN','Buyer or assigned supplier required',403);
  const [rows]=await conn.query('SELECT * FROM orders WHERE id=? FOR UPDATE',[id(orderId)]);
  const row=rows[0];if(!row||Number(row[actor.role==='BUYER'?'buyer_id':'supplier_id'])!==id(actor.id))throw fail('ORDER_NOT_FOUND','Own order not found',404);
  if(row.payment_status!=='PAID')throw fail('VERIFIED_PAYMENT_REQUIRED','Only verified paid orders can enter delivery operations');
  return row;
 }
 async _supplier(conn,actor){
  await require('./fulfillmentService')._assertVerifiedSupplier(actor,conn);
 }
 async saveVehicle(actor,input){
  if(!input||Object.keys(input).some(field=>!['vehicle_reference','max_weight_kg','max_volume_l','handling_class'].includes(field))||typeof input.vehicle_reference!=='string'||input.vehicle_reference.trim().length<3||input.vehicle_reference.length>100||!['AMBIENT','CHILLED','FROZEN'].includes(input.handling_class))throw fail('INVALID_VEHICLE','Vehicle reference, exact capacities and explicit handling class required',400);
  const weight=exact.toCanonical(input.max_weight_kg,4),volume=exact.toCanonical(input.max_volume_l,4);
  if(!exact.exactDecimalGte(weight,'0',4)||!exact.exactDecimalGte(volume,'0',4)||(exact.exactDecimalEquals(weight,'0',4)&&exact.exactDecimalEquals(volume,'0',4)))throw fail('INVALID_VEHICLE_CAPACITY','At least one positive physical capacity required',400);
  const conn=await this.db.getConnection();
  try{await conn.beginTransaction();await this._supplier(conn,actor);
   await conn.query('SELECT supplier_id FROM supplier_profiles WHERE supplier_id=? FOR UPDATE',[actor.id]);
   const [old]=await conn.query('SELECT id FROM procurement_delivery_vehicles WHERE supplier_id=? AND vehicle_reference=? FOR UPDATE',[actor.id,input.vehicle_reference.trim()]);
   let vehicle=old[0]?.id;
   if(vehicle){const [busy]=await conn.query("SELECT id FROM procurement_delivery_runs WHERE vehicle_id=? AND status IN ('PROPOSED','CONFIRMED','DISPATCHED') FOR UPDATE",[vehicle]);if(busy.length)throw fail('VEHICLE_HAS_ACTIVE_ROUTE','Active route snapshots protect this vehicle configuration');
    await conn.query('UPDATE procurement_delivery_vehicles SET max_weight_kg=?,max_volume_l=?,handling_class=?,version_number=version_number+1 WHERE id=?',[weight,volume,input.handling_class,vehicle]);
   }else{const [created]=await conn.query('INSERT INTO procurement_delivery_vehicles(supplier_id,vehicle_reference,max_weight_kg,max_volume_l,handling_class) VALUES (?,?,?,?,?)',[actor.id,input.vehicle_reference.trim(),weight,volume,input.handling_class]);vehicle=created.insertId;}
   await conn.commit();return {vehicle_id:vehicle,capacity_basis:'SUPPLIER_DECLARED',creates_charge:false};
  }catch(error){await conn.rollback();throw error;}finally{conn.release();}
 }
 async listVehicles(actor){if(actor?.role!=='SUPPLIER')throw fail('DELIVERY_FORBIDDEN','Supplier required',403);return (await this.db.query('SELECT id,vehicle_reference,max_weight_kg,max_volume_l,handling_class,version_number FROM procurement_delivery_vehicles WHERE supplier_id=? ORDER BY id',[id(actor.id)]))[0];}
 async choose(actor,orderId,input,rawKey){
  const oid=id(orderId),intent=key(rawKey);
  if(actor?.role!=='BUYER')throw fail('DELIVERY_FORBIDDEN','Only the owning buyer can authorize a destination/window',403);
  if(!input||Object.keys(input).some(field=>!['mode','address_id','pickup_point_id','delivery_day','delivery_window','handling_class','explicit_consent','expected_revision'].includes(field))||input.explicit_consent!==true||!['STANDARD_CLUSTERED','INDIVIDUAL','EXPRESS','PICKUP'].includes(input.mode)||!['AMBIENT','CHILLED','FROZEN'].includes(input.handling_class))throw fail('DELIVERY_CONSENT_REQUIRED','Explicit mode, window and handling consent required',400);
  normalizeWindow(input.delivery_window);
  const date=String(input.delivery_day||'');
  if(!/^\d{4}-\d\d-\d\d$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw fail('INVALID_DELIVERY_DAY','Valid local delivery date required',400);
  const normalized={order_id:oid,mode:input.mode,address_id:input.address_id==null?null:id(input.address_id),pickup_point_id:input.pickup_point_id==null?null:id(input.pickup_point_id),delivery_day:date,delivery_window:input.delivery_window,handling_class:input.handling_class,expected_revision:input.expected_revision??0};
  if(!Number.isSafeInteger(normalized.expected_revision)||normalized.expected_revision<0)throw fail('INVALID_DELIVERY_REVISION','Exact current revision required',400);
  const digest=hash(normalized),conn=await this.db.getConnection();
  try{
   await conn.beginTransaction();const order=await this._order(conn,actor,oid);await require('./procurementRecurringService')._verified(conn,actor.id);
   const [previous]=await conn.query('SELECT payload_hash,response_snapshot FROM procurement_delivery_choice_events WHERE buyer_id=? AND event_key=? FOR UPDATE',[actor.id,intent]);
   if(previous.length){if(previous[0].payload_hash!==digest)throw fail('IDEMPOTENCY_CONFLICT','Intent belongs to different delivery terms');await conn.commit();return {...parse(previous[0].response_snapshot),is_replay:true};}
   if(!['AWAITING_SUPPLIER_ACKNOWLEDGEMENT','PREPARING','READY_FOR_DISPATCH'].includes(order.fulfillment_status))throw fail('DELIVERY_CHOICE_LOCKED','Dispatch/exception/receipt requires its own approved workflow');
   const [stops]=await conn.query('SELECT id FROM procurement_delivery_stops WHERE order_id=? AND is_current=1',[oid]);if(stops.length)throw fail('DELIVERY_CHOICE_LOCKED','Supplier has already assigned this destination to a run');
   const [current]=await conn.query('SELECT * FROM procurement_order_delivery_choices WHERE order_id=? FOR UPDATE',[oid]);
   if(normalized.expected_revision!==Number(current[0]?.choice_revision||0))throw fail('DELIVERY_REVISION_CONFLICT','Delivery preference changed; reload');
   const bound=parse(order.procurement_delivery_snapshot);
   const [reattempts]=await conn.query("SELECT proposed_start_utc,proposed_end_utc FROM procurement_delivery_attempts WHERE order_id=? AND status='RESUMED' ORDER BY id DESC LIMIT 1",[oid]);
   if(reattempts.length){
    const [[slot]]=await conn.query("SELECT (CONVERT_TZ(CONCAT(?, ' ', ?),'+05:00','+00:00')>=? AND CONVERT_TZ(CONCAT(?, ' ', ?),'+05:00','+00:00')<=?) allowed",[date,normalized.delivery_window.split('-')[0]+':00',reattempts[0].proposed_start_utc,date,normalized.delivery_window.split('-')[1]+':00',reattempts[0].proposed_end_utc]);
    if(Number(slot.allowed)!==1)throw fail('REATTEMPT_WINDOW_MISMATCH','Choose a window within the buyer-approved reattempt slot');
   }
   if((bound?.mode&&bound.mode!==normalized.mode)||(order.delivery_type==='SUPPLIER_PICKUP'&&normalized.mode!=='PICKUP')||(order.delivery_type!=='SUPPLIER_PICKUP'&&normalized.mode==='PICKUP'))throw fail('LOCKED_DELIVERY_MODE_MISMATCH','Cannot silently change the accepted mode or supplier pickup contract');
   let address=null,pickup=null,cluster,configVersion=0;
   if(normalized.mode==='PICKUP'){
    const [points]=await conn.query('SELECT * FROM supplier_pickup_points WHERE id=? AND supplier_id=? AND is_active=1 FOR UPDATE',[normalized.pickup_point_id,order.supplier_id]);pickup=points[0];
    if(!pickup||normalized.address_id)throw fail('PICKUP_POINT_UNAVAILABLE','Choose an active point from your accepted supplier');cluster=pickup.cluster_id;
    if(bound?.pickup_point_id&&Number(bound.pickup_point_id)!==Number(pickup.id))throw fail('PICKUP_POINT_REAPPROVAL_REQUIRED','Accepted pickup point cannot be replaced by this operation');
   }else{
    const [addresses]=await conn.query("SELECT a.* FROM buyer_delivery_addresses a JOIN geographic_clusters g ON g.id=a.cluster_id AND g.is_active=1 WHERE a.id=? AND a.user_id=? AND a.geographic_match_status='VERIFIED' FOR UPDATE",[normalized.address_id,actor.id]);address=addresses[0];
    if(!address||normalized.pickup_point_id)throw fail('DELIVERY_ADDRESS_UNAVAILABLE','Own verified saved address required');cluster=address.cluster_id;
    if(bound?.address_id&&(Number(bound.address_id)!==Number(address.id)||Number(bound.address_revision)!==Number(address.revision)))throw fail('DELIVERY_ADDRESS_REAPPROVAL_REQUIRED','Accepted destination changed; a new commercial consent is required');
    if(!bound&&address.full_address!==order.delivery_address)throw fail('DELIVERY_ADDRESS_REAPPROVAL_REQUIRED','Saved destination must match the buyer-approved order address');
   }
   const [configs]=await conn.query('SELECT version FROM supplier_delivery_configurations WHERE supplier_id=?',[order.supplier_id]);configVersion=Number(configs[0]?.version||0);
   const [[clock]]=await conn.query("SELECT (CONVERT_TZ(CONCAT(?, ' ', ?),'+05:00','+00:00')>UTC_TIMESTAMP() AND ?<=DATE_ADD(DATE(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','+05:00')),INTERVAL 90 DAY)) live",[date,normalized.delivery_window.split('-')[1]+':00',date]);
   if(Number(clock.live)!==1)throw fail('DELIVERY_WINDOW_EXPIRED','Window must end in the future within 90 days');
   const revision=normalized.expected_revision+1,snapshot={...normalized,revision,locked_delivery_fee:exact.toCanonical(order.delivery_fee,2),address:address?{id:address.id,revision:Number(address.revision),full_address:address.full_address,cluster_id:Number(cluster)}:null,pickup:pickup?{id:pickup.id,point_name:pickup.point_name,address_line:pickup.address_line,cluster_id:Number(cluster)}:null,supplier_config_version:configVersion,supplier_confirmation_required:true,creates_charge:false};
   let choiceId=current[0]?.id;
   const values=[normalized.address_id,cluster,date,normalized.delivery_window,normalized.mode,normalized.handling_class,order.delivery_fee,address?.revision||0,configVersion,intent,digest,JSON.stringify(snapshot),revision];
   if(choiceId)await conn.query('UPDATE procurement_order_delivery_choices SET delivery_address_id=?,cluster_id=?,delivery_day=?,delivery_window=?,mode=?,handling_class=?,locked_delivery_fee=?,address_version=?,supplier_config_version=?,acceptance_key=?,acceptance_hash=?,terms_snapshot=?,choice_revision=? WHERE id=?',[...values,choiceId]);
   else{const [created]=await conn.query('INSERT INTO procurement_order_delivery_choices(delivery_address_id,cluster_id,delivery_day,delivery_window,mode,handling_class,locked_delivery_fee,address_version,supplier_config_version,acceptance_key,acceptance_hash,terms_snapshot,choice_revision,order_id,buyer_id,supplier_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[...values,oid,actor.id,order.supplier_id]);choiceId=created.insertId;}
   const response={choice_id:choiceId,...snapshot};
   await conn.query('INSERT INTO procurement_delivery_choice_events(choice_id,buyer_id,revision,event_key,payload_hash,response_snapshot) VALUES (?,?,?,?,?,?)',[choiceId,actor.id,revision,intent,digest,JSON.stringify(response)]);
   for(const [userId,role] of [[order.buyer_id,'BUYER'],[order.supplier_id,'SUPPLIER']])await this.notifications.enqueueEvent(conn,{userId,role,eventType:'DELIVERY_WINDOW_REQUESTED',eventKey:'choice:'+choiceId+':revision:'+revision,entityId:oid});
   await conn.commit();return {...response,is_replay:false};
  }catch(error){await conn.rollback();throw error;}finally{conn.release();}
 }
 async supplierChoices(actor){
  if(actor?.role!=='SUPPLIER')throw fail('DELIVERY_FORBIDDEN','Supplier required',403);
  const [rows]=await this.db.query("SELECT d.id,d.order_id,o.order_code,d.delivery_day,d.delivery_window,d.mode,d.handling_class,d.locked_delivery_fee,d.terms_snapshot FROM procurement_order_delivery_choices d JOIN orders o ON o.id=d.order_id AND o.supplier_id=d.supplier_id LEFT JOIN procurement_delivery_stops s ON s.order_id=o.id AND s.is_current=1 WHERE d.supplier_id=? AND o.payment_status='PAID' AND s.id IS NULL ORDER BY d.delivery_day,d.id LIMIT 100",[id(actor.id)]);return rows.map(row=>({...row,terms_snapshot:parse(row.terms_snapshot)}));
 }
 async createRun(actor,input,rawKey){
  const intent=key(rawKey);
  if(actor?.role!=='SUPPLIER')throw fail('DELIVERY_FORBIDDEN','Supplier required',403);
  if(!input||Object.keys(input).some(field=>!['order_ids','vehicle_id','planned_cost_pkr','handling_confirmed'].includes(field))||input.handling_confirmed!==true||!Array.isArray(input.order_ids)||input.order_ids.length<1||input.order_ids.length>50)throw fail('INVALID_ROUTE_STOPS','Explicit handling confirmation, owned vehicle and 1–50 orders required',400);
  const ids=input.order_ids.map(id).sort((a,b)=>a-b);if(new Set(ids).size!==ids.length)throw fail('DUPLICATE_ROUTE_ORDER','Order IDs must be distinct');
  const normalized={order_ids:ids,vehicle_id:id(input.vehicle_id),planned_cost_pkr:exact.toCanonical(input.planned_cost_pkr,2),handling_confirmed:true},digest=hash(normalized),conn=await this.db.getConnection();
  try{
   await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await conn.beginTransaction();await this._supplier(conn,actor);
   const [old]=await conn.query('SELECT * FROM procurement_delivery_runs WHERE supplier_id=? AND idempotency_key=? FOR UPDATE',[actor.id,intent]);
   if(old.length){if(old[0].request_hash!==digest)throw fail('IDEMPOTENCY_CONFLICT','Run intent belongs to different orders/capacity');await conn.commit();return {run_id:old[0].id,status:old[0].status,...parse(old[0].snapshot),is_replay:true};}
   const [vehicles]=await conn.query('SELECT * FROM procurement_delivery_vehicles WHERE id=? AND supplier_id=? FOR UPDATE',[normalized.vehicle_id,actor.id]);const vehicle=vehicles[0];if(!vehicle)throw fail('VEHICLE_NOT_FOUND','Own configured vehicle required',404);
   const choices=[],measures=[],orders=[];
   for(const oid of ids){
    const order=await this._order(conn,actor,oid);orders.push(order);
    await require('./orderAdminApprovalService').assertOrderAdminApproved(conn,oid);
    if(!['AWAITING_SUPPLIER_ACKNOWLEDGEMENT','PREPARING','READY_FOR_DISPATCH'].includes(order.fulfillment_status))throw fail('ROUTE_ORDER_NOT_READY','Only unassigned pre-dispatch paid orders are eligible');
    await require('./procurementCollectiveCommitmentService').assertFunded(conn,oid);
    const [assigned]=await conn.query('SELECT id FROM procurement_delivery_stops WHERE order_id=? AND is_current=1 FOR UPDATE',[oid]);if(assigned.length)throw fail('ORDER_ALREADY_ROUTED','Order already has a durable route assignment');
    const [selected]=await conn.query('SELECT * FROM procurement_order_delivery_choices WHERE order_id=? AND supplier_id=? FOR UPDATE',[oid,actor.id]);const choice=selected[0];
    if(!choice||choice.mode==='PICKUP'||!choice.terms_snapshot)throw fail('BUYER_DELIVERY_CHOICE_REQUIRED','Buyer must authorize delivery destination/window first');
    const [addresses]=await conn.query("SELECT revision,cluster_id,full_address FROM buyer_delivery_addresses WHERE id=? AND user_id=? AND geographic_match_status='VERIFIED' FOR UPDATE",[choice.delivery_address_id,order.buyer_id]);
    if(!addresses.length||Number(addresses[0].revision)!==Number(choice.address_version)||Number(addresses[0].cluster_id)!==Number(choice.cluster_id))throw fail('DELIVERY_ADDRESS_REAPPROVAL_REQUIRED','Destination revision changed');
    const [rows]=await conn.query('SELECT al.quantity,al.purchasing_unit,al.immutable_sku_snapshot FROM procurement_award_lines al JOIN procurement_award_orders ao ON ao.id=al.award_order_id WHERE ao.order_id=? ORDER BY al.id',[oid]);
    measures.push(measureLines(rows.map(row=>({...parse(row.immutable_sku_snapshot),quantity:row.quantity,purchasing_unit:row.purchasing_unit}))));choices.push(choice);
   }
   const compatible=compatibleRun(choices,measures,{...normalized,max_weight_kg:vehicle.max_weight_kg,max_volume_l:vehicle.max_volume_l}),first=choices[0],snapshot={...compatible,...normalized,vehicle:{id:vehicle.id,reference:vehicle.vehicle_reference,version:vehicle.version_number,max_weight_kg:vehicle.max_weight_kg,max_volume_l:vehicle.max_volume_l,capacity_basis:'SUPPLIER_DECLARED'},supplier_id:id(actor.id),cluster_id:Number(first.cluster_id),delivery_day:day(first.delivery_day),mode:first.mode,handling_class:first.handling_class};
   if(vehicle.handling_class!==snapshot.handling_class)throw fail('VEHICLE_HANDLING_INCOMPATIBLE','Configured vehicle handling differs from buyer-approved handling');
   const [conflicts]=await conn.query("SELECT id FROM procurement_delivery_runs WHERE vehicle_id=? AND delivery_day=? AND status IN ('PROPOSED','CONFIRMED','DISPATCHED') AND SUBSTRING_INDEX(delivery_window,'-',1)<? AND SUBSTRING_INDEX(delivery_window,'-',-1)>? FOR UPDATE",[vehicle.id,snapshot.delivery_day,compatible.delivery_window.split('-')[1],compatible.delivery_window.split('-')[0]]);if(conflicts.length)throw fail('VEHICLE_WINDOW_RESERVED','Vehicle already reserved for an overlapping route');
   const [[clock]]=await conn.query("SELECT CONVERT_TZ(CONCAT(?, ' ', ?),'+05:00','+00:00')>UTC_TIMESTAMP() live",[snapshot.delivery_day,compatible.delivery_window.split('-')[1]+':00']);if(Number(clock.live)!==1)throw fail('DELIVERY_WINDOW_EXPIRED','Compatible route window already elapsed');
   const [run]=await conn.query('INSERT INTO procurement_delivery_runs(supplier_id,cluster_id,delivery_day,delivery_window,mode,handling_class,locked_delivery_fee_total,planned_stops,idempotency_key,request_hash,snapshot,vehicle_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[actor.id,snapshot.cluster_id,snapshot.delivery_day,snapshot.delivery_window,snapshot.mode,snapshot.handling_class,compatible.locked_fee_total,ids.length,intent,digest,JSON.stringify(snapshot),vehicle.id]);
   for(const [index,choice] of choices.entries()){
    await conn.query('INSERT INTO procurement_delivery_stops(run_id,order_id,buyer_id,address_id,locked_delivery_fee,snapshot) VALUES (?,?,?,?,?,?)',[run.insertId,choice.order_id,choice.buyer_id,choice.delivery_address_id,choice.locked_delivery_fee,JSON.stringify({choice:parse(choice.terms_snapshot),measurement:measures[index],route_cost_share:compatible.allocations.find(value=>value.order_id===Number(choice.order_id)).cost_share,buyer_fee_unchanged:true})]);
    if(ids.length>1)await this.notifications.enqueueEvent(conn,{userId:choice.buyer_id,role:'BUYER',eventType:'CLUSTER_CREATED',eventKey:'run:'+run.insertId+':created',entityId:choice.order_id});
   }
   await conn.commit();return {run_id:run.insertId,status:'PROPOSED',...snapshot,is_replay:false};
  }catch(error){await conn.rollback();throw error;}finally{conn.release();}
 }
 async listRuns(actor){
  if(actor?.role!=='SUPPLIER')throw fail('DELIVERY_FORBIDDEN','Supplier required',403);
  const [rows]=await this.db.query('SELECT id,delivery_day,delivery_window,mode,status,planned_stops,locked_delivery_fee_total,snapshot FROM procurement_delivery_runs WHERE supplier_id=? ORDER BY id DESC LIMIT 100',[id(actor.id)]);return rows.map(row=>({...row,snapshot:parse(row.snapshot)}));
 }
 async transition(actor,runId,action,rawKey){
  const rid=id(runId),intent=key(rawKey);if(!['CONFIRM','DISPATCH','DELIVERED','CLOSE_WITH_EXCEPTIONS','CANCEL'].includes(action))throw fail('INVALID_ROUTE_ACTION','Unknown route action',400);
  const digest=hash({rid,action}),conn=await this.db.getConnection();
  try{
   await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await conn.beginTransaction();await this._supplier(conn,actor);
   const [lookup]=await conn.query('SELECT order_id FROM procurement_delivery_stops WHERE run_id=? ORDER BY order_id',[rid]);
   const orders=[];for(const stop of lookup)orders.push(await this._order(conn,actor,stop.order_id));
   const [runs]=await conn.query('SELECT * FROM procurement_delivery_runs WHERE id=? AND supplier_id=? FOR UPDATE',[rid,actor.id]);const run=runs[0];if(!run)throw fail('ROUTE_NOT_FOUND','Own route not found',404);
   const [prior]=await conn.query('SELECT payload_hash,event_snapshot FROM procurement_delivery_run_events WHERE run_id=? AND event_key=?',[rid,intent]);
   if(prior.length){if(prior[0].payload_hash!==digest)throw fail('IDEMPOTENCY_CONFLICT','Run action key belongs to different action');await conn.commit();return {...parse(prior[0].event_snapshot),is_replay:true};}
   const target={CONFIRM:'CONFIRMED',DISPATCH:'DISPATCHED',DELIVERED:'DELIVERED',CLOSE_WITH_EXCEPTIONS:'EXCEPTION',CANCEL:'CANCELLED'}[action],from={CONFIRM:'PROPOSED',DISPATCH:'CONFIRMED',DELIVERED:'DISPATCHED',CLOSE_WITH_EXCEPTIONS:'DISPATCHED'}[action];
   if(action==='CANCEL'?!['PROPOSED','CONFIRMED'].includes(run.status):run.status!==from)throw fail('ROUTE_STATE_CONFLICT','Route changed; refresh current state');
   if(!orders.length)throw fail('ROUTE_WITHOUT_STOPS','Route has no authorized stops');
   if(action==='CONFIRM'){
    const [[clock]]=await conn.query("SELECT CONVERT_TZ(CONCAT(?, ' ', ?),'+05:00','+00:00')>UTC_TIMESTAMP() live",[day(run.delivery_day),run.delivery_window.split('-')[1]+':00']);
    if(Number(clock.live)!==1)throw fail('DELIVERY_WINDOW_EXPIRED','A past delivery window cannot be confirmed');
    const [destinations]=await conn.query("SELECT s.id,a.revision,c.address_version,a.geographic_match_status,g.is_active FROM procurement_delivery_stops s JOIN procurement_order_delivery_choices c ON c.order_id=s.order_id JOIN buyer_delivery_addresses a ON a.id=s.address_id JOIN geographic_clusters g ON g.id=a.cluster_id WHERE s.run_id=? AND s.is_current=1 FOR UPDATE",[rid]);
    if(destinations.length!==orders.length||destinations.some(row=>Number(row.revision)!==Number(row.address_version)||row.geographic_match_status!=='VERIFIED'||Number(row.is_active)!==1))throw fail('DELIVERY_ADDRESS_REAPPROVAL_REQUIRED','Assigned destination changed before supplier confirmation');
   }
   for(const order of orders){
    await require('./orderAdminApprovalService').assertOrderAdminApproved(conn,order.id);
    await require('./procurementCollectiveCommitmentService').assertFunded(conn,order.id);
    if(action==='CONFIRM'&&!['AWAITING_SUPPLIER_ACKNOWLEDGEMENT','PREPARING','READY_FOR_DISPATCH'].includes(order.fulfillment_status))throw fail('ORDER_STATE_CONFLICT','Only a paid predispatch order can be assigned');
    if(action==='CANCEL'&&!['AWAITING_SUPPLIER_ACKNOWLEDGEMENT','PREPARING','READY_FOR_DISPATCH'].includes(order.fulfillment_status))throw fail('ORDER_STATE_CONFLICT','A dispatched order requires an actual failure or delivery workflow');
    if(action==='DISPATCH'&&order.fulfillment_status!=='DISPATCHED')throw fail('ORDER_DISPATCH_REQUIRED','Record each paid order dispatch through its fulfillment workflow first');
    if(action==='DELIVERED'&&!['SUPPLIER_DELIVERED','BUYER_CONFIRMED'].includes(order.fulfillment_status))throw fail('ORDER_DELIVERY_REQUIRED','Each order must have a verified supplier delivery report');
    if(action==='CLOSE_WITH_EXCEPTIONS'&&!['SUPPLIER_DELIVERED','BUYER_CONFIRMED','EXCEPTION'].includes(order.fulfillment_status))throw fail('ROUTE_STOPS_INCOMPLETE','Each stop must be delivered or have recorded exception evidence');
   }
   const response={run_id:rid,status:target,creates_charge:false,confirms_buyer_receipt:false};
   await conn.query('UPDATE procurement_delivery_runs SET status=? WHERE id=?',[target,rid]);
   if(action==='CANCEL')await conn.query('UPDATE procurement_delivery_stops SET is_current=0 WHERE run_id=? AND is_current=1',[rid]);
   await conn.query('INSERT INTO procurement_delivery_run_events(run_id,actor_id,event_type,event_key,payload_hash,event_snapshot) VALUES (?,?,?,?,?,?)',[rid,actor.id,'ROUTE_'+target,intent,digest,JSON.stringify(response)]);
   if(action==='CONFIRM')for(const order of orders){for(const type of ['ROUTE_ASSIGNED','DISPATCH_SCHEDULED'])await this.notifications.enqueueEvent(conn,{userId:order.buyer_id,role:'BUYER',eventType:type,eventKey:'run:'+rid+':'+target+':'+type,entityId:order.id});}
   if(action==='CANCEL')for(const order of orders)await this.notifications.enqueueEvent(conn,{userId:order.buyer_id,role:'BUYER',eventType:'DELIVERY_ROUTE_CANCELLED',eventKey:'run:'+rid+':cancelled',entityId:order.id});
   await conn.commit();return {...response,is_replay:false};
  }catch(error){await conn.rollback();throw error;}finally{conn.release();}
 }
 async buyerContext(actor,orderId){
  if(actor?.role!=='BUYER')throw fail('DELIVERY_FORBIDDEN','Owning buyer required',403);
  const [orders]=await this.db.query('SELECT id,procurement_delivery_snapshot FROM orders WHERE id=? AND buyer_id=?',[id(orderId),id(actor.id)]);if(!orders.length)throw fail('ORDER_NOT_FOUND','Own order not found',404);
  const [choices]=await this.db.query('SELECT choice_revision,terms_snapshot FROM procurement_order_delivery_choices WHERE order_id=? AND buyer_id=?',[orderId,actor.id]);
  const [stops]=await this.db.query('SELECT r.id AS run_id,r.delivery_day,r.delivery_window,r.mode,r.status,s.status AS stop_status,s.snapshot FROM procurement_delivery_stops s JOIN procurement_delivery_runs r ON r.id=s.run_id WHERE s.order_id=? AND s.buyer_id=? AND s.is_current=1',[orderId,actor.id]);
  return {order_id:Number(orderId),accepted_delivery_terms:parse(orders[0].procurement_delivery_snapshot),choice:choices.length?{...parse(choices[0].terms_snapshot),choice_revision:choices[0].choice_revision}:null,delivery:stops.length?{...stops[0],snapshot:parse(stops[0].snapshot)}:null,other_buyers_disclosed:false};
 }
 async updateEta(actor,runId,orderId,eta,rawKey){
  const rid=id(runId),oid=id(orderId),intent=key(rawKey);
  if(typeof eta!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(eta)||!Number.isFinite(Date.parse(eta)))throw fail('INVALID_DELIVERY_ETA','Offset-aware ETA required',400);
  const value=new Date(eta).toISOString(),digest=hash({rid,oid,eta:value}),conn=await this.db.getConnection();
  try{await conn.beginTransaction();await this._supplier(conn,actor);const order=await this._order(conn,actor,oid);
   const [routes]=await conn.query("SELECT r.* FROM procurement_delivery_runs r JOIN procurement_delivery_stops s ON s.run_id=r.id AND s.is_current=1 WHERE r.id=? AND r.supplier_id=? AND s.order_id=? FOR UPDATE",[rid,actor.id,oid]);const run=routes[0];if(!run||!['CONFIRMED','DISPATCHED'].includes(run.status))throw fail('ROUTE_NOT_ACTIVE','Own active assigned route required');
   const [prior]=await conn.query('SELECT payload_hash,event_snapshot FROM procurement_delivery_run_events WHERE run_id=? AND event_key=?',[rid,intent]);if(prior.length){if(prior[0].payload_hash!==digest)throw fail('IDEMPOTENCY_CONFLICT','ETA key belongs to different update');await conn.commit();return {...parse(prior[0].event_snapshot),is_replay:true};}
   const [[clock]]=await conn.query('SELECT (? >= UTC_TIMESTAMP() AND ?<=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 90 DAY)) live',[new Date(value),new Date(value)]);if(Number(clock.live)!==1)throw fail('INVALID_DELIVERY_ETA','ETA must be current/future within 90 days');
   const response={run_id:rid,order_id:oid,eta_utc:value};
   await conn.query("INSERT INTO procurement_delivery_run_events(run_id,order_id,actor_id,event_type,event_key,payload_hash,event_snapshot) VALUES (?,?,?,'ETA_CHANGED',?,?,?)",[rid,oid,actor.id,intent,digest,JSON.stringify(response)]);
   const deadline=Date.parse(day(run.delivery_day)+'T'+run.delivery_window.split('-')[1]+':00+05:00');
   for(const type of ['ETA_CHANGED',...(Date.parse(value)>deadline?['DELIVERY_DELAYED']:[])])await this.notifications.enqueueEvent(conn,{userId:order.buyer_id,role:'BUYER',eventType:type,eventKey:'run:'+rid+':eta:'+hash(intent).slice(0,24)+':'+type,entityId:oid});
   await conn.commit();return response;
  }catch(error){await conn.rollback();throw error;}finally{conn.release();}
 }
}
module.exports=new ProcurementDeliveryRunService();module.exports.ProcurementDeliveryRunService=ProcurementDeliveryRunService;
