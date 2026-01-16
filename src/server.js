const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { execSync } = require('child_process');

dotenv.config();

// Railway'de Playwright browser'larını runtime'da yükle (background'da, non-blocking)
if (process.env.RAILWAY_ENVIRONMENT) {
  // Browser kontrolü ve yükleme işlemini background'da yap (server başlamasını engellemesin)
  setImmediate(() => {
    console.log('🔧 [Railway] Playwright browser\'ları kontrol ediliyor (background)...');
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
          break;
        }
      } catch (e) {
        // Devam et
      }
    }
    
    if (!browserFound) {
      console.log('⚠️ [Railway] Browser bulunamadı, background\'da yükleniyor...');
      // Background'da yükle (server başlamasını engellemesin)
      const { spawn } = require('child_process');
      const installProcess = spawn('npx', ['playwright', 'install', 'chromium', '--with-deps'], {
        stdio: 'pipe',
        detached: true
      });
      
      installProcess.stdout.on('data', (data) => {
        console.log(`[Browser Install] ${data.toString().trim()}`);
      });
      
      installProcess.stderr.on('data', (data) => {
        console.error(`[Browser Install Error] ${data.toString().trim()}`);
      });
      
      installProcess.on('close', (code) => {
        if (code === 0) {
          console.log('✅ [Railway] Playwright browser\'ları yüklendi (background)');
        } else {
          console.warn(`⚠️ [Railway] Browser yükleme tamamlandı (code: ${code}), belki build\'de yüklenmiştir`);
        }
      });
      
      installProcess.unref(); // Process'i detach et, server kapanmasını engellemesin
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
