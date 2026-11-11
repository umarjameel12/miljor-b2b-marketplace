'use strict';
// Supplier may receive an authorized commercial invoice, but not direct buyer
// contact details from the retained internal accounting snapshot.
function projectInvoiceForActor(invoice,role){
 if(!invoice||role!=='SUPPLIER')return invoice;
 let snapshot=invoice.invoice_snapshot_json;
 if(typeof snapshot==='string'){
  try{snapshot=JSON.parse(snapshot)}
  catch{
   const err=new Error('Stored invoice snapshot is unreadable.');
   err.code='INVOICE_SNAPSHOT_INVALID';err.statusCode=409;throw err;
  }
 }
 if(!snapshot||Array.isArray(snapshot)||typeof snapshot!=='object'){
  const err=new Error('Stored invoice snapshot is invalid.');
  err.code='INVOICE_SNAPSHOT_INVALID';err.statusCode=409;throw err;
 }
 const buyer=snapshot.buyer||{};
 return {
  ...invoice,
  invoice_snapshot_json:{
   ...snapshot,
   buyer:{
    id:buyer.id,
    business_name:buyer.business_name
   }
  }
 };
}
module.exports={projectInvoiceForActor};
