/**
 * Excel Toplu Fatura Yükleme ve Doğrulama Servisi
 */

const XLSX = require('xlsx');
const gib = require('./gib_earsiv');
const db = require('./db');

/**
 * Kullanıcının indirip dolduracağı Excel şablonunu üretir
 */
function generateTemplate() {
  const sampleData = [
    {
      'TCKN_VKN': '2580014335',
      'ALICI_UNVAN_AD_SOYAD': 'ÇİZGE TANITIM VE MATBAACILIK LİMİTED ŞİRKETİ',
      'VERGI_DAIRESI': 'Çekirge',
      'IL': 'Bursa',
      'ILCE_ADRES': 'Nilüfer / Bursa',
      'URUN_HIZMET_ADI': 'Yazılım ve SaaS Abonelik Bedeli',
      'MIKTAR': 1,
      'BIRIM': 'ADET',
      'BIRIM_FIYAT': 10000,
      'KDV_ORANI': 20,
      'FATURA_NOTU': 'Ekim 2026 Dönem Hizmet Bedeli',
      'SIPARIS_NO': 'SIP-2026-001'
    },
    {
      'TCKN_VKN': '11111111111',
      'ALICI_UNVAN_AD_SOYAD': 'Ahmet Yılmaz',
      'VERGI_DAIRESI': '',
      'IL': 'İstanbul',
      'ILCE_ADRES': 'Kadıköy / İstanbul',
      'URUN_HIZMET_ADI': 'Bilişim Danışmanlık Hizmeti',
      'MIKTAR': 2,
      'BIRIM': 'ADET',
      'BIRIM_FIYAT': 2500,
      'KDV_ORANI': 20,
      'FATURA_NOTU': 'Saatlik Danışmanlık',
      'SIPARIS_NO': ''
    }
  ];

  const ws = XLSX.utils.json_to_sheet(sampleData);

  // Sütun genişlikleri ayarla
  ws['!cols'] = [
    { wch: 16 }, // TCKN_VKN
    { wch: 45 }, // ALICI_UNVAN_AD_SOYAD
    { wch: 18 }, // VERGI_DAIRESI
    { wch: 14 }, // IL
    { wch: 25 }, // ILCE_ADRES
    { wch: 35 }, // URUN_HIZMET_ADI
    { wch: 10 }, // MIKTAR
    { wch: 10 }, // BIRIM
    { wch: 14 }, // BIRIM_FIYAT
    { wch: 12 }, // KDV_ORANI
    { wch: 35 }, // FATURA_NOTU
    { wch: 16 }  // SIPARIS_NO
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'FaturaListesi');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * Yüklenen Excel dosyasını ayrıştırır ve satır satır denetler
 */
function parseAndValidateExcel(fileBuffer) {
  const wb = XLSX.read(fileBuffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    throw new Error('Excel dosyasında geçerli bir çalışma sayfası bulunamadı.');
  }

  const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
  if (!rawRows || rawRows.length === 0) {
    throw new Error('Excel sayfası boş veya geçerli satır içermiyor.');
  }

  const parsedRows = [];
  let validCount = 0;
  let invalidCount = 0;
  let totalMatrah = 0;
  let totalKdv = 0;
  let totalAmount = 0;

  rawRows.forEach((row, index) => {
    // Esnek sütun eşleştirme (küçük harfe çevirip boşlukları temizleyerek)
    const normalized = {};
    for (const [key, val] of Object.entries(row)) {
      const cleanKey = String(key).trim().toUpperCase().replace(/[\s\-\_\/]/g, '');
      normalized[cleanKey] = typeof val === 'string' ? val.trim() : val;
    }

    const tcknVkn = String(
      normalized['TCKNVKN'] || normalized['TCKN'] || normalized['VKN'] || normalized['VERGINO'] || ''
    ).replace(/\D/g, '');

    const alici = String(
      normalized['ALICIUNVANADSOYAD'] || normalized['ALICIUNVAN'] || normalized['ALICI'] || normalized['MUSTERI'] || normalized['UNVAN'] || ''
    ).trim();

    const vergiDairesi = String(normalized['VERGIDAIRESI'] || normalized['VERGIDAE'] || '').trim();
    const il = String(normalized['IL'] || normalized['SEHIR'] || 'Bursa').trim();
    const adres = String(normalized['ILCEADRES'] || normalized['ADRES'] || normalized['ILCE'] || '').trim();
    const urunHizmet = String(normalized['URUNHIZMETADI'] || normalized['URUNADI'] || normalized['HIZMET'] || normalized['ACIKLAMA'] || 'Hizmet Bedeli').trim();

    const miktar = parseFloat(normalized['MIKTAR'] || normalized['ADET'] || 1) || 1;
    const birim = String(normalized['BIRIM'] || 'ADET').trim().toUpperCase();
    const birimFiyat = parseFloat(String(normalized['BIRIMFIYAT'] || normalized['FIYAT'] || normalized['TUTAR'] || 0).replace(',', '.')) || 0;
    const kdvOrani = parseFloat(normalized['KDVORANI'] || normalized['KDV'] || 20);
    const not = String(normalized['FATURANOTU'] || normalized['NOT'] || '').trim();
    const siparisNo = String(normalized['SIPARISNO'] || normalized['SIPARIS'] || normalized['REFNO'] || '').trim();

    // Doğrulama Kuralları
    const errors = [];
    if (!tcknVkn) {
      errors.push('TCKN veya VKN alanı boş bırakılamaz.');
    } else if (tcknVkn.length !== 10 && tcknVkn.length !== 11) {
      errors.push(`TCKN (11 hane) veya VKN (10 hane) olmalıdır. (Girilen: ${tcknVkn.length} hane)`);
    }

    if (!alici) {
      errors.push('Alıcı Ünvan / Ad Soyad alanı boş bırakılamaz.');
    }

    if (birimFiyat <= 0) {
      errors.push('Birim Fiyat 0\'dan büyük olmalıdır.');
    }

    if (miktar <= 0) {
      errors.push('Miktar 0\'dan büyük olmalıdır.');
    }

    // Hesaplamalar
    const matrah = Math.round(miktar * birimFiyat * 100) / 100;
    const kdv = Math.round(matrah * (kdvOrani / 100) * 100) / 100;
    const genelToplam = Math.round((matrah + kdv) * 100) / 100;

    const isValid = errors.length === 0;
    if (isValid) {
      validCount++;
      totalMatrah += matrah;
      totalKdv += kdv;
      totalAmount += genelToplam;
    } else {
      invalidCount++;
    }

    parsedRows.push({
      rowNumber: index + 2, // Excel satır no (1: başlık)
      isValid,
      errors,
      tcknVkn,
      isCorporate: tcknVkn.length === 10,
      alici,
      vergiDairesi,
      il,
      adres,
      urunHizmet,
      miktar,
      birim,
      birimFiyat,
      kdvOrani,
      matrah,
      kdv,
      genelToplam,
      not,
      siparisNo
    });
  });

  return {
    summary: {
      total: parsedRows.length,
      valid: validCount,
      invalid: invalidCount,
      totalMatrah: Math.round(totalMatrah * 100) / 100,
      totalKdv: Math.round(totalKdv * 100) / 100,
      totalAmount: Math.round(totalAmount * 100) / 100
    },
    rows: parsedRows
  };
}

/**
 * Onaylanan geçerli satırları sırayla GİB Portalına aktarır
 */
async function executeBulkTransfer(rows) {
  const validRows = rows.filter(r => r.isValid);
  if (validRows.length === 0) {
    throw new Error('GİB portalına aktarılacak geçerli fatura bulunamadı.');
  }

  const results = [];
  let successCount = 0;
  let failCount = 0;

  for (const row of validRows) {
    try {
      console.log(`[BULK] GİB Taslak oluşturuluyor: Satır ${row.rowNumber} (${row.alici})`);

      let buyerTitle = '';
      let buyerFirstName = '';
      let buyerLastName = '';

      if (row.isCorporate) {
        buyerTitle = row.alici;
      } else {
        const parts = row.alici.split(' ');
        if (parts.length > 1) {
          buyerLastName = parts.pop();
          buyerFirstName = parts.join(' ');
        } else {
          buyerFirstName = row.alici;
          buyerLastName = '.';
        }
      }

      const invoicePayload = {
        tcknOrVkn: row.tcknVkn,
        buyerTitle,
        buyerFirstName,
        buyerLastName,
        taxOffice: row.vergiDairesi || '',
        city: row.il || 'Bursa',
        district: row.adres || '',
        fullAddress: row.adres || `${row.il}`,
        serviceName: row.urunHizmet,
        totalPrice: row.matrah,
        kdvRate: row.kdvOrani,
        note: row.not || '',
        orderNumber: row.siparisNo || ''
      };

      const result = await gib.createDraftInvoice(invoicePayload);

      // Veritabanına kaydet
      if (result.ettn) {
        db.upsertInvoice({
          ettn: result.ettn,
          belgeNumarasi: result.belgeNumarasi,
          belgeTarihi: result.belgeTarihi,
          aliciUnvanAdSoyad: row.alici,
          aliciVknTckn: row.tcknVkn,
          odenecekTutar: row.genelToplam,
          matrah: row.matrah,
          kdvTutari: row.kdv,
          onayDurumu: 'Taslak',
          kaynak: 'EXCEL_IMPORT'
        });
      }

      successCount++;
      results.push({
        rowNumber: row.rowNumber,
        success: true,
        alici: row.alici,
        tcknVkn: row.tcknVkn,
        tutar: row.genelToplam,
        belgeNumarasi: result.belgeNumarasi,
        ettn: result.ettn,
        message: result.message
      });

      // GİB oturumunu yormamak için her fatura arasına 400ms bekleme
      await new Promise(r => setTimeout(r, 400));
    } catch (err) {
      console.error(`[BULK] Satır ${row.rowNumber} aktarılamadı:`, err.message);
      failCount++;
      results.push({
        rowNumber: row.rowNumber,
        success: false,
        alici: row.alici,
        tcknVkn: row.tcknVkn,
        tutar: row.genelToplam,
        error: err.message
      });
    }
  }

  return {
    total: validRows.length,
    successCount,
    failCount,
    results
  };
}

module.exports = {
  generateTemplate,
  parseAndValidateExcel,
  executeBulkTransfer
};
