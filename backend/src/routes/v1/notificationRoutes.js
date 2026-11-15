'use strict';
// =============================================================================
// backend/src/routes/v1/notificationRoutes.js
// MilJor In-App Notification API Routes
// Exposes user-isolated notifications and unread counts backed by MySQL platform_notifications
// =============================================================================
const express = require('express');
const router = express.Router();
const notificationService = require('../../services/notificationService');
const { protect } = require('../../middlewares/authGuard');

router.use(protect);

router.get('/', async (req, res) => {
  try {
    const unreadOnly = req.query.unread === 'true';
    const limitRaw = Number(req.query.limit);
    const limit = Number.isSafeInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 50;
    const offsetRaw = Number(req.query.offset);
    const offset = Number.isSafeInteger(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
    const notifications = await notificationService.listUserNotifications(req.user.id, { limit, offset, unreadOnly });
    const unreadCount = await notificationService.getUnreadCount(req.user.id);
    return res.status(200).json({ success: true, data: { notifications, unreadCount } });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: err.message } });
  }
});

router.get('/unread-count', async (req, res) => {
  try {
    const unreadCount = await notificationService.getUnreadCount(req.user.id);
    return res.status(200).json({ success: true, data: { unreadCount } });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: err.message } });
  }
});

router.patch('/:id/read', async (req, res) => {
  try {
    const notificationId = Number(req.params.id);
    if (!Number.isSafeInteger(notificationId) || notificationId <= 0) {
      return res.status(400).json({ success: false, error: { message: 'Invalid notification ID' } });
    }
    const updated = await notificationService.markAsRead(req.user.id, notificationId);
    return res.status(200).json({ success: true, data: { updated } });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: err.message } });
  }
});

router.patch('/mark-all-read', async (req, res) => {
  try {
    const count = await notificationService.markAllAsRead(req.user.id);
    return res.status(200).json({ success: true, data: { markedCount: count } });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: err.message } });
  }
});

module.exports = router;
