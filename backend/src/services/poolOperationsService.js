'use strict';
// UCP-3 / UCP-5: supplier-scoped, read-only operational projections.
// The B4/B5 state machines, Safepay, stock allocation and DB transactions remain authoritative.
const db=require('../config/db');
const supplierDelivery=require('./supplierDeliveryService');
const overview=require('./unifiedSupplierPoolsService');
const allowedId=value=>Number.isSafeInteger(Number(value))&&Number(value)>0;
const bad=(message)=>Object.assign(new Error(message),{code:'INVALID_SUPPLIER',statusCode:400});
const nonnegative=(x)=>{const n=Number(x);return Number.isFinite(n)&&n>=0?n:null;};
const decimal=(x)=>x==null?null:String(x);
const nowEpoch=()=>Date.now();
class PoolOperationsService {
  assertSupplier(supplierId){if(!allowedId(supplierId))throw bad('Valid supplier required');return Number(supplierId);}
  async deliveryContext(supplierId){
    const id=this.assertSupplier(supplierId);
    const [settings,clusters]=await Promise.all([
      supplierDelivery.getSupplierSettings(id),
      db.query("SELECT id,name,district,region_code FROM geographic_clusters WHERE is_active=1 AND district='Lahore' ORDER BY name")
    ]);
    return {
      configuration:settings.configuration,
      cluster_rates:settings.cluster_rates.filter(r=>Number(r.supplier_id)===id),
      pickup_points:settings.pickup_points.filter(p=>Number(p.supplier_id)===id),
      clusters:clusters[0]
    };
  }
  async inventory(supplierId){
    const id=this.assertSupplier(supplierId);
    // Source of truth = supplier commercial listed stock MINUS active allocations.
    // Never add quantities across different purchasing units.
    const [rows]=await db.query(
      `SELECT sl.id AS supplier_listing_id,sl.listing_code,sl.supplier_sku_id,
              ps.title AS sku_title,sl.status AS listing_status,
              sl.pricing_unit,CAST(sl.available_stock AS CHAR) AS listed_stock,
              a.unit AS allocation_unit,
              CAST(COALESCE(a.pending_qty,0) AS CHAR) AS pending_qty,
              CAST(COALESCE(a.committed_qty,0) AS CHAR) AS committed_qty,
              a.unit_count
         FROM supplier_listings sl
         JOIN product_specifications ps ON ps.id=sl.product_spec_id
         LEFT JOIN (
           SELECT supplier_listing_id,
             MIN(unit) AS unit,COUNT(DISTINCT unit) AS unit_count,
             SUM(CASE WHEN status='PENDING' THEN allocated_qty ELSE 0 END) AS pending_qty,
             SUM(CASE WHEN status='COMMITTED' THEN allocated_qty ELSE 0 END) AS committed_qty
           FROM supplier_inventory_allocations
           WHERE status IN ('PENDING','COMMITTED')
           GROUP BY supplier_listing_id
         ) a ON a.supplier_listing_id=sl.id
         WHERE sl.supplier_id=?
         ORDER BY sl.id DESC LIMIT 500`,[id]);
    const items=rows.map(row=>{
      const mismatch=Number(row.unit_count||0)>1 ||
        (row.allocation_unit!=null && String(row.allocation_unit).toLowerCase()!==String(row.pricing_unit).toLowerCase());
      const listed=nonnegative(row.listed_stock),pending=nonnegative(row.pending_qty),committed=nonnegative(row.committed_qty);
      const remainder=listed!==null&&pending!==null&&committed!==null?listed-pending-committed:null;
      const invalid=mismatch||remainder===null||remainder<0;
      return {
        supplier_listing_id:row.supplier_listing_id,listing_code:row.listing_code,
        supplier_sku_id:row.supplier_sku_id,sku_title:row.sku_title,status:row.listing_status,
        unit:row.pricing_unit,listed_stock:decimal(row.listed_stock),
        pending_allocated:invalid?null:decimal(row.pending_qty),
        committed_allocated:invalid?null:decimal(row.committed_qty),
        available_to_allocate:invalid?null:remainder.toFixed(4),
        allocation_state:invalid?'RECONCILIATION_REQUIRED':'RECONCILED',
        note:invalid?'Allocation unit mismatch, negative stock or invalid numeric stock; publishing must fail closed.':null
      };
    });
    const [[clock]]=await db.query("SELECT DATE_FORMAT(UTC_TIMESTAMP(),'%Y-%m-%dT%H:%i:%sZ') AS server_time");
    return {listings:items,server_time:clock.server_time};
  }
  async insights(supplierId){
    const id=this.assertSupplier(supplierId);
    const {pools,counts,server_time}=await overview.list(id);
    const empty=()=>({total:0,draft:0,active:0,closed:0,cancelled:0,other:0});
    const types={REGULAR:empty(),FLASH:empty()};
    for(const p of pools){
      const t=types[p.type];if(!t)continue;
      t.total++;
      if(p.status==='DRAFT')t.draft++;
      else if(p.status==='ACTIVE')t.active++;
      else if(['CANCELLED'].includes(p.status))t.cancelled++;
      else if(['CLOSED','EXPIRED','SOLD_OUT','COMPLETED','CONFIRMED','TARGET_REACHED'].includes(p.status))t.closed++;
      else t.other++;
    }
    // Verified event counts only. No guessed sales/revenue/savings from listed offer prices.
    const [orderCounts]=await db.query(
      `SELECT
        COUNT(DISTINCT o.id) AS order_count,
        COUNT(DISTINCT CASE WHEN o.payment_status='PAID' THEN o.id END) AS paid_order_count,
        COUNT(DISTINCT CASE WHEN o.payment_status='AWAITING_PAYMENT' THEN o.id END) AS awaiting_payment_count
       FROM orders o
       LEFT JOIN flash_purchase_holds fh ON fh.order_id=o.id
       WHERE o.supplier_id=? AND (o.pool_id IS NOT NULL OR fh.id IS NOT NULL)`,[id]);
    return {
      scope:'B4_REGULAR_AND_B5_FLASH_ONLY',server_time,
      counts,by_type:types,
      orders:{total:Number(orderCounts[0].order_count||0),
        paid:Number(orderCounts[0].paid_order_count||0),
        awaiting_payment:Number(orderCounts[0].awaiting_payment_count||0)},
      revenue_pkr:null,net_payout_pkr:null,savings_pkr:null,
      unavailable_reason:'Revenue, payout and savings require reconciled settlement and verified comparison baselines; they are not inferred from prices.'
    };
  }
  async alerts(supplierId){
    const id=this.assertSupplier(supplierId);
    const [{pools},stock,dbRows]=await Promise.all([
      overview.list(id),
      this.inventory(id),
      db.query(`SELECT o.id AS order_id,o.pool_id,fh.flash_pool_id,o.payment_status
          FROM orders o LEFT JOIN flash_purchase_holds fh ON fh.order_id=o.id
          WHERE o.supplier_id=? AND o.payment_status='AWAITING_PAYMENT'
            AND (o.pool_id IS NOT NULL OR fh.id IS NOT NULL)
          ORDER BY o.id DESC LIMIT 100`,[id])
    ]);
    const notifications=[];
    const add=(type,entity,key,message,severity='info')=>notifications.push({
      id:type+':'+entity+':'+key,type,entity,key,message,severity,source:'AUTHORITATIVE_DATABASE_STATUS'
    });
    const now=nowEpoch(),soon=24*60*60*1000;
    for(const p of pools){
      const entity=p.type+':'+p.id;
      if(p.status==='DRAFT')add('DRAFT_AWAITING_PUBLISH',entity,p.status,
        p.type+' Pool '+p.code+' is a draft and is not buyer-visible.');
      const remaining=p.expires_at?new Date(p.expires_at).getTime()-now:null;
      if(p.status==='ACTIVE'&&Number.isFinite(remaining)&&remaining>=0&&remaining<=soon)
        add(p.type==='FLASH'?'FLASH_EXPIRING_SOON':'REGULAR_CLOSING_SOON',entity,p.status,
          p.type+' Pool '+p.code+' closes within 24 hours.','warning');
    }
    for(const listing of stock.listings){
      if(listing.allocation_state!=='RECONCILED')add('STOCK_RECONCILIATION_REQUIRED',
        'LISTING:'+listing.supplier_listing_id,listing.allocation_state,
        listing.listing_code+' has incompatible inventory allocations.','warning');
      else if(listing.status==='ACTIVE'&&Number(listing.listed_stock)>0 &&
        Number(listing.available_to_allocate)<=Number(listing.listed_stock)*0.1)
        add('LOW_UNALLOCATED_STOCK','LISTING:'+listing.supplier_listing_id,'LOW',
          listing.listing_code+' has 10% or less unallocated stock.','warning');
    }
    for(const o of dbRows[0])add('PAYMENT_AWAITING_PROVIDER',
      o.flash_pool_id?'FLASH:'+o.flash_pool_id:'REGULAR:'+o.pool_id,String(o.order_id),
      'Order #'+o.order_id+' is awaiting authoritative payment confirmation.');
    const seen=new Set();
    const alerts=notifications.filter(x=>{if(seen.has(x.id))return false;seen.add(x.id);return true});
    return {alerts,generated_at:new Date().toISOString(),delivery_channel:'IN_APP_READ_ONLY'};
  }
}
module.exports=new PoolOperationsService();
