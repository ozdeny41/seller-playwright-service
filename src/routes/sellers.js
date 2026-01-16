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
    
    if (!asin) {
      return res.status(400).json({ 
        ok: false, 
        error: 'ASIN is required' 
      });
    }
    
    console.log(`📡 [Playwright Service] Seller info request: ${asin} from ${sourceMarketplace}`);
    const result = await playwrightService.getSellerInfo(asin, sourceMarketplace, targetCountry);
    
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
