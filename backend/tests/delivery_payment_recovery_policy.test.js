'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {initializationDisposition}=require('../src/services/procurementDeliveryPaymentPolicy');
test('only definite provider rejection without a returned tracker permits a new attempt',()=>{for(const code of [400,401,403,404,422])assert.equal(initializationDisposition({providerStatusCode:code},null),'DEFINITELY_REJECTED');});
test('timeout, ambiguous response or any known tracker requires reconciliation without another charge',()=>{for(const error of [{code:'ETIMEDOUT'},{providerStatusCode:408},{providerStatusCode:409},{providerStatusCode:429},{providerStatusCode:500},{}])assert.equal(initializationDisposition(error,null),'RECONCILIATION_REQUIRED');assert.equal(initializationDisposition({providerStatusCode:400},'track_known'),'RECONCILIATION_REQUIRED');});
