'use strict';
// Precise B6 award-line shortage calculation; no claim is financially executable.
const exact=require('./exactDecimal');
function failure(code,message){const e=new Error(message);e.code=code;e.statusCode=422;return e;}
function units4(value){
 const x=exact.toCanonical(value,4);
 if(x.startsWith('-'))throw failure('INVALID_LINE_QUANTITY','Quantity cannot be negative');
 const [i,f]=x.split('.');
 return BigInt(i)*10000n+BigInt(f);
}
function shortageForAwardLine({ordered_quantity,received_quantity,locked_unit_price}){
 let ordered,received;
 try{ordered=units4(ordered_quantity);received=units4(received_quantity)}
 catch(e){if(e.code)throw e;throw failure('INVALID_LINE_QUANTITY','Invalid fixed-scale physical quantity')}
 if(ordered<=0n||received>ordered)
  throw failure('RECEIVED_QUANTITY_OUT_OF_RANGE','Received quantity must be within 0 and the awarded quantity.');
 const shortage=ordered-received;
 const asQty=n=>(n/10000n).toString()+'.'+(n%10000n).toString().padStart(4,'0');
 const price=exact.toCanonical(locked_unit_price,2);
 if(!exact.exactDecimalGte(price,'0',2))
  throw failure('INVALID_LOCKED_LINE_PRICE','Invalid accepted SKU unit price.');
 if(shortage===0n)
  throw failure('NO_SHORT_DELIVERY','No missing quantity was reported.');
 return {
  expected_quantity:asQty(ordered),
  received_quantity:asQty(received),
  disputed_quantity:asQty(shortage),
  claimed_amount:exact.exactMultiplyRound(asQty(shortage),price,2),
  unit_price:price
 };
}
module.exports={shortageForAwardLine};
