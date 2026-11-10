'use strict';

/**
 * MilJor B6-G/H: EXACT, read-only award assembly.
 * Buyer must explicitly choose a quotation VERSION and physical SKU for every
 * item. This is not inventory reservation, order creation or payment authority.
 */
const exact = require('./exactDecimal');

const failure = (code, message) => Object.assign(new Error(message),{code,statusCode:400});
const id = (v, label) => {
  if(v == null || typeof v==='boolean' || !/^[1-9]\d*$/.test(String(v)) ||
     !Number.isSafeInteger(Number(v))) throw failure('INVALID_AWARD_ID',label+' must be a positive integer.');
  return Number(v);
};
const amount = (v, label) => {
  try{
    const value=exact.toCanonical(v,2);
    if(value.split('.')[0].length>12 || !exact.exactDecimalGte(value,'0.00',2))
      throw Error('range');
    return value;
  }catch{throw failure('INVALID_AWARD_AMOUNT',label+' must be a nonnegative, exact PKR amount.');}
};
const quantity=v=>{
  try{
    const q=exact.toCanonical(v,4);
    if(!exact.exactDecimalGte(q,'0.0001',4))throw Error('range');
    return q;
  }catch{throw failure('INVALID_AWARD_QUANTITY','Requested quantity is invalid.');}
};
const isoDate = v => {
  if(typeof v!=='string' || !/(?:Z|[+-]\d\d:\d\d)$/i.test(v))return null;
  const t=Date.parse(v);
  return Number.isFinite(t)?t:null;
};
const validSnapshot = value => value && typeof value==='object' &&
  id(value.supplier_sku_id,'Supplier SKU') && id(value.product_spec_id,'Physical specification');

function buildAwardPreview({requestItems,quoteVersions,selections,now=new Date().toISOString()}){
  if(!Array.isArray(requestItems)||!requestItems.length||requestItems.length>50)
    throw failure('INVALID_REQUEST_ITEMS','Request must contain 1–50 items.');
  if(!Array.isArray(quoteVersions)||!quoteVersions.length||quoteVersions.length>30)
    throw failure('INVALID_AWARD_QUOTES','At least one quotation is required.');
  if(!Array.isArray(selections)||selections.length!==requestItems.length)
    throw failure('INCOMPLETE_AWARD_COVERAGE','Choose exactly one quotation per shopping-list line.');
  const clock=isoDate(now);
  if(clock===null)throw failure('INVALID_AWARD_CLOCK','Use a timezone-aware server clock.');
  const items=new Map();
  for(const item of requestItems){
    const key=id(item.id,'Request item');
    if(items.has(key))throw failure('DUPLICATE_REQUEST_ITEM','Request contains a duplicate item ID.');
    items.set(key,{...item,normalized_qty:quantity(item.quantity),
      normalized_unit:String(item.unit||'').toLowerCase()});
  }
  const quotes=new Map();
  for(const quote of quoteVersions){
    const key=id(quote.quote_id,'Quote');
    if(quotes.has(key))throw failure('DUPLICATE_QUOTE','Supplier quotation IDs must be unique.');
    const version=id(quote.version_number,'Quote version');
    const expiration=isoDate(quote.valid_until);
    if(quote.status!=='ACTIVE'||expiration===null||expiration<=clock)
      continue; // Buyer cannot award withdrawn or expired quotes.
    const supplier=id(quote.supplier_id,'Supplier');
    if(!Array.isArray(quote.lines)||!quote.lines.length)
      throw failure('INVALID_QUOTE_LINES','Quotation contains no item lines.');
    quotes.set(key,{...quote,version_number:version,supplier_id:supplier,
      fee:amount(quote.delivery_fee,'Supplier delivery fee'),
      lines:new Map(quote.lines.map(line=>[id(line.request_item_id,'Quoted request item'),line]))});
  }
  const bySupplier=new Map();
  const byItem=new Set();
  const result=[];
  for(const selection of selections){
    const itemId=id(selection?.request_item_id,'Selected request item');
    if(byItem.has(itemId))throw failure('DUPLICATE_AWARD_LINE','A shopping-list line can be awarded only once.');
    byItem.add(itemId);
    const item=items.get(itemId);
    if(!item)throw failure('FOREIGN_AWARD_ITEM','Cannot select a line outside this request.');
    const quoteId=id(selection.quote_id,'Quote');
    const quote=quotes.get(quoteId);
    if(!quote)throw failure('QUOTE_NOT_AVAILABLE','Selected quotation is withdrawn, expired, or unavailable.');
    if(Number(selection.version_number)!==quote.version_number)
      throw failure('QUOTE_VERSION_CHANGED','Supplier quote changed; refresh before accepting.');
    const line=quote.lines.get(itemId);
    if(!line)throw failure('QUOTE_NOT_COVERING_ITEM','Selected supplier did not quote this item.');
    if(!exact.exactDecimalEquals(item.normalized_qty,line.quantity,4) ||
       item.normalized_unit!==String(line.snapshot?.purchasing_unit||'').toLowerCase())
      throw failure('AWARD_PHYSICAL_MISMATCH','Quantity or purchasing unit differs from buyer request.');
    let snapshot;
    try{snapshot=validSnapshot(line.snapshot)?line.snapshot:null;}catch{snapshot=null;}
    if(!snapshot)throw failure('PHYSICAL_SPEC_NOT_VERIFIED','Quote is missing a physical SKU or approved specification ID.');
    if(Number(selection.supplier_sku_id)!==Number(snapshot.supplier_sku_id) ||
       Number(selection.product_spec_id)!==Number(snapshot.product_spec_id))
      throw failure('SPECIFICATION_REAPPROVAL_REQUIRED','Physical SKU/spec changed; buyer must review and reapprove.');
    if(selection.physical_specifications_accepted!==true)
      throw failure('EXPLICIT_SPEC_CONSENT_REQUIRED','Buyer must review and accept the exact grade and packaging.');
    const unitPrice=amount(line.unit_price,'Quotation unit price');
    if(!exact.exactDecimalGte(unitPrice,'0.01',2))
      throw failure('INVALID_AWARD_AMOUNT','Unit price must be positive.');
    const subtotal=exact.exactMultiplyRound(item.normalized_qty,unitPrice,2);
    let group=bySupplier.get(quote.supplier_id);
    if(group && group.quote_id!==quoteId)
      throw failure('MULTIPLE_QUOTES_SAME_SUPPLIER','Select one authoritative quote per supplier.');
    if(!group){
      group={supplier_id:quote.supplier_id,quote_id:quoteId,
        version_number:quote.version_number,delivery_fee:quote.fee,lines:[]};
      bySupplier.set(quote.supplier_id,group);
    }
    const entry={request_item_id:itemId,quote_id:quoteId,supplier_id:quote.supplier_id,
      supplier_sku_id:Number(snapshot.supplier_sku_id),
      product_spec_id:Number(snapshot.product_spec_id),
      quantity:item.normalized_qty,unit:item.normalized_unit,unit_price:unitPrice,subtotal,
      supplier_sku_snapshot:snapshot,buyer_requirements:item.requirements||null};
    group.lines.push(entry);
    result.push(entry);
  }
  if(byItem.size!==items.size)throw failure('INCOMPLETE_AWARD_COVERAGE','Every item requires one selected quote.');
  const groups=[...bySupplier.values()].sort((a,b)=>a.supplier_id-b.supplier_id);
  for(const group of groups){
    group.item_subtotal=exact.exactDecimalSum(group.lines.map(x=>x.subtotal),2);
    group.supplier_quote_total=exact.exactDecimalSum([group.item_subtotal,group.delivery_fee],2);
  }
  const itemsTotal=exact.exactDecimalSum(groups.map(x=>x.item_subtotal),2);
  const deliveryTotal=exact.exactDecimalSum(groups.map(x=>x.delivery_fee),2);
  const quoteTotal=exact.exactDecimalSum([itemsTotal,deliveryTotal],2);
  return {
    status:'PREVIEW_ONLY',supplier_count:groups.length,
    order_count_if_accepted:groups.length,item_count:result.length,
    groups,item_subtotal:itemsTotal,supplier_delivery_total:deliveryTotal,
    supplier_quoted_total:quoteTotal,
    buyer_platform_fee_calculated:false,
    sales_tax_calculated:false,
    final_payable_authorized:false,
    inventory_reserved:false,
    checkout_started:false,
    warning:'Only a price and SKU preflight. B6-G/H transaction must lock stock, calculate authoritative fees and obtain fresh buyer consent.'
  };
}
module.exports={buildAwardPreview};
