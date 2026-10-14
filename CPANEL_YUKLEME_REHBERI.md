# 🚀 cPanel Dağıtım ve Yayınlama Rehberi (gib.zersoft.net)

Bu rehber, **GİB e-Arşiv Fatura Portalı** projesini cPanel barındırma ortamında `https://gib.zersoft.net` alt alan adı (subdomain) altında sorunsuz yayına almanız için adım adım talimatları içerir.

---

## 📋 Ön Gereksinimler

- cPanel üzerinde **CloudLinux Node.js Selector** ("Setup Node.js App") veya **Phusion Passenger** desteği.
- **Node.js 20.x (Önerilen) veya 22.x** (Uygulama hem Node 20 hem Node 22 ile tam uyumludur).
- `gib.zersoft.net` için etkinleştirilmiş SSL sertifikası (cPanel AutoSSL / Let's Encrypt).

---

## 🛠️ Adım Adım Kurulum

### 1. Subdomain (Alt Alan Adı) Oluşturma
1. cPanel ana ekranından **Domains (Etki Alanları)** menüsüne girin.
2. **Create A New Domain** butonuna tıklayın.
3. Alan adı: `gib.zersoft.net`
4. Belge Kök Dizini (Document Root): `gib.zersoft.net` (veya `public_html/gib`)
5. Kaydedin ve cPanel **SSL/TLS Status** ekranından alan adınız için SSL sertifikasının aktif olduğunu doğrulayın.

---

### 2. Dosyaları Sunucuya Aktarma
Projeyi sunucunuza aktarmak için iki yöntemden birini kullanabilirsiniz:

#### Yöntem A: Git ile Klonlama (Önerilen)
cPanel **Git Version Control** üzerinden:
- **Clone URL:** `https://github.com/zersoft/gib_earsiv.git`
- **Repository Path:** `gib.zersoft.net`
- **Clone** butonuna tıklayın.

#### Yöntem B: Dosya Yöneticisi (File Manager) ile Yükleme
- Proje dosyalarını `.zip` formatında sıkıştırın (`node_modules`, `.env` ve `data/*.db` hariç).
- cPanel **File Manager** ile subdomain klasörüne yükleyip çıkartın (Extract).

---

### 3. cPanel "Setup Node.js App" ile Uygulamayı Tanımlama
1. cPanel ana sayfasında **Software** altında **Setup Node.js App** simgesine tıklayın.
2. **Create Application** butonuna basın:
   - **Node.js version:** `22.x` (veya en güncel 22 sürümü)
   - **Application mode:** `Production`
   - **Application root:** `gib.zersoft.net` (projeyi yüklediğiniz dizin)
   - **Application URL:** `gib.zersoft.net`
   - **Application startup file:** `app.js` (veya `server.js`)
3. **Create** butonuna basarak uygulamayı oluşturun.

---

### 4. Ortam Değişkenleri (.env Yapılandırması)
Proje kök dizininde `.env.example` dosyasını kopyalayarak `.env` adında yeni bir dosya oluşturun:

```env
PORT=3005
NODE_ENV=production
APP_URL=https://gib.zersoft.net

# Giriş ve Güvenlik
APP_USER=admin
APP_PASS=GucluBirAdminSifresi2026!
AUTH_SECRET=cok_guclu_ve_rastgele_jwt_gizli_anahtari_2026

# Varsayılan GİB Portal Bilgileri (earsivportal.efatura.gov.tr)
GIB_USER=GIB_KULLANICI_KODUNUZ
GIB_PASS=GIB_SIFRENIZ
GIB_VKN=VKN_VEYA_TCKN_NO
GIB_UNVAN="ŞİRKETİNİZİN RESMİ ÜNVANI"
GIB_VERGI_DAIRESI="Bağlı Olduğunuz Vergi Dairesi"

# E-Posta Gönderim (SMTP) Ayarları (Opsiyonel)
SMTP_HOST=smtp.yandex.com.tr
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=fatura@zersoft.net
SMTP_PASS=eposta_uygulama_sifresi
SMTP_FROM="Zersoft e-Arşiv Fatura <fatura@zersoft.net>"
```

---

### 5. Bağımlılıkları Yükleme (NPM Install)
1. **Setup Node.js App** ekranında uygulamanızın detayına girin.
2. **Run NPM Install** butonuna tıklayın.
3. *Alternatif olarak Terminal kullanıyorsanız:* Sayfanın en üstünde gösterilen `source /home/.../nodevenv/.../activate && cd /home/.../gib.zersoft.net` komutunu terminale yapıştırıp `npm install` çalıştırabilirsiniz.

---

### 6. İzinler ve Güvenlik (.htaccess)
- Projede yer alan `.htaccess` dosyası:
  - Otomatik HTTP -> HTTPS yönlendirmesini sağlar.
  - `.env`, SQLite veritabanı (`data/*.db`) ve log dosyalarına doğrudan web erişimini 403 Forbidden ile engeller.
- `data/` ve `config/` klasörlerinin yazma iznine (chmod `755`) sahip olduğundan emin olun.

---

### 7. Uygulamayı Başlatma
1. cPanel Node.js ekranında **Restart** butonuna tıklayın.
2. Tarayıcınızda **https://gib.zersoft.net** adresini açın.
3. İlk girişi `.env` dosyasında belirlediğiniz `APP_USER` ve `APP_PASS` ile yapabilirsiniz.

Tebrikler! Sisteme artık `https://gib.zersoft.net` üzerinden güvenle erişebilirsiniz. 🎉
