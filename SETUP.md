# Railway Deployment Setup

## 1. GitHub Repo Oluştur

1. https://github.com/new adresine git
2. Repository name: `seller-playwright-service`
3. Public veya Private seç
4. **Initialize this repository with a README** seçme (zaten var)
5. Create repository

## 2. Local Repo'yu GitHub'a Bağla

```bash
cd /Users/shopvixlimited/Desktop/vixify-playwright-service

# Git config (ilk kez ise)
git config user.email "y.ozden@icloud.com"
git config user.name "ozdeny41"

# GitHub repo'yu ekle
git remote add origin https://github.com/ozdeny41/seller-playwright-service.git

# Dosyaları ekle ve commit
git add .
git commit -m "Initial commit: Seller Playwright Service"

# GitHub'a push
git branch -M main
git push -u origin main
```

## 3. Railway'de Deploy Et

1. Railway Dashboard → New Service → GitHub Repo
2. `ozdeny41/seller-playwright-service` repo'sunu seç
3. Root Directory: `.` (root - boş bırak)
4. Railway otomatik olarak:
   - `package.json`'dan build komutunu algılar
   - `npm start` ile başlatır
   - PORT environment variable'ını set eder

## 4. Environment Variables (Gerekirse)

Şu an için gerekli environment variable yok, ama ileride eklenebilir:
- `PORT` (Railway otomatik set eder)
- `NODE_ENV=production` (Railway otomatik set eder)

## 5. Test

Deploy sonrası:
- Health check: `https://your-service.railway.app/health`
- Seller endpoint: `POST https://your-service.railway.app/api/sellers`
