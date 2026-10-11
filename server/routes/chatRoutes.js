const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../auth');
const db = require('../db');

// Session Lifetime & Inactivity Limits (Requirement 3)
const FINDER_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours absolute maximum lifetime
const FINDER_INACTIVITY_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours sliding inactivity timeout

// Helper to authenticate chat participant (either Owner via JWT or Finder via temporary session token)
function resolveChatParticipant(req, chat) {
  req.finderAuthError = null;

  // 1. Check for logged in user (Owner or OSA Admin)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET);
      if (decoded && decoded.id) {
        if (chat.ownerUserId === decoded.id) {
          return { role: 'OWNER', userId: decoded.id };
        }
        const user = db.findById('users', decoded.id);
        if (user && (user.role === 'osa_admin' || user.role === 'admin')) {
          return { role: 'OSA_ADMIN', userId: decoded.id };
        }
      }
    } catch (e) {}
  }

  // 2. Check for Finder temporary session token
  const finderToken = req.headers['x-finder-token'] || req.query.finderToken || (req.body && req.body.finderToken);
  if (finderToken && typeof finderToken === 'string') {
    const cleanToken = finderToken.trim();

    // Check if token was explicitly revoked on this device (Requirement 1 & 2)
    if (Array.isArray(chat.revokedTokens) && chat.revokedTokens.includes(cleanToken)) {
      req.finderAuthError = {
        status: 403,
        error: 'Finder session credential was ended on this device and is no longer authorized.',
        code: 'TOKEN_REVOKED',
        canRefresh: false
      };
      return null;
    }

    // Check matching active token
    if (chat.finderSessionToken && cleanToken === chat.finderSessionToken.trim()) {
      const now = Date.now();
      const createdAt = chat.finderSessionCreatedAt ? new Date(chat.finderSessionCreatedAt).getTime() : (chat.createdAt ? new Date(chat.createdAt).getTime() : now);
      const expiresAt = chat.finderSessionExpiresAt ? new Date(chat.finderSessionExpiresAt).getTime() : (createdAt + FINDER_SESSION_MAX_AGE_MS);
      const lastActiveAt = chat.finderSessionLastActiveAt ? new Date(chat.finderSessionLastActiveAt).getTime() : createdAt;

      // Absolute max lifetime check
      if (now > expiresAt) {
        req.finderAuthError = {
          status: 401,
          error: 'Finder session has expired (max duration exceeded). Please start a new session.',
          code: 'SESSION_EXPIRED',
          canRefresh: false
        };
        return null;
      }

      // Sliding inactivity check
      if ((now - lastActiveAt) > FINDER_INACTIVITY_TIMEOUT_MS) {
        req.finderAuthError = {
          status: 401,
          error: 'Finder session timed out due to inactivity. Re-authentication / refresh required.',
          code: 'SESSION_INACTIVE',
          canRefresh: true
        };
        return null;
      }

      // INACTIVITY PROTECTION: Background polling (GET requests) must NOT touch or reset inactivity!
      // Only active user actions (e.g. sending a message or explicit refresh) update lastActiveAt
      if (req.method === 'POST') {
        const nowIso = new Date(now).toISOString();
        db.update('recovery_chats', chat.id, { finderSessionLastActiveAt: nowIso });
        chat.finderSessionLastActiveAt = nowIso;
      }

      return { role: 'FINDER', userId: null };
    }
  }

  return null;
}

// GET /api/chat/:chatId - Fetch private chat messages and status
router.get('/:chatId', (req, res) => {
  try {
    const { chatId } = req.params;
    const chat = db.findById('recovery_chats', chatId);

    if (!chat) {
      return res.status(404).json({ success: false, error: 'Recovery chat conversation not found.' });
    }

    const participant = resolveChatParticipant(req, chat);
    if (!participant) {
      if (req.finderAuthError) {
        return res.status(req.finderAuthError.status).json({
          success: false,
          error: req.finderAuthError.error,
          code: req.finderAuthError.code,
          canRefresh: Boolean(req.finderAuthError.canRefresh)
        });
      }
      return res.status(403).json({ success: false, error: 'Unauthorized to view this private recovery conversation.' });
    }

    const gadget = db.findById('gadgets', chat.gadgetId);
    
    // Check if recovery is resolved, surrendered to OSA, or completed -> closed / read-only
    const isCustodyClosed = Boolean(gadget && (gadget.custodyStatus === 'IN_OSA_CUSTODY' || gadget.status === 'FOUND_IN_CUSTODY' || gadget.status === 'RETURNED' || gadget.status === 'RESOLVED' || gadget.status === 'CLAIMED'));
    const isChatSurrendered = (chat.status === 'CLOSED' && chat.closedReason === 'SURRENDERED_TO_OSA');
    const isGadgetClosed = !gadget || gadget.status !== 'MISSING' || isCustodyClosed;
    const isClosed = chat.status === 'CLOSED' || isChatSurrendered || isGadgetClosed;

    if (isGadgetClosed && chat.status !== 'CLOSED') {
      const closedReason = isCustodyClosed ? 'OSA_PHYSICAL_CUSTODY' : 'GADGET_RECOVERED';
      db.update('recovery_chats', chat.id, { status: 'CLOSED', closedReason });
      chat.status = 'CLOSED';
      chat.closedReason = closedReason;
    }

    const isFinder = participant.role === 'FINDER';

    // Format messages with proper privacy labels
    const messages = (chat.messages || []).map(m => {
      const isMyMsg = (isFinder && m.senderRole === 'FINDER') || (!isFinder && m.senderRole === 'OWNER');
      let senderLabel = 'Unknown';
      if (m.senderRole === 'SYSTEM') {
        senderLabel = 'System Notice';
      } else if (isMyMsg) {
        senderLabel = 'You';
      } else if (isFinder) {
        senderLabel = 'Gadget Owner';
      } else {
        senderLabel = chat.finderName || 'Finder';
      }

      return {
        id: m.id,
        senderRole: m.senderRole,
        senderLabel,
        isMine: isMyMsg,
        text: m.messageText,
        createdAt: m.createdAt
      };
    });

    return res.json({
      success: true,
      chat: {
        id: chat.id,
        gadgetId: chat.gadgetId,
        gadget: gadget ? {
          brand: gadget.brand,
          model: gadget.model,
          category: gadget.category,
          photoUrl: gadget.photoUrl,
          status: gadget.status,
          custodyStatus: gadget.custodyStatus
        } : null,
        myRole: participant.role,
        otherParticipant: isFinder ? 'Gadget Owner' : (chat.finderName || 'Finder'),
        finderName: chat.finderName || 'Finder',
        foundLocation: chat.foundLocation,
        status: chat.status,
        isClosed,
        closedReason: chat.closedReason,
        messages,
        createdAt: chat.createdAt
      }
    });
  } catch (err) {
    console.error('Fetch chat error:', err);
    return res.status(500).json({ success: false, error: 'Server error loading recovery chat.' });
  }
});

// POST /api/chat/:chatId/message - Send basic text message in private recovery chat
router.post('/:chatId/message', (req, res) => {
  try {
    const { chatId } = req.params;
    const { text } = req.body;
    const chat = db.findById('recovery_chats', chatId);

    if (!chat) {
      return res.status(404).json({ success: false, error: 'Recovery chat conversation not found.' });
    }

    const participant = resolveChatParticipant(req, chat);
    if (!participant) {
      if (req.finderAuthError) {
        return res.status(req.finderAuthError.status).json({
          success: false,
          error: req.finderAuthError.error,
          code: req.finderAuthError.code,
          canRefresh: Boolean(req.finderAuthError.canRefresh)
        });
      }
      return res.status(403).json({ success: false, error: 'Unauthorized to post messages in this conversation.' });
    }

    const gadget = db.findById('gadgets', chat.gadgetId);
    const isCustodyClosed = Boolean(gadget && (gadget.custodyStatus === 'IN_OSA_CUSTODY' || gadget.status === 'FOUND_IN_CUSTODY' || gadget.status === 'RETURNED' || gadget.status === 'RESOLVED' || gadget.status === 'CLAIMED'));
    const isChatSurrendered = (chat.status === 'CLOSED' && chat.closedReason === 'SURRENDERED_TO_OSA');
    const isGadgetClosed = !gadget || gadget.status !== 'MISSING' || isCustodyClosed;

    if (chat.status === 'CLOSED' || isChatSurrendered || isGadgetClosed) {
      if (isGadgetClosed && chat.status !== 'CLOSED') {
        const closedReason = isCustodyClosed ? 'OSA_PHYSICAL_CUSTODY' : 'GADGET_RECOVERED';
        db.update('recovery_chats', chat.id, { status: 'CLOSED', closedReason });
      }
      const errorMsg = (chat.closedReason === 'SURRENDERED_TO_OSA' || isChatSurrendered)
        ? 'The finder has decided to surrender your gadget to OSA. Awaiting physical handover.'
        : 'This recovery conversation is closed because the gadget has been marked recovered or returned.';
      return res.status(400).json({ 
        success: false, 
        error: errorMsg
      });
    }

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ success: false, error: 'Message text cannot be empty.' });
    }

    const cleanText = text.trim().substring(0, 1000);
    const senderRole = participant.role === 'FINDER' ? 'FINDER' : 'OWNER';

    const newMsg = {
      id: 'msg_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
      senderRole,
      messageText: cleanText,
      createdAt: new Date().toISOString()
    };

    const currentMessages = Array.isArray(chat.messages) ? chat.messages : [];
    currentMessages.push(newMsg);
    db.update('recovery_chats', chat.id, { messages: currentMessages });

    // Notify the other participant
    if (senderRole === 'FINDER') {
      // Notify gadget owner
      const snippet = cleanText.length > 70 ? (cleanText.substring(0, 67) + '...') : cleanText;
      db.addNotification({
        userId: chat.ownerUserId,
        title: 'New Message from Finder 💬',
        message: `Finder (${chat.finderName || 'Finder'}): "${snippet}"\nRegarding your ${gadget ? gadget.brand + ' ' + gadget.model : 'gadget'}`,
        type: 'CHAT_MESSAGE',
        linkUrl: `/student/#lost-status`
      });
    }

    // Broadcast SSE live event
    try {
      const broadcast = req.app.get('broadcastEvent');
      if (typeof broadcast === 'function') {
        broadcast('CHAT_MESSAGE', {
          chatId: chat.id,
          gadgetId: chat.gadgetId,
          senderRole,
          messageId: newMsg.id
        });
      }
    } catch (e) {}

    return res.status(201).json({
      success: true,
      message: {
        id: newMsg.id,
        senderRole: newMsg.senderRole,
        senderLabel: 'You',
        isMine: true,
        text: newMsg.messageText,
        createdAt: newMsg.createdAt
      }
    });
  } catch (err) {
    console.error('Send message error:', err);
    return res.status(500).json({ success: false, error: 'Server error sending message.' });
  }
});

// POST /api/chat/:chatId/end-session - Explicitly revoke/invalidate finder session credential on backend (Requirement 1 & 2)
router.post('/:chatId/end-session', (req, res) => {
  try {
    const { chatId } = req.params;
    const finderToken = req.headers['x-finder-token'] || req.body.finderToken || req.query.finderToken;

    if (!finderToken || typeof finderToken !== 'string' || !finderToken.trim()) {
      return res.status(400).json({ success: false, error: 'Finder session token is required to end session.' });
    }

    const chat = db.findById('recovery_chats', chatId);
    if (!chat) {
      return res.status(404).json({ success: false, error: 'Recovery chat conversation not found.' });
    }

    const cleanToken = finderToken.trim();
    const isMatching = chat.finderSessionToken && chat.finderSessionToken.trim() === cleanToken;
    const isAlreadyRevoked = Array.isArray(chat.revokedTokens) && chat.revokedTokens.includes(cleanToken);

    if (!isMatching && !isAlreadyRevoked) {
      return res.status(403).json({ success: false, error: 'Unauthorized: Invalid Finder token for this chat.' });
    }

    if (isMatching) {
      const revokedTokens = Array.isArray(chat.revokedTokens) ? [...chat.revokedTokens] : [];
      if (!revokedTokens.includes(cleanToken)) {
        revokedTokens.push(cleanToken);
      }
      const nowIso = new Date().toISOString();
      db.update('recovery_chats', chat.id, {
        finderSessionToken: null,
        revokedTokens,
        finderSessionRevokedAt: nowIso
      });
      chat.finderSessionToken = null;
      chat.revokedTokens = revokedTokens;
      chat.finderSessionRevokedAt = nowIso;

      // Also disconnect token from associated found report if linked
      if (chat.foundReportId) {
        const foundRep = db.findById('found_reports', chat.foundReportId);
        if (foundRep && foundRep.finderSessionToken === cleanToken) {
          db.update('found_reports', foundRep.id, { finderSessionToken: null });
        }
      }

      db.addAuditLog({
        userId: 'PUBLIC_FINDER',
        userRole: 'public',
        action: 'FINDER_SESSION_REVOKED',
        targetType: 'recovery_chat',
        targetId: chat.id,
        details: `Finder session ended and credential invalidated on device (Chat ${chat.id})`,
        ipAddress: req.ip
      });
    }

    return res.json({
      success: true,
      message: 'Finder session credential successfully revoked and invalidated on server.',
      chatId: chat.id
    });
  } catch (err) {
    console.error('End session error:', err);
    return res.status(500).json({ success: false, error: 'Server error ending session.' });
  }
});

// POST /api/chat/session/revoke - Body-based alias for end-session
router.post('/session/revoke', (req, res) => {
  const chatId = req.body && req.body.chatId;
  if (!chatId) {
    return res.status(400).json({ success: false, error: 'chatId is required in request body.' });
  }
  req.params = { chatId };
  return router.handle(req, res);
});

// POST /api/chat/:chatId/refresh-session - Re-authenticate / refresh legitimate inactive session (Requirement 3)
router.post('/:chatId/refresh-session', (req, res) => {
  try {
    const { chatId } = req.params;
    const finderToken = req.headers['x-finder-token'] || req.body.finderToken || req.query.finderToken;

    if (!finderToken || typeof finderToken !== 'string' || !finderToken.trim()) {
      return res.status(400).json({ success: false, error: 'Finder session token is required to refresh session.' });
    }

    const chat = db.findById('recovery_chats', chatId);
    if (!chat) {
      return res.status(404).json({ success: false, error: 'Recovery chat conversation not found.' });
    }

    const cleanToken = finderToken.trim();

    // Revoked tokens cannot be refreshed
    if (Array.isArray(chat.revokedTokens) && chat.revokedTokens.includes(cleanToken)) {
      return res.status(403).json({
        success: false,
        error: 'This session was revoked on this device. Re-authentication is not permitted.',
        code: 'REVOKED'
      });
    }

    if (!chat.finderSessionToken || chat.finderSessionToken.trim() !== cleanToken) {
      return res.status(403).json({ success: false, error: 'Invalid finder token for this recovery chat.' });
    }

    const now = Date.now();
    const createdAt = chat.finderSessionCreatedAt ? new Date(chat.finderSessionCreatedAt).getTime() : (chat.createdAt ? new Date(chat.createdAt).getTime() : now);
    const expiresAt = chat.finderSessionExpiresAt ? new Date(chat.finderSessionExpiresAt).getTime() : (createdAt + FINDER_SESSION_MAX_AGE_MS);

    if (now > expiresAt) {
      return res.status(401).json({
        success: false,
        error: 'Maximum session lifetime reached (24 hours). Please start a new session.',
        code: 'SESSION_EXPIRED',
        canRefresh: false
      });
    }

    // Reset sliding inactivity window
    const nowIso = new Date(now).toISOString();
    db.update('recovery_chats', chat.id, {
      finderSessionLastActiveAt: nowIso
    });
    chat.finderSessionLastActiveAt = nowIso;

    return res.json({
      success: true,
      message: 'Finder session refreshed successfully.',
      chatId: chat.id,
      lastActiveAt: nowIso,
      expiresAt: chat.finderSessionExpiresAt
    });
  } catch (err) {
    console.error('Refresh session error:', err);
    return res.status(500).json({ success: false, error: 'Server error refreshing session.' });
  }
});

// GET /api/chat/by-gadget/:gadgetId - Owner fetches active recovery chat for a gadget
router.get('/by-gadget/:gadgetId', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }

    let decoded;
    try {
      decoded = jwt.verify(authHeader.substring(7), JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ success: false, error: 'Invalid authentication token.' });
    }

    const { gadgetId } = req.params;
    const gadget = db.findById('gadgets', gadgetId);
    if (!gadget) {
      return res.status(404).json({ success: false, error: 'Gadget not found.' });
    }

    if (gadget.userId !== decoded.id) {
      const user = db.findById('users', decoded.id);
      if (!user || (user.role !== 'osa_admin' && user.role !== 'admin')) {
        return res.status(403).json({ success: false, error: 'Unauthorized.' });
      }
    }

    const missingReport = db.findOne('missing_reports', m => m.gadgetId === gadgetId && m.status === 'ACTIVE');

    // Find all chats for this gadget and active missing incident
    const allChats = db.find('recovery_chats', c => 
      c.gadgetId === gadgetId && 
      (missingReport ? c.missingReportId === missingReport.id : true)
    ).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (!allChats || allChats.length === 0) {
      return res.status(404).json({ success: false, error: 'No recovery chat found for this gadget.' });
    }

    const requestedChatId = req.query.chatId;
    let selectedChat = null;
    if (requestedChatId) {
      selectedChat = allChats.find(c => c.id === requestedChatId);
    }
    if (!selectedChat) {
      selectedChat = allChats.find(c => c.status === 'ACTIVE') || allChats[0];
    }

    const isCustodyClosed = Boolean(gadget && (gadget.custodyStatus === 'IN_OSA_CUSTODY' || gadget.status === 'FOUND_IN_CUSTODY' || gadget.status === 'RETURNED' || gadget.status === 'RESOLVED' || gadget.status === 'CLAIMED'));
    const isChatSurrendered = (selectedChat.status === 'CLOSED' && selectedChat.closedReason === 'SURRENDERED_TO_OSA');
    const isGadgetClosed = gadget.status !== 'MISSING' || isCustodyClosed;
    const isClosed = selectedChat.status === 'CLOSED' || isChatSurrendered || isGadgetClosed;
    const closedReason = selectedChat.closedReason || (isChatSurrendered ? 'SURRENDERED_TO_OSA' : (isGadgetClosed ? 'GADGET_RECOVERED' : null));

    const messages = (selectedChat.messages || []).map(m => ({
      id: m.id,
      senderRole: m.senderRole,
      senderLabel: m.senderRole === 'OWNER' ? 'You' : (selectedChat.finderName || 'Finder'),
      isMine: m.senderRole === 'OWNER',
      text: m.messageText,
      createdAt: m.createdAt
    }));

    return res.json({
      success: true,
      chat: {
        id: selectedChat.id,
        gadgetId: selectedChat.gadgetId,
        missingReportId: selectedChat.missingReportId,
        gadget: {
          brand: gadget.brand,
          model: gadget.model,
          category: gadget.category,
          photoUrl: gadget.photoUrl,
          status: gadget.status
        },
        myRole: 'OWNER',
        otherParticipant: selectedChat.finderName || 'Finder',
        finderName: selectedChat.finderName || 'Finder',
        foundLocation: selectedChat.foundLocation,
        status: selectedChat.status,
        isClosed,
        closedReason,
        messages,
        createdAt: selectedChat.createdAt
      },
      chats: allChats.map(c => ({
        id: c.id,
        finderName: c.finderName || 'Finder',
        foundLocation: c.foundLocation || 'Campus',
        status: c.status,
        isClosed: c.status === 'CLOSED',
        closedReason: c.closedReason,
        createdAt: c.createdAt
      }))
    });
  } catch (err) {
    console.error('Fetch chat by gadget error:', err);
    return res.status(500).json({ success: false, error: 'Server error loading chat.' });
  }
});

// GET /api/chat/active-finder/:token - Helper for finder scanning page with saved finder session
router.get('/active-finder/:token', (req, res) => {
  try {
    const { token } = req.params;
    const finderToken = req.headers['x-finder-token'] || req.query.finderToken;

    if (!finderToken || typeof finderToken !== 'string' || !finderToken.trim()) {
      return res.status(400).json({ success: false, error: 'Finder session token is required.' });
    }

    const cleanToken = finderToken.trim();
    const gadget = db.findOne('gadgets', g => g.secureToken === token || g.id === token);
    if (!gadget) {
      return res.status(404).json({ success: false, error: 'Gadget not found.' });
    }

    // Check if token was explicitly revoked on this device (Requirement 1 & 2)
    const revokedChat = db.findOne('recovery_chats', c => c.gadgetId === gadget.id && Array.isArray(c.revokedTokens) && c.revokedTokens.includes(cleanToken));
    if (revokedChat) {
      return res.status(403).json({
        success: false,
        error: 'Finder session was ended on this device and is no longer authorized.',
        code: 'TOKEN_REVOKED'
      });
    }

    const chat = db.findOne('recovery_chats', c => c.gadgetId === gadget.id && c.finderSessionToken === cleanToken);
    if (!chat) {
      return res.status(404).json({ success: false, error: 'Active recovery chat session not found.' });
    }

    const now = Date.now();
    const createdAt = chat.finderSessionCreatedAt ? new Date(chat.finderSessionCreatedAt).getTime() : (chat.createdAt ? new Date(chat.createdAt).getTime() : now);
    const expiresAt = chat.finderSessionExpiresAt ? new Date(chat.finderSessionExpiresAt).getTime() : (createdAt + FINDER_SESSION_MAX_AGE_MS);
    const lastActiveAt = chat.finderSessionLastActiveAt ? new Date(chat.finderSessionLastActiveAt).getTime() : createdAt;

    if (now > expiresAt) {
      return res.status(401).json({
        success: false,
        error: 'Finder session has expired (max duration exceeded).',
        code: 'SESSION_EXPIRED',
        canRefresh: false
      });
    }

    if ((now - lastActiveAt) > FINDER_INACTIVITY_TIMEOUT_MS) {
      return res.status(401).json({
        success: false,
        error: 'Finder session timed out due to inactivity.',
        code: 'SESSION_INACTIVE',
        canRefresh: true
      });
    }

    const isCustodyClosed = Boolean(gadget && (gadget.custodyStatus === 'IN_OSA_CUSTODY' || gadget.status === 'FOUND_IN_CUSTODY' || gadget.status === 'RETURNED' || gadget.status === 'RESOLVED' || gadget.status === 'CLAIMED'));
    const isChatSurrendered = (chat.status === 'CLOSED' && chat.closedReason === 'SURRENDERED_TO_OSA');
    const isGadgetClosed = gadget.status !== 'MISSING' || isCustodyClosed;
    const isClosed = chat.status === 'CLOSED' || isChatSurrendered || isGadgetClosed;
    const closedReason = chat.closedReason || (isChatSurrendered ? 'SURRENDERED_TO_OSA' : (isGadgetClosed ? 'GADGET_RECOVERED' : null));

    const messages = (chat.messages || []).map(m => ({
      id: m.id,
      senderRole: m.senderRole,
      senderLabel: m.senderRole === 'FINDER' ? 'You' : 'Gadget Owner',
      isMine: m.senderRole === 'FINDER',
      text: m.messageText,
      createdAt: m.createdAt
    }));

    return res.json({
      success: true,
      chat: {
        id: chat.id,
        gadgetId: chat.gadgetId,
        missingReportId: chat.missingReportId,
        gadget: {
          brand: gadget.brand,
          model: gadget.model,
          category: gadget.category,
          photoUrl: gadget.photoUrl,
          status: gadget.status
        },
        myRole: 'FINDER',
        otherParticipant: 'Gadget Owner',
        finderName: chat.finderName || 'Finder',
        foundLocation: chat.foundLocation,
        status: chat.status,
        isClosed,
        closedReason,
        messages,
        createdAt: chat.createdAt
      }
    });
  } catch (err) {
    console.error('Fetch active finder chat error:', err);
    return res.status(500).json({ success: false, error: 'Server error loading chat.' });
  }
});

module.exports = router;
