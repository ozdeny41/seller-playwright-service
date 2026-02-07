const { testConnection } = require('./db');

async function testDatabaseConnection() {
  console.log('🔄 [Test] Database bağlantısı test ediliyor...');

  const connected = await testConnection();
  if (connected) {
    console.log('✅ [Test] Database bağlantısı başarılı!');
    process.exit(0);
  } else {
    console.log('❌ [Test] Database bağlantısı başarısız!');
    process.exit(1);
  }
}

testDatabaseConnection();
