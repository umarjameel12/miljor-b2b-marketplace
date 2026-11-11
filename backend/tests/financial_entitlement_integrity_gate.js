'use strict';
// Deferred final acceptance gate; deterministic unit checks, no DB mutations.
const assert = require('node:assert/strict');
const feeService = require('../src/services/feeService');
const entitlementService = require('../src/services/subscriptionEntitlementService');

const supplierConnection = {
  async query(sql) {
    assert.match(sql, /supplier_profiles/);
    return [[]];
  }
};
async function run(){
  await assert.rejects(
    feeService.calculateSupplierFeeExact(100,'5000.00',supplierConnection),
    error=>error.code==='SUPPLIER_PROFILE_REQUIRED'&&error.statusCode===422
  );
  const unknownPlanConn = {
    async query(sql) {
      if(sql.includes('FROM supplier_profiles sp'))return [[{
        supplier_id:10,subscription_plan:'BROKEN_UNKNOWN_PLAN',
        subscription_status:'ACTIVE',verification_status:'VERIFIED',
        max_active_listings:4
      }]];
      throw new Error('Unknown plan should be rejected before reading family records');
    }
  };
  await assert.rejects(
    entitlementService.getSupplierEntitlements(10,unknownPlanConn),
    error=>error.code==='UNKNOWN_SUBSCRIPTION_PLAN'&&error.statusCode===409
  );
  const familyConn={
    async query(sql){
      if(sql.includes('FROM supplier_profiles sp'))return [[{
        supplier_id:10,subscription_plan:'STARTER',
        subscription_status:'STARTER_ACTIVE',verification_status:'VERIFIED',
        max_active_listings:4
      }]];
      if(sql.includes('SELECT DISTINCT family_id'))return [[
        {family_id:'7'},{family_id:7},{family_id:'8'}
      ]];
      if(sql.includes('COUNT(*) as activeCount'))return [[{activeCount:3}]];
      if(sql.includes('FROM subscription_plans'))return [[]];
      throw Error('Unexpected SQL in entitlement gate');
    }
  };
  const view=await entitlementService.getSupplierEntitlements(10,familyConn);
  assert.deepEqual(view.active_family_ids,[7,8]);
  assert.equal(view.active_families_count,2);
  const goodSupplierConn={async query(){return [[{transaction_fee_percent:'2.50'}]];}};
  const fee=await feeService.calculateSupplierFeeExact(10,'100.00',goodSupplierConn);
  assert.equal(fee.supplier_fee,'2.50');
  assert.equal(fee.supplier_net_payout,'97.50');
  console.log('Financial and entitlement fail-closed unit gate passed.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
