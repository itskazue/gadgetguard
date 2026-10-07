const fs = require('fs');
const path = require('path');

// Determine persistent data directory
const DATA_DIR = process.env.DATA_DIR || process.env.PERSISTENT_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'database.json');
const BACKUP_PATH = path.join(DATA_DIR, 'database.backup.json');

// In-memory cache synced with persistent storage
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
  recovery_chats: [],
  uploaded_files: [],
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

// PostgreSQL pool instance (activated when DATABASE_URL or POSTGRES_URL is provided)
let pgPool = null;
let isPgActive = false;

const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_CONNECTION_STRING;
if (dbUrl) {
  try {
    const { Pool } = require('pg');
    pgPool = new Pool({
      connectionString: dbUrl,
      ssl: (dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1')) ? false : { rejectUnauthorized: false }
    });
    pgPool.on('error', (err) => {
      console.warn('⚠️ [PostgreSQL] Background pool warning:', err.message);
    });
  } catch (e) {
    console.warn('⚠️ [PostgreSQL] Failed to initialize pg module:', e.message);
  }
}

// Synchronous file load on module initialization
function loadFromFileSync() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf8');
      if (raw && raw.trim().length > 0) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          dbData = { ...dbData, ...parsed };
          return true;
        }
      }
    }

    // Attempt recovery from backup if main file is missing or invalid
    if (fs.existsSync(BACKUP_PATH)) {
      const backupRaw = fs.readFileSync(BACKUP_PATH, 'utf8');
      if (backupRaw && backupRaw.trim().length > 0) {
        const parsedBackup = JSON.parse(backupRaw);
        if (parsedBackup && typeof parsedBackup === 'object') {
          dbData = { ...dbData, ...parsedBackup };
          saveDBSync();
          return true;
        }
      }
    }
  } catch (err) {
    console.error('Error loading persistent database file:', err);
  }
  return false;
}

// Synchronous atomic save to disk
function saveDBSync() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const jsonString = JSON.stringify(dbData, null, 2);
    const tmpPath = DB_PATH + '.tmp';
    fs.writeFileSync(tmpPath, jsonString, 'utf8');
    fs.renameSync(tmpPath, DB_PATH);
    // Maintain secondary backup
    fs.writeFileSync(BACKUP_PATH, jsonString, 'utf8');
  } catch (err) {
    console.error('Error saving persistent database to disk:', err);
  }
}

// Initial synchronous load on require
loadFromFileSync();

// Asynchronous sync helper for PostgreSQL
async function syncToPg(collection, id, doc, action = 'upsert') {
  if (!pgPool || !isPgActive) return;
  try {
    if (action === 'delete') {
      await pgPool.query('DELETE FROM gg_records WHERE collection = $1 AND id = $2;', [collection, id]);
    } else {
      await pgPool.query(
        `INSERT INTO gg_records (collection, id, data, updated_at) 
         VALUES ($1, $2, $3, NOW()) 
         ON CONFLICT (collection, id) DO UPDATE 
         SET data = EXCLUDED.data, updated_at = NOW();`,
        [collection, id, JSON.stringify(doc)]
      );
    }
  } catch (err) {
    console.warn(`[PostgreSQL Sync Error] ${collection}:${id}:`, err.message);
  }
}

async function syncSettingsToPg(settings) {
  if (!pgPool || !isPgActive) return;
  try {
    await pgPool.query(
      `INSERT INTO gg_settings (key, data, updated_at) 
       VALUES ('system_settings', $1, NOW()) 
       ON CONFLICT (key) DO UPDATE 
       SET data = EXCLUDED.data, updated_at = NOW();`,
      [JSON.stringify(settings)]
    );
  } catch (err) {
    console.warn('[PostgreSQL Settings Sync Error]:', err.message);
  }
}

const db = {
  // Initialize Database: Connects to PostgreSQL if available, sets up tables, migrates data
  async initDB() {
    if (!pgPool) {
      console.log(`📁 [Database] Using persistent file storage at: ${DB_PATH}`);
      return;
    }

    try {
      console.log('🔄 [PostgreSQL] Initializing persistent database connection...');
      await pgPool.query('SELECT NOW();');
      
      // Create tables for persistent document storage
      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS gg_records (
          collection VARCHAR(64) NOT NULL,
          id VARCHAR(128) NOT NULL,
          data JSONB NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (collection, id)
        );
        CREATE TABLE IF NOT EXISTS gg_settings (
          key VARCHAR(64) PRIMARY KEY,
          data JSONB NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      isPgActive = true;

      // Query all stored records from PostgreSQL
      const recordsRes = await pgPool.query('SELECT collection, id, data FROM gg_records ORDER BY created_at ASC;');
      const settingsRes = await pgPool.query("SELECT data FROM gg_settings WHERE key = 'system_settings';");

      if (recordsRes.rows.length > 0) {
        console.log(`✅ [PostgreSQL] Loaded ${recordsRes.rows.length} persistent records from remote database.`);
        // Organize into in-memory collections
        const pgData = {};
        for (const row of recordsRes.rows) {
          if (!pgData[row.collection]) pgData[row.collection] = [];
          pgData[row.collection].push(row.data);
        }
        // Merge with dbData
        for (const col of Object.keys(pgData)) {
          dbData[col] = pgData[col];
        }
        if (settingsRes.rows.length > 0 && settingsRes.rows[0].data) {
          dbData.system_settings = settingsRes.rows[0].data;
        }
        // Keep local file cache in sync with remote DB
        saveDBSync();
      } else {
        // First boot with empty Postgres database: Migrate local records into Postgres
        console.log('🌱 [PostgreSQL] Database is fresh. Migrating initial dataset to persistent remote store...');
        const collections = [
          'users', 'gadgets', 'missing_reports', 'found_reports', 
          'claims', 'returns', 'qr_scans', 'notifications', 
          'audit_logs', 'recovery_chats', 'uploaded_files'
        ];
        for (const col of collections) {
          const items = dbData[col] || [];
          for (const item of items) {
            if (item && item.id) {
              await syncToPg(col, item.id, item, 'upsert');
            }
          }
        }
        if (dbData.system_settings) {
          await syncSettingsToPg(dbData.system_settings);
        }
        console.log('✅ [PostgreSQL] Initial migration complete.');
      }
    } catch (err) {
      console.warn('⚠️ [PostgreSQL] Connection failed, falling back to local file storage:', err.message);
      isPgActive = false;
    }
  },

  get(collection) {
    if (!dbData[collection]) {
      dbData[collection] = [];
    }
    return dbData[collection];
  },
  
  find(collection, filterFn) {
    const list = this.get(collection);
    return filterFn ? list.filter(filterFn) : list;
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
    saveDBSync();
    if (newDoc.id) {
      syncToPg(collection, newDoc.id, newDoc, 'upsert');
    }
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
    saveDBSync();
    syncToPg(collection, id, list[index], 'upsert');
    return list[index];
  },

  delete(collection, id) {
    const list = this.get(collection);
    const index = list.findIndex(item => item.id === id);
    if (index === -1) return false;
    list.splice(index, 1);
    saveDBSync();
    syncToPg(collection, id, null, 'delete');
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
    saveDBSync();
    syncSettingsToPg(updated);
    return updated;
  },

  // Note: reset() preserves non-destructive behavior
  reset(freshData) {
    if (freshData && typeof freshData === 'object') {
      dbData = { ...dbData, ...freshData };
      saveDBSync();
    }
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
    return this.insert('audit_logs', log);
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
    return this.insert('notifications', notif);
  }
};

module.exports = db;
