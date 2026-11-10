'use strict';

// B6-D: Eligible supplier matching and private invitations.
// This stage never creates a quote, reserves stock, takes payment or discloses
// buyer addresses/contact details. Eligibility must be revalidated at quote/award.
const db = require('../config/db');
const decimal = require('./exactDecimal');

const error = (code, message, statusCode=400) =>
  Object.assign(new Error(message), {code,statusCode});
function identifier(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0 || value == null ||
      typeof value === 'boolean' || (typeof value === 'string' && !/^\d+$/.test(value))) {
    throw error('INVALID_ID','A positive numeric ID is required.');
  }
  return id;
}
function parseZones(raw) {
  try {
    const values = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(values) ? values.filter(z=>typeof z==='string').map(z=>z.toLowerCase().trim()) : [];
  } catch {return [];}
}
function matchingArea(zones, area) {
  if (!area || typeof area !== 'string') return false;
  const normalized = area.toLowerCase().replace(/[,]+/g,' ').replace(/\s+/g,' ').trim();
  // Area matching is conservative. A supplier must explicitly cover the area,
  // or indicate all Lahore. No fuzzy proximity or invented route distances.
  return zones.some(z =>
    ((z === 'all lahore' || z === 'lahore wide') && /\blahore\b/.test(normalized)) ||
    normalized === z || normalized.startsWith(z+' ')
  );
}
function compatibleLine(item, row) {
  if (Number(item.family_id)!==Number(row.family_id)) return false;
  if (String(item.unit).toLowerCase()!==String(row.purchasing_unit).toLowerCase()) return false;
  try {
    return decimal.exactDecimalGte(String(row.available_stock),String(item.quantity),4);
  } catch {return false;}
}
const selectListings = `
  SELECT sl.id AS listing_id, sl.supplier_id, sl.available_stock, sl.delivery_zones,
         sk.id AS supplier_sku_id, sk.family_id, sk.purchasing_unit,
         sp.title AS product_title, sk.pack_size, sk.pack_unit,
         u.business_name AS supplier_name
  FROM supplier_listings sl
  JOIN supplier_skus sk ON sk.id=sl.supplier_sku_id
    AND sk.supplier_id=sl.supplier_id AND sk.status='PUBLISHED'
  JOIN supplier_products sp ON sp.id=sk.supplier_product_id
    AND sp.supplier_id=sl.supplier_id AND sp.status='PUBLISHED'
  JOIN product_specifications ps ON ps.id=sl.product_spec_id
    AND ps.supplier_id=sl.supplier_id AND ps.supplier_sku_id=sk.id
    AND ps.is_active=1 AND ps.approval_status='APPROVED' AND ps.lifecycle_status='PUBLISHED'
  JOIN catalog_product_families f ON f.id=sk.family_id
    AND f.is_active=1 AND f.approval_status='APPROVED'
  JOIN catalog_categories c ON c.id=f.category_id
    AND c.is_active=1 AND c.approval_status='APPROVED'
  JOIN users u ON u.id=sl.supplier_id
    AND u.role='SUPPLIER' AND u.is_verified=1 AND u.verification_status='VERIFIED'
  JOIN supplier_profiles profile ON profile.supplier_id=u.id
    AND profile.verification_status='VERIFIED'
  WHERE sl.status='ACTIVE' AND sl.available_stock>0
    AND sl.currency='PKR' AND sk.family_id IN
`;
class ProcurementMatchingService {
  constructor(database=db){this.database=database;}

  async _owned(conn,buyerId,requestId,lock=false) {
    const [rows]=await conn.query(
      `SELECT id,buyer_id,request_code,status,delivery_area,quote_deadline,award_policy
       FROM procurement_requests WHERE id=? AND buyer_id=?${lock?' FOR UPDATE':''}`,
      [identifier(requestId),identifier(buyerId)]
    );
    if(!rows.length)throw error('REQUEST_NOT_FOUND','Request not found.',404);
    const request=rows[0];
    const [items]=await conn.query(
      'SELECT id,line_number,family_id,quantity,unit,requirements,allow_substitutions FROM procurement_request_items WHERE request_id=? ORDER BY line_number',
      [request.id]
    );
    return {...request,items};
  }
  async _active(conn,request) {
    if(request.status!=='OPEN')throw error('REQUEST_NOT_OPEN','Request is not accepting suppliers.',409);
    const [[clock]]=await conn.query(
      'SELECT (quote_deadline > UTC_TIMESTAMP()) AS active FROM procurement_requests WHERE id=?',[request.id]
    );
    if(!clock || Number(clock.active)!==1)throw error('REQUEST_EXPIRED','Quotation deadline has passed.',409);
  }
  async _candidates(conn,request) {
    if(!request.items.length)return [];
    const families=[...new Set(request.items.map(i=>Number(i.family_id)))];
    const [rows]=await conn.query(
      selectListings+' ('+families.map(()=>'?').join(',')+') ORDER BY sl.supplier_id,sl.id LIMIT 500',
      families
    );
    const grouped=new Map();
    for(const row of rows){
      if(!matchingArea(parseZones(row.delivery_zones),request.delivery_area))continue;
      const lines=request.items.filter(item=>compatibleLine(item,row));
      if(!lines.length)continue;
      let item=grouped.get(Number(row.supplier_id));
      if(!item){
        item={supplier_id:Number(row.supplier_id),supplier_name:row.supplier_name,
          eligible_lines:new Set(),eligible_listing_ids:new Set(),eligible_offers:[]};
        grouped.set(item.supplier_id,item);
      }
      lines.forEach(line=>{
        item.eligible_lines.add(Number(line.id));
        item.eligible_offers.push({
          request_item_id:Number(line.id),supplier_listing_id:Number(row.listing_id),
          supplier_sku_id:Number(row.supplier_sku_id),
          product_title:row.product_title,purchasing_unit:row.purchasing_unit,
          pack_size:String(row.pack_size),pack_unit:row.pack_unit
        });
      });
      item.eligible_listing_ids.add(Number(row.listing_id));
    }
    return [...grouped.values()].map(item=>({
      supplier_id:item.supplier_id,supplier_name:item.supplier_name,
      eligible_line_ids:[...item.eligible_lines].sort((a,b)=>a-b),
      eligible_listing_ids:[...item.eligible_listing_ids].sort((a,b)=>a-b),
      eligible_offers:item.eligible_offers,
      covered_item_count:item.eligible_lines.size,
      total_item_count:request.items.length
    })).sort((a,b)=>b.covered_item_count-a.covered_item_count ||
      a.supplier_id-b.supplier_id);
  }
  async findForBuyer(buyerId,requestId){
    const request=await this._owned(this.database,buyerId,requestId);
    await this._active(this.database,request);
    return this._candidates(this.database,request);
  }
  async invite(buyerId,requestId,supplierId) {
    const conn=await this.database.getConnection();
    try{
      await conn.beginTransaction();
      const request=await this._owned(conn,buyerId,requestId,true);
      await this._active(conn,request);
      const supplier=identifier(supplierId);
      const eligible=(await this._candidates(conn,request)).find(x=>x.supplier_id===supplier);
      if(!eligible)throw error('SUPPLIER_NOT_ELIGIBLE','Supplier does not meet this request’s item and service-area requirements.',409);
      // Unique (request,supplier) enforces exactly one invitation under retries.
      await conn.query(
        `INSERT INTO procurement_supplier_invitations
         (request_id,supplier_id,status,eligible_line_ids)
         VALUES (?,?,'INVITED',?)
         ON DUPLICATE KEY UPDATE id=id`,
        [request.id,supplier,JSON.stringify(eligible.eligible_line_ids)]
      );
      const [rows]=await conn.query(
        'SELECT id,request_id,supplier_id,status,eligible_line_ids,invited_at,responded_at FROM procurement_supplier_invitations WHERE request_id=? AND supplier_id=?',
        [request.id,supplier]
      );
      await conn.commit();
      return rows[0];
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }
  async listInvitationsForBuyer(buyerId,requestId){
    const request=await this._owned(this.database,buyerId,requestId);
    const [rows]=await this.database.query(
      `SELECT i.id,i.supplier_id,u.business_name AS supplier_name,i.status,
              i.eligible_line_ids,i.invited_at,i.responded_at
       FROM procurement_supplier_invitations i
       JOIN users u ON u.id=i.supplier_id
       WHERE i.request_id=? ORDER BY i.invited_at DESC`,[request.id]
    );
    return rows;
  }
  async inbox(supplierId) {
    const id=identifier(supplierId);
    const [rows]=await this.database.query(
      `SELECT i.id AS invitation_id,i.request_id,i.status,i.eligible_line_ids,
              i.invited_at,i.responded_at,r.request_code,r.quote_deadline
       FROM procurement_supplier_invitations i
       JOIN procurement_requests r ON r.id=i.request_id
       WHERE i.supplier_id=? AND r.status='OPEN' AND r.quote_deadline>UTC_TIMESTAMP()
         AND i.status IN ('INVITED','INTERESTED','DECLINED')
       ORDER BY i.invited_at DESC LIMIT 100`,[id]
    );
    for(const row of rows){
      const [items]=await this.database.query(
        `SELECT id,line_number,family_id,quantity,unit,requirements,allow_substitutions
         FROM procurement_request_items WHERE request_id=? ORDER BY line_number`,[row.request_id]
      );
      const [requestRows]=await this.database.query(
        'SELECT id,delivery_area FROM procurement_requests WHERE id=?',[row.request_id]
      );
      if(requestRows.length){
        const potential=await this._candidates(this.database,{...requestRows[0],items});
        row.eligible_offers=potential.find(match=>match.supplier_id===id)?.eligible_offers||[];
      }else{
        row.eligible_offers=[];
      }
      row.items=items.map(item => ({
        ...item,
        // Request text is user-controlled. Never relay phone, email or
        // WhatsApp contact details to suppliers via invitation previews.
        requirements: typeof item.requirements === 'string'
          ? item.requirements
              .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[contact hidden]')
              .replace(/(?:\+?92|0)\s*3\d{2}[\s().-]*\d{3}[\s().-]*\d{4}/g,'[contact hidden]')
          : null
      }));
      // Never expose buyer_id, delivery address, account or contact.
    }
    return rows;
  }
  async respond(supplierId,invitationId,decision){
    const id=identifier(supplierId),iid=identifier(invitationId);
    if(!['INTERESTED','DECLINED'].includes(decision))
      throw error('INVALID_SUPPLIER_RESPONSE','Choose INTERESTED or DECLINED.');
    const conn=await this.database.getConnection();
    try{
      await conn.beginTransaction();
      const [lookup]=await conn.query(
        'SELECT request_id FROM procurement_supplier_invitations WHERE id=? AND supplier_id=?',[iid,id]
      );
      if(!lookup.length)throw error('INVITATION_NOT_FOUND','Invitation not found.',404);
      const [requests]=await conn.query(
        'SELECT id,status FROM procurement_requests WHERE id=? FOR UPDATE',[lookup[0].request_id]
      );
      if(!requests.length||requests[0].status!=='OPEN')
        throw error('REQUEST_NOT_OPEN','Request has closed.',409);
      const [[clock]]=await conn.query(
        'SELECT (quote_deadline>UTC_TIMESTAMP()) AS active FROM procurement_requests WHERE id=?',
        [lookup[0].request_id]
      );
      if(Number(clock?.active)!==1)throw error('REQUEST_EXPIRED','Request deadline has passed.',409);
      const [invites]=await conn.query(
        'SELECT id,supplier_id,status FROM procurement_supplier_invitations WHERE id=? AND supplier_id=? FOR UPDATE',[iid,id]
      );
      const invite=invites[0];
      if(!invite)throw error('INVITATION_NOT_FOUND','Invitation not found.',404);
      if(invite.status===decision){await conn.commit();return {...invite,is_replay:true};}
      if(invite.status!=='INVITED')
        throw error('INVITATION_ALREADY_ANSWERED','Invitation response is already final.',409);
      const [verified]=await conn.query(
        `SELECT u.id FROM users u JOIN supplier_profiles sp ON sp.supplier_id=u.id
         WHERE u.id=? AND u.role='SUPPLIER' AND u.is_verified=1
           AND u.verification_status='VERIFIED' AND sp.verification_status='VERIFIED'`,[id]
      );
      if(!verified.length)throw error('SUPPLIER_NOT_VERIFIED','A verified supplier is required.',403);
      // Interest is informational, but the supplier must still have at least
      // one qualifying active listing today; stale invitations cannot be used
      // to imply an eligible offer.
      if(decision==='INTERESTED'){
        const [requestRows]=await conn.query(
          `SELECT id,buyer_id,request_code,status,delivery_area,quote_deadline
           FROM procurement_requests WHERE id=?`,[lookup[0].request_id]
        );
        const [requestItems]=await conn.query(
          'SELECT id,line_number,family_id,quantity,unit,requirements,allow_substitutions FROM procurement_request_items WHERE request_id=? ORDER BY line_number',
          [lookup[0].request_id]
        );
        if(!requestRows.length || !(await this._candidates(conn,{...requestRows[0],items:requestItems}))
            .some(candidate=>candidate.supplier_id===id)) {
          throw error('SUPPLIER_NOT_ELIGIBLE','Supplier no longer has a qualifying offer for this request.',409);
        }
      }
      await conn.query(
        'UPDATE procurement_supplier_invitations SET status=?,responded_at=UTC_TIMESTAMP() WHERE id=?',
        [decision,iid]
      );
      await conn.commit();
      return {id:iid,status:decision,is_replay:false};
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }
}
module.exports=new ProcurementMatchingService();
module.exports.ProcurementMatchingService=ProcurementMatchingService;
