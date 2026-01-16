# Railway Log Analizi - Seller Playwright Service

## Railway Loglarını Kontrol Etme

### 1. Railway Dashboard'dan
1. Railway Dashboard → Projenizi seçin
2. **seller-playwright-service** servisini seçin
3. **Deployments** sekmesine gidin
4. En son deployment'ı seçin
5. **View Logs** butonuna tıklayın

### 2. Railway CLI ile
```bash
cd /Users/shopvixlimited/Desktop/vixify-playwright-service
railway link  # Projeyi link edin
railway logs --service seller-playwright-service
```

## Kontrol Edilmesi Gereken Log Mesajları

### ✅ Başarılı Başlangıç Logları
Aşağıdaki loglar görünmelidir:
```
✅ [Playwright Service] Initializing...
🚀 [Playwright Service] Server running on port 3002
📡 [Playwright Service] Health check: http://0.0.0.0:3002/health
```

### ✅ Playwright Browser Installation
Build sırasında şu loglar görünmelidir:
```
=== INSTALLING PLAYWRIGHT BROWSERS ===
✅ Playwright Chromium found
=== PLAYWRIGHT INSTALLATION COMPLETE ===
```

### ❌ Olası Hatalar ve Çözümleri

#### 1. Playwright Browser Bulunamıyor
**Log:**
```
⚠️ Playwright Chromium not found in cache
```

**Çözüm:**
- `nixpacks.toml` dosyasında `--with-deps` flag'inin olduğunu kontrol edin
- Railway'de servisi yeniden deploy edin

#### 2. Port Hatası
**Log:**
```
Error: listen EADDRINUSE: address already in use :::3002
```

**Çözüm:**
- Railway otomatik olarak `PORT` environment variable'ını set eder
- `src/server.js` dosyasında `process.env.PORT || 3002` kullanıldığını kontrol edin

#### 3. Playwright Launch Hatası
**Log:**
```
❌ [Playwright] Browser launch error: Executable doesn't exist
```

**Çözüm:**
- Playwright browser'ların yüklendiğini kontrol edin
- Railway build loglarında browser installation'ı kontrol edin

#### 4. Timeout Hatası
**Log:**
```
❌ [Playwright] Timeout waiting for selector
```

**Çözüm:**
- Amazon sayfasının yüklenmesi uzun sürebilir
- Timeout değerlerini artırmayı düşünün

#### 5. Memory/Resource Hatası
**Log:**
```
FATAL ERROR: Reached heap limit
```

**Çözüm:**
- Railway'de servis planını yükseltin
- Memory limit'i artırın

## Test Endpoint'leri

### Health Check
```bash
curl https://seller-playwright-service-xxxxx.up.railway.app/health
```

**Beklenen Yanıt:**
```json
{
  "status": "ok",
  "service": "playwright-service",
  "timestamp": "2025-01-XX..."
}
```

### Seller Info Test
```bash
curl -X POST https://seller-playwright-service-xxxxx.up.railway.app/api/sellers \
  -H "Content-Type: application/json" \
  -d '{
    "asin": "B0DHWTMQBB",
    "sourceMarketplace": "amazon.com",
    "targetCountry": "uk"
  }'
```

## Log Mesajları Sırası

Normal bir seller info request'i sırasında şu loglar görünmelidir:

1. **Request Başlangıcı:**
   ```
   📡 [Playwright Service] Seller info request: B0DHWTMQBB from amazon.com
   ```

2. **Playwright Başlatma:**
   ```
   🎭 [Playwright] Seller bilgileri çekiliyor: B0DHWTMQBB from amazon.com
   ```

3. **Sayfa Açma:**
   ```
   🌐 [Playwright] Sayfa açılıyor: https://amazon.com/dp/B0DHWTMQBB
   ```

4. **Ülke Seçimi:**
   ```
   🎭 [Playwright] Ülke seçimi başlatılıyor: uk -> GB (United Kingdom)
   ✅ [Playwright] "Deliver to" butonu bulundu
   ✅ [Playwright] Ülke seçildi: GB (United Kingdom)
   ```

5. **Para Birimi Seçimi:**
   ```
   💵 [Playwright] Para birimi seçimi başlatılıyor: GBP
   ✅ [Playwright] GBP para birimi seçildi
   ```

6. **Seller Bilgileri Çekme:**
   ```
   ✅ [Playwright] "New & Used" linkine tıklandı
   🔍 [Playwright] 5 seller offer bulundu
   ✅ [Playwright] Seller 1/5 çekildi: Seller Name
   ✅ [Playwright] Toplam 5 seller bilgisi çekildi
   ```

7. **Başarılı Yanıt:**
   ```
   ✅ [Playwright Service] Seller info request completed
   ```

## Sorun Giderme Checklist

- [ ] Servis Railway'de **Active** durumda mı?
- [ ] Public URL doğru mu?
- [ ] Health check endpoint çalışıyor mu?
- [ ] Build loglarında Playwright browser yüklendi mi?
- [ ] `SELLER_PLAYWRIGHT_SERVICE_URL` environment variable main backend'de set edilmiş mi?
- [ ] Railway'de yeterli memory/resources var mı?
- [ ] Network bağlantısı var mı? (Amazon'a erişim)

## Log Paylaşma

Eğer sorun devam ediyorsa, şu logları paylaşın:
1. Build logs (deployment sırasında)
2. Runtime logs (servis çalışırken)
3. Hata mesajları (varsa)
4. Health check response
