const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

// Browser yükleme durumu
let browserInstallationInProgress = false;
let browserInstallationComplete = false;

// Railway'de Playwright browser'larını asenkron olarak kontrol et ve yükle (server başlamayı engellemez)
if (process.env.RAILWAY_ENVIRONMENT) {
  // Asenkron olarak browser kontrolü yap (server başlamayı engellemez)
  setImmediate(async () => {
    try {
      console.log('🔧 [Railway] Playwright browser\'ları kontrol ediliyor (arka planda)...');
      const fs = require('fs');
      const path = require('path');
      
      // Browser executable'ı kontrol et
      const browserPaths = [
        path.join(process.env.HOME || '/root', '.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell'),
        path.join(process.cwd(), 'node_modules/.cache/playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell')
      ];
      
      let browserFound = false;
      for (const browserPath of browserPaths) {
        try {
          if (fs.existsSync(browserPath)) {
            console.log(`✅ [Railway] Browser bulundu: ${browserPath}`);
            browserFound = true;
            browserInstallationComplete = true;
            break;
          }
        } catch (e) {
          // Devam et
        }
      }
      
      if (!browserFound) {
        console.log('⚠️ [Railway] Browser bulunamadı, arka planda yükleniyor...');
        browserInstallationInProgress = true;
        try {
          const { execSync } = require('child_process');
          execSync('npx playwright install chromium --with-deps', { 
            stdio: 'inherit',
            timeout: 300000 // 5 dakika timeout
          });
          console.log('✅ [Railway] Playwright browser\'ları yüklendi');
          browserInstallationComplete = true;
        } catch (e) {
          console.error('❌ [Railway] Playwright browser yükleme hatası:', e.message);
          // Hata olsa bile devam et, belki build'de yüklenmiştir
        } finally {
          browserInstallationInProgress = false;
        }
      }
    } catch (e) {
      console.warn('⚠️ [Railway] Browser kontrolü hatası:', e.message);
      browserInstallationInProgress = false;
    }
  });
}

const app = express();
const PORT = process.env.PORT || 3002;

// CORS ayarları - Tüm origin'lere izin ver
const corsOptions = {
  origin: '*',
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400 // 24 saat preflight cache
};

// OPTIONS preflight request'leri için manuel handling
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
  res.header('Access-Control-Max-Age', '86400');
  res.sendStatus(200);
});

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'playwright-service',
    timestamp: new Date().toISOString()
  });
});

// Routes
app.use('/api', require('./routes'));

// Error handling
app.use((err, req, res, next) => {
  console.error('❌ [Playwright Service] Error:', err);
  res.status(err.status || 500).json({
    ok: false,
    error: err.message || 'Internal server error'
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 [Playwright Service] Server running on port ${PORT}`);
  console.log(`📡 [Playwright Service] Health check: http://0.0.0.0:${PORT}/health`);
});
