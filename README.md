# 🧾 GİB e-Arşiv Fatura Portalı & Entegrasyon Mikroservisi

Gelir İdaresi Başkanlığı (GİB) e-Arşiv Portalı (`earsivportal.efatura.gov.tr`) ile doğrudan konuşan, bağımsız çalışabilen kurumsal fatura otomasyon motoru ve modern web kokpiti.

Pahalı özel entegratörlere ihtiyaç duymadan, GİB'in resmi 5.000 / 30.000 TL portalı veya genel e-Arşiv portal altyapısını kullanarak **resmi faturalar kesmenizi, SMS ile onaylamanızı ve imzalı UBL-XML arşivlerini indirmenizi** sağlar.

---

## 🌟 Temel Yetenekler

1. **Doğrudan GİB Portal Oturumu:** Kullanıcı kodu ve şifre ile resmi portala bağlanır, oturum ve token yönetimini otomatik yürütür.
2. **MERNİS & Vergi Dairesi Otomatik Sicil:** TCKN veya VKN girildiğinde alıcının ad/soyad veya şirket ünvanını ve bağlı vergi dairesini GİB sicil kayıtlarından otomatik getirir.
3. **Çok Kalemli & Esnek KDV Matrahı:** %0, %1, %10 ve %20 KDV oranları ile sınırsız hizmet/ürün kalemi, döviz/TL desteği ve Türk Lirası cinsinden yazıyla tutar çevirici (`tutarYaziyla`).
4. **SMS OTP ile Resmi İmzalama (Mühürleme):** GİB'de kayıtlı cep telefonunuza tek kullanımlık SMS onay kodu gönderir, onaylandığında faturayı resmi olarak onaylar ve mühürler.
5. **UBL-XML & HTML Arşiv İndirme:** Onaylanan faturaların resmi mevzuata uygun elektronik imza paketini (ZIP: UBL 2.1 XML + HTML) tek tıkla indirir.
6. **Otomatik E-Posta İletimi (SMTP):** Kesilen ve onaylanan faturaları doğrudan müşterinin e-posta adresine HTML veya ekli resmi arşiv olarak gönderir.
7. **Bağımsız REST API:** SaaS platformunuz, e-ticaret siteniz veya mobil uygulamalarınız tarafından HTTP JSON çağrılarıyla kullanılabilir.

---

## 🚀 Hızlı Başlangıç

### 1. Bağımlılıkları Yükleyin
```bash
cd /Users/ramazantuncer/mydocker/web/gib_earsiv
npm install
```

### 2. Yapılandırma
`.env.example` dosyasını `.env` olarak kopyalayın ve düzenleyin:
```env
PORT=3005
APP_USER=admin
APP_PASS=admin123
AUTH_SECRET=guclu_bir_jwt_gizli_anahtari

GIB_USER=your_gib_user
GIB_PASS=your_gib_password
GIB_VKN=11111111111
GIB_UNVAN="ÖRNEK ŞİRKET LTD. ŞTİ."
GIB_VERGI_DAIRESI="Nilüfer Vergi Dairesi"
```

### 3. Sunucuyu Başlatın
```bash
npm start
```
Web Kokpiti: **http://localhost:3005**  
REST API Durumu: **http://localhost:3005/api/status**

---

## 🐳 Docker ile Çalıştırma

Projeyi sisteminizde arka planda izole bir Docker container olarak ayağa kaldırmak için:

```bash
docker-compose up -d --build
```

Konteyner `3005` portunda çalışacak ve `config/` dizinini kalıcı volume olarak saklayacaktır.

---

## 📡 REST API Referansı

### 1. Durum Kontrolü
```http
GET /api/status
```
**Yanıt:**
```json
{
  "success": true,
  "port": 3005,
  "gib": {
    "connected": true,
    "message": "GİB e-Arşiv Portalı ile bağlantı aktif ve doğrulandı.",
    "unvan": "ÖRNEK ŞİRKET LTD. ŞTİ.",
    "vkn": "11111111111"
  }
}
```

---

### 2. MERNİS / VKN Sicil Sorgulama
```http
POST /api/query-mernis
Content-Type: application/json

{
  "vknTckn": "11111111111"
}
```

---

### 3. Resmi Taslak Fatura Oluşturma
```http
POST /api/invoices/draft
Content-Type: application/json

{
  "vknTckn": "11111111111",
  "aliciAdi": "Ahmet",
  "aliciSoyadi": "Yılmaz",
  "aliciVergiDairesi": "Nilüfer V.D.",
  "aliciEmail": "ahmet@ornek.com",
  "items": [
    {
      "malHizmet": "SaaS Yazılım Abonelik Bedeli",
      "miktar": 1,
      "birim": "ADET",
      "birimFiyat": 1000,
      "kdvOrani": 20
    }
  ],
  "not": "Online Kredi Kartı Tahsilatı"
}
```
**Başarılı Yanıt:**
```json
{
  "success": true,
  "message": "Fatura başarıyla oluşturuldu.",
  "ettn": "4a7199c4-11e2-41f2-97ea-8d14b18f8eb0",
  "belgeNumarasi": "GIB2026000000008"
}
```

---

### 4. SMS Doğrulama & Resmi İmzalama (Mühürleme)

#### Adım 1: SMS Onay Kodu İsteği
```http
POST /api/sms/send
Content-Type: application/json

{}
```
*GİB sisteminde kayıtlı mükellef cep telefonuna SMS şifresi gönderir ve bir `oid` döner.*

#### Adım 2: SMS Kodunu Doğrula ve İmzala
```http
POST /api/sms/verify
Content-Type: application/json

{
  "smsCode": "589201",
  "oid": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "ettn": "4a7199c4-11e2-41f2-97ea-8d14b18f8eb0",
  "belgeNumarasi": "GIB2026000000008"
}
```

---

### 5. Faturaları Listeleme
```http
GET /api/invoices?startDate=2026-10-01&endDate=2026-10-14
```

---

### 6. Fatura HTML Önizleme
```http
GET /api/invoices/{ettn}/html?onayDurumu=Taslak
```

---

### 7. Resmi İmzalı Arşiv İndirme (ZIP)
```http
GET /api/invoices/{ettn}/download?onayDurumu=Onaylandı
```
*Geriye UBL-XML ve HTML içeren resmi imzalı `.zip` dosyasını stream eder.*

---

### 8. Müşteriye E-Posta Gönderme
```http
POST /api/invoices/{ettn}/send-email
Content-Type: application/json

{
  "to": "musteri@ornek.com",
  "subject": "Resmi e-Arşiv Faturanız",
  "onayDurumu": "Onaylandı",
  "belgeNumarasi": "GIB2026000000008"
}
```

---

## 🔒 Güvenlik Notları
- GİB oturum token'ları RAM belleğinde tutulur, 45 dakikalık hareketsizlikte veya hata anında otomatik olarak yenilenir.
- Hassas şifreler `.gitignore` ile korunan `.env` ve `config/gib_config.json` dosyalarında barındırılır, API uç noktalarında asla açık metin olarak dönülmez (`••••••••`).
