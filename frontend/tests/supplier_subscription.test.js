import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const supplierApiSource = fs.readFileSync(path.join(__dirname, '../src/api/supplier.js'), 'utf8');
const subPageSource = fs.readFileSync(path.join(__dirname, '../src/pages/SupplierSubscriptionPage.jsx'), 'utf8');
const adminPanelSource = fs.readFileSync(path.join(__dirname, '../src/components/admin/AdminSubscriptionApprovalPanel.jsx'), 'utf8');

test('Frontend Supplier Subscription API & UI enforce server-backed pricing without stale fallbacks', () => {
  for (const fn of [
    'getSubscription',
    'getSubscriptionPlans',
    'recordRenewalConsent',
    'initiateSubscriptionCheckout',
    'reconcileSubscriptionCheckout',
    'scheduleSubscriptionDowngrade',
    'cancelSubscription'
  ]) {
    assert.ok(supplierApiSource.includes(fn), `Missing ${fn} in supplierApi`);
  }

  assert.ok(!subPageSource.includes('Successfully updated subscription to'));
  assert.ok(!subPageSource.includes('3500.00'), 'Stale fallback price 3500.00 must be removed');
  assert.ok(!subPageSource.includes('8000.00'), 'Stale fallback price 8000.00 must be removed');
  assert.ok(subPageSource.includes('Pricing unavailable'), 'Must show Pricing unavailable when API fails');
  assert.ok(subPageSource.includes('Transaction Fee (separate)'), 'Must show transaction fee separately');
  assert.ok(subPageSource.includes('Renewal Price Update Requires Your Explicit Consent'), 'Must show explicit renewal price consent');
  assert.ok(subPageSource.includes('recordRenewalConsent'), 'Must record auditable renewal consent');
  assert.ok(!/early.?adopter|6.?month|six.?month|annual billing/i.test(subPageSource), 'Must not advertise unapproved discounts or annual billing');
  assert.ok(subPageSource.includes('reconcileSubscriptionCheckout'));
  assert.ok(subPageSource.includes('initiateSubscriptionCheckout'));
  assert.ok(subPageSource.includes('scheduleSubscriptionDowngrade'));
  assert.ok(subPageSource.includes('cancelSubscription'));
  assert.ok(subPageSource.includes('is_over_limit'));
  assert.ok(subPageSource.includes('pending_checkout'));

  assert.ok(adminPanelSource.includes('/admin/subscriptions/'));
  assert.ok(adminPanelSource.includes('/approve'));
  assert.ok(adminPanelSource.includes('/reject'));
});
