'use strict';
// Safepay refund webhooks: signed provider-only input, no client-supplied success,
// no payout invocation and no active gateway refund API calls.
// A refund event is a financial fact ONLY after every stored obligation, payment,
// tracker, currency and amount invariant matches under MySQL locks.
const db=require('../config/db');
const exact=require('./exactDecimal');
const safepayAdapter=require('./safepayAdapter');
const financialSettlement=require('./financialSettlementService');

function reject(code,message,statusCode=409){
  const err=new Error(message);err.code=code;err.statusCode=statusCode;return err;
}
function safeMoneyFromMinorUnits(value){
  // Safepay payment.refunded webhook examples use integer minor units.
  // Reject decimals, exponent notation, empty strings and unsafe magnitudes.
  if((typeof value!=='number' && typeof value!=='string') ||
    !/^(0|[1-9][0-9]*)$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) || Number(value)<=0)
    throw reject('INVALID_REFUND_MINOR_UNITS','Safepay refund_amount must be a positive integer',422);
  const n=BigInt(String(value));
  return (n/100n).toString()+'.'+(n%100n).toString().padStart(2,'0');
}
function parseSignedPayload(rawBody,signature){
  if(!Buffer.isBuffer(rawBody))
    throw reject('RAW_WEBHOOK_REQUIRED','Unmodified raw webhook bytes are mandatory',400);
  if(!safepayAdapter.verifyWebhookSignature({rawBody,signature}))
    throw reject('INVALID_WEBHOOK_SIGNATURE','Refund webhook signature is invalid',401);
  let payload;
  try {payload=JSON.parse(rawBody.toString('utf8'));}
  catch (_) {throw reject('INVALID_WEBHOOK_PAYLOAD','Refund webhook is not valid JSON',400);}
  if(!payload || payload.type!=='payment.refunded' ||
      typeof payload.token!=='string'||!/^evt_[a-zA-Z0-9_-]{8,120}$/.test(payload.token))
    throw reject('INVALID_REFUND_EVENT','A signed payment.refunded event with stable event ID is required',422);
  const data=payload.data;
  if(!data||typeof data.tracker!=='string'||!/^track_[a-zA-Z0-9_-]{8,120}$/.test(data.tracker) ||
      data.currency!=='PKR'||!['TRACKER_REFUNDED','TRACKER_PARTIAL_REFUND'].includes(data.state))
    throw reject('INVALID_REFUND_EVIDENCE','Refund tracker, PKR currency or final refund state missing',422);
  if(data.metadata?.order_id!==undefined &&
      (typeof data.metadata.order_id!=='string'||data.metadata.order_id.length>120))
    throw reject('INVALID_ORDER_METADATA','Signed order metadata invalid',422);
  return {payload,data,eventId:payload.token,tracker:data.tracker,
    amount:safeMoneyFromMinorUnits(data.refund_amount)};
}
class SafepayRefundWebhookService {
  async receive({rawBody,signature,timestamp=null}){
    const evidence=parseSignedPayload(rawBody,signature); // before DB
    // Refund event amount units are intentionally NOT inferred from a numeric
    // sample. Confirm PAISA handling against the merchant's configured
    // Safepay checkout/webhook contract before allowing state mutation.
    if(process.env.MILJOR_SAFEPAY_REFUND_UNIT_VERIFIED !== 'PAISA') {
      throw reject('REFUND_AMOUNT_UNIT_UNVERIFIED',
        'Safepay refund amount unit must be independently validated before financial confirmation',409);
    }
    const conn=await db.getConnection();
    try{
      await conn.beginTransaction();
      const {eventId,tracker,amount,payload,data}=evidence;
      // Serialize by the immutable provider tracker and parent order. Duplicate
      // event tokens must be idempotent; existing unrelated event IDs must not
      // be repurposed as refund evidence.
      const [attempts]=await conn.query(
        'SELECT * FROM payment_attempts WHERE provider_tracker_token=? FOR UPDATE',[tracker]
      );
      if(attempts.length!==1 || attempts[0].status!=='COMPLETED')
        throw reject('REFUND_TRACKER_UNVERIFIED','No unique completed Safepay payment attempt matches refund tracker',409);
      const attempt=attempts[0];
      const [orders]=await conn.query('SELECT * FROM orders WHERE id=? FOR UPDATE',[attempt.order_id]);
      if(orders.length!==1 || orders[0].payment_status!=='PAID' ||
          (data.metadata?.order_id && data.metadata.order_id!==orders[0].order_code))
        throw reject('REFUND_ORDER_MISMATCH','Verified order/payment linkage does not match refund event',409);
      const order=orders[0];
      const [previous]=await conn.query(
        'SELECT * FROM payment_webhook_events WHERE event_id=? FOR UPDATE',[eventId]
      );
      if(previous.length){
        if(previous[0].provider==='SAFEPAY' &&
           previous[0].event_type==='payment.refunded' &&
           previous[0].processed_status==='PROCESSED' &&
           Number(previous[0].order_id)===Number(order.id) &&
           previous[0].provider_tracker_token===tracker &&
           // An event ID with different signed monetary evidence is a conflict,
           // never a harmless replay, even when order/tracker are identical.
           previous[0].raw_payload === JSON.stringify(payload)){
          await conn.commit();
          return {success:true,duplicate:true,status:'PROCESSED'};
        }
        throw reject('REFUND_EVENT_RECONCILIATION_REQUIRED','Event ID exists with a different or unverified processing state',409);
      }
      const [payments]=await conn.query(
        `SELECT * FROM payments
         WHERE order_id=? AND transaction_ref=? AND status IN ('PAID','PARTIALLY_REFUNDED')
         ORDER BY id DESC LIMIT 2 FOR UPDATE`,[order.id,tracker]
      );
      if(payments.length!==1)
        throw reject('REFUND_PAYMENT_NOT_FOUND','No unique captured Safepay payment matches tracker',409);
      const payment=payments[0];
      // No ambiguous matching: identical approved refund amounts in the same
      // payment cannot be assigned to an event without a provider refund ID.
      const [obligations]=await conn.query(
        `SELECT * FROM refund_obligations
         WHERE payment_id=? AND status='APPROVED' AND currency='PKR'
           AND total_refund_amount=? ORDER BY id ASC FOR UPDATE`,
        [payment.id,amount]
      );
      if(obligations.length!==1)
        throw reject('REFUND_OBLIGATION_AMBIGUOUS',
          'Signed refund amount must identify exactly one approved obligation',409);
      const refund=obligations[0];
      const [sumRows]=await conn.query(
        `SELECT COALESCE(SUM(total_refund_amount),0) AS confirmed_amount
         FROM refund_obligations WHERE payment_id=? AND status='CONFIRMED'`,
        [payment.id]
      );
      const confirmed=exact.toCanonical(sumRows[0]?.confirmed_amount||'0.00',2);
      const cumulative=exact.exactDecimalSum([confirmed,amount],2);
      const captured=exact.toCanonical(payment.amount,2);
      if(!exact.exactDecimalGte(captured,cumulative,2))
        throw reject('REFUND_CAPTURE_CEILING','Confirmed refunds would exceed captured payment',409);
      const fullyRefunded=exact.exactDecimalEquals(captured,cumulative,2);
      if(data.state==='TRACKER_REFUNDED' && !fullyRefunded)
        throw reject('REFUND_TRACKER_STATE_MISMATCH','Full-refund state disagrees with captured refund sum',409);
      if(data.state==='TRACKER_PARTIAL_REFUND' && fullyRefunded)
        throw reject('REFUND_TRACKER_STATE_MISMATCH','Partial-refund state disagrees with captured refund sum',409);

      // The signed Safepay event token becomes the immutable external proof,
      // not an admin-provided reference. Insert within the same transaction.
      await conn.query(
        `INSERT INTO payment_webhook_events
         (event_id,provider,event_type,order_id,attempt_id,provider_tracker_token,
          signature,timestamp_header,raw_payload,processed_status)
         VALUES (?,'SAFEPAY','payment.refunded',?,?,?,?,?,?,'PROCESSED')`,
        [eventId,order.id,attempt.id,tracker,signature,String(timestamp||''),
         JSON.stringify(payload)]
      );
      const [refundUpdate]=await conn.query(
        `UPDATE refund_obligations
         SET status='CONFIRMED',external_reference=?,confirmed_at=NOW(),
             updated_at=NOW()
         WHERE id=? AND status='APPROVED' AND payment_id=?
           AND total_refund_amount=? AND currency='PKR'`,
        [eventId,refund.id,payment.id,amount]
      );
      if(refundUpdate.affectedRows!==1)
        throw reject('REFUND_ATOMIC_UPDATE_CONFLICT',
          'Refund approval changed before signed provider confirmation; rollback required',409);
      const [paymentUpdate]=await conn.query(
        `UPDATE payments SET status=?,updated_at=NOW()
         WHERE id=? AND order_id=? AND transaction_ref=?
           AND status IN ('PAID','PARTIALLY_REFUNDED')`,
        [fullyRefunded?'REFUNDED':'PARTIALLY_REFUNDED',
         payment.id,order.id,tracker]
      );
      if(paymentUpdate.affectedRows!==1)
        throw reject('PAYMENT_ATOMIC_UPDATE_CONFLICT',
          'Captured payment state changed before refund confirmation; rollback required',409);
      await financialSettlement._logAuditEvent(conn,{
        orderId:order.id,paymentId:payment.id,
        entityType:'REFUND_OBLIGATION',entityId:refund.id,
        eventType:'REFUND_CONFIRMED_BY_SIGNED_SAFEPAY_EVENT',
        actorRole:'SYSTEM',actorId:null,fromStatus:'APPROVED',
        toStatus:'CONFIRMED',amountDelta:amount,
        notes:'Signed Safepay payment.refunded event '+eventId,
        metadata:{event_id:eventId,tracker,refund_state:data.state}
      });
      await conn.commit();
      return {success:true,duplicate:false,status:'PROCESSED',refund_id:refund.id};
    }catch(e){await conn.rollback();throw e;}
    finally{conn.release();}
  }
}
module.exports=new SafepayRefundWebhookService();
module.exports.parseSignedPayload=parseSignedPayload;
module.exports.safeMoneyFromMinorUnits=safeMoneyFromMinorUnits;
