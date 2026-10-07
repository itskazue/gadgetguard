const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../auth');
const db = require('../db');

// POST /api/claims/submit (Student submits ownership claim)
router.post('/submit', authMiddleware, (req, res) => {
  try {
    const { gadgetId, claimProofDetails, verificationIdType, verificationIdNumber } = req.body;

    if (!gadgetId || !claimProofDetails || !verificationIdNumber) {
      return res.status(400).json({ 
        success: false, 
        error: 'Gadget ID, proof of ownership details, and ID number are required.' 
      });
    }

    const gadget = db.findById('gadgets', gadgetId);
    if (!gadget) {
      return res.status(404).json({ success: false, error: 'Gadget not found.' });
    }

    if (gadget.userId !== req.user.id && req.user.role !== 'osa_admin') {
      return res.status(403).json({ success: false, error: 'You can only file claims for your registered gadgets.' });
    }

    const newClaim = db.insert('claims', {
      id: 'clm_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
      gadgetId,
      userId: req.user.id,
      claimProofDetails: claimProofDetails.trim(),
      verificationIdType: verificationIdType || 'Student ID',
      verificationIdNumber: verificationIdNumber.trim(),
      claimDate: new Date().toISOString(),
      status: 'PENDING',
      rejectionReason: null,
      processedBy: null,
      processedAt: null
    });

    db.addAuditLog({
      userId: req.user.id,
      userRole: req.user.role,
      action: 'SUBMIT_CLAIM',
      targetType: 'claim',
      targetId: newClaim.id,
      details: `User submitted claim for ${gadget.brand} ${gadget.model}`,
      ipAddress: req.ip
    });

    // Notify OSA Admins
    const admins = db.find('users', u => u.role === 'osa_admin');
    admins.forEach(admin => {
      db.addNotification({
        userId: admin.id,
        title: 'New Claim Request Submitted 📋',
        message: `${req.user.name} submitted an ownership claim for ${gadget.brand} ${gadget.model}.`,
        type: 'SYSTEM',
        linkUrl: '/osa/#claims'
      });
    });

    return res.status(201).json({
      success: true,
      message: 'Claim submitted successfully. Please wait for OSA verification.',
      claim: newClaim
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Error submitting claim.' });
  }
});

// GET /api/claims/my (Student views their claims)
router.get('/my', authMiddleware, (req, res) => {
  try {
    const claims = db.find('claims', c => c.userId === req.user.id);
    claims.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const enriched = claims.map(c => {
      const gadget = db.findById('gadgets', c.gadgetId);
      return {
        ...c,
        gadget: gadget ? {
          brand: gadget.brand,
          model: gadget.model,
          category: gadget.category,
          status: gadget.status,
          photoUrl: gadget.photoUrl
        } : null
      };
    });

    return res.json({ success: true, claims: enriched });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Error fetching claims.' });
  }
});

// GET /api/claims (OSA Admin views all claims + in-custody gadgets ready for claim)
router.get('/', authMiddleware, requireRole('osa_admin'), (req, res) => {
  try {
    const claims = db.get('claims') || [];
    const returns = db.get('returns') || [];
    const allGadgets = db.get('gadgets') || [];
    const inCustodyGadgets = allGadgets.filter(g => g.status === 'FOUND_IN_CUSTODY');

    const processedGadgetIds = new Set();
    const enrichedClaims = [];

    // 1. Process explicit claim submissions
    for (const c of claims) {
      const gadget = db.findById('gadgets', c.gadgetId);
      const user = db.findById('users', c.userId);
      const returnRec = c.returnId ? db.findById('returns', c.returnId) : db.findOne('returns', r => r.gadgetId === c.gadgetId);
      const admin = c.processedBy ? db.findById('users', c.processedBy) : null;
      const returnAdmin = returnRec?.returnedByOsaAdminId ? db.findById('users', returnRec.returnedByOsaAdminId) : null;
      const adminName = c.processedByName || admin?.name || returnAdmin?.name || returnRec?.returnedByOsaAdminName || 'OSA Staff';
      
      const isReturned = (c.status === 'RETURNED' || c.status === 'CLAIMED' || Boolean(returnRec));
      const isInCustody = (!isReturned && gadget && gadget.status === 'FOUND_IN_CUSTODY');

      const foundReport = gadget ? db.findOne('found_reports', f => f.gadgetId === gadget.id) : null;
      const dateReceived = gadget?.receivedAtOsaDate || gadget?.custodyReceivedAt || foundReport?.receivedAtOsaDate || foundReport?.foundDate || gadget?.updatedAt || c.createdAt;
      const vaultLocation = gadget?.custodyLocation || foundReport?.custodyLocation || 'OSA Vault Locker (Room 1109)';
      const staffReceived = gadget?.receivedByOsaStaffName || foundReport?.receivedByOsaStaffName || 'OSA Front Desk Staff';
      const foundLocation = foundReport?.foundLocation || '';
      const returnRef = returnRec?.id || c.returnId || (isReturned ? c.id : '');

      enrichedClaims.push({
        ...c,
        id: c.id,
        status: isReturned ? 'RETURNED' : (isInCustody ? 'IN_CUSTODY' : c.status),
        isInCustody: isInCustody,
        dateReceivedByOsa: dateReceived,
        custodyLocation: vaultLocation,
        previousVaultLocation: vaultLocation,
        receivedByName: staffReceived,
        foundLocation: foundLocation,
        returnReference: returnRef,
        handoverPhotoUrl: isReturned ? (c.handoverPhotoUrl || returnRec?.handoverPhotoUrl || null) : null,
        returnDate: isReturned ? (returnRec?.returnDate || c.returnedAt || c.processedAt || c.createdAt) : null,
        processedByName: adminName,
        returnRecord: returnRec || null,
        gadget: gadget ? {
          id: gadget.id,
          brand: gadget.brand,
          model: gadget.model,
          color: gadget.color || 'Standard',
          category: gadget.category,
          serialNumber: gadget.serialNumber,
          status: gadget.status,
          photoUrl: gadget.photoUrl,
          custodyLocation: vaultLocation
        } : null,
        user: user ? {
          id: user.id,
          name: user.name,
          email: user.email,
          idNumber: user.idNumber,
          department: user.department,
          contactNumber: user.contactNumber
        } : (returnRec ? {
          name: returnRec.receivedByPersonName,
          idNumber: returnRec.receivedByPersonId
        } : null)
      });

      if (c.gadgetId) {
        processedGadgetIds.add(c.gadgetId);
      }
    }

    // 2. Add all gadgets currently held in OSA custody that do not yet have an active claim entry
    for (const g of inCustodyGadgets) {
      if (!processedGadgetIds.has(g.id)) {
        const owner = db.findById('users', g.userId);
        const foundReport = db.findOne('found_reports', f => f.gadgetId === g.id);
        const dateReceived = g.receivedAtOsaDate || g.custodyReceivedAt || foundReport?.receivedAtOsaDate || foundReport?.foundDate || g.updatedAt || g.createdAt;
        const vaultLocation = g.custodyLocation || foundReport?.custodyLocation || 'OSA Vault Locker (Room 1109)';
        const staffName = g.receivedByOsaStaffName || foundReport?.receivedByOsaStaffName || 'OSA Front Desk Staff';
        const foundLocation = foundReport?.foundLocation || '';

        enrichedClaims.push({
          id: 'custody_' + g.id,
          gadgetId: g.id,
          userId: g.userId,
          status: 'IN_CUSTODY',
          isInCustody: true,
          claimProofDetails: 'Gadget in physical custody at OSA Vault.',
          verificationIdType: 'Student ID',
          verificationIdNumber: owner?.idNumber || 'Enrolled Student',
          createdAt: dateReceived,
          dateReceivedByOsa: dateReceived,
          custodyLocation: vaultLocation,
          previousVaultLocation: vaultLocation,
          receivedByName: staffName,
          foundLocation: foundLocation,
          returnReference: '',
          handoverPhotoUrl: null,
          returnDate: null,
          returnRecord: null,
          processedByName: staffName,
          gadget: {
            id: g.id,
            brand: g.brand,
            model: g.model,
            color: g.color || 'Standard',
            category: g.category,
            serialNumber: g.serialNumber,
            status: g.status,
            photoUrl: g.photoUrl,
            custodyLocation: vaultLocation
          },
          user: owner ? {
            id: owner.id,
            name: owner.name,
            email: owner.email,
            idNumber: owner.idNumber,
            department: owner.department,
            contactNumber: owner.contactNumber
          } : null
        });

        processedGadgetIds.add(g.id);
      }
    }

    // 3. Include any standalone completed returns from history
    returns.forEach(r => {
      if (!processedGadgetIds.has(r.gadgetId) && !claims.some(c => c.returnId === r.id)) {
        const gadget = db.findById('gadgets', r.gadgetId);
        const user = db.findById('users', r.userId);
        const admin = db.findById('users', r.returnedByOsaAdminId);
        const foundReport = gadget ? db.findOne('found_reports', f => f.gadgetId === gadget.id) : null;
        const vaultLoc = gadget?.custodyLocation || foundReport?.custodyLocation || 'OSA Vault Locker (Room 1109)';
        enrichedClaims.push({
          id: 'clm_' + r.id,
          gadgetId: r.gadgetId,
          userId: r.userId,
          status: 'RETURNED',
          isInCustody: false,
          claimProofDetails: r.notes || 'In-person verification and handover at OSA Room 1109.',
          verificationIdType: 'School ID',
          verificationIdNumber: r.receivedByPersonId || user?.idNumber || 'Verified',
          createdAt: r.returnDate,
          processedAt: r.returnDate,
          returnDate: r.returnDate,
          dateReceivedByOsa: gadget?.receivedAtOsaDate || gadget?.custodyReceivedAt || r.returnDate,
          custodyLocation: vaultLoc,
          previousVaultLocation: vaultLoc,
          receivedByName: gadget?.receivedByOsaStaffName || 'OSA Staff',
          foundLocation: foundReport?.foundLocation || '',
          returnReference: r.id,
          processedByName: admin ? admin.name : (r.returnedByOsaAdminName || 'OSA Staff'),
          handoverPhotoUrl: r.handoverPhotoUrl || null,
          returnRecord: r,
          gadget: gadget ? {
            id: gadget.id,
            brand: gadget.brand,
            model: gadget.model,
            color: gadget.color || 'Standard',
            category: gadget.category,
            serialNumber: gadget.serialNumber,
            status: gadget.status,
            photoUrl: gadget.photoUrl,
            custodyLocation: vaultLoc
          } : null,
          user: user ? {
            id: user.id,
            name: user.name,
            email: user.email,
            idNumber: user.idNumber,
            department: user.department,
            contactNumber: user.contactNumber
          } : {
            name: r.receivedByPersonName,
            idNumber: r.receivedByPersonId
          }
        });
        processedGadgetIds.add(r.gadgetId);
      }
    });

    // 4. Sort: Prioritize IN_CUSTODY items at the top, then newest date
    enrichedClaims.sort((a, b) => {
      const aInCustody = (a.status === 'IN_CUSTODY' || a.isInCustody);
      const bInCustody = (b.status === 'IN_CUSTODY' || b.isInCustody);
      if (aInCustody && !bInCustody) return -1;
      if (!aInCustody && bInCustody) return 1;

      const dateA = new Date(a.returnDate || a.dateReceivedByOsa || a.createdAt || 0);
      const dateB = new Date(b.returnDate || b.dateReceivedByOsa || b.createdAt || 0);
      return dateB - dateA;
    });

    return res.json({ success: true, claims: enrichedClaims });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Error fetching all claims.' });
  }
});

// POST /api/claims/:id/review (OSA Admin approves or rejects claim)
router.post('/:id/review', authMiddleware, requireRole('osa_admin'), (req, res) => {
  try {
    const { action, rejectionReason } = req.body; // action: 'APPROVE' or 'REJECT'
    const claim = db.findById('claims', req.params.id);

    if (!claim) {
      return res.status(404).json({ success: false, error: 'Claim not found.' });
    }

    const gadget = db.findById('gadgets', claim.gadgetId);
    const user = db.findById('users', claim.userId);

    if (action === 'APPROVE') {
      const updated = db.update('claims', claim.id, {
        status: 'APPROVED',
        processedBy: req.user.id,
        processedAt: new Date().toISOString()
      });

      db.addAuditLog({
        userId: req.user.id,
        userRole: req.user.role,
        action: 'APPROVE_CLAIM',
        targetType: 'claim',
        targetId: claim.id,
        details: `Approved ownership claim for ${user?.name} on ${gadget?.brand} ${gadget?.model}`,
        ipAddress: req.ip
      });

      db.addNotification({
        userId: claim.userId,
        title: 'Claim Approved! 🎉 Ready for Pickup',
        message: `Your claim for ${gadget?.brand} ${gadget?.model} has been APPROVED. Please visit OSA Room 1109 to claim your gadget.`,
        type: 'CLAIM_APPROVED',
        linkUrl: '/student/#claims'
      });

      return res.json({ success: true, message: 'Claim approved successfully!', claim: updated });
    } else {
      const updated = db.update('claims', claim.id, {
        status: 'REJECTED',
        rejectionReason: rejectionReason || 'Insufficient proof of ownership',
        processedBy: req.user.id,
        processedAt: new Date().toISOString()
      });

      db.addAuditLog({
        userId: req.user.id,
        userRole: req.user.role,
        action: 'REJECT_CLAIM',
        targetType: 'claim',
        targetId: claim.id,
        details: `Rejected claim for ${user?.name}. Reason: ${rejectionReason}`,
        ipAddress: req.ip
      });

      db.addNotification({
        userId: claim.userId,
        title: 'Claim Status Update',
        message: `Your claim for ${gadget?.brand} ${gadget?.model} was not approved. Reason: ${rejectionReason || 'Insufficient proof'}. Please contact OSA for assistance.`,
        type: 'CLAIM_REJECTED',
        linkUrl: '/student/#claims'
      });

      return res.json({ success: true, message: 'Claim rejected.', claim: updated });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Error processing claim.' });
  }
});

module.exports = router;
