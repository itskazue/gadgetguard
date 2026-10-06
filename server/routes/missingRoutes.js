const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { authMiddleware, JWT_SECRET } = require('../auth');
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
    const nowIso = new Date().toISOString();
    const newReport = db.insert('missing_reports', {
      id: 'msr_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
      gadgetId,
      userId: gadget.userId,
      reportedByUserId: req.user.id,
      reportedByRole: req.user.role,
      lastSeenLocation: lastSeenLocation.trim(),
      lastSeenDate: lastSeenDate || nowIso,
      reportedAt: nowIso,
      createdAt: nowIso,
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
      message: `Your ${gadget.brand} ${gadget.model} has been marked MISSING. Anyone scanning its QR code will see safety instructions to return it to OSA Room 1109.`,
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

// GET /api/missing/active (Public board + Full details for authenticated OSA Admins)
router.get('/active', (req, res) => {
  try {
    let isOsa = false;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET);
        if (decoded && (decoded.role === 'osa_admin' || decoded.role === 'admin')) {
          isOsa = true;
        }
      } catch (e) {}
    }

    const missingReports = isOsa 
      ? db.get('missing_reports') 
      : db.find('missing_reports', m => m.status === 'ACTIVE');
    
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
          serialNumber: isOsa ? gadget.serialNumber : undefined,
          photoUrl: gadget.photoUrl,
          status: gadget.status,
          secureToken: gadget.secureToken
        } : null,
        owner: owner ? {
          name: isOsa ? owner.name : (owner.name.charAt(0) + '*** ' + owner.name.split(' ').slice(-1)[0]),
          idNumber: isOsa ? owner.idNumber : undefined,
          email: isOsa ? owner.email : undefined,
          contactNumber: isOsa ? owner.contactNumber : undefined,
          department: owner.department
        } : null
      };
    }).filter(r => r.gadget && (isOsa ? true : (r.status === 'ACTIVE' && r.gadget.status === 'MISSING')));

    return res.json({ success: true, count: enriched.length, reports: enriched });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Error fetching missing gadgets.' });
  }
});

// POST /api/missing/:id/cancel (Cancel missing status if owner found it or OSA verified safe)
router.post('/:id/cancel', authMiddleware, (req, res) => {
  try {
    let report = db.findById('missing_reports', req.params.id);
    if (!report) {
      report = db.findOne('missing_reports', m => m.gadgetId === req.params.id && m.status === 'ACTIVE');
    }

    let gadgetId = null;
    if (report) {
      gadgetId = report.gadgetId;
      if (report.userId !== req.user.id && req.user.role !== 'osa_admin') {
        return res.status(403).json({ success: false, error: 'Unauthorized.' });
      }
      db.update('missing_reports', report.id, { status: 'CANCELLED' });
    } else {
      const gadget = db.findById('gadgets', req.params.id);
      if (gadget && (gadget.status === 'MISSING' || gadget.status === 'FOUND_IN_CUSTODY')) {
        gadgetId = gadget.id;
        if (gadget.userId !== req.user.id && req.user.role !== 'osa_admin') {
          return res.status(403).json({ success: false, error: 'Unauthorized.' });
        }
      }
    }

    if (!gadgetId) {
      return res.status(404).json({ success: false, error: 'Active missing report or gadget not found.' });
    }

    // Cancel any other active missing reports for this gadget
    const activeMissing = db.find('missing_reports', m => m.gadgetId === gadgetId && m.status === 'ACTIVE');
    activeMissing.forEach(m => db.update('missing_reports', m.id, { status: 'CANCELLED' }));

    // Restore gadget status to REGISTERED
    db.update('gadgets', gadgetId, { status: 'REGISTERED', custodyLocation: null });

    // Mark associated found reports as RESOLVED so they are cleared from Custody Vault intake
    const foundReports = db.find('found_reports', f => f.gadgetId === gadgetId);
    foundReports.forEach(f => {
      if (f.status !== 'RESOLVED' && f.status !== 'RETURNED') {
        db.update('found_reports', f.id, { status: 'RESOLVED' });
      }
    });

    db.addAuditLog({
      userId: req.user.id,
      userRole: req.user.role,
      action: 'CANCEL_MISSING_REPORT',
      targetType: 'gadget',
      targetId: gadgetId,
      details: `${req.user.role === 'osa_admin' ? 'OSA Admin' : 'Owner'} cancelled missing report / marked recovered for gadget ID ${gadgetId}. Status set to REGISTERED.`,
      ipAddress: req.ip
    });

    return res.json({ success: true, message: 'Missing report cancelled. Gadget marked safe and registered.' });
  } catch (err) {
    console.error('Cancel missing error:', err);
    return res.status(500).json({ success: false, error: 'Error cancelling missing report.' });
  }
});

module.exports = router;
