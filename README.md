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
