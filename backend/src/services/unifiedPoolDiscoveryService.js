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
   const fulfillment=String(raw.fulfillment_mode||'ALL').toUpperCase();
   if(!['ALL','STANDARD_CLUSTERED','EXPRESS','PICKUP'].includes(fulfillment))
     throw reject('INVALID_FULFILLMENT_MODE','Invalid delivery mode filter');
   const search=String(raw.search||'').trim().toLowerCase();
   if(search.length>120)throw reject('INVALID_SEARCH','Search exceeds 120 characters');
   const filterSignature=JSON.stringify({type,categoryId,familyId,clusterId,search,
     fulfillment,include_all_pickup:raw.include_all_pickup==='true'});
   let offset=0;
   if(raw.cursor!=null && raw.cursor!==''){
     const cursor=String(raw.cursor);
     if(cursor.length>256 || !/^[A-Za-z0-9_-]+$/.test(cursor))
       throw reject('INVALID_CURSOR','Invalid pagination cursor.');
     try{
       const decoded=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));
       if(decoded.filters!==filterSignature || !Number.isSafeInteger(decoded.offset)||
         decoded.offset<0||decoded.offset>50000)throw Error('invalid');
       offset=decoded.offset;
     }catch{throw reject('INVALID_CURSOR','Cursor is invalid for these filters.');}
   }
   const limit=raw.limit==null?60:Number(raw.limit);
   if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw reject('INVALID_LIMIT','Limit must be 1–100');
   const includeRegular=type!=='FLASH',includeFlash=type!=='REGULAR';
   // B4's cluster filter has authoritative area + supplier-rate + pickup logic.
   const [regularRaw,flashRaw]=await Promise.all([
     includeRegular?poolRepo.findAllActive({cluster_id:clusterId||undefined,
       fulfillment_mode:fulfillment==='ALL'?undefined:fulfillment,
       include_all_pickup:raw.include_all_pickup==='true'}):[],
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
     let clusterModeIds=null;
     if(clusterId&&fulfillment!=='ALL'&&enriched.length){
       const poolIds=enriched.map(x=>Number(x.id));
       let rows;
       if(fulfillment==='PICKUP'){
         [rows]=await db.query(
           `SELECT DISTINCT p.id AS pool_id FROM pools p
            JOIN supplier_pickup_points pp ON pp.supplier_id=p.supplier_id
            JOIN supplier_delivery_configurations c ON c.supplier_id=p.supplier_id
            WHERE p.id IN (${poolIds.map(()=>'?').join(',')})
              AND pp.cluster_id=? AND pp.is_active=1 AND c.pickup_enabled=1`,
           [...poolIds,clusterId]);
       }else{
         [rows]=await db.query(
           `SELECT DISTINCT p.id AS pool_id FROM pools p
            JOIN pool_delivery_clusters pdc ON pdc.pool_id=p.id
            JOIN supplier_delivery_cluster_rates r ON r.supplier_id=p.supplier_id
              AND r.cluster_id=pdc.cluster_id
            JOIN supplier_delivery_configurations c ON c.supplier_id=p.supplier_id
            WHERE p.id IN (${poolIds.map(()=>'?').join(',')})
              AND pdc.cluster_id=? AND r.mode=? AND r.is_eligible=1
              AND ((r.mode='STANDARD_CLUSTERED' AND c.standard_delivery_enabled=1)
                OR (r.mode='EXPRESS' AND c.express_enabled=1))`,
           [...poolIds,clusterId,fulfillment]);
       }
       clusterModeIds=new Set(rows.map(x=>Number(x.pool_id)));
     }
     regular=enriched.filter(p=>(fulfillment==='ALL'||(p.fulfillment_modes_available||[]).includes(
       fulfillment==='PICKUP'?'SUPPLIER_PICKUP':fulfillment)) &&
       (!clusterModeIds||clusterModeIds.has(Number(p.id)))).map(p=>{
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
   if(flashRaw.length && ['ALL','STANDARD_CLUSTERED'].includes(fulfillment)){
     const ids=flashRaw.map(p=>Number(p.id)).filter(Number.isSafeInteger);
     const [tax]=await db.query(
       `SELECT fp.id,ps.family_id,ps.category_id
        FROM flash_pools fp JOIN product_specifications ps ON ps.id=fp.product_spec_id
        WHERE fp.id IN (${ids.map(()=>'?').join(',')})`,ids);
     const taxonomy=new Map(tax.map(p=>[Number(p.id),p]));
     // Flash currently supports verified Standard Clustered Doorstep only.
     // Display no fixed fee: the actual configured cluster rate is calculated
     // authoritatively during the buyer's locked stock hold. Never advertise
     // Pickup or Express until their order/quote lifecycle is implemented.
     let eligibleSuppliers=null;
     // A Flash offer must serve at least one enabled Lahore cluster even
     // when the buyer browses without selecting a destination filter.
     {
       const [rates]=await db.query(
         `SELECT DISTINCT r.supplier_id FROM supplier_delivery_cluster_rates r
            JOIN supplier_delivery_configurations c ON c.supplier_id=r.supplier_id
            JOIN geographic_clusters g ON g.id=r.cluster_id
            WHERE r.mode='STANDARD_CLUSTERED' AND r.is_eligible=1
              AND c.standard_delivery_enabled=1 AND g.is_active=1 AND g.district='Lahore'
              AND (? IS NULL OR r.cluster_id=?)`,[clusterId,clusterId]);
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
         delivery_modes:['STANDARD_CLUSTERED'],delivery_fee_pkr:null,delivery_quote_required:true,
         delivery_fee_source:'SUPPLIER_CLUSTER_RATE_AT_HOLD'};
     });
   }
   const matches=p=>(!categoryId||Number(p.category_id)===categoryId)&&
     (!familyId||Number(p.family_id)===familyId)&&
     (!search||[p.product_title,p.supplier_name,p.code].some(v=>String(v||'').toLowerCase().includes(search)));
   const all=[...regular.filter(matches),...flashes.filter(matches)];
   all.sort((a,b)=>new Date(a.pool_close_at).getTime()-new Date(b.pool_close_at).getTime());
   const [[clock]]=await db.query("SELECT DATE_FORMAT(UTC_TIMESTAMP(),'%Y-%m-%dT%H:%i:%sZ') AS server_time");
   const page=all.slice(offset,offset+limit);
   const hasMore=all.length>offset+limit;
   const nextCursor=hasMore?Buffer.from(JSON.stringify({
     offset:offset+limit,filters:filterSignature
   })).toString('base64url'):null;
   return {pools:page,server_time:clock.server_time,
     returned:page.length,has_more:hasMore,next_cursor:nextCursor,requested_type:type,
     note:'Discovery is an offer preview. Buyer delivery eligibility, unit price and checkout are validated by the original B4/B5 engines.'};
 }
}
module.exports=new UnifiedPoolDiscoveryService();
