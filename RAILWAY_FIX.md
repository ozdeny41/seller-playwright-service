# Railway Playwright Browser Installation Fix

## Sorun
Playwright browser'ları Railway'de yüklenmiyordu. Log'larda şu hata görülüyordu:
```
Executable doesn't exist at /root/.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell
```

## Çözüm
`nixpacks.toml` dosyasında:
1. `PLAYWRIGHT_BROWSERS_PATH=0` kaldırıldı (bu flag browser'ların yüklenmesini engelliyordu)
2. `|| echo '⚠️ ...'` kaldırıldı (hata durumunda build durmalı)
3. Browser executable kontrolü eklendi

## Deploy
Railway otomatik olarak yeni deployment başlatacak. Build loglarında şunları görmelisiniz:
```
=== INSTALLING PLAYWRIGHT BROWSERS ===
=== VERIFYING PLAYWRIGHT CHROMIUM ===
=== CHECKING CHROMIUM EXECUTABLE ===
```

## Test
Deploy sonrası test edin:
```bash
curl -X POST https://seller-playwright-service-production.up.railway.app/api/sellers \
  -H "Content-Type: application/json" \
  -d '{"asin":"B0DHWTMQBB","sourceMarketplace":"amazon.com","targetCountry":"uk"}'
```

## Notlar
- Railway'de Playwright browser'ları `$HOME/.cache/ms-playwright/` dizinine yüklenir
- Build sırasında browser'lar yüklenmeli, aksi halde runtime'da hata alınır
- `--with-deps` flag'i sistem bağımlılıklarını da yükler (gerekli)
