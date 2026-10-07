const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../auth');
const { seedDatabase } = require('../seed');
const db = require('../db');

// GET /api/osa/stats (Dashboard Analytics & KPIs)
router.get('/stats', authMiddleware, requireRole('osa_admin'), (req, res) => {
  try {
    const gadgets = db.get('gadgets');
    const users = db.get('users');
    const scans = db.get('qr_scans');
    const missing = db.find('missing_reports', m => m.status === 'ACTIVE');
    const foundReports = db.get('found_reports');
    const claims = db.get('claims');
    const returns = db.get('returns');

    const totalGadgets = gadgets.length;
    const registeredGadgets = gadgets.filter(g => g.status === 'REGISTERED').length;
    const pendingGadgets = gadgets.filter(g => g.status === 'PENDING_APPROVAL').length;
    const missingGadgets = gadgets.filter(g => g.status === 'MISSING').length;
    const inCustodyGadgets = gadgets.filter(g => g.status === 'FOUND_IN_CUSTODY').length;
    const returnedGadgets = gadgets.filter(g => g.status === 'RETURNED').length;

    const totalUsers = users.length;
    const studentUsers = users.filter(u => u.role === 'student').length;
    const facultyUsers = users.filter(u => u.role === 'faculty' || u.role === 'staff').length;

    const pendingClaims = claims.filter(c => c.status === 'PENDING').length;
    const totalScans = scans.length;

    // Recent 10 activities
    const recentLogs = db.get('audit_logs').slice(-15).reverse();

    return res.json({
      success: true,
      stats: {
        totalGadgets,
        registeredGadgets,
        pendingGadgets,
        missingGadgets,
        inCustodyGadgets,
        returnedGadgets,
        totalUsers,
        studentUsers,
        facultyUsers,
        pendingClaims,
        totalScans,
        activeMissingCases: missing.length,
        totalFoundReports: foundReports.length,
        totalReturns: returns.length
      },
      recentActivities: recentLogs
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Error calculating stats.' });
  }
});

// POST /api/osa/return (Official Dispatch & Return to Owner with Photo Proof)
router.post('/return', authMiddleware, requireRole('osa_admin'), (req, res) => {
  try {
    const { gadgetId, claimId, receivedByPersonName, receivedByPersonId, notes, handoverPhotoUrl } = req.body;

    if (!gadgetId || !receivedByPersonName) {
      return res.status(400).json({ 
        success: false, 
        error: 'Gadget ID and recipient person name are required.' 
      });
    }

    // Section C: Photo proof of gadget handover is STRICTLY REQUIRED before completing return
    if (!handoverPhotoUrl || !handoverPhotoUrl.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Photo proof of gadget handover is required before completing the return.'
      });
    }

    const gadget = db.findById('gadgets', gadgetId);
    if (!gadget) {
      return res.status(404).json({ success: false, error: 'Gadget not found.' });
    }

    const owner = db.findById('users', gadget.userId);
    const returnDateIso = new Date().toISOString();
    const cleanPhotoUrl = handoverPhotoUrl.trim();

    // Create return record securely linked to gadget, student, admin, and photo proof
    const returnRecord = db.insert('returns', {
      id: 'ret_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
      gadgetId,
      userId: gadget.userId,
      ownerStudentId: owner ? (owner.idNumber || receivedByPersonId) : receivedByPersonId,
      claimId: claimId || null,
      returnedByOsaAdminId: req.user.id,
      returnedByOsaAdminName: req.user.name,
      receivedByPersonName: receivedByPersonName.trim(),
      receivedByPersonId: receivedByPersonId ? receivedByPersonId.trim() : (owner?.idNumber || 'ID Verified'),
      returnDate: returnDateIso,
      handoverPhotoUrl: cleanPhotoUrl,
      notes: notes ? notes.trim() : 'Official return handover completed at OSA Office.',
      signedReceiptAck: true
    });

    // Update gadget status back to active REGISTERED and store return link & handover photo
    db.update('gadgets', gadgetId, { 
      status: 'REGISTERED',
      custodyStatus: 'RETURNED_TO_OWNER',
      claimStatus: 'RETURNED',
      custodyLocation: null,
      lastReturnId: returnRecord.id,
      lastHandoverPhotoUrl: cleanPhotoUrl,
      lastReturnedAt: returnDateIso,
      lastReturnedByAdminId: req.user.id,
      lastReturnedByAdminName: req.user.name
    });

    // Close any active missing report and link photo proof
    const activeMissing = db.find('missing_reports', m => m.gadgetId === gadgetId && m.status === 'ACTIVE');
    activeMissing.forEach(m => db.update('missing_reports', m.id, { 
      status: 'RESOLVED',
      resolvedAt: returnDateIso,
      resolvedBy: req.user.id,
      handoverPhotoUrl: cleanPhotoUrl,
      returnId: returnRecord.id
    }));

    // Also close and resolve any found reports for this gadget
    const foundReports = db.find('found_reports', f => f.gadgetId === gadgetId);
    foundReports.forEach(f => {
      if (f.status !== 'RESOLVED' && f.status !== 'RETURNED') {
        db.update('found_reports', f.id, { 
          status: 'RETURNED', 
          handoverPhotoUrl: cleanPhotoUrl,
          returnId: returnRecord.id 
        });
      }
    });

    // Close any recovery chats
    const recoveryChats = db.find('recovery_chats', c => c.gadgetId === gadgetId);
    recoveryChats.forEach(c => {
      if (c.status !== 'CLOSED') {
        db.update('recovery_chats', c.id, { status: 'CLOSED', closedReason: 'OFFICIALLY_RETURNED_BY_OSA' });
      }
    });

    // Update or link claim record with status RETURNED and photo proof
    let targetClaim = (claimId && !claimId.startsWith('custody_')) 
      ? db.findById('claims', claimId) 
      : db.findOne('claims', c => c.gadgetId === gadgetId);
    if (targetClaim) {
      db.update('claims', targetClaim.id, { 
        status: 'RETURNED',
        handoverPhotoUrl: cleanPhotoUrl,
        returnedAt: returnDateIso,
        processedBy: req.user.id,
        processedByName: req.user.name,
        returnId: returnRecord.id
      });
    } else {
      db.insert('claims', {
        id: 'clm_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
        gadgetId,
        userId: gadget.userId,
        claimProofDetails: notes ? `Handover: ${notes.trim()}` : 'Official in-person gadget handover at OSA Room 1109.',
        verificationIdType: 'School ID',
        verificationIdNumber: receivedByPersonId ? receivedByPersonId.trim() : (owner?.idNumber || 'Verified'),
        status: 'RETURNED',
        createdAt: returnDateIso,
        processedBy: req.user.id,
        processedByName: req.user.name,
        processedAt: returnDateIso,
        handoverPhotoUrl: cleanPhotoUrl,
        returnId: returnRecord.id
      });
    }

    db.addAuditLog({
      userId: req.user.id,
      userRole: req.user.role,
      action: 'RETURN_GADGET',
      targetType: 'gadget',
      targetId: gadgetId,
      details: `Official gadget handover with photo proof: ${gadget.brand} ${gadget.model} returned to ${receivedByPersonName} (Ref: ${returnRecord.id})`,
      ipAddress: req.ip
    });

    // Notify Owner
    db.addNotification({
      userId: gadget.userId,
      title: 'Gadget Successfully Returned! 🎉',
      message: `Your ${gadget.brand} ${gadget.model} has been officially returned and recorded. Thank you for using GadgetGuard!`,
      type: 'RETURNED_SUCCESS',
      linkUrl: '/student/#returns'
    });

    return res.json({
      success: true,
      message: 'Gadget officially returned and receipt generated!',
      returnRecord
    });
  } catch (err) {
    console.error('Return error:', err);
    return res.status(500).json({ success: false, error: 'Error completing gadget return.' });
  }
});

// GET /api/osa/returns (Fetch all return records)
router.get('/returns', authMiddleware, (req, res) => {
  try {
    let returns = db.get('returns');
    
    // Non-admin only gets their own returns
    if (req.user.role !== 'osa_admin') {
      returns = returns.filter(r => r.userId === req.user.id);
    }

    returns.sort((a, b) => new Date(b.returnDate) - new Date(a.returnDate));

    const enriched = returns.map(r => {
      const gadget = db.findById('gadgets', r.gadgetId);
      const owner = db.findById('users', r.userId);
      const admin = db.findById('users', r.returnedByOsaAdminId);

      return {
        ...r,
        gadget: gadget ? {
          brand: gadget.brand,
          model: gadget.model,
          category: gadget.category,
          serialNumber: gadget.serialNumber,
          photoUrl: gadget.photoUrl
        } : null,
        owner: owner ? {
          name: owner.name,
          email: owner.email,
          idNumber: owner.idNumber,
          department: owner.department
        } : null,
        returnedByAdmin: admin ? admin.name : 'OSA Staff'
      };
    });

    return res.json({ success: true, returns: enriched });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Error fetching returns.' });
  }
});

// GET /api/osa/audit-logs (OSA Admin views audit logs)
router.get('/audit-logs', authMiddleware, requireRole('osa_admin'), (req, res) => {
  try {
    const logs = db.get('audit_logs');
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return res.json({ success: true, logs });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Error fetching audit logs.' });
  }
});

// GET /api/osa/settings
router.get('/settings', (req, res) => {
  return res.json({ success: true, settings: db.getSettings() });
});

// PUT /api/osa/settings (OSA Admin updates settings)
router.put('/settings', authMiddleware, requireRole('osa_admin'), (req, res) => {
  try {
    const updated = db.updateSettings(req.body);
    db.addAuditLog({
      userId: req.user.id,
      userRole: req.user.role,
      action: 'UPDATE_SETTINGS',
      targetType: 'system_settings',
      targetId: 'config',
      details: `Updated system settings`,
      ipAddress: req.ip
    });
    return res.json({ success: true, message: 'Settings updated successfully!', settings: updated });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Error updating settings.' });
  }
});

// POST /api/osa/reset-demo (Safely verify persistent test accounts without deleting records)
router.post('/reset-demo', authMiddleware, requireRole('osa_admin'), async (req, res) => {
  try {
    await seedDatabase();
    db.addAuditLog({
      userId: req.user.id,
      userRole: req.user.role,
      action: 'VERIFY_TEST_ACCOUNTS',
      targetType: 'system',
      targetId: 'all',
      details: 'OSA Administrator verified test accounts and database integrity',
      ipAddress: req.ip
    });
    return res.json({ success: true, message: 'Database verified. All records preserved.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Error verifying database.' });
  }
});

// POST /api/osa/resend-approval-email (Resend official approval email to verified student)
router.post('/resend-approval-email', authMiddleware, requireRole('osa_admin'), async (req, res) => {
  const mailer = require('../services/mailer');
  const { userId, gadgetId } = req.body;
  try {
    const user = userId ? db.findById('users', userId) : null;
    if (!user || !user.email) {
      return res.status(404).json({ success: false, error: 'Student user or email not found.' });
    }
    const userGadgets = db.find('gadgets', g => g.userId === user.id);
    const gadget = gadgetId ? db.findById('gadgets', gadgetId) : (userGadgets[0] || null);

    console.log(`📧 Manually resending approval email to ${user.email}...`);
    const mailRes = await mailer.sendApprovalEmail({
      studentEmail: user.email,
      studentName: user.name,
      studentId: user.idNumber,
      gadgetInfo: gadget ? {
        brand: gadget.brand,
        model: gadget.model,
        category: gadget.category,
        serialNumber: gadget.serialNumber
      } : null
    });

    db.addAuditLog({
      userId: req.user.id,
      userRole: req.user.role,
      action: 'RESEND_APPROVAL_EMAIL',
      targetType: 'user',
      targetId: user.id,
      details: `OSA Administrator resent approval email notification to ${user.email} (${user.name})`,
      ipAddress: req.ip
    });

    return res.json({ success: true, message: `Approval email sent to ${user.email}`, mailRes });
  } catch (err) {
    console.error('Resend email error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
