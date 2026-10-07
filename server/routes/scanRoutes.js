const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { authMiddleware, requireRole, JWT_SECRET } = require('../auth');
const db = require('../db');
const locationService = require('../services/locationService');

// Helper to format scanner user-agent into clean device info
function parseScannerDeviceInfo(ua) {
  if (!ua || ua === 'Unknown Device') return 'Device information unavailable';
  let deviceType = 'Desktop';
  if (/mobile/i.test(ua)) deviceType = 'Mobile Device';
  else if (/tablet|ipad/i.test(ua)) deviceType = 'Tablet Device';

  let browser = 'Web Browser';
  if (/chrome|crios/i.test(ua) && !/edge|edg|opr|opera/i.test(ua)) browser = 'Chrome';
  else if (/safari/i.test(ua) && !/chrome|crios/i.test(ua)) browser = 'Safari';
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
  else if (/edge|edg/i.test(ua)) browser = 'Edge';

  let os = 'Unknown OS';
  if (/windows/i.test(ua)) os = 'Windows';
  else if (/macintosh|mac os/i.test(ua)) os = 'macOS';
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/linux/i.test(ua)) os = 'Linux';

  return `${deviceType} – ${browser} (${os})`;
}

// GET /api/scan/device/:token (Public QR device lookup + automatic scan log with strict privacy & OSA differentiation)
router.get('/device/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { locationNote, latitude, longitude, approxLocation } = req.query;
    const finderToken = req.headers['x-finder-token'] || req.query.finderToken || null;

    const gadget = db.findOne('gadgets', g => g.secureToken === token || g.id === token);
    if (!gadget) {
      return res.status(404).json({
        success: false,
        error: 'Invalid or unregistered QR code token.',
        isRegistered: false
      });
    }

    const owner = db.findById('users', gadget.userId);
    const settings = db.getSettings();
    const userAgent = req.headers['user-agent'] || 'Unknown Device';
    const scannerDeviceFormatted = parseScannerDeviceInfo(userAgent);
    const scannerIp = locationService.extractClientIp(req);

    // Check for returning finder recovery session using secure browser session token
    let activeRecoveryChat = null;
    if (finderToken) {
      activeRecoveryChat = db.findOne('recovery_chats', c => c.gadgetId === gadget.id && c.finderSessionToken === finderToken);
    }
    const isReturningFinder = Boolean(activeRecoveryChat);

    const scanStatus = (gadget.status === 'MISSING') 
      ? (isReturningFinder ? 'RETURNING_FINDER_SCANNED' : 'MISSING_DEVICE_SCANNED') 
      : 'REGISTERED_DEVICE_SCANNED';

    // Priority 1: GPS Geolocation (reverse geocoded) -> "Approximate Location: [Landmark], [City], [Province]"
    // Priority 2: IP-based Geolocation fallback -> "Estimated Location: [City], [Province]" (Never invent landmark)
    // Fallback: "Location unavailable"
    const locResult = await locationService.resolveScanLocation({
      latitude,
      longitude,
      ip: scannerIp
    });

    const finalLocationNote = locResult.formattedLocation || 
      (approxLocation ? decodeURIComponent(approxLocation) : 
      (locationNote ? decodeURIComponent(locationNote) : 'Location unavailable'));

    // Check if scanner is an authenticated OSA Administrator
    let isAuthorizedOsa = false;
    let scannerAccountId = null;
    try {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET);
        scannerAccountId = decoded.id;
        const loggedUser = db.findById('users', decoded.id);
        if (loggedUser && loggedUser.role === 'osa_admin') {
          isAuthorizedOsa = true;
        }
      }
    } catch (e) {}

    // Record QR scan log with full location metadata
    const scanLog = db.insert('qr_scans', {
      id: 'scn_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
      gadgetId: gadget.id,
      scannedToken: token,
      scannerIp,
      scannerUserAgent: userAgent,
      deviceInfo: scannerDeviceFormatted,
      scanLocationNote: finalLocationNote,
      locationSource: locResult.source, // 'GPS' or 'IP' or null
      placeName: locResult.placeName,
      city: locResult.city,
      province: locResult.province,
      latitude: locResult.latitude,
      longitude: locResult.longitude,
      scannerAccountId,
      scanStatus,
      isReturningFinder,
      scannedAt: new Date().toISOString()
    });

    // If gadget is MISSING and NOT a returning finder holding an active session:
    // Do NOT send duplicate scan notification simply because the verified finder scanned again or reopened page
    if (gadget.status === 'MISSING' && !isReturningFinder) {
      const now = new Date();
      const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
      const phDate = new Date(utcMs + (8 * 3600000));
      
      const monthsLong = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      const scanDate = `${monthsLong[phDate.getMonth()]} ${phDate.getDate()}, ${phDate.getFullYear()}`;
      const hours24 = phDate.getHours();
      const hours12 = String(hours24 % 12 || 12).padStart(2, '0');
      const minutes = String(phDate.getMinutes()).padStart(2, '0');
      const ampm = hours24 >= 12 ? 'PM' : 'AM';
      const scanTime = `${hours12}:${minutes} ${ampm}`;

      db.addNotification({
        userId: gadget.userId,
        title: 'Someone Scanned Your Missing Gadget 📍',
        message: `Your missing ${gadget.brand} ${gadget.model} QR code was scanned.\nDate: ${scanDate}\nTime: ${scanTime}\nScan Location: ${finalLocationNote}\nScanner Device: ${scannerDeviceFormatted}`,
        type: 'QR_SCANNED',
        linkUrl: '/student/#lost-status'
      });
    }

    const missingReport = (gadget.status === 'MISSING') ? 
      db.findOne('missing_reports', m => m.gadgetId === gadget.id && m.status === 'ACTIVE') : null;

    // Build active finder recovery session descriptor
    const activeFinderSession = activeRecoveryChat ? {
      hasSession: true,
      chatId: activeRecoveryChat.id,
      finderSessionToken: activeRecoveryChat.finderSessionToken,
      finderName: activeRecoveryChat.finderName || 'Finder',
      foundLocation: activeRecoveryChat.foundLocation,
      missingReportId: activeRecoveryChat.missingReportId,
      status: activeRecoveryChat.status,
      isClosed: Boolean(activeRecoveryChat.status === 'CLOSED' || gadget.status !== 'MISSING')
    } : null;

    // =========================================================================
    // 1. OSA STAFF SCANNER VIEW (Full Authorized Information & Actions)
    // =========================================================================
    if (isAuthorizedOsa) {
      const allScansForGadget = db.find('qr_scans', s => s.gadgetId === gadget.id)
        .sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt));

      return res.json({
        success: true,
        isAuthorizedOsa: true,
        isRegistered: true,
        status: gadget.status,
        gadget: {
          id: gadget.id,
          secureToken: gadget.secureToken,
          category: gadget.category,
          brand: gadget.brand,
          model: gadget.model,
          color: gadget.color,
          serialNumber: gadget.serialNumber,
          description: gadget.description,
          photoUrl: gadget.photoUrl,
          status: gadget.status,
          registrationDate: gadget.registrationDate,
          approvedAt: gadget.approvedAt,
          approvedBy: gadget.approvedBy
        },
        owner: owner ? {
          id: owner.id,
          name: owner.name,
          idNumber: owner.idNumber,
          email: owner.email,
          contactNumber: owner.contactNumber,
          department: owner.department,
          role: owner.role,
          avatarUrl: owner.avatarUrl
        } : null,
        missingReport: missingReport ? {
          id: missingReport.id,
          lastSeenLocation: missingReport.lastSeenLocation,
          lastSeenDate: missingReport.lastSeenDate,
          details: missingReport.details,
          contactRewardOffer: missingReport.contactRewardOffer,
          reportedAt: missingReport.reportedAt
        } : null,
        scanHistory: allScansForGadget,
        osaContact: {
          schoolName: settings.schoolName,
          officeLocation: settings.osaOfficeLocation,
          phone: settings.osaContactPhone,
          email: settings.osaEmail,
          hours: settings.operatingHours
        },
        scanId: scanLog.id,
        activeFinderSession
      });
    }

    // =========================================================================
    // 2. PUBLIC USER SCANNER VIEW (Strict Privacy Enforcement)
    // =========================================================================
    // ZERO owner private information is exposed to public users.
    const isMissing = (gadget.status === 'MISSING');

    return res.json({
      success: true,
      isAuthorizedOsa: false,
      isRegistered: true,
      status: gadget.status,
      publicMessage: isMissing
        ? 'This gadget has been reported as missing. If you found this gadget, please keep it safe and surrender it to the Office of Student Affairs (OSA).'
        : 'This gadget is registered with GadgetGuard. This gadget is not currently reported as missing. If you found this gadget unattended, please keep it safe and surrender it to the Office of Student Affairs (OSA).',
      gadget: {
        id: gadget.id,
        secureToken: gadget.secureToken,
        category: gadget.category,
        brand: gadget.brand,
        model: gadget.model,
        color: gadget.color,
        photoUrl: gadget.photoUrl,
        status: gadget.status,
        custodyStatus: gadget.custodyStatus || 'MISSING',
        studentIdNumber: isMissing && owner ? (owner.idNumber || 'Registered Student') : undefined
      },
      owner: null, // Strictly protected
      missingReport: isMissing && missingReport ? {
        lastSeenLocation: missingReport.lastSeenLocation,
        lastSeenDate: missingReport.lastSeenDate,
        details: missingReport.details
      } : null,
      osaContact: {
        schoolName: settings.schoolName,
        officeLocation: settings.osaOfficeLocation,
        phone: settings.osaContactPhone,
        email: settings.osaEmail,
        hours: settings.operatingHours
      },
      scanId: scanLog.id,
      activeFinderSession
    });
  } catch (err) {
    console.error('Scan lookup error:', err);
    return res.status(500).json({ success: false, error: 'Server error looking up QR code.' });
  }
});

// POST /api/scan/log (Explicit client log with geolocation or update with GPS coordinates)
router.post('/log', async (req, res) => {
  try {
    const { token, locationNote, deviceInfo, latitude, longitude, scanId, finderToken } = req.body;
    const clientFinderToken = req.headers['x-finder-token'] || finderToken || null;
    if (!token) {
      return res.status(400).json({ success: false, error: 'Token is required.' });
    }

    const gadget = db.findOne('gadgets', g => g.secureToken === token || g.id === token);
    if (!gadget) {
      return res.status(404).json({ success: false, error: 'Invalid token.' });
    }

    let activeRecoveryChat = null;
    if (clientFinderToken) {
      activeRecoveryChat = db.findOne('recovery_chats', c => c.gadgetId === gadget.id && c.finderSessionToken === clientFinderToken);
    }
    const isReturningFinder = Boolean(activeRecoveryChat);

    const scannerIp = locationService.extractClientIp(req);
    const locResult = await locationService.resolveScanLocation({
      latitude,
      longitude,
      ip: scannerIp
    });

    const finalLocationNote = locResult.formattedLocation || (locationNote ? locationNote.trim() : 'Location unavailable');

    // If updating an existing recent scan record from this scan session (e.g. GPS granted after initial load)
    if (scanId) {
      const existingScan = db.findById('qr_scans', scanId);
      if (existingScan && existingScan.gadgetId === gadget.id) {
        const updatedScan = db.update('qr_scans', scanId, {
          scanLocationNote: finalLocationNote,
          locationSource: locResult.source,
          placeName: locResult.placeName,
          city: locResult.city,
          province: locResult.province,
          latitude: locResult.latitude,
          longitude: locResult.longitude,
          isReturningFinder
        });
        return res.json({ success: true, scan: updatedScan, isUpdated: true });
      }
    }

    const scanLog = db.insert('qr_scans', {
      id: 'scn_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
      gadgetId: gadget.id,
      scannedToken: token,
      scannerIp,
      scannerUserAgent: req.headers['user-agent'] || 'Unknown',
      scanLocationNote: finalLocationNote,
      locationSource: locResult.source,
      placeName: locResult.placeName,
      city: locResult.city,
      province: locResult.province,
      latitude: locResult.latitude,
      longitude: locResult.longitude,
      deviceInfo: deviceInfo || 'Web Scanner',
      scanStatus: (gadget.status === 'MISSING') 
        ? (isReturningFinder ? 'RETURNING_FINDER_SCANNED' : 'MISSING_DEVICE_SCANNED') 
        : 'REGISTERED_DEVICE_SCANNED',
      isReturningFinder,
      scannedAt: new Date().toISOString()
    });

    // Do NOT send duplicate scan notification if scanner is returning finder holding session
    if (gadget.status === 'MISSING' && !isReturningFinder) {
      db.addNotification({
        userId: gadget.userId,
        title: 'QR Scan Location Tagged 📍',
        message: `Someone scanned your ${gadget.brand} ${gadget.model}. ${finalLocationNote}`,
        type: 'QR_SCANNED',
        linkUrl: '/student/#lost-status'
      });
    }

    return res.json({ success: true, scan: scanLog });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Error logging scan.' });
  }
});

// GET /api/scan/history/my (Student views their scan history — MISSING GADGETS ONLY, with scanner privacy protected)
router.get('/history/my', authMiddleware, (req, res) => {
  try {
    const userGadgets = db.find('gadgets', g => g.userId === req.user.id);
    const userGadgetIds = new Set(userGadgets.map(g => g.id));

    const activeReports = db.find('missing_reports', m => m.userId === req.user.id && m.status === 'ACTIVE');
    const activeReportMap = {};
    activeReports.forEach(r => {
      activeReportMap[r.gadgetId] = new Date(r.reportedAt || r.createdAt || 0).getTime();
    });

    // Only include scans for currently active missing gadgets that occurred after the incident report was created
    const scans = db.find('qr_scans', s => {
      if (!userGadgetIds.has(s.gadgetId)) return false;
      if (s.scanStatus !== 'MISSING_DEVICE_SCANNED') return false;
      const reportTime = activeReportMap[s.gadgetId];
      if (reportTime === undefined) return false;
      return new Date(s.scannedAt).getTime() >= reportTime;
    });
    
    // Sort recent first
    scans.sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt));

    // Mask sensitive scanner identity (do not expose scanner IP or account id)
    const enriched = scans.map(s => {
      const g = userGadgets.find(item => item.id === s.gadgetId);
      return {
        id: s.id,
        gadgetId: s.gadgetId,
        scannedAt: s.scannedAt,
        scanLocationNote: s.scanLocationNote || 'Location unavailable',
        locationSource: s.locationSource || null,
        placeName: s.placeName || null,
        city: s.city || null,
        province: s.province || null,
        deviceInfo: s.deviceInfo || 'Scanner device unavailable',
        gadget: g ? {
          brand: g.brand,
          model: g.model,
          category: g.category,
          status: g.status
        } : null
      };
    });

    return res.json({ success: true, scans: enriched });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Error fetching scan history.' });
  }
});

// GET /api/scan/history/all (OSA Admin views all scan telemetry)
router.get('/history/all', authMiddleware, requireRole('osa_admin'), (req, res) => {
  try {
    const scans = db.get('qr_scans');
    scans.sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt));

    const enriched = scans.map(s => {
      const gadget = db.findById('gadgets', s.gadgetId);
      const owner = gadget ? db.findById('users', gadget.userId) : null;
      return {
        ...s,
        gadget: gadget ? {
          brand: gadget.brand,
          model: gadget.model,
          category: gadget.category,
          status: gadget.status
        } : null,
        owner: owner ? {
          name: owner.name,
          idNumber: owner.idNumber,
          department: owner.department
        } : null
      };
    });

    return res.json({ success: true, scans: enriched });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Error fetching all scans.' });
  }
});

module.exports = router;
