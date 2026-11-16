'use strict';
const crypto=require('node:crypto');
const MAX_BYTES=1024*1024;
const MAX_FILES=5;
const MIME_EXTENSIONS={'image/png':'png','image/jpeg':'jpg','application/pdf':'pdf'};
const FIELDS='id,order_id,uploader_id,proof_code,mime_type,byte_length,content_sha256,created_at';
const fail=(code,message,statusCode=400)=>Object.assign(new Error(message),{code,statusCode});
function id(value){
  if(!/^[1-9]\d*$/.test(String(value))||!Number.isSafeInteger(Number(value)))
    throw fail('INVALID_EVIDENCE_ID','A positive integer identifier is required.');
  return Number(value);
}
function identity(actor){
  if(!actor||!['BUYER','SUPPLIER'].includes(actor.role))throw fail('EVIDENCE_FORBIDDEN','Buyer or supplier access required.',403);
  return {id:id(actor.id),role:actor.role};
}
function decode(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).some(key=>!['mime_type','content_base64'].includes(key)))
    throw fail('INVALID_EVIDENCE_INPUT','Supply only mime_type and content_base64.');
  if(!Object.hasOwn(MIME_EXTENSIONS,input.mime_type))throw fail('UNSUPPORTED_EVIDENCE_MIME','Only PNG, JPEG and PDF proofs are supported.',415);
  const encoded=input.content_base64;
  if(typeof encoded!=='string'||!encoded.length)throw fail('INVALID_EVIDENCE_BASE64','A non-empty base64 file is required.');
  if(encoded.length>Math.ceil(MAX_BYTES/3)*4)throw fail('EVIDENCE_TOO_LARGE','Proof must be at most 1 MiB.',413);
  if(encoded.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
    throw fail('INVALID_EVIDENCE_BASE64','Use canonical base64 without a data URL or whitespace.');
  const bytes=Buffer.from(encoded,'base64');
  if(bytes.length>MAX_BYTES)throw fail('EVIDENCE_TOO_LARGE','Proof must be at most 1 MiB.',413);
  if(!bytes.length||bytes.toString('base64')!==encoded)throw fail('INVALID_EVIDENCE_BASE64','Invalid base64 encoding.');
  const magic=input.mime_type==='image/png'?Buffer.from('89504e470d0a1a0a','hex'):
    input.mime_type==='image/jpeg'?Buffer.from('ffd8ff','hex'):Buffer.from('%PDF-');
  if(bytes.length<magic.length||!bytes.subarray(0,magic.length).equals(magic))
    throw fail('EVIDENCE_MAGIC_MISMATCH','File signature does not match the declared MIME type.',415);
  return {bytes,mime:input.mime_type,hash:crypto.createHash('sha256').update(bytes).digest('hex')};
}
function metadata(row){
  return Object.fromEntries(FIELDS.split(',').map(field=>[field,row[field]]));
}
class ProcurementDeliveryEvidenceService{
  constructor(database,notifier){this.database=database;this.notifier=notifier;}
  get db(){return this.database||require('../config/db');}
  async _order(conn,actor,orderId,lock=false){
    const column=actor.role==='BUYER'?'buyer_id':'supplier_id';
    const [orders]=await conn.query(
      `SELECT o.id,o.buyer_id,o.supplier_id,o.payment_status,o.fulfillment_status
       FROM orders o JOIN procurement_award_orders ao ON ao.order_id=o.id
         AND ao.supplier_id=o.supplier_id
       WHERE o.id=? AND o.${column}=?${lock?' FOR UPDATE':''}`,[orderId,actor.id]);
    if(!orders.length)throw fail('EVIDENCE_ORDER_NOT_FOUND','Procurement order not found.',404);
    return orders[0];
  }
  async upload({actor,orderId,input,idempotencyKey}){
    const who=identity(actor),oid=id(orderId),file=decode(input);
    if(typeof idempotencyKey!=='string'||!/^[-A-Za-z0-9_.:]{1,120}$/.test(idempotencyKey))
      throw fail('EVIDENCE_KEY_REQUIRED','Use a stable 1–120 character ASCII X-Idempotency-Key.');
    const conn=await this.db.getConnection();
    try{
      if(process.env.NODE_ENV==='test'){
        const [[database]]=await conn.query('SELECT DATABASE() AS db_name');
        if(database?.db_name!=='miljor_test_db')throw fail('EVIDENCE_TEST_DATABASE_REQUIRED','Test writes require miljor_test_db.',503);
      }
      // Authorize before locking anyone. Keep this initial consistent read out
      // of the transaction so a lock wait cannot leave the cap on a stale view.
      const initial=await this._order(conn,who,oid);
      await conn.beginTransaction();
      // Lock both recipients in ID order: uploader lock serializes its global
      // key namespace and prevents notification FK lock inversions between peers.
      const [users]=await conn.query('SELECT id FROM users WHERE id IN (?,?) ORDER BY id FOR UPDATE',
        [initial.buyer_id,initial.supplier_id].map(Number).sort((a,b)=>a-b));
      if(users.length!==2)throw fail('EVIDENCE_FORBIDDEN','Order participants unavailable.',403);
      const order=await this._order(conn,who,oid,true);
      if(String(order.buyer_id)!==String(initial.buyer_id)||String(order.supplier_id)!==String(initial.supplier_id))
        throw fail('EVIDENCE_ORDER_CHANGED','Order participants changed; retry with the current order.',409);
      if(order.payment_status!=='PAID'||!['DISPATCHED','SUPPLIER_DELIVERED','BUYER_CONFIRMED','COMPLETED','EXCEPTION'].includes(order.fulfillment_status))
        throw fail('EVIDENCE_ORDER_NOT_ELIGIBLE','Proof requires a paid order that is dispatched, delivered or in exception.',409);
      const [previous]=await conn.query(
        `SELECT ${FIELDS},idempotency_key FROM procurement_delivery_evidence
         WHERE uploader_id=? AND idempotency_key=? FOR UPDATE`,[who.id,idempotencyKey]);
      if(previous.length){
        const proof=previous[0];
        if(String(proof.order_id)!==String(oid)||proof.mime_type!==file.mime||
          Number(proof.byte_length)!==file.bytes.length||proof.content_sha256!==file.hash)
          throw fail('EVIDENCE_KEY_CONFLICT','This upload key belongs to different order, MIME or content.',409);
        await conn.commit();return {proof:metadata(proof),is_replay:true};
      }
      const [[count]]=await conn.query('SELECT COUNT(*) AS total FROM procurement_delivery_evidence WHERE order_id=?',[oid]);
      if(Number(count.total)>=MAX_FILES)throw fail('EVIDENCE_LIMIT_REACHED',`At most ${MAX_FILES} proofs may be stored per order.`,409);
      const code='MJPROOF-'+crypto.randomBytes(12).toString('hex');
      const [insert]=await conn.query(
        `INSERT INTO procurement_delivery_evidence
         (order_id,uploader_id,proof_code,mime_type,byte_length,content_sha256,content_bytes,idempotency_key)
         VALUES (?,?,?,?,?,?,?,?)`,[oid,who.id,code,file.mime,file.bytes.length,file.hash,file.bytes,idempotencyKey]);
      const [stored]=await conn.query(`SELECT ${FIELDS} FROM procurement_delivery_evidence WHERE order_id=? AND id=?`,[oid,insert.insertId]);
      if(!stored.length)throw Error('Stored delivery proof unavailable');
      const notifier=this.notifier||require('./notificationService');
      for(const [userId,role] of [[order.buyer_id,'BUYER'],[order.supplier_id,'SUPPLIER']]){
        await notifier.enqueueEvent(conn,{userId:Number(userId),role,eventType:'PROOF_UPLOADED',
          eventKey:'proof:'+stored[0].proof_code,entityId:oid});
      }
      await conn.commit();return {proof:metadata(stored[0]),is_replay:false};
    }catch(error){await conn.rollback();throw error;}finally{conn.release();}
  }
  async list({actor,orderId}){
    const who=identity(actor),oid=id(orderId);
    await this._order(this.db,who,oid);
    const [proofs]=await this.db.query(`SELECT ${FIELDS} FROM procurement_delivery_evidence WHERE order_id=? ORDER BY id`,[oid]);
    return proofs.map(metadata);
  }
  async download({actor,orderId,evidenceId}){
    const who=identity(actor),oid=id(orderId),eid=id(evidenceId);
    await this._order(this.db,who,oid);
    const [proofs]=await this.db.query(`SELECT ${FIELDS},content_bytes FROM procurement_delivery_evidence WHERE order_id=? AND id=?`,[oid,eid]);
    if(!proofs.length)throw fail('EVIDENCE_NOT_FOUND','Proof not found.',404);
    const row=proofs[0];
    if(!Object.hasOwn(MIME_EXTENSIONS,row.mime_type)||!/^MJPROOF-[a-f0-9]{24}$/.test(row.proof_code)||
      !Buffer.isBuffer(row.content_bytes)||row.content_bytes.length>MAX_BYTES||
      row.content_bytes.length!==Number(row.byte_length)||
      crypto.createHash('sha256').update(row.content_bytes).digest('hex')!==row.content_sha256)
      throw fail('EVIDENCE_INTEGRITY_ERROR','Proof integrity check failed.',500);
    return {...metadata(row),content_bytes:row.content_bytes,filename:row.proof_code+'.'+MIME_EXTENSIONS[row.mime_type]};
  }
}
module.exports=new ProcurementDeliveryEvidenceService();
module.exports.ProcurementDeliveryEvidenceService=ProcurementDeliveryEvidenceService;
module.exports.MAX_BYTES=MAX_BYTES;
module.exports.MAX_FILES=MAX_FILES;
