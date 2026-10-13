const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware, requireRole } = require('../auth');
const db = require('../db');
const mailer = require('../services/mailer');

// Helper to determine the public base URL
function getBaseUrl(req) {
  if (process.env.APP_URL) {
    return process.env.APP_URL.replace(/\/$/, '');
  }
  if (req) {
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    if (host) return `${proto}://${host}`;
  }
  return 'https://ncstgadgetguard.onrender.com';
}

// Helper to generate QR code data URL matching current domain
async function generateGadgetQRCode(token, req) {
  const base = getBaseUrl(req);
  const url = `${base}/device/${token}`;
  return await QRCode.toDataURL(url, {
    errorCorrectionLevel: 'H',
    margin: 2,
    color: {
      dark: '#142a6d',
      light: '#ffffff'
    },
    width: 350
  });
}

// POST /api/gadgets/register (Student/Faculty registers gadget)
router.post('/register', authMiddleware, async (req, res) => {
  try {
    const { category, brand, model, serialNumber, color, description, photoUrl } = req.body;

    const isSerialOptional = (category === 'Earbuds' || category === 'Other');

    if (!category || !brand || !model) {
      return res.status(400).json({ 
        success: false, 
        error: 'Category, brand, and model are required.' 
      });
    }

    if (!isSerialOptional && !serialNumber) {
      return res.status(400).json({ 
        success: false, 
        error: `Serial Number / IMEI is required for ${category}.` 
      });
    }

    // Check if serial number already registered and active (if provided)
    if (serialNumber && serialNumber.trim()) {
      const existing = db.findOne('gadgets', g => 
        g.serialNumber.toLowerCase() === serialNumber.trim().toLowerCase() && 
        g.status !== 'REJECTED'
      );

      if (existing) {
        return res.status(400).json({ 
          success: false, 
          error: `A gadget with serial number "${serialNumber}" is already registered in the system.` 
        });
      }
    }

    const finalSn = (serialNumber && serialNumber.trim())
      ? serialNumber.trim()
      : `NO-SN-${Date.now().toString(36).toUpperCase()}`;

    const newGadget = db.insert('gadgets', {
      id: 'gdt_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
      userId: req.user.id,
      category,
      brand: brand.trim(),
      model: model.trim(),
      serialNumber: finalSn,
      color: color ? color.trim() : 'Standard',
      description: description ? description.trim() : '',
      photoUrl: (photoUrl && photoUrl.trim()) ? photoUrl.trim() : null,
      status: 'PENDING_APPROVAL',
      secureToken: null,
      qrCodeDataUrl: null,
      rejectionReason: null,
      registrationDate: new Date().toISOString(),
      approvedAt: null,
      approvedBy: null
    });

    db.addAuditLog({
      userId: req.user.id,
      userRole: req.user.role,
      action: 'REGISTER_GADGET',
      targetType: 'gadget',
      targetId: newGadget.id,
      details: `Registered new gadget: ${newGadget.brand} ${newGadget.model} (S/N: ${newGadget.serialNumber})`,
      ipAddress: req.ip
    });

    db.addNotification({
      userId: req.user.id,
      title: 'Gadget Submitted for Review 📝',
      message: `Your ${newGadget.brand} ${newGadget.model} has been submitted to OSA for verification. You will be notified once approved.`,
      type: 'SYSTEM',
      linkUrl: '/student/#gadgets'
    });

    return res.status(201).json({
      success: true,
      message: 'Gadget submitted for OSA review successfully!',
      gadget: newGadget
    });
  } catch (err) {
    console.error('Register gadget error:', err);
    return res.status(500).json({ success: false, error: 'Server error registering gadget.' });
  }
});

// GET /api/gadgets/my (Student fetches their registered gadgets)
router.get('/my', authMiddleware, (req, res) => {
  try {
    const gadgets = db.find('gadgets', g => g.userId === req.user.id);
    
    // Enrich with missing report info if any
    const enriched = gadgets.map(g => {
      const missingReport = db.findOne('missing_reports', m => m.gadgetId === g.id && m.status === 'ACTIVE');
      let scanCount = 0;
      if (g.status === 'MISSING' && missingReport) {
        const reportTime = new Date(missingReport.reportedAt || missingReport.createdAt || 0).getTime();
        scanCount = db.find('qr_scans', s => 
          s.gadgetId === g.id && 
          s.scanStatus === 'MISSING_DEVICE_SCANNED' && 
          new Date(s.scannedAt).getTime() >= reportTime
        ).length;
      }
      const latestClaim = db.findOne('claims', c => c.gadgetId === g.id);

      const isSurrenderPending = (g.custodyStatus === 'PENDING_OSA_TURNOVER' || g.surrenderStatus === 'WILL_SURRENDER_TO_OSA');

      // Find all recovery chats for this gadget and current missing incident
      const incidentChats = (g.status === 'MISSING') ? db.find('recovery_chats', c => 
        c.gadgetId === g.id && 
        (missingReport ? c.missingReportId === missingReport.id : true)
      ).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) : [];

      const activeIncidentChats = incidentChats.filter(c => c.status === 'ACTIVE');
      const closedIncidentChats = incidentChats.filter(c => c.status === 'CLOSED');

      const finderChats = activeIncidentChats.map(c => {
        const foundReport = db.findById('found_reports', c.foundReportId) || 
          db.findOne('found_reports', f => f.gadgetId === g.id && f.missingReportId === c.missingReportId);
        return {
          id: foundReport ? foundReport.id : c.id,
          chatId: c.id,
          finderName: c.finderName || 'Finder',
          foundLocation: c.foundLocation || 'Campus',
          action: 'Keeping Gadget Safe',
          turnInMethod: 'KEPT_SAFE',
          foundDate: foundReport?.foundDate || c.createdAt,
          message: foundReport?.message || foundReport?.notes || '',
          createdAt: c.createdAt
        };
      });

      // Backward-compatible finderInfo pointing to primary active chat if no surrender pending
      let finderInfo = (!isSurrenderPending && finderChats.length > 0) ? finderChats[0] : null;

      // If a finder reported finding the gadget and chose to surrender to OSA
      let surrenderInfo = null;
      if (isSurrenderPending || (g.status === 'MISSING' && g.custodyStatus === 'PENDING_OSA_TURNOVER')) {
        const surrenderReport = db.findOne('found_reports', f => 
          f.gadgetId === g.id && 
          (missingReport ? f.missingReportId === missingReport.id : true) &&
          (f.turnInMethod === 'SUBMITTED_TO_OSA' || f.finderDecision === 'WILL_SURRENDER_TO_OSA') && 
          f.status === 'PENDING_OSA_TURNOVER'
        );
        surrenderInfo = {
          id: surrenderReport ? surrenderReport.id : (g.pendingSurrenderRef || g.id),
          surrenderReference: (surrenderReport && surrenderReport.surrenderReference) || g.pendingSurrenderRef || 'SRF-PENDING',
          finderName: (surrenderReport && surrenderReport.finderName) || (g.surrenderInfo && g.surrenderInfo.finderName) || 'Finder',
          foundLocation: (surrenderReport && surrenderReport.foundLocation) || (g.surrenderInfo && g.surrenderInfo.foundLocation) || 'Campus',
          foundDate: (surrenderReport && surrenderReport.foundDate) || (g.surrenderInfo && g.surrenderInfo.foundDate) || g.updatedAt || new Date().toISOString(),
          status: 'AWAITING OSA HANDOVER',
          message: (surrenderReport && (surrenderReport.message || surrenderReport.notes)) || (g.surrenderInfo && g.surrenderInfo.notes) || ''
        };
      }

      // Check for closed recovery chat for this gadget / incident to preserve closed history
      const latestClosedChat = closedIncidentChats.length > 0 ? closedIncidentChats[0] : db.find('recovery_chats', c => 
        c.gadgetId === g.id && 
        (missingReport ? c.missingReportId === missingReport.id : true) &&
        c.status === 'CLOSED'
      ).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

      const closedChatInfo = latestClosedChat ? {
        chatId: latestClosedChat.id,
        closedReason: latestClosedChat.closedReason,
        finderName: latestClosedChat.finderName || 'Finder',
        foundLocation: latestClosedChat.foundLocation || 'Campus',
        missingReportId: latestClosedChat.missingReportId
      } : null;

      const closedChatsList = closedIncidentChats.map(c => ({
        chatId: c.id,
        closedReason: c.closedReason,
        finderName: c.finderName || 'Finder',
        foundLocation: c.foundLocation || 'Campus',
        missingReportId: c.missingReportId,
        createdAt: c.createdAt
      }));

      return {
        ...g,
        missingReport: missingReport || null,
        scanCount,
        latestClaim: latestClaim || null,
        finderInfo,
        finderChats,
        surrenderInfo,
        closedChatInfo,
        closedChatsList
      };
    });

    return res.json({ success: true, gadgets: enriched });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Error fetching gadgets.' });
  }
});

// GET /api/gadgets (OSA Admin fetches all gadgets)
router.get('/', authMiddleware, requireRole('osa_admin'), async (req, res) => {
  try {
    const { status, category, search } = req.query;
    let gadgets = db.get('gadgets');

    if (status && status !== 'ALL') {
      gadgets = gadgets.filter(g => g.status === status);
    }
    if (category && category !== 'ALL') {
      gadgets = gadgets.filter(g => g.category === category);
    }
    if (search) {
      const q = search.toLowerCase();
      gadgets = gadgets.filter(g => 
        g.brand.toLowerCase().includes(q) ||
        g.model.toLowerCase().includes(q) ||
        g.serialNumber.toLowerCase().includes(q) ||
        (g.secureToken && g.secureToken.toLowerCase().includes(q))
      );
    }

    const enriched = await Promise.all(gadgets.map(async g => {
      const owner = db.findById('users', g.userId);
      const ownerSafe = owner ? {
        id: owner.id,
        name: owner.name,
        email: owner.email,
        idNumber: owner.idNumber,
        department: owner.department,
        contactNumber: owner.contactNumber,
        role: owner.role
      } : null;

      const missingReport = db.findOne('missing_reports', m => m.gadgetId === g.id && m.status === 'ACTIVE');
      const scanCount = db.find('qr_scans', s => s.gadgetId === g.id).length;
      const foundReport = db.findOne('found_reports', f => f.gadgetId === g.id);

      let qrCodeDataUrl = g.qrCodeDataUrl;
      if (g.status === 'REGISTERED' && g.secureToken) {
        qrCodeDataUrl = await generateGadgetQRCode(g.secureToken, req);
      }

      return {
        ...g,
        qrCodeDataUrl,
        owner: ownerSafe,
        missingReport,
        scanCount,
        foundReport
      };
    }));

    return res.json({ success: true, gadgets: enriched });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Error fetching all gadgets.' });
  }
});

// GET /api/gadgets/:id (Single gadget details)
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const gadget = db.findById('gadgets', req.params.id);
    if (!gadget) {
      return res.status(404).json({ success: false, error: 'Gadget not found.' });
    }

    // Permission check: owner or OSA Admin
    if (req.user.role !== 'osa_admin' && gadget.userId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Access denied to this gadget.' });
    }

    const owner = db.findById('users', gadget.userId);
    const ownerSafe = owner ? {
      id: owner.id,
      name: owner.name,
      email: owner.email,
      idNumber: owner.idNumber,
      department: owner.department,
      contactNumber: owner.contactNumber,
      role: owner.role
    } : null;

    const missingReport = db.findOne('missing_reports', m => m.gadgetId === gadget.id && m.status === 'ACTIVE');
    const scans = db.find('qr_scans', s => s.gadgetId === gadget.id);
    const claims = db.find('claims', c => c.gadgetId === gadget.id);
    const returnRecord = db.findOne('returns', r => r.gadgetId === gadget.id);
    const foundReports = db.find('found_reports', f => f.gadgetId === gadget.id);

    let qrCodeDataUrl = gadget.qrCodeDataUrl;
    if (gadget.status === 'REGISTERED' && gadget.secureToken) {
      qrCodeDataUrl = await generateGadgetQRCode(gadget.secureToken, req);
    }

    return res.json({
      success: true,
      gadget: {
        ...gadget,
        qrCodeDataUrl,
        owner: ownerSafe,
        missingReport,
        scans,
        claims,
        returnRecord,
        foundReports
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Error fetching gadget details.' });
  }
});

// POST /api/gadgets/:id/approve (OSA Admin approves gadget)
router.post('/:id/approve', authMiddleware, requireRole('osa_admin'), async (req, res) => {
  try {
    const gadget = db.findById('gadgets', req.params.id);
    if (!gadget) {
      return res.status(404).json({ success: false, error: 'Gadget not found.' });
    }

    // Generate secure token and QR Code
    const secureToken = 'gg_dev_' + Math.random().toString(36).substring(2, 10);
    const qrCodeDataUrl = await generateGadgetQRCode(secureToken, req);

    const updated = db.update('gadgets', gadget.id, {
      status: 'REGISTERED',
      secureToken,
      qrCodeDataUrl,
      rejectionReason: null,
      approvedAt: new Date().toISOString(),
      approvedBy: req.user.id
    });

    // If the student user account was pending approval, activate their account now!
    const owner = db.findById('users', gadget.userId);
    if (owner && owner.status === 'PENDING_APPROVAL') {
      db.update('users', owner.id, { status: 'ACTIVE' });
      db.addAuditLog({
        userId: req.user.id,
        userRole: req.user.role,
        action: 'ACTIVATE_STUDENT_ACCOUNT',
        targetType: 'user',
        targetId: owner.id,
        details: `OSA verified student ${owner.name} (${owner.idNumber}) and activated official account.`,
        ipAddress: req.ip
      });
    }

    db.addAuditLog({
      userId: req.user.id,
      userRole: req.user.role,
      action: 'APPROVE_GADGET',
      targetType: 'gadget',
      targetId: gadget.id,
      details: `Approved gadget registration: ${gadget.brand} ${gadget.model} for owner ID ${gadget.userId}. Assigned QR Token: ${secureToken}`,
      ipAddress: req.ip
    });

    // Notify Student
    db.addNotification({
      userId: gadget.userId,
      title: 'Gadget Registration Approved 🎉',
      message: `Your ${gadget.brand} ${gadget.model} has been approved by OSA! Your official security QR code is ready.`,
      type: 'REGISTRATION_APPROVED',
      linkUrl: `/student/#gadgets`
    });

    // Send official Email Notification to student
    if (owner && owner.email) {
      try {
        console.log(`📧 Sending approval email to ${owner.email}...`);
        const mailRes = await mailer.sendApprovalEmail({
          studentEmail: owner.email,
          studentName: owner.name,
          studentId: owner.idNumber,
          gadgetInfo: {
            brand: gadget.brand,
            model: gadget.model,
            category: gadget.category,
            serialNumber: gadget.serialNumber
          },
          req
        });
        console.log(`📧 Approval email result for ${owner.email}:`, mailRes);
      } catch (e) {
        console.error('Error sending approval email:', e.message);
      }
    }

    return res.json({
      success: true,
      message: 'Gadget approved and QR code generated!',
      gadget: updated
    });
  } catch (err) {
    console.error('Approve gadget error:', err);
    return res.status(500).json({ success: false, error: 'Error approving gadget.' });
  }
});

// POST /api/gadgets/:id/reject (OSA Admin rejects gadget)
router.post('/:id/reject', authMiddleware, requireRole('osa_admin'), (req, res) => {
  try {
    const { reason, category, notes } = req.body;
    const finalReason = (notes && notes.trim())
      ? (category && category !== 'Other Reason' ? `${category}: ${notes.trim()}` : notes.trim())
      : (category || reason || '').trim();

    if (!finalReason) {
      return res.status(400).json({ success: false, error: 'Rejection reason is required.' });
    }

    if (category === 'Other Reason' && (!notes || !notes.trim())) {
      return res.status(400).json({ success: false, error: 'Custom explanation is required when "Other Reason" is selected.' });
    }

    const gadget = db.findById('gadgets', req.params.id);
    if (!gadget) {
      return res.status(404).json({ success: false, error: 'Gadget not found.' });
    }

    const reviewHistory = Array.isArray(gadget.reviewHistory) ? [...gadget.reviewHistory] : [];
    reviewHistory.push({
      action: 'REJECTED',
      reason: finalReason,
      category: category || 'Other Reason',
      notes: notes ? notes.trim() : '',
      reviewerId: req.user.id,
      reviewerName: req.user.name,
      date: new Date().toISOString()
    });

    const updated = db.update('gadgets', gadget.id, {
      status: 'REJECTED',
      rejectionReason: finalReason,
      rejectionCategory: category || null,
      rejectionNotes: notes ? notes.trim() : null,
      rejectedAt: new Date().toISOString(),
      rejectedBy: req.user.id,
      rejectedByName: req.user.name,
      reviewHistory
    });

    db.addAuditLog({
      userId: req.user.id,
      userRole: req.user.role,
      action: 'REJECT_GADGET',
      targetType: 'gadget',
      targetId: gadget.id,
      details: `Rejected gadget: ${gadget.brand} ${gadget.model}. Reason: ${finalReason}`,
      ipAddress: req.ip
    });

    // Notify student
    db.addNotification({
      userId: gadget.userId,
      title: 'Gadget Registration Rejected ⚠️',
      message: `Your registration for ${gadget.brand} ${gadget.model} was rejected by OSA.\nReason: ${finalReason}\n\nYou can edit your gadget details and resubmit for verification in the Student Portal.`,
      type: 'REGISTRATION_REJECTED',
      linkUrl: `/student/#gadgets`
    });

    return res.json({
      success: true,
      message: 'Gadget registration rejected.',
      gadget: updated
    });
  } catch (err) {
    console.error('Reject gadget error:', err);
    return res.status(500).json({ success: false, error: 'Error rejecting gadget.' });
  }
});

// PUT /api/gadgets/:id/resubmit (Student edits and resubmits rejected gadget)
const handleResubmit = async (req, res) => {
  try {
    const gadget = db.findById('gadgets', req.params.id);
    if (!gadget) {
      return res.status(404).json({ success: false, error: 'Gadget not found.' });
    }

    // Security: Students must only edit their own registrations
    if (gadget.userId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Unauthorized. You can only edit your own gadget registrations.' });
    }

    // Only rejected registrations can be edited and resubmitted via this workflow
    if (gadget.status !== 'REJECTED') {
      return res.status(400).json({ success: false, error: 'Only rejected registrations can be edited and resubmitted.' });
    }

    const { category, brand, model, serialNumber, color, description, photoUrl } = req.body;

    if (!brand || !brand.trim()) {
      return res.status(400).json({ success: false, error: 'Brand is required.' });
    }
    if (!model || !model.trim()) {
      return res.status(400).json({ success: false, error: 'Model is required.' });
    }

    // Check serial conflict if updated
    if (serialNumber && serialNumber.trim() && !serialNumber.startsWith('NO-SN-')) {
      const sn = serialNumber.trim().toLowerCase();
      const existingConflict = db.findOne('gadgets', g =>
        g.id !== gadget.id &&
        g.serialNumber &&
        g.serialNumber.trim().toLowerCase() === sn &&
        g.status !== 'REJECTED'
      );
      if (existingConflict) {
        return res.status(400).json({ success: false, error: 'Another approved or registered device with this serial number already exists.' });
      }
    }

    // Preserve original review history and audit trail
    const reviewHistory = Array.isArray(gadget.reviewHistory) ? [...gadget.reviewHistory] : [];
    reviewHistory.push({
      action: 'RESUBMITTED',
      previousData: {
        category: gadget.category,
        brand: gadget.brand,
        model: gadget.model,
        serialNumber: gadget.serialNumber,
        color: gadget.color,
        description: gadget.description,
        status: gadget.status
      },
      previousRejectionReason: gadget.rejectionReason,
      date: new Date().toISOString()
    });

    const finalSn = (serialNumber && serialNumber.trim())
      ? serialNumber.trim()
      : (gadget.serialNumber && !gadget.serialNumber.startsWith('NO-SN-') ? gadget.serialNumber : `NO-SN-${Date.now().toString(36).toUpperCase()}`);

    // Update the SAME gadget record in-place
    const updated = db.update('gadgets', gadget.id, {
      category: category || gadget.category,
      brand: brand.trim(),
      model: model.trim(),
      serialNumber: finalSn,
      color: color ? color.trim() : (gadget.color || 'Standard'),
      description: description !== undefined ? description.trim() : (gadget.description || ''),
      photoUrl: (photoUrl !== undefined) ? (photoUrl && photoUrl.trim() ? photoUrl.trim() : null) : (gadget.photoUrl || null),
      status: 'PENDING_APPROVAL',
      rejectionReason: null,
      lastResubmittedAt: new Date().toISOString(),
      reviewHistory
    });

    db.addAuditLog({
      userId: req.user.id,
      userRole: req.user.role,
      action: 'RESUBMIT_GADGET',
      targetType: 'gadget',
      targetId: gadget.id,
      details: `Student resubmitted gadget registration: ${updated.brand} ${updated.model} (S/N: ${updated.serialNumber})`,
      ipAddress: req.ip
    });

    db.addNotification({
      userId: req.user.id,
      title: 'Registration Resubmitted for Review 📝',
      message: `Your updated registration for ${updated.brand} ${updated.model} has been submitted to OSA for verification.`,
      type: 'SYSTEM',
      linkUrl: '/student/#gadgets'
    });

    return res.json({
      success: true,
      message: 'Gadget registration resubmitted for OSA review successfully.',
      gadget: updated
    });
  } catch (err) {
    console.error('Resubmit gadget error:', err);
    return res.status(500).json({ success: false, error: 'Server error resubmitting gadget.' });
  }
};

router.put('/:id/resubmit', authMiddleware, handleResubmit);
router.post('/:id/resubmit', authMiddleware, handleResubmit);

// PATCH /api/gadgets/:id/photo (Student or OSA directly updates or removes gadget photo)
router.patch('/:id/photo', authMiddleware, (req, res) => {
  try {
    const { photoUrl, removePhoto } = req.body;
    const gadget = db.findById('gadgets', req.params.id);
    if (!gadget) {
      return res.status(404).json({ success: false, error: 'Gadget not found.' });
    }

    // Only the authenticated gadget owner can update or remove their gadget photo
    if (gadget.userId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Permission denied. Only the gadget owner can update this photo.' });
    }

    let newPhoto = null;
    let actionLog = '';

    if (removePhoto || !photoUrl || !photoUrl.trim()) {
      newPhoto = null;
      actionLog = `Removed photo for ${gadget.brand} ${gadget.model}`;
    } else {
      const trimmed = photoUrl.trim();
      // Safe image validation: allow data URLs (base64 image uploads) or http(s) URLs
      if (!trimmed.startsWith('data:image/') && !trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        return res.status(400).json({ success: false, error: 'Invalid photo format. Must be an image URL or base64 image data.' });
      }
      newPhoto = trimmed;
      actionLog = `Updated photo for ${gadget.brand} ${gadget.model}`;
    }

    // Update gadget photo directly without altering lifecycle status or QR tokens
    const updated = db.update('gadgets', gadget.id, {
      photoUrl: newPhoto
    });

    db.addAuditLog({
      userId: req.user.id,
      userRole: req.user.role,
      action: removePhoto ? 'REMOVE_GADGET_PHOTO' : 'UPDATE_GADGET_PHOTO',
      targetType: 'gadget',
      targetId: gadget.id,
      details: actionLog,
      ipAddress: req.ip
    });

    return res.json({
      success: true,
      message: removePhoto ? 'Photo removed successfully.' : 'Gadget photo updated successfully.',
      gadget: updated
    });
  } catch (err) {
    console.error('Update photo error:', err);
    return res.status(500).json({ success: false, error: 'Error updating gadget photo.' });
  }
});

module.exports = router;
