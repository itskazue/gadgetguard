const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../auth');
const db = require('../db');

// POST /api/missing/report (Student or OSA Admin reports gadget missing)
router.post('/report', authMiddleware, (req, res) => {
  try {
    const { gadgetId, lastSeenLocation, lastSeenDate, details, contactRewardOffer } = req.body;

    if (!gadgetId || !lastSeenLocation) {
      return res.status(400).json({ success: false, error: 'Gadget and last seen location are required.' });
    }

    const gadget = db.findById('gadgets', gadgetId);
    if (!gadget) {
      return res.status(404).json({ success: false, error: 'Gadget not found.' });
    }

    const isOsa = req.user.role === 'osa_admin';
    if (gadget.userId !== req.user.id && !isOsa) {
      return res.status(403).json({ success: false, error: 'You can only report your own gadgets missing.' });
    }

    const owner = db.findById('users', gadget.userId);

    // Cancel existing active reports for this gadget if any
    const existingReports = db.find('missing_reports', m => m.gadgetId === gadgetId && m.status === 'ACTIVE');
    existingReports.forEach(r => db.update('missing_reports', r.id, { status: 'CANCELLED' }));

    // Create new missing report
    const newReport = db.insert('missing_reports', {
      id: 'msr_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
      gadgetId,
      userId: gadget.userId,
      reportedByUserId: req.user.id,
      reportedByRole: req.user.role,
      lastSeenLocation: lastSeenLocation.trim(),
      lastSeenDate: lastSeenDate || new Date().toISOString(),
      details: details ? details.trim() : '',
      contactRewardOffer: contactRewardOffer ? contactRewardOffer.trim() : '',
      status: 'ACTIVE'
    });

    // Update gadget status to MISSING
    db.update('gadgets', gadgetId, { status: 'MISSING' });

    db.addAuditLog({
      userId: req.user.id,
      userRole: req.user.role,
      action: 'REPORT_MISSING',
      targetType: 'gadget',
      targetId: gadgetId,
      details: isOsa 
        ? `OSA Admin (${req.user.name}) reported gadget MISSING on behalf of ${owner ? owner.name : 'student'} (${gadget.brand} ${gadget.model}) at ${lastSeenLocation}`
        : `Student reported missing: ${gadget.brand} ${gadget.model} at ${lastSeenLocation}`,
      ipAddress: req.ip
    });

    // Notify OSA Admins
    const osaAdmins = db.find('users', u => u.role === 'osa_admin');
    osaAdmins.forEach(admin => {
      db.addNotification({
        userId: admin.id,
        title: 'New Missing Gadget Reported 🚨',
        message: isOsa
          ? `OSA Desk registered a missing report for ${owner ? owner.name : 'Student'}'s ${gadget.brand} ${gadget.model} near ${lastSeenLocation}.`
          : `${req.user.name} reported a missing ${gadget.brand} ${gadget.model} near ${lastSeenLocation}.`,
        type: 'MISSING_ALERT',
        linkUrl: '/osa/#missing'
      });
    });

    // Notification to student owner
    db.addNotification({
      userId: gadget.userId,
      title: 'Missing Alert Broadcasted 📡',
      message: `Your ${gadget.brand} ${gadget.model} has been marked MISSING. Anyone scanning its QR code will see safety instructions to return it to OSA Room 204.`,
      type: 'MISSING_ALERT',
      linkUrl: '/student/#lost-status'
    });

    return res.status(201).json({
      success: true,
      message: 'Gadget reported missing successfully.',
      report: newReport
    });
  } catch (err) {
    console.error('Report missing error:', err);
    return res.status(500).json({ success: false, error: 'Server error reporting missing gadget.' });
  }
});

// GET /api/missing/active (Public / Campus-wide missing board)
router.get('/active', (req, res) => {
  try {
    const missingReports = db.find('missing_reports', m => m.status === 'ACTIVE');
    
    const enriched = missingReports.map(report => {
      const gadget = db.findById('gadgets', report.gadgetId);
      const owner = gadget ? db.findById('users', gadget.userId) : null;

      return {
        ...report,
        gadget: gadget ? {
          id: gadget.id,
          category: gadget.category,
          brand: gadget.brand,
          model: gadget.model,
          color: gadget.color,
          photoUrl: gadget.photoUrl,
          status: gadget.status,
          secureToken: gadget.secureToken
        } : null,
        owner: owner ? {
          name: owner.name.charAt(0) + '*** ' + owner.name.split(' ').slice(-1)[0], // Masked name for privacy
          department: owner.department
        } : null
      };
    }).filter(r => r.gadget && r.gadget.status === 'MISSING');

    return res.json({ success: true, count: enriched.length, reports: enriched });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Error fetching missing gadgets.' });
  }
});

// POST /api/missing/:id/cancel (Cancel missing status if owner found it or OSA verified safe)
router.post('/:id/cancel', authMiddleware, (req, res) => {
  try {
    const report = db.findById('missing_reports', req.params.id);
    if (!report) {
      return res.status(404).json({ success: false, error: 'Report not found.' });
    }

    if (report.userId !== req.user.id && req.user.role !== 'osa_admin') {
      return res.status(403).json({ success: false, error: 'Unauthorized.' });
    }

    db.update('missing_reports', report.id, { status: 'CANCELLED' });
    db.update('gadgets', report.gadgetId, { status: 'REGISTERED' });

    db.addAuditLog({
      userId: req.user.id,
      userRole: req.user.role,
      action: 'CANCEL_MISSING_REPORT',
      targetType: 'gadget',
      targetId: report.gadgetId,
      details: `${req.user.role === 'osa_admin' ? 'OSA Admin' : 'Owner'} cancelled missing report for gadget ID ${report.gadgetId}. Marked safe.`,
      ipAddress: req.ip
    });

    return res.json({ success: true, message: 'Missing report cancelled. Gadget marked safe.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Error cancelling missing report.' });
  }
});

module.exports = router;
