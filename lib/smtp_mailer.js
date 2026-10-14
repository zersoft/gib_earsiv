/**
 * SMTP Mail Gönderim Servisi
 * Resmi e-Arşiv faturasını alıcı e-posta adresine HTML veya ekli dosya olarak iletir.
 */

const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const MAIL_CONFIG_PATH = path.join(__dirname, '..', 'config', 'mail_config.json');

function loadMailConfig() {
  if (fs.existsSync(MAIL_CONFIG_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(MAIL_CONFIG_PATH, 'utf8'));
    } catch (e) {
      console.error('[Mailer] Config okuma hatası:', e.message);
    }
  }

  return {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    fromName: process.env.SMTP_FROM_NAME || 'e-Arşiv Fatura Portalı',
    fromEmail: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || ''
  };
}

function saveMailConfig(newConfig) {
  const current = loadMailConfig();
  const merged = { ...current, ...newConfig };
  const dir = path.dirname(MAIL_CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(MAIL_CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

function getTransporter() {
  const cfg = loadMailConfig();
  if (!cfg.user || !cfg.pass) {
    throw new Error('SMTP ayarları eksik. Lütfen kullanıcı adı ve şifre girin.');
  }

  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass
    }
  });
}

/**
 * Fatura e-postası gönder
 * @param {Object} options
 * @param {string} options.to - Alıcı e-posta adresi
 * @param {string} options.subject - Konu
 * @param {string} options.invoiceHtml - GİB Fatura HTML gövdesi
 * @param {string} [options.ettn] - ETTN UUID
 * @param {string} [options.belgeNumarasi] - Fatura No (örn: GIB2026...)
 * @param {Buffer} [options.attachmentBuffer] - ZIP veya PDF dosyası
 * @param {string} [options.attachmentFilename] - Ek dosya adı
 */
async function sendInvoiceEmail({ to, subject, invoiceHtml, ettn, belgeNumarasi, attachmentBuffer, attachmentFilename }) {
  if (!to) throw new Error('Alıcı e-posta adresi zorunludur.');
  const cfg = loadMailConfig();
  const transporter = getTransporter();

  const finalSubject = subject || `e-Arşiv Faturanız (${belgeNumarasi || ettn || 'Resmi Belge'})`;
  const from = `"${cfg.fromName || 'e-Arşiv Fatura'}" <${cfg.fromEmail || cfg.user}>`;

  const mailOptions = {
    from,
    to,
    subject: finalSubject,
    html: `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 650px; margin: 0 auto;">
        <div style="background: #2563eb; color: #fff; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
          <h2 style="margin: 0;">Resmi e-Arşiv Faturanız</h2>
          <p style="margin: 5px 0 0 0; opacity: 0.9; font-size: 14px;">Belge No: <strong>${belgeNumarasi || ettn || '-'}</strong></p>
        </div>
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-top: none; padding: 25px; border-radius: 0 0 8px 8px;">
          <p>Sayın Müşterimiz,</p>
          <p>Tarafınıza düzenlenen Gelir İdaresi Başkanlığı (GİB) onaylı resmi e-Arşiv faturanız ekte ve aşağıda bilgilerinize sunulmuştur.</p>
          <div style="margin: 20px 0; padding: 15px; background: #f8fafc; border-left: 4px solid #2563eb; font-size: 13px;">
            <strong>ETTN (UUID):</strong> ${ettn || '-'}<br>
            <strong>Belge Numarası:</strong> ${belgeNumarasi || '-'}<br>
            <strong>Tarih:</strong> ${new Date().toLocaleDateString('tr-TR')}
          </div>
          ${attachmentBuffer ? '<p style="color: #64748b; font-size: 13px;">📌 Faturanızın orijinal imzalı elektronik arşivi ekteki dosyada yer almaktadır.</p>' : ''}
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 25px 0;">
          <div style="text-align: center; color: #94a3b8; font-size: 12px;">
            Bu e-posta GİB e-Arşiv Fatura Entegrasyon Sistemi tarafından otomatik olarak gönderilmiştir.
          </div>
        </div>
      </div>
    `,
    attachments: []
  };

  if (attachmentBuffer && attachmentFilename) {
    mailOptions.attachments.push({
      filename: attachmentFilename,
      content: attachmentBuffer
    });
  }

  // HTML faturasını da ek olarak html dosyası şeklinde iliştirebiliriz
  if (invoiceHtml) {
    mailOptions.attachments.push({
      filename: `fatura_${belgeNumarasi || ettn || 'detay'}.html`,
      content: Buffer.from(invoiceHtml, 'utf8')
    });
  }

  const info = await transporter.sendMail(mailOptions);
  return { success: true, messageId: info.messageId };
}

async function verifySmtpConnection() {
  const transporter = getTransporter();
  await transporter.verify();
  return { success: true, message: 'SMTP bağlantısı başarılı.' };
}

module.exports = {
  loadMailConfig,
  saveMailConfig,
  sendInvoiceEmail,
  verifySmtpConnection
};
