# Seller Playwright Service

Railway'de bağımsız olarak çalışan Playwright servisi. Seller bilgilerini çekmek için kullanılır.

## Özellikler

- ✅ Seller bilgileri çekme (Playwright ile)
- ✅ Bağımsız Railway servisi
- ✅ Health check endpoint
- ✅ CORS desteği

## Endpoints

### Health Check
```
GET /health
```

### Seller Information
```
POST /api/sellers
GET /api/sellers/:asin
```

**Request Body (POST):**
```json
{
  "asin": "B08XYZ1234",
  "sourceMarketplace": "amazon.com",
  "targetCountry": "uk"
}
```

**Query Parameters (GET):**
- `marketplace`: Source marketplace (default: amazon.com)
- `targetCountry`: Target country code (optional)

## Railway Deployment

1. Railway Dashboard → New Service → GitHub Repo
2. Bu repo'yu seç
3. Root Directory: `.` (root)
4. Build ve Start komutları otomatik algılanacak

**Push yaptığınız halde deploy olmuyorsa:** [RAILWAY_DEPLOY_CHECKLIST.md](./RAILWAY_DEPLOY_CHECKLIST.md) dosyasındaki adımları Railway Dashboard'da kontrol edin (repo bağlantısı, branch, otomatik deploy, build/start logları).

## Port

Default port: `3002`

Railway otomatik olarak PORT environment variable'ını set eder.

## Development

```bash
npm install
npm run dev
```

## Production

```bash
npm start
```

## Timeout ayarları (504 / Cloudflare)

Backend ve Cloudflare gateway timeout (~20s) nedeniyle servis yanıt süresi kısaltıldı:

- PDP / AOD `page.goto`: 60s → 18s
- Buybox / container `waitForSelector`: 45s → 10s, 30s → 8s
- `page.reload`: 120s → 15s
- Scroll döngüsü: 15 tur × 2.5s → 6 tur × 1.2s
- Queue: EAGAIN sonrası bekleme 120s → 35s; başarı sonrası 60s → 8s

Bu sayede tek istek tipik olarak 20s altında tamamlanabilir. Yavaş veya captcha sayfalarında timeout ile hata dönebilir; backend tarafında retry veya cache kullanılabilir.
