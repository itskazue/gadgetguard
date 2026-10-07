require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');

const { seedDatabase } = require('./seed');
const db = require('./db');
const mailer = require('./services/mailer');
const authRoutes = require('./routes/authRoutes');
const gadgetRoutes = require('./routes/gadgetRoutes');
const missingRoutes = require('./routes/missingRoutes');
const scanRoutes = require('./routes/scanRoutes');
const finderRoutes = require('./routes/finderRoutes');
const claimRoutes = require('./routes/claimRoutes');
const osaRoutes = require('./routes/osaRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const chatRoutes = require('./routes/chatRoutes');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// Setup upload storage
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, 'gadget_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7) + ext);
  }
});
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB max
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static file servers
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, '..', 'public')));

// SSE (Server-Sent Events) live notification & sync hub
const sseClients = new Set();

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);

  // Send initial ping
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', message: 'Live event stream connected' })}\n\n`);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

function broadcastEvent(eventType, payload) {
  const data = JSON.stringify({ type: eventType, payload, timestamp: new Date().toISOString() });
  for (const client of sseClients) {
    client.write(`data: ${data}\n\n`);
  }
}
app.set('broadcastEvent', broadcastEvent);

// Hook broadcast into request flow
app.use((req, res, next) => {
  const originalJson = res.json;
  res.json = function (data) {
    // If it's a mutating request (POST, PUT, DELETE) and was successful, broadcast
    if (['POST', 'PUT', 'DELETE'].includes(req.method) && res.statusCode < 400 && data && data.success) {
      broadcastEvent('MUTATION', {
        path: req.originalUrl,
        method: req.method,
        action: data.message || 'Data updated'
      });
    }
    return originalJson.call(this, data);
  };
  next();
});

// Photo upload API
app.post('/api/upload', upload.single('photo'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No image file provided.' });
  }
  const photoUrl = `/uploads/${req.file.filename}`;
  return res.json({ success: true, photoUrl, filename: req.file.filename });
});

// Mount API Routes
app.use('/api/auth', authRoutes);
app.use('/api/gadgets', gadgetRoutes);
app.use('/api/missing', missingRoutes);
app.use('/api/scan', scanRoutes);
app.use('/api/finder', finderRoutes);
app.use('/api/claims', claimRoutes);
app.use('/api/osa', osaRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/chat', chatRoutes);

// Test SMTP Connection status
app.get('/api/smtp/status', async (req, res) => {
  const result = await mailer.verifySMTP();
  return res.json(result);
});

// Send Test Email endpoint
app.post('/api/smtp/test', async (req, res) => {
  const targetEmail = req.body.email || process.env.SMTP_USER;
  if (!targetEmail) {
    return res.status(400).json({ success: false, error: 'Recipient email address is required.' });
  }

  const result = await mailer.sendApprovalEmail({
    studentEmail: targetEmail,
    studentName: 'Demo Student (Juan Dela Cruz)',
    studentId: '2026-10492',
    gadgetInfo: {
      brand: 'Apple',
      model: 'MacBook Air M2',
      category: 'Laptop',
      serialNumber: 'C02G8491MD6R'
    }
  });

  return res.json(result);
});

// Public Central Analytics
app.get('/api/stats/public', (req, res) => {
  try {
    const users = db.get('users');
    const gadgets = db.get('gadgets');
    const missing = db.find('missing_reports', m => m.status === 'ACTIVE');
    const returns = db.get('returns');

    return res.json({
      success: true,
      stats: {
        totalUsers: users.length,
        registeredGadgets: gadgets.filter(g => g.status === 'REGISTERED').length,
        activeMissingCases: missing.length,
        totalReturns: returns.length
      }
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Could not fetch public stats.' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'ONLINE',
    system: 'GadgetGuard Central API',
    version: '1.0.0-localhost',
    timestamp: new Date().toISOString()
  });
});

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

// UI Page Route Handlers & URL Rewrites
app.get(['/osa/login', '/osa/login.html'], (req, res) => {
  res.sendFile('osa/login.html', { root: PUBLIC_DIR });
});

app.get(/^\/student/, (req, res) => {
  res.sendFile('student/index.html', { root: PUBLIC_DIR });
});

app.get(/^\/osa/, (req, res) => {
  res.sendFile('osa/index.html', { root: PUBLIC_DIR });
});

app.get(/^\/scan/, (req, res) => {
  res.sendFile('scan.html', { root: PUBLIC_DIR });
});

app.get(/^\/device/, (req, res) => {
  res.sendFile('device/index.html', { root: PUBLIC_DIR });
});

// Fallback all other non-API GET requests to public index.html
app.get(/^\/(?!api|uploads).*/, (req, res) => {
  res.sendFile('index.html', { root: PUBLIC_DIR });
});

// Start Server and initialize seed data
async function startServer() {
  await seedDatabase();
  server.listen(PORT, () => {
    console.log(`
===============================================================
🛡️  GADGETGUARD UNIFIED LOCALHOST PLATFORM RUNNING
===============================================================
📍 SITE 1 (Public Website):       http://localhost:${PORT}/
📱 SITE 2 (Student Application):  http://localhost:${PORT}/student/
🏢 SITE 3 (OSA Admin Center):     http://localhost:${PORT}/osa/
🔍 PUBLIC QR SCAN VERIFICATION:   http://localhost:${PORT}/device/gg_dev_7c3b881e
🚀 SHARED REST API & SSE HUB:     http://localhost:${PORT}/api/
===============================================================
Demo Accounts:
- OSA Admin:   osa.admin@univ.edu         / admin123
- Student 1:   juan.delacruz@student.univ.edu / student123
- Student 2:   maria.santos@student.univ.edu  / student123
- Faculty:     prof.reyes@faculty.univ.edu    / faculty123
===============================================================
    `);
  });
}

startServer();
