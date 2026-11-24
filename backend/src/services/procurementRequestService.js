'use strict';

// B6 buyer procurement request lifecycle. No offers, inventory or payment mutations.
const crypto = require('node:crypto');
const db = require('../config/db');
const { normalizeRequestDraft } = require('./procurementRequestPolicy');
const matching = require('./procurementMatchingService');
const notificationService = require('./notificationService');

const issue = (code, message, statusCode = 400) => {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
};
const positiveId = value => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || value === null ||
      value === undefined || typeof value === 'boolean') {
    throw issue('INVALID_REQUEST_ID', 'A valid request ID is required.');
  }
  return number;
};
const idempotency = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9:_-]{12,120}$/.test(value.trim())) {
    throw issue('INVALID_IDEMPOTENCY_KEY', 'Provide a 12–120 character X-Idempotency-Key.');
  }
  return value.trim();
};
const utcSql = value => value ? new Date(value).toISOString().slice(0, 19).replace('T', ' ') : null;
const normalizedHash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

class ProcurementRequestService {
  constructor(database = db) {
    this.database = database;
  }

  async _buyer(conn, buyerId) {
    const [rows] = await conn.query(
      'SELECT id,role,is_verified,verification_status,buyer_trust_status FROM users WHERE id=? FOR UPDATE',
      [buyerId]
    );
    if (!rows.length || rows[0].role !== 'BUYER' ||
        Number(rows[0].is_verified) !== 1 ||
        !['VERIFIED', 'EMAIL_VERIFIED'].includes(rows[0].verification_status) ||
        rows[0].buyer_trust_status === 'SUSPENDED') {
      throw issue('BUYER_NOT_ELIGIBLE', 'An active B2B buyer account is required.', 403);
    }
  }

  async _validateFamilies(conn, items) {
    const unique = [...new Set(items.map(i => i.family_id))].sort((a,b) => a-b);
    if (!unique.length) throw issue('INVALID_REQUEST_ITEMS','At least one item is required.');
    const placeholders = unique.map(() => '?').join(',');
    const [rows] = await conn.query(
      `SELECT f.id,f.allowed_pack_units,f.allowed_purchasing_units
         FROM catalog_product_families f
         JOIN catalog_categories c ON c.id=f.category_id
         WHERE f.id IN (${placeholders})
           AND f.is_active=1 AND f.approval_status='APPROVED'
           AND c.is_active=1 AND c.approval_status='APPROVED'`,
      unique
    );
    const found = new Map(rows.map(row => [Number(row.id), row]));
    if (unique.some(id => !found.has(id))) {
      throw issue('FAMILY_NOT_AVAILABLE', 'One or more product families are unavailable.', 409);
    }
    for (const item of items) {
      const family = found.get(item.family_id);
      // Catalog 033 stores physical/packaging options in two JSON columns.
      // Accept only units explicitly whitelisted by the canonical family.
      const allowed = [];
      for (const field of ['allowed_pack_units','allowed_purchasing_units']) {
        const raw = family[field];
        let values;
        try { values = typeof raw === 'string' ? JSON.parse(raw) : raw; }
        catch { throw issue('FAMILY_UNITS_INVALID','Product family units are not configured safely.',409); }
        if (!Array.isArray(values)) throw issue('FAMILY_UNITS_INVALID','Product family units are not configured safely.',409);
        allowed.push(...values.filter(value => typeof value === 'string')
          .map(value => value.trim().toLowerCase()));
      }
      if (!allowed.includes(item.unit)) {
        throw issue('INCOMPATIBLE_FAMILY_UNIT', 'The selected product family does not support the requested unit.', 409);
      }
    }
  }

  async _load(requestId, buyerId, conn=this.database, lock=false) {
    const [requests] = await conn.query(
      `SELECT * FROM procurement_requests WHERE id=? AND buyer_id=?${lock ? ' FOR UPDATE' : ''}`,
      [requestId,buyerId]
    );
    if (!requests.length) throw issue('REQUEST_NOT_FOUND','Procurement request not found.',404);
    const [items] = await conn.query(
      'SELECT id,line_number,family_id,quantity,unit,requirements,allow_substitutions FROM procurement_request_items WHERE request_id=? ORDER BY line_number',
      [requestId]
    );
    return {...requests[0],items};
  }

  async createDraft(buyerId, payload, key) {
    const buyer = positiveId(buyerId);
    const idem = idempotency(key);
    const draft = normalizeRequestDraft(payload);
    const hash = normalizedHash(draft);
    const conn = await this.database.getConnection();
    try {
      await conn.beginTransaction();
      await this._buyer(conn,buyer);
      // Physical unique index ensures retries cannot create two drafts, even after a crash.
      const [existing] = await conn.query(
        'SELECT id,request_hash,create_response_snapshot FROM procurement_requests WHERE buyer_id=? AND idempotency_key=? FOR UPDATE',
        [buyer,idem]
      );
      if (existing.length) {
        if (existing[0].request_hash !== hash) {
          throw issue('IDEMPOTENCY_CONFLICT','This key already belongs to another request.',409);
        }
        const raw = existing[0].create_response_snapshot;
        const saved = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw)
          : await this._load(existing[0].id,buyer,conn);
        await conn.commit();
        return {request:saved,is_replay:true};
      }
      await this._validateFamilies(conn,draft.items);
      const code = 'MJ-REQ-' + crypto.randomUUID();
      const [created] = await conn.query(
        `INSERT INTO procurement_requests
          (buyer_id,request_code,ownership,frequency,award_policy,priority,status,open_to_suppliers,
           delivery_area,notes,target_price_pkr,required_delivery_date,quote_deadline,join_deadline,
           idempotency_key,request_hash)
         VALUES (?,?,?,?,?,?,'DRAFT',?,?,?,?,?,?,?,?,?)`,
        [buyer,code,draft.ownership,draft.frequency,draft.award_policy,draft.priority,
          draft.open_to_suppliers ? 1 : 0, draft.delivery_area,draft.notes,
          draft.target_price_pkr,draft.required_delivery_date,
          utcSql(draft.quote_deadline),utcSql(draft.join_deadline),idem,hash]
      );
      for (let index=0;index<draft.items.length;index++) {
        const line=draft.items[index];
        await conn.query(
          `INSERT INTO procurement_request_items
           (request_id,line_number,family_id,quantity,unit,requirements,allow_substitutions)
           VALUES (?,?,?,?,?,?,?)`,
          [created.insertId,index+1,line.family_id,line.quantity,line.unit,line.requirements,line.allow_substitutions?1:0]
        );
      }
      const request = await this._load(created.insertId,buyer,conn);
      await conn.query(
        'UPDATE procurement_requests SET create_response_snapshot=? WHERE id=? AND buyer_id=?',
        [JSON.stringify(request),created.insertId,buyer]
      );
      await conn.commit();
      return {request,is_replay:false};
    } catch (e) {
      await conn.rollback();
      // Fail closed when concurrent first-use same key races. Caller may safely retry.
      if (e.code === 'ER_DUP_ENTRY') throw issue('IDEMPOTENCY_CONFLICT','Request already submitted. Fetch your requests before retrying.',409);
      throw e;
    } finally { conn.release(); }
  }

  async updateDraft(buyerId,requestId,payload,expectedVersion,key) {
    const buyer=positiveId(buyerId),id=positiveId(requestId);
    const version=Number(expectedVersion);
    if (!Number.isSafeInteger(version) || version<1) throw issue('VERSION_REQUIRED','Provide the current request version.');
    const draft=normalizeRequestDraft(payload);
    const idem=idempotency(key);
    const hash=normalizedHash({ operation:'UPDATE_DRAFT',id,version,draft });
    const conn=await this.database.getConnection();
    try {
      await conn.beginTransaction();
      await this._buyer(conn,buyer);
      const [previous]=await conn.query(
        'SELECT request_id,operation,request_hash,response_snapshot FROM procurement_request_mutations WHERE buyer_id=? AND idempotency_key=? FOR UPDATE',
        [buyer,idem]
      );
      if(previous.length){
        if(Number(previous[0].request_id)!==id || previous[0].operation!=='UPDATE_DRAFT' || previous[0].request_hash!==hash)
          throw issue('IDEMPOTENCY_CONFLICT','Idempotency key already belongs to another operation.',409);
        const saved=typeof previous[0].response_snapshot==='string'
          ? JSON.parse(previous[0].response_snapshot):previous[0].response_snapshot;
        await conn.commit();
        return saved;
      }
      const current=await this._load(id,buyer,conn,true);
      if (current.status!=='DRAFT') throw issue('REQUEST_IMMUTABLE','Only a draft may be edited.',409);
      if (Number(current.version_number)!==version) throw issue('REQUEST_VERSION_CONFLICT','Draft changed elsewhere. Refresh before editing.',409);
      await this._validateFamilies(conn,draft.items);
      await conn.query(
        `UPDATE procurement_requests SET ownership=?,frequency=?,award_policy=?,priority=?,
         open_to_suppliers=?,delivery_area=?,notes=?,target_price_pkr=?,required_delivery_date=?,
         quote_deadline=?,join_deadline=?,version_number=version_number+1
         WHERE id=? AND status='DRAFT'`,
        [draft.ownership,draft.frequency,draft.award_policy,draft.priority,
         draft.open_to_suppliers ? 1 : 0, draft.delivery_area,draft.notes,
         draft.target_price_pkr,draft.required_delivery_date,
         utcSql(draft.quote_deadline),utcSql(draft.join_deadline),id]
      );
      await conn.query('DELETE FROM procurement_request_items WHERE request_id=?',[id]);
      for(let index=0;index<draft.items.length;index++){
        const line=draft.items[index];
        await conn.query(
          `INSERT INTO procurement_request_items
           (request_id,line_number,family_id,quantity,unit,requirements,allow_substitutions)
           VALUES (?,?,?,?,?,?,?)`,
          [id,index+1,line.family_id,line.quantity,line.unit,line.requirements,line.allow_substitutions?1:0]
        );
      }
      const request=await this._load(id,buyer,conn);
      await conn.query(
        `INSERT INTO procurement_request_mutations
         (request_id,buyer_id,operation,idempotency_key,request_hash,response_snapshot)
         VALUES (?,?,'UPDATE_DRAFT',?,?,?)`,
        [id,buyer,idem,hash,JSON.stringify(request)]
      );
      await conn.commit();
      return request;
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }

  async publish(buyerId,requestId,expectedVersion,key) {
    const buyer=positiveId(buyerId),id=positiveId(requestId),version=Number(expectedVersion);
    if (!Number.isSafeInteger(version) || version<1) throw issue('VERSION_REQUIRED','Provide the current request version.');
    const idem=idempotency(key);
    const hash=normalizedHash({ operation:'PUBLISH',id,version });
    const conn=await this.database.getConnection();
    try{
      await conn.beginTransaction();
      await this._buyer(conn,buyer);
      const [previous]=await conn.query(
        'SELECT request_id,operation,request_hash,response_snapshot FROM procurement_request_mutations WHERE buyer_id=? AND idempotency_key=? FOR UPDATE',
        [buyer,idem]
      );
      if(previous.length){
        if(Number(previous[0].request_id)!==id || previous[0].operation!=='PUBLISH' || previous[0].request_hash!==hash)
          throw issue('IDEMPOTENCY_CONFLICT','Idempotency key already belongs to another operation.',409);
        const saved=typeof previous[0].response_snapshot==='string'
          ? JSON.parse(previous[0].response_snapshot):previous[0].response_snapshot;
        await conn.commit();
        return {request:saved,is_replay:true};
      }
      const current=await this._load(id,buyer,conn,true);
      if(current.status!=='DRAFT'||Number(current.version_number)!==version)
        throw issue('REQUEST_STATE_CONFLICT','Request state/version has changed.',409);
      // Collective and recurring are deliberately fail-closed until their own
      // participant consent and scheduling contracts are implemented.
      if(current.ownership!=='SINGLE_BUYER'||current.frequency!=='ONE_TIME')
        throw issue('PROCUREMENT_MODE_NOT_READY','Collective and recurring publishing are not yet enabled.',409);
      if(!current.quote_deadline)throw issue('QUOTE_DEADLINE_REQUIRED','Choose a quote deadline before publishing.');
      const [[clock]]=await conn.query('SELECT UTC_TIMESTAMP() AS utc_now');
      const now=clock.utc_now instanceof Date ? clock.utc_now.getTime() : Date.parse(String(clock.utc_now).replace(' ','T')+'Z');
      const expires=current.quote_deadline instanceof Date?current.quote_deadline.getTime():Date.parse(String(current.quote_deadline).replace(' ','T')+'Z');
      if(!Number.isFinite(now)||!Number.isFinite(expires)||expires<=now+60000)
        throw issue('REQUEST_DEADLINE_EXPIRED','Quote deadline must remain in the future.',409);
      await this._validateFamilies(conn,current.items);
      await conn.query(
        `UPDATE procurement_requests SET status='OPEN',published_at=UTC_TIMESTAMP(),
         version_number=version_number+1 WHERE id=? AND buyer_id=? AND status='DRAFT'`,[id,buyer]
      );
      const request=await this._load(id,buyer,conn);
      await conn.query(
        `INSERT INTO procurement_request_mutations
         (request_id,buyer_id,operation,idempotency_key,request_hash,response_snapshot)
         VALUES (?,?,'PUBLISH',?,?,?)`,
        [id,buyer,idem,hash,JSON.stringify(request)]
      );
      await conn.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, previous_value, new_value)
         VALUES (?, 'BUYER', 'PROCUREMENT_REQUEST_PUBLISHED', 'procurement_requests', ?, ?, ?)`,
        [buyer, id, JSON.stringify({ status: 'DRAFT' }), JSON.stringify({ status: 'OPEN', open_to_suppliers: Boolean(request.open_to_suppliers) })]
      );
      await conn.commit();

      if (Number(request.open_to_suppliers) === 1) {
        try {
          const candidates = await matching._candidates(this.database, request);
          for (const candidate of candidates) {
            await notificationService.createNotification({
              userId: candidate.supplier_id,
              role: 'SUPPLIER',
              eventType: 'NEW_OPEN_PROCUREMENT_REQUEST',
              eventKey: `open_req_${id}_sup_${candidate.supplier_id}`,
              title: 'New eligible buyer request available',
              message: `A buyer published request ${request.request_code} for ${request.delivery_area}. Review specs and submit your quotation before expiry.`,
              payload: { request_id: id, request_code: request.request_code, delivery_area: request.delivery_area }
            });
          }
        } catch (notifErr) {
          console.error('[ProcurementRequestService] Open request notification error:', notifErr.message);
        }
      }

      return {request,is_replay:false};
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }

  async listMine(buyerId) {
    const id=positiveId(buyerId);
    await this.database.query(
      "UPDATE procurement_requests SET status='EXPIRED', version_number=version_number+1 WHERE buyer_id=? AND status='OPEN' AND quote_deadline IS NOT NULL AND quote_deadline <= UTC_TIMESTAMP()",
      [id]
    );
    const [rows]=await this.database.query(
      `SELECT id,request_code,status,open_to_suppliers,ownership,frequency,delivery_area,
       target_price_pkr,required_delivery_date,quote_deadline,
       version_number,created_at,published_at,closed_at,fulfilled_at
       FROM procurement_requests WHERE buyer_id=? AND status <> 'CANCELLED' ORDER BY created_at DESC,id DESC LIMIT 100`,[id]
    );
    return rows;
  }

  async closeMine(buyerId, requestId) {
    const buyer = positiveId(buyerId);
    const id = positiveId(requestId);
    const conn = await this.database.getConnection();
    try {
      await conn.beginTransaction();
      await this._buyer(conn, buyer);
      const current = await this._load(id, buyer, conn, true);
      if (current.status === 'CLOSED') {
        await conn.commit();
        return { request: current };
      }
      if (current.status !== 'OPEN') {
        throw issue('REQUEST_NOT_OPEN', 'Only an open procurement request can be closed.', 409);
      }
      await conn.query(
        "UPDATE procurement_requests SET status='CLOSED', closed_at=UTC_TIMESTAMP(), version_number=version_number+1 WHERE id=? AND buyer_id=?",
        [id, buyer]
      );
      await conn.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, previous_value, new_value)
         VALUES (?, 'BUYER', 'PROCUREMENT_REQUEST_CLOSED', 'procurement_requests', ?, ?, ?)`,
        [buyer, id, JSON.stringify({ status: current.status }), JSON.stringify({ status: 'CLOSED' })]
      );
      const updated = await this._load(id, buyer, conn);
      await conn.commit();
      return { request: updated };
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }
  async getMine(buyerId,requestId) {
    return this._load(positiveId(requestId),positiveId(buyerId));
  }

  async deleteMine(buyerId, requestId) {
    const buyer = positiveId(buyerId);
    const id = positiveId(requestId);
    const conn = await this.database.getConnection();
    try {
      await conn.beginTransaction();
      await this._buyer(conn, buyer);
      const current = await this._load(id, buyer, conn, true);
      if (current.status === 'CANCELLED') {
        await conn.commit();
        return { deleted: true, id };
      }
      const [awards] = await conn.query(
        'SELECT id FROM procurement_awards WHERE request_id=? LIMIT 1',
        [id]
      );
      if (awards.length) {
        throw issue('REQUEST_ALREADY_AWARDED', 'Awarded procurement requests cannot be deleted.', 409);
      }
      await conn.query(
        "UPDATE procurement_requests SET status='CANCELLED', version_number=version_number+1 WHERE id=? AND buyer_id=?",
        [id, buyer]
      );
      await conn.commit();
      return { deleted: true, id };
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }
}
module.exports=new ProcurementRequestService();
module.exports.ProcurementRequestService=ProcurementRequestService;
