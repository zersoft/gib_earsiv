/**
 * Kimlik Doğrulama ve Oturum Yönetimi (JWT / HMAC-SHA256 Tabanlı)
 * 
 * Bağımlılıksız (Node.js dahili crypto modülü) güvenli oturum yönetimi.
 * Desteklenen giriş yöntemleri:
 * 1. Yönetici Hesabı (APP_USER / APP_PASS veya varsayılan admin / admin123)
 * 2. GİB Kullanıcı Bilgileri (GIB_USER / GIB_PASS)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const JWT_SECRET = process.env.AUTH_SECRET || 'gib_earsiv_portal_jwt_secret_key_2026';
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 gün

function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) {
    str += '=';
  }
  return Buffer.from(str, 'base64').toString('utf8');
}

/**
 * Kullanıcı payload'ı için imzalı JWT üretir
 */
function createToken(payload) {
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };

  const now = Math.floor(Date.now() / 1000);
  const data = {
    ...payload,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(data));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(unsignedToken)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${unsignedToken}.${signature}`;
}

/**
 * Token'ı doğrular ve payload'ı döner
 */
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signature] = parts;
  const unsignedToken = `${headerB64}.${payloadB64}`;

  const expectedSignature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(unsignedToken)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  // Zamanlama saldırılarına karşı güvenli karşılaştırma
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(payloadB64));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null; // Süresi dolmuş
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * GİB konfigürasyon dosyasından veya ortam değişkenlerinden kimlik bilgilerini okur
 */
function getGibCredentials() {
  let user = process.env.GIB_USER || '';
  let pass = process.env.GIB_PASS || '';
  let unvan = process.env.GIB_UNVAN || '';

  const cfgPath = path.join(__dirname, '../config/gib_config.json');
  if (fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg.kullaniciKodu) user = cfg.kullaniciKodu;
      if (cfg.sifre) pass = cfg.sifre;
      if (cfg.unvan) unvan = cfg.unvan;
    } catch (e) {
      console.warn('[Auth] GİB config okunamadı:', e.message);
    }
  }

  return { user, pass, unvan };
}

/**
 * Kullanıcı adı ve şifreyi doğrular
 */
function authenticate(username, password) {
  if (!username || !password) return null;

  const cleanUser = String(username).trim();
  const cleanPass = String(password).trim();
  const db = require('./db');

  // 1. Veritabanındaki Kullanıcılar Tablosundan Kontrol Et (admin, muhasebe, kullanici vb.)
  try {
    const dbUser = db.getUserByUsername(cleanUser);
    if (dbUser && dbUser.password === cleanPass) {
      const activeComp = db.getActiveCompany(dbUser.id);
      return {
        id: dbUser.id,
        username: dbUser.username,
        name: dbUser.name,
        role: dbUser.role || 'user', // 'admin' veya 'user'
        activeCompanyId: activeComp ? activeComp.id : null,
        activeCompanyName: activeComp ? activeComp.name : null,
        type: 'user'
      };
    }
  } catch (err) {
    console.warn('[Auth] DB kullanıcı sorgusu hatası:', err.message);
  }

  // 2. Sistem Yöneticisi Girişi (.env fallback)
  const appUser = (process.env.APP_USER || 'admin').trim();
  const appPass = (process.env.APP_PASS || 'admin123').trim();

  if (cleanUser === appUser && cleanPass === appPass) {
    const activeComp = db.getActiveCompany();
    return {
      username: appUser,
      name: 'Sistem Yöneticisi',
      role: 'admin',
      activeCompanyId: activeComp ? activeComp.id : null,
      activeCompanyName: activeComp ? activeComp.name : null,
      type: 'system'
    };
  }

  // 3. Tanımlı Firmaların GİB Kullanıcı Kodu & Şifresi ile Giriş
  try {
    const companies = db.getCompanies();
    const matchedComp = companies.find(
      c => String(c.gib_user).trim() === cleanUser && String(c.gib_pass).trim() === cleanPass
    );
    if (matchedComp) {
      return {
        id: matchedComp.id,
        username: matchedComp.gib_user,
        name: matchedComp.name,
        role: 'user', // GİB ile giriş yapan kullanıcı rolündedir
        activeCompanyId: matchedComp.id,
        activeCompanyName: matchedComp.name,
        type: 'gib'
      };
    }
  } catch (err) {}

  // 4. GİB Konfigürasyon Dosyası ile Giriş Fallback
  const gibCreds = getGibCredentials();
  if (gibCreds.user && gibCreds.pass) {
    if (cleanUser === String(gibCreds.user).trim() && cleanPass === String(gibCreds.pass).trim()) {
      return {
        username: gibCreds.user,
        name: gibCreds.unvan || `GİB Kullanıcısı (${gibCreds.user})`,
        role: 'user',
        type: 'gib'
      };
    }
  }

  return null;
}

/**
 * Express Middleware: İstek başlığında veya query'de geçerli token arar
 */
function authMiddleware(req, res, next) {
  // Bearer Token kontrolü
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.query && req.query.token) {
    // Tarayıcıdan doğrudan dosya indirmeleri için query token desteği
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      code: 'UNAUTHORIZED',
      error: 'Bu işlem için oturum açmanız gerekmektedir.'
    });
  }

  const user = verifyToken(token);
  if (!user) {
    return res.status(401).json({
      success: false,
      code: 'TOKEN_EXPIRED_OR_INVALID',
      error: 'Oturum süreniz dolmuş veya geçersiz. Lütfen tekrar giriş yapın.'
    });
  }

  req.user = user;
  next();
}

module.exports = {
  createToken,
  verifyToken,
  authenticate,
  authMiddleware
};
