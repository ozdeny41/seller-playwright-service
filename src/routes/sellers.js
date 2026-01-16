const express = require('express');
const router = express.Router();
const playwrightService = require('../services/playwrightService');

/**
 * POST /api/sellers
 * Get seller information for a product using Playwright
 */
router.post('/', async (req, res, next) => {
  try {
    const { asin, sourceMarketplace = 'amazon.com', targetCountry } = req.body;
    
    console.log(`📥 [Playwright Service] POST /api/sellers request alındı:`, {
      asin: asin,
      sourceMarketplace: sourceMarketplace,
      targetCountry: targetCountry,
      bodyKeys: Object.keys(req.body),
      hasAsin: !!asin
    });
    
    if (!asin) {
      console.warn(`⚠️ [Playwright Service] ASIN eksik, 400 döndürülüyor`);
      return res.status(400).json({ 
        ok: false, 
        error: 'ASIN is required' 
      });
    }
    
    console.log(`📡 [Playwright Service] Seller info request başlatılıyor: ${asin} from ${sourceMarketplace}`);
    const result = await playwrightService.getSellerInfo(asin, sourceMarketplace, targetCountry);
    
    console.log(`📤 [Playwright Service] Seller info response hazırlanıyor:`, {
      success: result.success,
      hasData: !!result.data,
      sellersCount: result.data?.sellers?.length || 0,
      error: result.error || null
    });
    
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
