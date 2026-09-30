const fs = require('fs');
const path = require('path');
const { hashPassword } = require('./server/auth');

const dbPath = path.join(__dirname, 'data', 'database.json');

const cleanData = {
  users: [
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ],
  gadgets: [],
  claims: [],
  finderReports: [],
  missingReports: [],
  auditLogs: [
    {
      id: 'log_' + Date.now().toString(36),
      timestamp: new Date().toISOString(),
      userId: 'usr_admin_01',
      userRole: 'osa_admin',
      action: 'SYSTEM_INITIALIZED',
      targetType: 'system',
      targetId: 'system',
      details: 'GadgetGuard platform reset to fresh clean state. Ready for live student registration demo.'
    }
  ],
  settings: {
    schoolName: 'National College of Science and Technology',
    osaOfficeLocation: 'Room 204, Student Affairs Building',
    osaContactPhone: '+63 917 555 4234',
    osaEmail: 'osa@ncst.edu.ph',
    operatingHours: 'Mon - Fri: 8:00 AM - 5:00 PM',
    autoStickerCodePrefix: 'NCST-GG-2026',
    requireOsaApproval: true
  }
};

fs.writeFileSync(dbPath, JSON.stringify(cleanData, null, 2), 'utf8');
console.log('✅ Database successfully reset to clean state with only Carlos Mendoza (OSA Admin)!');
