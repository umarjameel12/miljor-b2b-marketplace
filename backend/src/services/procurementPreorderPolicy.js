'use strict';

// B6-P: pre-order/production financing remains COMMERCIALLY DEFERRED.
// No environment variable, UI flag or client role can bypass approval.
const POLICY_STATUS='DEFERRED';
const MISSING=['supplier_production_lead_time','minimum_batch_quantity',
 'ready_stock_separation','deposit_custody_and_release','buyer_cancellation_terms',
 'batch_shortfall_refund_policy','supplier_failure_and_delay_policy',
 'food_safety_and_regulatory_approval','individual_buyer_consent'];
function getPreorderPolicy(){
 return {feature:'PREORDER_PRODUCTION_BATCH',status:POLICY_STATUS,
  payable_orders_enabled:false,deposits_enabled:false,inventory_ready_stock_allocation_enabled:false,
  missing_policy_decisions:[...MISSING],
  next_action:'Approve detailed commercial, food-safety, cancellation and deposit/refund terms before implementation.'};
}
function assertPreorderEnabled(){
 const e=new Error('Production/pre-order batches require separate approved commercial and food-safety policy. No deposits or orders are enabled.');
 e.code='PREORDER_POLICY_NOT_APPROVED';e.statusCode=503;
 throw e;
}
module.exports={getPreorderPolicy,assertPreorderEnabled};
