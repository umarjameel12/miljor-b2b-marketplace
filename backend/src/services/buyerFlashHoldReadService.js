'use strict';
// UCP-4 buyer-owned read model for existing B5 Flash holds and payment recovery.
// No payment, inventory, escrow, or B6 procurement mutations.
const db=require('../config/db');
module.exports={
 async listFlashHolds(buyerId){
  if(!Number.isSafeInteger(Number(buyerId))||Number(buyerId)<=0)
    throw Object.assign(new Error('Authenticated buyer required'),{statusCode:403,code:'BUYER_REQUIRED'});
  const [rows]=await db.query(
    `SELECT h.id AS hold_id,h.flash_pool_id,h.order_id,h.quantity,h.status AS hold_status,
        DATE_FORMAT(h.expires_at,'%Y-%m-%dT%H:%i:%sZ') AS hold_expires_at,
        o.order_code,o.order_status,o.payment_status,o.total_amount,o.currency,
        fp.flash_code,ps.title AS product_title,ps.purchasing_unit,
        DATE_FORMAT(UTC_TIMESTAMP(),'%Y-%m-%dT%H:%i:%sZ') AS server_time
       FROM flash_purchase_holds h
       JOIN orders o ON o.id=h.order_id AND o.buyer_id=h.buyer_id
       JOIN flash_pools fp ON fp.id=h.flash_pool_id
       LEFT JOIN product_specifications ps ON ps.id=fp.product_spec_id
       WHERE h.buyer_id=? ORDER BY h.id DESC LIMIT 100`,[Number(buyerId)]
  );
  return {holds:rows.map(r=>({
    ...r,can_checkout:r.payment_status!=='PAID'&&r.hold_status==='HELD'&&
      Date.parse(r.hold_expires_at)>Date.parse(r.server_time),
    payment_pending:r.payment_status==='PAYMENT_INITIATED'||r.hold_status==='PAYMENT_PENDING',
    verified_paid:r.payment_status==='PAID'
  })),server_time:new Date().toISOString()};
 }
};
