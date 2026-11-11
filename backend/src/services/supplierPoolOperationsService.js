'use strict';
// Read-only UCP-3 stock and delivery perspective; B4/B5 publish engines alone lock inventory.
const db=require('../config/db');
const supplierDeliveryService=require('./supplierDeliveryService');
const exact=require('./exactDecimal');
const fail=(code,message,statusCode=409)=>Object.assign(new Error(message),{code,statusCode});
const id=x=>Number.isSafeInteger(Number(x))&&Number(x)>0;
class SupplierPoolOperationsService {
 async stock(supplierId,listingId){
  if(!id(supplierId)||!id(listingId))throw fail('INVALID_LISTING','Valid supplier listing ID required',400);
  const [listings]=await db.query(
   `SELECT sl.id,sl.supplier_id,sl.status,sl.supplier_sku_id,sl.product_spec_id,
     sl.available_stock,sl.pricing_unit,ps.purchasing_unit,ps.lifecycle_status,
     ps.supplier_id AS spec_supplier_id,ps.supplier_sku_id AS spec_sku_id,
     ps.approval_status,ps.is_active,sku.status AS sku_status
    FROM supplier_listings sl
    JOIN product_specifications ps ON ps.id=sl.product_spec_id
    JOIN supplier_skus sku ON sku.id=ps.supplier_sku_id
    WHERE sl.id=? AND sl.supplier_id=?`,[Number(listingId),Number(supplierId)]
  );
  if(!listings.length)throw fail('LISTING_NOT_FOUND','Supplier listing not found',404);
  const listing=listings[0];
  if(!listing.supplier_sku_id||listing.lifecycle_status!=='PUBLISHED'||
     listing.status!=='ACTIVE'||listing.approval_status!=='APPROVED'||
     Number(listing.is_active)!==1||listing.sku_status!=='PUBLISHED'||
     Number(listing.supplier_id)!==Number(listing.spec_supplier_id)||
     Number(listing.supplier_sku_id)!==Number(listing.spec_sku_id))
    throw fail('LISTING_NOT_ELIGIBLE','Only an active approved published supplier-owned physical SKU listing can be allocated');
  const [allocs]=await db.query(
    `SELECT unit,status,SUM(allocated_qty) AS quantity FROM supplier_inventory_allocations
     WHERE supplier_listing_id=? AND status IN ('PENDING','COMMITTED')
     GROUP BY unit,status`,[Number(listingId)]
  );
  const unit=String(listing.purchasing_unit||'').toLowerCase();
  if(!unit||unit!==String(listing.pricing_unit||'').toLowerCase()||
    allocs.some(x=>String(x.unit||'').toLowerCase()!==unit))
    throw fail('INVENTORY_UNIT_MISMATCH','Listing and allocation units must reconcile before selling');
  const stock=exact.toCanonical(listing.available_stock,4);
  const allocated=exact.exactDecimalSum(allocs.map(a=>a.quantity),4);
  const remaining=exact.exactDecimalGte(stock,allocated,4)
    ?exact.exactDecimalSum([stock,'-'+allocated],4):null;
  if(remaining===null)throw fail('INVENTORY_OVERALLOCATED','Stock allocations exceed published listing stock');
  return {listing_id:Number(listingId),sku_id:Number(listing.supplier_sku_id),unit,
    listed_stock:stock,allocated_stock:allocated,available_to_allocate:remaining,
    allocation_breakdown:allocs.map(a=>({status:a.status,quantity:exact.toCanonical(a.quantity,4)})),
    provisional:true,server_note:'Read-only snapshot; B4/B5 publish transaction rechecks inventory with locks.'};
 }
 async fulfillment(supplierId){
  if(!id(supplierId))throw fail('INVALID_SUPPLIER','Authenticated supplier required',403);
  const [settings,[clusters]]=await Promise.all([
    supplierDeliveryService.getSupplierSettings(Number(supplierId)),
    db.query(`SELECT id,name,cluster_code,district FROM geographic_clusters
      WHERE is_active=1 AND LOWER(district)='lahore' ORDER BY name`)
  ]);
  const standardEnabled=Boolean(settings.configuration?.standard_delivery_enabled);
  const eligible=new Set(standardEnabled?(settings.cluster_rates||[])
    .filter(x=>x.mode==='STANDARD_CLUSTERED'&&Number(x.is_eligible)===1)
    .map(x=>Number(x.cluster_id)):[]);
  return {configuration:settings.configuration,cluster_rates:settings.cluster_rates,
    pickup_points:settings.pickup_points,
    regular_eligible_clusters:clusters.filter(c=>eligible.has(Number(c.id))),
    flash_delivery_note:'Flash currently uses its existing B5 fixed delivery fee; clustered delivery must not be promised without a B5 contract.',
    server_time:new Date().toISOString()};
 }
}
module.exports=new SupplierPoolOperationsService();
