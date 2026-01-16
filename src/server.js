const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

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
