'use strict';
const db=require('../config/db');
const eligibility=require('./deliveryEligibilityService');
const notifications=require('./notificationService');
const exact=require('./exactDecimal');
const crypto=require('node:crypto');
const {snapshotDeliveryTerms,pickupSnapshot}=require('./procurementDeliveryBindingPolicy');
const fail=(code,message,statusCode=409)=>Object.assign(new Error(message),{code,statusCode});
const id=value=>{if(!/^[1-9]\d*$/.test(String(value))||!Number.isSafeInteger(Number(value)))throw fail('INVALID_DELIVERY_ID','Invalid delivery identifier',400);return Number(value);};
class ProcurementDeliveryBindingService{
  constructor(database=db,delivery=eligibility){this.database=database;this.delivery=delivery;}
  async choose(buyerId,requestId,quoteId,input,key){
    const buyer=id(buyerId),request=id(requestId),quote=id(quoteId);
    if(!input||Object.keys(input).some(field=>!['cluster_id','address_id','mode','pickup_point_id'].includes(field)))throw fail('INVALID_DELIVERY_CHOICE','Only delivery destination and mode may be supplied',400);
    if(typeof key!=='string'||!/^[A-Za-z0-9:_-]{12,120}$/.test(key))throw fail('INVALID_IDEMPOTENCY_KEY','A stable delivery intent key is required',400);
    const normalized={request,quote,cluster_id:id(input.cluster_id),address_id:input.address_id==null?null:id(input.address_id),mode:input.mode,pickup_point_id:input.pickup_point_id==null?null:id(input.pickup_point_id)};
    const hash=crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    const connection=await this.database.getConnection();
    try{
      await connection.beginTransaction();
      const [buyers]=await connection.query('SELECT id,role,is_verified,verification_status,buyer_trust_status FROM users WHERE id=? FOR UPDATE',[buyer]);
      const activeBuyer=buyers[0];
      if(!activeBuyer||activeBuyer.role!=='BUYER'||Number(activeBuyer.is_verified)!==1||!['VERIFIED','EMAIL_VERIFIED'].includes(activeBuyer.verification_status)||activeBuyer.buyer_trust_status==='SUSPENDED')throw fail('BUYER_NOT_ELIGIBLE','Active verified buyer required',403);
      const [previous]=await connection.query('SELECT * FROM delivery_quotes WHERE buyer_id=? AND procurement_choice_key=? FOR UPDATE',[buyer,key]);
      if(previous.length){
        if(previous[0].procurement_choice_hash!==hash)throw fail('IDEMPOTENCY_CONFLICT','Delivery intent key belongs to different terms');
        await connection.commit();return {delivery_terms:snapshotDeliveryTerms(previous[0]),requires_supplier_revised_quote:true,creates_order:false,is_replay:true};
      }
      const [requests]=await connection.query('SELECT id FROM procurement_requests WHERE id=? AND buyer_id=? AND status=\'OPEN\' AND quote_deadline>UTC_TIMESTAMP() FOR UPDATE',[request,buyer]);
      if(!requests.length)throw fail('REQUEST_NOT_FOUND','Active buyer request not found',404);
      const [quotes]=await connection.query("SELECT q.supplier_id FROM procurement_quotes q JOIN procurement_quote_versions v ON v.quote_id=q.id AND v.version_number=q.current_version WHERE q.id=? AND q.request_id=? AND q.status='ACTIVE' AND v.valid_until>UTC_TIMESTAMP() FOR UPDATE",[quote,request]);
      if(!quotes.length)throw fail('QUOTE_NOT_FOUND','Active quotation not found',404);
      const result=await this.delivery.createAuthoritativeQuote(buyer,{supplier_id:quotes[0].supplier_id,
        cluster_id:id(input.cluster_id),address_id:input.address_id==null?null:id(input.address_id),
        mode:input.mode,pickup_point_id:input.pickup_point_id==null?null:id(input.pickup_point_id)},connection,{procurement:true});
      await connection.query('UPDATE delivery_quotes SET procurement_request_id=?,procurement_quote_id=?,procurement_choice_key=?,procurement_choice_hash=? WHERE quote_code=?',[request,quote,key,hash,result.quote_code]);
      if(input.mode==='PICKUP'){
        const [points]=await connection.query('SELECT * FROM supplier_pickup_points WHERE id=? AND supplier_id=? AND is_active=1 FOR UPDATE',[result.pickup_point_id,quotes[0].supplier_id]);
        if(!points.length)throw fail('PICKUP_POINT_UNAVAILABLE','Pickup point changed');
        await connection.query('UPDATE delivery_quotes SET procurement_pickup_snapshot=? WHERE quote_code=?',[JSON.stringify(pickupSnapshot(points[0])),result.quote_code]);
      }
      const [saved]=await connection.query('SELECT * FROM delivery_quotes WHERE quote_code=?',[result.quote_code]);
      const terms=snapshotDeliveryTerms(saved[0]);
      await connection.query("UPDATE delivery_quotes SET status='SUPERSEDED' WHERE procurement_quote_id=? AND buyer_id=? AND status='PENDING' AND quote_code<>?",[quote,buyer,result.quote_code]);
      await notifications.enqueueEvent(connection,{userId:Number(quotes[0].supplier_id),role:'SUPPLIER',eventType:'DELIVERY_CHOICE_RECORDED',eventKey:'delivery-choice:'+result.quote_code,entityId:request});
      await connection.commit();return {delivery_terms:terms,requires_supplier_revised_quote:true,creates_order:false};
    }catch(error){await connection.rollback();throw error;}finally{connection.release();}
  }
  async forSupplier(supplierId,requestId){
    const [rows]=await this.database.query(
      "SELECT d.* FROM delivery_quotes d JOIN procurement_quotes q ON q.id=d.procurement_quote_id WHERE d.procurement_request_id=? AND q.supplier_id=? AND d.status='PENDING' AND d.expires_at>UTC_TIMESTAMP() ORDER BY d.id DESC LIMIT 20",[id(requestId),id(supplierId)]);
    return rows.map(snapshotDeliveryTerms);
  }
  async validate(connection,{buyerId,supplierId,requestId,quoteId,code,fee,validUntil}){
    const [rows]=await connection.query(
      "SELECT *,expires_at>UTC_TIMESTAMP() AS is_live FROM delivery_quotes WHERE quote_code=? AND buyer_id=? AND supplier_id=? AND procurement_request_id=? AND procurement_quote_id=? FOR UPDATE",
      [code,buyerId,supplierId,requestId,quoteId]);
    const row=rows[0];
    if(!row||row.status!=='PENDING'||Number(row.is_live)!==1)throw fail('DELIVERY_TERMS_UNAVAILABLE','Delivery choice is missing, expired or already consumed');
    const terms=snapshotDeliveryTerms(row);
    if(!exact.exactDecimalEquals(terms.fee,fee,2))throw fail('DELIVERY_FEE_MISMATCH','Supplier delivery fee must match the approved delivery choice');
    if(validUntil&&Date.parse(String(validUntil).replace(' ','T')+'Z')>Date.parse(terms.expires_at))throw fail('DELIVERY_VALIDITY_MISMATCH','Supplier quote cannot outlive delivery terms');
    await connection.query('SELECT id FROM supplier_delivery_configurations WHERE supplier_id=? FOR UPDATE',[supplierId]);
    await connection.query('SELECT id FROM supplier_delivery_cluster_rates WHERE supplier_id=? AND cluster_id=? FOR UPDATE',[supplierId,terms.cluster_id]);
    if(terms.mode==='PICKUP'){
      const [points]=await connection.query('SELECT * FROM supplier_pickup_points WHERE id=? AND supplier_id=? AND is_active=1 FOR UPDATE',[terms.pickup_point_id,supplierId]);
      if(!terms.pickup_snapshot||!points.length||JSON.stringify(pickupSnapshot(points[0]))!==JSON.stringify(terms.pickup_snapshot))throw fail('DELIVERY_REAPPROVAL_REQUIRED','Pickup point changed; fresh approval required');
    }else{
      const [addresses]=await connection.query('SELECT revision,cluster_id,geographic_match_status FROM buyer_delivery_addresses WHERE id=? AND user_id=? FOR UPDATE',[terms.address_id,buyerId]);
      const address=addresses[0];
      if(!address||address.geographic_match_status!=='VERIFIED'||Number(address.cluster_id)!==terms.cluster_id||Number(address.revision)!==terms.address_revision)throw fail('DELIVERY_REAPPROVAL_REQUIRED','Destination changed or is no longer verified');
    }
    const options=await this.delivery.getDeliveryOptions(buyerId,{supplier_id:supplierId,cluster_id:terms.cluster_id,address_id:terms.address_id},connection,{procurement:true});
    const mode=options.eligible_modes.find(option=>option.mode===terms.mode);
    if(terms.mode==='INDIVIDUAL'&&Number(mode?.supplier_rate_version)!==terms.supplier_rate_version)throw fail('DELIVERY_REAPPROVAL_REQUIRED','Individual rate revision changed; request fresh terms');
    const currentFee=terms.mode==='PICKUP'?mode?.pickup_points?.find(point=>Number(point.id)===terms.pickup_point_id)?.handling_fee_pkr:mode?.fee_pkr;
    if(Number(options.supplier_config_version)!==terms.supplier_config_version||currentFee==null||!exact.exactDecimalEquals(String(currentFee),terms.fee,2))throw fail('DELIVERY_REAPPROVAL_REQUIRED','Delivery eligibility or rates changed; request fresh terms');
    return terms;
  }
}
module.exports=new ProcurementDeliveryBindingService();
module.exports.ProcurementDeliveryBindingService=ProcurementDeliveryBindingService;
