'use strict';

// Smart Procurement Hub: structured, product-wise buyer counteroffers.
// This pure policy module never handles messages, delivery addresses or payment.
const error=(code,message)=>Object.assign(new Error(message),{code,statusCode:400});
const decimal=(input,label)=>{
  if(typeof input!=='string'&&typeof input!=='number')throw error('INVALID_COUNTER_PRICE',label+' must be a decimal amount');
  const value=String(input);
  if(!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value))throw error('INVALID_COUNTER_PRICE',label+' must have at most two decimal places');
  const [whole,fraction='']=value.split('.');
  const cents=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  if(cents<=0n)throw error('INVALID_COUNTER_PRICE',label+' must be greater than zero');
  return {cents,value:whole+'.'+fraction.padEnd(2,'0')};
};
const positiveId=value=>{
  if(!/^[1-9]\d*$/.test(String(value))||!Number.isSafeInteger(Number(value)))throw error('INVALID_COUNTER_ITEM','A valid selected product identifier is required');
  return Number(value);
};
function validateProductCounteroffers(input,quotedLines){
  if(!input||typeof input!=='object'||Array.isArray(input)||!Array.isArray(input.lines))
    throw error('INVALID_COUNTEROFFER','Selected product counteroffers are required');
  if(Object.keys(input).some(field=>field!=='lines'))throw error('UNSUPPORTED_COUNTER_FIELD','Only selected product prices are allowed; chat and free-text messages are disabled');
  if(!Array.isArray(quotedLines)||quotedLines.length===0)throw error('EMPTY_QUOTATION','A current quotation is required');
  if(input.lines.length<1||input.lines.length>quotedLines.length)
    throw error('INVALID_COUNTEROFFER','Choose one or more quoted products');
  const available=new Map(quotedLines.map(line=>[positiveId(line.request_item_id),line]));
  const seen=new Set();
  return input.lines.map(line=>{
    if(!line||typeof line!=='object'||Array.isArray(line))throw error('INVALID_COUNTEROFFER','Invalid product counteroffer');
    if(Object.keys(line).some(field=>!['request_item_id','proposed_unit_price'].includes(field)))throw error('UNSUPPORTED_COUNTER_FIELD','Counteroffers support product ID and numeric price only');
    const requestItemId=positiveId(line.request_item_id);
    if(seen.has(requestItemId))throw error('DUPLICATE_COUNTER_ITEM','Only one counteroffer per selected product is allowed');
    seen.add(requestItemId);
    const quoted=available.get(requestItemId);
    if(!quoted)throw error('UNQUOTED_COUNTER_ITEM','Counteroffers are allowed only for quoted products');
    const requested=decimal(line.proposed_unit_price,'Counteroffer price');
    const current=decimal(quoted.unit_price,'Quoted price');
    if(requested.cents===current.cents)throw error('UNCHANGED_COUNTER_PRICE','Counteroffer must change the quoted product price');
    if(requested.cents>current.cents)throw error('COUNTER_PRICE_ABOVE_QUOTE','Buyer counteroffer cannot increase the quoted price');
    return {request_item_id:requestItemId,quoted_unit_price:current.value,proposed_unit_price:requested.value};
  });
}
const SUPPLIER_DECISIONS=Object.freeze(['ACCEPT','REJECT','COUNTER_AGAIN']);
function validateSupplierDecision(input,selectedLine){
  if(!input||!SUPPLIER_DECISIONS.includes(input.decision))throw error('INVALID_COUNTER_DECISION','Choose Accept, Reject or Counter Again');
  if(!selectedLine||!selectedLine.request_item_id)throw error('COUNTER_ITEM_NOT_FOUND','Selected negotiation product not found');
  if(input.decision==='COUNTER_AGAIN'){
    const amount=decimal(input.proposed_unit_price,'Supplier counter price');
    return {decision:input.decision,request_item_id:positiveId(selectedLine.request_item_id),proposed_unit_price:amount.value};
  }
  if(input.proposed_unit_price!==undefined&&input.proposed_unit_price!==null)
    throw error('UNEXPECTED_COUNTER_PRICE','Only Counter Again accepts a new product price');
  return {decision:input.decision,request_item_id:positiveId(selectedLine.request_item_id)};
}
module.exports={validateProductCounteroffers,validateSupplierDecision,SUPPLIER_DECISIONS};
