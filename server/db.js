const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'database.json');

// In-memory cache synced with disk
let dbData = {
  users: [],
  gadgets: [],
  missing_reports: [],
  qr_scans: [],
  found_reports: [],
  claims: [],
  returns: [],
  notifications: [],
  audit_logs: [],
  system_settings: {
    schoolName: "National College of Science and Technology (NCST)",
    campusName: "Main Campus - Emilio Aguinaldo Hwy, Dasmariñas, Cavite",
    osaOfficeLocation: "Office of Student Affairs (OSA) — Room 1109, NCST Main Campus",
    osaContactPhone: "(046) 416-0166 / +63 917 555 6278",
    osaEmail: "osa@ncst.edu.ph",
    operatingHours: "Monday - Friday: 8:00 AM - 5:00 PM",
    enableAutoApproveUsers: true,
    requireQrSecurityPasscode: false
  }
};

function initDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf8');
      dbData = JSON.parse(raw);
    } else {
      saveDB();
    }
  } catch (err) {
    console.error('Error initializing database:', err);
  }
}

function saveDB() {
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DB_PATH, JSON.stringify(dbData, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving database:', err);
  }
}

const db = {
  get(collection) {
    if (!dbData[collection]) {
      dbData[collection] = [];
    }
    return dbData[collection];
  },
  
  find(collection, filterFn) {
    const list = this.get(collection);
    return list.filter(filterFn);
  },

  findOne(collection, filterFn) {
    const list = this.get(collection);
    return list.find(filterFn);
  },

  findById(collection, id) {
    return this.findOne(collection, item => item.id === id);
  },

  insert(collection, doc) {
    const list = this.get(collection);
    const newDoc = {
      ...doc,
      createdAt: doc.createdAt || new Date().toISOString(),
      updatedAt: doc.updatedAt || new Date().toISOString()
    };
    list.push(newDoc);
    saveDB();
    return newDoc;
  },

  update(collection, id, updates) {
    const list = this.get(collection);
    const index = list.findIndex(item => item.id === id);
    if (index === -1) return null;

    list[index] = {
      ...list[index],
      ...updates,
      updatedAt: new Date().toISOString()
    };
    saveDB();
    return list[index];
  },

  delete(collection, id) {
    const list = this.get(collection);
    const index = list.findIndex(item => item.id === id);
    if (index === -1) return false;
    list.splice(index, 1);
    saveDB();
    return true;
  },

  getSettings() {
    return dbData.system_settings || dbData.settings || {
      schoolName: 'National College of Science and Technology',
      osaOfficeLocation: 'Room 1109, Student Affairs Building',
      osaContactPhone: '+63 917 555 4234',
      osaEmail: 'osa@ncst.edu.ph',
      operatingHours: 'Mon - Fri: 8:00 AM - 5:00 PM',
      autoStickerCodePrefix: 'NCST-GG-2026',
      requireOsaApproval: true
    };
  },

  updateSettings(updates) {
    const current = this.getSettings();
    const updated = { ...current, ...updates };
    dbData.system_settings = updated;
    dbData.settings = updated;
    saveDB();
    return updated;
  },

  reset(freshData) {
    dbData = freshData;
    saveDB();
  },

  addAuditLog({ userId, userRole, action, targetType, targetId, details, ipAddress }) {
    const log = {
      id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      userId: userId || 'SYSTEM',
      userRole: userRole || 'system',
      action,
      targetType,
      targetId,
      details,
      ipAddress: ipAddress || '127.0.0.1',
      timestamp: new Date().toISOString()
    };
    this.insert('audit_logs', log);
    return log;
  },

  addNotification({ userId, title, message, type, linkUrl }) {
    const notif = {
      id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      userId,
      title,
      message,
      type: type || 'SYSTEM',
      read: false,
      linkUrl: linkUrl || null,
      createdAt: new Date().toISOString()
    };
    this.insert('notifications', notif);
    return notif;
  }
};

initDB();

module.exports = db;
