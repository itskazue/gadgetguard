const QRCode = require('qrcode');
const { hashPassword } = require('./auth');
const db = require('./db');

async function generateSampleQRCode(token) {
  const url = `http://localhost:3000/device/${token}`;
  try {
    return await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'H',
      margin: 2,
      color: {
        dark: '#1e1b4b',
        light: '#ffffff'
      },
      width: 320
    });
  } catch (err) {
    return null;
  }
}

async function seedDatabase(force = false, populated = false) {
  const existingUsers = db.get('users');
  if (existingUsers.length > 0 && !force) {
    console.log('Database already contains records. Skipping initial seed.');
    return;
  }

  console.log('🌱 Resetting / Initializing GadgetGuard database to clean baseline state...');

  const cleanUsers = [
    {
      id: 'usr_admin_01',
      name: 'Carlos Mendoza',
      email: 'osa.admin@univ.edu',
      passwordHash: hashPassword('admin123'),
      role: 'osa_admin',
      idNumber: 'OSA-DIR-001',
      department: 'Office of Student Affairs',
      contactNumber: '+63 917 555 4234',
      status: 'ACTIVE',
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      createdAt: '2026-09-01T08:00:00.000Z',
      updatedAt: '2026-09-01T08:00:00.000Z'
    }
  ];

  let cleanGadgets = [];
  let cleanMissing = [];
  let cleanFound = [];
  let cleanClaims = [];
  let cleanReturns = [];
  let cleanScans = [];

  if (populated) {
    const token1 = 'gg_dev_9a4f210d';
    const qr1 = await generateSampleQRCode(token1);
    cleanUsers.push({
      id: 'usr_student_01',
      name: 'Denzel Kalingking',
      email: 'dkalingking@gmail.com',
      passwordHash: hashPassword('password123'),
      role: 'student',
      idNumber: '2024-58694',
      department: 'College - BS Electronics Engineering',
      contactNumber: '09925792602',
      status: 'ACTIVE',
      avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Denzel%20Kalingking',
      createdAt: '2026-09-05T09:30:00.000Z',
      updatedAt: '2026-09-05T09:30:00.000Z'
    });
    cleanGadgets.push({
      id: 'gdt_01',
      userId: 'usr_student_01',
      category: 'Smartphone',
      brand: 'Samsung',
      model: 'Galaxy S23 Ultra',
      serialNumber: '354892019482910',
      color: 'Phantom Black',
      description: 'Matte black case with university sticker on back.',
      photoUrl: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=500&auto=format&fit=crop&q=80',
      status: 'REGISTERED',
      secureToken: token1,
      qrCodeDataUrl: qr1,
      rejectionReason: null,
      registrationDate: '2026-09-06T14:20:00.000Z',
      approvedAt: '2026-09-07T09:10:00.000Z',
      approvedBy: 'usr_admin_01',
      createdAt: '2026-09-06T14:20:00.000Z',
      updatedAt: '2026-09-07T09:10:00.000Z'
    });
  }

  const seedData = {
    users: cleanUsers,
    gadgets: cleanGadgets,
    missing_reports: cleanMissing,
    found_reports: cleanFound,
    claims: cleanClaims,
    returns: cleanReturns,
    qr_scans: cleanScans,
    audit_logs: [
      {
        id: 'log_init_' + Date.now().toString(36),
        timestamp: new Date().toISOString(),
        userId: 'usr_admin_01',
        userRole: 'osa_admin',
        action: 'SYSTEM_INITIALIZATION',
        targetType: 'system',
        targetId: 'all',
        details: 'System reset and initialized to clean baseline state for fresh demonstration.',
        ipAddress: '127.0.0.1'
      }
    ],
    settings: {
      schoolName: "National College of Science and Technology",
      osaOfficeLocation: "Room 1109, Student Affairs Building",
      osaContactPhone: "+63 917 555 4234",
      osaEmail: "osa@ncst.edu.ph",
      operatingHours: "Mon - Fri: 8:00 AM - 5:00 PM",
      autoStickerCodePrefix: "NCST-GG-2026",
      requireOsaApproval: true
    }
  };

  db.saveAll(seedData);
  console.log('✅ GadgetGuard database successfully initialized!');
}

module.exports = { seedDatabase };
