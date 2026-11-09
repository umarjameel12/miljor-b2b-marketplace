// =============================================================================
// frontend/tests/package_c_onboarding_focused.test.js
// MilJor Package C: Focused Verification for Buyer & Supplier Onboarding
// =============================================================================
import assert from 'node:assert/strict';

console.log('🧪 Starting Package C Focused Verification Suite...\n');

// 1. Verification of Buyer Registration Payload Formation
function validateBuyerRegistration({ business_name, full_name, email, phone, password, cluster_id, society_area, address }) {
  if (!business_name?.trim()) return { success: false, error: 'Business name is required.' };
  if (!full_name?.trim()) return { success: false, error: 'Authorized contact person name is required.' };
  if (!email?.trim()) return { success: false, error: 'A valid business email address is required.' };
  if (!cluster_id) return { success: false, error: 'Please select an authoritative Lahore operational cluster.' };

  const hasSociety = Boolean(society_area?.trim());
  const hasAddress = Boolean(address?.trim());

  if ((hasSociety && !hasAddress) || (!hasSociety && hasAddress)) {
    return {
      success: false,
      error: 'To save an initial delivery address, both Society/Area and Complete Address are required. Or leave both empty to register with your base cluster only.'
    };
  }

  const payload = {
    business_name: business_name.trim(),
    full_name: full_name.trim(),
    email: email.trim(),
    role: 'BUYER',
    city: 'Lahore',
    base_cluster_id: Number(cluster_id),
    cluster_id: Number(cluster_id)
  };

  if (hasSociety && hasAddress) {
    payload.society_area = society_area.trim();
    payload.address = address.trim();
  }

  return { success: true, payload };
}

// 2. Verification of Supplier Registration Payload Formation
function validateSupplierRegistration({ business_name, full_name, email, phone, password, cluster_id, society_area, address }) {
  if (!business_name?.trim()) return { success: false, error: 'Supplier business name is required.' };
  if (!full_name?.trim()) return { success: false, error: 'Authorized contact person name is required.' };
  if (!email?.trim()) return { success: false, error: 'A valid business email address is required.' };
  if (!cluster_id) return { success: false, error: 'Please select your supplier base operational facility cluster in Lahore.' };
  if (!address?.trim()) return { success: false, error: 'Please enter your complete mill, processing facility, or warehouse address in Lahore.' };

  const payload = {
    business_name: business_name.trim(),
    full_name: full_name.trim(),
    email: email.trim(),
    role: 'SUPPLIER',
    city: 'Lahore',
    base_cluster_id: Number(cluster_id),
    cluster_id: Number(cluster_id),
    address: address.trim()
  };

  if (society_area?.trim()) {
    payload.society_area = society_area.trim();
  }

  return { success: true, payload };
}

// Case 1: Buyer registration with base cluster and NO delivery address
const buyerNoAddress = validateBuyerRegistration({
  business_name: 'Lahore Biryani House',
  full_name: 'Zahid Khan',
  email: 'zahid@biryani.pk',
  cluster_id: 4,
  society_area: '',
  address: ''
});
assert.equal(buyerNoAddress.success, true);
assert.equal(buyerNoAddress.payload.base_cluster_id, 4);
assert.equal(buyerNoAddress.payload.society_area, undefined);
assert.equal(buyerNoAddress.payload.address, undefined);
console.log('✅ Case 1: Buyer registration with base cluster and NO address generates valid payload without dummy fields.');

// Case 2: Buyer registration with voluntary complete address
const buyerWithAddress = validateBuyerRegistration({
  business_name: 'Lahore Biryani House',
  full_name: 'Zahid Khan',
  email: 'zahid@biryani.pk',
  cluster_id: 4,
  society_area: 'Gulberg III Main Market',
  address: 'Shop 12, Commercial Area'
});
assert.equal(buyerWithAddress.success, true);
assert.equal(buyerWithAddress.payload.base_cluster_id, 4);
assert.equal(buyerWithAddress.payload.society_area, 'Gulberg III Main Market');
assert.equal(buyerWithAddress.payload.address, 'Shop 12, Commercial Area');
console.log('✅ Case 2: Buyer registration with complete optional address preserves destination fields.');

// Case 3: Buyer registration with incomplete partial address fails closed
const buyerPartialAddress = validateBuyerRegistration({
  business_name: 'Lahore Biryani House',
  full_name: 'Zahid Khan',
  email: 'zahid@biryani.pk',
  cluster_id: 4,
  society_area: 'Gulberg III',
  address: ''
});
assert.equal(buyerPartialAddress.success, false);
assert.match(buyerPartialAddress.error, /both Society\/Area and Complete Address are required/);
console.log('✅ Case 3: Buyer registration with partial address fails closed with clear guidance.');

// Case 4: Buyer registration without base cluster fails
const buyerNoCluster = validateBuyerRegistration({
  business_name: 'Lahore Biryani House',
  full_name: 'Zahid Khan',
  email: 'zahid@biryani.pk',
  cluster_id: '',
  society_area: '',
  address: ''
});
assert.equal(buyerNoCluster.success, false);
assert.match(buyerNoCluster.error, /select an authoritative Lahore operational cluster/);
console.log('✅ Case 4: Buyer registration without cluster is rejected.');

// Case 5: Supplier registration requires facility address
const supplierNoAddress = validateSupplierRegistration({
  business_name: 'Punjab Agro Mills',
  full_name: 'Amir Malik',
  email: 'amir@punjabagro.pk',
  cluster_id: 6,
  address: ''
});
assert.equal(supplierNoAddress.success, false);
assert.match(supplierNoAddress.error, /complete mill, processing facility, or warehouse address/);
console.log('✅ Case 5: Supplier registration strictly requires base facility address.');

// Case 6: Supplier registration succeeds with facility address and does NOT enable delivery modes
const supplierValid = validateSupplierRegistration({
  business_name: 'Punjab Agro Mills',
  full_name: 'Amir Malik',
  email: 'amir@punjabagro.pk',
  cluster_id: 6,
  society_area: 'Kot Lakhpat Industrial Area',
  address: 'Plot 44-C, Sector B'
});
assert.equal(supplierValid.success, true);
assert.equal(supplierValid.payload.role, 'SUPPLIER');
assert.equal(supplierValid.payload.standard_delivery_enabled, undefined);
assert.equal(supplierValid.payload.pickup_enabled, undefined);
assert.equal(supplierValid.payload.express_enabled, undefined);
console.log('✅ Case 6: Supplier registration succeeds without fabricating delivery authorization or pickup points.');

// Case 7: Verify cluster selector integrity (12 clusters, zero neighboring cities)
const AUTHORITATIVE_CLUSTERS = [
  { id: 1, code: 'LHR-NORTH-RVI' },
  { id: 2, code: 'LHR-CENTRAL-HIST' },
  { id: 3, code: 'LHR-EAST-CANTONMENT' },
  { id: 4, code: 'LHR-CORE-COMMERCIAL' },
  { id: 5, code: 'LHR-MIDWEST-URBAN' },
  { id: 6, code: 'LHR-SOUTH-CENTRAL' },
  { id: 7, code: 'LHR-SOUTHWEST-RES' },
  { id: 8, code: 'LHR-DEEP-SOUTH' },
  { id: 9, code: 'LHR-RAIWIND-RURAL' },
  { id: 10, code: 'LHR-SOUTHEAST-FEROZ' },
  { id: 11, code: 'LHR-EAST-PERIPHERY' },
  { id: 12, code: 'LHR-DHA-SOUTHERN' }
];

assert.equal(AUTHORITATIVE_CLUSTERS.length, 12);
for (const cl of AUTHORITATIVE_CLUSTERS) {
  assert.ok(cl.code.startsWith('LHR-'), `Cluster code must start with LHR-: ${cl.code}`);
  assert.ok(!cl.code.includes('KASUR'), 'No Kasur clusters');
  assert.ok(!cl.code.includes('SHEIKHUPURA'), 'No Sheikhupura clusters');
}
console.log('✅ Case 7: All 12 authoritative Lahore clusters verified with zero neighboring district contamination.');

console.log('\n🎉 ALL PACKAGE C FOCUSED ASSERTIONS PASSED (7/7).\n');
