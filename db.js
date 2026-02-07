const { Sequelize } = require('sequelize');
require('dotenv').config();

// Railway PostgreSQL bağlantısı
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  logging: false, // Production'da logları kapat
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000
  },
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  }
});

// Bağlantıyı test et
async function testConnection() {
  try {
    await sequelize.authenticate();
    console.log('✅ [Database] PostgreSQL bağlantısı başarılı');
    return true;
  } catch (error) {
    console.error('❌ [Database] PostgreSQL bağlantı hatası:', error.message);
    return false;
  }
}

// Migration'ları çalıştır
async function runMigrations() {
  try {
    console.log('🔄 [Database] Migration\'lar kontrol ediliyor...');
    
    // Sequelize CLI ile migration çalıştır
    const { execSync } = require('child_process');
    execSync('npx sequelize-cli db:migrate --config config/database.js --models-path models', { 
      stdio: 'inherit',
      cwd: process.cwd()
    });
    
    console.log('✅ [Database] Migration\'lar başarıyla çalıştırıldı');
  } catch (error) {
    console.error('❌ [Database] Migration hatası:', error.message);
    // Migration hatası olsa bile devam et
  }
}

module.exports = {
  sequelize,
  testConnection,
  runMigrations
};
