/**
 * GİB e-Arşiv Fatura Senkronizasyon Motoru (Sync Engine)
 * 
 * - GİB Portalındaki faturaları çeker
 * - Veritabanındaki kayıtlarla karşılaştırır
 * - Tutar ve KDV detaylarını fatura HTML içeriğinden ayıklar
 * - Veritabanına (SQLite) yazar / günceller
 * - Arka planda periyodik senkronizasyonu yönetir
 */

const gib = require('./gib_earsiv');
const db = require('./db');

function parseAmount(pattern, text) {
  if (!text) return 0;
  const match = text.match(pattern);
  if (!match) return 0;
  const clean = match[1].trim().replace(/\./g, '').replace(',', '.');
  return parseFloat(clean) || 0;
}

function extractAmountsFromHtml(html) {
  if (!html) return { odenecek: 0, matrah: 0, kdv: 0 };
  const odenecek = parseAmount(/(?:Ödenecek Tutar|&Ouml;denecek Tutar)<\/span><\/td>\s*<td[^>]*>\s*([\d\.,]+)\s*TL/i, html);
  const matrah = parseAmount(/Mal Hizmet Toplam Tutarı<\/span><\/td>\s*<td[^>]*>\s*([\d\.,]+)\s*TL/i, html);
  const kdv = parseAmount(/Hesaplanan KDV[^<]*<\/span><\/td>\s*<td[^>]*>\s*([\d\.,]+)\s*TL/i, html);
  return { odenecek, matrah, kdv };
}

let isSyncRunning = false;

/**
 * Belirli tarih aralığındaki faturaları GİB ile senkronize eder
 */
async function syncInvoices(startDate, endDate, companyId = null) {
  if (isSyncRunning) {
    return { success: false, message: 'Senkronizasyon işlemi şu anda zaten devam ediyor.' };
  }

  const activeComp = companyId ? db.getCompanyById(companyId) : db.getActiveCompany();
  const effectiveCompanyId = activeComp ? activeComp.id : null;

  isSyncRunning = true;
  const logId = db.startSyncLog(effectiveCompanyId);

  try {
    const compName = activeComp ? activeComp.name : 'Varsayılan';
    console.log(`[SYNC] GİB Senkronizasyonu başladı (${compName}): ${startDate || 'varsayılan'} - ${endDate || 'varsayılan'}`);
    const gibInvoices = await gib.getDrafts(startDate, endDate);
    console.log(`[SYNC] GİB'den ${gibInvoices.length} adet belge çekildi.`);

    let addedCount = 0;
    let updatedCount = 0;

    for (const inv of gibInvoices) {
      if (!inv.ettn) continue;

      const existing = db.getInvoiceByEttn(inv.ettn);

      let odenecekTutar = existing ? existing.odenecek_tutar : 0;
      let matrah = existing ? existing.matrah : 0;
      let kdvTutari = existing ? existing.kdv_tutari : 0;
      let htmlContent = existing ? existing.html_preview : null;

      // Eğer tutar bilgisi yoksa veya HTML henüz indirilmemişse, detayları çekip parse et
      if (!odenecekTutar || odenecekTutar <= 0 || !htmlContent) {
        try {
          console.log(`[SYNC] Fatura detayları çekiliyor: ${inv.belgeNumarasi || inv.ettn} (${inv.onayDurumu})`);
          const html = await gib.getInvoiceHtml(inv.ettn, inv.onayDurumu || 'Taslak');
          if (html && html.length > 100) {
            htmlContent = html;
            const parsed = extractAmountsFromHtml(html);
            odenecekTutar = parsed.odenecek;
            matrah = parsed.matrah;
            kdvTutari = parsed.kdv;
          }
        } catch (detailErr) {
          console.warn(`[SYNC] Detay çekilemedi (${inv.belgeNumarasi}):`, detailErr.message);
        }
      }

      const invRecord = {
        ettn: inv.ettn,
        company_id: effectiveCompanyId,
        belgeNumarasi: inv.belgeNumarasi,
        belgeTarihi: inv.belgeTarihi,
        belgeTuru: inv.belgeTuru || 'FATURA',
        aliciVknTckn: inv.aliciVknTckn,
        aliciUnvanAdSoyad: inv.aliciUnvanAdSoyad,
        odenecekTutar: odenecekTutar,
        matrah: matrah,
        kdvTutari: kdvTutari,
        onayDurumu: inv.onayDurumu || 'Taslak',
        htmlPreview: htmlContent
      };

      db.upsertInvoice(invRecord, effectiveCompanyId);

      if (!existing) {
        addedCount++;
      } else {
        updatedCount++;
      }
    }

    db.finishSyncLog(logId, {
      status: 'SUCCESS',
      found: gibInvoices.length,
      added: addedCount,
      updated: updatedCount,
      message: `${gibInvoices.length} fatura senkronize edildi (${addedCount} yeni, ${updatedCount} güncellendi).`
    });

    console.log(`[SYNC] Tamamlandı: ${gibInvoices.length} fatura işlendi (${addedCount} yeni, ${updatedCount} güncellendi).`);

    return {
      success: true,
      found: gibInvoices.length,
      added: addedCount,
      updated: updatedCount,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('[SYNC] Senkronizasyon hatası:', error.message);
    db.finishSyncLog(logId, {
      status: 'ERROR',
      found: 0,
      added: 0,
      updated: 0,
      message: error.message
    });
    throw error;
  } finally {
    isSyncRunning = false;
  }
}

/**
 * Otomatik Periyodik Senkronizasyonu Başlatır
 */
function startPeriodicSync(intervalMinutes = 30) {
  const ms = intervalMinutes * 60 * 1000;
  console.log(`[SYNC] Otomatik senkronizasyon zamanlayıcısı kuruldu (Her ${intervalMinutes} dakikada bir).`);
  
  // İlk çalıştırmadan 10 saniye sonra arka planda bir sync dene
  setTimeout(async () => {
    try {
      console.log('[SYNC] Açılış senkronizasyonu başlatılıyor...');
      await syncInvoices();
    } catch (e) {
      console.warn('[SYNC] Açılış senkronizasyon hatası:', e.message);
    }
  }, 10000);

  setInterval(async () => {
    try {
      console.log('[SYNC] Periyodik arka plan senkronizasyonu çalışıyor...');
      await syncInvoices();
    } catch (e) {
      console.warn('[SYNC] Periyodik senkronizasyon hatası:', e.message);
    }
  }, ms);
}

module.exports = {
  syncInvoices,
  startPeriodicSync,
  extractAmountsFromHtml
};
