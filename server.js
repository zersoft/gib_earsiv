/**
 * GİB e-Arşiv Fatura Portalı & Entegrasyon Sunucusu (Standalone Microservice)
 * 
 * Bu sunucu bağımsız bir REST API ve modern Web Kokpiti sağlar:
 * - GİB Portalı ile doğrudan oturum yönetimi
 * - MERNİS / VKN Otomatik Müşteri Sicil Sorgulama
 * - Çok Kalemli / KDV Matrahlı Taslak Fatura Üretimi
 * - SMS OTP ile Resmi Mühürleme / İmzalama
 * - UBL-XML + HTML İmzalı Arşiv İndirme
 * - Otomatik E-Posta Gönderimi
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const gib = require('./lib/gib_earsiv');
const mailer = require('./lib/smtp_mailer');
const db = require('./lib/db');
const syncEngine = require('./lib/sync_engine');
const excelService = require('./lib/excel_service');
const auth = require('./lib/auth');
const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const app = express();
const PORT = process.env.PORT || 3005;

// cPanel / Nginx / Cloudflare arkasında Reverse Proxy & SSL (https) desteği
app.set('trust proxy', 1);

// Arka planda periyodik senkronizasyonu başlat (30 dakikada bir)
syncEngine.startPeriodicSync(30);

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Statik Dosyalar (Web Kokpiti)
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// 0. Kimlik Doğrulama ve Oturum Uç Noktaları
// ==========================================

// Giriş Yap (Login)
app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Kullanıcı adı ve şifre zorunludur.' });
    }

    const user = auth.authenticate(username, password);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Kullanıcı adı veya şifre hatalı!' });
    }

    const token = auth.createToken(user);
    res.json({
      success: true,
      token,
      user
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Oturum Doğrula (Me)
app.get('/api/auth/me', auth.authMiddleware, (req, res) => {
  try {
    const user = req.user;
    const dbUser = user.id ? db.getUserById(user.id) : null;
    const isAdmin = (dbUser?.role || user.role) === 'admin';
    const activeComp = db.getActiveCompany(user.id, isAdmin);
    res.json({
      success: true,
      user: {
        ...user,
        role: dbUser?.role || user.role || 'user',
        name: dbUser?.name || user.name,
        activeCompanyId: activeComp ? activeComp.id : null,
        activeCompanyName: activeComp ? activeComp.name : null,
        activeCompanyVkn: activeComp ? activeComp.vkn_tckn : null
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Çıkış Yap (Logout)
app.post('/api/auth/logout', (req, res) => {
  res.json({ success: true, message: 'Oturum kapatıldı.' });
});

// Kullanıcı Kendi Şifresini Değiştir
app.post('/api/auth/change-password', auth.authMiddleware, (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body || {};
    let userId = req.user?.id;

    if (!userId && req.user?.username) {
      const u = db.getUserByUsername(req.user.username);
      if (u) userId = u.id;
    }

    if (!userId) {
      return res.status(400).json({ success: false, error: 'Kullanıcı hesabı tespit edilemedi.' });
    }

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Mevcut şifre ve yeni şifre zorunludur.' });
    }

    if (newPassword.trim().length < 4) {
      return res.status(400).json({ success: false, error: 'Yeni şifre en az 4 karakter uzunluğunda olmalıdır.' });
    }

    if (confirmPassword && newPassword.trim() !== confirmPassword.trim()) {
      return res.status(400).json({ success: false, error: 'Yeni şifre ve şifre tekrarı uyuşmuyor.' });
    }

    const dbUser = db.getUserWithPasswordById(userId);
    if (!dbUser) {
      return res.status(404).json({ success: false, error: 'Kullanıcı hesabı bulunamadı.' });
    }

    if (dbUser.password !== currentPassword.trim()) {
      return res.status(400).json({ success: false, error: 'Mevcut şifrenizi hatalı girdiniz.' });
    }

    db.updateUser(userId, { password: newPassword.trim() });

    res.json({
      success: true,
      message: 'Şifreniz başarıyla değiştirildi. Bir sonraki girişinizde yeni şifrenizi kullanabilirsiniz.'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API Güvenlik Filtresi (Auth koruması)
app.use('/api', (req, res, next) => {
  // Herkese açık endpoint'ler
  if (
    req.path.startsWith('/auth/login') ||
    req.path.startsWith('/auth/logout') ||
    req.path === '/status' ||
    req.path === '/system/version'
  ) {
    return next();
  }
  return auth.authMiddleware(req, res, next);
});

// ==========================================
// 0.1 Çoklu Firma & Mükellef Yönetimi (Multi-Company)
// ==========================================

// Firmaları Listele
// 0.1 Çoklu Firma / Mükellef Yönetimi (Multi-Company)
// ==========================================

// Tanımlı Firmaları / Mükellefleri Listele
app.get('/api/companies', (req, res) => {
  try {
    const isAdmin = (req.user?.role === 'admin');
    const list = db.getCompanies(req.user?.id, isAdmin);
    const active = db.getActiveCompany(req.user?.id, isAdmin);
    res.json({
      success: true,
      isAdmin,
      activeCompanyId: active?.id || null,
      data: list
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Aktif Firmayı Oku
app.get('/api/companies/active', (req, res) => {
  try {
    const isAdmin = (req.user?.role === 'admin');
    const active = db.getActiveCompany(req.user?.id, isAdmin);
    if (!active) {
      return res.status(404).json({ success: false, error: 'Aktif mükellef / firma bulunamadı.' });
    }
    res.json({
      success: true,
      data: {
        ...active,
        gib_pass_masked: active.gib_pass ? '••••••••' : ''
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Yeni Firma / Mükellef Ekle
app.post('/api/companies', (req, res) => {
  try {
    const isAdmin = (req.user?.role === 'admin');
    const data = req.body;
    const created = db.createCompany(data, req.user?.id, isAdmin);
    res.json({
      success: true,
      message: `${created.name} mükellefi başarıyla eklendi.`,
      data: {
        ...created,
        gib_pass_masked: '••••••••'
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Firma Bilgilerini Güncelle
app.put('/api/companies/:id', (req, res) => {
  try {
    const isAdmin = (req.user?.role === 'admin');
    const { id } = req.params;
    const data = req.body;
    const updated = db.updateCompany(Number(id), data, req.user?.id, isAdmin);
    res.json({
      success: true,
      message: 'Firma / Mükellef bilgileri güncellendi.',
      data: {
        ...updated,
        gib_pass_masked: '••••••••'
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Firma Sil
app.delete('/api/companies/:id', (req, res) => {
  try {
    const isAdmin = (req.user?.role === 'admin');
    const { id } = req.params;
    db.deleteCompany(Number(id), req.user?.id, isAdmin);
    res.json({ success: true, message: 'Firma / Mükellef kaydı silindi.' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Aktif Firmayı Seç / Değiştir
app.post('/api/companies/:id/activate', (req, res) => {
  try {
    const isAdmin = (req.user?.role === 'admin');
    const { id } = req.params;
    const activated = db.setActiveCompany(Number(id), req.user?.id, isAdmin);
    res.json({
      success: true,
      message: `${activated.name} aktif mükellef olarak seçildi.`,
      activeCompany: {
        ...activated,
        gib_pass_masked: '••••••••'
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ==========================================
// 0.2 Kullanıcı Yönetimi (Yalnızca Sistem Yöneticisi)
// ==========================================

// Kullanıcıları Listele (Admin Only)
app.get('/api/users', (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Bu işlem için Sistem Yöneticisi (admin) yetkisi gereklidir.' });
    }
    const list = db.getUsers();
    res.json({
      success: true,
      data: list
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Yeni Kullanıcı Ekle (Admin Only)
app.post('/api/users', (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Bu işlem için Sistem Yöneticisi (admin) yetkisi gereklidir.' });
    }
    const { username, password, name, role, activeCompanyId } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Kullanıcı adı ve şifre zorunludur.' });
    }

    const existing = db.getUserByUsername(username);
    if (existing) {
      return res.status(400).json({ success: false, error: 'Bu kullanıcı adı zaten mevcut.' });
    }

    const newUser = db.createUser({
      username: username.trim(),
      password: password.trim(),
      name: name ? name.trim() : username.trim(),
      role: role === 'admin' ? 'admin' : 'user',
      activeCompanyId: activeCompanyId ? Number(activeCompanyId) : null
    });

    res.json({
      success: true,
      message: `${newUser.name} kullanıcısı başarıyla eklendi.`,
      user: newUser
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Kullanıcı Bilgilerini / Şifresini Güncelle (Admin Only)
app.put('/api/users/:id', (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Bu işlem için Sistem Yöneticisi (admin) yetkisi gereklidir.' });
    }
    const { id } = req.params;
    const { name, password, role, activeCompanyId } = req.body || {};

    const updated = db.updateUser(Number(id), {
      name: name ? name.trim() : null,
      password: password ? password.trim() : null,
      role: role || null,
      activeCompanyId: activeCompanyId ? Number(activeCompanyId) : null
    });

    res.json({
      success: true,
      message: 'Kullanıcı güncellendi.',
      user: updated
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Kullanıcı Sil (Admin Only)
app.delete('/api/users/:id', (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Bu işlem için Sistem Yöneticisi (admin) yetkisi gereklidir.' });
    }
    const { id } = req.params;
    if (Number(id) === req.user.id) {
      return res.status(400).json({ success: false, error: 'Kendi aktif yönetici hesabınızı silemezsiniz.' });
    }

    db.deleteUser(Number(id));
    res.json({ success: true, message: 'Kullanıcı başarıyla silindi.' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ==========================================
// 1. Durum ve Yapılandırma Uç Noktaları
// ==========================================

// Sistem Genel Durumu
app.get('/api/status', async (req, res) => {
  try {
    const config = gib.loadConfig();
    const hasCreds = Boolean(config.kullaniciKodu && config.sifre);
    
    let gibStatus = {
      connected: false,
      message: 'GİB Kimlik bilgileri henüz girilmedi.',
      unvan: config.unvan || '',
      vkn: config.vkn || '',
      vergiDairesi: config.vergiDairesi || ''
    };

    if (hasCreds) {
      try {
        const check = await gib.checkStatus();
        gibStatus.connected = true;
        gibStatus.message = 'GİB e-Arşiv Portalı ile bağlantı aktif ve doğrulandı.';
        if (check.unvan) gibStatus.unvan = check.unvan;
        if (check.vkn) gibStatus.vkn = check.vkn;
      } catch (err) {
        gibStatus.connected = false;
        gibStatus.message = `GİB Bağlantı Hatası: ${err.message}`;
      }
    }

    res.json({
      success: true,
      port: PORT,
      gib: gibStatus,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Ayarları Oku
app.get('/api/config', (req, res) => {
  try {
    const config = gib.loadConfig();
    const mailConfig = mailer.loadMailConfig();
    
    // Şifreyi maskele
    const safeGib = {
      ...config,
      sifre: config.sifre ? '••••••••' : ''
    };
    const safeMail = {
      ...mailConfig,
      pass: mailConfig.pass ? '••••••••' : ''
    };

    res.json({
      success: true,
      gib: safeGib,
      mail: safeMail
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Ayarları Güncelle
app.post('/api/config', (req, res) => {
  try {
    const { gibConfig, mailConfig } = req.body;
    
    let updatedGib = null;
    let updatedMail = null;

    if (gibConfig) {
      const current = gib.loadConfig();
      // Maskeli şifre geldiyse eski şifreyi koru
      if (gibConfig.sifre === '••••••••' || !gibConfig.sifre) {
        gibConfig.sifre = current.sifre;
      }
      updatedGib = gib.saveConfig(gibConfig);
    }

    if (mailConfig) {
      const currentMail = mailer.loadMailConfig();
      if (mailConfig.pass === '••••••••' || !mailConfig.pass) {
        mailConfig.pass = currentMail.pass;
      }
      updatedMail = mailer.saveMailConfig(mailConfig);
    }

    res.json({
      success: true,
      message: 'Ayarlar başarıyla kaydedildi.',
      gib: updatedGib ? { ...updatedGib, sifre: '••••••••' } : undefined,
      mail: updatedMail ? { ...updatedMail, pass: '••••••••' } : undefined
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 2. MERNİS & Vergi Dairesi Sorgulama
// ==========================================

app.post('/api/query-mernis', async (req, res) => {
  try {
    const { vknTckn } = req.body;
    if (!vknTckn || vknTckn.length < 10) {
      return res.status(400).json({ success: false, error: 'Geçerli bir TCKN (11 hane) veya VKN (10 hane) girin.' });
    }

    const result = await gib.queryMernis(vknTckn);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 3. Fatura İşlemleri (Veritabanı & Senkronizasyon)
// ==========================================

// Dashboard İstatistikleri
app.get('/api/dashboard/stats', (req, res) => {
  try {
    const isAdmin = (req.user?.role === 'admin');
    const activeComp = db.getActiveCompany(req.user?.id, isAdmin);
    const companyId = req.query.companyId || (!isAdmin ? activeComp?.id : null);
    const stats = db.getDashboardStats(companyId);
    res.json({
      success: true,
      activeCompanyId: activeComp?.id || null,
      data: stats
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Fatura Listesi (Öncelikli olarak Veritabanından, firma filtreli ve arama destekli)
app.get('/api/invoices', async (req, res) => {
  try {
    const { startDate, endDate, source, search, status, companyId } = req.query;
    const isAdmin = (req.user?.role === 'admin');
    const activeComp = db.getActiveCompany(req.user?.id, isAdmin);
    const effectiveCompanyId = companyId || (!isAdmin ? activeComp?.id : null);

    if (source === 'gib') {
      const drafts = await gib.getDrafts(startDate, endDate);
      return res.json({
        success: true,
        source: 'gib',
        count: drafts.length,
        data: drafts
      });
    }

    // Veritabanından çek (companyId destekli)
    let list = db.getInvoices({ search, status, companyId: effectiveCompanyId, startDate, endDate });

    // Eğer veritabanında hiç kayıt yoksa ve filtre yoksa arka planda ilk senkronizasyonu başlat
    if (list.length === 0 && !search && !status) {
      try {
        await syncEngine.syncInvoices(startDate, endDate, effectiveCompanyId);
        list = db.getInvoices({ search, status, companyId: effectiveCompanyId, startDate, endDate });
      } catch (syncErr) {
        console.warn('[API] İlk sync uyarısı:', syncErr.message);
      }
    }

    res.json({
      success: true,
      source: 'database',
      companyId: effectiveCompanyId,
      count: list.length,
      data: list
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GİB ile Manuel Senkronizasyon Başlat
app.post('/api/invoices/sync', async (req, res) => {
  try {
    const { startDate, endDate, companyId } = req.body || {};
    const isAdmin = (req.user?.role === 'admin');
    const activeComp = db.getActiveCompany(req.user?.id, isAdmin);
    const effectiveCompanyId = companyId || activeComp?.id || null;
    const result = await syncEngine.syncInvoices(startDate, endDate, effectiveCompanyId);
    const stats = db.getDashboardStats(effectiveCompanyId);
    res.json({
      success: true,
      companyId: effectiveCompanyId,
      sync: result,
      stats
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Yeni Taslak Fatura Oluştur
app.post('/api/invoices/draft', async (req, res) => {
  try {
    const payload = req.body;
    const isAdmin = (req.user?.role === 'admin');
    const activeComp = db.getActiveCompany(req.user?.id, isAdmin);
    const result = await gib.createDraftInvoice(payload);
    
    // Veritabanına taslak olarak kaydet (aktif firmanın ID'si ile)
    if (result.ettn) {
      db.upsertInvoice({
        ettn: result.ettn,
        company_id: activeComp ? activeComp.id : null,
        belgeNumarasi: result.belgeNumarasi,
        belgeTarihi: result.belgeTarihi,
        aliciUnvanAdSoyad: result.alici,
        aliciVknTckn: result.tcknOrVkn,
        odenecekTutar: Number(result.tutar || 0),
        onayDurumu: 'Taslak',
        kaynak: 'LOCAL'
      }, activeComp ? activeComp.id : null);
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Fatura HTML Önizleme (Önce DB'deki önbellekten, yoksa GİB'den)
app.get('/api/invoices/:ettn/html', async (req, res) => {
  try {
    const { ettn } = req.params;
    const onayDurumu = req.query.onayDurumu || 'Taslak';

    const localInv = db.getInvoiceByEttn(ettn);
    let html = localInv?.html_preview;

    if (!html || html.length < 50) {
      html = await gib.getInvoiceHtml(ettn, onayDurumu);
      if (html) {
        db.saveInvoiceHtml(ettn, html);
      }
    }
    
    if (req.query.format === 'json') {
      return res.json({ success: true, html });
    }
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// İmzalı / Taslak Fatura İndir (ZIP: UBL-XML + HTML)
app.get('/api/invoices/:ettn/download', async (req, res) => {
  try {
    const { ettn } = req.params;
    const onayDurumu = req.query.onayDurumu || 'Onaylandı';
    const belgeTip = req.query.belgeTip || 'FATURA';

    const zipBuffer = await gib.downloadInvoiceZip(ettn, onayDurumu, belgeTip);
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="fatura_${ettn}.zip"`);
    res.send(zipBuffer);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Taslak Fatura Sil
app.delete('/api/invoices/:ettn', async (req, res) => {
  try {
    const { ettn } = req.params;
    const body = req.body || {};
    const existing = db.getInvoiceByEttn(ettn);

    const draftItem = {
      ettn,
      belgeNumarasi: body.belgeNumarasi || existing?.belge_numarasi || '',
      aliciVknTckn: body.aliciVknTckn || existing?.alici_vkn_tckn || '',
      aliciUnvanAdSoyad: body.aliciUnvanAdSoyad || existing?.alici_unvan || '',
      belgeTarihi: body.belgeTarihi || existing?.belge_tarihi || '',
      belgeTuru: body.belgeTuru || existing?.belge_turu || 'FATURA',
      onayDurumu: body.onayDurumu || existing?.onay_durumu || 'Onaylanmadı'
    };

    const result = await gib.deleteDraft(draftItem, body.silmeNedeni || 'Hatalı işlem iptali');

    if (result.success) {
      db.upsertInvoice({
        ettn,
        belgeNumarasi: draftItem.belgeNumarasi,
        onayDurumu: 'Silinmiş'
      });
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 4. SMS Doğrulama & Resmi İmzalama
// ==========================================

// SMS Gönder
app.post('/api/sms/send', async (req, res) => {
  try {
    let { phone } = req.body;
    
    // Telefon verilmediyse GİB'deki kayıtlı telefonu bul
    if (!phone) {
      phone = await gib.queryRegisteredPhone();
    }

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: 'GİB sisteminde kayıtlı cep telefonu bulunamadı. Lütfen manuel girin.'
      });
    }

    const result = await gib.sendSmsVerification(phone);
    res.json({
      success: true,
      phone,
      oid: result.oid,
      message: result.message
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// SMS Doğrula ve İmzala
app.post('/api/sms/verify', async (req, res) => {
  try {
    const { smsCode, oid, ettn, belgeNumarasi } = req.body;
    
    if (!smsCode || !oid || !ettn) {
      return res.status(400).json({
        success: false,
        error: 'SMS Kodu, OID ve ETTN parametreleri zorunludur.'
      });
    }

    const result = await gib.verifySmsAndSign(oid, smsCode, ettn, belgeNumarasi);

    if (result.success) {
      db.upsertInvoice({
        ettn,
        belgeNumarasi,
        onayDurumu: 'Onaylandı'
      });
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 5. Fatura E-Posta İletimi
// ==========================================

app.post('/api/invoices/:ettn/send-email', async (req, res) => {
  try {
    const { ettn } = req.params;
    const { to, subject, onayDurumu, belgeNumarasi } = req.body;

    if (!to) {
      return res.status(400).json({ success: false, error: 'Alıcı e-posta adresi zorunludur.' });
    }

    // HTML faturasını al
    let invoiceHtml = '';
    try {
      invoiceHtml = await gib.getInvoiceHtml(ettn, onayDurumu || 'Onaylandı');
    } catch (e) {
      console.warn('[Server] Fatura HTML alınamadı:', e.message);
    }

    // Resmi ZIP dosyasını al (onaylı ise)
    let zipBuffer = null;
    try {
      zipBuffer = await gib.downloadInvoiceZip(ettn, onayDurumu || 'Onaylandı');
    } catch (e) {
      console.warn('[Server] Fatura ZIP alınamadı:', e.message);
    }

    const mailResult = await mailer.sendInvoiceEmail({
      to,
      subject,
      invoiceHtml,
      ettn,
      belgeNumarasi,
      attachmentBuffer: zipBuffer,
      attachmentFilename: `fatura_${belgeNumarasi || ettn}.zip`
    });

    res.json({
      success: true,
      message: `Fatura ${to} adresine başarıyla e-posta ile gönderildi.`,
      result: mailResult
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 6. Excel ile Toplu Fatura Yükleme & Aktarım
// ==========================================

// Excel Şablonu İndir
app.get('/api/bulk/template', (req, res) => {
  try {
    const buffer = excelService.generateTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="gib_toplu_fatura_sablonu.xlsx"');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Excel Dosyasını Tara ve Doğrula (Önizleme & Onay Aşaması)
app.post('/api/bulk/preview', upload.single('file'), (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, error: 'Lütfen bir Excel (.xlsx / .xls) dosyası yükleyin.' });
    }
    const result = excelService.parseAndValidateExcel(req.file.buffer);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Onaylanan Faturaları GİB Portalına Aktar
app.post('/api/bulk/execute', async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Aktarılacak geçerli satır listesi bulunamadı.' });
    }
    const result = await excelService.executeBulkTransfer(rows);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 7. Test ve Sağlık Kontrolü
// ==========================================

app.get('/api/system/version', (req, res) => {
  const pkg = require('./package.json');
  res.json({
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    node: process.version,
    uptime: process.uptime()
  });
});

// Sunucuyu Başlat
const isSocket = (typeof PORT === 'string' && (PORT.includes('/') || PORT.includes('\\')));
const displayUrl = process.env.APP_URL || (isSocket ? 'https://gib.zersoft.net' : `http://localhost:${PORT}`);

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 GİB e-Arşiv Fatura Portalı Başlatıldı!`);
  console.log(`🌐 Canlı Adres / Domain: ${displayUrl}`);
  console.log(`📡 REST API:   ${isSocket ? displayUrl + '/api/status' : `http://localhost:${PORT}/api/status`}`);
  console.log(`====================================================`);
});

module.exports = app;
