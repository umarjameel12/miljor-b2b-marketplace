'use strict';
// B6-Q: private idempotent procurement event projection.
// This service does NOT send email/SMS: external channels need separate approved adapters.
const db=require('../config/db');
const fail=(code,message,statusCode=400)=>Object.assign(new Error(message),{code,statusCode});
const id=v=>{if(v==null||typeof v==='boolean'||!/^[1-9]\d*$/.test(String(v))||
 !Number.isSafeInteger(Number(v)))throw fail('INVALID_RECIPIENT','Valid recipient ID required.');return Number(v)};
const eventTypes=new Set(['COHORT_INVITED','COHORT_CYCLE_READY','COHORT_CYCLE_UNQUALIFIED',
 'DELIVERY_CHOICE_RECORDED','DELIVERY_RUN_PLANNED',
 'NEW_QUOTE','QUOTE_REVISED','GROUP_JOINED','PAYMENT_DEADLINE',
 'RECURRING_CYCLE_DUE','DELIVERY_STATUS_CHANGED']);
const allowFields=new Set(['cohort_id','cycle_id','request_id','group_id',
 'order_id','run_id','quote_id','version_number','supplier_id',
 'expires_at_utc','due_at_utc','status_code']);
const sanitizePayload=payload=>{
 if(!payload||Array.isArray(payload)||typeof payload!=='object')
  throw fail('INVALID_NOTICE_PAYLOAD','Notification needs a safe object.');
 const clean={};
 for(const [field,value] of Object.entries(payload)){
  if(!allowFields.has(field))
   throw fail('PRIVATE_NOTIFICATION_FIELD','Notification cannot contain contact, address, payment or arbitrary data.',403);
  if(value!=null && !(typeof value==='string'||typeof value==='number'))
   throw fail('INVALID_NOTICE_FIELD','Notice fields must be scalar.');
  if(typeof value==='string'&&value.length>100)
   throw fail('INVALID_NOTICE_FIELD','Notification field too long.');
  clean[field]=value;
 }
 return clean;
};
class ProcurementNotificationService{
 constructor(database=db){this.database=database;}
 async enqueue(conn,{recipient_id,recipient_role,event_key,event_type,payload}){
  const recipient=id(recipient_id);
  if(!['BUYER','SUPPLIER'].includes(recipient_role)||
   !eventTypes.has(event_type)||
   typeof event_key!=='string'||!/^[A-Za-z0-9:_-]{6,120}$/.test(event_key))
   throw fail('INVALID_NOTICE_EVENT','Invalid event type, role or durable key.');
  const clean=sanitizePayload(payload);
  const [users]=await conn.query(
    'SELECT id FROM users WHERE id=? AND role=?',[recipient,recipient_role]);
  if(!users.length)throw fail('RECIPIENT_ROLE_MISMATCH','Recipient no longer has the expected role.',409);
  const [saved]=await conn.query(
    "INSERT INTO procurement_notifications (recipient_id,recipient_role,event_key,event_type,payload,status) VALUES (?,?,?,?,?,'PENDING') ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)",
    [recipient,recipient_role,event_key,event_type,JSON.stringify(clean)]);
  return {notification_id:saved.insertId,event_type};
 }
 async inbox(actorId,role,{limit=50}={}){
  const actor=id(actorId);
  if(!['BUYER','SUPPLIER'].includes(role))throw fail('INVALID_ROLE','Buyer or supplier required.',403);
  if(!Number.isInteger(limit)||limit<1||limit>100)throw fail('INVALID_PAGE_SIZE','Read 1–100 notices.');
  const [rows]=await this.database.query(
    'SELECT id,event_type,payload,is_read,created_at FROM procurement_notifications WHERE recipient_id=? AND recipient_role=? ORDER BY id DESC LIMIT ?',
    [actor,role,limit]);
  return rows.map(r=>({...r,payload:typeof r.payload==='string'?JSON.parse(r.payload):r.payload}));
 }
 async markRead(actorId,role,notificationId){
  const actor=id(actorId),notice=id(notificationId);
  if(!['BUYER','SUPPLIER'].includes(role))throw fail('INVALID_ROLE','Buyer or supplier required.',403);
  const [updated]=await this.database.query(
    'UPDATE procurement_notifications SET is_read=1 WHERE id=? AND recipient_id=? AND recipient_role=?',
    [notice,actor,role]);
  if(!updated.affectedRows)throw fail('NOTICE_NOT_FOUND','Own notification not found.',404);
  return {notification_id:notice,is_read:true};
 }
}
module.exports=new ProcurementNotificationService();
module.exports.ProcurementNotificationService=ProcurementNotificationService;
module.exports.sanitizePayload=sanitizePayload;
