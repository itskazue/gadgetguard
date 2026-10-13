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

    // Distinct actionable items: gadgets currently in custody + pending student claims not already in custody
    const inCustodyGadgetIds = new Set(gadgets.filter(g => g.status === 'FOUND_IN_CUSTODY').map(g => g.id));
    const pendingClaims = claims.filter(c => c.status === 'PENDING').length;
    const pendingClaimsForNonCustody = claims.filter(c => {
      if (c.status !== 'PENDING') return false;
      if (inCustodyGadgetIds.has(c.gadgetId)) return false;
      const g = gadgets.find(x => x.id === c.gadgetId);
      if (g && g.lastReturnedAt && new Date(c.createdAt).getTime() <= new Date(g.lastReturnedAt).getTime()) {
        return false;
      }
      return true;
    }).length;
    const claimsBadgeCount = inCustodyGadgets + pendingClaimsForNonCustody;
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
        claimsBadgeCount,
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

    // Backend Protection & Idempotency: Device must currently be physically in custody to be returned
    if (gadget.status !== 'FOUND_IN_CUSTODY') {
      if (gadget.lastReturnId) {
        return res.status(400).json({ 
          success: false, 
          error: `Gadget is not currently in custody. This handover return has already been completed (Receipt: ${gadget.lastReturnId}).` 
        });
      }
      return res.status(400).json({ 
        success: false, 
        error: 'Gadget is not currently held in OSA custody vault.' 
      });
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
      surrenderStatus: null,
      pendingSurrenderRef: null,
      surrenderInfo: null,
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
    let targetClaim = null;
    if (claimId && !claimId.startsWith('custody_')) {
      targetClaim = db.findById('claims', claimId);
    } else {
      // Find an active/unfinalized claim for this gadget from the current recovery cycle
      targetClaim = db.findOne('claims', c => c.gadgetId === gadgetId && c.status !== 'RETURNED' && c.status !== 'CLAIMED');
    }
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

    // Resolve any remaining open unfinalized claims for this gadget from this cycle
    const resolvedClaimId = targetClaim ? targetClaim.id : null;
    const otherOpenClaims = db.find('claims', c => c.gadgetId === gadgetId && c.id !== resolvedClaimId && c.status !== 'RETURNED' && c.status !== 'CLAIMED');
    otherOpenClaims.forEach(oc => {
      db.update('claims', oc.id, {
        status: 'RESOLVED',
        notes: (oc.notes || oc.claimProofDetails || '') + ' [Closed upon official gadget return handover]',
        returnId: returnRecord.id,
        returnedAt: returnDateIso
      });
    });

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
      linkUrl: `/student/#returns?id=${returnRecord.id}`,
      returnId: returnRecord.id,
      gadgetId: gadget.id
    });

    const updatedGadget = db.findById('gadgets', gadgetId);
    return res.json({
      success: true,
      message: 'Gadget officially returned and receipt generated!',
      gadget: updatedGadget,
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

    returns.sort((a, b) => {
      const dateA = new Date(a.returnDate || a.returnedAt || a.createdAt || 0).getTime();
      const dateB = new Date(b.returnDate || b.returnedAt || b.createdAt || 0).getTime();
      return dateB - dateA;
    });

    const enriched = returns.map(r => {
      const gadget = db.findById('gadgets', r.gadgetId);
      const owner = db.findById('users', r.userId);
      const admin = db.findById('users', r.returnedByOsaAdminId);

      return {
        ...r,
        gadget: gadget ? {
          id: gadget.id,
          brand: gadget.brand,
          model: gadget.model,
          color: gadget.color || 'Standard',
          category: gadget.category,
          serialNumber: gadget.serialNumber,
          photoUrl: gadget.photoUrl,
          custodyLocation: r.previousVaultLocation || gadget.custodyLocation || 'OSA Vault Locker (Room 1109)'
        } : null,
        owner: owner ? {
          name: owner.name,
          email: owner.email,
          idNumber: owner.idNumber,
          department: owner.department
        } : null,
        returnedByAdmin: admin ? admin.name : (r.returnedByOsaAdminName || 'OSA Staff')
      };
    });

    return res.json({ success: true, returns: enriched });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Error fetching returns.' });
  }
});

// GET /api/osa/reports (Database-Driven Reports & Analytics with PHT Date Range Filtering)
router.get('/reports', authMiddleware, requireRole('osa_admin'), (req, res) => {
  try {
    const { range = 'ALL', from, to } = req.query;

    const gadgets = db.get('gadgets') || [];
    const missingReports = db.get('missing_reports') || [];
    const returns = db.get('returns') || [];

    // Helper: matches Philippine Time (UTC+8) date range with inclusive boundaries
    const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;
    const nowUtc = Date.now();
    const nowPht = new Date(nowUtc + PHT_OFFSET_MS);
    const nowYear = nowPht.getUTCFullYear();
    const nowMonth = nowPht.getUTCMonth();
    const nowDate = nowPht.getUTCDate();

    const startTodayUtcMs = Date.UTC(nowYear, nowMonth, nowDate) - PHT_OFFSET_MS;
    const endTodayUtcMs = startTodayUtcMs + (24 * 60 * 60 * 1000) - 1;

    function isDateInRange(dateInput) {
      if (!range || range === 'ALL') return true;
      if (!dateInput) return false;
      const d = new Date(dateInput);
      if (isNaN(d.getTime())) return false;
      const t = d.getTime();

      if (range === 'TODAY') {
        return t >= startTodayUtcMs && t <= endTodayUtcMs;
      }
      if (range === 'WEEK') {
        // Philippine calendar week (Monday 00:00:00.000 to Sunday 23:59:59.999 PHT)
        const dayOfWeek = nowPht.getUTCDay();
        const daysSinceMonday = (dayOfWeek + 6) % 7;
        const startWeekUtcMs = startTodayUtcMs - (daysSinceMonday * 24 * 60 * 60 * 1000);
        const endWeekUtcMs = startWeekUtcMs + (7 * 24 * 60 * 60 * 1000) - 1;
        return t >= startWeekUtcMs && t <= endWeekUtcMs;
      }
      if (range === 'MONTH') {
        const startMonthUtcMs = Date.UTC(nowYear, nowMonth, 1) - PHT_OFFSET_MS;
        const endMonthUtcMs = Date.UTC(nowYear, nowMonth + 1, 1) - PHT_OFFSET_MS - 1;
        return t >= startMonthUtcMs && t <= endMonthUtcMs;
      }
      if (range === 'YEAR') {
        const startYearUtcMs = Date.UTC(nowYear, 0, 1) - PHT_OFFSET_MS;
        const endYearUtcMs = Date.UTC(nowYear + 1, 0, 1) - PHT_OFFSET_MS - 1;
        return t >= startYearUtcMs && t <= endYearUtcMs;
      }
      if (range === 'CUSTOM') {
        let match = true;
        if (from) {
          const parts = from.split('-');
          if (parts.length === 3) {
            const fromUtcMs = Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)) - PHT_OFFSET_MS;
            if (t < fromUtcMs) match = false;
          }
        }
        if (to) {
          const parts = to.split('-');
          if (parts.length === 3) {
            const toUtcMs = Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)) - PHT_OFFSET_MS + (24 * 60 * 60 * 1000) - 1;
            if (t > toUtcMs) match = false;
          }
        }
        return match;
      }
      return true;
    }

    // 1. Current Inventory Snapshot Metrics
    const totalGadgets = gadgets.length;
    // Genuine active QR tags count all approved gadgets assigned a permanent valid QR token,
    // including missing gadgets whose physical QR code remains valid and scannable by finders.
    const activeStickers = gadgets.filter(g => Boolean(g.secureToken) && g.status !== 'REJECTED' && g.status !== 'PENDING_APPROVAL').length;

    // Category Distribution (Current Inventory Snapshot)
    const categoryCensus = {
      Laptop: 0,
      Smartphone: 0,
      Tablet: 0,
      Earbuds: 0,
      Camera: 0,
      Other: 0
    };
    gadgets.forEach(g => {
      const cat = g.category || 'Other';
      if (categoryCensus[cat] !== undefined) categoryCensus[cat]++;
      else categoryCensus.Other++;
    });

    // Asset Status Distribution (Current Inventory Snapshot)
    const statusCensus = {
      registered: gadgets.filter(g => g.status === 'REGISTERED').length,
      custody: gadgets.filter(g => g.status === 'FOUND_IN_CUSTODY').length,
      returned: gadgets.filter(g => g.status === 'RETURNED').length,
      pending: gadgets.filter(g => g.status === 'PENDING_APPROVAL').length,
      missing: gadgets.filter(g => g.status === 'MISSING').length
    };

    // 2. Historical Incident Performance (Period-Filtered)
    // Non-cancelled missing incidents whose reported date is within the selected range
    const periodIncidents = missingReports.filter(m => {
      if (m.status === 'CANCELLED') return false;
      const incidentDate = m.reportedAt || m.createdAt || m.lastSeenDate;
      return isDateInRange(incidentDate);
    });

    const totalMissingIncidents = periodIncidents.length;
    let recoveredIncidentsCount = 0;
    const resolutionDurationsMs = [];

    periodIncidents.forEach(m => {
      const g = gadgets.find(x => x.id === m.gadgetId);
      const matchingReturn = returns.find(r => r.gadgetId === m.gadgetId && new Date(r.returnDate || r.createdAt).getTime() >= new Date(m.reportedAt || m.createdAt).getTime());

      const isRecovered = (
        m.status === 'RESOLVED' ||
        Boolean(matchingReturn) ||
        (g && (g.status === 'RETURNED' || g.status === 'FOUND_IN_CUSTODY'))
      );

      if (isRecovered) {
        recoveredIncidentsCount++;

        // Calculate resolution duration
        const reportTimeMs = new Date(m.reportedAt || m.createdAt || m.lastSeenDate).getTime();
        let resolveTimeMs = null;

        if (matchingReturn) {
          resolveTimeMs = new Date(matchingReturn.returnDate || matchingReturn.createdAt).getTime();
        } else if (m.resolvedAt) {
          resolveTimeMs = new Date(m.resolvedAt).getTime();
        } else if (g && g.lastReturnedAt) {
          resolveTimeMs = new Date(g.lastReturnedAt).getTime();
        }

        if (reportTimeMs && resolveTimeMs && resolveTimeMs >= reportTimeMs) {
          resolutionDurationsMs.push(resolveTimeMs - reportTimeMs);
        }
      }
    });

    // Recovery Rate: percentage (0-100) or null (N/A)
    const recoverySuccessRate = totalMissingIncidents > 0 
      ? Math.round((recoveredIncidentsCount / totalMissingIncidents) * 1000) / 10 
      : null;

    // Average Resolution Speed: milliseconds or null (N/A)
    const avgResolutionSpeedMs = resolutionDurationsMs.length > 0
      ? Math.round(resolutionDurationsMs.reduce((a, b) => a + b, 0) / resolutionDurationsMs.length)
      : null;

    return res.json({
      success: true,
      period: {
        range,
        from: from || null,
        to: to || null
      },
      kpis: {
        recoverySuccessRate,
        totalMissingIncidents,
        recoveredIncidentsCount,
        avgResolutionSpeedMs,
        timedIncidentsCount: resolutionDurationsMs.length,
        totalLifecycleAssets: totalGadgets,
        activeQrTags: activeStickers
      },
      charts: {
        categoryCensus,
        statusCensus,
        totalAssets: totalGadgets
      }
    });
  } catch (err) {
    console.error('Error generating reports:', err);
    return res.status(500).json({ success: false, error: 'Error generating reports analytics.' });
  }
});

// GET /api/osa/audit-logs (OSA Admin views audit logs)
router.get('/audit-logs', authMiddleware, requireRole('osa_admin'), (req, res) => {
  try {
    const logs = [...db.get('audit_logs')];
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const users = db.get('users');
    const userMap = new Map((users || []).map(u => [u.id, u]));
    const enriched = logs.map(l => {
      const u = userMap.get(l.userId);
      return {
        ...l,
        userName: u ? u.name : (l.userId === 'PUBLIC_FINDER' ? 'Public Finder' : (l.userId === 'SYSTEM' ? 'System' : l.userId)),
        userStudentId: u ? u.idNumber : null,
        userRole: l.userRole || (u ? u.role : 'system')
      };
    });
    return res.json({ success: true, logs: enriched });
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
      } : null,
      req
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
