'use strict';
const assert = require('node:assert/strict');
const {calculateShortage} = require('../src/services/deliveryQuantityPolicy');
let passed = 0;
const verify = (name, fn) => {fn();passed++;console.log('PASS '+passed+': '+name)};
const rejects=(ordered,received,code)=>{
  assert.throws(()=>calculateShortage(ordered,received),
    err=>err && err.code===code && err.statusCode===422);
};
verify('100 ordered / 80 received / 20 short exact',()=>{
  assert.deepEqual(calculateShortage('100','80'),{
    ordered_quantity:'100.00',received_quantity:'80.00',short_quantity:'20.00'
  });
});
verify('exact fractional shortage',()=>{
  assert.deepEqual(calculateShortage('100.25','80.10'),{
    ordered_quantity:'100.25',received_quantity:'80.10',short_quantity:'20.15'
  });
});
verify('zero received allowed as documented non-delivery',()=>{
  assert.equal(calculateShortage('100',0).short_quantity,'100.00');
});
verify('over-received rejected',()=>rejects('100','100.01','RECEIVED_QUANTITY_EXCEEDS_ORDER'));
verify('no shortage cannot be reported',()=>rejects('100','100','NO_QUANTITY_SHORTAGE'));
verify('negative input rejected',()=>rejects('100','-1','INVALID_DELIVERY_QUANTITY'));
verify('MySQL four-decimal quantities are exact',()=>{
  assert.equal(calculateShortage('100.0000','80.0001').short_quantity,'19.9999');
});
verify('precision overflow rejected',()=>rejects('100','80.00001','INVALID_DELIVERY_QUANTITY'));
verify('scientific notation rejected',()=>rejects('100','8e1','INVALID_DELIVERY_QUANTITY'));
verify('non-numeric input rejected',()=>rejects('100','NaN','INVALID_DELIVERY_QUANTITY'));
verify('empty input rejected',()=>rejects('100','','INVALID_DELIVERY_QUANTITY'));
verify('quantity beyond supported precision rejected',()=>rejects('100','1234567890123','INVALID_DELIVERY_QUANTITY'));
verify('zero quantity order rejected',()=>rejects('0','0','INVALID_ORDER_QUANTITY'));
verify('returned object is immutable',()=>{
  assert.ok(Object.isFrozen(calculateShortage('100','80')));
});
console.log('DELIVERY QUANTITY POLICY: '+passed+'/'+passed+' PASS (pure deterministic tests, no MySQL)');
