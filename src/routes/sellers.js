const express = require('express');
const router = express.Router();
const playwrightService = require('../services/playwrightService');

// KRİTİK: Queue mekanizması - EAGAIN hatalarını önlemek için
class RequestQueue {
  constructor(maxConcurrent = 1) {
    this.maxConcurrent = maxConcurrent;
    this.running = 0;
    this.queue = [];
    this.processing = false;
    this.lastEAGAINTime = 0;
    this.eagainCount = 0;
  }

  async add(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.process();
    });
  }

  async process() {
    if (this.processing || this.running >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const timeSinceLastEAGAIN = Date.now() - this.lastEAGAINTime;
    const eagainCooldownMs = 35000; // 35s (önceden 120s - 504 önleme için kısaltıldı)
    if (this.lastEAGAINTime > 0 && timeSinceLastEAGAIN < eagainCooldownMs) {
      const waitTime = eagainCooldownMs - timeSinceLastEAGAIN;
      console.log(`⏳ [Queue] Son EAGAIN hatasından ${Math.round(timeSinceLastEAGAIN/1000)}s geçti, ${Math.round(waitTime/1000)}s daha bekleniyor...`);
      setTimeout(() => this.process(), waitTime);
      return;
    }

    this.processing = true;
    this.running++;
    const { fn, resolve, reject } = this.queue.shift();
    let isEAGAINError = false;
    let exponentialDelay = 0;

    try {
      const result = await fn();
      if (this.eagainCount > 0) {
        console.log(`✅ [Queue] Başarılı işlem, EAGAIN sayacı sıfırlanıyor`);
        this.eagainCount = 0;
      }
      resolve(result);
    } catch (error) {
      const errorString = error.message || error.toString() || '';
      const isEAGAIN = error.isEAGAIN || 
                      errorString.includes('EAGAIN') || 
                      errorString.includes('Resource temporarily unavailable') ||
                      errorString.includes('spawn') ||
                      errorString.includes('Failed to launch');
      
      if (isEAGAIN) {
        isEAGAINError = true;
        this.lastEAGAINTime = Date.now();
        this.eagainCount++;
        console.error(`🚫 [Queue] EAGAIN hatası (${this.eagainCount}. kez) - Railway kaynak limiti aşıldı. Queue durduruluyor, daha uzun bekleniyor...`);
        
        const baseDelay = 35000; // 35 saniye (504 önleme - önceden 120s)
        exponentialDelay = Math.min(baseDelay * Math.pow(2, this.eagainCount - 1), 120000); // Max 120s
        
        console.error(`🚫 [Queue] ${Math.round(exponentialDelay/1000)} saniye bekleniyor (EAGAIN count: ${this.eagainCount})...`);
        reject(error);
      } else {
        reject(error);
      }
    } finally {
      this.running--;
      this.processing = false;

      if (isEAGAINError) {
        setTimeout(() => this.process(), exponentialDelay || 35000);
      } else {
        const delay = this.eagainCount > 0 ? 35000 : 8000; // EAGAIN varsa 35s, yoksa 8s (504 önleme)
        setTimeout(() => this.process(), delay);
      }
    }
  }
}

// Global queue instance — 2 paralel: source + target product-offers aynı anda çalışsın (260s timeout önleme)
const requestQueue = new RequestQueue(2);

/**
 * POST /api/sellers
 * Get seller information for a product using Playwright
 */
router.post('/', async (req, res, next) => {
  const requestStartTime = Date.now();
  try {
    console.log(`📥 [Playwright Service] ========== POST /api/sellers REQUEST BAŞLADI ==========`);
    console.log(`📥 [Playwright Service] Request headers:`, {
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent'],
      origin: req.headers.origin,
      referer: req.headers.referer
    });
    console.log(`📥 [Playwright Service] Request body:`, JSON.stringify(req.body, null, 2));
    
    const { asin, asins, sourceMarketplace = 'amazon.com', targetCountry } = req.body;
    const asinList = Array.isArray(asins)
      ? asins.map(a => String(a || '').trim()).filter(Boolean)
      : (asin ? [String(asin).trim()].filter(Boolean) : []);
    
    console.log(`📥 [Playwright Service] POST /api/sellers request alındı:`, {
      asin: asin,
      asinCount: asinList.length,
      sourceMarketplace: sourceMarketplace,
      targetCountry: targetCountry,
      bodyKeys: Object.keys(req.body),
      hasAsin: asinList.length > 0,
      asinList: asinList
    });
    
    if (asinList.length === 0) {
      console.warn(`⚠️ [Playwright Service] ASIN eksik, 400 döndürülüyor`);
      return res.status(400).json({ 
        ok: false, 
        error: 'ASIN is required' 
      });
    }
    
    console.log(`📡 [Playwright Service] Seller info request başlatılıyor: ${asinList[0]} (${asinList.length} ASIN) from ${sourceMarketplace}`);
    console.log(`📊 [Queue] Queue durumu: ${requestQueue.running}/${requestQueue.maxConcurrent} çalışıyor, ${requestQueue.queue.length} bekliyor`);
    
    // KRİTİK: Queue'ya ekle - EAGAIN hatalarını önlemek için
    const result = await requestQueue.add(async () => {
      console.log(`🚀 [Queue] ${asinList[0]} (${asinList.length} ASIN) için seller bilgileri çekiliyor (${requestQueue.running}/${requestQueue.maxConcurrent}, queue: ${requestQueue.queue.length})`);
      try {
        if (asinList.length > 1) {
          return await playwrightService.getSellerInfoBatch(asinList, sourceMarketplace, targetCountry);
        }
        return await playwrightService.getSellerInfo(asinList[0], sourceMarketplace, targetCountry);
      } catch (error) {
        const errorString = error.message || error.toString() || '';
        const isEAGAIN = error.isEAGAIN || 
                        errorString.includes('EAGAIN') || 
                        errorString.includes('Resource temporarily unavailable') ||
                        errorString.includes('spawn') ||
                        errorString.includes('Failed to launch');
        
        if (isEAGAIN) {
          console.error(`❌ [Queue] ${asinList[0]} için seller bilgileri EAGAIN hatası - Railway kaynak limiti aşıldı`);
          const err = new Error(`Railway kaynak limiti aşıldı (EAGAIN). Lütfen birkaç saniye bekleyip tekrar deneyin.`);
          err.isEAGAIN = true;
          err.status = 503;
          throw err;
        }
        throw error;
      }
    });
    
    if (!result || typeof result !== 'object') {
      console.error(`❌ [Playwright Service] Servis yanıtı geçersiz (result: ${typeof result})`);
      const requestDuration = Date.now() - requestStartTime;
      console.log(`⏱️ [Playwright Service] Request süresi: ${requestDuration}ms`);
      console.log(`📥 [Playwright Service] ========== POST /api/sellers REQUEST TAMAMLANDI (HATA) ==========`);
      return res.status(500).json({ ok: false, error: 'No response from seller service' });
    }
    console.log(`📤 [Playwright Service] Seller info response hazırlanıyor:`, {
      success: result.success,
      hasData: !!result.data,
      sellersCount: result.data?.sellers?.length || 0,
      itemsCount: result.data?.items?.length || 0,
      error: result.error || null,
      dataKeys: result.data ? Object.keys(result.data) : [],
      firstSeller: result.data?.sellers?.[0] ? {
        sellerName: result.data.sellers[0].sellerName,
        soldBy: result.data.sellers[0].soldBy,
        price: result.data.sellers[0].price,
        condition: result.data.sellers[0].condition
      } : null
    });
    const requestDuration = Date.now() - requestStartTime;
    console.log(`⏱️ [Playwright Service] Request süresi: ${requestDuration}ms`);
    if (result.success) {
      const responsePayload = { ok: true, data: result.data };
      console.log(`✅ [Playwright Service] ========== POST /api/sellers REQUEST BAŞARILI ==========`);
      console.log(`📤 [Playwright Service] Response payload:`, {
        ok: responsePayload.ok,
        hasData: !!responsePayload.data,
        sellersCount: responsePayload.data?.sellers?.length || 0,
        totalSellers: responsePayload.data?.totalSellers || 0,
        hasBuybox: !!responsePayload.data?.buybox
      });
      res.json(responsePayload);
    } else {
      console.log(`❌ [Playwright Service] ========== POST /api/sellers REQUEST BAŞARISIZ ==========`);
      res.status(result.status || 500).json({ 
        ok: false, 
        error: result.error || 'Failed to get seller information' 
      });
    }
  } catch (error) {
    const requestDuration = Date.now() - requestStartTime;
    console.error(`❌ [Playwright Service] Seller info error:`, error.message);
    console.error(`❌ [Playwright Service] Error stack:`, error.stack);
    console.log(`⏱️ [Playwright Service] Request süresi (hata): ${requestDuration}ms`);
    console.log(`📥 [Playwright Service] ========== POST /api/sellers REQUEST HATA İLE TAMAMLANDI ==========`);
    next(error);
  }
});

/**
 * GET /api/sellers/:asin
 * Get seller information for a product using Playwright (GET method)
 */
router.get('/:asin', async (req, res, next) => {
  try {
    const { asin } = req.params;
    const { marketplace = 'amazon.com', targetCountry } = req.query;
    
    if (!asin) {
      return res.status(400).json({ 
        ok: false, 
        error: 'ASIN is required' 
      });
    }
    
    console.log(`📡 [Playwright Service] Seller info request (GET): ${asin} from ${marketplace}`);
    console.log(`📊 [Queue] Queue durumu: ${requestQueue.running}/${requestQueue.maxConcurrent} çalışıyor, ${requestQueue.queue.length} bekliyor`);
    
    // KRİTİK: Queue'ya ekle - EAGAIN hatalarını önlemek için
    const result = await requestQueue.add(async () => {
      console.log(`🚀 [Queue] ${asin} için seller bilgileri çekiliyor (GET) (${requestQueue.running}/${requestQueue.maxConcurrent}, queue: ${requestQueue.queue.length})`);
      try {
        return await playwrightService.getSellerInfo(asin, marketplace, targetCountry);
      } catch (error) {
        const errorString = error.message || error.toString() || '';
        const isEAGAIN = error.isEAGAIN || 
                        errorString.includes('EAGAIN') || 
                        errorString.includes('Resource temporarily unavailable') ||
                        errorString.includes('spawn') ||
                        errorString.includes('Failed to launch');
        
        if (isEAGAIN) {
          console.error(`❌ [Queue] ${asin} için seller bilgileri EAGAIN hatası (GET) - Railway kaynak limiti aşıldı`);
          const err = new Error(`Railway kaynak limiti aşıldı (EAGAIN). Lütfen birkaç saniye bekleyip tekrar deneyin.`);
          err.isEAGAIN = true;
          err.status = 503;
          throw err;
        }
        throw error;
      }
    });
    
    if (!result || typeof result !== 'object') {
      console.error(`❌ [Playwright Service] Servis yanıtı geçersiz (GET, result: ${typeof result})`);
      return res.status(500).json({ ok: false, error: 'No response from seller service' });
    }
    if (result.success) {
      res.json({ ok: true, data: result.data });
    } else {
      res.status(result.status || 500).json({ 
        ok: false, 
        error: result.error || 'Failed to get seller information' 
      });
    }
  } catch (error) {
    console.error(`❌ [Playwright Service] Seller info error:`, error.message);
    next(error);
  }
});

module.exports = router;
