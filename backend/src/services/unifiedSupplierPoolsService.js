'use strict';
// Presentation-only supplier pool overview. B4 and B5 commercial state machines
// remain authoritative; B6 procurement groups are intentionally not included.
const db=require('../config/db');
const poolRepo=require('../repositories/poolRepo');
const validId=x=>Number.isSafeInteger(Number(x))&&Number(x)>0;
class UnifiedSupplierPoolsService {
  async list(supplierId) {
    if(!validId(supplierId))throw Object.assign(new Error('Supplier identity required'),{statusCode:400,code:'INVALID_SUPPLIER'});
    const [regular,flashRows,clock]=await Promise.all([
      poolRepo.findBySupplier(Number(supplierId)),
      db.query(`SELECT fp.id,fp.flash_code,fp.status,fp.supplier_listing_id,fp.supplier_sku_id,
          fp.total_stock,fp.remaining_stock,fp.min_quantity,fp.max_quantity_per_buyer,
          fp.purchase_increment,fp.clearance_reason,fp.condition_notes,fp.delivery_fee,fp.best_before_date,
          fp.discounted_unit_price,
          fp.original_unit_price,fp.selling_mode,fp.configured_duration_minutes,
          fp.published_at,fp.expiry_time,fp.created_at,
          DATE_FORMAT(fp.expiry_time,'%Y-%m-%dT%H:%i:%sZ') AS expiry_at_utc,
          ps.title AS sku_title,ps.purchasing_unit,sl.listing_code
        FROM flash_pools fp
        LEFT JOIN supplier_listings sl ON sl.id=fp.supplier_listing_id AND sl.supplier_id=fp.supplier_id
        LEFT JOIN product_specifications ps ON ps.id=fp.product_spec_id
        WHERE fp.supplier_id=? ORDER BY fp.id DESC LIMIT 200`,[Number(supplierId)]),
      db.query("SELECT DATE_FORMAT(UTC_TIMESTAMP(),'%Y-%m-%dT%H:%i:%sZ') AS server_time")
    ]);
    const now=clock[0][0].server_time;
    const poolIds=regular.map(p=>Number(p.id)).filter(Number.isSafeInteger);
    const [physicalTitles]=poolIds.length?await db.query(
      `SELECT p.id, ps.title AS sku_title
       FROM pools p JOIN product_specifications ps ON ps.id=p.product_spec_id
       WHERE p.supplier_id=? AND p.id IN (${poolIds.map(()=>'?').join(',')})`,
       [Number(supplierId),...poolIds]
    ):[[]];
    const titleMap=new Map(physicalTitles.map(p=>[Number(p.id),p.sku_title]));
    const [tiers]=poolIds.length
      ?await db.query(
        `SELECT pool_id,min_qty,max_qty,price_per_unit,pricing_unit
         FROM pool_price_tiers WHERE pool_id IN (${poolIds.map(()=>'?').join(',')})
         ORDER BY pool_id,min_qty`,poolIds)
      :[[]];
    const tierMap=new Map();
    for(const t of tiers){
      const items=tierMap.get(Number(t.pool_id))||[];
      items.push(t);tierMap.set(Number(t.pool_id),items);
    }

    const [poolClusters]=poolIds.length?await db.query(
      `SELECT pool_id,cluster_id FROM pool_delivery_clusters
       WHERE pool_id IN (${poolIds.map(()=>'?').join(',')}) ORDER BY cluster_id`,poolIds
    ):[[]];
    const clustersByPool=new Map();
    for(const row of poolClusters){
      const list=clustersByPool.get(Number(row.pool_id))||[];
      list.push(Number(row.cluster_id));clustersByPool.set(Number(row.pool_id),list);
    }
    const regularRows=regular.map(p=>({
      id:p.id,type:'REGULAR',code:p.pool_code,status:p.status,
      supplier_listing_id:p.supplier_listing_id,supplier_sku_id:p.supplier_sku_id,
      product_title:titleMap.get(Number(p.id))||p.product_title||null,
      supplier_min_qty:p.supplier_min_qty,buyer_min_qty:p.buyer_min_qty,
      max_capacity:p.max_capacity,purchase_increment:p.purchase_increment,
      promised_delivery_at:p.promised_delivery_at,delivery_type:p.delivery_type,
      price_tiers:tierMap.get(Number(p.id))||[],
      delivery_cluster_ids:clustersByPool.get(Number(p.id))||[],
      quantity_current:p.current_qty,quantity_target:p.target_qty,
      quantity_available:null,unit:p.pool_unit,price:p.current_price_per_unit,
      expires_at:p.scheduled_close_at||p.expires_at,
      created_at:p.created_at,can_edit:p.status==='DRAFT'&&!p.is_terms_locked,
      can_publish:p.status==='DRAFT'&&!p.is_terms_locked
    }));
    const flash=flashRows[0].map(p=>({
      id:p.id,type:'FLASH',code:p.flash_code,status:p.status,
      supplier_listing_id:p.supplier_listing_id,supplier_sku_id:p.supplier_sku_id,
      product_title:p.sku_title||null,
      quantity_current:p.total_stock==null?null:Number(p.total_stock)-Number(p.remaining_stock),
      quantity_target:p.total_stock,quantity_available:p.remaining_stock,
      unit:p.purchasing_unit,price:p.discounted_unit_price,
      expires_at:p.expiry_at_utc,configured_duration_minutes:p.configured_duration_minutes,
      selling_mode:p.selling_mode,min_quantity:p.min_quantity,
      max_quantity_per_buyer:p.max_quantity_per_buyer,
      purchase_increment:p.purchase_increment,clearance_reason:p.clearance_reason,
      condition_notes:p.condition_notes,delivery_fee:p.delivery_fee,
      best_before_date:p.best_before_date,
      created_at:p.created_at,can_edit:p.status==='DRAFT',can_publish:p.status==='DRAFT'
    }));
    return {pools:[...regularRows,...flash].sort((a,b)=>
      new Date(b.created_at||0).getTime()-new Date(a.created_at||0).getTime()),
      counts:{regular:regularRows.length,flash:flash.length,total:regularRows.length+flash.length},
      server_time:now};
  }
}
module.exports=new UnifiedSupplierPoolsService();
