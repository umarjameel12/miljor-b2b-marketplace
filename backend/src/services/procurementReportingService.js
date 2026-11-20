'use strict';

// Read-only R5 projection. No invoice generation, provider calls or money movement.
// One SELECT gives a consistent statement snapshot and one row per supplier order.
const db=require('../config/db');
const fail=(code,message,statusCode)=>Object.assign(new Error(message),{code,statusCode});
const timestamp=value=>{
  if(value==null)return null;
  if(value instanceof Date)return Number.isFinite(value.getTime())?value.getTime():null;
  let text=String(value);
  if(/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?$/.test(text))text=text.replace(' ','T')+'Z';
  if(!/(Z|[+-]\d\d:\d\d)$/i.test(text))return null;
  const result=Date.parse(text);
  return Number.isFinite(result)?result:null;
};
function windowFor(row){
  // Buyer choices only become scorable when the owning supplier confirms a
  // matching run. A proposed run or preference alone is not a promised window.
  if(Number(row.delivery_confirmed)!==1||!['STANDARD_CLUSTERED','INDIVIDUAL','EXPRESS'].includes(row.mode))return null;
  const day=row.delivery_day instanceof Date?row.delivery_day.toISOString().slice(0,10):String(row.delivery_day||'');
  if(!/^\d{4}-\d\d-\d\d$/.test(day))return null;
  const date=Date.parse(day+'T00:00:00Z');
  if(!Number.isFinite(date)||new Date(date).toISOString().slice(0,10)!==day)return null;
  const parts=/^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/.exec(row.delivery_window||'');
  if(!parts)return null;
  const start=timestamp(`${day}T${parts[1]}:${parts[2]}:00+05:00`);
  const end=timestamp(`${day}T${parts[3]}:${parts[4]}:00+05:00`);
  return start!=null&&end>start?{start,end}:null;
}
class ProcurementReportingService{
  constructor(database=db){this.database=database;}
  async getReport(actor,{now=new Date()}={}){
    if(!actor||!['BUYER','SUPPLIER'].includes(actor.role)||
      !/^[1-9]\d*$/.test(String(actor.id))||!Number.isSafeInteger(Number(actor.id)))
      throw fail('REPORT_ACCESS_FORBIDDEN','A buyer or supplier account is required.',403);
    const asOf=timestamp(now);
    if(asOf==null)throw fail('INVALID_REPORT_TIME','Invalid report timestamp.',400);
    const ownerColumn=actor.role==='BUYER'?'buyer_id':'supplier_id';
    const [rows]=await this.database.query(
      `SELECT o.id AS order_id,o.payment_status,o.order_status,o.fulfillment_status,
        o.exception_reason,o.supplier_delivered_at,d.delivery_day,d.delivery_window,d.mode,
        EXISTS(SELECT 1 FROM procurement_delivery_stops ds
          JOIN procurement_delivery_runs dr ON dr.id=ds.run_id
          WHERE ds.order_id=o.id AND ds.buyer_id=o.buyer_id
            AND dr.supplier_id=o.supplier_id
            AND (dr.status IN ('CONFIRMED','DISPATCHED','DELIVERED') OR EXISTS(
              SELECT 1 FROM procurement_delivery_run_events re WHERE re.run_id=dr.id AND re.event_type='ROUTE_CONFIRMED'))
            AND dr.delivery_day=d.delivery_day
            AND SUBSTRING_INDEX(dr.delivery_window,'-',1)>=SUBSTRING_INDEX(d.delivery_window,'-',1)
            AND SUBSTRING_INDEX(dr.delivery_window,'-',-1)<=SUBSTRING_INDEX(d.delivery_window,'-',-1)
            AND dr.mode=d.mode
        ) AS delivery_confirmed,
        (SELECT COUNT(*) FROM procurement_award_lines al
          WHERE al.award_order_id=ao.id AND al.award_id=a.id) AS line_count,
        (SELECT COUNT(*) FROM invoices i WHERE i.order_id=o.id
          AND i.buyer_id=o.buyer_id AND i.supplier_id=o.supplier_id) AS invoice_count,
        (SELECT MIN(e.created_at) FROM order_fulfillment_events e WHERE e.order_id=o.id
          AND e.to_status='SUPPLIER_DELIVERED' AND e.actor_role='SUPPLIER'
          AND e.actor_id=o.supplier_id) AS event_delivered_at,
        (EXISTS(SELECT 1 FROM procurement_line_receipts lr WHERE lr.order_id=o.id AND lr.disputed_quantity>0)
        OR EXISTS(SELECT 1 FROM order_fulfillment_events e WHERE e.order_id=o.id
          AND e.action='REPORT_BUYER_DISCREPANCY' AND e.actor_role='BUYER'
          AND e.actor_id=o.buyer_id
          AND JSON_UNQUOTE(JSON_EXTRACT(e.metadata,'$.reason'))='QUANTITY_MISMATCH'
          AND CAST(JSON_UNQUOTE(JSON_EXTRACT(e.metadata,'$.short_quantity')) AS DECIMAL(16,4))>0
        )) AS has_partial
       FROM orders o
       JOIN procurement_award_orders ao ON ao.order_id=o.id AND ao.supplier_id=o.supplier_id
       JOIN procurement_awards a ON a.id=ao.award_id AND a.buyer_id=o.buyer_id
       LEFT JOIN procurement_order_delivery_choices d ON d.order_id=o.id
         AND d.buyer_id=o.buyer_id AND d.supplier_id=o.supplier_id
       WHERE o.${ownerColumn}=?`,[Number(actor.id)]);
    const reliability={total_orders:rows.length,denominator:0,on_time:0,early:0,late:0,
      partial:0,missed:0,cancelled:0,pending:0,unscorable:0,unpaid:0,exceptions:0};
    const evidence={award_lines:0,orders_with_invoice:0};
    for(const row of rows){
      evidence.award_lines+=Number(row.line_count)||0;
      if(Number(row.invoice_count)>0)evidence.orders_with_invoice++;
      if(row.order_status==='CANCELLED'){reliability.cancelled++;continue;}
      if(row.payment_status!=='PAID'){reliability.unpaid++;continue;}
      if(Number(row.has_partial)===1){reliability.partial++;continue;}
      if(row.fulfillment_status==='EXCEPTION'){
        if(row.exception_reason==='DELIVERY_NOT_RECEIVED')reliability.missed++;
        else reliability.exceptions++;
        continue;
      }
      const window=windowFor(row);
      if(!window){reliability.unscorable++;continue;}
      const delivered=timestamp(row.supplier_delivered_at)||timestamp(row.event_delivered_at);
      if(delivered!=null){
        if(delivered<window.start)reliability.early++;
        else if(delivered<=window.end)reliability.on_time++;
        else reliability.late++;
      }else if(asOf>window.end)reliability.missed++;
      else reliability.pending++;
    }
    // Partial/missed/exception counts describe outcomes even without a window;
    // only outcomes with supplier-confirmed windows enter the denominator.
    const scorable=rows.filter(row=>row.order_status!=='CANCELLED'&&row.payment_status==='PAID'&&windowFor(row));
    reliability.denominator=scorable.filter(row=>Number(row.has_partial)===1||row.fulfillment_status==='EXCEPTION'||
      timestamp(row.supplier_delivered_at)!=null||timestamp(row.event_delivered_at)!=null||asOf>windowFor(row).end).length;
    reliability.on_time_percent=reliability.denominator?Math.round(reliability.on_time/reliability.denominator*10000)/100:null;
    return {scope:actor.role==='BUYER'?'OWN_BUYER_ORDERS':'OWN_SUPPLIER_ORDERS',
      period:'ALL_RECORDED_PROCUREMENT_ORDERS',as_of:new Date(asOf).toISOString(),reliability,evidence,
      methodology:{unit:'One supplier order; lines, events and invoices never multiply the denominator.',
        denominator:'Paid, non-cancelled orders with a supplier-confirmed delivery window and a delivery, partial/exception outcome, or elapsed deadline. Future unresolved orders are excluded.',
        on_time:'Supplier-reported delivery inside the inclusive supplier-confirmed window, without recorded shortage or unresolved exception; this does not prove buyer receipt.',
        windows:'Buyer choices require an order stop on a supplier-confirmed run on the same day and mode, with a route window contained within the approved window. Confirmation history survives route exceptions. Times use Asia/Karachi (UTC+05:00). Unconfirmed, missing, invalid and pickup windows are unscorable.',
        partial:'A final per-line disputed receipt or recorded buyer shortage remains partial, including later resolved shortages.',
        missed:'Buyer reported DELIVERY_NOT_RECEIVED, or supplier-confirmed deadline elapsed without a recorded supplier delivery.',
        exclusions:'Cancelled and unpaid orders are excluded. Partial/missed/exception outcomes without a valid window remain visible but are excluded from the rate.'},
      savings:{status:'UNAVAILABLE',percent:null,amount:null,currency:'PKR',
        reason:'No recorded comparable baseline ties the same specification, quantity, time window and all-in cost to these purchases. Award prices and invoices alone do not establish savings.'}};
  }
}
module.exports=new ProcurementReportingService();
module.exports.ProcurementReportingService=ProcurementReportingService;
