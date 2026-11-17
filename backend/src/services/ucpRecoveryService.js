'use strict';
// Coordinates the existing Flash inventory/state engine; never edits money or
// stock directly. Connection-scoped MySQL lease is released on worker crash.
async function runFlashRecoveryBatch({database,flashService,limit=50}={}){
  if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('INVALID_RECOVERY_LIMIT');
  const db=database||require('../config/db');
  const flash=flashService||require('./flashPoolService');
  const conn=await db.getConnection();
  let acquired=false,lease;
  const totals={processed:0,failed:0,skipped:false};
  try{
    const [[target]]=await conn.query('SELECT DATABASE() AS name');
    lease='ucp_flash_recovery:'+target.name;
    const [[lock]]=await conn.query('SELECT GET_LOCK(?,0) AS acquired',[lease]);
    if(lock.acquired!==1)return {...totals,skipped:true};
    acquired=true;
    const [cursors]=await conn.query("SELECT last_flash_id FROM ucp_recovery_cursors WHERE worker_name='flash_expiry'");
    const cursor=Number(cursors[0]?.last_flash_id)||0;
    const [offers]=await conn.query(
      `SELECT fp.id,fp.supplier_id,(fp.expiry_time<=UTC_TIMESTAMP()) AS expired
       FROM flash_pools fp WHERE fp.status IN ('ACTIVE','SOLD_OUT') AND
       (fp.expiry_time<=UTC_TIMESTAMP() OR EXISTS (
         SELECT 1 FROM flash_purchase_holds h WHERE h.flash_pool_id=fp.id
         AND h.status IN ('HELD','PAYMENT_PENDING') AND h.expires_at<=UTC_TIMESTAMP()))
       ORDER BY (fp.id<=?) ASC,fp.id ASC LIMIT ?`,[cursor,limit]);
    for(const offer of offers){
      try{
        if(Number(offer.expired)===1)await flash.expireOfferForRecovery(offer.id);
        else await flash.reclaimExpiredUninitiatedHolds(offer.id);
        totals.processed++;
      }catch(error){
        totals.failed++;
        // No request body, email, payment token or provider error in worker logs.
        console.error('[UCP recovery] Flash transition requires review',{flashId:offer.id,code:'RECOVERY_TRANSITION_FAILED'});
      }
    }
    if(offers.length)await conn.query(
      `INSERT INTO ucp_recovery_cursors(worker_name,last_flash_id) VALUES ('flash_expiry',?)
       ON DUPLICATE KEY UPDATE last_flash_id=VALUES(last_flash_id)`,[offers[offers.length-1].id]);
    return totals;
  }finally{
    try{if(acquired)await conn.query('SELECT RELEASE_LOCK(?)',[lease]);}
    finally{conn.release();}
  }
}
module.exports={runFlashRecoveryBatch};
