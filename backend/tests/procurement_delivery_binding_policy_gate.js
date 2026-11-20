'use strict';
const assert=require('node:assert/strict');
const {snapshotDeliveryTerms,assertDeliveryConsent}=require('../src/services/procurementDeliveryBindingPolicy');
const row={quote_code:'DLV-QTE-TEST',buyer_id:5,supplier_id:2,cluster_id:3,mode:'PICKUP',
  pickup_point_id:7,quoted_delivery_fee_pkr:'25.00',supplier_config_version:2,
  expires_at:new Date('2026-12-01T00:00:00Z')};
const terms=snapshotDeliveryTerms(row);
assert.equal(terms.fee,'25.00');
assert.match(terms.hash,/^[a-f0-9]{64}$/);
assert.equal(snapshotDeliveryTerms({...row,full_address:'private'}).hash,terms.hash);
assert.equal(Object.hasOwn(terms,'full_address'),false);
assert.equal(Object.hasOwn(terms,'buyer_id'),false);
assert.throws(()=>assertDeliveryConsent(terms,null),error=>error.code==='DELIVERY_REAPPROVAL_REQUIRED');
assert.throws(()=>assertDeliveryConsent(terms,'changed'),error=>error.code==='DELIVERY_REAPPROVAL_REQUIRED');
assertDeliveryConsent(terms,terms.hash);
assert.notEqual(snapshotDeliveryTerms({...row,quoted_delivery_fee_pkr:'26.00'}).hash,terms.hash);
assert.throws(()=>snapshotDeliveryTerms({...row,mode:'INVENTED'}),error=>error.code==='INVALID_DELIVERY_TERMS');
assert.throws(()=>snapshotDeliveryTerms({...row,mode:'EXPRESS',pickup_point_id:null}),error=>error.code==='VERIFIED_DELIVERY_DESTINATION_REQUIRED');
const {buildAwardPreview}=require('../src/services/procurementAwardPolicy');
const selection={request_item_id:1,quote_id:10,version_number:1,supplier_sku_id:11,product_spec_id:21,physical_specifications_accepted:true,delivery_terms_hash:terms.hash};
const basket={requestItems:[{id:1,quantity:'1',unit:'bag'}],quoteVersions:[{quote_id:10,supplier_id:2,version_number:1,status:'ACTIVE',valid_until:'2026-12-01T00:00:00Z',delivery_fee:'25.00',delivery_terms:terms,
  lines:[{request_item_id:1,supplier_listing_id:100,quantity:'1',unit_price:'100.00',snapshot:{supplier_sku_id:11,product_spec_id:21,purchasing_unit:'bag'}}]}],now:'2026-11-01T00:00:00Z'};
assert.equal(buildAwardPreview({...basket,selections:[selection]}).groups[0].delivery_terms.hash,terms.hash);
assert.throws(()=>buildAwardPreview({...basket,selections:[{...selection,delivery_terms_hash:undefined}]}),error=>error.code==='DELIVERY_REAPPROVAL_REQUIRED');
console.log('PASS delivery hash, exact fee, private payload, explicit consent, stale terms and invalid destination');
