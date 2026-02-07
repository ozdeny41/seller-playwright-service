const express = require('express');
const router = express.Router();
const playwrightService = require('../services/playwrightService');

// KRİTİK: Queue - aynı anda maksimum 1 batch işlemi (vixify-playwright-service-batch ile aynı)
class RequestQueue {
  constructor(maxConcurrent = 1) {
    this.maxConcurrent = maxConcurrent;
    this.running = 0;
    this.queue = [];
    this.processing = false;
  }

  async add(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      setImmediate(() => this.process());
    });
  }

  async process() {
    if (this.processing || this.running >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }
    this.processing = true;
    this.running++;
    const { fn, resolve, reject } = this.queue.shift();
    try {
      const result = await fn();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.running--;
      this.processing = false;
      this.process();
    }
  }
}

const requestQueue = new RequestQueue(1);

/**
 * POST /api/playwright/select-country-for-asin-batch
 *
 * Envanter güncellemesi: Tarayıcı bir kere açılır, ülke/para birimi seçilir, 20 sekme açılır,
 * ASIN linkleri yüklenir, shipping + seller bilgileri çekilir.
 * vixify-playwright-service-batch mantığı — maliyet düşürme için tek servis.
 *
 * Body: { asins: [], sourceMarketplace, targetCountryCode, productIds?, authToken? }
 */
router.post('/select-country-for-asin-batch', async (req, res, next) => {
  console.log(`📥 [Seller Playwright] POST alındı: /api/playwright/select-country-for-asin-batch`);
  try {
    const { asins, sourceMarketplace = 'amazon.com', targetCountryCode, productIds, authToken } = req.body;

    if (!asins || !Array.isArray(asins) || asins.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'asins array is required and must not be empty'
      });
    }

    if (!targetCountryCode) {
      return res.status(400).json({
        ok: false,
        error: 'targetCountryCode is required'
      });
    }

    console.log(`📦 [Seller Playwright] Batch: ${asins.length} ASIN | ${sourceMarketplace} | Deliver to: ${targetCountryCode}`);

    // 202 Accepted — arka planda işle
    res.status(202).json({
      ok: true,
      success: true,
      message: 'Batch işleme başlatıldı, arka planda devam ediyor...',
      status: 'processing',
      total: asins.length
    });

    setImmediate(() => {
      requestQueue.add(async () => {
        console.log(`🚀 [Seller Playwright] Batch işleniyor: ${asins.length} ASIN`);
        try {
          const batchResults = await playwrightService.processBatchInventoryUpdate(
            asins,
            sourceMarketplace,
            targetCountryCode,
            productIds,
            authToken
          );

          const successful = batchResults.filter(r => r.success).length;
          const failed = batchResults.filter(r => !r.success).length;
          console.log(`✅ [Seller Playwright] Batch tamamlandı: ${successful} başarılı, ${failed} başarısız`);

          // Backend'e sonuçları gönder
          if (authToken) {
            const backendUrl = process.env.BACKEND_URL || 'https://29072025-production-c367.up.railway.app';
            try {
              const batchRes = await fetch(`${backendUrl}/api/inventory/batch-shipping-results`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({
                  results: batchResults,
                  sourceMarketplace,
                  targetCountryCode,
                  total: batchResults.length,
                  successful,
                  failed
                })
              });
              if (!batchRes.ok) {
                const errText = await batchRes.text().catch(() => '');
                console.warn(`⚠️ [Seller Playwright] Backend batch-shipping-results ${batchRes.status}: ${errText.substring(0, 200)}`);
              } else {
                console.log(`✅ [Seller Playwright] Backend batch-shipping-results başarılı`);
              }
            } catch (err) {
              console.warn(`⚠️ [Seller Playwright] Backend'e sonuç gönderme hatası: ${err.message}`);
            }
          }

          return batchResults;
        } catch (error) {
          console.error(`❌ [Seller Playwright] Batch hatası:`, error.message);
          throw error;
        }
      }).catch(error => {
        console.error(`❌ [Seller Playwright] Queue hatası:`, error.message);
      });
    });
  } catch (error) {
    console.error('❌ [Seller Playwright] Batch endpoint hatası:', error);
    res.status(500).json({
      ok: false,
      error: error.message || 'Internal server error'
    });
  }
});

router.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'seller-playwright-service-batch',
    timestamp: new Date().toISOString(),
    contexts: playwrightService.contexts?.size || 0,
    pagePools: playwrightService.pagePools?.size || 0
  });
});

console.log(`✅ [Seller Playwright] Batch routes: /select-country-for-asin-batch, /health`);

module.exports = router;
