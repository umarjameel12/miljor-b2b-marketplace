'use strict';
// =============================================================================
// backend/tests/notification_events_verification.test.js
// MilJor Notification Event & Inbox Verification Gate
// Validates genuine persistent notifications for all 9 platform events:
// Payment, Order, RFQ, Award, Supplier Verification, Dispatch, Delivery,
// Dispute, and Refund. Enforces isolation, deduplication, and unread counts.
// =============================================================================
process.env.NODE_ENV = 'test';
process.env.DB_NAME = 'miljor_test_db';

const assert = require('node:assert/strict');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../src/config/db');
const notificationService = require('../src/services/notificationService');

async function testNotificationEvents() {
  console.log('🔔 Starting Notification Event Verification Gate...');

  const [[dbName]] = await db.query('SELECT DATABASE() as db');
  assert.equal(dbName.db, 'miljor_test_db', 'Must run strictly in miljor_test_db');

  const buyerId = 5;
  const supplierId = 2;
  const adminId = 1;
  const runId = Date.now() + '_' + Math.floor(Math.random() * 10000);

  // Clean test user notifications for this test cycle
  await db.query('DELETE FROM platform_notifications WHERE user_id IN (?, ?, ?)', [buyerId, supplierId, adminId]);

  console.log('\n--- 1. Testing Event Creation for All 9 Core Platform Events ---');

  const events = [
    {
      userId: buyerId,
      role: 'BUYER',
      eventType: 'ORDER_CREATED',
      eventKey: `ORD_CREATE_${runId}`,
      title: 'Order Placed',
      message: 'Your collective procurement order #ORD-101 has been placed.',
      payload: { orderId: 101, amount: 9600.00 }
    },
    {
      userId: buyerId,
      role: 'BUYER',
      eventType: 'PAYMENT_CONFIRMED',
      eventKey: `PAY_CONFIRM_${runId}`,
      title: 'Payment Received',
      message: 'Safepay payment confirmed for order #ORD-101.',
      payload: { orderId: 101, tracker: 'track_test_123', amount: 9600.00 }
    },
    {
      userId: supplierId,
      role: 'SUPPLIER',
      eventType: 'RFQ_SUBMITTED',
      eventKey: `RFQ_SUBMIT_${runId}`,
      title: 'New RFQ Opportunity',
      message: 'A new RFQ #RFQ-201 matches your catalog category.',
      payload: { rfqId: 201, category: 'Rice' }
    },
    {
      userId: supplierId,
      role: 'SUPPLIER',
      eventType: 'QUOTE_AWARDED',
      eventKey: `QUOTE_AWARD_${runId}`,
      title: 'Quote Accepted & Awarded',
      message: 'Your quote for RFQ #RFQ-201 was accepted by the buyer.',
      payload: { rfqId: 201, quoteId: 301, amount: 25000.00 }
    },
    {
      userId: supplierId,
      role: 'SUPPLIER',
      eventType: 'SUPPLIER_VERIFIED',
      eventKey: `SUPP_VERIFY_${runId}`,
      title: 'Account Verified',
      message: 'Your supplier profile has been reviewed and approved by administrators.',
      payload: { verificationStatus: 'VERIFIED' }
    },
    {
      userId: buyerId,
      role: 'BUYER',
      eventType: 'ORDER_DISPATCHED',
      eventKey: `ORD_DISPATCH_${runId}`,
      title: 'Order Dispatched',
      message: 'Order #ORD-101 has been dispatched by Lahore Rice Traders.',
      payload: { orderId: 101, trackingRef: 'DISP-TRACK-99' }
    },
    {
      userId: buyerId,
      role: 'BUYER',
      eventType: 'ORDER_DELIVERED',
      eventKey: `ORD_DELIVER_${runId}`,
      title: 'Delivery Completed',
      message: 'Order #ORD-101 has been delivered to your destination cluster.',
      payload: { orderId: 101 }
    },
    {
      userId: adminId,
      role: 'SUPER_ADMIN',
      eventType: 'DISPUTE_RAISED',
      eventKey: `DISP_RAISE_${runId}`,
      title: 'New Shortage Dispute Raised',
      message: 'Buyer reported 20kg shortage on order #ORD-101. Claim: PKR 200.',
      payload: { orderId: 101, claimAmount: 200.00, reason: 'SHORTAGE_IN_QUANTITY' }
    },
    {
      userId: buyerId,
      role: 'BUYER',
      eventType: 'REFUND_INITIATED',
      eventKey: `REF_INIT_${runId}`,
      title: 'Partial Refund Approved',
      message: 'Dispute resolved: PKR 200 refund obligation recorded.',
      payload: { orderId: 101, refundAmount: 200.00 }
    }
  ];

  for (const ev of events) {
    const res = await notificationService.createNotification(ev);
    assert.equal(res.created, true, `Event ${ev.eventType} must be created`);
    assert.ok(res.notificationId > 0, `Event ${ev.eventType} must return positive notification ID`);
    console.log(`  [PASS] Event ${ev.eventType} persisted (ID: ${res.notificationId}) for user ${ev.userId}`);
  }

  console.log('\n--- 2. Testing Deduplication ---');
  // Attempt duplicate insert of event 0
  const dupAttempt = await notificationService.createNotification(events[0]);
  assert.equal(dupAttempt.created, false, 'Duplicate eventKey must not create new row');
  assert.equal(dupAttempt.duplicate, true, 'Duplicate must report duplicate: true');
  console.log('  [PASS] Duplicate notification insertion gracefully suppressed via unique constraint');

  console.log('\n--- 3. Testing Recipient Isolation ---');
  const buyerNotifs = await notificationService.listUserNotifications(buyerId);
  const supplierNotifs = await notificationService.listUserNotifications(supplierId);
  const adminNotifs = await notificationService.listUserNotifications(adminId);

  // Buyer should see only buyer events (5 events: ORDER_CREATED, PAYMENT_CONFIRMED, ORDER_DISPATCHED, ORDER_DELIVERED, REFUND_INITIATED)
  assert.equal(buyerNotifs.length, 5, 'Buyer inbox contains exactly 5 buyer notifications');
  assert.ok(buyerNotifs.every(n => n.role === 'BUYER'), 'Buyer inbox contains zero cross-role leakages');

  // Supplier should see only supplier events (3 events: RFQ_SUBMITTED, QUOTE_AWARDED, SUPPLIER_VERIFIED)
  assert.equal(supplierNotifs.length, 3, 'Supplier inbox contains exactly 3 supplier notifications');
  assert.ok(supplierNotifs.every(n => n.role === 'SUPPLIER'), 'Supplier inbox contains zero cross-role leakages');

  // Admin should see only admin events (1 event: DISPUTE_RAISED)
  assert.equal(adminNotifs.length, 1, 'Admin inbox contains exactly 1 admin notification');
  assert.equal(adminNotifs[0].event_type, 'DISPUTE_RAISED', 'Admin sees dispute notification');
  console.log('  [PASS] Strict recipient isolation verified: zero cross-role leakage between Buyer, Supplier, Admin');

  console.log('\n--- 4. Testing Unread Counts and Read State Transitions ---');
  const initialBuyerUnread = await notificationService.getUnreadCount(buyerId);
  assert.equal(initialBuyerUnread, 5, 'Initial buyer unread count is 5');

  // Mark first notification as read
  const firstNotifId = buyerNotifs[0].id;
  const marked = await notificationService.markAsRead(buyerId, firstNotifId);
  assert.equal(marked, true, 'Notification marked as read');

  const afterOneRead = await notificationService.getUnreadCount(buyerId);
  assert.equal(afterOneRead, 4, 'Buyer unread count decremented to 4');

  // Mark all as read
  const allMarked = await notificationService.markAllAsRead(buyerId);
  assert.equal(allMarked, 4, 'Remaining 4 notifications marked as read');

  const finalBuyerUnread = await notificationService.getUnreadCount(buyerId);
  assert.equal(finalBuyerUnread, 0, 'Final buyer unread count is exactly 0');
  console.log('  [PASS] Unread counts and read state transitions verified (5 -> 4 -> 0)');

  console.log('\n🎉 ALL NOTIFICATION EVENT VERIFICATION TESTS PASSED (100% Green)');
}

testNotificationEvents()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ NOTIFICATION TEST FAILURE:', err);
    process.exit(1);
  });
