'use strict';
// Read-only buyer-owned procurement quotation delivery discovery.
// No supplier ID or delivery fee is taken from client input.
const db=require('../config/db');
const deliveryEligibility=require('./deliveryEligibilityService');
const fail=(code,message,statusCode=400)=>Object.assign(new Error(message),{code,statusCode});
const id=v=>{
  if(v==null||typeof v==='boolean'||!/^[1-9]\d*$/.test(String(v))||!Number.isSafeInteger(Number(v)))
    throw fail('INVALID_DELIVERY_ID','Valid positive numeric identifier required');
  return Number(v);
};
class ProcurementDeliveryOptionsService{
  constructor(database=db,eligibility=deliveryEligibility){this.database=database;this.eligibility=eligibility;}
  async forBuyer(buyerId,requestId,quoteId,clusterId){
    const buyer=id(buyerId),request=id(requestId),quote=id(quoteId),cluster=id(clusterId);
    const [rows]=await this.database.query(
      'SELECT q.id,q.supplier_id,q.status,q.current_version, '+
      'r.delivery_area,r.status AS request_status,v.valid_until, '+
      'v.delivery_fee,v.delivery_lead_days '+
      'FROM procurement_requests r JOIN procurement_quotes q ON q.request_id=r.id '+
      'JOIN procurement_quote_versions v ON v.quote_id=q.id AND v.version_number=q.current_version '+
      'WHERE r.id=? AND r.buyer_id=? AND q.id=?',
      [request,buyer,quote]
    );
    if(!rows.length)throw fail('QUOTE_NOT_FOUND','Buyer quotation not found',404);
    const owned=rows[0];
    if(owned.status!=='ACTIVE'||owned.request_status!=='OPEN')
      throw fail('QUOTE_NOT_AVAILABLE','Supplier quotation is not active',409);
    if(new Date(owned.valid_until)<=new Date())
      throw fail('QUOTE_EXPIRED','Quotation has expired',409);
    const options=await this.eligibility.getDeliveryOptions(buyer,
      {supplier_id:Number(owned.supplier_id),cluster_id:cluster},undefined,{procurement:true});
    return {
      request_id:request,quote_id:quote,quote_version:Number(owned.current_version),
      supplier_id:Number(owned.supplier_id),buyer_cluster:options.buyer_cluster,
      eligible_modes:options.eligible_modes,ineligible_modes:options.ineligible_modes,
      supplier_config_version:options.supplier_config_version,
      current_quote_delivery_fee:owned.delivery_fee,
      current_quote_lead_days:owned.delivery_lead_days,
      mode_selection_binding_enabled:false,
      note:'Eligibility is informational. Supplier must publish a confirmed mode-specific quote before checkout.'
    };
  }
}
module.exports=new ProcurementDeliveryOptionsService();
module.exports.ProcurementDeliveryOptionsService=ProcurementDeliveryOptionsService;
