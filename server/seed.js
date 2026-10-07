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
    },
    {
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
    },
    {
      id: 'usr_student_02',
      name: 'Thirdy Manaog',
      email: 'rogeliomanaog3@gmail.com',
      passwordHash: hashPassword('password123'),
      role: 'student',
      idNumber: '2024-12345',
      department: 'College - BS-Information Technology',
      contactNumber: '09925792602',
      status: 'ACTIVE',
      avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Thirdy%20Manaog',
      createdAt: '2026-09-06T10:00:00.000Z',
      updatedAt: '2026-09-06T10:00:00.000Z'
    },
    {
      id: 'usr_student_03',
      name: 'Maria Santos',
      email: 'msantos@gmail.com',
      passwordHash: hashPassword('password123'),
      role: 'student',
      idNumber: '2023-10294',
      department: 'College - BS-Computer Science',
      contactNumber: '09171234567',
      status: 'ACTIVE',
      avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Maria%20Santos',
      createdAt: '2026-09-07T11:00:00.000Z',
      updatedAt: '2026-09-07T11:00:00.000Z'
    },
    {
      id: 'usr_student_04',
      name: 'Juan Dela Cruz',
      email: 'jdelacruz@gmail.com',
      passwordHash: hashPassword('password123'),
      role: 'student',
      idNumber: '2024-88412',
      department: 'SHS - STEM - Science, Technology, Engineering & Mathematics',
      contactNumber: '09189876543',
      status: 'ACTIVE',
      avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Juan%20Dela%20Cruz',
      createdAt: '2026-09-08T08:15:00.000Z',
      updatedAt: '2026-09-08T08:15:00.000Z'
    }
  ];

  const cleanGadgets = [
    {
      id: 'gdt_01',
      userId: 'usr_student_01',
      category: 'Smartphone',
      brand: 'Samsung',
      model: 'Galaxy S23 Ultra',
      serialNumber: '354892019482910',
      color: 'Phantom Black',
      description: 'Matte black protective case with official NCST security tamper sticker.',
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
    },
    {
      id: 'gdt_02',
      userId: 'usr_student_02',
      category: 'Laptop',
      brand: 'Apple',
      model: 'MacBook Air M2',
      serialNumber: 'C02G410JMD6T',
      color: 'Space Gray',
      description: '13-inch Space Gray MacBook Air in a clear protective shell.',
      photoUrl: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=500&auto=format&fit=crop&q=80',
      status: 'REGISTERED',
      secureToken: token2,
      qrCodeDataUrl: qr2,
      rejectionReason: null,
      registrationDate: '2026-09-08T10:15:00.000Z',
      approvedAt: '2026-09-08T11:30:00.000Z',
      approvedBy: 'usr_admin_01',
      createdAt: '2026-09-08T10:15:00.000Z',
      updatedAt: '2026-09-08T11:30:00.000Z'
    },
    {
      id: 'gdt_03',
      userId: 'usr_student_03',
      category: 'Tablet',
      brand: 'Apple',
      model: 'iPad Air 5th Gen',
      serialNumber: 'DMPV348LHG81',
      color: 'Starlight',
      description: '64GB Wi-Fi tablet with Apple Pencil 2 attached.',
      photoUrl: 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=500&auto=format&fit=crop&q=80',
      status: 'REGISTERED',
      secureToken: token3,
      qrCodeDataUrl: qr3,
      rejectionReason: null,
      registrationDate: '2026-09-09T08:45:00.000Z',
      approvedAt: '2026-09-09T09:20:00.000Z',
      approvedBy: 'usr_admin_01',
      createdAt: '2026-09-09T08:45:00.000Z',
      updatedAt: '2026-09-09T09:20:00.000Z'
    },
    {
      id: 'gdt_04',
      userId: 'usr_student_04',
      category: 'Laptop',
      brand: 'Asus',
      model: 'ROG Zephyrus G14',
      serialNumber: 'M5NRCX0349281',
      color: 'Eclipse Gray',
      description: 'Gaming laptop with AniMe Matrix LED display lid.',
      photoUrl: 'https://images.unsplash.com/photo-1603302576837-37561b2e2302?w=500&auto=format&fit=crop&q=80',
      status: 'REGISTERED',
      secureToken: token4,
      qrCodeDataUrl: qr4,
      rejectionReason: null,
      registrationDate: '2026-09-10T13:00:00.000Z',
      approvedAt: '2026-09-10T14:10:00.000Z',
      approvedBy: 'usr_admin_01',
      createdAt: '2026-09-10T13:00:00.000Z',
      updatedAt: '2026-09-10T14:10:00.000Z'
    }
  ];

  // 1. Ensure required test accounts exist without overwriting or deleting user data
  for (const user of cleanUsers) {
    const existing = db.findOne('users', u => 
      u.id === user.id || 
      (u.email && u.email.toLowerCase() === user.email.toLowerCase()) || 
      (u.idNumber && u.idNumber === user.idNumber)
    );
    if (!existing) {
      db.insert('users', user);
      console.log(`  + Seeded test account: ${user.name} (${user.idNumber})`);
    }
  }

  // 2. Ensure initial baseline gadgets exist if no gadgets in database
  const currentGadgets = db.get('gadgets') || [];
  if (currentGadgets.length === 0) {
    for (const gadget of cleanGadgets) {
      db.insert('gadgets', gadget);
      console.log(`  + Seeded baseline gadget: ${gadget.brand} ${gadget.model}`);
    }
  } else {
    // If gadgets exist, verify baseline test gadgets are present by ID if not already there
    for (const gadget of cleanGadgets) {
      const existing = db.findById('gadgets', gadget.id);
      if (!existing && !currentGadgets.some(g => g.serialNumber === gadget.serialNumber)) {
        db.insert('gadgets', gadget);
      }
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
