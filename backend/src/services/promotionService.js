// MilJor E6: Promotion requests are never self-activated without verified billing.
const db = require('../config/db');
const { randomUUID } = require('crypto');
function fail(code,message,statusCode=400) {
  const e=new Error(message);e.code=code;e.statusCode=statusCode;throw e;
}
class PromotionService {
  async createCampaign(supplierId,payload={}) {
    const id=Number(supplierId);
    if(!Number.isSafeInteger(id)||id<=0)fail('INVALID_SUPPLIER','Valid supplier required');
    const {campaign_type,listing_id,pool_id,daily_budget_pkr,start_date,end_date}=payload;
    if(!['SPONSORED_LISTING','FEATURED_POOL'].includes(campaign_type))
      fail('INVALID_CAMPAIGN_TYPE','Choose sponsored listing or featured pool');
    const listing=campaign_type==='SPONSORED_LISTING'?Number(listing_id):null;
    const pool=campaign_type==='FEATURED_POOL'?Number(pool_id):null;
    if((listing!==null && (!Number.isSafeInteger(listing)||listing<1))||
       (pool!==null && (!Number.isSafeInteger(pool)||pool<1))||
       (campaign_type==='SPONSORED_LISTING' && pool_id)||
       (campaign_type==='FEATURED_POOL' && listing_id))
      fail('INVALID_CAMPAIGN_TARGET','Exactly one correctly typed target required');
    const budget=String(daily_budget_pkr??'');
    if(!/^\d{1,10}(?:\.\d{1,2})?$/.test(budget)||Number(budget)<=0)
      fail('INVALID_CAMPAIGN_BUDGET','Positive daily budget with at most two decimals required');
    const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&
      !Number.isNaN(Date.parse(v+'T00:00:00Z'))&&
      new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
    if(!validDate(start_date)||!validDate(end_date)||start_date>end_date)
      fail('INVALID_CAMPAIGN_DATES','Valid start and end dates required');
    const [supplier]=await db.query(
      `SELECT u.id FROM users u JOIN supplier_profiles sp ON sp.supplier_id=u.id
       WHERE u.id=? AND u.role='SUPPLIER' AND u.is_verified=1
         AND u.verification_status='VERIFIED' AND sp.verification_status='VERIFIED'`,[id]);
    if(!supplier.length)fail('SUPPLIER_NOT_VERIFIED','Only verified suppliers can request promotions',403);
    if(listing!==null) {
      const [rows]=await db.query('SELECT id FROM supplier_listings WHERE id=? AND supplier_id=? AND status=\'ACTIVE\'',[listing,id]);
      if(!rows.length)fail('CAMPAIGN_TARGET_FORBIDDEN','Must own an active listing',403);
    }else {
      const [rows]=await db.query('SELECT id FROM pools WHERE id=? AND supplier_id=? AND status=\'ACTIVE\'',[pool,id]);
      if(!rows.length)fail('CAMPAIGN_TARGET_FORBIDDEN','Must own an active pool',403);
    }
    // PENDING_REVIEW is deliberately non-public. A payment-backed activation workflow
    // must be introduced before any campaign can become ACTIVE.
    const [res]=await db.query(
      `INSERT INTO sponsored_campaigns
       (campaign_code,supplier_id,campaign_type,listing_id,pool_id,daily_budget_pkr,start_date,end_date,status)
       VALUES (?,?,?,?,?,?,?,?,'PENDING_REVIEW')`,
      ['CMP-'+randomUUID(),id,campaign_type,listing,pool,budget,start_date,end_date]);
    const [created]=await db.query('SELECT * FROM sponsored_campaigns WHERE id=?',[res.insertId]);
    return created[0];
  }
  async getActivePromotions(){
    // Fail closed: activation/billing verification has not been implemented.
    // Do not serve legacy ACTIVE campaigns without audited payment provenance.
    return [];
  }
}
module.exports=new PromotionService();
