const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'gib_invoices.db');

let rawDbInstance = null;
let dbEngine = null;
let initPromise = null;

// Proxy aracılığıyla tüm fonksiyonlar db.prepare(), db.exec() çağrılarını sorunsuz yapar
const db = new Proxy({}, {
  get(target, prop) {
    if (prop === 'init') return init;
    if (prop === 'engine') return dbEngine;
    if (!rawDbInstance) {
      throw new Error('[DB] Veritabanı henüz başlatılmadı. Lütfen "await db.init()" tamamlanmasını bekleyin.');
    }
    const val = rawDbInstance[prop];
    return typeof val === 'function' ? val.bind(rawDbInstance) : val;
  }
});

/**
 * Evrensel Veritabanı Başlatıcı
 * 1. Node 22+ ise dahili node:sqlite kullanır.
 * 2. Node 20/18 ise veya GLIBC kütüphanesi eski ise WebAssembly tabanlı sql.js kullanır.
 * Sıfır C++ derlemesi, sıfır GLIBC hatası, %100 taşınabilir SQLite!
 */
async function init() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // 1. Node.js built-in sqlite (Node 22.5+)
    try {
      const NodeSqlite = require('node:sqlite').DatabaseSync;
      const nativeDb = new NodeSqlite(DB_PATH);
      nativeDb.exec('PRAGMA journal_mode = WAL;');
      nativeDb.exec('PRAGMA synchronous = NORMAL;');
      rawDbInstance = nativeDb;
      dbEngine = 'node:sqlite (Node 22+ Built-in)';
    } catch (e1) {
      // 2. sql.js (WebAssembly) - C++ veya GLIBC bağımsız evrensel motor
      try {
        const initSqlJs = require('sql.js');
        const SQL = await initSqlJs();
        let fileBuffer = null;
        if (fs.existsSync(DB_PATH)) {
          fileBuffer = fs.readFileSync(DB_PATH);
        }
        const wasmDb = fileBuffer ? new SQL.Database(fileBuffer) : new SQL.Database();

        function saveToDisk() {
          try {
            const data = wasmDb.export();
            fs.writeFileSync(DB_PATH, Buffer.from(data));
          } catch (err) {
            console.error('[DB] Dosyaya kaydetme hatası:', err.message);
          }
        }

        process.on('beforeExit', saveToDisk);
        process.on('SIGINT', () => { saveToDisk(); process.exit(0); });
        process.on('SIGTERM', () => { saveToDisk(); process.exit(0); });

        rawDbInstance = {
          exec: (sql) => {
            wasmDb.exec(sql);
            saveToDisk();
          },
          prepare: (sql) => ({
            run: (...params) => {
              const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
              wasmDb.run(sql, flat);
              const res = wasmDb.exec('SELECT last_insert_rowid() as id, changes() as changes;');
              const lastInsertRowid = res[0]?.values[0][0] || 0;
              const changes = res[0]?.values[0][1] || 0;
              saveToDisk();
              return { lastInsertRowid, changes };
            },
            get: (...params) => {
              const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
              const stmt = wasmDb.prepare(sql);
              stmt.bind(flat);
              let row = null;
              if (stmt.step()) {
                row = stmt.getAsObject();
              }
              stmt.free();
              return row || null;
            },
            all: (...params) => {
              const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
              const stmt = wasmDb.prepare(sql);
              stmt.bind(flat);
              const rows = [];
              while (stmt.step()) {
                rows.push(stmt.getAsObject());
              }
              stmt.free();
              return rows;
            }
          })
        };
        dbEngine = 'sql.js (WebAssembly / GLIBC Bağımsız)';
      } catch (e2) {
        console.error('❌ [KRİTİK HATA] Veritabanı motoru başlatılamadı:', e2.message);
        throw e2;
      }
    }

    console.log(`[DB] SQLite Motoru Devrede: ${dbEngine}`);
    setupSchema();
    seedInitialData();
  })();

  return initPromise;
}

function setupSchema() {
  db.exec(`
    -- Kullanıcılar Tablosu (Roller: 'admin' veya 'user')
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      active_company_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Firmalar / Mükellefler Tablosu (Çoklu Firma / Mali Müşavir Desteği)
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      name TEXT NOT NULL,
      vkn_tckn TEXT,
      vergi_dairesi TEXT,
      gib_user TEXT NOT NULL,
      gib_pass TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      is_active INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Faturalar Tablosu
    CREATE TABLE IF NOT EXISTS invoices (
      ettn TEXT PRIMARY KEY,
      company_id INTEGER,
      belge_numarasi TEXT,
      belge_tarihi TEXT,
      belge_turu TEXT DEFAULT 'FATURA',
      alici_vkn_tckn TEXT,
      alici_unvan TEXT,
      odenecek_tutar REAL DEFAULT 0,
      matrah REAL DEFAULT 0,
      kdv_tutari REAL DEFAULT 0,
      para_birimi TEXT DEFAULT 'TRY',
      onay_durumu TEXT,
      kaynak TEXT DEFAULT 'GIB',
      html_preview TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_invoices_belge_tarihi ON invoices(belge_tarihi);
    CREATE INDEX IF NOT EXISTS idx_invoices_onay_durumu ON invoices(onay_durumu);
    CREATE INDEX IF NOT EXISTS idx_invoices_alici_vkn ON invoices(alici_vkn_tckn);

    CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME,
      status TEXT,
      invoices_found INTEGER DEFAULT 0,
      invoices_added INTEGER DEFAULT 0,
      invoices_updated INTEGER DEFAULT 0,
      message TEXT
    );
  `);

  // Migration: invoices tablosuna company_id kolonu ekleme kontrolü
  try {
    const colInfo = db.prepare("PRAGMA table_info('invoices');").all();
    const hasCompanyId = colInfo.some(c => c.name === 'company_id');
    if (!hasCompanyId) {
      db.exec('ALTER TABLE invoices ADD COLUMN company_id INTEGER;');
    }
  } catch (e) {}

  // Migration: sync_logs tablosuna company_id kolonu ekleme kontrolü
  try {
    const syncColInfo = db.prepare("PRAGMA table_info('sync_logs');").all();
    const hasSyncCompId = syncColInfo.some(c => c.name === 'company_id');
    if (!hasSyncCompId) {
      db.exec('ALTER TABLE sync_logs ADD COLUMN company_id INTEGER;');
    }
  } catch (e) {}

  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_invoices_company ON invoices(company_id);');
  } catch (e) {}
}

/**
 * İlk sistem tohum verilerini oluşturur (Kullanıcılar & Varsayılan Firma)
 */
function seedInitialData() {
  // 1. Kullanıcıları kontrol et
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users;').get().count;
  if (userCount === 0) {
    const insertUser = db.prepare(`
      INSERT INTO users (username, password, name, role)
      VALUES (?, ?, ?, ?);
    `);
    // Sistem Yöneticisi
    const adminUser = (process.env.APP_USER || 'admin').trim();
    const adminPass = (process.env.APP_PASS || 'admin123').trim();
    insertUser.run(adminUser, adminPass, 'Sistem Yöneticisi', 'admin');
    console.log(`[DB] İlk yönetici hesabı oluşturuldu (${adminUser}).`);
  }

  // 2. Firmaları kontrol et
  const companyCount = db.prepare('SELECT COUNT(*) as count FROM companies;').get().count;
  if (companyCount === 0) {
    // Config veya ortam değişkenlerinden oku
    let gibUser = process.env.GIB_USER || '';
    let gibPass = process.env.GIB_PASS || '';
    let gibVkn = process.env.GIB_VKN || '';
    let gibUnvan = process.env.GIB_UNVAN || '';
    let gibVd = process.env.GIB_VERGI_DAIRESI || '';

    const cfgPath = path.join(__dirname, '../config/gib_config.json');
    if (fs.existsSync(cfgPath)) {
      try {
        const c = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        if (c.kullaniciKodu) gibUser = c.kullaniciKodu;
        if (c.sifre) gibPass = c.sifre;
        if (c.vkn) gibVkn = c.vkn;
        if (c.unvan) gibUnvan = c.unvan;
        if (c.vergiDairesi) gibVd = c.vergiDairesi;
      } catch (e) {}
    }

    if (gibUser && gibPass) {
      const insertComp = db.prepare(`
        INSERT INTO companies (name, vkn_tckn, vergi_dairesi, gib_user, gib_pass, is_active)
        VALUES (?, ?, ?, ?, ?, 1);
      `);
      const compRes = insertComp.run(gibUnvan || 'Varsayılan Firma', gibVkn, gibVd, gibUser, gibPass);
      const defaultCompanyId = Number(compRes.lastInsertRowid);

      // Mevcut faturasız faturaları bu varsayılan firmaya bağla
      db.prepare('UPDATE invoices SET company_id = ? WHERE company_id IS NULL;').run(defaultCompanyId);

      // Kullanıcıların aktif firmasını güncelle
      db.prepare('UPDATE users SET active_company_id = ? WHERE active_company_id IS NULL;').run(defaultCompanyId);

      console.log(`[DB] Yapılandırmadan varsayılan firma oluşturuldu (#${defaultCompanyId}: ${gibUnvan || 'Varsayılan Firma'}).`);
    }
  }
}


/**
 * ==========================================
 * KULLANICI İŞLEMLERİ
 * ==========================================
 */

function getUserByUsername(username) {
  const stmt = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?);');
  return stmt.get(username) || null;
}

function getUserById(id) {
  const stmt = db.prepare('SELECT id, username, name, role, active_company_id, created_at FROM users WHERE id = ?;');
  return stmt.get(id) || null;
}

function getUserWithPasswordById(id) {
  const stmt = db.prepare('SELECT * FROM users WHERE id = ?;');
  return stmt.get(id) || null;
}

function getUsers() {
  const stmt = db.prepare(`
    SELECT u.id, u.username, u.name, u.role, u.active_company_id, u.created_at, c.name AS active_company_name
    FROM users u
    LEFT JOIN companies c ON u.active_company_id = c.id
    ORDER BY u.id ASC;
  `);
  return stmt.all();
}

function createUser(userData) {
  const stmt = db.prepare(`
    INSERT INTO users (username, password, name, role, active_company_id)
    VALUES (?, ?, ?, ?, ?);
  `);
  const res = stmt.run(
    userData.username,
    userData.password,
    userData.name || userData.username,
    userData.role || 'user',
    userData.activeCompanyId || null
  );
  return getUserById(res.lastInsertRowid);
}

function updateUser(id, updateData) {
  const current = getUserById(id);
  if (!current) return null;

  const stmt = db.prepare(`
    UPDATE users SET
      name = COALESCE(?, name),
      password = COALESCE(?, password),
      role = COALESCE(?, role),
      active_company_id = COALESCE(?, active_company_id),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?;
  `);

  stmt.run(
    updateData.name || null,
    updateData.password || null,
    updateData.role || null,
    updateData.active_company_id || updateData.activeCompanyId || null,
    id
  );

  return getUserById(id);
}

function deleteUser(id) {
  const current = getUserById(id);
  if (!current) return false;
  if (current.username === 'admin') {
    throw new Error('Ana sistem yöneticisi (admin) hesabı silinemez.');
  }
  db.prepare('DELETE FROM users WHERE id = ?;').run(id);
  return true;
}

/**
 * ==========================================
 * FİRMA / MÜKELLEF İŞLEMLERİ (Multi-Company)
 * ==========================================
 */

function getCompanies(userId = null, isAdmin = false) {
  let query = `
    SELECT c.*, u.username as assigned_user_username, u.name as assigned_user_name, u.role as assigned_user_role
    FROM companies c
    LEFT JOIN users u ON c.user_id = u.id
  `;
  const params = [];

  if (!isAdmin && userId) {
    query += ' WHERE c.user_id = ?';
    params.push(userId);
  }

  query += ' ORDER BY c.is_active DESC, c.name ASC;';

  const rows = params.length > 0 ? db.prepare(query).all(...params) : db.prepare(query).all();
  return rows.map(c => ({
    ...c,
    // Arayüze şifreyi maskeli gönder
    gib_pass_masked: c.gib_pass ? '••••••••' : ''
  }));
}

function getCompanyById(id) {
  const stmt = db.prepare(`
    SELECT c.*, u.username as assigned_user_username, u.name as assigned_user_name
    FROM companies c
    LEFT JOIN users u ON c.user_id = u.id
    WHERE c.id = ?;
  `);
  return stmt.get(id) || null;
}

function getActiveCompany(userId = null, isAdmin = false) {
  if (userId) {
    const user = getUserById(userId);
    if (user && user.active_company_id) {
      const comp = getCompanyById(user.active_company_id);
      if (comp && (isAdmin || comp.user_id === userId)) {
        return comp;
      }
    }

    if (!isAdmin) {
      // Normal kullanıcı için kendi aktif firması veya ilk firması
      const userActive = db.prepare('SELECT * FROM companies WHERE user_id = ? AND is_active = 1 LIMIT 1;').get(userId);
      if (userActive) return userActive;
      const userFirst = db.prepare('SELECT * FROM companies WHERE user_id = ? ORDER BY id ASC LIMIT 1;').get(userId);
      if (userFirst) return userFirst;
      return null;
    }
  }

  // Admin veya genel aktif
  const stmt = db.prepare('SELECT * FROM companies WHERE is_active = 1 LIMIT 1;');
  let comp = stmt.get();
  if (!comp) {
    comp = db.prepare('SELECT * FROM companies ORDER BY id ASC LIMIT 1;').get();
  }
  return comp || null;
}

function setActiveCompany(companyId, userId = null, isAdmin = false) {
  const target = getCompanyById(companyId);
  if (!target) {
    throw new Error('Firma bulunamadı (ID: ' + companyId + ')');
  }

  if (!isAdmin && userId && target.user_id !== userId) {
    throw new Error('Bu mükellefe erişim yetkiniz bulunmuyor.');
  }

  // Genel aktif bayrağını güncelle
  if (isAdmin) {
    db.prepare('UPDATE companies SET is_active = 0;').run();
    db.prepare('UPDATE companies SET is_active = 1 WHERE id = ?;').run(companyId);
  } else if (userId) {
    db.prepare('UPDATE companies SET is_active = 0 WHERE user_id = ?;').run(userId);
    db.prepare('UPDATE companies SET is_active = 1 WHERE id = ?;').run(companyId);
  }

  // Kullanıcının aktif firmasını güncelle
  if (userId) {
    db.prepare('UPDATE users SET active_company_id = ? WHERE id = ?;').run(companyId, userId);
  }

  return target;
}

function createCompany(data, userId = null, isAdmin = false) {
  if (!data.name || !data.gib_user || !data.gib_pass) {
    throw new Error('Firma Ünvanı, GİB Kullanıcı Kodu ve Şifre zorunludur.');
  }

  // Atanan kullanıcı: Admin seçtiyse data.user_id, aksi halde giriş yapan userId
  let assignedUserId = userId;
  if (isAdmin) {
    if (data.user_id !== undefined) {
      assignedUserId = data.user_id ? Number(data.user_id) : null;
    }
  }

  // Eğer bu ilk firmaysa otomatik aktif yap
  const count = db.prepare('SELECT COUNT(*) as count FROM companies;').get().count;
  const isActive = (count === 0 || data.is_active) ? 1 : 0;

  if (isActive === 1 && isAdmin) {
    db.prepare('UPDATE companies SET is_active = 0;').run();
  }

  const stmt = db.prepare(`
    INSERT INTO companies (
      user_id, name, vkn_tckn, vergi_dairesi,
      gib_user, gib_pass, phone, email, address, is_active
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    );
  `);

  const res = stmt.run(
    assignedUserId,
    data.name,
    data.vkn_tckn || data.vkn || '',
    data.vergi_dairesi || data.vergiDairesi || '',
    data.gib_user || data.kullaniciKodu,
    data.gib_pass || data.sifre,
    data.phone || '',
    data.email || '',
    data.address || '',
    isActive
  );

  const newId = Number(res.lastInsertRowid);
  if (assignedUserId && isActive === 1) {
    db.prepare('UPDATE users SET active_company_id = ? WHERE id = ?;').run(newId, assignedUserId);
  }

  return getCompanyById(newId);
}

function updateCompany(id, data, userId = null, isAdmin = false) {
  const current = getCompanyById(id);
  if (!current) throw new Error('Firma bulunamadı.');

  // Normal kullanıcı sadece kendi firmasını düzenleyebilir
  if (!isAdmin && userId && current.user_id !== userId) {
    throw new Error('Bu mükellefi düzenleme yetkiniz bulunmuyor.');
  }

  // Şifre maskeli geldiyse eski şifreyi koru
  let password = data.gib_pass || data.sifre;
  if (!password || password === '••••••••') {
    password = current.gib_pass;
  }

  // Admin atanmış kullanıcıyı değiştirebilir
  let newUserId = current.user_id;
  if (isAdmin && data.user_id !== undefined) {
    newUserId = data.user_id ? Number(data.user_id) : null;
  }

  const stmt = db.prepare(`
    UPDATE companies SET
      user_id = ?,
      name = COALESCE(?, name),
      vkn_tckn = COALESCE(?, vkn_tckn),
      vergi_dairesi = COALESCE(?, vergi_dairesi),
      gib_user = COALESCE(?, gib_user),
      gib_pass = ?,
      phone = COALESCE(?, phone),
      email = COALESCE(?, email),
      address = COALESCE(?, address),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?;
  `);

  stmt.run(
    newUserId,
    data.name || null,
    data.vkn_tckn !== undefined ? data.vkn_tckn : null,
    data.vergi_dairesi !== undefined ? data.vergi_dairesi : null,
    data.gib_user !== undefined ? data.gib_user : null,
    password,
    data.phone !== undefined ? data.phone : null,
    data.email !== undefined ? data.email : null,
    data.address !== undefined ? data.address : null,
    id
  );

  return getCompanyById(id);
}

function deleteCompany(id, userId = null, isAdmin = false) {
  const current = getCompanyById(id);
  if (!current) return false;

  if (!isAdmin && userId && current.user_id !== userId) {
    throw new Error('Bu mükellefi silme yetkiniz bulunmuyor.');
  }

  const count = db.prepare('SELECT COUNT(*) as count FROM companies;').get().count;
  if (count <= 1) {
    throw new Error('Sistemde en az bir aktif firma bulunmalıdır. Tek kalan firmayı silemezsiniz.');
  }

  db.prepare('DELETE FROM companies WHERE id = ?;').run(id);
  db.prepare('UPDATE users SET active_company_id = NULL WHERE active_company_id = ?;').run(id);

  // Eğer silinen firma aktifse başka bir firmayı aktif yap
  if (current.is_active === 1) {
    let nextComp = null;
    if (!isAdmin && userId) {
      nextComp = db.prepare('SELECT id FROM companies WHERE user_id = ? ORDER BY id ASC LIMIT 1;').get(userId);
    } else {
      nextComp = db.prepare('SELECT id FROM companies ORDER BY id ASC LIMIT 1;').get();
    }
    if (nextComp) {
      setActiveCompany(nextComp.id, userId, isAdmin);
    }
  }

  return true;
}

/**
 * ==========================================
 * FATURA İŞLEMLERİ (UPSERT & LISTING)
 * ==========================================
 */

/**
 * Faturayı ekler veya varsa günceller (UPSERT)
 */
function upsertInvoice(inv, companyId = null) {
  // Eğer companyId parametre olarak verilmediyse inv içinden veya aktif firmadan al
  let finalCompanyId = companyId || inv.company_id || inv.companyId || null;
  if (!finalCompanyId) {
    const activeComp = getActiveCompany();
    if (activeComp) finalCompanyId = activeComp.id;
  }

  const stmt = db.prepare(`
    INSERT INTO invoices (
      ettn, company_id, belge_numarasi, belge_tarihi, belge_turu,
      alici_vkn_tckn, alici_unvan, odenecek_tutar, matrah,
      kdv_tutari, para_birimi, onay_durumu, kaynak,
      html_preview, updated_at, last_synced_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT(ettn) DO UPDATE SET
      company_id = COALESCE(excluded.company_id, invoices.company_id),
      belge_numarasi = COALESCE(excluded.belge_numarasi, invoices.belge_numarasi),
      belge_tarihi = COALESCE(excluded.belge_tarihi, invoices.belge_tarihi),
      belge_turu = COALESCE(excluded.belge_turu, invoices.belge_turu),
      alici_vkn_tckn = COALESCE(excluded.alici_vkn_tckn, invoices.alici_vkn_tckn),
      alici_unvan = COALESCE(excluded.alici_unvan, invoices.alici_unvan),
      odenecek_tutar = CASE WHEN excluded.odenecek_tutar > 0 THEN excluded.odenecek_tutar ELSE invoices.odenecek_tutar END,
      matrah = CASE WHEN excluded.matrah > 0 THEN excluded.matrah ELSE invoices.matrah END,
      kdv_tutari = CASE WHEN excluded.kdv_tutari > 0 THEN excluded.kdv_tutari ELSE invoices.kdv_tutari END,
      onay_durumu = excluded.onay_durumu,
      html_preview = COALESCE(excluded.html_preview, invoices.html_preview),
      updated_at = CURRENT_TIMESTAMP,
      last_synced_at = CURRENT_TIMESTAMP
  `);

  stmt.run(
    inv.ettn,
    finalCompanyId,
    inv.belge_numarasi || inv.belgeNumarasi || null,
    inv.belge_tarihi || inv.belgeTarihi || null,
    inv.belge_turu || inv.belgeTuru || 'FATURA',
    inv.alici_vkn_tckn || inv.aliciVknTckn || null,
    inv.alici_unvan || inv.aliciUnvanAdSoyad || null,
    Number(inv.odenecek_tutar || inv.odenecekTutar || 0),
    Number(inv.matrah || 0),
    Number(inv.kdv_tutari || inv.kdvTutari || 0),
    inv.para_birimi || 'TRY',
    inv.onay_durumu || inv.onayDurumu || 'Taslak',
    inv.kaynak || 'GIB',
    inv.html_preview || inv.htmlPreview || null
  );
}

/**
 * Filtrelerle fatura listesi çeker
 */
function getInvoices(filters = {}) {
  let query = `
    SELECT 
      ettn, company_id, belge_numarasi, belge_tarihi, belge_turu,
      alici_vkn_tckn, alici_unvan, odenecek_tutar, matrah,
      kdv_tutari, para_birimi, onay_durumu, kaynak, last_synced_at
    FROM invoices 
    WHERE 1=1
  `;
  const params = [];

  if (filters.companyId) {
    query += ' AND (company_id = ? OR company_id IS NULL)';
    params.push(Number(filters.companyId));
  }

  if (filters.status) {
    query += ' AND LOWER(onay_durumu) = LOWER(?)';
    params.push(filters.status);
  }

  if (filters.search) {
    query += ' AND (belge_numarasi LIKE ? OR alici_unvan LIKE ? OR alici_vkn_tckn LIKE ?)';
    const s = `%${filters.search}%`;
    params.push(s, s, s);
  }

  // Tarih sıralaması (en yeni en üstte)
  query += ' ORDER BY created_at DESC, belge_numarasi DESC';

  if (filters.limit) {
    query += ' LIMIT ?';
    params.push(Number(filters.limit));
  }

  const stmt = db.prepare(query);
  const rows = stmt.all(...params);

  // Tarih aralığı filtresi varsa esnek filtrele
  let result = rows;
  if (filters.startDate || filters.endDate) {
    const parseFlexible = (dStr) => {
      if (!dStr) return 0;
      if (/^\d{4}-\d{2}-\d{2}$/.test(dStr)) {
        const [y, m, d] = dStr.split('-').map(Number);
        return new Date(y, m - 1, d).getTime();
      }
      if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(dStr)) {
        const [d, m, y] = dStr.split(/[/-]/).map(Number);
        return new Date(y, m - 1, d).getTime();
      }
      return new Date(dStr).getTime();
    };

    const startTs = filters.startDate ? parseFlexible(filters.startDate) : 0;
    const endTs = filters.endDate ? parseFlexible(filters.endDate) + 86400000 : Infinity;

    result = rows.filter(r => {
      if (!r.belge_tarihi) return true;
      const docTs = parseFlexible(r.belge_tarihi);
      return docTs >= startTs && docTs <= endTs;
    });
  }

  // GİB uyumlu nesne formatına map et
  return result.map(r => ({
    ettn: r.ettn,
    companyId: r.company_id,
    belgeNumarasi: r.belge_numarasi,
    belgeTarihi: r.belge_tarihi,
    belgeTuru: r.belge_turu,
    aliciVknTckn: r.alici_vkn_tckn,
    aliciUnvanAdSoyad: r.alici_unvan,
    odenecekTutar: r.odenecek_tutar,
    matrah: r.matrah,
    kdvTutari: r.kdv_tutari,
    onayDurumu: r.onay_durumu,
    paraBirimi: r.para_birimi,
    kaynak: r.kaynak,
    lastSyncedAt: r.last_synced_at
  }));
}

/**
 * ETTN ile tekil fatura çeker
 */
function getInvoiceByEttn(ettn) {
  const stmt = db.prepare('SELECT * FROM invoices WHERE ettn = ?');
  return stmt.get(ettn) || null;
}

/**
 * Fatura HTML önizlemesini kaydeder
 */
function saveInvoiceHtml(ettn, html) {
  const stmt = db.prepare('UPDATE invoices SET html_preview = ?, updated_at = CURRENT_TIMESTAMP WHERE ettn = ?');
  stmt.run(html, ettn);
}

/**
 * Dashboard & Finansal Özet İstatistikleri
 */
function getDashboardStats(companyId = null) {
  let where = 'WHERE 1=1';
  const params = [];
  if (companyId) {
    where += ' AND (company_id = ? OR company_id IS NULL)';
    params.push(Number(companyId));
  }

  const totalStmt = db.prepare(`
    SELECT 
      COUNT(*) as total_count,
      SUM(CASE WHEN LOWER(onay_durumu) = 'onaylandı' THEN odenecek_tutar ELSE 0 END) as total_approved_amount,
      SUM(CASE WHEN LOWER(onay_durumu) = 'onaylandı' THEN matrah ELSE 0 END) as total_approved_matrah,
      SUM(CASE WHEN LOWER(onay_durumu) = 'onaylandı' THEN kdv_tutari ELSE 0 END) as total_approved_kdv,
      SUM(CASE WHEN LOWER(onay_durumu) = 'onaylandı' THEN 1 ELSE 0 END) as approved_count,
      SUM(CASE WHEN LOWER(onay_durumu) != 'onaylandı' AND LOWER(onay_durumu) != 'silinmiş' THEN 1 ELSE 0 END) as draft_count,
      SUM(CASE WHEN LOWER(onay_durumu) = 'silinmiş' THEN 1 ELSE 0 END) as deleted_count
    FROM invoices
    ${where}
  `);
  const totals = totalStmt.get(...params);

  const lastSyncStmt = db.prepare("SELECT * FROM sync_logs WHERE status = 'SUCCESS' ORDER BY id DESC LIMIT 1");
  const lastSync = lastSyncStmt.get();

  return {
    totalCount: totals.total_count || 0,
    totalApprovedAmount: totals.total_approved_amount || 0,
    totalApprovedMatrah: totals.total_approved_matrah || 0,
    totalApprovedKdv: totals.total_approved_kdv || 0,
    approvedCount: totals.approved_count || 0,
    draftCount: totals.draft_count || 0,
    deletedCount: totals.deleted_count || 0,
    lastSyncTime: lastSync ? lastSync.finished_at : null
  };
}

/**
 * Senkronizasyon Logu Kaydı
 */
function startSyncLog(companyId = null) {
  const stmt = db.prepare("INSERT INTO sync_logs (company_id, started_at, status) VALUES (?, CURRENT_TIMESTAMP, 'RUNNING')");
  const res = stmt.run(companyId);
  return res.lastInsertRowid;
}

function finishSyncLog(id, { status, found, added, updated, message }) {
  const stmt = db.prepare(`
    UPDATE sync_logs SET 
      finished_at = CURRENT_TIMESTAMP,
      status = ?,
      invoices_found = ?,
      invoices_added = ?,
      invoices_updated = ?,
      message = ?
    WHERE id = ?
  `);
  stmt.run(status, found, added, updated, message || null, id);
}

module.exports = {
  db,
  init,
  seedInitialData,
  getUserByUsername,
  getUserById,
  getUserWithPasswordById,
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  getCompanies,
  getCompanyById,
  getActiveCompany,
  setActiveCompany,
  createCompany,
  updateCompany,
  deleteCompany,
  upsertInvoice,
  getInvoices,
  getInvoiceByEttn,
  saveInvoiceHtml,
  getDashboardStats,
  startSyncLog,
  finishSyncLog
};
