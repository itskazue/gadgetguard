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

// GET /api/claims (OSA Admin views all claims)
router.get('/', authMiddleware, requireRole('osa_admin'), (req, res) => {
  try {
    const claims = db.get('claims') || [];
    const returns = db.get('returns') || [];

    const claimGadgetIds = new Set(claims.map(c => c.gadgetId));

    const enrichedClaims = claims.map(c => {
      const gadget = db.findById('gadgets', c.gadgetId);
      const user = db.findById('users', c.userId);
      const returnRec = c.returnId ? db.findById('returns', c.returnId) : db.findOne('returns', r => r.gadgetId === c.gadgetId);
      const admin = c.processedBy ? db.findById('users', c.processedBy) : null;
      const returnAdmin = returnRec?.returnedByOsaAdminId ? db.findById('users', returnRec.returnedByOsaAdminId) : null;
      const adminName = c.processedByName || admin?.name || returnAdmin?.name || returnRec?.returnedByOsaAdminName || 'OSA Staff';
      
      const isReturned = (c.status === 'RETURNED' || c.status === 'CLAIMED' || Boolean(returnRec));

      return {
        ...c,
        id: c.id,
        status: isReturned ? 'RETURNED' : c.status,
        handoverPhotoUrl: c.handoverPhotoUrl || returnRec?.handoverPhotoUrl || null,
        returnDate: returnRec?.returnDate || c.returnedAt || c.processedAt || c.createdAt,
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
          custodyLocation: gadget.custodyLocation
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
      };
    });

    // Also include any standalone completed returns from history
    returns.forEach(r => {
      if (!claimGadgetIds.has(r.gadgetId) && !claims.some(c => c.returnId === r.id)) {
        const gadget = db.findById('gadgets', r.gadgetId);
        const user = db.findById('users', r.userId);
        const admin = db.findById('users', r.returnedByOsaAdminId);
        enrichedClaims.push({
          id: 'clm_' + r.id,
          gadgetId: r.gadgetId,
          userId: r.userId,
          status: 'RETURNED',
          claimProofDetails: r.notes || 'In-person verification and handover at OSA Room 1109.',
          verificationIdType: 'School ID',
          verificationIdNumber: r.receivedByPersonId || user?.idNumber || 'Verified',
          createdAt: r.returnDate,
          processedAt: r.returnDate,
          returnDate: r.returnDate,
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
            custodyLocation: gadget.custodyLocation
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
      }
    });

    enrichedClaims.sort((a, b) => new Date(b.returnDate || b.createdAt) - new Date(a.returnDate || a.createdAt));

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
