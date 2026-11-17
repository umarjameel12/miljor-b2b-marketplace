'use strict';
const exact=require('./exactDecimal');
const fail=(code,message)=>Object.assign(Error(message),{code,statusCode:409});
function aggregateCapacity(lines){
 const totals=new Map();
 for(const line of lines){
  const listing=Number(line.supplier_listing_id),unit=String(line.purchasing_unit).toLowerCase(),quantity=exact.toCanonical(line.quantity,4);
  if(!Number.isSafeInteger(listing)||listing<1||!exact.exactDecimalGte(quantity,'0.0001',4)||(['bag','tin','carton','sack','bundle','pack'].includes(unit)&&!/^\d+\.0000$/.test(quantity)))throw fail('INVALID_GROUP_CAPACITY','Invalid exact physical quantity');
  const prior=totals.get(listing);
  if(prior&&prior.unit!==unit)throw fail('GROUP_CAPACITY_UNIT_MISMATCH','Shared listing units must match');
  totals.set(listing,{listing_id:listing,unit,quantity:exact.exactDecimalSum([prior?.quantity||'0.0000',quantity],4)});
 }
 return [...totals.values()].sort((a,b)=>a.listing_id-b.listing_id);
}
function assertGroupFunding(expected,rows){
 if(!Number.isSafeInteger(Number(expected))||Number(expected)<2||rows.length!==Number(expected)||rows.some(row=>row.status!=='ORDERED'||row.payment_status!=='PAID'))throw fail('GROUP_FUNDING_INCOMPLETE','All independently approved group orders must be verified paid before supplier preparation. No peer is automatically charged or repriced.');
 return true;
}
module.exports={aggregateCapacity,assertGroupFunding};
