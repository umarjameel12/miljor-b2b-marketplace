'use strict';
const db=require('../config/db');
const fulfillment=require('./fulfillmentService');
class SupplierOperationsService{
  constructor(database=db,guard=fulfillment){this.database=database;this.guard=guard;}
  async get(actor){
    if(!actor||actor.role!=='SUPPLIER')throw Object.assign(Error('Supplier access required'),{code:'UNAUTHORIZED_ROLE',statusCode:403});
    if(!/^[1-9]\d*$/.test(String(actor.id))||!Number.isSafeInteger(Number(actor.id)))throw Object.assign(Error('Invalid supplier identifier'),{code:'INVALID_SUPPLIER_ID',statusCode:400});
    const supplier=Number(actor.id),connection=await this.database.getConnection();
    try{
      await this.guard._assertVerifiedSupplier({...actor,id:supplier},connection);
      const [[row]]=await connection.query(
        `SELECT UTC_TIMESTAMP() AS generated_at,
        (SELECT COUNT(*) FROM procurement_supplier_invitations i JOIN procurement_requests r ON r.id=i.request_id
          WHERE i.supplier_id=? AND i.status='INVITED' AND r.status='OPEN' AND r.quote_deadline>UTC_TIMESTAMP()) AS rfq_invitations,
        (SELECT COUNT(*) FROM procurement_collective_supplier_invitations i JOIN procurement_collective_groups g ON g.id=i.group_id
          JOIN procurement_requests r ON r.id=g.request_id WHERE i.supplier_id=? AND i.status='INVITED' AND g.status='QUOTING' AND r.status='OPEN' AND r.quote_deadline>UTC_TIMESTAMP()) AS collective_requests,
        (SELECT COUNT(*) FROM procurement_product_counteroffers c JOIN procurement_quotes q ON q.id=c.quote_id
          JOIN procurement_quote_versions v ON v.quote_id=q.id AND v.version_number=q.current_version
          JOIN procurement_requests r ON r.id=q.request_id WHERE c.supplier_id=? AND q.supplier_id=c.supplier_id
          AND c.decision='OPEN' AND q.status='ACTIVE' AND c.quote_version=q.current_version AND r.status='OPEN'
          AND r.quote_deadline>UTC_TIMESTAMP() AND v.valid_until>UTC_TIMESTAMP()) AS numeric_decisions,
        (SELECT COUNT(*) FROM delivery_quotes d JOIN procurement_quotes q ON q.id=d.procurement_quote_id
          JOIN procurement_requests r ON r.id=q.request_id JOIN procurement_quote_versions v ON v.quote_id=q.id AND v.version_number=q.current_version
          WHERE d.supplier_id=? AND q.supplier_id=d.supplier_id AND d.status='PENDING' AND d.expires_at>UTC_TIMESTAMP()
          AND q.status='ACTIVE' AND r.status='OPEN' AND r.quote_deadline>UTC_TIMESTAMP() AND v.valid_until>UTC_TIMESTAMP()
          AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(v.immutable_snapshot,'$.delivery_terms.quote_code')),'')<>d.quote_code) AS delivery_choices,
        (SELECT COUNT(*) FROM procurement_quotes q JOIN procurement_quote_versions v ON v.quote_id=q.id AND v.version_number=q.current_version
          JOIN procurement_requests r ON r.id=q.request_id WHERE q.supplier_id=? AND q.status='ACTIVE' AND r.status='OPEN'
          AND r.quote_deadline>UTC_TIMESTAMP() AND v.valid_until>UTC_TIMESTAMP() AND v.valid_until<=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 24 HOUR)) AS expiring_quotes,
        (SELECT COUNT(*) FROM orders WHERE supplier_id=? AND payment_status='PAID'
          AND fulfillment_status IN ('AWAITING_SUPPLIER_ACKNOWLEDGEMENT','PREPARING','READY_FOR_DISPATCH','DISPATCHED')) AS paid_to_fulfill,
        (SELECT COUNT(*) FROM orders WHERE supplier_id=? AND payment_status='PAID' AND fulfillment_status='SUPPLIER_DELIVERED') AS awaiting_buyer_receipt,
        (SELECT COUNT(*) FROM orders WHERE supplier_id=? AND payment_status='PAID' AND fulfillment_status='EXCEPTION') AS fulfillment_exceptions,
        (SELECT COUNT(*) FROM platform_notifications WHERE user_id=? AND is_read=0) AS unread_notifications`,
        Array(9).fill(supplier));
      const counts={};
      for(const field of ['rfq_invitations','collective_requests','numeric_decisions','delivery_choices','expiring_quotes','paid_to_fulfill','awaiting_buyer_receipt','fulfillment_exceptions','unread_notifications']){
        const count=Number(row[field]);
        if(!Number.isSafeInteger(count)||count<0)throw Object.assign(Error('Invalid operations count'),{code:'OPERATIONS_DATA_INVALID',statusCode:503});
        counts[field]=count;
      }
      return {counts,generated_at:row.generated_at,financial_execution_enabled:false};
    }finally{connection.release();}
  }
}
module.exports=new SupplierOperationsService();
module.exports.SupplierOperationsService=SupplierOperationsService;
