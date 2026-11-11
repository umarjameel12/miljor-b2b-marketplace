'use strict';
// UCP-4: read-only buyer discovery facade; never mutate B4/B5 or expose B6.
const db=require('../config/db');
const poolRepo=require('../repositories/poolRepo');
const progress=require('./poolProgressService');
const flash=require('./flashPoolService');
const reject=(code,message)=>Object.assign(new Error(message),{code,statusCode:400});
const parseId=(value,name)=>{
  if(value==null||value==='')return null;
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<=0)throw reject('INVALID_'+name.toUpperCase(),'Valid '+name+' required.');
  return n;
};
class UnifiedPoolDiscoveryService {
 async list(raw={}){
   const type=String(raw.type||'ALL').toUpperCase();
   if(!['ALL','REGULAR','FLASH'].includes(type))throw reject('INVALID_POOL_TYPE','Use ALL, REGULAR or FLASH');
   const categoryId=parseId(raw.category_id,'category_id');
   const familyId=parseId(raw.family_id,'family_id');
   const clusterId=parseId(raw.cluster_id,'cluster_id');
   const search=String(raw.search||'').trim().toLowerCase();
   if(search.length>120)throw reject('INVALID_SEARCH','Search exceeds 120 characters');
   const limit=raw.limit==null?60:Number(raw.limit);
   if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw reject('INVALID_LIMIT','Limit must be 1–100');
   const includeRegular=type!=='FLASH',includeFlash=type!=='REGULAR';
   // B4's cluster filter has authoritative area + supplier-rate + pickup logic.
   const [regularRaw,flashRaw]=await Promise.all([
     includeRegular?poolRepo.findAllActive({cluster_id:clusterId||undefined}):[],
     includeFlash?flash.getActive({}):[]
   ]);
   let regular=[];
   if(regularRaw.length){
     const eligibleIds=regularRaw.map(r=>Number(r.id)).filter(Number.isSafeInteger);
     // Filter historical/legacy physical products and unverified suppliers out of NEW discovery.
     const [eligible]=await db.query(
       `SELECT p.id,ps.family_id,ps.category_id,ps.title AS physical_title,
               ps.purchasing_unit,sl.base_unit_price
        FROM pools p
        JOIN supplier_listings sl ON sl.id=p.supplier_listing_id AND sl.supplier_id=p.supplier_id AND sl.status='ACTIVE'
        JOIN product_specifications ps ON ps.id=p.product_spec_id AND ps.supplier_sku_id=p.supplier_sku_id
          AND ps.supplier_id=p.supplier_id AND ps.lifecycle_status='PUBLISHED'
          AND ps.approval_status='APPROVED' AND ps.is_active=1
        JOIN supplier_skus sku ON sku.id=p.supplier_sku_id AND sku.supplier_id=p.supplier_id AND sku.status='PUBLISHED'
        JOIN supplier_products sp ON sp.id=sku.supplier_product_id AND sp.supplier_id=p.supplier_id AND sp.status='PUBLISHED'
        JOIN catalog_product_families fam ON fam.id=ps.family_id AND fam.is_active=1 AND fam.approval_status='APPROVED'
        JOIN catalog_categories cat ON cat.id=ps.category_id AND cat.is_active=1 AND cat.approval_status='APPROVED'
        JOIN users u ON u.id=p.supplier_id AND u.role='SUPPLIER'
          AND u.is_verified=1 AND u.verification_status='VERIFIED'
        JOIN supplier_profiles prof ON prof.supplier_id=p.supplier_id AND prof.verification_status='VERIFIED'
        WHERE p.id IN (${eligibleIds.map(()=>'?').join(',')})
          AND p.status='ACTIVE' AND p.expires_at>UTC_TIMESTAMP()`,eligibleIds
     );
     const eligibleMap=new Map(eligible.map(e=>[Number(e.id),e]));
     const authorized=regularRaw.filter(p=>eligibleMap.has(Number(p.id)));
     const enriched=await progress.enrichPoolsList(authorized);
     regular=enriched.map(p=>{
       const physical=eligibleMap.get(Number(p.id));
       return {type:'REGULAR',id:p.id,code:p.pool_code,status:p.status,
         product_title:physical.physical_title,supplier_name:p.supplier_name,
         supplier_sku_id:p.supplier_sku_id,supplier_listing_id:p.supplier_listing_id,
         category_id:physical.category_id,family_id:physical.family_id,unit:physical.purchasing_unit,
         current_qty:p.current_qty,target_qty:p.target_qty,minimum_qty:p.supplier_min_qty,
         buyer_min_qty:p.buyer_min_qty,estimated_unit_price:p.estimated_unit_price,
         next_tier_quantity:p.next_tier_quantity,next_tier_price:p.next_tier_price||null,
         additional_quantity_for_next_tier:p.additional_quantity_for_next_tier,
         pool_close_at:p.scheduled_close_at||p.expires_at,promised_delivery_at:p.promised_delivery_at,
         can_join:Boolean(p.can_join),delivery_modes:p.fulfillment_modes_available||[],
         delivery_quote_required:true};
     });
   }
   let flashes=[];
   if(flashRaw.length){
     const ids=flashRaw.map(p=>Number(p.id)).filter(Number.isSafeInteger);
     const [tax]=await db.query(
       `SELECT fp.id,ps.family_id,ps.category_id
        FROM flash_pools fp JOIN product_specifications ps ON ps.id=fp.product_spec_id
        WHERE fp.id IN (${ids.map(()=>'?').join(',')})`,ids);
     const taxonomy=new Map(tax.map(p=>[Number(p.id),p]));
     // Buyer cluster discovery for Flash requires an eligible supplier delivery rate
     // or same-cluster active pickup point; NEVER label unconditional delivery eligible.
     let eligibleSuppliers=null;
     if(clusterId){
       const [rates]=await db.query(
         `SELECT DISTINCT x.supplier_id FROM (
           SELECT r.supplier_id FROM supplier_delivery_cluster_rates r
             JOIN supplier_delivery_configurations c ON c.supplier_id=r.supplier_id
           WHERE r.cluster_id=? AND r.is_eligible=1
             AND ((r.mode='STANDARD_CLUSTERED' AND c.standard_delivery_enabled=1)
               OR (r.mode='EXPRESS' AND c.express_enabled=1))
           UNION
           SELECT pp.supplier_id FROM supplier_pickup_points pp
             JOIN supplier_delivery_configurations c ON c.supplier_id=pp.supplier_id
           WHERE pp.cluster_id=? AND pp.is_active=1 AND c.pickup_enabled=1
         ) x`,[clusterId,clusterId]);
       eligibleSuppliers=new Set(rates.map(x=>Number(x.supplier_id)));
     }
     flashes=flashRaw.filter(p=>taxonomy.has(Number(p.id)) &&
       (!eligibleSuppliers || eligibleSuppliers.has(Number(p.supplier_id)))).map(p=>{
       const t=taxonomy.get(Number(p.id));
       return {type:'FLASH',id:p.id,code:p.flash_code,status:p.status,
         product_title:p.sku_title,supplier_name:p.supplier_name,
         supplier_sku_id:p.supplier_sku_id,supplier_listing_id:p.supplier_listing_id,
         category_id:t.category_id,family_id:t.family_id,unit:p.purchasing_unit,
         remaining_stock:p.remaining_stock,total_stock:p.total_stock,
         min_quantity:p.min_quantity,max_quantity_per_buyer:p.max_quantity_per_buyer,
         selling_mode:p.selling_mode,discounted_unit_price:p.discounted_unit_price,
         original_unit_price:p.original_unit_price,
         clearance_reason:p.clearance_reason,condition_notes:p.condition_notes,
         best_before_date:p.best_before_date,
         pool_close_at:p.expiry_at_utc,can_join:Number(p.remaining_stock)>0,
         delivery_fee_pkr:p.delivery_fee,delivery_quote_required:true};
     });
   }
   const matches=p=>(!categoryId||Number(p.category_id)===categoryId)&&
     (!familyId||Number(p.family_id)===familyId)&&
     (!search||[p.product_title,p.supplier_name,p.code].some(v=>String(v||'').toLowerCase().includes(search)));
   const all=[...regular.filter(matches),...flashes.filter(matches)];
   all.sort((a,b)=>new Date(a.pool_close_at).getTime()-new Date(b.pool_close_at).getTime());
   const [[clock]]=await db.query("SELECT DATE_FORMAT(UTC_TIMESTAMP(),'%Y-%m-%dT%H:%i:%sZ') AS server_time");
   return {pools:all.slice(0,limit),server_time:clock.server_time,
     returned:Math.min(all.length,limit),has_more:all.length>limit,requested_type:type,
     note:'Discovery is an offer preview. Buyer delivery eligibility, unit price and checkout are validated by the original B4/B5 engines.'};
 }
}
module.exports=new UnifiedPoolDiscoveryService();
