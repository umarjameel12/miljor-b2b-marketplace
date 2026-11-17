'use strict';
// Revalidate at projection AND immediately before provider dispatch. A reminder
// queued while active must not become a new alert after pause/skip/cutoff.
async function isCurrent(database,{buyerId,contractId,cycleId}){
 if([buyerId,contractId,cycleId].some(value=>!/^[1-9]\d*$/.test(String(value))||!Number.isSafeInteger(Number(value))))return false;
 const [rows]=await database.query(`SELECT cy.id FROM procurement_recurring_contracts c
  JOIN procurement_recurring_cycles cy ON cy.contract_id=c.id AND cy.buyer_id=c.buyer_id
  JOIN users u ON u.id=c.buyer_id AND u.role='BUYER' AND u.is_verified=1
   AND u.verification_status IN ('VERIFIED','EMAIL_VERIFIED') AND u.buyer_trust_status<>'SUSPENDED'
  WHERE c.id=? AND c.buyer_id=? AND cy.id=? AND c.status='ACTIVE' AND cy.status='SCHEDULED'
   AND cy.contract_version=c.version_number AND cy.due_at_utc>UTC_TIMESTAMP()
   AND cy.due_at_utc<=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 24 HOUR) FOR SHARE`,[Number(contractId),Number(buyerId),Number(cycleId)]);
 return rows.length===1;
}
module.exports={isCurrent};
