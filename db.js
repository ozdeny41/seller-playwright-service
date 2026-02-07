const { Sequelize } = require('sequelize');
require('dotenv').config();

// Database bağlantısı - Railway için
let sequelize;

if (process.env.DATABASE_URL) {
  // Railway'de DATABASE_URL tanımlıysa onu kullan
  sequelize = new Sequelize(process.env.DATABASE_URL, {
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
} else {
  // DATABASE_URL tanımlı değilse, config/database.js kullan
  const config = require('./config/database.js');
  const env = process.env.NODE_ENV || 'development';
  const dbConfig = config[env];
  
  sequelize = new Sequelize(
    dbConfig.database,
    dbConfig.username,
    dbConfig.password,
    {
      host: dbConfig.host,
      port: dbConfig.port,
      dialect: dbConfig.dialect,
      logging: dbConfig.logging,
      pool: dbConfig.pool,
      dialectOptions: dbConfig.dialectOptions
    }
  );
}

// Bağlantıyı test et
async function testConnection() {
  try {
    await sequelize.authenticate();
    console.log('✅ [Database] PostgreSQL bağlantısı başarılı');
    return true;
  } catch (error) {
    console.error('❌ [Database] PostgreSQL bağlantı hatası:', error.message);
    console.error('❌ [Database] DATABASE_URL:', process.env.DATABASE_URL ? 'Tanımlı' : 'Tanımlı DEĞİL');
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
