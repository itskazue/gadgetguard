const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../auth');
const db = require('../db');

// POST /api/finder/report (Public Finder submits found report for a gadget)
router.post('/report', (req, res) => {
  try {
    const token = req.body.token || req.body.secureToken || req.body.gadgetToken;
    const gadgetId = req.body.gadgetId;
    const finderName = req.body.finderName;
    const finderContact = req.body.finderContact;
    const finderEmail = req.body.finderEmail;
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

    if (!finderName || !foundLocation) {
      return res.status(400).json({ success: false, error: 'Finder name and found location are required.' });
    }

    const nameRegex = /^[a-zA-ZñÑ\s\.\,\-]+$/;
    if (!nameRegex.test(finderName.trim())) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid Finder Name: Name must only contain letters and spaces.' 
      });
    }

    if (finderContact) {
      let cleanContact = finderContact.replace(/\D/g, '');
      if (cleanContact.startsWith('63') && cleanContact.length === 12) {
        cleanContact = '0' + cleanContact.substring(2);
      }
      if (cleanContact.length !== 11 || !cleanContact.startsWith('09')) {
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid Contact Number: Contact number must be 11 digits starting with 09 (e.g. 09123456789 or +63 912 345 6789).' 
        });
      }
    }

    const report = db.insert('found_reports', {
      id: 'fnd_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
      gadgetId: targetGadget.id,
      finderName: finderName.trim(),
      finderContact: finderContact ? finderContact.trim() : '',
      finderEmail: finderEmail ? finderEmail.trim() : '',
      foundLocation: foundLocation.trim(),
      foundDate: foundDate || new Date().toISOString(),
      itemCondition: itemCondition || 'Good',
      turnInMethod: turnInMethod || 'SUBMITTED_TO_OSA',
      message: message ? message.trim() : '',
      status: 'REPORTED'
    });

    db.addAuditLog({
      userId: 'PUBLIC_FINDER',
      userRole: 'public',
      action: 'SUBMIT_FOUND_REPORT',
      targetType: 'gadget',
      targetId: targetGadget.id,
      details: `Finder ${finderName} reported finding ${targetGadget.brand} ${targetGadget.model} at ${foundLocation}`,
      ipAddress: req.ip
    });

    // Notify Owner
    const isKeeping = (turnInMethod === 'KEPT_SAFE_CONTACT_ME' || turnInMethod === 'FINDER_HOLDING');
    const ownerNotifTitle = isKeeping ? 'Someone Found Your Gadget (Finder Direct Contact) 🌟' : 'Found Gadget Surrendered to OSA 📦';
    const ownerNotifMsg = isKeeping 
      ? `Good news! ${finderName} found your ${targetGadget.brand} ${targetGadget.model} and is keeping it safe for you.\n\n👤 Finder: ${finderName}\n📞 Contact: ${finderContact || 'Not provided'}${finderEmail ? '\n✉️ Email: ' + finderEmail : ''}\n📍 Found At: ${foundLocation}${message ? '\n📝 Notes: ' + message : ''}\n\n💡 You may contact the finder to arrange the return of your gadget. For your safety, we recommend completing the return through the OSA (Room 1109) whenever possible.`
      : `A finder (${finderName}) reported surrendering your ${targetGadget.brand} ${targetGadget.model} found at "${foundLocation}" to OSA Room 1109.`;

    db.addNotification({
      userId: targetGadget.userId,
      title: ownerNotifTitle,
      message: ownerNotifMsg,
      type: 'GADGET_FOUND',
      linkUrl: '/student/#lost-status'
    });

    // Notify OSA Admins
    const osaAdmins = db.find('users', u => u.role === 'osa_admin');
    osaAdmins.forEach(admin => {
      db.addNotification({
        userId: admin.id,
        title: 'New Found Item Report 📦',
        message: `Found report submitted for ${targetGadget.brand} ${targetGadget.model} by ${finderName} (${foundLocation}).`,
        type: 'GADGET_FOUND',
        linkUrl: '/osa/#found'
      });
    });

    return res.status(201).json({
      success: true,
      message: 'Found report submitted successfully. Thank you for being a responsible campus citizen!',
      report
    });
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
    const report = db.findById('found_reports', req.params.id);

    if (!report) {
      return res.status(404).json({ success: false, error: 'Found report not found.' });
    }

    const gadget = db.findById('gadgets', report.gadgetId);
    if (!gadget) {
      return res.status(404).json({ success: false, error: 'Gadget not found.' });
    }

    // Update report status
    db.update('found_reports', report.id, {
      status: 'PROCESSED_BY_OSA',
      custodyNotes: notes || ''
    });

    // Update gadget status to FOUND_IN_CUSTODY
    const updatedGadget = db.update('gadgets', gadget.id, {
      status: 'FOUND_IN_CUSTODY',
      custodyLocation: custodyLocation || 'OSA Lost & Found Locker'
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
      message: `Your ${gadget.brand} ${gadget.model} has been received into OSA Custody (${custodyLocation || 'OSA Office Room 1109'}). Please submit your claim form or visit OSA with your student ID!`,
      type: 'GADGET_FOUND',
      linkUrl: '/student/#claims'
    });

    return res.json({
      success: true,
      message: 'Item received into OSA custody. Owner notified!',
      gadget: updatedGadget
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Error receiving item into custody.' });
  }
});

module.exports = router;
