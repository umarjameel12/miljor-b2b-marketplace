'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {aggregateCapacity,assertGroupFunding}=require('../src/services/procurementCollectiveCommitmentPolicy');
test('shared listing quantities are exact and incompatible units fail closed',()=>{
 assert.deepEqual(aggregateCapacity([{supplier_listing_id:2,quantity:'1.1',purchasing_unit:'kg'},{supplier_listing_id:2,quantity:'2.2',purchasing_unit:'kg'}]),[{listing_id:2,quantity:'3.3000',unit:'kg'}]);
 assert.throws(()=>aggregateCapacity([{supplier_listing_id:2,quantity:'1',purchasing_unit:'bag'},{supplier_listing_id:2,quantity:'1',purchasing_unit:'kg'}]));
});
test('every qualified member must be funded; paid peers cannot release others',()=>{
 assert.throws(()=>assertGroupFunding(2,[{status:'ORDERED',payment_status:'PAID'},{status:'HELD',payment_status:null}]),e=>e.code==='GROUP_FUNDING_INCOMPLETE');
 assert.throws(()=>assertGroupFunding(2,[{status:'ORDERED',payment_status:'PAID'}]));
 assert.equal(assertGroupFunding(2,[{status:'ORDERED',payment_status:'PAID'},{status:'ORDERED',payment_status:'PAID'}]),true);
});
