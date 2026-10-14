/**
 * GİB (Gelir İdaresi Başkanlığı) e-Arşiv Portal Entegrasyon Motoru
 * earsivportal.efatura.gov.tr ile doğrudan konuşarak:
 * - MERNİS / VKN Sicil Sorgulama
 * - Resmi Taslak e-Arşiv Fatura Oluşturma
 * - Taslak ve Onaylı Fatura Listeleme
 * - Fatura HTML Önizleme
 * - Mobil SMS Doğrulama & Resmi İmzalama
 * - İmzalı ZIP (UBL-XML + HTML) İndirme
 */

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'gib_config.json');
const GIB_URL = 'https://earsivportal.efatura.gov.tr';

const cachedTokens = {}; // [kullaniciKodu] -> { token, expiresAt }

function clearCachedToken(kullaniciKodu = null) {
  if (kullaniciKodu) {
    delete cachedTokens[kullaniciKodu];
  } else {
    for (const k of Object.keys(cachedTokens)) delete cachedTokens[k];
  }
}

function loadConfig(companyId = null) {
  try {
    const db = require('./db');
    const comp = companyId ? db.getCompanyById(companyId) : db.getActiveCompany();
    if (comp && comp.gib_user && comp.gib_pass) {
      return {
        companyId: comp.id,
        kullaniciKodu: comp.gib_user,
        sifre: comp.gib_pass,
        vkn: comp.vkn_tckn || '',
        unvan: comp.name || '',
        vergiDairesi: comp.vergi_dairesi || ''
      };
    }
  } catch (e) {
    // DB henüz hazır değilse veya yüklenemediyse fallback
  }

  if (fs.existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {
      console.error('[GIB] Config okuma hatası:', e.message);
    }
  }

  return {
    kullaniciKodu: process.env.GIB_USER || '',
    sifre: process.env.GIB_PASS || '',
    vkn: process.env.GIB_VKN || '',
    unvan: process.env.GIB_UNVAN || '',
    vergiDairesi: process.env.GIB_VERGI_DAIRESI || ''
  };
}

function saveConfig(newConfig, companyId = null) {
  try {
    const db = require('./db');
    const comp = companyId ? db.getCompanyById(companyId) : db.getActiveCompany();
    if (comp) {
      db.updateCompany(comp.id, {
        name: newConfig.unvan || comp.name,
        vkn_tckn: newConfig.vkn !== undefined ? newConfig.vkn : comp.vkn_tckn,
        vergi_dairesi: newConfig.vergiDairesi !== undefined ? newConfig.vergiDairesi : comp.vergi_dairesi,
        gib_user: newConfig.kullaniciKodu || comp.gib_user,
        gib_pass: newConfig.sifre || comp.gib_pass
      });
      clearCachedToken(newConfig.kullaniciKodu || comp.gib_user);
    }
  } catch (e) {}

  const current = loadConfig(companyId);
  const merged = {
    ...current,
    ...newConfig
  };
  const configDir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
  clearCachedToken(merged.kullaniciKodu);
  return merged;
}

function tutarYaziyla(tutar) {
  const birler = ['', 'BİR', 'İKİ', 'ÜÇ', 'DÖRT', 'BEŞ', 'ALTI', 'YEDİ', 'SEKİZ', 'DOKUZ'];
  const onlar = ['', 'ON', 'YİRMİ', 'OTUZ', 'KIRK', 'ELLİ', 'ALTMIŞ', 'YETMİŞ', 'SEKSEN', 'DOKSAN'];
  const basamaklar = ['', 'BİN', 'MİLYON', 'MİLYAR'];

  function ucluGrup(n) {
    let yuz = Math.floor(n / 100);
    let on = Math.floor((n % 100) / 10);
    let bir = n % 10;
    let res = '';
    if (yuz > 1) res += birler[yuz] + 'YÜZ';
    else if (yuz === 1) res += 'YÜZ';
    res += onlar[on] + birler[bir];
    return res;
  }

  const parts = Number(tutar).toFixed(2).split('.');
  let lira = parseInt(parts[0], 10);
  let kurus = parseInt(parts[1], 10);

  if (lira === 0 && kurus === 0) return 'SIFIR TÜRK LİRASI';

  let liraText = '';
  if (lira === 0) {
    liraText = 'SIFIR';
  } else {
    let grupIdx = 0;
    while (lira > 0) {
      let g = lira % 1000;
      if (g > 0) {
        let gMetin = ucluGrup(g);
        if (grupIdx === 1 && g === 1) gMetin = ''; // 1 bin yerine bin
        liraText = gMetin + basamaklar[grupIdx] + liraText;
      }
      lira = Math.floor(lira / 1000);
      grupIdx++;
    }
  }

  let kurusText = '';
  if (kurus > 0) {
    let on = Math.floor(kurus / 10);
    let bir = kurus % 10;
    kurusText = ' ' + onlar[on] + birler[bir] + ' KURUŞ';
  }

  return 'YALNIZ ' + liraText + ' TÜRK LİRASI' + kurusText;
}

function parseDate(val) {
  if (!val) return new Date();
  if (val instanceof Date) return new Date(val.getTime());
  if (typeof val === 'string') {
    // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      const [y, m, d] = val.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    // DD/MM/YYYY or DD-MM-YYYY
    if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(val)) {
      const [d, m, y] = val.split(/[/-]/).map(Number);
      return new Date(y, m - 1, d);
    }
  }
  return new Date(val);
}

function formatDate(dateObj) {
  const d = parseDate(dateObj);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatTime(dateObj) {
  const d = dateObj ? new Date(dateObj) : new Date();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

async function login(force = false, companyId = null) {
  const cfg = loadConfig(companyId);
  if (!cfg.kullaniciKodu || !cfg.sifre) {
    throw new Error('GİB Kullanıcı kodu ve şifresi tanımlı değil. Lütfen Mükellef/Firma ayarlarından yapılandırın.');
  }

  const cached = cachedTokens[cfg.kullaniciKodu];
  if (!force && cached && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  const body = new URLSearchParams({
    assoscmd: 'anologin',
    rtype: 'json',
    userid: cfg.kullaniciKodu,
    sifre: cfg.sifre,
    sifre2: cfg.sifre,
    parola: '1'
  });

  const res = await fetch(`${GIB_URL}/earsiv-services/assos-login`, {
    method: 'POST',
    headers: {
      'Referer': `${GIB_URL}/intragiris.html`,
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    },
    body: body.toString()
  });

  if (!res.ok) {
    throw new Error(`GİB sunucusu yanıt vermedi (HTTP ${res.status})`);
  }

  const data = await res.json();
  if (!data || !data.token) {
    throw new Error(data?.messages?.[0]?.text || data?.error || 'GİB giriş başarısız. Kullanıcı kodu veya şifre hatalı.');
  }

  cachedTokens[cfg.kullaniciKodu] = {
    token: data.token,
    expiresAt: Date.now() + 12 * 60 * 1000 // 12 dakika
  };
  return data.token;
}

async function dispatch(cmd, pageName, jp = {}, retry = true) {
  const token = await login();

  const params = new URLSearchParams({
    cmd: cmd,
    callid: 'c_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    pageName: pageName,
    token: token,
    jp: typeof jp === 'string' ? jp : JSON.stringify(jp)
  });

  const res = await fetch(`${GIB_URL}/earsiv-services/dispatch`, {
    method: 'POST',
    headers: {
      'Referer': `${GIB_URL}/index.jsp`,
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    },
    body: params.toString()
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`GİB geçersiz JSON cevabı: ${text.slice(0, 150)}`);
  }

  if (json.error) {
    let errMsg = '';
    if (Array.isArray(json.messages)) {
      errMsg = json.messages.map(m => (typeof m === 'object' && m ? m.text : m)).filter(Boolean).join(', ');
    } else if (typeof json.messages === 'string') {
      errMsg = json.messages;
    } else {
      errMsg = 'GİB Hata ' + json.error;
    }

    const isSessionError = errMsg.toLowerCase().includes('oturum') ||
      errMsg.toLowerCase().includes('token') ||
      errMsg.toLowerCase().includes('yetki') ||
      String(json.error) === '1';

    if (retry && isSessionError) {
      console.log('[GIB] Oturum/token hatası tespit edildi, token yenileniyor...');
      cachedToken = null;
      tokenExpiresAt = 0;
      return dispatch(cmd, pageName, jp, false);
    }
    throw new Error(errMsg || ('GİB Hata ' + json.error));
  }

  return json;
}

/**
 * GİB Bağlantı ve Mükellef Bilgilerini Kontrol Eder
 */
async function checkStatus() {
  try {
    const res = await dispatch('EARSIV_PORTAL_KULLANICI_BILGILERI_GETIR', 'RG_KULLANICI', {});
    return {
      success: true,
      connected: true,
      user: res.data || {}
    };
  } catch (err) {
    return {
      success: false,
      connected: false,
      error: err.message
    };
  }
}

/**
 * VKN veya TCKN ile MERNİS / Vergi Dairesi sorgusu yapar
 */
async function queryMernis(vknTckn) {
  const cleanId = String(vknTckn || '').trim();
  if (cleanId.length !== 10 && cleanId.length !== 11) {
    throw new Error('Geçerli bir TCKN (11 hane) veya VKN (10 hane) girilmelidir.');
  }

  const res = await dispatch('SICIL_VEYA_MERNISTEN_BILGILERI_GETIR', 'RG_BASITFATURA', {
    vknTcknn: cleanId
  });

  return res.data || { adi: '', soyadi: '', unvan: '', vergiDairesi: '' };
}

/**
 * Belirli tarih aralığındaki taslak ve onaylı faturaları listeler.
 * GİB Portalı tek seferde en fazla 7 günlük sorgulama kabul ettiği için
 * 7 günden uzun aralıklar otomatik olarak 7'şer günlük parçalara (chunk)
 * bölünerek sorgulanır ve birleştirilir.
 */
async function getDrafts(startDate, endDate) {
  const start = startDate ? parseDate(startDate) : new Date();
  const end = endDate ? parseDate(endDate) : new Date();

  // Küçükten büyüğe sırala
  const [realStart, realEnd] = start <= end ? [start, end] : [end, start];

  // 7 günlük parçalara böl
  const chunks = [];
  let currStart = new Date(realStart.getTime());

  while (currStart <= realEnd) {
    let currEnd = new Date(currStart.getTime());
    currEnd.setDate(currEnd.getDate() + 7);
    if (currEnd > realEnd) {
      currEnd = new Date(realEnd.getTime());
    }
    chunks.push({
      start: new Date(currStart.getTime()),
      end: new Date(currEnd.getTime())
    });
    // Bir sonraki başlangıç
    currStart.setDate(currStart.getDate() + 8);
  }

  const allInvoices = [];
  const seenKeys = new Set();

  let successCount = 0;
  let lastError = null;

  for (const chunk of chunks) {
    const sDate = formatDate(chunk.start);
    const eDate = formatDate(chunk.end);

    try {
      const res = await dispatch('EARSIV_PORTAL_TASLAKLARI_GETIR', 'RG_BASITTASLAKLAR', {
        baslangic: sDate,
        bitis: eDate,
        hangiTip: '5000/30000',
        table: []
      });

      successCount++;
      if (Array.isArray(res.data)) {
        for (const item of res.data) {
          if (item.error) {
            console.warn('[GIB] Chunk hatası:', item.error, `(${sDate} - ${eDate})`);
            continue;
          }
          const key = item.ettn || item.belgeNumarasi;
          if (key && !seenKeys.has(key)) {
            seenKeys.add(key);
            allInvoices.push(item);
          } else if (!key) {
            allInvoices.push(item);
          }
        }
      }
    } catch (err) {
      lastError = err;
      console.error(`[GIB] ${sDate} - ${eDate} aralığı çekilemedi:`, err.message);
    }
  }

  if (successCount === 0 && lastError) {
    throw lastError;
  }

  // Tarihe ve belge numarasına göre azalan sırala (en yeni en üstte)
  allInvoices.sort((a, b) => {
    const parseItemDate = (item) => {
      if (item.belgeTarihi) {
        return parseDate(item.belgeTarihi).getTime();
      }
      return 0;
    };
    const diff = parseItemDate(b) - parseItemDate(a);
    if (diff !== 0) return diff;
    return (b.belgeNumarasi || '').localeCompare(a.belgeNumarasi || '');
  });

  return allInvoices;
}

/**
 * GİB Portalında Resmi Taslak e-Arşiv Faturası Oluşturur
 */
async function createDraftInvoice(options = {}) {
  const {
    tcknOrVkn = '11111111111',
    buyerFirstName = '',
    buyerLastName = '',
    buyerTitle = '',
    taxOffice = '',
    city = 'Bursa',
    district = '',
    fullAddress = '',
    phone = '',
    email = '',
    items = [],
    // Tek kalem için pratik opsiyonlar:
    serviceName = 'Danışmanlık ve Yazılım Hizmeti',
    totalPrice = 0,
    kdvRate = 20,
    invoiceDate = formatDate(),
    invoiceTime = formatTime(),
    note = '',
    orderNumber = ''
  } = options;

  let malHizmetTable = [];
  let calculatedMatrah = 0;
  let calculatedKdv = 0;
  let calculatedTotal = 0;

  if (Array.isArray(items) && items.length > 0) {
    for (const it of items) {
      const itPrice = Number(it.price || it.total || 0);
      const itRate = Number(it.kdvRate !== undefined ? it.kdvRate : 20);
      const itQty = Number(it.quantity || 1);
      const kdvDivider = 1 + (itRate / 100);
      const itemMatrah = itPrice / kdvDivider;
      const itemKdv = itPrice - itemMatrah;

      calculatedMatrah += itemMatrah;
      calculatedKdv += itemKdv;
      calculatedTotal += itPrice;

      malHizmetTable.push({
        malHizmet: it.name || it.description || 'Hizmet Bedeli',
        miktar: itQty,
        birim: it.unit || 'C62', // C62 = Adet
        birimFiyat: (itemMatrah / itQty).toFixed(2),
        fiyat: itemMatrah.toFixed(2),
        iskontoOrani: 0,
        iskontoTutari: '0.00',
        iskontoNedeni: '',
        malHizmetTutari: itemMatrah.toFixed(2),
        kdvOrani: String(itRate),
        vergiOrani: 0,
        kdvTutari: itemKdv.toFixed(2),
        vergininKdvTutari: '0.00',
        ozelMatrahTutari: '0.00',
        hesaplananotvtevkifatakatkisi: '0.00'
      });
    }
  } else {
    const total = Number(totalPrice) || 0;
    if (total <= 0) {
      throw new Error('Fatura toplam tutarı 0 dan büyük olmalıdır.');
    }
    const kdvDivider = 1 + (kdvRate / 100);
    const matrah = total / kdvDivider;
    const kdv = total - matrah;

    calculatedMatrah = matrah;
    calculatedKdv = kdv;
    calculatedTotal = total;

    malHizmetTable.push({
      malHizmet: serviceName,
      miktar: 1,
      birim: 'C62',
      birimFiyat: matrah.toFixed(2),
      fiyat: matrah.toFixed(2),
      iskontoOrani: 0,
      iskontoTutari: '0.00',
      iskontoNedeni: '',
      malHizmetTutari: matrah.toFixed(2),
      kdvOrani: String(kdvRate),
      vergiOrani: 0,
      kdvTutari: kdv.toFixed(2),
      vergininKdvTutari: '0.00',
      ozelMatrahTutari: '0.00',
      hesaplananotvtevkifatakatkisi: '0.00'
    });
  }

  const matrahStr = calculatedMatrah.toFixed(2);
  const kdvStr = calculatedKdv.toFixed(2);
  const totalStr = calculatedTotal.toFixed(2);

  const isCorporate = !!(buyerTitle && buyerTitle.trim());
  const effectiveUnvan = isCorporate ? buyerTitle.trim() : '';
  const effectiveAdi = isCorporate ? '' : (buyerFirstName ? buyerFirstName.trim() : '');
  const effectiveSoyadi = isCorporate ? '' : (buyerLastName ? buyerLastName.trim() : '');

  const defaultNote = tutarYaziyla(calculatedTotal);
  const cleanNote = (note || '').trim();
  const finalNote = cleanNote ? `${cleanNote}\n${defaultNote}` : defaultNote;

  const invoicePayload = {
    faturaUuid: '',
    belgeNumarasi: '',
    faturaTarihi: invoiceDate,
    saat: invoiceTime,
    paraBirimi: 'TRY',
    dovzTLkur: '0',
    faturaTipi: 'SATIS',
    hangiTip: '5000/30000',
    vknTckn: tcknOrVkn,
    aliciUnvan: effectiveUnvan,
    aliciAdi: effectiveAdi,
    aliciSoyadi: effectiveSoyadi,
    binaAdi: '',
    binaNo: '',
    kapiNo: '',
    kasabaKoy: '',
    vergiDairesi: taxOffice || '',
    ulke: 'Türkiye',
    bulvarcaddesokak: fullAddress || '',
    irsaliyeNumarasi: '',
    irsaliyeTarihi: '',
    mahalleSemtIlce: district || '',
    sehir: city || ' ',
    postaKodu: '',
    tel: phone || '',
    fax: '',
    eposta: email || '',
    websitesi: '',
    iadeTable: [],
    vergiCesidi: ' ',
    malHizmetTable: malHizmetTable,
    tip: 'İskonto',
    matrah: matrahStr,
    malhizmetToplamTutari: matrahStr,
    toplamIskonto: '0.00',
    hesaplanankdv: kdvStr,
    vergilerToplami: kdvStr,
    vergilerDahilToplamTutar: totalStr,
    odenecekTutar: totalStr,
    not: finalNote,
    siparisNumarasi: orderNumber || '',
    siparisTarihi: '',
    fisNo: '',
    fisTarihi: '',
    fisSaati: ' ',
    fisTipi: ' ',
    zRaporNo: '',
    okcSeriNo: ''
  };

  const createRes = await dispatch('EARSIV_PORTAL_FATURA_OLUSTUR', 'RG_BASITFATURA', invoicePayload);

  if (!createRes.data || !createRes.data.includes('başarıyla oluşturulmuştur')) {
    throw new Error(createRes.data || 'Fatura oluşturulamadı.');
  }

  // Taslak oluşturulduktan sonra GİB'in faturaya atadığı ETTN ve Belge Numarasını eşleştir
  let assignedDraft = null;
  try {
    const drafts = await getDrafts(invoiceDate, invoiceDate);
    for (const d of drafts) {
      if (d.aliciVknTckn === tcknOrVkn && d.onayDurumu !== 'Silinmiş') {
        assignedDraft = d;
        break;
      }
    }
  } catch (err) {
    console.warn('[GIB] Taslak ETTN sorgulama hatası:', err.message);
  }

  return {
    success: true,
    message: createRes.data,
    ettn: assignedDraft?.ettn || null,
    belgeNumarasi: assignedDraft?.belgeNumarasi || null,
    belgeTarihi: assignedDraft?.belgeTarihi || invoiceDate,
    tutar: totalStr,
    alici: buyerTitle || `${buyerFirstName} ${buyerLastName}`.trim(),
    tcknOrVkn: tcknOrVkn
  };
}

/**
 * Faturanın GİB HTML Görünümünü Çeker
 */
async function getInvoiceHtml(ettn, onayDurumu = 'Onaylanmadı') {
  if (!ettn) throw new Error('ETTN parametresi zorunludur.');
  const res = await dispatch('EARSIV_PORTAL_FATURA_GOSTER', 'RG_BASITTASLAKLAR', {
    ettn: ettn,
    onayDurumu: onayDurumu
  });
  return res.data || '';
}

/**
 * Taslak faturayı siler
 * GİB Java altyapısı, silinecekler listesindeki nesnelerde belgeNumarasi, aliciVknTckn,
 * aliciUnvanAdSoyad, belgeTarihi, belgeTuru, onayDurumu ve ettn alanlarının
 * eksiksiz olmasını bekler. Eksik olduğunda java.lang.NullPointerException verir.
 */
async function deleteDraft(draftItems, reason = 'Kullanıcı talebiyle iptal') {
  const rawItems = Array.isArray(draftItems) ? draftItems : [draftItems];
  const items = rawItems.map(it => ({
    belgeNumarasi: it.belgeNumarasi || it.belge_numarasi || '',
    aliciVknTckn: it.aliciVknTckn || it.alici_vkn_tckn || '',
    aliciUnvanAdSoyad: it.aliciUnvanAdSoyad || it.alici_unvan || '',
    belgeTarihi: it.belgeTarihi || it.belge_tarihi || formatDate(),
    belgeTuru: it.belgeTuru || it.belge_turu || 'FATURA',
    onayDurumu: it.onayDurumu || it.onay_durumu || 'Onaylanmadı',
    ettn: it.ettn
  }));

  const res = await dispatch('EARSIV_PORTAL_FATURA_SIL', 'RG_BASITTASLAKLAR', {
    silinecekler: items,
    aciklama: reason
  });

  return {
    success: true,
    message: typeof res.data === 'string' ? res.data : 'Fatura başarıyla silindi.'
  };
}

/**
 * Kayıtlı cep telefonu numarasını sorgular
 */
async function queryRegisteredPhone() {
  const res = await dispatch('EARSIV_PORTAL_TELEFONNO_SORGULA', 'RG_BASITTASLAKLAR', {});
  return res.data || { telefon: '', ceptel: '', kceptel: '0' };
}

/**
 * Kayıtlı telefona SMS onay şifresi gönderir
 */
async function sendSmsVerification(phone) {
  const phoneRes = await queryRegisteredPhone();
  const targetPhone = phone || phoneRes.telefon || phoneRes.ceptel || '';
  if (!targetPhone) {
    throw new Error('GİB sisteminde kayıtlı cep telefonu bulunamadı.');
  }

  const res = await dispatch('EARSIV_PORTAL_SMSSIFRE_GONDER', 'RG_SMSONAY', {
    CEPTEL: targetPhone,
    KCEPTEL: false,
    TIP: ''
  });

  const pStr = String(targetPhone);
  const maskedPhone = pStr.length >= 10
    ? `${pStr.slice(0, 4)} *** ** ${pStr.slice(-2)}`
    : pStr;

  return {
    success: true,
    oid: res.data?.oid || res.data || null,
    phone: targetPhone,
    maskedPhone: maskedPhone,
    message: res.data?.msg || 'SMS doğrulama kodu başarıyla gönderildi.'
  };
}

/**
 * Telefona gelen SMS onay kodu ile faturayı imzalar
 */
async function verifySmsAndSign(oid, smsCode, ettn, belgeNumarasi = '', onayDurumu = 'Onaylanmadı') {
  if (!oid || !smsCode || !ettn) {
    throw new Error('OID, SMS kodu ve ETTN parametreleri zorunludur.');
  }

  const res = await dispatch('0lhozfib5410mp', 'RG_SMSONAY', {
    SIFRE: String(smsCode).trim(),
    OID: String(oid).trim(),
    OPR: 1,
    DATA: [
      {
        ettn: ettn,
        belgeNumarasi: belgeNumarasi || '',
        onayDurumu: onayDurumu
      }
    ]
  });

  return {
    success: true,
    result: res.data,
    message: 'Faturanız başarıyla onaylandı ve imzalandı.'
  };
}

/**
 * Resmi faturayı ZIP paketi olarak indirir (UBL-XML + HTML)
 */
async function downloadInvoiceZip(ettn, onayDurumu = 'Onaylandı', belgeTip = 'FATURA') {
  if (!ettn) throw new Error('ETTN zorunludur.');
  const token = await login();

  const url = `${GIB_URL}/earsiv-services/download?token=${token}&ettn=${ettn}&belgeTip=${belgeTip}&onayDurumu=${encodeURIComponent(onayDurumu)}&cmd=EARSIV_PORTAL_BELGE_INDIR`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Referer': `${GIB_URL}/index.jsp`
    }
  });

  if (!res.ok) {
    throw new Error(`GİB Dosya indirme hatası: HTTP ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = {
  loadConfig,
  saveConfig,
  login,
  dispatch,
  checkStatus,
  queryMernis,
  getDrafts,
  createDraftInvoice,
  getInvoiceHtml,
  deleteDraft,
  queryRegisteredPhone,
  sendSmsVerification,
  verifySmsAndSign,
  downloadInvoiceZip,
  tutarYaziyla,
  formatDate,
  formatTime
};
