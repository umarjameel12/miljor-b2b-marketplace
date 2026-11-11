'use strict';
// B6-N demand-first adapter: read-only bridge to existing Request a Pool.
// Does not convert/close a legacy pool request or invent a supplier bid.
const db=require('../config/db');
const exact=require('./exactDecimal');
const fail=(code,message,statusCode=400)=>Object.assign(new Error(message),{code,statusCode});
const id=v=>{
 if(v==null||typeof v==='boolean'||!/^[1-9]\d*$/.test(String(v))||
  !Number.isSafeInteger(Number(v)))throw fail('INVALID_DEMAND_ID','Positive buyer request ID required.');
 return Number(v);
};
const approvedUnits=new Set(['kg','g','l','ml','bag','tin','carton','sack','bundle','pack']);
const redact=s=>String(s||'').trim().slice(0,2000)
 .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[contact hidden]')
 .replace(/(?:\+?92|0)\s*3\d{2}[\s().-]*\d{3}[\s().-]*\d{4}/g,'[contact hidden]');
class ProcurementDemandFirstAdapter{
 constructor(database=db){this.database=database;}
 async buyerPreview(buyerId,demandId){
  const buyer=id(buyerId),rid=id(demandId);
  const [rows]=await this.database.query(
   "SELECT d.id,d.request_code,d.buyer_id,d.family_id,d.category_id,d.target_quantity,d.target_unit,d.desired_specs,d.target_price_per_unit,d.cluster_id,d.needed_by_date,d.status FROM demand_pool_requests d JOIN catalog_product_families f ON f.id=d.family_id AND f.category_id=d.category_id AND f.is_active=1 AND f.approval_status='APPROVED' JOIN catalog_categories c ON c.id=f.category_id AND c.is_active=1 AND c.approval_status='APPROVED' WHERE d.id=? AND d.buyer_id=?",
   [rid,buyer]);
  if(!rows.length)throw fail('DEMAND_NOT_FOUND','Owned legacy demand request not found.',404);
  const r=rows[0];
  if(r.status!=='OPEN')throw fail('DEMAND_NO_LONGER_OPEN','Only open demand requests can be previewed.',409);
  const unit=String(r.target_unit||'').toLowerCase();
  if(!approvedUnits.has(unit))
   throw fail('DEMAND_UNIT_INCOMPATIBLE','Legacy unit needs explicit buyer correction.',409);
  let quantity;
  try{
   quantity=exact.toCanonical(r.target_quantity,4);
   if(!exact.exactDecimalGte(quantity,'0.0001',4)||
    ['bag','tin','carton','sack','bundle','pack'].includes(unit)&&
      !/^\d+\.0000$/.test(quantity))throw Error();
  }catch{throw fail('DEMAND_QUANTITY_INCOMPATIBLE','Legacy quantity cannot safely map to actual units.',409);}
  return {legacy_demand_id:rid,request_code:r.request_code,
   status:'PREVIEW_ONLY',items:[{family_id:r.family_id,quantity,unit,
     requirements:redact(r.desired_specs),allow_substitutions:false}],
   target_price_reference:r.target_price_per_unit==null?null:
    exact.toCanonical(r.target_price_per_unit,2),
   cluster_id:r.cluster_id,needed_by_date:r.needed_by_date,
   owner_confirmation_required:true,creates_smart_request:false,
   joins_collective:false,creates_order:false,reserves_stock:false,
   supplier_bid_not_assumed:true,
   next_step:'Buyer must explicitly create a new Smart Procurement RFQ; legacy Request a Pool remains unchanged.'};
 }
 async buyerList(buyerId){
  const buyer=id(buyerId);
  const [rows]=await this.database.query(
   "SELECT id,request_code,family_id,target_quantity,target_unit,cluster_id,needed_by_date,status FROM demand_pool_requests WHERE buyer_id=? ORDER BY id DESC LIMIT 100",[buyer]);
  return rows;
 }
}
module.exports=new ProcurementDemandFirstAdapter();
module.exports.ProcurementDemandFirstAdapter=ProcurementDemandFirstAdapter;
