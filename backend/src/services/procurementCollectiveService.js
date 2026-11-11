'use strict';

// B6-I: consent-first B2B collective invitation and joining.
// No group bids, stock allocations, checkout, or payment in this service.
const crypto=require('node:crypto');
const db=require('../config/db');
const notifications=require('./procurementNotificationService');
const exact=require('./exactDecimal');
const fail=(code,message,statusCode=400)=>Object.assign(new Error(message),{code,statusCode});
const id=(v,label)=>{
  if(v==null||typeof v==='boolean'||!/^[1-9]\d*$/.test(String(v))||
    !Number.isSafeInteger(Number(v)))throw fail('INVALID_COLLECTIVE_ID',label+' needs a positive ID.');
  return Number(v);
};
const idem=v=>{
  if(typeof v!=='string'||!/^[A-Za-z0-9:_-]{12,120}$/.test(v))
    throw fail('INVALID_IDEMPOTENCY_KEY','X-Idempotency-Key is required (12–120 safe characters).');
  return v;
};
const positiveQty=(v,unit)=>{
  try{
    const q=exact.toCanonical(v,4);
    if(!exact.exactDecimalGte(q,'0.0001',4)||q.split('.')[0].length>8)
      throw Error('range');
    if(['bag','tin','carton','sack','bundle','pack'].includes(unit)&&!/^[0-9]+\.0000$/.test(q))
      throw Error('pack');
    return q;
  }catch{throw fail('INVALID_PARTICIPANT_QUANTITY','Positive exact quantity required; packaged units must be whole.');}
};

class ProcurementCollectiveService{
  constructor(database=db){this.database=database;}
  async _verified(conn,buyerId){
    const [buyers]=await conn.query(
      `SELECT id FROM users WHERE id=? AND role='BUYER' AND is_verified=1
       AND verification_status='VERIFIED' AND buyer_trust_status<>'SUSPENDED'`,[buyerId]);
    if(!buyers.length)throw fail('BUYER_NOT_ELIGIBLE','Verified active B2B buyer required.',403);
  }
  async _group(conn,groupId,lock=false){
    const [groups]=await conn.query(
      `SELECT g.*,r.ownership,r.frequency,r.status AS request_status
       FROM procurement_collective_groups g
       JOIN procurement_requests r ON r.id=g.request_id
       WHERE g.id=?${lock?' FOR UPDATE':''}`,[groupId]);
    if(!groups.length)throw fail('COLLECTIVE_NOT_FOUND','Collective request not found.',404);
    return groups[0];
  }
  async _open(conn,group){
    if(group.status!=='FORMING'||group.request_status!=='DRAFT')
      throw fail('COLLECTIVE_JOIN_CLOSED','Collective is not accepting invitations or joins.',409);
    const [[clock]]=await conn.query(
      'SELECT (? > UTC_TIMESTAMP()) AS join_open',[group.join_deadline]);
    if(Number(clock?.join_open)!==1)
      throw fail('COLLECTIVE_JOIN_EXPIRED','Collective joining cutoff has passed.',409);
  }
  async createGroup(buyerId,requestId,{visibility='PRIVATE_INVITE',minimum_buyers=2}={}){
    const buyer=id(buyerId,'Buyer'),rid=id(requestId,'Request');
    if(visibility!=='PRIVATE_INVITE')
      throw fail('COLLECTIVE_DISCOVERY_NOT_READY','Only private invitations are available until controlled discovery is moderated.');
    if(!Number.isInteger(minimum_buyers)||minimum_buyers<2||minimum_buyers>1000)
      throw fail('INVALID_COLLECTIVE_MINIMUM','Minimum must be 2–1000 businesses.');
    const conn=await this.database.getConnection();
    try{
      await conn.beginTransaction();
      await this._verified(conn,buyer);
      const [requests]=await conn.query(
        `SELECT id,buyer_id,status,ownership,frequency,join_deadline,quote_deadline
         FROM procurement_requests WHERE id=? AND buyer_id=? FOR UPDATE`,[rid,buyer]);
      const request=requests[0];
      if(!request)throw fail('REQUEST_NOT_FOUND','Organizer-owned request not found.',404);
      if(request.status!=='DRAFT'||request.ownership!=='COLLECTIVE'||request.frequency!=='ONE_TIME')
        throw fail('INVALID_COLLECTIVE_MODE','Use a one-time collective draft before publishing.',409);
      if(!request.join_deadline||!request.quote_deadline)
        throw fail('COLLECTIVE_DEADLINE_REQUIRED','Join and quote deadlines are required.');
      const [[clock]]=await conn.query(
        `SELECT (? > UTC_TIMESTAMP()) AS join_open,
             (? > ?) AS quotes_follow_join`,
        [request.join_deadline,request.quote_deadline,request.join_deadline]
      );
      if(Number(clock?.join_open)!==1||Number(clock?.quotes_follow_join)!==1)
        throw fail('COLLECTIVE_DEADLINE_INVALID','Join deadline must be future and earlier than quotes.',409);
      const [existing]=await conn.query(
        'SELECT id,organizer_buyer_id,visibility,minimum_buyers,status FROM procurement_collective_groups WHERE request_id=?',
        [rid]);
      if(existing.length){
        if(existing[0].organizer_buyer_id!==buyer ||
          existing[0].visibility!==visibility||Number(existing[0].minimum_buyers)!==minimum_buyers)
          throw fail('COLLECTIVE_ALREADY_EXISTS','This request has another collective configuration.',409);
        await conn.commit();
        return {group:existing[0],is_replay:true};
      }
      const [created]=await conn.query(
        `INSERT INTO procurement_collective_groups
         (request_id,organizer_buyer_id,visibility,minimum_buyers,join_deadline,status)
         VALUES (?,?,?,?,?,'FORMING')`,
        [rid,buyer,visibility,minimum_buyers,request.join_deadline]
      );
      // Organizer is NOT automatically consented: actively joins like other buyers.
      await conn.query(
        `INSERT INTO procurement_collective_participants (group_id,buyer_id,status)
         VALUES (?,?,'INVITED')`,[created.insertId,buyer]
      );
      const [rows]=await conn.query(
        'SELECT id,organizer_buyer_id,visibility,minimum_buyers,status FROM procurement_collective_groups WHERE id=?',
        [created.insertId]
      );
      await conn.commit();
      return {group:rows[0],is_replay:false};
    }catch(e){await conn.rollback();if(e.code==='ER_DUP_ENTRY')
      throw fail('COLLECTIVE_CONFLICT','Concurrent collective setup detected.',409);
      throw e;
    }finally{conn.release();}
  }
  async invite(organizerId,groupId,buyerId){
    const actor=id(organizerId,'Organizer'),gid=id(groupId,'Group'),invitee=id(buyerId,'Invited buyer');
    const conn=await this.database.getConnection();
    try{
      await conn.beginTransaction();
      const group=await this._group(conn,gid,true);
      if(Number(group.organizer_buyer_id)!==actor)
        throw fail('COLLECTIVE_ORGANIZER_ONLY','Only the organizer may invite businesses.',403);
      await this._open(conn,group);
      await this._verified(conn,invitee);
      await conn.query(
        `INSERT INTO procurement_collective_participants(group_id,buyer_id,status)
         VALUES (?,?,'INVITED') ON DUPLICATE KEY UPDATE id=id`,
        [gid,invitee]
      );
      const [rows]=await conn.query(
        'SELECT id,status FROM procurement_collective_participants WHERE group_id=? AND buyer_id=?',
        [gid,invitee]
      );
      await conn.commit();
      return {participant_id:rows[0].id,status:rows[0].status};
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }
  async join(buyerId,groupId,lines,rawKey){
    const buyer=id(buyerId,'Buyer'),gid=id(groupId,'Group'),key=idem(rawKey);
    if(!Array.isArray(lines)||!lines.length||lines.length>50)
      throw fail('INVALID_JOIN_LINES','Choose 1–50 product lines with your own quantities.');
    const ids=new Set();
    const selected=lines.map(line=>{
      const item=id(line?.request_item_id,'Request item');
      if(ids.has(item))throw fail('DUPLICATE_JOIN_LINE','Cannot join the same item twice.');
      ids.add(item);
      return {request_item_id:item,quantity:line.quantity};
    });
    const payloadHash=crypto.createHash('sha256').update(JSON.stringify(selected)).digest('hex');
    const conn=await this.database.getConnection();
    try{
      await conn.beginTransaction();
      const group=await this._group(conn,gid,true);
      await this._verified(conn,buyer);
      const [participants]=await conn.query(
        'SELECT id,status,join_idempotency_key,join_request_hash,consent_snapshot FROM procurement_collective_participants WHERE group_id=? AND buyer_id=? FOR UPDATE',
        [gid,buyer]
      );
      const participant=participants[0];
      if(!participant)throw fail('COLLECTIVE_INVITATION_REQUIRED','You must be invited before joining.',403);
      if(participant.status==='JOINED'){
        if(participant.join_idempotency_key!==key)
          throw fail('PARTICIPATION_ALREADY_JOINED','Buyer has already joined this collective.',409);
        if(participant.join_request_hash!==payloadHash)
          throw fail('IDEMPOTENCY_CONFLICT','Same join key cannot change quantities.',409);
        const snapshot=typeof participant.consent_snapshot==='string'
          ?JSON.parse(participant.consent_snapshot):participant.consent_snapshot;
        await conn.commit();
        return {participant_id:participant.id,consent_snapshot:snapshot,is_replay:true};
      }
      if(participant.status!=='INVITED')
        throw fail('PARTICIPATION_NOT_OPEN','Your participation is no longer pending.',409);
      await this._open(conn,group);
      const [items]=await conn.query(
        'SELECT id,family_id,unit,requirements,allow_substitutions FROM procurement_request_items WHERE request_id=? ORDER BY line_number',
        [group.request_id]
      );
      const byItem=new Map(items.map(row=>[Number(row.id),row]));
      const normalized=selected.map(line=>{
        const item=byItem.get(line.request_item_id);
        if(!item)throw fail('FOREIGN_PARTICIPANT_ITEM','Item is not part of this collective.',409);
        return {request_item_id:line.request_item_id,family_id:item.family_id,
          unit:item.unit,quantity:positiveQty(line.quantity,item.unit),
          requirements:item.requirements,allow_substitutions:Number(item.allow_substitutions)===1};
      });
      // B6-N: active recurring-cycle joining must match THIS buyer's own
      // immutable, consented schedule snapshot; one-time collectives unchanged.
      const [linkedCycles]=await conn.query(
        "SELECT status,qualification_snapshot FROM procurement_recurring_collective_cycles WHERE group_id=? FOR UPDATE",
        [gid]
      );
      if(linkedCycles.length){
        if(linkedCycles[0].status!=='INVITING')
          throw fail('RECURRING_CYCLE_NOT_INVITING','This recurring collective cycle cannot accept joins.',409);
        const evidence=typeof linkedCycles[0].qualification_snapshot==='string'
          ?JSON.parse(linkedCycles[0].qualification_snapshot)
          :linkedCycles[0].qualification_snapshot;
        const own=(evidence?.private_join_mapping||[]).find(x=>Number(x.buyer_id)===buyer);
        if(!own||!Array.isArray(own.planned_lines)||!own.planned_lines.length)
          throw fail('RECURRING_CYCLE_BUYER_NOT_ELIGIBLE','Your contract was not eligible for this cycle.',403);
        const planned=new Map(own.planned_lines.map(x=>[
          Number(x.request_item_id),String(x.quantity)]));
        if(planned.size!==normalized.length||normalized.some(line=>
            !planned.has(Number(line.request_item_id))||
            !exact.exactDecimalEquals(
              line.quantity,planned.get(Number(line.request_item_id)),4)))
          throw fail('RECURRING_CYCLE_QUANTITY_MISMATCH',
            'Confirm the exact scheduled product lines and quantities for this cycle.',409);
      }
      const consent={group_id:gid,buyer_id:buyer,items:normalized,
        explicit_join:true,creates_payment:false,authorizes_any_price:false};
      for(const line of normalized){
        await conn.query(
          `INSERT INTO procurement_collective_participant_lines
           (participant_id,request_item_id,quantity,purchasing_unit,requirement_snapshot)
           VALUES (?,?,?,?,?)`,
          [participant.id,line.request_item_id,line.quantity,line.unit,JSON.stringify(line)]
        );
      }
      await conn.query(
        `UPDATE procurement_collective_participants
         SET status='JOINED',join_idempotency_key=?,join_request_hash=?,consent_snapshot=?,consent_at=UTC_TIMESTAMP()
         WHERE id=? AND status='INVITED'`,
        [key,payloadHash,JSON.stringify(consent),participant.id]
      );
      await notifications.enqueue(conn,{
        recipient_id:group.organizer_buyer_id,recipient_role:'BUYER',
        event_key:'collective:join:'+gid+':participant:'+participant.id,
        event_type:'GROUP_JOINED',payload:{group_id:gid}
      });
      await conn.commit();
      return {participant_id:participant.id,consent_snapshot:consent,is_replay:false};
    }catch(e){await conn.rollback();if(e.code==='ER_DUP_ENTRY')
      throw fail('PARTICIPATION_CONFLICT','Concurrent join detected; refresh before retrying.',409);
      throw e;
    }finally{conn.release();}
  }
  async listMyInvites(buyerId){
    const buyer=id(buyerId,'Buyer');
    const [rows]=await this.database.query(
      `SELECT p.id AS participant_id,p.group_id,p.status,g.request_id,
        g.visibility,g.minimum_buyers,g.join_deadline,g.status AS group_status
       FROM procurement_collective_participants p
       JOIN procurement_collective_groups g ON g.id=p.group_id
       WHERE p.buyer_id=? ORDER BY p.created_at DESC LIMIT 100`,[buyer]
    );
    for(const row of rows){
      const [items]=await this.database.query(
        `SELECT id,family_id,quantity,unit,requirements
           FROM procurement_request_items WHERE request_id=? ORDER BY line_number`,
        [row.request_id]
      );
      // Private recurring cycle: reveal ONLY this authenticated buyer's
      // scheduled quantities, never other participants' member snapshots.
      const [cycles]=await this.database.query(
        'SELECT qualification_snapshot FROM procurement_recurring_collective_cycles WHERE group_id=?',
        [row.group_id]
      );
      if(cycles.length){
        const evidence=typeof cycles[0].qualification_snapshot==='string'
          ?JSON.parse(cycles[0].qualification_snapshot):cycles[0].qualification_snapshot;
        const own=(evidence?.private_join_mapping||[]).find(m=>Number(m.buyer_id)===buyer);
        row.recurring_cycle=true;
        const ownQuantities=new Map((own?.planned_lines||[]).map(x=>[
          Number(x.request_item_id),x.quantity]));
        row.items=items.filter(item=>ownQuantities.has(Number(item.id))).map(item=>({
          ...item,scheduled_quantity:ownQuantities.get(Number(item.id)),
          requirements:typeof item.requirements==='string'
            ?item.requirements
               .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[contact hidden]')
               .replace(/(?:\+?92|0)\s*3\d{2}[\s().-]*\d{3}[\s().-]*\d{4}/g,'[contact hidden]')
            :null
        }));
        continue;
      }
      row.items=items.map(item=>({
        ...item,
        requirements:typeof item.requirements==='string'
          ?item.requirements
             .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[contact hidden]')
             .replace(/(?:\+?92|0)\s*3\d{2}[\s().-]*\d{3}[\s().-]*\d{4}/g,'[contact hidden]')
          :null
      }));
    }
    return rows;
  }
}
module.exports=new ProcurementCollectiveService();
module.exports.ProcurementCollectiveService=ProcurementCollectiveService;
