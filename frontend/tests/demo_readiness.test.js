import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const adminApiSrc = fs.readFileSync(path.join(__dirname, '../src/api/admin.js'), 'utf8');
const orderPanelSrc = fs.readFileSync(path.join(__dirname, '../src/components/admin/AdminOrderApprovalPanel.jsx'), 'utf8');
const adminDashSrc = fs.readFileSync(path.join(__dirname, '../src/pages/AdminDashboardPage.jsx'), 'utf8');
const ordersPageSrc = fs.readFileSync(path.join(__dirname, '../src/pages/OrdersPage.jsx'), 'utf8');
const appShellSrc = fs.readFileSync(path.join(__dirname, '../src/components/layout/AppShell.jsx'), 'utf8');

test('PR #64 Demo Readiness: Admin Order Approval Queue, Buyer Badge & Role-Aware Mobile Nav', () => {
  for (const fn of ['getPendingApprovalOrders', 'approveOrder', 'rejectOrder']) {
    assert.ok(adminApiSrc.includes(fn), `Missing ${fn} in adminApi`);
  }
  assert.ok(orderPanelSrc.includes('Mandatory order approval gate'));
  assert.ok(orderPanelSrc.includes('Approve for Supplier Fulfillment'));
  assert.ok(orderPanelSrc.includes('Reject Order'));
  assert.ok(adminDashSrc.includes('AdminOrderApprovalPanel'));

  assert.ok(ordersPageSrc.includes('PENDING_ADMIN_APPROVAL'));
  assert.ok(ordersPageSrc.includes('Pending Admin Approval'));
  assert.ok(ordersPageSrc.includes('Admin Approved'));

  assert.ok(appShellSrc.includes("path: '/supplier/dashboard'"));
  assert.ok(appShellSrc.includes("path: '/supplier/subscription'"));
  assert.ok(appShellSrc.includes("path: '/procurement'"));
});
