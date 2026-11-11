'use strict';
// Immutable B6 award-line invoice projection. Each supplier receives its own
// order/invoice; mixed physical units are never aggregated into order.total_qty.
const exact=require('./exactDecimal');
function problem(code,message){
 const e=new Error(message);e.code=code;e.statusCode=409;return e;
}
function buildAwardInvoiceLines(order,rows){
 if(!Array.isArray(rows)||rows.length===0)
  throw problem('AWARD_INVOICE_LINES_MISSING','A B6 procurement order must have immutable award lines.');
 const ids=new Set();
 const items=rows.map(line=>{
  const id=Number(line.id);
  if(!Number.isSafeInteger(id)||id<=0||ids.has(id))
   throw problem('AWARD_INVOICE_DUPLICATE_LINE','Invalid or duplicate award line');
  ids.add(id);
  const quantity=exact.toCanonical(line.quantity,4);
  const unitPrice=exact.toCanonical(line.unit_price,2);
  const subtotal=exact.toCanonical(line.subtotal,2);
  if(!exact.exactDecimalGt(quantity,'0',4))
   throw problem('AWARD_INVOICE_QUANTITY','Award quantity must be positive.');
  if(!exact.exactDecimalGte(unitPrice,'0',2))
   throw problem('AWARD_INVOICE_PRICE','Award unit price must be nonnegative.');
  const unit=String(line.purchasing_unit||'').trim();
  if(!unit||unit.length>40)
   throw problem('AWARD_INVOICE_UNIT','Original purchasing unit missing.');
  let sku={};
  if(typeof line.immutable_sku_snapshot==='string'){
   try{sku=JSON.parse(line.immutable_sku_snapshot)}
   catch{throw problem('AWARD_INVOICE_SKU_SNAPSHOT','Immutable product snapshot is invalid.')}
  }else if(line.immutable_sku_snapshot&&typeof line.immutable_sku_snapshot==='object'){
   sku=line.immutable_sku_snapshot;
  }
  const title=typeof sku.title==='string'&&sku.title.trim()?sku.title.trim():
   typeof sku.variant_title==='string'&&sku.variant_title.trim()?sku.variant_title.trim():
   'Supplier SKU #'+String(line.supplier_sku_id);
  return {
   award_line_id:id,request_item_id:Number(line.request_item_id),
   supplier_sku_id:Number(line.supplier_sku_id),
   description:title,
   quantity,unit,unit_price:unitPrice,line_total:subtotal,
   specification_snapshot:sku
  };
 });
 const calculated=exact.exactDecimalSum(items.map(x=>x.line_total),2);
 const locked=exact.toCanonical(order.subtotal_amount,2);
 if(!exact.exactDecimalEquals(calculated,locked,2))
  throw problem('AWARD_INVOICE_SUBTOTAL_MISMATCH','Award line totals differ from the accepted supplier order subtotal.');
 const delivery=exact.toCanonical(order.delivery_fee||'0',2);
 const fee=exact.toCanonical(order.buyer_platform_fee||'0',2);
 const total=exact.exactDecimalSum([calculated,delivery,fee],2);
 if(!exact.exactDecimalEquals(total,order.total_amount,2))
  throw problem('AWARD_INVOICE_TOTAL_MISMATCH','Supplier order fees do not reconcile with accepted total.');
 return items;
}
module.exports={buildAwardInvoiceLines};
