'use strict';
const db = require('../config/db');

// Read-only supplier-owned grouped delivery progress. No fabricated status or payout.
class SupplierDeliveryRunsService {
  constructor(database=db){this.db=database;}
  async list(supplierId,{limit=30}={}){
    const id=Number(supplierId);
    if(!Number.isSafeInteger(id)||id<1) {
      const e=new Error('Supplier authentication required');e.statusCode=403;e.code='INVALID_SUPPLIER';throw e;
    }
    const safeLimit=Math.min(50,Math.max(1,Number(limit)||30));
    const [rows]=await this.db.query(
      `SELECT r.id,r.cluster_id,r.delivery_day,r.delivery_window,r.mode,r.handling_class,
              r.status,r.planned_stops,r.locked_delivery_fee_total,r.created_at,
              COUNT(s.id) AS actual_stops,
              SUM(CASE WHEN s.status='BUYER_CONFIRMED' THEN 1 ELSE 0 END) AS buyer_confirmed_stops,
              SUM(CASE WHEN s.status='EXCEPTION' THEN 1 ELSE 0 END) AS exception_stops
       FROM procurement_delivery_runs r
       LEFT JOIN procurement_delivery_stops s ON s.run_id=r.id
       WHERE r.supplier_id=?
       GROUP BY r.id,r.cluster_id,r.delivery_day,r.delivery_window,r.mode,r.handling_class,
                r.status,r.planned_stops,r.locked_delivery_fee_total,r.created_at
       ORDER BY r.delivery_day DESC,r.id DESC LIMIT ?`,
      [id,safeLimit]
    );
    return rows.map(row=>({
      id:row.id,cluster_id:row.cluster_id,delivery_day:row.delivery_day,
      delivery_window:row.delivery_window,mode:row.mode,handling_class:row.handling_class,
      status:row.status,planned_stops:Number(row.planned_stops||0),
      actual_stops:Number(row.actual_stops||0),
      buyer_confirmed_stops:Number(row.buyer_confirmed_stops||0),
      exception_stops:Number(row.exception_stops||0),
      locked_delivery_fee_total:String(row.locked_delivery_fee_total||'0.00'),
      created_at:row.created_at
    }));
  }
}
module.exports=new SupplierDeliveryRunsService();
module.exports.SupplierDeliveryRunsService=SupplierDeliveryRunsService;
