const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

// Browser yükleme (vixify-playwright-service-batch ile aynı mantık — bir kere açık, pool kullanılır)
let browserInstallationInProgress = false;
let browserInstallationComplete = false;
let browserInstallationPromise = null;

function findChromiumExecutable() {
  const fs = require('fs');
  const path = require('path');
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(process.env.HOME || process.env.USERPROFILE || '/root', '.cache', 'ms-playwright'),
    path.join(process.cwd(), 'node_modules', '.cache', 'ms-playwright')
  ].filter(Boolean);
  const candidates = [
    ['chrome-linux', 'chrome'],
    ['chrome-headless-shell-linux64', 'chrome-headless-shell'],
    ['chromium-1200', 'chrome-headless-shell-linux64', 'chrome-headless-shell']
  ];
  for (const root of roots) {
    try {
      if (!fs.existsSync(root)) continue;
      const dirs = fs.readdirSync(root);
      const chromiumDir = dirs.find(d => d.startsWith('chromium') || d.startsWith('chrome'));
      if (!chromiumDir) continue;
      const base = path.join(root, chromiumDir);
      for (const parts of candidates) {
        const exe = path.join(base, ...parts);
        if (fs.existsSync(exe)) return exe;
      }
    } catch (e) { /* skip */ }
  }
  return null;
}

const runBrowserCheck = () => {
  browserInstallationPromise = (async () => {
    try {
      console.log('🔧 [Seller Playwright] Tarayıcı kontrolü başlatılıyor...');
      const fs = require('fs');
      const path = require('path');
      const execSync = require('child_process').execSync;
      const exe = findChromiumExecutable();
      if (exe) {
        console.log(`✅ [Seller Playwright] Chromium bulundu`);
        browserInstallationComplete = true;
        return;
      }
      console.log('⚠️ [Seller Playwright] Chromium bulunamadı, yükleniyor...');
      browserInstallationInProgress = true;
      try {
        execSync('npx playwright install chromium --with-deps', { stdio: 'inherit', timeout: 300000 });
        browserInstallationComplete = true;
      } catch (e) {
        try {
          execSync('npx playwright install chromium', { stdio: 'inherit', timeout: 180000 });
          browserInstallationComplete = true;
        } catch (e2) { /* ignore */ }
      } finally {
        browserInstallationInProgress = false;
      }
    } catch (e) {
      console.error('❌ [Seller Playwright] Tarayıcı kontrolü hatası:', e.message);
      browserInstallationInProgress = false;
    }
  })();
};

runBrowserCheck();
global.__browserInstallationPromise = browserInstallationPromise || Promise.resolve();
global.__browserInstallationComplete = browserInstallationComplete;
global.__browserInstallationInProgress = browserInstallationInProgress;
browserInstallationPromise && browserInstallationPromise.then(() => {
  global.__browserInstallationComplete = true;
  global.__browserInstallationInProgress = false;
}).catch(() => { global.__browserInstallationInProgress = false; });

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
  console.log(`🚀 [Seller Playwright] Server running on port ${PORT}`);
  console.log(`📡 [Seller Playwright] Health check: http://0.0.0.0:${PORT}/health`);
  console.log(`📡 [Seller Playwright] Batch: 20 sekme, browser bir kere açık (vixify-playwright-service-batch mantığı)`);
  setImmediate(() => {
    try {
      const playwrightService = require('./services/playwrightService');
      if (playwrightService && typeof playwrightService.getBrowser === 'function') {
        console.log(`🔥 [Seller Playwright] Tarayıcı warmup başlatıldı...`);
        playwrightService.getBrowser().then(() => console.log(`✅ [Seller Playwright] Tarayıcı warmup tamamlandı`)).catch(e => console.warn('⚠️ [Seller Playwright] Warmup hatası:', e.message));
      }
    } catch (e) { /* ignore */ }
  });
});
