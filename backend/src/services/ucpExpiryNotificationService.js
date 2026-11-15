'use strict';
// Transactional, ownership-derived Flash expiry inbox receipts.
// No email provider assertion or contact data in payload.
async function recordFlashExpiryOnConnection(conn, flashId) {
  if (!conn || typeof conn.query !== 'function') throw new Error('TRANSACTION_REQUIRED');
  const id = Number(flashId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('INVALID_FLASH_ID');
  const [offers] = await conn.query('SELECT supplier_id FROM flash_pools WHERE id=?',[id]);
  if (!offers.length) throw new Error('FLASH_EXPIRY_OWNER_MISSING');
  const [buyers] = await conn.query(
    "SELECT DISTINCT buyer_id FROM flash_purchase_holds WHERE flash_pool_id=? AND status IN ('HELD','PAYMENT_PENDING','PAID')",[id]);
  const recipients = new Map([[Number(offers[0].supplier_id),'SUPPLIER']]);
  for (const item of buyers) {
    const buyerId=Number(item.buyer_id);
    if (!Number.isSafeInteger(buyerId)||buyerId<=0) throw new Error('FLASH_EXPIRY_BUYER_INVALID');
    if (recipients.has(buyerId) && recipients.get(buyerId)!=='BUYER')
      throw new Error('NOTIFICATION_ROLE_CONFLICT');
    recipients.set(buyerId,'BUYER');
  }
  let inserted=0;
  for (const [userId,role] of recipients) {
    const [users]=await conn.query('SELECT id,role FROM users WHERE id=?',[userId]);
    if (!users.length||users[0].role!==role) throw new Error('FLASH_NOTIFICATION_RECIPIENT_INVALID');
    const key=`UCP.POOL_EXPIRED:flash:${id}`;
    const [write]=await conn.query(
      `INSERT INTO platform_notifications
       (user_id,role,event_type,event_key,title,message,payload,is_read,created_at)
       VALUES (?,?,'UCP.POOL_EXPIRED',?,'Flash pool ended','Review the final pool status in MilJor.',?,0,NOW())
       ON DUPLICATE KEY UPDATE id=id`,
      [userId,role,key,JSON.stringify({pool_id:id,mode:'FLASH',notification_path:'/pools'})]);
    if(write.affectedRows===1)inserted++;
  }
  return {inserted,recipients:recipients.size};
}
module.exports={recordFlashExpiryOnConnection};
