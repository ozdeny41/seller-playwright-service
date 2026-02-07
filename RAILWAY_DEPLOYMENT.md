# Railway Deployment - Seller Playwright Service

## Railway'de Deploy Etme Adımları

### 1. GitHub Repository
- Repository: `ozdeny41/seller-playwright-service`
- Branch: `main`

### 2. Railway'de Yeni Servis Oluşturma

1. Railway Dashboard'a gidin
2. **New Project** → **Deploy from GitHub repo**
3. `ozdeny41/seller-playwright-service` repository'sini seçin
4. **Deploy** butonuna tıklayın

### 3. Railway Ayarları

#### Root Directory
- Root Directory: `/` (boş bırakın veya `/` yazın)

#### Build Command
- Build Command: `npm install` (otomatik olarak nixpacks.toml'dan alınacak)

#### Start Command
- Start Command: `npm start` (otomatik olarak nixpacks.toml'dan alınacak)

### 4. Environment Variables

Railway'de environment variable eklemenize gerek yok (şu an için).

### 5. Public URL Alma

1. Railway Dashboard → Servis → **Settings** → **Networking**
2. **Generate Domain** butonuna tıklayın
3. Public URL'i kopyalayın (örn: `https://seller-playwright-service-xxxxx.up.railway.app`)

### 6. Main Backend'e Environment Variable Ekleme

Main backend servisinizde (29.07.2025) şu environment variable'ı ekleyin:

```bash
SELLER_PLAYWRIGHT_SERVICE_URL=https://seller-playwright-service-xxxxx.up.railway.app
```

**Railway CLI ile:**
```bash
railway variables set SELLER_PLAYWRIGHT_SERVICE_URL=https://seller-playwright-service-xxxxx.up.railway.app
```

**Veya Railway Dashboard'dan:**
1. Main backend servisi → **Variables**
2. **New Variable** → `SELLER_PLAYWRIGHT_SERVICE_URL`
3. Value: Playwright servisinin public URL'i

### 7. Health Check

Playwright servisinin çalıştığını kontrol edin:

```bash
curl https://seller-playwright-service-xxxxx.up.railway.app/health
```

Beklenen yanıt:
```json
{
  "status": "ok",
  "service": "playwright-service",
  "timestamp": "2025-01-XX..."
}
```

### 8. Troubleshooting

#### Playwright Browser Yüklenmiyor
- Railway loglarını kontrol edin
- `npx playwright install chromium --with-deps` komutunun çalıştığını doğrulayın
- Build loglarında "✅ Playwright Chromium found" mesajını arayın

#### Servis Başlamıyor
- Railway loglarını kontrol edin
- Port'un doğru ayarlandığını kontrol edin (PORT environment variable)
- `npm start` komutunun çalıştığını doğrulayın

#### 404 Hatası
- Public URL'in doğru olduğunu kontrol edin
- `/health` endpoint'ini test edin
- Railway'de servisin **Active** durumda olduğunu kontrol edin

### 9. Test

Main backend'den test etmek için:

```bash
curl -X POST https://seller-playwright-service-xxxxx.up.railway.app/api/sellers \
  -H "Content-Type: application/json" \
  -d '{
    "asin": "B0DHWTMQBB",
    "sourceMarketplace": "amazon.com",
    "targetCountry": "uk"
  }'
```
