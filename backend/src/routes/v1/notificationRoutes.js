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
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const offset = parseInt(req.query.offset, 10) || 0;
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
    const updated = await notificationService.markAsRead(req.params.id, req.user.id);
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
