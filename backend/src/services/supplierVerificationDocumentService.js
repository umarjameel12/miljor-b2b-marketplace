'use strict';
// Privately stored, append-only supplier evidence, owned by authenticated supplier.
// No public object URL, image transformations or executable document types.
const crypto=require('node:crypto');
const db=require('../config/db');
const KINDS=Object.freeze(['BUSINESS_LICENSE','TAX_CERTIFICATE','WAREHOUSE_PROOF','BANK_PROOF']);
const TOKENS=Object.freeze(KINDS.map(x=>'document:'+x));
const fail=(code,message,statusCode=400)=>Object.assign(new Error(message),{code,statusCode});
const positive=id=>Number.isSafeInteger(Number(id))&&Number(id)>0&&/^[1-9]\d*$/.test(String(id));
function inspect(payload){
  if(!payload || typeof payload!=='object'||Array.isArray(payload))throw fail('INVALID_DOCUMENT','Document payload required');
  const {kind,filename,mime_type,base64}=payload;
  if(!KINDS.includes(kind))throw fail('INVALID_DOCUMENT_KIND','Unsupported evidence category');
  if(typeof filename!=='string'||filename.length>120||!/^[\w .()\-]{1,120}$/.test(filename)||filename.startsWith('.'))
    throw fail('INVALID_DOCUMENT_NAME','Use a safe filename of at most 120 characters');
  if(typeof base64!=='string'||base64.length<16||base64.length>2097152||
     !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))
    throw fail('INVALID_DOCUMENT_ENCODING','Provide a valid base64 document up to 1 MiB');
  const bytes=Buffer.from(base64,'base64');
  if(bytes.length===0||bytes.length>1048576||bytes.toString('base64')!==base64)
    throw fail('INVALID_DOCUMENT_SIZE','Document must be no larger than 1 MiB');
  const pdf=bytes.subarray(0,5).equals(Buffer.from('%PDF-'));
  const png=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
  const jpg=bytes.length>4&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff&&bytes.at(-2)===0xff&&bytes.at(-1)===0xd9;
  if(!((mime_type==='application/pdf'&&pdf)||(mime_type==='image/png'&&png)||(mime_type==='image/jpeg'&&jpg)))
    throw fail('DOCUMENT_TYPE_MISMATCH','Only authentic PDF, PNG or JPEG evidence is accepted');
  const suffix=filename.toLowerCase().split('.').at(-1);
  if(!({ 'application/pdf':['pdf'],'image/png':['png'],'image/jpeg':['jpg','jpeg'] }[mime_type]||[]).includes(suffix))
    throw fail('DOCUMENT_EXTENSION_MISMATCH','File extension must match the verified document type');
  // Magic headers alone do not make arbitrary embedded HTML or a script safe.
  // Reject active PDF features and encrypted evidence that reviewers cannot inspect.
  if(pdf){
    const printable=bytes.toString('latin1');
    if(!/%%EOF\s*$/.test(printable)||
       /\/(?:JavaScript|JS|OpenAction|AA|Launch|EmbeddedFile|Encrypt)\b/i.test(printable))
      throw fail('UNSAFE_DOCUMENT','PDF must be complete and contain no active/encrypted content');
  }
  if(png){
    const ihdr=bytes.subarray(12,16).toString('ascii');
    const tail=bytes.subarray(-12);
    if(ihdr!=='IHDR'||tail.length!==12||tail.readUInt32BE(0)!==0||
       tail.subarray(4,8).toString('ascii')!=='IEND')
      throw fail('UNSAFE_DOCUMENT','PNG structure is incomplete');
  }
  return {kind,filename,mime_type,bytes,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
}
const meta=row=>({id:row.id,kind:row.document_kind,version:Number(row.version_number),
  review_revision:Number(row.review_revision),filename:row.original_name,mime_type:row.mime_type,
  byte_size:Number(row.byte_size),sha256:row.sha256,uploaded_at:row.uploaded_at});
class SupplierVerificationDocumentService {
  constructor(database=db){this.database=database;}
  async latest(supplierId,connection=this.database){
    if(!positive(supplierId))throw fail('INVALID_SUPPLIER_ID','Invalid supplier ID');
    const [rows]=await connection.query(`SELECT d.id,d.document_kind,d.version_number,d.review_revision,
      d.original_name,d.mime_type,d.byte_size,d.sha256,d.uploaded_at
      FROM supplier_verification_documents d
      WHERE d.supplier_id=? AND d.version_number=(
        SELECT MAX(v.version_number) FROM supplier_verification_documents v
        WHERE v.supplier_id=d.supplier_id AND v.document_kind=d.document_kind)
      ORDER BY d.document_kind`,[supplierId]);
    return rows.map(meta);
  }
  async versions(supplierId){
    if(!positive(supplierId))throw fail('INVALID_SUPPLIER_ID','Invalid supplier ID');
    const [rows]=await this.database.query(`SELECT id,document_kind,version_number,review_revision,
      original_name,mime_type,byte_size,sha256,uploaded_at
      FROM supplier_verification_documents WHERE supplier_id=? ORDER BY document_kind,version_number DESC`,[supplierId]);
    return rows.map(meta);
  }
  async upload(supplierId,payload,key){
    if(!positive(supplierId))throw fail('INVALID_SUPPLIER_ID','Invalid supplier');
    if(typeof key!=='string'||!/^[A-Za-z0-9:_-]{12,120}$/.test(key))
      throw fail('INVALID_IDEMPOTENCY_KEY','Valid X-Idempotency-Key required');
    const file=inspect(payload);
    const connection=await this.database.getConnection();
    try{
      await connection.beginTransaction();
      const [profiles]=await connection.query(`SELECT verification_status,submitted_revision,
        correction_fields,correction_requested_revision FROM supplier_profiles
        WHERE supplier_id=? FOR UPDATE`,[supplierId]);
      const p=profiles[0];
      if(!p)throw fail('SUPPLIER_PROFILE_NOT_FOUND','Supplier profile not found',404);
      const [previous]=await connection.query(`SELECT id,document_kind,version_number,review_revision,
        original_name,mime_type,byte_size,sha256,uploaded_at FROM supplier_verification_documents
        WHERE supplier_id=? AND idempotency_key=?`,[supplierId,key]);
      if(previous.length){
        if(previous[0].sha256!==file.sha256||previous[0].document_kind!==file.kind||
           previous[0].mime_type!==file.mime_type||previous[0].original_name!==file.filename)
          throw fail('IDEMPOTENCY_CONFLICT','Document key reused with different content',409);
        await connection.commit();
        return {...meta(previous[0]),is_replay:true};
      }
      const requested=typeof p.correction_fields==='string'?JSON.parse(p.correction_fields||'[]'):p.correction_fields;
      const correcting=p.verification_status==='MORE_INFORMATION_REQUIRED'&&
        Array.isArray(requested)&&requested.includes('document:'+file.kind)&&
        Number(p.correction_requested_revision)===Number(p.submitted_revision);
      if(p.verification_status!=='NOT_SUBMITTED'&&!correcting)
        throw fail('DOCUMENT_UPLOAD_LOCKED','Only draft evidence or admin-requested replacements are allowed',409);
      const [last]=await connection.query(`SELECT COALESCE(MAX(version_number),0) AS last_version
        FROM supplier_verification_documents WHERE supplier_id=? AND document_kind=?`,
        [supplierId,file.kind]);
      const version=Number(last[0].last_version)+1;
      const reviewRevision=correcting?Number(p.submitted_revision):0;
      const [save]=await connection.query(`INSERT INTO supplier_verification_documents
        (supplier_id,document_kind,version_number,review_revision,original_name,
          mime_type,byte_size,sha256,contents,idempotency_key)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [supplierId,file.kind,version,reviewRevision,file.filename,file.mime_type,
          file.bytes.length,file.sha256,file.bytes,key]);
      await connection.query(`INSERT INTO system_audit_logs
        (actor_id,actor_role,action,entity_name,entity_id,new_value)
        VALUES (?,'SUPPLIER','SUPPLIER_EVIDENCE_VERSION_ADDED','supplier_verification_documents',?,?)`,
        [supplierId,save.insertId,JSON.stringify({kind:file.kind,version,sha256:file.sha256,reviewRevision})]);
      await connection.commit();
      return {id:save.insertId,kind:file.kind,version,review_revision:reviewRevision,
        filename:file.filename,mime_type:file.mime_type,byte_size:file.bytes.length,sha256:file.sha256,is_replay:false};
    }catch(error){await connection.rollback();throw error;}finally{connection.release();}
  }
  async download(supplierId,docId){
    if(!positive(supplierId)||!positive(docId))throw fail('INVALID_ID','Invalid document identifier');
    const [rows]=await this.database.query(`SELECT document_kind,original_name,mime_type,sha256,contents
      FROM supplier_verification_documents WHERE supplier_id=? AND id=?`,[supplierId,docId]);
    if(!rows.length)throw fail('DOCUMENT_NOT_FOUND','Document not found',404);
    const row=rows[0];
    if(crypto.createHash('sha256').update(row.contents).digest('hex')!==row.sha256)
      throw fail('DOCUMENT_INTEGRITY_FAILURE','Stored document integrity check failed',503);
    return {name:row.original_name,mime:row.mime_type,bytes:row.contents};
  }
}
const service=new SupplierVerificationDocumentService();
module.exports=service;
module.exports.SupplierVerificationDocumentService=SupplierVerificationDocumentService;
module.exports.DOCUMENT_KINDS=KINDS;
module.exports.DOCUMENT_TOKENS=TOKENS;
