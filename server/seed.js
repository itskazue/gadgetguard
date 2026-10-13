const QRCode = require('qrcode');
const { hashPassword } = require('./auth');
const db = require('./db');

async function generateSampleQRCode(token) {
  const url = `https://ncstgadgetguard.onrender.com/device/${token}`;
  try {
    return await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'H',
      margin: 2,
      color: {
        dark: '#142a6d',
        light: '#ffffff'
      },
      width: 320
    });
  } catch (err) {
    return null;
  }
}

async function seedDatabase() {
  // Safety guard: If PostgreSQL is configured in environment but failed to connect,
  // abort seeding to prevent overwriting or repopulating live data from local fallbacks.
  const hasPgConfig = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_CONNECTION_STRING);
  if (hasPgConfig && !db.isPostgresActive()) {
    console.warn('⚠️ [Seed] PostgreSQL is configured but connection is not active. Skipping seeding to protect live database.');
    return;
  }

  console.log('🌱 Verifying persistent NCST GadgetGuard accounts and baseline records...');

  const token1 = 'gg_dev_9a4f210d';
  const qr1 = await generateSampleQRCode(token1);

  const token2 = 'gg_dev_88cf301a';
  const qr2 = await generateSampleQRCode(token2);

  const token3 = 'gg_dev_77be204b';
  const qr3 = await generateSampleQRCode(token3);

  const token4 = 'gg_dev_66ad109c';
  const qr4 = await generateSampleQRCode(token4);

  const cleanUsers = [
    {
      id: 'usr_admin_01',
      name: 'Carlos Mendoza',
      email: 'mrconsonants@gmail.com',
      passwordHash: hashPassword('admin123'),
      role: 'osa_admin',
      idNumber: 'OSA-12345',
      department: 'Office of Student Affairs',
      contactNumber: '+63 917 555 4234',
      status: 'ACTIVE',
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      createdAt: '2026-09-01T08:00:00.000Z',
      updatedAt: '2026-09-01T08:00:00.000Z'
    },
    {
      id: 'usr_student_01',
      name: 'Frnklynrd Rosales',
      email: 'rosales.frnklynrd@ncst.edu.ph',
      passwordHash: hashPassword('password123'),
      role: 'student',
      idNumber: '2024-58694',
      department: 'College - BS Information Technology',
      contactNumber: '09925792602',
      status: 'ACTIVE',
      avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Frnklynrd%20Rosales',
      createdAt: '2026-09-05T09:30:00.000Z',
      updatedAt: '2026-09-05T09:30:00.000Z'
    },
    {
      id: 'usr_student_02',
      name: 'Rogelio III Manaog',
      email: 'manaog.rogelio@ncst.edu.ph',
      passwordHash: hashPassword('password123'),
      role: 'student',
      idNumber: '2024-58135',
      department: 'College - BS Information Technology',
      contactNumber: '09773955453',
      status: 'ACTIVE',
      avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Rogelio%20Manaog',
      createdAt: '2026-09-06T10:00:00.000Z',
      updatedAt: '2026-09-06T10:00:00.000Z'
    }
  ];

  // Clean initial state starts with 0 gadgets (no auto-population)
  const cleanGadgets = [];

  // 1. Ensure required presentation accounts exist if users collection is empty
  const currentUsers = db.get('users') || [];
  if (currentUsers.length === 0) {
    for (const user of cleanUsers) {
      db.insert('users', user);
      console.log(`  + Seeded presentation account: ${user.name} (${user.idNumber})`);
    }
  }

  // 2. Baseline gadgets: clean state starts with 0 gadgets
  if (cleanGadgets.length > 0) {
    for (const gadget of cleanGadgets) {
      db.insert('gadgets', gadget);
    }
  }

  // 3. Ensure system settings exist
  const existingSettings = db.getSettings();
  if (!existingSettings || !existingSettings.schoolName) {
    db.updateSettings({
      schoolName: "National College of Science and Technology",
      osaOfficeLocation: "Room 1109, Student Affairs Building",
      osaContactPhone: "+63 917 555 4234",
      osaEmail: "osa@ncst.edu.ph",
      operatingHours: "Mon - Fri: 8:00 AM - 5:00 PM",
      autoStickerCodePrefix: "NCST-GG-2026",
      requireOsaApproval: true
    });
  }

  // 4. Ensure initialization audit log exists
  const existingLogs = db.get('audit_logs') || [];
  if (existingLogs.length === 0) {
    db.addAuditLog({
      userId: 'usr_admin_01',
      userRole: 'osa_admin',
      action: 'SYSTEM_INITIALIZATION',
      targetType: 'system',
      targetId: 'all',
      details: 'System initialized with persistent storage for NCST Student & OSA operations.',
      ipAddress: '127.0.0.1'
    });
  }

  console.log('✅ Safe database initialization complete. All existing records preserved.');
}

module.exports = { seedDatabase };
