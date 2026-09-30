const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../auth');
const db = require('../db');

// GET /api/notifications (Fetch current user's notifications)
router.get('/', authMiddleware, (req, res) => {
  try {
    const userNotifs = db.find('notifications', n => n.userId === req.user.id);
    userNotifs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const unreadCount = userNotifs.filter(n => !n.read).length;

    return res.json({
      success: true,
      unreadCount,
      notifications: userNotifs
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Error fetching notifications.' });
  }
});

// PUT /api/notifications/:id/read (Mark single notification as read)
router.put('/:id/read', authMiddleware, (req, res) => {
  try {
    const notif = db.findById('notifications', req.params.id);
    if (!notif) {
      return res.status(404).json({ success: false, error: 'Notification not found.' });
    }

    if (notif.userId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Unauthorized.' });
    }

    const updated = db.update('notifications', notif.id, { read: true });
    return res.json({ success: true, notification: updated });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Error updating notification.' });
  }
});

// PUT /api/notifications/read-all (Mark all as read)
router.put('/read-all', authMiddleware, (req, res) => {
  try {
    const userNotifs = db.find('notifications', n => n.userId === req.user.id && !n.read);
    userNotifs.forEach(n => {
      db.update('notifications', n.id, { read: true });
    });

    return res.json({ success: true, message: 'All notifications marked as read.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Error marking notifications read.' });
  }
});

module.exports = router;
