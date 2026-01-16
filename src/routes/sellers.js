const express = require('express');
const router = express.Router();
const playwrightService = require('../services/playwrightService');

/**
 * POST /api/sellers
 * Get seller information for a product using Playwright
 * Asenkron çalışır - hemen 202 Accepted döner, arka planda işlem yapar
 */
router.post('/', async (req, res, next) => {
  try {
    const { asin, sourceMarketplace = 'amazon.com', targetCountry } = req.body;
    
    if (!asin) {
      return res.status(400).json({ 
        ok: false, 
        error: 'ASIN is required' 
      });
    }
    
    console.log(`📡 [Playwright Service] Seller info request: ${asin} from ${sourceMarketplace}`);
    
    // Hemen 202 Accepted dön, arka planda işlem yap
    res.status(202).json({ 
      ok: true, 
      message: 'Seller bilgileri çekiliyor...',
      asin: asin,
      status: 'processing'
    });
    
    // Arka planda seller bilgilerini çek (non-blocking)
    setImmediate(async () => {
      try {
        const result = await playwrightService.getSellerInfo(asin, sourceMarketplace, targetCountry);
        if (result.success) {
          console.log(`✅ [Playwright Service] Seller info completed: ${asin} - ${result.data.sellers?.length || 0} sellers`);
        } else {
          console.warn(`⚠️ [Playwright Service] Seller info failed: ${asin} - ${result.error}`);
        }
      } catch (error) {
        console.error(`❌ [Playwright Service] Seller info error (background):`, error.message);
      }
    });
  } catch (error) {
    console.error(`❌ [Playwright Service] Seller info error:`, error.message);
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
    const result = await playwrightService.getSellerInfo(asin, marketplace, targetCountry);
    
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
