'use strict';
// UCP-5 tenant-scoped metrics and in-app action signals, derived from authoritative rows.
// An action signal is NOT an email/SMS delivery nor a booked sale.
// B6 buyer collective/recurring/RFQ orders never contribute to these pool metrics.
const db=require('../config/db');
const overview=require('./unifiedSupplierPoolsService');
const id=x=>Number.isSafeInteger(Number(x))&&Number(x)>0;
class SupplierPoolAnalyticsService {
 async summary(supplierId){
  if(!id(supplierId))throw Object.assign(new Error('Supplier required'),{statusCode:403,code:'SUPPLIER_REQUIRED'});
  const sid=Number(supplierId);
  const [all,regPaid,flashPaid,regDemand,flashHolds]=await Promise.all([
    overview.list(sid),
    db.query(`SELECT COUNT(*) AS paid_order_count,
        COALESCE(SUM(subtotal_amount),0) AS paid_goods_pkr,
        COALESCE(SUM(total_amount),0) AS paid_buyer_total_pkr,
        COALESCE(SUM(total_qty),0) AS paid_quantity
       FROM orders WHERE supplier_id=? AND pool_id IS NOT NULL
         AND payment_status='PAID'`,[sid]),
    db.query(`SELECT COUNT(*) AS paid_order_count,
        COALESCE(SUM(o.subtotal_amount),0) AS paid_goods_pkr,
        COALESCE(SUM(o.total_amount),0) AS paid_buyer_total_pkr,
        COALESCE(SUM(h.quantity),0) AS paid_quantity
       FROM flash_purchase_holds h
       JOIN flash_pools fp ON fp.id=h.flash_pool_id
       JOIN orders o ON o.id=h.order_id
       WHERE fp.supplier_id=? AND o.supplier_id=? AND o.payment_status='PAID'
         AND h.status IN ('PAID','PAYMENT_PENDING','HELD')`,[sid,sid]),
    db.query(`SELECT COUNT(*) AS active_reservation_count,
        COALESCE(SUM(r.quantity),0) AS active_reserved_quantity
       FROM reservations r JOIN pools p ON p.id=r.pool_id
       WHERE p.supplier_id=? AND r.status IN ('RESERVED','CONFIRMED','PAID')`,[sid]),
    db.query(`SELECT
        SUM(CASE WHEN h.status IN ('HELD','PAYMENT_PENDING') THEN 1 ELSE 0 END) AS open_holds,
        SUM(CASE WHEN h.status='PAYMENT_PENDING' THEN 1 ELSE 0 END) AS provider_pending_holds
       FROM flash_purchase_holds h JOIN flash_pools fp ON fp.id=h.flash_pool_id
       WHERE fp.supplier_id=?`,[sid])
  ]);
  const regular=regPaid[0][0],flash=flashPaid[0][0];
  const snapshot=all.pools;
  const now=Date.parse(all.server_time);
  const alerts=[];
  const alertsSeen=new Set();
  const add=(pool,code,message,priority='INFO')=>{
    const key=pool.type+':'+pool.id+':'+code;
    if(alertsSeen.has(key))return;
    alertsSeen.add(key);
    alerts.push({key,pool_id:pool.id,pool_type:pool.type,pool_code:pool.code,
      code,priority,message,source:'AUTHORITATIVE_POOL_READ_MODEL'});
  };
  for(const p of snapshot){
    if(p.status==='DRAFT'){add(p,'DRAFT_READY','Draft requires supplier review and publication.');continue;}
    if(p.status!=='ACTIVE')continue;
    const left=Date.parse(p.expires_at)-now;
    if(Number.isFinite(left)&&left<=24*3600000&&left>0)
      add(p,'CLOSING_SOON','Offer participation closes within 24 hours.','ACTION');
    if(Number.isFinite(left)&&left<=0)
      add(p,'EXPIRY_RECONCILIATION','Offer deadline has passed; authoritative close/expiry processing may be required.','ACTION');
    if(p.type==='FLASH'&&Number(p.quantity_available)<=Number(p.min_quantity||1))
      add(p,'LOW_READY_STOCK','Remaining ready stock is near supplier buyer minimum.','ACTION');
    if(p.type==='REGULAR'&&Number(p.quantity_current)>=Number(p.quantity_target))
      add(p,'TARGET_REACHED','Regular demand target reached; follow existing supplier qualification workflow.','ACTION');
  }
  const counts={total:snapshot.length,regular:snapshot.filter(p=>p.type==='REGULAR').length,
    flash:snapshot.filter(p=>p.type==='FLASH').length,
    active:snapshot.filter(p=>p.status==='ACTIVE').length,
    draft:snapshot.filter(p=>p.status==='DRAFT').length,
    closed:snapshot.filter(p=>!['ACTIVE','DRAFT'].includes(p.status)).length};
  return {
   server_time:all.server_time,counts,
   regular:{paid_order_count:Number(regular.paid_order_count||0),
     paid_goods_pkr:String(regular.paid_goods_pkr),paid_buyer_total_pkr:String(regular.paid_buyer_total_pkr),
     paid_quantity:String(regular.paid_quantity),
     active_reservation_count:Number(regDemand[0][0].active_reservation_count||0),
     active_reserved_quantity:String(regDemand[0][0].active_reserved_quantity)},
   flash:{paid_order_count:Number(flash.paid_order_count||0),
     paid_goods_pkr:String(flash.paid_goods_pkr),paid_buyer_total_pkr:String(flash.paid_buyer_total_pkr),
     paid_quantity:String(flash.paid_quantity),
     open_holds:Number(flashHolds[0][0].open_holds||0),
     provider_pending_holds:Number(flashHolds[0][0].provider_pending_holds||0)},
   alerts,description:'Paid goods amounts are verified-order subtotals, not net supplier payouts. Alerts are derived in-app signals only; not sent SMS/email.'
  };
 }
}
module.exports=new SupplierPoolAnalyticsService();
