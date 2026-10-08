const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../auth');
const db = require('../db');

// Helper to authenticate chat participant (either Owner via JWT or Finder via temporary session token)
function resolveChatParticipant(req, chat) {
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
  const finderToken = req.headers['x-finder-token'] || req.query.finderToken || req.body.finderToken;
  if (finderToken && chat.finderSessionToken && finderToken === chat.finderSessionToken) {
    return { role: 'FINDER', userId: null };
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
      return res.status(403).json({ success: false, error: 'Unauthorized to view this private recovery conversation.' });
    }

    const gadget = db.findById('gadgets', chat.gadgetId);
    
    // Check if recovery is resolved, surrendered to OSA, or completed -> closed / read-only
    const isSurrendered = Boolean(gadget && (gadget.custodyStatus === 'PENDING_OSA_TURNOVER' || gadget.surrenderStatus === 'WILL_SURRENDER_TO_OSA'));
    const isGadgetClosed = !gadget || gadget.status !== 'MISSING' || isSurrendered;
    const isClosed = chat.status === 'CLOSED' || isGadgetClosed;

    if (isGadgetClosed && chat.status !== 'CLOSED') {
      const closedReason = isSurrendered ? 'SURRENDERED_TO_OSA' : 'GADGET_RECOVERED';
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
      return res.status(403).json({ success: false, error: 'Unauthorized to post messages in this conversation.' });
    }

    const gadget = db.findById('gadgets', chat.gadgetId);
    const isSurrendered = Boolean(gadget && (gadget.custodyStatus === 'PENDING_OSA_TURNOVER' || gadget.surrenderStatus === 'WILL_SURRENDER_TO_OSA'));
    const isGadgetClosed = !gadget || gadget.status !== 'MISSING' || isSurrendered;
    if (chat.status === 'CLOSED' || isGadgetClosed) {
      if (isGadgetClosed && chat.status !== 'CLOSED') {
        const closedReason = isSurrendered ? 'SURRENDERED_TO_OSA' : 'GADGET_RECOVERED';
        db.update('recovery_chats', chat.id, { status: 'CLOSED', closedReason });
      }
      const errorMsg = (isSurrendered || chat.closedReason === 'SURRENDERED_TO_OSA')
        ? 'This recovery conversation is closed and read-only because the finder has chosen to surrender the gadget to OSA.'
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
      if (!user || user.role !== 'osa_admin') {
        return res.status(403).json({ success: false, error: 'Unauthorized.' });
      }
    }

    // Find active chat or latest chat for this gadget
    const allChats = db.find('recovery_chats', c => c.gadgetId === gadgetId);
    if (!allChats || allChats.length === 0) {
      return res.status(404).json({ success: false, error: 'No recovery chat found for this gadget.' });
    }

    // Sort recent first
    allChats.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const activeChat = allChats.find(c => c.status === 'ACTIVE') || allChats[0];

    const isGadgetClosed = gadget.status !== 'MISSING';
    const isClosed = activeChat.status === 'CLOSED' || isGadgetClosed;

    const messages = (activeChat.messages || []).map(m => ({
      id: m.id,
      senderRole: m.senderRole,
      senderLabel: m.senderRole === 'OWNER' ? 'You' : (activeChat.finderName || 'Finder'),
      isMine: m.senderRole === 'OWNER',
      text: m.messageText,
      createdAt: m.createdAt
    }));

    return res.json({
      success: true,
      chat: {
        id: activeChat.id,
        gadgetId: activeChat.gadgetId,
        gadget: {
          brand: gadget.brand,
          model: gadget.model,
          category: gadget.category,
          photoUrl: gadget.photoUrl,
          status: gadget.status
        },
        myRole: 'OWNER',
        otherParticipant: activeChat.finderName || 'Finder',
        finderName: activeChat.finderName || 'Finder',
        foundLocation: activeChat.foundLocation,
        status: activeChat.status,
        isClosed,
        messages,
        createdAt: activeChat.createdAt
      }
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

    if (!finderToken) {
      return res.status(400).json({ success: false, error: 'Finder session token is required.' });
    }

    const gadget = db.findOne('gadgets', g => g.secureToken === token || g.id === token);
    if (!gadget) {
      return res.status(404).json({ success: false, error: 'Gadget not found.' });
    }

    const chat = db.findOne('recovery_chats', c => c.gadgetId === gadget.id && c.finderSessionToken === finderToken);
    if (!chat) {
      return res.status(404).json({ success: false, error: 'Active recovery chat session not found.' });
    }

    const isGadgetClosed = gadget.status !== 'MISSING';
    const isClosed = chat.status === 'CLOSED' || isGadgetClosed;

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
