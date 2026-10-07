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

    // Default category photo placeholders if not uploaded
    const defaultPhotos = {
      Laptop: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=500&auto=format&fit=crop&q=80',
      Smartphone: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=500&auto=format&fit=crop&q=80',
      Tablet: 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=500&auto=format&fit=crop&q=80',
      Earbuds: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=500&auto=format&fit=crop&q=80',
      Calculator: 'https://images.unsplash.com/photo-1587145820266-a5951ee6f620?w=500&auto=format&fit=crop&q=80',
      Smartwatch: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500&auto=format&fit=crop&q=80',
      Camera: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=500&auto=format&fit=crop&q=80',
      Other: 'https://images.unsplash.com/photo-1526738549149-8e07eca6c147?w=500&auto=format&fit=crop&q=80'
    };

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
      photoUrl: photoUrl || defaultPhotos[category] || defaultPhotos.Other,
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

      // If a finder reported finding the gadget and chose to keep it safe
      let finderInfo = null;
      if (g.status === 'MISSING') {
        const foundReport = db.findOne('found_reports', f => f.gadgetId === g.id && f.status !== 'PROCESSED_BY_OSA' && f.status !== 'RETURNED' && f.status !== 'RESOLVED' && f.status !== 'CANCELLED');
        if (foundReport && (foundReport.turnInMethod === 'KEPT_SAFE' || foundReport.turnInMethod === 'KEPT_SAFE_CONTACT_ME' || foundReport.turnInMethod === 'FINDER_HOLDING')) {
          const activeChat = db.findOne('recovery_chats', c => c.gadgetId === g.id && c.status === 'ACTIVE');
          finderInfo = {
            id: foundReport.id,
            finderName: foundReport.finderName || 'Finder',
            foundLocation: foundReport.foundLocation,
            action: 'Keeping Gadget Safe',
            turnInMethod: 'KEPT_SAFE',
            foundDate: foundReport.foundDate,
            message: foundReport.message || foundReport.notes || '',
            chatId: activeChat ? activeChat.id : null
          };
        }
      }

      // If a finder reported finding the gadget and chose to surrender to OSA
      let surrenderInfo = null;
      if (g.status === 'MISSING') {
        const surrenderReport = db.findOne('found_reports', f => f.gadgetId === g.id && (f.turnInMethod === 'SUBMITTED_TO_OSA' || f.finderDecision === 'WILL_SURRENDER_TO_OSA') && f.status === 'PENDING_OSA_TURNOVER');
        if (surrenderReport) {
          surrenderInfo = {
            id: surrenderReport.id,
            surrenderReference: surrenderReport.surrenderReference,
            finderName: surrenderReport.finderName || 'Finder',
            foundLocation: surrenderReport.foundLocation,
            foundDate: surrenderReport.foundDate,
            status: 'PENDING_OSA_TURNOVER',
            message: surrenderReport.message || ''
          };
        }
      }

      return {
        ...g,
        missingReport: missingReport || null,
        scanCount,
        latestClaim: latestClaim || null,
        finderInfo,
        surrenderInfo
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
          }
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
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, error: 'Rejection reason is required.' });
    }

    const gadget = db.findById('gadgets', req.params.id);
    if (!gadget) {
      return res.status(404).json({ success: false, error: 'Gadget not found.' });
    }

    const updated = db.update('gadgets', gadget.id, {
      status: 'REJECTED',
      rejectionReason: reason.trim()
    });

    db.addAuditLog({
      userId: req.user.id,
      userRole: req.user.role,
      action: 'REJECT_GADGET',
      targetType: 'gadget',
      targetId: gadget.id,
      details: `Rejected gadget: ${gadget.brand} ${gadget.model}. Reason: ${reason.trim()}`,
      ipAddress: req.ip
    });

    // Notify student
    db.addNotification({
      userId: gadget.userId,
      title: 'Gadget Registration Rejected ⚠️',
      message: `Your registration for ${gadget.brand} ${gadget.model} was rejected by OSA. Reason: ${reason.trim()}`,
      type: 'REGISTRATION_REJECTED',
      linkUrl: `/student/#gadgets`
    });

    return res.json({
      success: true,
      message: 'Gadget registration rejected.',
      gadget: updated
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Error rejecting gadget.' });
  }
});

// PATCH /api/gadgets/:id/photo (Student or OSA updates or removes gadget photo/proof)
router.patch('/:id/photo', authMiddleware, (req, res) => {
  try {
    const { photoUrl, removePhoto } = req.body;
    const gadget = db.findById('gadgets', req.params.id);
    if (!gadget) {
      return res.status(404).json({ success: false, error: 'Gadget not found.' });
    }

    // Must be owner or OSA admin
    if (req.user.role !== 'osa_admin' && gadget.userId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Permission denied to update this device photo.' });
    }

    const defaultPhotos = {
      Smartphone: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=500&auto=format&fit=crop&q=80',
      Laptop: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=500&auto=format&fit=crop&q=80',
      Tablet: 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=500&auto=format&fit=crop&q=80',
      Earbuds: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=500&auto=format&fit=crop&q=80',
      Calculator: 'https://images.unsplash.com/photo-1587145820266-a5951ee6f620?w=500&auto=format&fit=crop&q=80',
      Smartwatch: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500&auto=format&fit=crop&q=80',
      Camera: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=500&auto=format&fit=crop&q=80',
      Other: 'https://images.unsplash.com/photo-1526738549149-8e07eca6c147?w=500&auto=format&fit=crop&q=80'
    };

    let newPhoto = null;
    let actionLog = '';
    if (removePhoto || !photoUrl || !photoUrl.trim()) {
      newPhoto = defaultPhotos[gadget.category] || defaultPhotos.Other;
      actionLog = `Removed custom photo/proof for ${gadget.brand} ${gadget.model}`;
    } else {
      newPhoto = photoUrl.trim();
      actionLog = `Updated device photo/proof for ${gadget.brand} ${gadget.model}`;
    }

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
      message: removePhoto ? 'Photo proof removed successfully.' : 'Gadget photo updated successfully.',
      gadget: updated
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Error updating gadget photo.' });
  }
});

module.exports = router;
