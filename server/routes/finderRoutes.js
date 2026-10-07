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

    // Determine Turn-in Action
    const isKeeping = (turnInMethod === 'KEPT_SAFE' || turnInMethod === 'KEPT_SAFE_CONTACT_ME' || turnInMethod === 'FINDER_HOLDING');
    const effectiveTurnInMethod = isKeeping ? 'KEPT_SAFE' : 'SUBMITTED_TO_OSA';

    // Insert Found Report record
    const report = db.insert('found_reports', {
      id: 'fnd_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
      gadgetId: targetGadget.id,
      finderName: effectiveFinderName,
      finderContact: '', // Contact number is NOT asked for or stored
      finderEmail: '',
      foundLocation: cleanFoundLocation,
      foundDate: foundDate || new Date().toISOString(),
      itemCondition: itemCondition || 'Good',
      turnInMethod: effectiveTurnInMethod,
      message: message ? message.trim() : '',
      status: 'REPORTED'
    });

    db.addAuditLog({
      userId: 'PUBLIC_FINDER',
      userRole: 'public',
      action: 'SUBMIT_FOUND_REPORT',
      targetType: 'gadget',
      targetId: targetGadget.id,
      details: `Finder (${effectiveFinderName}) reported finding ${targetGadget.brand} ${targetGadget.model} at ${cleanFoundLocation} (Action: ${isKeeping ? 'Keeping Gadget Safe' : 'Will Surrender to OSA'})`,
      ipAddress: req.ip
    });

    let recoveryChat = null;

    if (isKeeping) {
      // Create secure temporary recovery chat
      const activeMissing = db.findOne('missing_reports', m => m.gadgetId === targetGadget.id && m.status === 'ACTIVE');
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
      // No chat is created. Record action as "Will Surrender to OSA".
      // Notify gadget owner that finder intends to surrender gadget to OSA.
      db.addNotification({
        userId: targetGadget.userId,
        title: 'Someone Found Your Gadget 🏢',
        message: `Good news! A finder found your ${targetGadget.brand} ${targetGadget.model} at ${cleanFoundLocation} and indicated: Will Surrender to OSA.\n\nAction: Will Surrender to OSA (Room 1109)\n\nYou will be notified once OSA verifies and receives the device into physical custody.`,
        type: 'GADGET_FOUND',
        linkUrl: '/student/#lost-status'
      });

      // Notify OSA Admins
      const osaAdmins = db.find('users', u => u.role === 'osa_admin');
      osaAdmins.forEach(admin => {
        db.addNotification({
          userId: admin.id,
          title: 'Found Gadget Surrender Pending 📦',
          message: `Finder (${effectiveFinderName}) reported finding ${targetGadget.brand} ${targetGadget.model} at ${cleanFoundLocation} and intends to surrender it to OSA Room 1109.`,
          type: 'GADGET_FOUND',
          linkUrl: '/osa/#found'
        });
      });

      return res.status(201).json({
        success: true,
        message: 'Thank you! Please surrender the device to OSA Room 1109 or to any on-duty Campus Security Guard.',
        report,
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
    reports.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const enriched = reports.map(r => {
      const gadget = db.findById('gadgets', r.gadgetId);
      const owner = gadget ? db.findById('users', gadget.userId) : null;
      return {
        ...r,
        gadget: gadget ? {
          id: gadget.id,
          brand: gadget.brand,
          model: gadget.model,
          category: gadget.category,
          serialNumber: gadget.serialNumber,
          status: gadget.status,
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

// POST /api/finder/:id/receive (OSA accepts item into physical custody)
router.post('/:id/receive', authMiddleware, requireRole('osa_admin'), (req, res) => {
  try {
    const { custodyLocation, notes } = req.body;
    let report = db.findById('found_reports', req.params.id);
    let gadget = null;

    if (report) {
      gadget = db.findById('gadgets', report.gadgetId);
    } else {
      // Check if :id is directly a gadgetId or missing report ID
      gadget = db.findById('gadgets', req.params.id);
      if (!gadget) {
        const missingRep = db.findById('missing_reports', req.params.id);
        if (missingRep) {
          gadget = db.findById('gadgets', missingRep.gadgetId);
        }
      }
      if (gadget) {
        report = db.findOne('found_reports', f => f.gadgetId === gadget.id);
      }
    }

    if (!gadget) {
      return res.status(404).json({ success: false, error: 'Gadget not found for custody intake.' });
    }

    // Resolve any active missing report for this gadget
    const activeMissing = db.find('missing_reports', m => m.gadgetId === gadget.id && m.status === 'ACTIVE');
    activeMissing.forEach(m => db.update('missing_reports', m.id, { status: 'RESOLVED' }));

    // If report exists, update status. If not (face-to-face walk-in surrender), insert new found record
    if (report) {
      db.update('found_reports', report.id, {
        status: 'PROCESSED_BY_OSA',
        custodyNotes: notes || ''
      });
    } else {
      db.insert('found_reports', {
        id: 'fnd_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
        gadgetId: gadget.id,
        finderName: 'Face-to-Face Walk-in (Surrendered at OSA)',
        finderContact: 'N/A (In-person)',
        finderEmail: '',
        foundLocation: 'OSA Desk Room 1109',
        foundDate: new Date().toISOString(),
        itemCondition: 'Good',
        turnInMethod: 'SUBMITTED_TO_OSA',
        message: notes || 'Surrendered directly to OSA front desk.',
        status: 'PROCESSED_BY_OSA',
        custodyNotes: notes || ''
      });
    }

    // Update gadget status to FOUND_IN_CUSTODY
    const updatedGadget = db.update('gadgets', gadget.id, {
      status: 'FOUND_IN_CUSTODY',
      custodyLocation: custodyLocation || 'OSA Lost & Found Locker'
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
      details: `Received ${gadget.brand} ${gadget.model} into official OSA custody (${custodyLocation || 'Vault'}). Ready for owner claim.`,
      ipAddress: req.ip
    });

    // Notify Owner to submit claim
    db.addNotification({
      userId: gadget.userId,
      title: 'Your Gadget is in OSA Custody! 🏢',
      message: `Great news! Your ${gadget.brand} ${gadget.model} was surrendered and received into OSA Custody (${custodyLocation || 'OSA Room 1109'}). Please visit OSA or file an ownership claim to retrieve it!`,
      type: 'GADGET_FOUND',
      linkUrl: '/student/#claims'
    });

    return res.json({
      success: true,
      message: 'Item received into OSA custody. Owner notified!',
      gadget: updatedGadget
    });
  } catch (err) {
    console.error('Receive custody error:', err);
    return res.status(500).json({ success: false, error: 'Error receiving item into custody.' });
  }
});

module.exports = router;
