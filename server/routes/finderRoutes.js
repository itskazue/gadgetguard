const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { authMiddleware, requireRole } = require('../auth');
const db = require('../db');

// POST /api/finder/report (Public Finder submits found report for a gadget)
router.post('/report', (req, res) => {
  try {
    const token = req.body.token || req.body.secureToken || req.body.gadgetToken;
    const gadgetId = req.body.gadgetId;
    const finderName = req.body.finderName;
    const finderContact = req.body.finderContact || req.body.contactNumber || req.body.contact;
    const foundLocation = req.body.foundLocation || req.body.location;
    const foundDate = req.body.foundDate;
    const itemCondition = req.body.itemCondition || req.body.condition;
    const turnInMethod = req.body.turnInMethod;
    const message = req.body.message || req.body.notes;

    let targetGadget = null;
    if (token) {
      targetGadget = db.findOne('gadgets', g => g.secureToken === token || g.id === token);
    } else if (gadgetId) {
      targetGadget = db.findById('gadgets', gadgetId) || db.findOne('gadgets', g => g.secureToken === gadgetId);
    }

    if (!targetGadget) {
      return res.status(404).json({ success: false, error: 'Target gadget not found.' });
    }

    // Check if finder already has an existing active recovery session for this gadget
    const clientFinderToken = req.headers['x-finder-token'] || req.body.finderSessionToken || req.body.finderToken;
    if (clientFinderToken) {
      const existingChat = db.findOne('recovery_chats', c => c.gadgetId === targetGadget.id && c.finderSessionToken === clientFinderToken);
      if (existingChat) {
        const isClosed = (existingChat.status === 'CLOSED' || targetGadget.status !== 'MISSING');
        return res.status(200).json({
          success: true,
          message: 'Active finder recovery session already exists. Reconnecting to your existing chat.',
          isExistingSession: true,
          chat: {
            id: existingChat.id,
            finderSessionToken: existingChat.finderSessionToken,
            finderName: existingChat.finderName || 'Finder',
            foundLocation: existingChat.foundLocation,
            missingReportId: existingChat.missingReportId,
            status: existingChat.status,
            isClosed,
            gadget: {
              id: targetGadget.id,
              brand: targetGadget.brand,
              model: targetGadget.model
            }
          }
        });
      }
    }

    // Found Location is REQUIRED (manually entered by the finder)
    if (!foundLocation || !foundLocation.trim()) {
      return res.status(400).json({ success: false, error: 'Found location is required.' });
    }
    const cleanFoundLocation = foundLocation.trim();

    // Finder Name is OPTIONAL; defaults to "Finder" if blank
    let effectiveFinderName = 'Finder';
    if (finderName && finderName.trim()) {
      const trimmedName = finderName.trim();
      const nameRegex = /^[a-zA-ZñÑ\s\.\,\-]+$/;
      if (!nameRegex.test(trimmedName)) {
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid Finder Name: Name must only contain letters and spaces.' 
        });
      }
      effectiveFinderName = trimmedName;
    }

    // Contact Number is OPTIONAL (only accessible by authorized OSA staff, never exposed to owner or publicly)
    let effectiveFinderContact = '';
    if (finderContact && typeof finderContact === 'string') {
      effectiveFinderContact = finderContact.trim().substring(0, 30);
    }

    // Determine Turn-in Action
    const isKeeping = (turnInMethod === 'KEPT_SAFE' || turnInMethod === 'KEPT_SAFE_CONTACT_ME' || turnInMethod === 'FINDER_HOLDING');
    const effectiveTurnInMethod = isKeeping ? 'KEPT_SAFE' : 'SUBMITTED_TO_OSA';

    const activeMissing = db.findOne('missing_reports', m => m.gadgetId === targetGadget.id && m.status === 'ACTIVE');
    const surrenderRef = 'SRF-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

    // Insert Found Report record
    const report = db.insert('found_reports', {
      id: 'fnd_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
      surrenderReference: surrenderRef,
      gadgetId: targetGadget.id,
      missingReportId: activeMissing ? activeMissing.id : null,
      finderName: effectiveFinderName,
      finderContact: effectiveFinderContact, // Strictly for authorized OSA use
      finderEmail: '',
      foundLocation: cleanFoundLocation,
      foundDate: foundDate || new Date().toISOString(),
      itemCondition: itemCondition || 'Good',
      turnInMethod: effectiveTurnInMethod,
      message: message ? message.trim() : '',
      status: isKeeping ? 'REPORTED' : 'PENDING_OSA_TURNOVER',
      finderDecision: isKeeping ? 'KEPT_SAFE' : 'WILL_SURRENDER_TO_OSA'
    });

    db.addAuditLog({
      userId: 'PUBLIC_FINDER',
      userRole: 'public',
      action: 'SUBMIT_FOUND_REPORT',
      targetType: 'gadget',
      targetId: targetGadget.id,
      details: `Finder (${effectiveFinderName}) reported finding ${targetGadget.brand} ${targetGadget.model} at ${cleanFoundLocation} (Decision: ${isKeeping ? 'Keeping Gadget Safe' : 'Will Surrender to OSA, Ref: ' + surrenderRef})`,
      ipAddress: req.ip
    });

    let recoveryChat = null;

    if (isKeeping) {
      // Create secure temporary recovery chat
      const finderSessionToken = 'fnd_sec_' + crypto.randomBytes(16).toString('hex');
      const chatId = 'cht_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);

      recoveryChat = db.insert('recovery_chats', {
        id: chatId,
        gadgetId: targetGadget.id,
        missingReportId: activeMissing ? activeMissing.id : null,
        foundReportId: report.id,
        finderSessionToken,
        finderName: effectiveFinderName,
        foundLocation: cleanFoundLocation,
        ownerUserId: targetGadget.userId,
        status: 'ACTIVE',
        messages: [],
        createdAt: new Date().toISOString()
      });

      // Update Owner Notification: Title "Someone Found Your Gadget" + Safety Notice
      const safetyNoticeText = `⚠️ Safety & Liability Notice\nPlease prioritize your safety when arranging the return of a missing gadget.\nGadgetGuard and the school/OSA provide this platform to facilitate communication between the gadget owner and finder. Any personal meetup or arrangement outside the school/OSA is the responsibility of the individuals involved.\nThe school/OSA is not responsible for incidents, injuries, losses, or other circumstances arising from personal meetups conducted outside official school premises or OSA-supervised procedures.\nFor your safety, we strongly recommend arranging the return through the Office of Student Affairs (OSA – Room 1109).\nIf a personal meetup is necessary, choose a safe and public location, such as a police station or busy mall, and inform someone you trust.`;

      db.addNotification({
        userId: targetGadget.userId,
        title: 'Someone Found Your Gadget',
        message: `Good news! Someone found your missing ${targetGadget.brand} ${targetGadget.model} and is keeping it safe.\n\n👤 Finder: ${effectiveFinderName}\n📍 Found At: ${cleanFoundLocation}\n📋 Action: Keeping Gadget Safe\n\n💬 You can now communicate securely through the GadgetGuard built-in private chat to coordinate safe return.\n\n${safetyNoticeText}`,
        type: 'GADGET_FOUND',
        linkUrl: '/student/#lost-status'
      });

      // Notify OSA Admins
      const osaAdmins = db.find('users', u => u.role === 'osa_admin');
      osaAdmins.forEach(admin => {
        db.addNotification({
          userId: admin.id,
          title: 'Found Report: Finder Keeping Safe 📦',
          message: `Finder (${effectiveFinderName}) found ${targetGadget.brand} ${targetGadget.model} at ${cleanFoundLocation} and is keeping it safe. Private chat enabled.`,
          type: 'GADGET_FOUND',
          linkUrl: '/osa/#found'
        });
      });

      return res.status(201).json({
        success: true,
        message: 'Found report logged. You are now connected to the private recovery chat.',
        report,
        chat: {
          id: recoveryChat.id,
          finderSessionToken: recoveryChat.finderSessionToken,
          finderName: effectiveFinderName,
          foundLocation: cleanFoundLocation,
          missingReportId: recoveryChat.missingReportId,
          status: recoveryChat.status,
          isClosed: false,
          gadget: {
            id: targetGadget.id,
            brand: targetGadget.brand,
            model: targetGadget.model
          }
        }
      });
    } else {
      // IF "I WILL SURRENDER IT TO OSA" IS SELECTED:
      // Record custody progression: MISSING -> WILL SURRENDER TO OSA -> PENDING OSA TURNOVER
      // Do NOT mark as physically received by OSA yet (actual receipt requires OSA confirmation).
      db.update('gadgets', targetGadget.id, {
        custodyStatus: 'PENDING_OSA_TURNOVER',
        surrenderStatus: 'WILL_SURRENDER_TO_OSA',
        pendingSurrenderRef: surrenderRef
      });

      // Notify gadget owner that finder indicated intent to surrender via Campus Security / OSA
      // (Strictly do not expose finder's optional contact number to owner)
      db.addNotification({
        userId: targetGadget.userId,
        title: 'Finder Plans to Surrender Your Gadget 🏢',
        message: `A finder has indicated that they will surrender your missing gadget through Campus Security/OSA.\n\n📍 Found At: ${cleanFoundLocation}\n📋 Status: Pending Turnover to Campus Security & OSA\nRef: ${surrenderRef}\n\nYou will be notified once OSA physically receives and confirms possession of your device.`,
        type: 'GADGET_FOUND',
        linkUrl: '/student/#lost-status'
      });

      // Notify OSA Admins (authorized OSA staff can access contact number if voluntarily provided)
      const osaAdmins = db.find('users', u => u.role === 'osa_admin');
      osaAdmins.forEach(admin => {
        db.addNotification({
          userId: admin.id,
          title: 'Found Gadget Surrender Pending 📦',
          message: `Finder (${effectiveFinderName}${effectiveFinderContact ? ', Tel: ' + effectiveFinderContact : ''}) reported finding ${targetGadget.brand} ${targetGadget.model} at ${cleanFoundLocation} and intends to surrender it via Campus Security Guard / OSA Room 1109. Ref: ${surrenderRef}`,
          type: 'GADGET_FOUND',
          linkUrl: '/osa/#found'
        });
      });

      const owner = db.findById('users', targetGadget.userId);
      const studentIdNumber = owner ? (owner.idNumber || 'N/A') : 'N/A';

      return res.status(201).json({
        success: true,
        message: 'Thank you for helping our school community! Please bring the device to the designated Campus Security Guard or OSA Room 1109.',
        report: {
          id: report.id,
          surrenderReference: surrenderRef,
          gadgetId: report.gadgetId,
          finderName: report.finderName,
          foundLocation: report.foundLocation,
          foundDate: report.foundDate,
          status: report.status
        },
        surrenderReference: surrenderRef,
        gadgetName: `${targetGadget.brand} ${targetGadget.model}`,
        gadgetId: targetGadget.id,
        studentIdNumber,
        status: 'Missing (Pending Turnover)',
        chat: null
      });
    }
  } catch (err) {
    console.error('Finder report error:', err);
    return res.status(500).json({ success: false, error: 'Server error submitting found report.' });
  }
});

// GET /api/finder/reports (OSA Admin fetches all finder submissions)
router.get('/reports', authMiddleware, requireRole('osa_admin'), (req, res) => {
  try {
    const reports = db.get('found_reports');
    reports.sort((a, b) => new Date(b.createdAt || b.foundDate) - new Date(a.createdAt || a.foundDate));

    const enriched = reports.map(r => {
      const gadget = db.findById('gadgets', r.gadgetId);
      const owner = gadget ? db.findById('users', gadget.userId) : null;
      return {
        ...r,
        surrenderReference: r.surrenderReference || ('SRF-' + r.id.replace('fnd_', '').toUpperCase()),
        gadget: gadget ? {
          id: gadget.id,
          brand: gadget.brand,
          model: gadget.model,
          category: gadget.category,
          serialNumber: gadget.serialNumber,
          status: gadget.status,
          custodyStatus: gadget.custodyStatus,
          photoUrl: gadget.photoUrl
        } : null,
        owner: owner ? {
          name: owner.name,
          email: owner.email,
          idNumber: owner.idNumber,
          contactNumber: owner.contactNumber,
          department: owner.department
        } : null
      };
    });

    return res.json({ success: true, reports: enriched });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Error fetching found reports.' });
  }
});

// POST /api/finder/:id/receive (OSA confirms physical receipt of surrendered item)
router.post('/:id/receive', authMiddleware, requireRole('osa_admin'), (req, res) => {
  try {
    const { custodyLocation, notes } = req.body;
    const searchId = req.params.id;

    let report = db.findById('found_reports', searchId) || 
      db.findOne('found_reports', f => f.surrenderReference === searchId);
    let gadget = null;

    if (report) {
      gadget = db.findById('gadgets', report.gadgetId);
    } else {
      // Check if :id is directly a gadgetId, token, or missing report ID
      gadget = db.findById('gadgets', searchId) || db.findOne('gadgets', g => g.secureToken === searchId);
      if (!gadget) {
        const missingRep = db.findById('missing_reports', searchId);
        if (missingRep) {
          gadget = db.findById('gadgets', missingRep.gadgetId);
        }
      }
      if (gadget) {
        report = db.findOne('found_reports', f => f.gadgetId === gadget.id && f.status !== 'RETURNED');
      }
    }

    if (!gadget) {
      return res.status(404).json({ success: false, error: 'Gadget not found for custody intake.' });
    }

    const receivedDateIso = new Date().toISOString();
    const finalCustodyLoc = custodyLocation || 'OSA Lost & Found Locker (Room 1109)';

    // Update active missing reports for this gadget to reflect IN_OSA_CUSTODY
    const activeMissing = db.find('missing_reports', m => m.gadgetId === gadget.id && m.status === 'ACTIVE');
    activeMissing.forEach(m => db.update('missing_reports', m.id, { 
      status: 'IN_OSA_CUSTODY',
      custodyReceivedAt: receivedDateIso,
      receivedByStaffId: req.user.id
    }));

    // If found report exists, update status to IN_OSA_CUSTODY. If face-to-face walk-in, insert record.
    if (report) {
      db.update('found_reports', report.id, {
        status: 'IN_OSA_CUSTODY',
        custodyLocation: finalCustodyLoc,
        custodyNotes: notes || '',
        receivedAtOsaDate: receivedDateIso,
        receivedByOsaStaffId: req.user.id,
        receivedByOsaStaffName: req.user.name
      });
    } else {
      report = db.insert('found_reports', {
        id: 'fnd_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
        surrenderReference: 'SRF-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase(),
        gadgetId: gadget.id,
        finderName: 'Face-to-Face Walk-in (Surrendered at OSA)',
        finderContact: 'N/A (In-person)',
        finderEmail: '',
        foundLocation: 'OSA Desk Room 1109',
        foundDate: receivedDateIso,
        itemCondition: 'Good',
        turnInMethod: 'SUBMITTED_TO_OSA',
        message: notes || 'Surrendered directly to OSA front desk.',
        status: 'IN_OSA_CUSTODY',
        custodyLocation: finalCustodyLoc,
        custodyNotes: notes || '',
        receivedAtOsaDate: receivedDateIso,
        receivedByOsaStaffId: req.user.id,
        receivedByOsaStaffName: req.user.name
      });
    }

    // Update gadget status to FOUND_IN_CUSTODY & custody progression to IN_OSA_CUSTODY
    const updatedGadget = db.update('gadgets', gadget.id, {
      status: 'FOUND_IN_CUSTODY',
      custodyStatus: 'IN_OSA_CUSTODY',
      claimStatus: 'READY_FOR_CLAIM',
      custodyLocation: finalCustodyLoc,
      receivedAtOsaDate: receivedDateIso,
      receivedByOsaStaffId: req.user.id,
      receivedByOsaStaffName: req.user.name
    });

    // Close any active recovery chats for this gadget
    const activeChats = db.find('recovery_chats', c => c.gadgetId === gadget.id);
    activeChats.forEach(c => {
      if (c.status !== 'CLOSED') {
        db.update('recovery_chats', c.id, { status: 'CLOSED', closedReason: 'OSA_PHYSICAL_CUSTODY' });
      }
    });

    db.addAuditLog({
      userId: req.user.id,
      userRole: req.user.role,
      action: 'RECEIVE_INTO_CUSTODY',
      targetType: 'gadget',
      targetId: gadget.id,
      details: `Confirmed physical turnover: ${gadget.brand} ${gadget.model} received into OSA custody (${finalCustodyLoc}). Ready for owner claim.`,
      ipAddress: req.ip
    });

    // Owner Notification: "Your missing gadget has been received by OSA and is now available for claim/verification."
    db.addNotification({
      userId: gadget.userId,
      title: 'Your Gadget is in OSA Custody! 🏢',
      message: `Your missing gadget has been received by OSA and is now available for claim/verification.\n\nDevice: ${gadget.brand} ${gadget.model}\nCustody Location: ${finalCustodyLoc}\n\nPlease visit the Office of Student Affairs (Room 1109) or submit an ownership claim to arrange turnover.`,
      type: 'GADGET_FOUND',
      linkUrl: '/student/#claims'
    });

    return res.json({
      success: true,
      message: 'Item received into OSA custody. Owner notified!',
      gadget: updatedGadget,
      report
    });
  } catch (err) {
    console.error('Receive custody error:', err);
    return res.status(500).json({ success: false, error: 'Error receiving item into custody.' });
  }
});

module.exports = router;
