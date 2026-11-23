import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const supplierApiSource = fs.readFileSync(path.join(__dirname, '../src/api/supplier.js'), 'utf8');
const subPageSource = fs.readFileSync(path.join(__dirname, '../src/pages/SupplierSubscriptionPage.jsx'), 'utf8');
const adminPanelSource = fs.readFileSync(path.join(__dirname, '../src/components/admin/AdminSubscriptionApprovalPanel.jsx'), 'utf8');

test('Frontend Supplier Subscription API & UI enforce backend state without fake payment success', () => {
  for (const fn of [
    'getSubscription',
    'getSubscriptionPlans',
    'initiateSubscriptionCheckout',
    'reconcileSubscriptionCheckout',
    'scheduleSubscriptionDowngrade',
    'cancelSubscription'
  ]) {
    assert.ok(supplierApiSource.includes(fn), `Missing ${fn} in supplierApi`);
  }

  assert.ok(!subPageSource.includes('Successfully updated subscription to'));
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
