// Playwright Service - Seller Information Extraction
const { chromium } = require('playwright');

class PlaywrightService {
  constructor() {
    console.log('✅ [Seller Playwright] Initializing (20 sekme, batch bitince tarayıcı kapatılır)...');
    this.browser = null;
    this.browserLaunchPromise = null;
    this.contexts = new Map();
    this.contextSetupStatus = new Map();
    this.pagePools = new Map();
    this.pagePoolIndex = new Map();
    this.pagePoolSize = 20; // 20 sekme - envanter güncellemesi bitene kadar açık
    this.requestCount = 0;
    this.RECYCLE_AFTER_REQUESTS = 50;
  }

  /**
   * Amazon'un HTML/CSS/JavaScript kodlarını temizle
   * @param {string} text - Temizlenecek text
   * @returns {string} - Temizlenmiş text
   */
  cleanAmazonHtml(text) {
    if (!text || typeof text !== 'string') return text || '';
    
    let cleaned = text;
    
    // HTML tag'lerini kaldır
    cleaned = cleaned.replace(/<[^>]*>/g, '');
    
    // HTML entity'leri decode et
    cleaned = cleaned.replace(/&quot;/g, '"');
    cleaned = cleaned.replace(/&amp;/g, '&');
    cleaned = cleaned.replace(/&lt;/g, '<');
    cleaned = cleaned.replace(/&gt;/g, '>');
    cleaned = cleaned.replace(/&nbsp;/g, ' ');
    
    // CSS kodlarını kaldır (/* ... */ ve { ... } blokları)
    cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, ''); // CSS comments
    cleaned = cleaned.replace(/\{[^}]*\}/g, ''); // CSS rules
    
    // JavaScript kodlarını kaldır
    cleaned = cleaned.replace(/\.execute\([^)]*\)/g, ''); // .execute() calls
    cleaned = cleaned.replace(/function\s*\([^)]*\)\s*\{[^}]*\}/g, ''); // function() {}
    cleaned = cleaned.replace(/\(function\s*\([^)]*\)\s*\{[^}]*\}\)/g, ''); // (function() {})
    cleaned = cleaned.replace(/\.execute\('[\w-]+',\s*function\s*\([^)]*\)\s*\{[^}]*\}\)/g, ''); // .execute('a-popover-count', function() {})
    
    // Amazon-specific marketing text'leri kaldır
    cleaned = cleaned.replace(/List Price/gi, '');
    cleaned = cleaned.replace(/savings/gi, '');
    cleaned = cleaned.replace(/Learn more/gi, '');
    cleaned = cleaned.replace(/The is the suggested retail price/gi, '');
    cleaned = cleaned.replace(/may not necessarily reflect/gi, '');
    cleaned = cleaned.replace(/prevailing market price/gi, '');
    cleaned = cleaned.replace(/as provided by a manufacturer/gi, '');
    cleaned = cleaned.replace(/supplier, or seller/gi, '');
    cleaned = cleaned.replace(/Sim: https:\/\/sim\.amazon\.com\/issues\/[^\s]+/gi, ''); // Sim: https://sim.amazon.com/issues/...
    
    // CSS class isimlerini kaldır (nokta ile başlayan)
    cleaned = cleaned.replace(/\.\w+/g, '');
    
    // CSS property'leri kaldır (color:, font-weight:, margin-right:, vb.)
    cleaned = cleaned.replace(/[a-z-]+:\s*[^;]+;?/gi, '');
    
    // "See less" gibi Amazon UI text'lerini kaldır
    cleaned = cleaned.replace(/See less/gi, '').trim();
    cleaned = cleaned.replace(/See more/gi, '').trim();
    
    // Fazla boşlukları temizle
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
    // Boş string kontrolü
    if (!cleaned || cleaned.length === 0) return '';
    
    return cleaned;
  }

  async closeBrowserForRecycle() {
    console.log('🔄 [Seller Playwright] Bellek önleme: browser ve context\'ler kapatılıyor...');
    try {
      for (const [key, ctx] of this.contexts) {
        try {
          if (ctx && typeof ctx.close === 'function') await ctx.close();
        } catch (e) {
          console.warn(`⚠️ [Seller Playwright] Context close hatası (${key}):`, e.message);
        }
      }
      this.contexts.clear();
      this.contextSetupStatus.clear();
      this.pagePools.clear();
      this.pagePoolIndex.clear();
      if (this.browser) {
        try {
          await this.browser.close();
        } catch (e) {
          console.warn('⚠️ [Seller Playwright] Browser close hatası:', e.message);
        }
        this.browser = null;
      }
      this.browserLaunchPromise = null;
      console.log('✅ [Seller Playwright] Browser recycle tamamlandı');
    } catch (e) {
      console.error('❌ [Seller Playwright] closeBrowserForRecycle hatası:', e.message);
    }
  }

  async recordRequestAndMaybeRecycle() {
    this.requestCount++;
    if (this.requestCount >= this.RECYCLE_AFTER_REQUESTS) {
      await this.closeBrowserForRecycle();
      this.requestCount = 0;
    }
  }

  getContextKey(sourceMarketplace, targetCountryCode) {
    return `${sourceMarketplace}_${targetCountryCode || 'default'}`;
  }

  /**
   * "Target page, context or browser has been closed" hatası geldiğinde state temizle.
   * Eşzamanlı isteklerde batch tarayıcıyı kapatırken diğer istek kapalı browser kullanmaya çalışabilir.
   */
  clearBrowserStateOnClosedError(err) {
    if (err && err.message && (String(err.message).includes('closed') || String(err.message).includes('Target'))) {
      console.warn('⚠️ [Seller Playwright] Browser/context kapalı tespit edildi, state temizleniyor...');
      this.browser = null;
      this.browserLaunchPromise = null;
      this.contexts.clear();
      this.contextSetupStatus.clear();
      this.pagePools.clear();
      this.pagePoolIndex.clear();
      return true;
    }
    return false;
  }

  async getBrowser() {
    const globalInstall = global.__browserInstallationPromise;
    if (globalInstall) {
      try { await globalInstall; } catch (e) { console.warn('⚠️ [Seller Playwright] Tarayıcı kurulum beklemesi hatası:', e.message); }
    }
    if (this.browser) {
      try {
        if (this.browser.isConnected()) return this.browser;
        this.browser = null;
      } catch (e) { this.browser = null; }
    }
    if (this.browserLaunchPromise) return await this.browserLaunchPromise;
    this.browserLaunchPromise = this._launchBrowser();
    try {
      this.browser = await this.browserLaunchPromise;
      return this.browser;
    } finally {
      this.browserLaunchPromise = null;
    }
  }

  async _launchBrowser() {
    console.log('🌐 [Seller Playwright] Browser başlatılıyor (bir kere, reuse edilecek)...');
    const opts = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-blink-features=AutomationControlled', '--single-process', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
      timeout: 60000
    };
    const browser = await chromium.launch(opts);
    console.log('✅ [Seller Playwright] Browser başlatıldı (reuse için açık kalacak)');
    return browser;
  }

  async getOrCreateContext(sourceMarketplace, targetCountryCode) {
    const key = this.getContextKey(sourceMarketplace, targetCountryCode);
    if (this.contexts.has(key)) {
      const ctx = this.contexts.get(key);
      try {
        if (ctx && ctx.browser() && ctx.browser().isConnected()) {
          ctx.pages();
          if (this.contextSetupStatus.get(key)) {
            console.log(`♻️ [Seller Playwright] Context reuse: ${key}`);
            return ctx;
          }
        }
      } catch (e) { /* invalid */ }
      this.contexts.delete(key);
      this.contextSetupStatus.delete(key);
      this.pagePools.delete(key);
      this.pagePoolIndex.delete(key);
    }

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const browser = await this.getBrowser();
        console.log(`📄 [Seller Playwright] Context oluşturuluyor: ${key}${attempt > 1 ? ` (retry ${attempt}/2)` : ''}`);
        const context = await browser.newContext({
          viewport: { width: 1920, height: 1080 },
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          locale: 'en-US',
          timezoneId: 'America/New_York'
        });
        const marketplaceDomain = { 'amazon.com': 'www.amazon.com', 'amazon.co.uk': 'www.amazon.co.uk', 'amazon.de': 'www.amazon.de', 'amazon.es': 'www.amazon.es', 'amazon.it': 'www.amazon.it', 'amazon.fr': 'www.amazon.fr', 'amazon.co.jp': 'www.amazon.co.jp' };
        const baseUrl = `https://${marketplaceDomain[sourceMarketplace] || 'www.amazon.com'}`;

        // KRİTİK: targetCountry yoksa setup atla — direkt AOD'a gidilecek, Amazon ana sayfa yüklemesi gereksiz (timeout/captcha riski)
        if (!targetCountryCode) {
          console.log(`⚡ [Seller Playwright] targetCountry yok, setup atlanıyor — direkt AOD kullanılacak`);
        } else {
          const setupPage = await context.newPage();
          console.log(`🌐 [Seller Playwright] Setup sayfası açılıyor: ${baseUrl}`);
          try {
            await setupPage.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            console.log(`✅ [Seller Playwright] Setup sayfası yüklendi`);
          } catch (gotoErr) {
            console.error(`❌ [Seller Playwright] Setup sayfası yükleme hatası: ${gotoErr.message}`);
            await setupPage.close().catch(() => {});
            throw gotoErr;
          }
          await this.safeWait(setupPage, 2000);
          console.log(`🌍 [Seller Playwright] Ülke ve para birimi seçimi başlatılıyor: ${targetCountryCode}`);
          const res = await this.selectCountryAndCurrency(setupPage, targetCountryCode, sourceMarketplace, baseUrl);
          if (!res.success) console.warn('⚠️ [Seller Playwright] Context ülke seçimi başarısız:', res.error);
          else console.log(`✅ [Seller Playwright] Ülke/para birimi seçimi tamamlandı`);
          await setupPage.close().catch(() => {});
        }
        this.contexts.set(key, context);
        this.contextSetupStatus.set(key, true);
        console.log(`✅ [Seller Playwright] Yeni context: ${key}`);
        return context;
      } catch (err) {
        if (this.clearBrowserStateOnClosedError(err) && attempt < 2) {
          console.log(`🔄 [Seller Playwright] Context oluşturma hatası (closed), yeniden deneniyor...`);
          continue;
        }
        throw err;
      }
    }
  }

  async getPagePool(sourceMarketplace, targetCountryCode) {
    const key = this.getContextKey(sourceMarketplace, targetCountryCode);
    if (this.pagePools.has(key)) {
      const pages = (this.pagePools.get(key) || []).filter(p => p && !p.isClosed());
      if (pages.length === this.pagePoolSize) {
        console.log(`♻️ [Seller Playwright] Page pool reuse: ${key} (${pages.length} sekme)`);
        return pages;
      }
      (this.pagePools.get(key) || []).forEach(p => p.close().catch(() => {}));
    }

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const ctx = await this.getOrCreateContext(sourceMarketplace, targetCountryCode);
        const pages = [];
        for (let i = 0; i < this.pagePoolSize; i++) {
          pages.push(await ctx.newPage());
        }
        this.pagePools.set(key, pages);
        this.pagePoolIndex.set(key, 0);
        console.log(`✅ [Seller Playwright] ${this.pagePoolSize} sekme açıldı: ${key}`);
        return pages;
      } catch (err) {
        if (this.clearBrowserStateOnClosedError(err) && attempt < 2) {
          console.log(`🔄 [Seller Playwright] Page pool hatası (closed), yeniden deneniyor...`);
          continue;
        }
        throw err;
      }
    }
  }

  getNextPage(pages, key) {
    let idx = this.pagePoolIndex.get(key) || 0;
    const page = pages[idx];
    this.pagePoolIndex.set(key, (idx + 1) % this.pagePoolSize);
    return page;
  }

  /**
   * Safe wait function - checks if page is still valid before waiting
   */
  async safeWait(page, ms) {
    try {
      if (page && !page.isClosed()) {
        await page.waitForTimeout(ms);
      }
    } catch (e) {
      console.warn(`⚠️ [Playwright] Safe wait error: ${e.message}`);
    }
  }

  /**
   * Get country name from country code
   */
  getCountryName(countryCode) {
    const map = {
      'US': 'United States',
      'USA': 'United States',
      'UK': 'United Kingdom',
      'GB': 'United Kingdom',
      'DE': 'Germany',
      'FR': 'France',
      'IT': 'Italy',
      'ES': 'Spain',
      'NL': 'Netherlands',
      'BE': 'Belgium',
      'SE': 'Sweden',
      'PL': 'Poland',
      'IE': 'Ireland',
      'TR': 'Turkey',
      'JP': 'Japan',
      'CN': 'China',
      'IN': 'India',
      'AU': 'Australia',
      'SG': 'Singapore',
      'AE': 'United Arab Emirates',
      'SA': 'Saudi Arabia',
      'EG': 'Egypt',
      'BR': 'Brazil',
      'CA': 'Canada',
      'MX': 'Mexico'
    };
    return map[countryCode] || countryCode;
  }

  /**
   * Convert navbar country code to Amazon country code
   * KRİTİK: amazon.co.uk, amazon.de gibi domain'ler de kabul edilir
   */
  convertToAmazonCountryCode(countryCode) {
    if (!countryCode || typeof countryCode !== 'string') return 'US';
    const raw = countryCode.toString().trim().toLowerCase();
    const map = {
      'usa': 'US', 'us': 'US', 'america': 'US', 'united states': 'US', 'amazon.com': 'US',
      'uk': 'GB', 'gb': 'GB', 'amazon.co.uk': 'GB',
      'germany': 'DE', 'de': 'DE', 'amazon.de': 'DE',
      'france': 'FR', 'fr': 'FR', 'amazon.fr': 'FR',
      'italy': 'IT', 'it': 'IT', 'amazon.it': 'IT',
      'spain': 'ES', 'es': 'ES', 'amazon.es': 'ES',
      'japan': 'JP', 'jp': 'JP', 'amazon.co.jp': 'JP',
      'canada': 'CA', 'ca': 'CA', 'amazon.ca': 'CA',
      'australia': 'AU', 'au': 'AU', 'amazon.com.au': 'AU',
      'netherlands': 'NL', 'nl': 'NL', 'belgium': 'BE', 'be': 'BE', 'amazon.nl': 'NL',
      'singapore': 'SG', 'sg': 'SG', 'mexico': 'MX', 'mx': 'MX', 'amazon.com.mx': 'MX',
      'india': 'IN', 'in': 'IN', 'amazon.in': 'IN',
      'turkey': 'TR', 'tr': 'TR', 'amazon.com.tr': 'TR',
      'poland': 'PL', 'pl': 'PL', 'amazon.pl': 'PL',
      'sweden': 'SE', 'se': 'SE', 'amazon.se': 'SE'
    };
    return map[raw] || (raw.length === 2 ? raw.toUpperCase() : 'US');
  }

  /**
   * Select country and currency using Playwright (from other Playwright service)
   * @param {Object} page - Playwright page object
   * @param {string} targetCountryCode - Target country code (US, UK, DE, etc.)
   * @param {string} sourceMarketplace - Source marketplace (amazon.com, amazon.de, etc.)
   * @param {string} asinUrl - ASIN URL (optional)
   * @returns {Promise<{success: boolean, error: string | null}>}
   */
  async selectCountryAndCurrency(page, targetCountryCode, sourceMarketplace = 'amazon.com', asinUrl = null) {
    try {
      // Navbar'dan gelen country code'u Amazon country code'a çevir
      const amazonCountryCode = this.convertToAmazonCountryCode(targetCountryCode);
      const targetCountryName = this.getCountryName(amazonCountryCode);
      console.log(`🎭 [Playwright] Ülke seçimi başlatılıyor: ${targetCountryCode} -> ${amazonCountryCode} (${targetCountryName})`);

      // KRİTİK: Kaynak marketplace zaten hedef ülkeyse ülke seçimini atla (amazon.co.uk + uk gibi)
      const marketplaceToCountry = {
        'amazon.com': 'US', 'amazon.co.uk': 'GB', 'amazon.de': 'DE', 'amazon.fr': 'FR',
        'amazon.it': 'IT', 'amazon.es': 'ES', 'amazon.co.jp': 'JP', 'amazon.ca': 'CA'
      };
      const sourceCountry = marketplaceToCountry[sourceMarketplace];
      if (sourceCountry && amazonCountryCode === sourceCountry) {
        console.log(`✅ [Playwright] Kaynak marketplace zaten hedef ülke (${sourceMarketplace} = ${amazonCountryCode}), ülke seçimi atlanıyor`);
        return { success: true };
      }
      
      // Para birimi seçimi - Kaynak mağazaya göre para birimi seçilmeli
      const marketplaceCurrency = {
        'amazon.com': 'USD',
        'amazon.co.uk': 'GBP',
        'amazon.de': 'EUR',
        'amazon.es': 'EUR',
        'amazon.it': 'EUR',
        'amazon.fr': 'EUR',
        'amazon.co.jp': 'JPY'
      };
      
      const targetCurrency = marketplaceCurrency[sourceMarketplace] || 'USD';
      console.log(`💵 [Playwright] Para birimi seçimi başlatılıyor: ${targetCurrency} (source: ${sourceMarketplace})`);
      
      // Marketplace domain mapping
      const marketplaceDomain = {
        'amazon.com': 'www.amazon.com',
        'amazon.co.uk': 'www.amazon.co.uk',
        'amazon.de': 'www.amazon.de',
        'amazon.es': 'www.amazon.es',
        'amazon.it': 'www.amazon.it',
        'amazon.fr': 'www.amazon.fr',
        'amazon.co.jp': 'www.amazon.co.jp'
      };
      
      const baseDomain = marketplaceDomain[sourceMarketplace] || 'www.amazon.com';
      const baseUrl = `https://${baseDomain}`;
      console.log(`🌐 [Playwright] Marketplace domain: ${baseUrl} (source: ${sourceMarketplace})`);
      
      // KRİTİK: Sayfa yüklendikten sonra ekstra bekleme - kısaltıldı
      await this.safeWait(page, 1000); // 3s -> 1s
      console.log(`⏳ [Playwright] Sayfa yükleme sonrası bekleme tamamlandı, captcha kontrolü yapılıyor...`);

      // KRİTİK: Amazon captcha sayfası kontrolü - eğer captcha sayfasındaysa "Continue shopping" butonuna tıkla
      try {
        // Captcha sayfası göstergeleri - birden fazla kontrol
        const currentUrl = page.url();
        const isCaptchaPage = currentUrl.includes('/errors/validateCaptcha');
        const captchaForm = await page.$('form[action="/errors/validateCaptcha"]').catch(() => null);
        
        // Continue shopping butonunu bul - farklı selector'lar dene
        let continueShoppingButton = null;
        const buttonSelectors = [
          'button[alt="Continue shopping"]',
          'form[action="/errors/validateCaptcha"] button[type="submit"]',
          'form[action="/errors/validateCaptcha"] button',
          'button:has-text("Continue shopping")',
          'button[type="submit"]'
        ];
        
        for (const selector of buttonSelectors) {
          try {
            continueShoppingButton = await page.$(selector).catch(() => null);
            if (continueShoppingButton) {
              const buttonText = await continueShoppingButton.textContent().catch(() => '');
              if (buttonText && (buttonText.includes('Continue') || buttonText.includes('shopping') || selector.includes('submit'))) {
                console.log(`✅ [Playwright] Continue shopping butonu bulundu: ${selector}`);
                break;
              }
            }
          } catch (e) {
            continue;
          }
        }
        
        // Text içeriğini de kontrol et
        const captchaText = await page.textContent('body').catch(() => '');
        const hasCaptchaText = captchaText.includes('Click the button below to continue shopping') || 
                              captchaText.includes('continue shopping') ||
                              captchaText.includes('Continue shopping');
        
        if (captchaForm || isCaptchaPage || continueShoppingButton || hasCaptchaText) {
          console.log(`⚠️ [Playwright] Amazon captcha sayfası tespit edildi (form: ${!!captchaForm}, URL: ${isCaptchaPage}, button: ${!!continueShoppingButton}, text: ${hasCaptchaText}), "Continue shopping" butonuna tıklanıyor...`);
          
          if (continueShoppingButton) {
            try {
              await continueShoppingButton.scrollIntoViewIfNeeded();
              await this.safeWait(page, 500);
              await continueShoppingButton.click({ timeout: 30000 });
              console.log(`✅ [Playwright] "Continue shopping" butonuna tıklandı, sayfa yüklenmesi bekleniyor...`);
              
              // Sayfa yüklenmesini bekle - timeout kısaltıldı
              await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => { // 10s -> 30s (504 önleme)
                console.warn(`⚠️ [Playwright] Network idle bekleme timeout, devam ediliyor...`);
              });
              await this.safeWait(page, 2000); // 5s -> 2s
              
              // Sayfa URL'ini tekrar kontrol et - eğer hala captcha sayfasındaysa tekrar dene
              const newUrl = page.url();
              if (newUrl.includes('/errors/validateCaptcha')) {
                console.warn(`⚠️ [Playwright] Hala captcha sayfasında, tekrar deneniyor...`);
                await this.safeWait(page, 3000);
                
                // Tekrar butonu bul ve tıkla
                for (const selector of buttonSelectors) {
                  try {
                    const retryButton = await page.$(selector).catch(() => null);
                    if (retryButton) {
                      const buttonText = await retryButton.textContent().catch(() => '');
                      if (buttonText && (buttonText.includes('Continue') || buttonText.includes('shopping'))) {
                        await retryButton.click({ timeout: 30000 });
                        await this.safeWait(page, 5000);
                        console.log(`✅ [Playwright] Retry butonuna tıklandı`);
                        break;
                      }
                    }
                  } catch (e) {
                    continue;
                  }
                }
              } else {
                console.log(`✅ [Playwright] Captcha sayfasından çıkıldı, normal sayfaya yönlendirildi: ${newUrl}`);
              }
            } catch (captchaClickError) {
              console.warn(`⚠️ [Playwright] Captcha butonuna tıklama hatası: ${captchaClickError.message}`);
              // JavaScript ile tıklamayı dene
              try {
                const clicked = await page.evaluate(() => {
                  const form = document.querySelector('form[action="/errors/validateCaptcha"]');
                  if (form) {
                    const btn = form.querySelector('button[type="submit"]') || 
                               form.querySelector('button');
                    if (btn) {
                      btn.click();
                      return true;
                    }
                  }
                  return false;
                });
                if (clicked) {
                  await this.safeWait(page, 5000);
                  console.log(`✅ [Playwright] Captcha butonuna JavaScript ile tıklandı`);
                }
              } catch (jsError) {
                console.warn(`⚠️ [Playwright] JavaScript click de başarısız: ${jsError.message}`);
              }
            }
          } else if (captchaForm || isCaptchaPage) {
            // Buton bulunamadı ama captcha sayfasındayız, form submit et
            console.warn(`⚠️ [Playwright] Continue shopping butonu bulunamadı, form submit deneniyor...`);
            try {
              await page.evaluate(() => {
                const form = document.querySelector('form[action="/errors/validateCaptcha"]');
                if (form) form.submit();
              });
              await this.safeWait(page, 5000);
              console.log(`✅ [Playwright] Captcha formu submit edildi`);
            } catch (submitError) {
              console.warn(`⚠️ [Playwright] Form submit hatası: ${submitError.message}`);
            }
          }
        } else {
          console.log(`ℹ️ [Playwright] Captcha sayfası tespit edilmedi, normal akışa devam ediliyor...`);
        }
      } catch (captchaCheckError) {
        // Captcha kontrolü başarısız, normal akışa devam et
        console.log(`ℹ️ [Playwright] Captcha kontrolü yapılamadı, normal akışa devam ediliyor: ${captchaCheckError.message}`);
      }

      // "Deliver to" butonunu bul ve tıkla - DOM Path: #nav-global-location-popover-link
      // KRİTİK: Sayfa yüklendikten sonra ekstra bekleme - kısaltıldı
      await this.safeWait(page, 1000); // 3s -> 1s
      console.log(`⏳ [Playwright] Sayfa yükleme sonrası ekstra bekleme tamamlandı, "Deliver to" butonu aranıyor...`);
      
      // Network idle olmasını bekle (sayfa tam yüklensin) - timeout'u kısalt
      try {
        await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => { // 5s -> 20s (504 önleme)
          console.warn(`⚠️ [Playwright] Network idle bekleme timeout, devam ediliyor...`);
        });
      } catch (e) {
        console.warn(`⚠️ [Playwright] Network idle hatası: ${e.message}`);
      }
      await this.safeWait(page, 1000); // 3s -> 1s
      
      // KRİTİK: Sayfa title'ını kontrol et - eğer "Amazon.com" ise sayfa tam yüklenmemiş olabilir
      let pageTitle = await page.title().catch(() => '');
      let retryCount = 0;
      const maxTitleRetries = 3;
      
      // KRİTİK: Retry mekanizmasını kaldır - çok uzun sürüyor, sadece 1 kez kontrol et
      if (pageTitle === 'Amazon.com' || pageTitle === 'Amazon' || !pageTitle) {
        console.warn(`⚠️ [Playwright] Sayfa title sadece "Amazon.com" - sayfa tam yüklenmemiş olabilir, ekstra bekleme...`);
        await this.safeWait(page, 2000); // 5s -> 2s
        
        // Sayfayı yeniden yükle (sadece 1 kez)
        try {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }); // 60s -> 30s
          await this.safeWait(page, 2000); // 5s -> 2s
          console.log(`✅ [Playwright] Sayfa yeniden yüklendi`);
          
          // Title'ı tekrar kontrol et
          pageTitle = await page.title().catch(() => '');
          if (pageTitle !== 'Amazon.com' && pageTitle !== 'Amazon' && pageTitle) {
            console.log(`✅ [Playwright] Sayfa title düzeldi: "${pageTitle}"`);
          }
        } catch (reloadError) {
          console.warn(`⚠️ [Playwright] Sayfa reload hatası: ${reloadError.message}`);
        }
      }
      
      // KRİTİK: Eğer hala title "Amazon.com" ise, sayfanın tam yüklenmesi için ekstra bekleme - kısaltıldı
      if (pageTitle === 'Amazon.com' || pageTitle === 'Amazon' || !pageTitle) {
        console.warn(`⚠️ [Playwright] Sayfa title hala "Amazon.com" - sayfa tam yüklenmemiş olabilir, ekstra bekleme ve scroll...`);
        await this.safeWait(page, 3000); // 10s -> 3s
        
        // Sayfayı scroll et - navbar'ın yüklenmesi için
        try {
          await page.evaluate(() => {
            window.scrollTo(0, 0);
          });
          await this.safeWait(page, 1000); // 2s -> 1s
          await page.evaluate(() => {
            window.scrollTo(0, 100);
          });
          await this.safeWait(page, 1000); // 2s -> 1s
          console.log(`✅ [Playwright] Sayfa scroll edildi (navbar yüklenmesi için)`);
        } catch (scrollError) {
          console.warn(`⚠️ [Playwright] Scroll hatası: ${scrollError.message}`);
        }
      }
      
      console.log(`🎭 [Playwright] "Deliver to" butonu aranıyor...`);
      const deliverToSelectors = [
        '#nav-global-location-popover-link', // Öncelikli selector (tüm Amazon sitelerinde aynı)
        'a#nav-global-location-popover-link',
        'span#nav-global-location-popover-link',
        'a[data-csa-c-type="button"][id*="nav-global-location"]',
        'a[id*="nav-global-location"]',
        'span[id*="nav-global-location"]',
        'a[aria-label*="Deliver to"]',
        'span[aria-label*="Deliver to"]',
        'a[aria-label*="Lieferung"]',
        'span[aria-label*="Lieferung"]',
        'a[aria-label*="Livraison"]',
        'span[aria-label*="Livraison"]',
        'a[aria-label*="Envío"]',
        'span[aria-label*="Envío"]',
        'a[aria-label*="Spedizione"]',
        'span[aria-label*="Spedizione"]',
        'a:has-text("Deliver to")',
        'span:has-text("Deliver to")',
        '#nav-global-location-slot',
        '[data-csa-c-slot-id="nav-global-location"]',
        'a[href*="glow=change-country"]',
        'span[data-action="a-popover-trigger"]',
        // Fallback: PDP içindeki delivery/location tetikleyicileri (navbar bazen render olmuyor)
        '#contextualIngressPt',
        '#contextualIngressPtLabel',
        '#contextualIngressPtLabel_deliveryShortLine',
        '#contextualIngressPtLabel_deliveryLongLine',
        '[data-action*="GLUX"]'
      ];
      
      let deliverToButton = null;
      let foundSelector = null;
      
      // Önce tüm selector'ları dene (visible olmasa bile)
      for (const selector of deliverToSelectors) {
        try {
          const element = await page.$(selector);
          if (element) {
            const isVisible = await element.isVisible().catch(() => false);
            if (isVisible) {
              deliverToButton = element;
              foundSelector = selector;
              console.log(`✅ [Playwright] "Deliver to" butonu bulundu (visible): ${selector}`);
              break;
            } else {
              // Visible değilse de sakla, belki scroll ile görünür olur
              if (!deliverToButton) {
                deliverToButton = element;
                foundSelector = selector;
                console.log(`⚠️ [Playwright] "Deliver to" butonu bulundu (hidden): ${selector}`);
              }
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      // Eğer hala bulunamadıysa, waitForSelector ile bekle
      if (!deliverToButton) {
        console.log(`⏳ [Playwright] "Deliver to" butonu hemen bulunamadı, bekleniyor...`);
        
        // KRİTİK: Sayfayı scroll et - navbar'ın görünür olması için
        try {
          await page.evaluate(() => {
            window.scrollTo(0, 0);
          });
          await this.safeWait(page, 2000);
          console.log(`✅ [Playwright] Sayfa scroll edildi (navbar görünürlüğü için)`);
        } catch (scrollError) {
          console.warn(`⚠️ [Playwright] Scroll hatası: ${scrollError.message}`);
        }
        
        for (const selector of deliverToSelectors.slice(0, 5)) { // İlk 5 selector'ı bekle
          try {
            await page.waitForSelector(selector, { timeout: 20000, state: 'attached' });
            deliverToButton = await page.$(selector);
            if (deliverToButton) {
              foundSelector = selector;
              console.log(`✅ [Playwright] "Deliver to" butonu beklenerek bulundu: ${selector}`);
              break;
            }
          } catch (e) {
            continue;
          }
        }
      }
      
      // KRİTİK: Eğer hala bulunamadıysa, sayfanın tam yüklenmesi için ekstra bekleme ve tekrar dene
      if (!deliverToButton) {
        console.log(`⏳ [Playwright] "Deliver to" butonu hala bulunamadı, sayfa tam yüklenmesi için ekstra bekleme...`);
        
        // KRİTİK: Navbar'ın render olması için sayfayı scroll et ve bekle
        try {
          await page.evaluate(() => {
            window.scrollTo(0, 0);
          });
          await this.safeWait(page, 2000);
          
          // Navbar container'ının yüklenmesini bekle
          try {
            await page.waitForSelector('#nav-global-location-slot, #nav-belt, #navbar', { 
              timeout: 15000, 
              state: 'attached' 
            });
            console.log(`✅ [Playwright] Navbar container yüklendi`);
          } catch (e) {
            console.warn(`⚠️ [Playwright] Navbar container bekleme timeout`);
          }
          
          await this.safeWait(page, 3000);
          
          // JavaScript ile navbar'ı kontrol et
          const navbarExists = await page.evaluate(() => {
            const navbar = document.querySelector('#nav-global-location-popover-link');
            return navbar !== null;
          });
          
          if (navbarExists) {
            console.log(`✅ [Playwright] Navbar JavaScript ile tespit edildi, tekrar aranıyor...`);
          }
        } catch (scrollError) {
          console.warn(`⚠️ [Playwright] Scroll/check hatası: ${scrollError.message}`);
        }
        
        await this.safeWait(page, 5000);
        
        // Tüm selector'ları tekrar dene
        try {
          for (const selector of deliverToSelectors) {
            try {
              const element = await page.$(selector);
              if (element) {
                const isVisible = await element.isVisible().catch(() => false);
                if (isVisible || !deliverToButton) {
                  deliverToButton = element;
                  foundSelector = selector;
                  console.log(`✅ [Playwright] "Deliver to" butonu ekstra bekleme sonrası bulundu: ${selector}`);
                  break;
                }
              }
            } catch (e) {
              continue;
            }
          }
        } catch (retryError) {
          console.warn(`⚠️ [Playwright] Ekstra bekleme ve retry hatası: ${retryError.message}`);
        }
      }
      
      // Son çare: Sayfa içeriğinde "Deliver to" (veya dil karşılığı) text'ini ara
      if (!deliverToButton) {
        const deliverToTexts = ['Deliver to', 'Lieferung an', 'Livraison à', 'Envío a', 'Spedizione a', '配達先'];
        console.log(`🔍 [Playwright] "Deliver to" butonu selector'larla bulunamadı, sayfa içeriğinde aranıyor...`);
        try {
          const allLinks = await page.$$('a, span, button');
          for (const link of allLinks) {
            try {
              const text = (await link.textContent()) || '';
              const ariaLabel = (await link.getAttribute('aria-label')) || '';
              const combined = `${text} ${ariaLabel}`;
              if (deliverToTexts.some(t => combined.includes(t))) {
                deliverToButton = link;
                foundSelector = 'text-content-search';
                console.log(`✅ [Playwright] "Deliver to" butonu text içeriğinden bulundu`);
                break;
              }
            } catch (e) {
              continue;
            }
          }
        } catch (e) {
          console.warn(`⚠️ [Playwright] Text içeriği arama hatası: ${e.message}`);
        }
      }
      
      if (!deliverToButton) {
        // Sayfa screenshot al (debug için)
        try {
          const screenshot = await page.screenshot({ fullPage: false });
          console.error(`❌ [Playwright] Sayfa screenshot alındı (Deliver to butonu bulunamadı)`);
        } catch (e) {
          console.warn(`⚠️ [Playwright] Screenshot alınamadı: ${e.message}`);
        }
        
        // Sayfa HTML'inin bir kısmını logla
        try {
          const bodyHTML = await page.evaluate(() => document.body.innerHTML.substring(0, 5000));
          console.error(`❌ [Playwright] Sayfa HTML (ilk 5000 karakter):`, bodyHTML);
        } catch (e) {
          console.warn(`⚠️ [Playwright] HTML alınamadı: ${e.message}`);
        }
        
        throw new Error(`Deliver to button not found after exhaustive search. Page title: "${await page.title()}"`);
      }
      
      // "Deliver to" butonuna tıkla
      try {
        // Butonun görünür olmasını sağla
        const isVisible = await deliverToButton.isVisible().catch(() => false);
        if (!isVisible) {
          console.log(`⚠️ [Playwright] "Deliver to" butonu görünür değil, scroll yapılıyor...`);
          await deliverToButton.scrollIntoViewIfNeeded();
          await this.safeWait(page, 2000);
        }
        
        // Butonun tıklanabilir olmasını bekle
        await page.waitForSelector(foundSelector || deliverToSelectors[0], { 
          timeout: 10000, 
          state: 'visible' 
        }).catch(() => {
          console.warn(`⚠️ [Playwright] Buton visible state bekleme timeout, devam ediliyor...`);
        });
        
        await this.safeWait(page, 1000);
        
        // Normal click dene
        try {
          await deliverToButton.click({ timeout: 30000 });
          console.log(`✅ [Playwright] "Deliver to" butonuna tıklandı (normal click)`);
        } catch (normalClickError) {
          console.warn(`⚠️ [Playwright] Normal click başarısız, force click deneniyor: ${normalClickError.message}`);
          await deliverToButton.click({ force: true, timeout: 30000 });
          console.log(`✅ [Playwright] "Deliver to" butonuna tıklandı (force click)`);
        }
        
        await this.safeWait(page, 3000);
      } catch (clickError) {
        console.error(`❌ [Playwright] "Deliver to" butonuna tıklama hatası: ${clickError.message}`);
        // JavaScript ile click dene
        try {
          await page.evaluate((selector) => {
            const element = document.querySelector(selector);
            if (element) {
              element.click();
            }
          }, foundSelector || deliverToSelectors[0]);
          console.log(`✅ [Playwright] "Deliver to" butonuna JavaScript ile tıklandı`);
          await this.safeWait(page, 3000);
        } catch (jsClickError) {
          throw new Error(`Deliver to button click failed: ${clickError.message}. JS click also failed: ${jsClickError.message}`);
        }
      }
      
      // Popover açılmasını bekle
      console.log(`🎭 [Playwright] Popover açılması bekleniyor...`);
      // KRİTİK: Popover açılmasını bekle (#a-popover-3 veya #a-popover-4) - timeout kısaltıldı
      try {
        await page.waitForSelector('#a-popover-3, #a-popover-4, .a-popover-wrapper, #GLUX_Popover', { timeout: 8000, state: 'visible' }); // 5s -> 8s (504 önleme)
        console.log(`✅ [Playwright] Popover açıldı`);
      } catch (popoverError) {
        console.warn(`⚠️ [Playwright] Popover selector bulunamadı, devam ediliyor...`);
      }
      await this.safeWait(page, 1000); // 2s -> 1s
      
      // Ülke dropdown'unu bul ve aç
      console.log(`🎭 [Playwright] Ülke dropdown'u aranıyor: ${targetCountryCode}...`);
      const dropdownSelectors = [
        '#GLUXCountryListDropdown',
        'span#GLUXCountryListDropdown',
        'span.a-button-text[data-action="a-dropdown-button"]',
        '#GLUXCountryList'
      ];
      
      let countryDropdown = null;
      for (const selector of dropdownSelectors) {
        try {
          countryDropdown = await page.waitForSelector(selector, { timeout: 8000, state: 'visible' }); // 5s -> 8s (504 önleme)
          if (countryDropdown) {
            console.log(`✅ [Playwright] Ülke dropdown bulundu: ${selector}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!countryDropdown) {
        throw new Error('Country dropdown not found');
      }
      
      // Dropdown'u aç (tıkla) - timeout kısaltıldı
      try {
        await countryDropdown.click({ timeout: 10000 }); // 30s -> 10s
        await this.safeWait(page, 1000); // 2s -> 1s
        console.log(`✅ [Playwright] Dropdown açıldı`);
      } catch (clickError) {
        console.warn(`⚠️ [Playwright] Dropdown click başarısız, force click deneniyor: ${clickError.message}`);
        await countryDropdown.click({ force: true, timeout: 10000 }); // 30s -> 10s
        await this.safeWait(page, 1000); // 2s -> 1s
      }
      
      // KRİTİK: Dropdown açıldıktan sonra ülkenin baş harfine basarak filtreleme yap
      // amazon.de, amazon.fr vb. sitelerde ülke adları farklı dilde — locale-aware ilk harf kullan
      let firstLetter = null;
      const localeFirstLetter = {
        'amazon.de': { GB: 'V', US: 'V', DE: 'D', FR: 'F', ES: 'S', IT: 'I', JP: 'J', NL: 'N' },
        'amazon.fr': { GB: 'R', US: 'E', DE: 'A', FR: 'F', ES: 'E', IT: 'I', JP: 'J', NL: 'P' },
        'amazon.es': { GB: 'R', US: 'E', DE: 'A', FR: 'F', ES: 'E', IT: 'I', JP: 'J', NL: 'P' },
        'amazon.it': { GB: 'R', US: 'S', DE: 'G', FR: 'F', ES: 'S', IT: 'I', JP: 'G', NL: 'P' },
        'amazon.co.jp': { GB: 'イ', US: 'ア', DE: 'ド', FR: 'フ', ES: 'ス', IT: 'イ', JP: '日', NL: 'オ' }
      };
      const mpMap = localeFirstLetter[sourceMarketplace];
      if (mpMap && mpMap[amazonCountryCode]) {
        firstLetter = mpMap[amazonCountryCode];
        console.log(`🌍 [Playwright] Locale-aware baş harf: "${firstLetter}" (${sourceMarketplace}, ${amazonCountryCode})`);
      } else if (targetCountryName) {
        firstLetter = targetCountryName.charAt(0).toUpperCase();
        console.log(`🌍 [Playwright] TargetCountryName'den baş harf: "${firstLetter}" (${targetCountryName})`);
      }
      
      // Dropdown açıldıktan sonra ülkenin baş harfine bas
      if (firstLetter) {
        try {
          // KRİTİK: Popover içindeki liste görünür olana kadar bekle - timeout kısaltıldı
          await page.waitForSelector('#a-popover-4 ul.a-list-item, ul.a-list-item', { timeout: 8000, state: 'visible' }).catch(() => { // 3s -> 8s (504 önleme)
            console.warn(`⚠️ [Playwright] Liste hemen görünür olmadı, devam ediliyor...`);
          });
          await this.safeWait(page, 300); // 500ms -> 300ms
          
          // KRİTİK: Popover içine focus yap (klavye input'unun çalışması için)
          try {
            const popover = await page.$('#a-popover-4');
            if (popover) {
              await popover.focus();
              await this.safeWait(page, 200); // 300ms -> 200ms
            }
          } catch (focusError) {
            console.warn(`⚠️ [Playwright] Popover focus başarısız: ${focusError.message}`);
          }
          
          // Ülkenin baş harfine bas
          await page.keyboard.press(firstLetter);
          await this.safeWait(page, 800); // 1500ms -> 800ms (filtreleme için daha kısa bekle)
          console.log(`⌨️ [Playwright] Dropdown açıldı, "${firstLetter}" harfine basıldı, ülke filtreleniyor...`);
        } catch (keyboardError) {
          console.warn(`⚠️ [Playwright] Keyboard press hatası: ${keyboardError.message}, devam ediliyor...`);
        }
      } else {
        console.warn(`⚠️ [Playwright] Baş harf bulunamadı, filtreleme yapılmadan devam ediliyor...`);
      }
      
      // Ülke seçeneğini bul ve tıkla
      console.log(`🎭 [Playwright] Ülke seçeneği aranıyor: ${amazonCountryCode} (${targetCountryName})...`);
      
      // KRİTİK: Popover içindeki seçenekleri al (#a-popover-4 içinde)
      // Önce popover içindeki liste görünür olana kadar bekle
      try {
        await page.waitForSelector('#a-popover-4 ul.a-list-item a[data-value], ul.a-list-item a[data-value]', { timeout: 5000, state: 'visible' });
        console.log(`✅ [Playwright] Popover içindeki liste görünür`);
      } catch (listError) {
        console.warn(`⚠️ [Playwright] Liste hemen görünür olmadı, devam ediliyor...`);
      }
      
      const allOptions = await page.$$eval('#a-popover-4 a[data-value], ul.a-list-item a[data-value], a[data-value]', (options) => {
        return options.map(opt => ({
          text: opt.textContent.trim(),
          value: opt.getAttribute('data-value'),
          id: opt.id,
          href: opt.getAttribute('href') || '',
          visible: opt.offsetParent !== null // Element görünür mü?
        })).filter(opt => opt.visible); // Sadece görünür seçenekleri al
      });
      console.log(`🔍 [Playwright] Mevcut ülke seçenekleri: ${allOptions.length} adet`);
      
      // Ülke seçeneğini bul - data-value içinde country code'u ara
      let foundOption = null;
      for (const opt of allOptions) {
        try {
          const valueObj = JSON.parse(opt.value);
          if (valueObj.stringVal === amazonCountryCode || opt.text.includes(targetCountryName)) {
            foundOption = opt;
            console.log(`✅ [Playwright] Ülke seçeneği bulundu: ${opt.text} (${opt.value})`);
            break;
          }
        } catch (e) {
          // JSON parse başarısız, string içinde ara
          if (opt.value && (opt.value.includes(amazonCountryCode) || opt.text.includes(targetCountryName))) {
            foundOption = opt;
            console.log(`✅ [Playwright] Ülke seçeneği bulundu (string match): ${opt.text}`);
            break;
          }
        }
      }
      
      if (!foundOption) {
        const sampleOptions = allOptions.slice(0, 5).map(opt => opt.text);
        throw new Error(`Country option not found for ${amazonCountryCode} (${targetCountryName}). Toplam ${allOptions.length} seçenek var (örnek: ${sampleOptions.join(', ')})`);
      }
      
      // KRİTİK: Filtreleme yapıldıktan sonra ID'ler değişebilir, bu yüzden sadece data-value ile exact match kullan
      // Ülke seçeneğini bul ve tıkla - öncelikli: data-value exact match (ID'ler filtreleme sonrası yanlış olabilir)
      const countryOptionSelectors = [];
      
      // KRİTİK: Önce popover içinde data-value ile exact match (#a-popover-4 içinde)
      countryOptionSelectors.push(`#a-popover-4 a[data-value="${foundOption.value}"]`);
      countryOptionSelectors.push(`ul.a-list-item a[data-value="${foundOption.value}"]`);
      
      // Fallback: Genel data-value match
      countryOptionSelectors.push(`a[data-value="${foundOption.value}"]`);
      
      // Fallback: text match (ama ID kullanma - filtreleme sonrası yanlış olabilir)
      countryOptionSelectors.push(`#a-popover-4 a:has-text("${foundOption.text}")`);
      countryOptionSelectors.push(`ul.a-list-item a:has-text("${foundOption.text}")`);
      countryOptionSelectors.push(`a:has-text("${foundOption.text}")`);
      
      // KRİTİK: ID'leri en sona koy (filtreleme sonrası yanlış olabilir)
      if (foundOption.id) {
        countryOptionSelectors.push(`#a-popover-4 a#${foundOption.id}`);
        countryOptionSelectors.push(`ul.a-list-item a#${foundOption.id}`);
        countryOptionSelectors.push(`a#${foundOption.id}`);
        console.log(`🔍 [Playwright] Bulunan ID fallback olarak eklendi: a#${foundOption.id} (filtreleme sonrası yanlış olabilir)`);
      }
      
      let countryOption = null;
      for (const selector of countryOptionSelectors) {
        try {
          // KRİTİK: Sadece görünür elementleri bekle
          countryOption = await page.waitForSelector(selector, { timeout: 8000, state: 'visible' });
          if (countryOption) {
            // KRİTİK: Seçilecek elementin text'ini ve data-value'sunu kontrol et - yanlış ülke seçilmesini önle
            const optionText = await countryOption.textContent().catch(() => '');
            const optionDataValue = await countryOption.getAttribute('data-value').catch(() => '');
            
            // Data-value içinde doğru country code olup olmadığını kontrol et
            let isValidOption = false;
            try {
              if (optionDataValue) {
                const valueObj = JSON.parse(optionDataValue);
                isValidOption = valueObj.stringVal === amazonCountryCode;
              }
            } catch (e) {
              // JSON parse başarısız, string içinde ara
              isValidOption = optionDataValue && optionDataValue.includes(`"stringVal":"${amazonCountryCode}"`);
            }
            
            // Text içinde de kontrol et (fallback)
            if (!isValidOption && optionText) {
              isValidOption = optionText.includes(targetCountryName) || optionText.toLowerCase().includes(amazonCountryCode.toLowerCase());
            }
            
            if (!isValidOption) {
              console.warn(`⚠️ [Playwright] Seçilen element yanlış ülkeye ait: "${optionText}" (data-value: ${optionDataValue}), atlanıyor...`);
              countryOption = null;
              continue;
            }
            
            console.log(`✅ [Playwright] Ülke seçeneği elementi bulundu ve doğrulandı: ${selector} - "${optionText}"`);
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!countryOption) {
        throw new Error(`Country option element not found for ${foundOption.text}`);
      }
      
      // Ülke seçeneğine tıkla
      try {
        await countryOption.scrollIntoViewIfNeeded();
        await this.safeWait(page, 500);
        await countryOption.click({ timeout: 30000 });
        await this.safeWait(page, 2000);
        console.log(`✅ [Playwright] Ülke seçildi: ${amazonCountryCode} (${targetCountryName})`);
      } catch (clickError) {
        console.warn(`⚠️ [Playwright] Ülke seçimi click başarısız, force click deneniyor: ${clickError.message}`);
        await countryOption.click({ force: true, timeout: 30000 });
        await this.safeWait(page, 2000);
      }
      
      // Done butonuna tıkla
      console.log(`🎭 [Playwright] "Done" butonu aranıyor...`);
      // KRİTİK: name="glowDoneButton" sabit; #a-autoid-* dinamik ID'ler değişebilir — önce sabit selector
      const doneButtonSelectors = [
        'button[name="glowDoneButton"]',
        'button.a-button-text[name="glowDoneButton"]',
        'span.a-button-inner button[name="glowDoneButton"]',
        'input[name="glowDoneButton"]',
        'button[data-action="glowDoneButton"]',
        '[name="glowDoneButton"]'
      ];
      
      let doneButton = null;
      for (const selector of doneButtonSelectors) {
        try {
          doneButton = await page.waitForSelector(selector, { timeout: 8000, state: 'visible' });
          if (doneButton) {
            console.log(`✅ [Playwright] "Done" butonu bulundu: ${selector}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!doneButton) {
        throw new Error('Done button not found');
      }
      
      // Done butonuna tıkla
      try {
        await doneButton.scrollIntoViewIfNeeded();
        await this.safeWait(page, 500);
        await doneButton.click({ timeout: 30000 });
        await this.safeWait(page, 2000); // Sayfa yeniden yüklenmesi için bekle
        console.log(`✅ [Playwright] "Done" butonuna tıklandı, ülke seçimi tamamlandı`);
      } catch (clickError) {
        console.log(`⚠️ [Playwright] Normal click başarısız, JS click deneniyor: ${clickError.message}`);
        await page.evaluate(() => {
          const btn = document.querySelector('button[name="glowDoneButton"]') || 
                     document.querySelector('[name="glowDoneButton"]') ||
                     document.querySelector('button[data-action="glowDoneButton"]');
          if (btn) btn.click();
        });
        await this.safeWait(page, 2000);
      }
      
      // KRİTİK: Sayfa yeniden yüklenecek, bunu bekle - timeout kısaltıldı
      console.log(`⏳ [Playwright] Sayfa yeniden yüklenmesi bekleniyor (Done butonuna tıklandıktan sonra)...`);
      try {
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => { // 10s -> 30s
          console.warn(`⚠️ [Playwright] Network idle bekleme timeout, devam ediliyor...`);
        });
        await this.safeWait(page, 1000); // 2s -> 1s
        console.log(`✅ [Playwright] Sayfa yeniden yüklendi`);
      } catch (loadError) {
        console.warn(`⚠️ [Playwright] Sayfa yükleme bekleme hatası: ${loadError.message}, devam ediliyor...`);
      }
      
      // KRİTİK: Para birimi seçimi customer-preferences sayfasından yapılmalı (aksi halde yanlış fiyatlar çekilebiliyor)
      try {
        const currentAsinUrl = asinUrl || page.url();
        const preferencesReturnUrl = (() => {
          try {
            const u = new URL(currentAsinUrl);
            return `${u.pathname}${u.search}`;
          } catch (e) {
            // Fallback: tam URL değilse /dp/... kısmını yakala
            const idx = String(currentAsinUrl).indexOf('/dp/');
            return idx >= 0 ? String(currentAsinUrl).slice(idx) : '/';
          }
        })();

        const preferencesUrl = `${baseUrl}/customer-preferences/edit?ref_=icp_cop_flyout_change&preferencesReturnUrl=${encodeURIComponent(preferencesReturnUrl)}`;
        console.log(`💵 [Playwright] Para birimi sayfasına gidiliyor: ${preferencesUrl}`);

        await page.goto(preferencesUrl, { waitUntil: 'domcontentloaded', timeout: 18000 });
        await this.safeWait(page, 1500);

        // Sayfa ana container'larını bekle
        await page.waitForSelector('#international-customer-select-preferences-form, #icp-currency-settings, #icp-currency-dropdown-container', {
          timeout: 15000,
          state: 'attached'
        }).catch(() => {
          console.warn(`⚠️ [Playwright] customer-preferences container bekleme timeout, devam ediliyor...`);
        });

        // Mevcut para birimini oku
        const currencyPromptSelectors = [
          '#icp-currency-dropdown-container span.a-dropdown-prompt',
          'span#icp-currency-dropdown-selected-item-prompt span.a-dropdown-prompt',
          'span#icp-currency-dropdown-selected-item-prompt'
        ];
        let currentCurrencyPromptText = '';
        for (const selector of currencyPromptSelectors) {
          try {
            const el = await page.$(selector);
            if (el) {
              const txt = await el.textContent().then(t => t.trim()).catch(() => '');
              if (txt) {
                currentCurrencyPromptText = txt;
                break;
              }
            }
          } catch (e) {
            continue;
          }
        }
        if (currentCurrencyPromptText) {
          console.log(`🔍 [Playwright] Mevcut para birimi prompt: "${currentCurrencyPromptText}"`);
        }

        const isAlreadyCorrect = currentCurrencyPromptText
          ? currentCurrencyPromptText.toUpperCase().includes(`- ${targetCurrency.toUpperCase()} -`) ||
            currentCurrencyPromptText.toUpperCase().includes(` ${targetCurrency.toUpperCase()} `) ||
            currentCurrencyPromptText.toUpperCase().includes(targetCurrency.toUpperCase())
          : false;

        if (!isAlreadyCorrect) {
          // Dropdown'u aç
          console.log(`💵 [Playwright] Para birimi dropdown açılıyor...`);
          const dropdownOpenSelectors = [
            '#icp-currency-dropdown-selected-item-prompt',
            '#icp-currency-dropdown-container span.a-dropdown-prompt',
            '#icp-currency-dropdown-container'
          ];
          let dropdownOpener = null;
          for (const selector of dropdownOpenSelectors) {
            try {
              dropdownOpener = await page.waitForSelector(selector, { timeout: 8000, state: 'visible' });
              if (dropdownOpener) {
                break;
              }
            } catch (e) {
              continue;
            }
          }
          if (!dropdownOpener) {
            throw new Error('Currency dropdown opener bulunamadı');
          }

          await dropdownOpener.scrollIntoViewIfNeeded().catch(() => {});
          await this.safeWait(page, 300);
          await dropdownOpener.click({ timeout: 30000 }).catch(async (e) => {
            console.warn(`⚠️ [Playwright] Currency dropdown normal click başarısız, force click deneniyor: ${e.message}`);
            await dropdownOpener.click({ force: true, timeout: 30000 });
          });
          await this.safeWait(page, 1000);

          // Popover içinden para birimini seç
          console.log(`💵 [Playwright] Para birimi seçeneği aranıyor: ${targetCurrency}...`);
          const optionSelectors = [
            `div.a-popover-wrapper li#${targetCurrency} a`,
            `div.a-popover-wrapper li#${targetCurrency} span`,
            `#a-popover-1 li#${targetCurrency} a`,
            `#a-popover-1 li#${targetCurrency} span`,
            `div.a-popover-wrapper a:has-text("${targetCurrency}")`,
            `#a-popover-1 a:has-text("${targetCurrency}")`
          ];
          let optionEl = null;
          for (const selector of optionSelectors) {
            try {
              optionEl = await page.waitForSelector(selector, { timeout: 8000, state: 'visible' });
              if (optionEl) {
                console.log(`✅ [Playwright] Para birimi seçeneği bulundu: ${selector}`);
                break;
              }
            } catch (e) {
              continue;
            }
          }
          if (!optionEl) {
            throw new Error(`Para birimi seçeneği bulunamadı: ${targetCurrency}`);
          }

          await optionEl.scrollIntoViewIfNeeded().catch(() => {});
          await this.safeWait(page, 300);
          await optionEl.click({ timeout: 30000 }).catch(async (e) => {
            console.warn(`⚠️ [Playwright] Currency option normal click başarısız, force click deneniyor: ${e.message}`);
            await optionEl.click({ force: true, timeout: 30000 });
          });
          await this.safeWait(page, 1200);
          console.log(`✅ [Playwright] Para birimi seçildi: ${targetCurrency}`);
        } else {
          console.log(`✅ [Playwright] Para birimi zaten doğru: ${targetCurrency}`);
        }

        // Save butonuna tıkla (değişiklik olmasa bile, Amazon bazen state'i apply ediyor)
        console.log(`💾 [Playwright] Save butonu aranıyor...`);
        const saveSelectors = [
          'span#icp-save-button input.a-button-input[type="submit"]',
          'span#icp-save-button input.a-button-input',
          'span#icp-save-button input',
          'input.a-button-input[type="submit"][aria-labelledby="icp-save-button-announce"]'
        ];
        let saveButton = null;
        for (const selector of saveSelectors) {
          try {
            saveButton = await page.waitForSelector(selector, { timeout: 8000, state: 'visible' });
            if (saveButton) {
              console.log(`✅ [Playwright] Save butonu bulundu: ${selector}`);
              break;
            }
          } catch (e) {
            continue;
          }
        }
        if (!saveButton) {
          throw new Error('Save butonu bulunamadı');
        }

        await saveButton.scrollIntoViewIfNeeded().catch(() => {});
        await this.safeWait(page, 300);
        await saveButton.click({ timeout: 30000 }).catch(async (e) => {
          console.warn(`⚠️ [Playwright] Save normal click başarısız, force click deneniyor: ${e.message}`);
          await saveButton.click({ force: true, timeout: 30000 });
        });

        // Save sonrası returnUrl'e yönlenmesini bekle
        await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
        await this.safeWait(page, 1500);

        // Eğer hala preferences sayfasındaysak, ASIN sayfasına dön
        const afterUrl = page.url();
        if (afterUrl.includes('/customer-preferences/') && asinUrl) {
          console.log(`🔗 [Playwright] Save sonrası ASIN sayfasına geri dönülüyor: ${asinUrl}`);
          await page.goto(asinUrl, { waitUntil: 'domcontentloaded', timeout: 18000 });
          await this.safeWait(page, 2000);
        }
      } catch (currencyError) {
        console.warn(`⚠️ [Playwright] Para birimi seçimi hatası: ${currencyError.message}`);
        // Hata olsa bile akışı durdurma; mümkünse ASIN sayfasına geri dön
        try {
          const urlNow = page.url();
          if (urlNow.includes('/customer-preferences/') && asinUrl) {
            console.log(`🔗 [Playwright] Para birimi hatası sonrası ASIN sayfasına geri dönülüyor: ${asinUrl}`);
            await page.goto(asinUrl, { waitUntil: 'domcontentloaded', timeout: 18000 });
            await this.safeWait(page, 2000);
          }
        } catch (navError) {
          console.warn(`⚠️ [Playwright] Para birimi hatası sonrası navigation hatası: ${navError.message}`);
        }
      }
      
      return { success: true, error: null };
    } catch (error) {
      console.error(`❌ [Playwright] Ülke ve para birimi seçimi hatası: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Extract buybox data from PDP (Product Detail Page)
   * @param {Object} page - Playwright page object
   * @returns {Promise<Object | null>}
   */
  async extractBuyboxData(page) {
    try {
      console.log(`🔍 [Playwright] Buybox bilgileri çekiliyor (PDP sayfasından)...`);
      
      // KRİTİK: Sayfa title'ını kontrol et - eğer sadece "Amazon.com" ise sayfa tam yüklenmemiş olabilir
      const pageTitle = await page.title().catch(() => '');
      if (pageTitle === 'Amazon.com' || pageTitle === 'Amazon' || !pageTitle) {
        console.warn(`⚠️ [Playwright] Sayfa title sadece "Amazon.com" - sayfa tam yüklenmemiş olabilir, ekstra bekleme...`);
        await this.safeWait(page, 5000);
        
        // Buybox container'ının yüklenmesini bekle
        try {
          await page.waitForSelector('#desktop_buybox, #buybox, #qualifiedBuybox, #apex_offerDisplay_single_desktop, #apex_offerDisplay_desktop', { 
            timeout: 30000, // 20s -> 30s 
            state: 'attached' 
          });
          console.log(`✅ [Playwright] Buybox container yüklendi`);
        } catch (e) {
          console.warn(`⚠️ [Playwright] Buybox container bekleme timeout`);
        }
      }
      
      // Sayfanın yüklenmesini bekle
      await this.safeWait(page, 3000);
      
      // ADIM 1: Shipper/Seller bilgisi
      let sellerName = null;
      let soldBy = null;
      let shipsFrom = null;
      try {
        // KRİTİK: Amazon'un farklı buybox yapılarını destekle
        // "Shipper / Seller" label'ından sonraki text'i al
        const merchantInfoSelectors = [
          // Standart merchantInfo yapısı
          'div#merchantInfoFeature_feature_div div.offer-display-feature-text-message',
          'div#merchantInfoFeature_feature_div span.offer-display-feature-text-message',
          'div#merchantInfoFeature_feature_div .offer-display-feature-text-message',
          'div#merchantInfoFeature_feature_div span.a-size-small.offer-display-feature-text-message',
          // Alternatif selector'lar - farklı Amazon sayfa yapıları için
          '#merchant-info',
          '#sellerProfileTriggerId',
          '#tabular-buybox-truncate-0 .tabular-buybox-text a',
          '#tabular-buybox-truncate-1 .tabular-buybox-text a',
          'div[data-feature-name="merchantInfo"] .offer-display-feature-text-message',
          // Buybox içinde satıcı linki
          '#buybox a[href*="/sp?seller="]',
          '#desktop_buybox a[href*="/sp?seller="]',
          '#qualifiedBuybox a[href*="/sp?seller="]',
          // Sold by text
          '#buybox-see-all-buying-choices-announce',
          'span:has-text("Sold by") + span',
          'span:has-text("Ships from") + span'
        ];
        
        for (const selector of merchantInfoSelectors) {
          try {
            const element = await page.$(selector);
            if (element) {
              const text = await element.textContent().then(t => t.trim()).catch(() => null);
              if (text) {
                // "Sold by X" formatından sadece X'i çıkar
                const soldByMatch = text.match(/Sold by\s+(.+?)(?:\s+Seller rating|\s+\(|\s*$)/i);
                if (soldByMatch) {
                  sellerName = soldByMatch[1].trim();
                  soldBy = sellerName;
                } else {
                  // Direkt satıcı adı olabilir
                  sellerName = text;
                  soldBy = sellerName;
                }
                
                // Seller ID'yi link'ten çek (eğer element bir link ise)
                if (element && (await element.evaluate(el => el.tagName.toLowerCase()) === 'a')) {
                  const href = await element.getAttribute('href').catch(() => '');
                  if (href) {
                    const sellerIdMatch = href.match(/seller=([A-Z0-9]+)/i);
                    if (sellerIdMatch) {
                      // sellerId field'ı yoksa eklenebilir
                    }
                  }
                }
                
                if (sellerName) {
                  console.log(`✅ [Playwright] Buybox sellerName çekildi: ${sellerName}`);
                  break;
                }
              }
            }
          } catch (e) {
            continue;
          }
        }
        
        // KRİTİK: "Shipper / Seller" label kontrolü - Eğer bu label varsa, seller bilgisini çek
        if (!sellerName) {
          try {
            // "Shipper / Seller" label'ını kontrol et
            const shipperSellerLabel = await page.$('div#merchantInfoFeature_feature_div span.a-size-small.a-color-tertiary:has-text("Shipper / Seller")');
            if (shipperSellerLabel) {
              console.log(`✅ [Playwright] "Shipper / Seller" label bulundu`);
              
              // "Shipper / Seller" label'ından sonraki text'i al
              const shipperSellerText = await page.$eval('div#merchantInfoFeature_feature_div', (div) => {
                const label = div.querySelector('span.a-size-small.a-color-tertiary');
                if (label && label.textContent.includes('Shipper / Seller')) {
                  const textElement = div.querySelector('div.offer-display-feature-text-message, span.offer-display-feature-text-message, a#sellerProfileTriggerId');
                  return textElement ? textElement.textContent.trim() : null;
                }
                return null;
              }).catch(() => null);
              
              if (shipperSellerText) {
                sellerName = shipperSellerText;
                soldBy = shipperSellerText;
                console.log(`✅ [Playwright] "Shipper / Seller" text'inden sellerName çekildi: ${sellerName}`);
              }
            }
          } catch (e) {
            console.warn(`⚠️ [Playwright] "Shipper / Seller" kontrolü hatası: ${e.message}`);
          }
        }
        
        // KRİTİK: Eğer hala bulunamadıysa, buybox container'ından text parse et
        if (!sellerName) {
          try {
            // Buybox container text'inden "Ships from" ve "Sold by" bilgilerini çek
            const buyboxSelectors = [
              '#desktop_buybox',
              '#buybox',
              '#qualifiedBuybox',
              '#tabular-buybox'
            ];
            
            for (const selector of buyboxSelectors) {
              try {
                const buyboxText = await page.textContent(selector).catch(() => '');
                if (buyboxText) {
                  // "Sold by" pattern'i
                  const soldByMatch = buyboxText.match(/Sold by\s+([^\n\r]+?)(?:\s+Ships from|$)/i);
                  if (soldByMatch) {
                    sellerName = soldByMatch[1].trim();
                    soldBy = sellerName;
                    console.log(`✅ [Playwright] Buybox sellerName buybox text'inden çekildi: ${sellerName}`);
                    break;
                  }
                  
                  // "Ships from" ve "Sold by" ayrı ayrı
                  const shipsFromMatch = buyboxText.match(/Ships from\s+([^\n\r]+?)(?:\s+Sold by|$)/i);
                  if (shipsFromMatch && !shipsFrom) {
                    shipsFrom = shipsFromMatch[1].trim();
                  }
                }
              } catch (e) {
                continue;
              }
            }
          } catch (e) {
            console.warn(`⚠️ [Playwright] Buybox text parse hatası: ${e.message}`);
          }
        }
        
        // "Ships From" bilgisi (eğer varsa)
        if (!shipsFrom) {
          try {
            const shipsFromText = await page.textContent('div#merchantInfoFeature_feature_div').catch(() => '');
            const shipsFromMatch = shipsFromText.match(/Ships from\s+([^\n\r]+)/i);
            if (shipsFromMatch) {
              shipsFrom = shipsFromMatch[1].trim();
              console.log(`✅ [Playwright] Buybox shipsFrom çekildi: ${shipsFrom}`);
            }
          } catch (e) {
            // Ships from bulunamadı
          }
        }
      } catch (e) {
        console.warn(`⚠️ [Playwright] Buybox sellerName çekilemedi: ${e.message}`);
      }
      
      // ADIM 2: Ürün durumu (Condition) - "Buy new:" veya "Buy used:"
      let condition = 'New';
      let isNew = true;
      let isUsed = false;
      try {
        const conditionSelectors = [
          'div#newAccordionCaption_feature_div span.a-text-bold',
          'div#newAccordionCaption_feature_div .a-text-bold',
          'h5 div#newAccordionCaption_feature_div span.a-text-bold'
        ];
        
        for (const selector of conditionSelectors) {
          try {
            const element = await page.$(selector);
            if (element) {
              const conditionText = await element.textContent().then(t => t.trim()).catch(() => null);
              if (conditionText) {
                const conditionLower = conditionText.toLowerCase();
                if (conditionLower.includes('buy new') || conditionLower.includes('new')) {
                  condition = 'New';
                  isNew = true;
                  isUsed = false;
                } else if (conditionLower.includes('buy used') || conditionLower.includes('used')) {
                  condition = 'Used';
                  isNew = false;
                  isUsed = true;
                }
                console.log(`✅ [Playwright] Buybox condition çekildi: ${condition} (${conditionText})`);
                break;
              }
            }
          } catch (e) {
            continue;
          }
        }
      } catch (e) {
        console.warn(`⚠️ [Playwright] Buybox condition çekilemedi: ${e.message}`);
      }
      
      // ADIM 3: Fiyat ve Shipping & Import Charges
      let price = null;
      let priceText = null;
      let shippingPrice = null;
      let shippingText = null;
      try {
        // Fiyat: div#corePrice_feature_div içindeki price
        const priceSelectors = [
          'div#corePrice_feature_div span.a-price span[aria-hidden="true"]',
          'div#corePrice_feature_div span.a-price .a-offscreen',
          'div#corePrice_feature_div .a-price span[aria-hidden="true"]',
          'div#corePrice_feature_div .a-spacing-top-mini',
          // KRİTİK: Alternatif fiyat selector'ları
          '#qualifiedBuybox span.a-price .a-offscreen',
          '#qualifiedBuybox span.a-price span[aria-hidden="true"]',
          '#desktop_buybox span.a-price .a-offscreen',
          '#desktop_buybox span.a-price span[aria-hidden="true"]',
          '#buybox span.a-price .a-offscreen',
          'span.a-price.a-text-price span.a-offscreen',
          '#apex_offerDisplay_desktop span.a-price .a-offscreen'
        ];
        
        for (const selector of priceSelectors) {
          try {
            const element = await page.$(selector);
            if (element) {
              priceText = await element.textContent().then(t => t.trim()).catch(() => null);
              if (priceText) {
                // Fiyatı parse et - "$199 . 99" -> 199.99 (boşlukları temizle)
                const cleanedPriceText = priceText.replace(/\s+/g, '');
                const priceMatch = cleanedPriceText.match(/[\$£€]?([\d,]+\.?\d*)/);
                if (priceMatch) {
                  price = parseFloat(priceMatch[1].replace(/,/g, ''));
                  console.log(`✅ [Playwright] Buybox price çekildi: ${priceText} -> ${price}`);
                  break;
                }
              }
            }
          } catch (e) {
            continue;
          }
        }
        
        // KRİTİK: Eğer hala fiyat bulunamadıysa, buybox içeriğinden parse et
        if (!price) {
          try {
            const buyboxInnerSelectors = [
              '#qualifiedBuybox .a-box-inner',
              '#desktop_buybox .a-box-inner',
              '#buybox .a-box-inner'
            ];
            
            for (const selector of buyboxInnerSelectors) {
              try {
                const buyboxInner = await page.textContent(selector).catch(() => '');
                if (buyboxInner) {
                  // "$24.99" veya "$24 . 99" formatından fiyat çıkar
                  const priceMatch = buyboxInner.match(/\$\s*([\d,]+(?:\s*\.\s*\d{2})?)/);
                  if (priceMatch) {
                    const cleanedPrice = priceMatch[1].replace(/\s+/g, '');
                    price = parseFloat(cleanedPrice.replace(/,/g, ''));
                    priceText = `$${cleanedPrice}`;
                    console.log(`✅ [Playwright] Buybox price a-box-inner'dan çekildi: ${priceText} -> ${price}`);
                    
                    // Aynı içerikten shipping bilgisini de çek
                    // "$9.42 Shipping to United Kingdom" veya "$9.42 delivery"
                    const shippingMatch = buyboxInner.match(/\$\s*([\d,]+\.?\d*)\s*(?:Shipping|delivery)/i);
                    if (shippingMatch && !shippingPrice) {
                      shippingPrice = parseFloat(shippingMatch[1].replace(/,/g, ''));
                      shippingText = shippingMatch[0];
                      console.log(`✅ [Playwright] Buybox shippingPrice a-box-inner'dan çekildi: ${shippingPrice}`);
                    }
                    break;
                  }
                }
              } catch (e) {
                continue;
              }
            }
          } catch (e) {
            console.warn(`⚠️ [Playwright] Buybox a-box-inner parse hatası: ${e.message}`);
          }
        }
        
        // Shipping & Import Charges: div#amazonGlobal_feature_div
        // KRİTİK: Shipping bilgilerinin render olması için ekstra bekleme
        await this.safeWait(page, 3000);
        
        if (!shippingPrice) {
          console.log(`🔍 [Playwright] Shipping price text aranıyor...`);
          const shippingPriceSelectors = [
            '#amazonGlobal_feature_div span.a-size-base.a-color-secondary',
            '#apex_offerDisplay_single_desktop #amazonGlobal_feature_div span.a-size-base.a-color-secondary',
            '#desktop_qualifiedBuyBox #amazonGlobal_feature_div span.a-size-base.a-color-secondary',
            '#desktop_qualifiedBuyBox span.a-size-base.a-color-secondary',
            '#apex_offerDisplay_single_desktop span.a-size-base.a-color-secondary',
            '#qualifiedBuybox span.a-size-base.a-color-secondary',
            '#buybox span.a-size-base.a-color-secondary',
            '#desktop_buybox span.a-size-base.a-color-secondary',
            'span.a-size-base.a-color-secondary:has-text("Shipping")',
            'span.a-size-base.a-color-secondary:has-text("Import Charges")',
            'span.a-size-base.a-color-secondary:has-text("Shipping & Import")',
            '#desktop_buybox span:has-text("Shipping")',
            '#buybox span:has-text("Shipping")',
            '#qualifiedBuybox span:has-text("Shipping")'
          ];
          
          for (const selector of shippingPriceSelectors) {
            try {
              const element = await page.$(selector);
              if (element) {
                const isVisible = await element.isVisible().catch(() => false);
                if (isVisible) {
                  shippingText = await element.textContent().then(t => t.trim()).catch(() => null);
                  if (shippingText && (shippingText.includes('Shipping') || shippingText.includes('Import Charges') || shippingText.includes('delivery'))) {
                    console.log(`✅ [Playwright] Shipping price text bulundu: ${shippingText} (selector: ${selector})`);
                    break;
                  }
                }
              }
            } catch (e) {
              continue;
            }
          }
          
          // Eğer hala bulunamadıysa, buybox içinde text arama
          if (!shippingText) {
            console.log(`🔍 [Playwright] Shipping text selector'larla bulunamadı, buybox içinde aranıyor...`);
            try {
              const buyboxSelectors = ['#desktop_buybox', '#buybox', '#qualifiedBuybox', '#apex_offerDisplay_single_desktop'];
              for (const buyboxSelector of buyboxSelectors) {
                try {
                  const buyboxElement = await page.$(buyboxSelector);
                  if (buyboxElement) {
                    const buyboxText = await buyboxElement.textContent();
                    if (buyboxText) {
                      // Shipping ile ilgili text'i bul
                      const shippingMatch = buyboxText.match(/([^.]*(?:Shipping|Import Charges|delivery)[^.]*)/i);
                      if (shippingMatch) {
                        shippingText = shippingMatch[1].trim();
                        console.log(`✅ [Playwright] Shipping price text bulundu (buybox text): ${shippingText}`);
                        break;
                      }
                    }
                  }
                } catch (e) {
                  continue;
                }
              }
            } catch (e) {
              console.warn(`⚠️ [Playwright] Buybox text arama hatası: ${e.message}`);
            }
          }
          
          // Shipping price parse et
          if (shippingText) {
            console.log(`🔍 [Playwright] Shipping price text parse ediliyor: "${shippingText}"`);
            
            // "No Import Charges & $7.65 Shipping to United Kingdom" formatından fiyatı çıkar
            let priceMatch = shippingText.match(/&\s*[\$£€]?\s*([\d,]+\.?\d*)\s*(?:Shipping|Import|to)/i);
            if (priceMatch) {
              shippingPrice = parseFloat(priceMatch[1].replace(/,/g, ''));
              console.log(`✅ [Playwright] Standart gönderim fiyatı bulundu (after &): ${shippingPrice}`);
            } else {
              // "$94.14 Shipping & Import Charges" formatından fiyatı çıkar
              priceMatch = shippingText.match(/[\$£€]?\s*([\d,]+\.?\d*)\s*(?:Shipping|Import)/i);
              if (priceMatch) {
                shippingPrice = parseFloat(priceMatch[1].replace(/,/g, ''));
                console.log(`✅ [Playwright] Standart gönderim fiyatı bulundu (before Shipping): ${shippingPrice}`);
              } else {
                // Alternatif: Herhangi bir fiyat bul (ilk fiyat)
                const altPriceMatch = shippingText.match(/[\$£€]?\s*([\d,]+\.?\d*)/);
                if (altPriceMatch) {
                  shippingPrice = parseFloat(altPriceMatch[1].replace(/,/g, ''));
                  console.log(`✅ [Playwright] Standart gönderim fiyatı bulundu (first price): ${shippingPrice}`);
                } else {
                  console.warn(`⚠️ [Playwright] Shipping price text'ten fiyat çıkarılamadı: "${shippingText}"`);
                }
              }
            }
          } else {
            console.warn(`⚠️ [Playwright] Shipping price text bulunamadı`);
          }
        }
      } catch (e) {
        console.warn(`⚠️ [Playwright] Buybox price çekilemedi: ${e.message}`);
      }
      
      // ADIM 4: Tarihler (sadece gün ve ay, önündeki price alınmayacak)
      let standardDeliveryDate = null;
      let expressDeliveryDate = null;
      try {
        // Standard delivery: div#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE > span
        // KRİTİK: data-csa-c-delivery-time attribute'undan tarih aralığı çekilebilir (örn: "February 9 - 19")
        console.log(`🔍 [Playwright] Standart gönderim tarihi aranıyor...`);
        const standardDeliverySelectors = [
          'span[data-csa-c-delivery-time]', // Öncelikli - attribute'dan direkt çek (tarih aralığı dahil)
          '#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE span[data-csa-c-delivery-time]',
          '#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE span.a-text-bold',
          '#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE span span.a-text-bold',
          '#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE',
          '#deliveryBlockMessage span.a-text-bold',
          '#deliveryBlockContainer span.a-text-bold',
          '#deliveryBlockMessage',
          '#deliveryBlockContainer',
          'div#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE span.a-text-bold',
          'div#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE',
          '#deliveryBlock_feature_div span.a-text-bold',
          '#deliveryBlock_feature_div',
          'span.a-text-bold:has-text("Monday"), span.a-text-bold:has-text("Tuesday"), span.a-text-bold:has-text("Wednesday"), span.a-text-bold:has-text("Thursday"), span.a-text-bold:has-text("Friday"), span.a-text-bold:has-text("Saturday"), span.a-text-bold:has-text("Sunday")'
        ];
        
        for (const selector of standardDeliverySelectors) {
          try {
            const element = await page.$(selector);
            if (element) {
              // KRİTİK: Önce data-csa-c-delivery-time attribute'undan tarih aralığını çek
              const deliveryTimeAttr = await element.getAttribute('data-csa-c-delivery-time');
              if (deliveryTimeAttr) {
                standardDeliveryDate = deliveryTimeAttr.trim();
                console.log(`✅ [Playwright] Standart gönderim tarihi bulundu (attribute): ${standardDeliveryDate} (selector: ${selector})`);
                break;
              }
              
              const isVisible = await element.isVisible().catch(() => false);
              const dateText = await element.textContent().then(t => t.trim()).catch(() => null);
              if (dateText) {
                // KRİTİK: Tarih aralığı formatını kontrol et (örn: "February 9 - 19")
                const dateRangeMatch = dateText.match(/((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s*-\s*\d{1,2})/i);
                if (dateRangeMatch) {
                  standardDeliveryDate = dateRangeMatch[1].trim();
                  console.log(`✅ [Playwright] Standart gönderim tarihi bulundu (tarih aralığı): ${standardDeliveryDate} (selector: ${selector})`);
                  break;
                }
                
                // Tarih formatını kontrol et (Monday, Tuesday, vb. içermeli)
                const dateMatch = dateText.match(/((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2})/i);
                if (dateMatch) {
                  standardDeliveryDate = dateMatch[1].trim();
                  console.log(`✅ [Playwright] Standart gönderim tarihi bulundu: ${standardDeliveryDate} (selector: ${selector})`);
                  break;
                } else if (dateText.match(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i)) {
                  // Sadece gün adı varsa, tam text'i al
                  standardDeliveryDate = dateText;
                  console.log(`✅ [Playwright] Standart gönderim tarihi bulundu (partial): ${standardDeliveryDate} (selector: ${selector})`);
                  break;
                }
              }
            }
          } catch (e) {
            continue;
          }
        }
        
        // Eğer hala bulunamadıysa, delivery block içinde text arama
        if (!standardDeliveryDate) {
          console.log(`🔍 [Playwright] Delivery tarihi selector'larla bulunamadı, delivery block içinde aranıyor...`);
          try {
            const deliverySelectors = ['#deliveryBlockMessage', '#deliveryBlockContainer', '#deliveryBlock_feature_div'];
            for (const deliverySelector of deliverySelectors) {
              try {
                const deliveryElement = await page.$(deliverySelector);
                if (deliveryElement) {
                  const deliveryText = await deliveryElement.textContent();
                  if (deliveryText) {
                    // KRİTİK: Tarih aralığı formatını kontrol et (örn: "February 9 - 19")
                    const dateRangeMatch = deliveryText.match(/((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s*-\s*\d{1,2})/i);
                    if (dateRangeMatch) {
                      standardDeliveryDate = dateRangeMatch[1].trim();
                      console.log(`✅ [Playwright] Standart gönderim tarihi bulundu (delivery block text - tarih aralığı): ${standardDeliveryDate}`);
                      break;
                    }
                    
                    const dateMatch = deliveryText.match(/((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2})/i);
                    if (dateMatch) {
                      standardDeliveryDate = dateMatch[1].trim();
                      console.log(`✅ [Playwright] Standart gönderim tarihi bulundu (delivery block text): ${standardDeliveryDate}`);
                      break;
                    }
                  }
                }
              } catch (e) {
                continue;
              }
            }
          } catch (e) {
            console.warn(`⚠️ [Playwright] Delivery block text arama hatası: ${e.message}`);
          }
        }
        
        // Express delivery: div#mir-layout-DELIVERY_BLOCK-slot-SECONDARY_DELIVERY_MESSAGE_LARGE > span
        // KRİTİK: "Or fastest delivery February 2 - 4" formatını destekle
        // DOM Path: div#mir-layout-DELIVERY_BLOCK-slot-SECONDARY_DELIVERY_MESSAGE_LARGE > span[data-csa-c-delivery-time="February 2 - 4"]
        console.log(`🔍 [Playwright] Express delivery bilgisi aranıyor...`);
        const expressDeliverySelectors = [
          '#mir-layout-DELIVERY_BLOCK-slot-SECONDARY_DELIVERY_MESSAGE_LARGE span[data-csa-c-delivery-time]', // Öncelikli - span içinde attribute var
          '#mir-layout-DELIVERY_BLOCK-slot-SECONDARY_DELIVERY_MESSAGE_LARGE > span[data-csa-c-delivery-time]', // Direct child
          '#mir-layout-DELIVERY_BLOCK-slot-SECONDARY_DELIVERY_MESSAGE_LARGE span', // Div içindeki span
          '#mir-layout-DELIVERY_BLOCK-slot-SECONDARY_DELIVERY_MESSAGE_LARGE', // Div içinde text var
          'span[data-csa-c-delivery-time]', // Attribute'dan direkt çek (fallback)
          'span[data-csa-c-delivery-type="delivery"][data-csa-c-delivery-time]', // Delivery type ile birlikte
          '#deliveryBlockMessage span[data-csa-c-delivery-time]',
          '#deliveryBlockContainer span[data-csa-c-delivery-time]',
          'span:has-text("fastest delivery")',
          'span:has-text("Or fastest")',
          '#deliveryBlockMessage span:has-text("fastest")',
          '#deliveryBlockContainer span:has-text("fastest")'
        ];
        
        let fastestDeliveryText = null;
        for (const selector of expressDeliverySelectors) {
          try {
            const element = await page.$(selector);
            if (element) {
              // KRİTİK: Önce data-csa-c-delivery-time attribute'undan tarihi çek (tarih aralığı dahil)
              const deliveryTimeAttr = await element.getAttribute('data-csa-c-delivery-time');
              if (deliveryTimeAttr) {
                expressDeliveryDate = deliveryTimeAttr.trim();
                console.log(`✅ [Playwright] Express delivery tarihi (attribute): ${expressDeliveryDate} (selector: ${selector})`);
              }
              
              // Text içeriğini de al
              const dateText = await element.textContent().then(t => t.trim()).catch(() => null);
              if (dateText) {
                fastestDeliveryText = dateText;
                console.log(`✅ [Playwright] Fastest delivery text bulundu: ${fastestDeliveryText} (selector: ${selector})`);
                
                // Eğer attribute'dan tarih gelmediyse, text'ten çıkar
                if (!expressDeliveryDate) {
                  // KRİTİK: Tarih aralığı formatını kontrol et (örn: "Or fastest delivery February 2 - 4")
                  const dateRangeMatch = dateText.match(/(?:fastest|Or fastest).*?((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s*-\s*\d{1,2})/i);
                  if (dateRangeMatch) {
                    expressDeliveryDate = dateRangeMatch[1].trim();
                    console.log(`✅ [Playwright] Hızlı gönderim tarihi (tarih aralığı): ${expressDeliveryDate}`);
                  } else {
                    // "Or fastest delivery Friday, January 23" formatından tarih çıkar
                    const dateMatch = dateText.match(/((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2})/i);
                    if (dateMatch) {
                      expressDeliveryDate = dateMatch[1].trim();
                      console.log(`✅ [Playwright] Hızlı gönderim tarihi (text): ${expressDeliveryDate}`);
                    }
                  }
                }
                
                if (expressDeliveryDate || fastestDeliveryText) {
                  break;
                }
              }
            }
          } catch (e) {
            continue;
          }
        }
        
        // KRİTİK: Eğer SECONDARY_DELIVERY_MESSAGE_LARGE div'i bulundu ama span bulunamadıysa, div içindeki tüm span'leri kontrol et
        if (!expressDeliveryDate && !fastestDeliveryText) {
          try {
            const secondaryDiv = await page.$('#mir-layout-DELIVERY_BLOCK-slot-SECONDARY_DELIVERY_MESSAGE_LARGE');
            if (secondaryDiv) {
              console.log(`🔍 [Playwright] SECONDARY_DELIVERY_MESSAGE_LARGE div bulundu, içindeki span'ler kontrol ediliyor...`);
              const spans = await secondaryDiv.$$('span');
              for (const span of spans) {
                try {
                  const deliveryTimeAttr = await span.getAttribute('data-csa-c-delivery-time');
                  if (deliveryTimeAttr) {
                    expressDeliveryDate = deliveryTimeAttr.trim();
                    console.log(`✅ [Playwright] Express delivery tarihi (div içindeki span attribute): ${expressDeliveryDate}`);
                  }
                  
                  const dateText = await span.textContent().then(t => t.trim()).catch(() => null);
                  if (dateText && (dateText.includes('fastest') || dateText.includes('February') || dateText.includes('January') || dateText.includes('March'))) {
                    fastestDeliveryText = dateText;
                    console.log(`✅ [Playwright] Fastest delivery text bulundu (div içindeki span): ${fastestDeliveryText}`);
                    
                    if (!expressDeliveryDate) {
                      const dateRangeMatch = dateText.match(/((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s*-\s*\d{1,2})/i);
                      if (dateRangeMatch) {
                        expressDeliveryDate = dateRangeMatch[1].trim();
                        console.log(`✅ [Playwright] Hızlı gönderim tarihi (div içindeki span - tarih aralığı): ${expressDeliveryDate}`);
                      }
                    }
                    
                    if (expressDeliveryDate || fastestDeliveryText) {
                      break;
                    }
                  }
                } catch (e) {
                  continue;
                }
              }
            }
          } catch (e) {
            console.warn(`⚠️ [Playwright] SECONDARY_DELIVERY_MESSAGE_LARGE div kontrolü hatası: ${e.message}`);
          }
        }
        
        // Eğer hala express delivery bilgisi bulunamadıysa, delivery block içinde text arama
        if (!expressDeliveryDate) {
          console.log(`🔍 [Playwright] Express delivery selector'larla bulunamadı, delivery block içinde aranıyor...`);
          try {
            const deliverySelectors = ['#deliveryBlockMessage', '#deliveryBlockContainer', '#deliveryBlock_feature_div'];
            for (const deliverySelector of deliverySelectors) {
              try {
                const deliveryElement = await page.$(deliverySelector);
                if (deliveryElement) {
                  const deliveryText = await deliveryElement.textContent();
                  if (deliveryText) {
                      // "fastest" veya "Or fastest" içeren kısmı bul
                      const fastestMatch = deliveryText.match(/([^.]*(?:fastest|Or fastest)[^.]*)/i);
                      if (fastestMatch) {
                        fastestDeliveryText = fastestMatch[1].trim();
                        console.log(`✅ [Playwright] Fastest delivery text bulundu (delivery block): ${fastestDeliveryText}`);
                        
                        // KRİTİK: Tarih aralığı formatını kontrol et (örn: "Or fastest delivery February 2 - 4")
                        const dateRangeMatch = fastestDeliveryText.match(/((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s*-\s*\d{1,2})/i);
                        if (dateRangeMatch) {
                          expressDeliveryDate = dateRangeMatch[1].trim();
                          console.log(`✅ [Playwright] Express delivery tarihi bulundu (delivery block - tarih aralığı): ${expressDeliveryDate}`);
                        } else {
                          // Tarih çıkar
                          const dateMatch = fastestDeliveryText.match(/((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2})/i);
                          if (dateMatch) {
                            expressDeliveryDate = dateMatch[1].trim();
                            console.log(`✅ [Playwright] Express delivery tarihi bulundu (delivery block): ${expressDeliveryDate}`);
                          }
                        }
                        
                        break;
                      }
                  }
                }
              } catch (e) {
                continue;
              }
            }
          } catch (e) {
            console.warn(`⚠️ [Playwright] Express delivery block text arama hatası: ${e.message}`);
          }
        }
      } catch (e) {
        console.warn(`⚠️ [Playwright] Buybox delivery dates çekilemedi: ${e.message}`);
      }
      
      // KRİTİK: Fulfillment Type hesapla (FBA/FBM/SBA)
      // Mantık:
      // - Amazon satıp Amazon gönderiyorsa → SBA
      // - 3. parti satıcı satıp Amazon kargo yapıyorsa → FBA
      // - 3. parti satıcı satıp 3. parti satıcı gönderiyorsa → FBM
      // KRİTİK: "Shipper / Seller" label'ı varsa ve seller Amazon değilse → FBM
      let fulfillmentType = 'FBM'; // Default
      let isFBA = false;
      let isFBM = true; // Default
      let isSBA = false;
      
      try {
        // KRİTİK: "Shipper / Seller" label kontrolü
        let hasShipperSellerLabel = false;
        try {
          const shipperSellerLabel = await page.$('div#merchantInfoFeature_feature_div span.a-size-small.a-color-tertiary:has-text("Shipper / Seller")');
          if (shipperSellerLabel) {
            hasShipperSellerLabel = true;
            console.log(`✅ [Playwright] "Shipper / Seller" label tespit edildi`);
          }
        } catch (e) {
          // Label kontrolü başarısız, devam et
        }
        
        const soldByLower = (soldBy || sellerName || '').toLowerCase().trim();
        const shipsFromLower = (shipsFrom || '').toLowerCase().trim();
        
        const isAmazonSeller = soldByLower.includes('amazon') || soldByLower === 'amazon.com' || soldByLower === 'amazon' || soldByLower === '';
        const isAmazonShipping = shipsFromLower.includes('amazon') || shipsFromLower === 'amazon.com' || shipsFromLower === 'amazon' || shipsFromLower === '';
        
        // KRİTİK: "Shipper / Seller" label'ı varsa ve seller Amazon değilse → FBM
        if (hasShipperSellerLabel && !isAmazonSeller && sellerName) {
          fulfillmentType = 'FBM';
          isSBA = false;
          isFBA = false;
          isFBM = true;
          console.log(`✅ [Playwright] Buybox Fulfillment Type: FBM ("Shipper / Seller" label var ve seller 3. parti: ${sellerName})`);
        } else if (isAmazonSeller && isAmazonShipping) {
          fulfillmentType = 'SBA';
          isSBA = true;
          isFBA = false;
          isFBM = false;
          console.log(`✅ [Playwright] Buybox Fulfillment Type: SBA (Amazon satıyor, Amazon gönderiyor)`);
        } else if (!isAmazonSeller && isAmazonShipping) {
          fulfillmentType = 'FBA';
          isSBA = false;
          isFBA = true;
          isFBM = false;
          console.log(`✅ [Playwright] Buybox Fulfillment Type: FBA (3. parti satıcı satıyor, Amazon gönderiyor)`);
        } else {
          fulfillmentType = 'FBM';
          isSBA = false;
          isFBA = false;
          isFBM = true;
          console.log(`✅ [Playwright] Buybox Fulfillment Type: FBM (3. parti satıcı satıyor, 3. parti satıcı gönderiyor)`);
        }
      } catch (e) {
        console.warn(`⚠️ [Playwright] Buybox Fulfillment type hesaplanamadı: ${e.message}`);
        // Default: FBM
        fulfillmentType = 'FBM';
        isFBM = true;
        isFBA = false;
        isSBA = false;
      }
      
      // KRİTİK: Eğer shipping bilgileri hala null ise, buybox içinde daha detaylı arama yap
      if (!shippingPrice && !standardDeliveryDate && !expressDeliveryDate) {
        console.log(`⚠️ [Playwright] Shipping bilgileri bulunamadı, buybox içinde detaylı arama yapılıyor...`);
        try {
          // Tüm buybox container'larını kontrol et
          const buyboxContainers = ['#desktop_buybox', '#buybox', '#qualifiedBuybox', '#apex_offerDisplay_single_desktop'];
          for (const containerSelector of buyboxContainers) {
            try {
              const container = await page.$(containerSelector);
              if (container) {
                const containerText = await container.textContent();
                if (containerText) {
                  // Shipping price ara
                  if (!shippingPrice) {
                    const shippingMatch = containerText.match(/[\$£€]?\s*([\d,]+\.?\d*)\s*(?:Shipping|delivery|Import)/i);
                    if (shippingMatch) {
                      shippingPrice = parseFloat(shippingMatch[1].replace(/,/g, ''));
                      console.log(`✅ [Playwright] Shipping price buybox container'dan bulundu: ${shippingPrice}`);
                    }
                  }
                  
                  // Delivery date ara
                  if (!standardDeliveryDate) {
                    // KRİTİK: Tarih aralığı formatını kontrol et (örn: "February 9 - 19")
                    const dateRangeMatch = containerText.match(/((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s*-\s*\d{1,2})/i);
                    if (dateRangeMatch) {
                      standardDeliveryDate = dateRangeMatch[1].trim();
                      console.log(`✅ [Playwright] Delivery date buybox container'dan bulundu (tarih aralığı): ${standardDeliveryDate}`);
                    } else {
                      const dateMatch = containerText.match(/((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2})/i);
                      if (dateMatch) {
                        standardDeliveryDate = dateMatch[1].trim();
                        console.log(`✅ [Playwright] Delivery date buybox container'dan bulundu: ${standardDeliveryDate}`);
                      }
                    }
                  }
                  
                  // Express delivery ara
                  if (!expressDeliveryDate) {
                    // KRİTİK: Tarih aralığı formatını kontrol et (örn: "Or fastest delivery February 2 - 4")
                    const expressRangeMatch = containerText.match(/(?:fastest|Or fastest).*?((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s*-\s*\d{1,2})/i);
                    if (expressRangeMatch) {
                      expressDeliveryDate = expressRangeMatch[1].trim();
                      console.log(`✅ [Playwright] Express delivery date buybox container'dan bulundu (tarih aralığı): ${expressDeliveryDate}`);
                    } else {
                      const expressMatch = containerText.match(/(?:fastest|Or fastest).*?((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2})/i);
                      if (expressMatch) {
                        expressDeliveryDate = expressMatch[1].trim();
                        console.log(`✅ [Playwright] Express delivery date buybox container'dan bulundu: ${expressDeliveryDate}`);
                      }
                    }
                  }
                  
                  if (shippingPrice || standardDeliveryDate || expressDeliveryDate) {
                    break;
                  }
                }
              }
            } catch (e) {
              continue;
            }
          }
        } catch (e) {
          console.warn(`⚠️ [Playwright] Buybox container detaylı arama hatası: ${e.message}`);
        }
      }
      
      // Buybox objesi oluştur - shipping bilgileri olsa da olmasa da döndür
      // KRİTİK: sellerName veya price yoksa bile, shipping bilgileri varsa döndür
      if (sellerName || price || shippingPrice || standardDeliveryDate || expressDeliveryDate) {
        // KRİTİK: Amazon'un HTML/CSS/JavaScript kodlarını temizle
        const cleanBuyboxPriceText = this.cleanAmazonHtml(priceText || (price ? `$${price.toFixed(2)}` : null) || '');
        const cleanBuyboxSellerName = this.cleanAmazonHtml(sellerName || '');
        const cleanBuyboxSoldBy = this.cleanAmazonHtml(soldBy || sellerName || '');
        const cleanBuyboxShipsFrom = this.cleanAmazonHtml(shipsFrom || '');
        const cleanBuyboxShippingText = this.cleanAmazonHtml(shippingText || '');
        const cleanBuyboxStandardDeliveryDate = this.cleanAmazonHtml(standardDeliveryDate || '');
        const cleanBuyboxExpressDeliveryDate = this.cleanAmazonHtml(expressDeliveryDate || '');
        
        return {
          sellerName: cleanBuyboxSellerName || null,
          soldBy: cleanBuyboxSoldBy || null,
          shipsFrom: cleanBuyboxShipsFrom || null,
          condition: condition,
          isNew: isNew,
          isUsed: isUsed,
          price: price,
          priceText: cleanBuyboxPriceText || null,
          // KRİTİK: Fulfillment Type (FBA/FBM/SBA)
          fulfillmentType: fulfillmentType,
          isFBA: isFBA,
          isFBM: isFBM,
          isSBA: isSBA,
          // KRİTİK: Gönderim fiyatları - Ayrı field'lar olarak
          shippingPrice: shippingPrice,
          standardShippingPrice: shippingPrice, // Standard shipping price
          expressShippingPrice: null, // Express shipping price (buybox için genellikle yok)
          shippingText: cleanBuyboxShippingText || null,
          // KRİTİK: Teslimat tarihleri
          deliveryDate: cleanBuyboxStandardDeliveryDate || null, // Geriye dönük uyumluluk
          standardDeliveryDate: cleanBuyboxStandardDeliveryDate || null,
          standardDeliveryDateText: cleanBuyboxStandardDeliveryDate || null, // Frontend için text field
          expressDeliveryDate: cleanBuyboxExpressDeliveryDate || null,
          expressDeliveryDateText: cleanBuyboxExpressDeliveryDate || null, // Frontend için text field
          // KRİTİK: Satıcı değerlendirme bilgileri (buybox için genellikle yok ama field'ları ekle)
          sellerRating: null, // Buybox'ta satıcı rating genellikle gösterilmiyor
          sellerRatingCount: null,
          positivePercentage: null,
          isBuybox: true,
          index: 0
        };
      }
      
      // KRİTİK: Hiçbir bilgi yoksa bile null döndür (retry mekanizması çalışsın)
      console.warn(`⚠️ [Playwright] Buybox bilgileri hiç bulunamadı (sellerName, price, shipping hepsi null)`);
      return null;
    } catch (e) {
      console.error(`❌ [Playwright] Buybox data extraction hatası: ${e.message}`);
      return null;
    }
  }

  /**
   * Extract seller data from a single offer element
   * @param {Object} page - Playwright page object
   * @param {Object} offerElement - Playwright element handle for #aod-offer
   * @param {number} index - Offer index
   * @param {boolean} isPinnedOffer - Is this the pinned offer?
   * @returns {Promise<Object | null>}
   */
  async extractSellerDataFromOffer(page, offerElement, index, isPinnedOffer = false) {
    try {
      // KRİTİK: Sidebar açıldıktan sonra offer elementinden direkt veri oku
      // Önce offer element'inin text content'ini al (tüm bilgiler burada)
      const offerText = await offerElement.textContent().catch(() => '');
      console.log(`🔍 [Playwright] Offer ${index} text content (ilk 200 karakter): ${offerText.substring(0, 200)}`);
      
      // Condition (New, Used - Like New, Used - Very Good, vb.)
      let condition = null;
      let isNew = false;
      let isUsed = false;
      
      try {
        // KRİTİK: Önce offer element içinden condition'ı bul
        // "Used - Like New", "New", "Used - Very Good" gibi pattern'leri ara
        const conditionMatch = offerText.match(/(New|Used\s*-\s*(?:Like\s+New|Very\s+Good|Good|Acceptable)|Used)/i);
        if (conditionMatch) {
          // KRİTİK: Condition stringini temizle - fazla boşluk ve newline'ları kaldır
          condition = conditionMatch[1].replace(/\s+/g, ' ').trim();
          console.log(`✅ [Playwright] Offer ${index} condition offer element'inden çekildi: ${condition}`);
        }
        
        // Eğer bulunamadıysa, sidebar'dan condition çek
        if (!condition) {
          if (isPinnedOffer) {
            try {
              const conditionElement = await page.$('#aod-offer-heading > span.a-size-base.a-text-bold').catch(() => null);
              if (conditionElement) {
                let rawCondition = await conditionElement.textContent().then(t => t.trim()).catch(() => null);
                if (rawCondition) {
                  // KRİTİK: Condition stringini temizle - fazla boşluk ve newline'ları kaldır
                  condition = rawCondition.replace(/\s+/g, ' ').trim();
                  console.log(`✅ [Playwright] Offer ${index} condition sidebar'dan çekildi: ${condition}`);
                }
              }
            } catch (e) {
              console.warn(`⚠️ [Playwright] Offer ${index} condition sidebar'dan çekilemedi: ${e.message}`);
            }
          } else {
            // Diğer offer'lar için: offer içinde condition text'i bul
            try {
              const conditionElement = await offerElement.$('span#aod-condition-text, span.a-color-state, #aod-offer-heading span.a-size-base.a-text-bold').catch(() => null);
              if (conditionElement) {
                let rawCondition = await conditionElement.textContent().then(t => t.trim()).catch(() => null);
                if (rawCondition) {
                  // KRİTİK: Condition stringini temizle - fazla boşluk ve newline'ları kaldır
                  condition = rawCondition.replace(/\s+/g, ' ').trim();
                  console.log(`✅ [Playwright] Offer ${index} condition sidebar'dan çekildi: ${condition}`);
                }
              }
            } catch (e) {
              // Condition bulunamadı
            }
          }
        }
      } catch (e) {
        console.warn(`⚠️ [Playwright] Offer ${index} condition çekilirken hata: ${e.message}`);
      }
      
      // New/Used kontrolü - KRİTİK: Modal'da gösterilecek
      if (condition) {
        const conditionLower = condition.toLowerCase().trim();
        if (conditionLower === 'new' || conditionLower.startsWith('new')) {
          isNew = true;
          isUsed = false;
        } else if (conditionLower.includes('used') || conditionLower.startsWith('used')) {
          isNew = false;
          isUsed = true;
        }
      } else {
        // Condition bulunamadıysa, text içinde "New" veya "Used" ara
        try {
          const allText = await offerElement.textContent();
          const allTextLower = allText.toLowerCase();
          if (allTextLower.includes('new') && !allTextLower.includes('used')) {
            isNew = true;
            isUsed = false;
            condition = 'New';
          } else if (allTextLower.includes('used')) {
            isNew = false;
            isUsed = true;
            condition = 'Used';
          }
        } catch (e) {
          // Kontrol edilemedi
        }
      }
      
      // Price
      let price = null;
      let priceText = null;
      try {
        // KRİTİK: Önce offer element içinden price'ı bul
        // "$179.99", "$179 . 99" gibi pattern'leri ara
        // Para birimi sembolü ZORUNLU - CSS/URL'den gelen sayıları filtrele
        const priceMatch = offerText.match(/[\$£€]\s*([\d,]+(?:\.\d{1,2})?)/);
        if (priceMatch) {
          const parsedPrice = parseFloat(priceMatch[1].replace(/,/g, ''));
          // Fiyat validasyonu: 0.01 - 9999 arası makul fiyat
          if (parsedPrice > 0 && parsedPrice < 10000) {
            price = parsedPrice;
            priceText = priceMatch[0].trim();
            console.log(`✅ [Playwright] Offer ${index} price offer element'inden çekildi: ${priceText} -> ${price}`);
          } else {
            console.warn(`⚠️ [Playwright] Offer ${index} price regex match (${parsedPrice}) çok yüksek veya düşük, atlanıyor`);
          }
        }
        
        // Eğer bulunamadıysa: liste satırından #aod-price-{index} veya sidebar'dan çek
        if (!price && !priceText) {
          // KRİTİK: Pinned offer için sadece #aod-price-0, diğerleri için sadece kendi index'i
          // #aod-price-0 diğer offer'lar için KULLANILMAMALI - her zaman pinned offer fiyatını döndürür
          if (!isPinnedOffer) {
            try {
              // Önce offer element içinden fiyat elementini bul
              const offerPriceSelectors = [
                '.a-price .a-offscreen',
                'span.a-price-whole',
                '.a-price span[aria-hidden="true"]'
              ];
              for (const sel of offerPriceSelectors) {
                try {
                  const priceEl = await offerElement.$(sel).catch(() => null);
                  if (priceEl) {
                    const raw = await priceEl.textContent().then(t => t.trim()).catch(() => null);
                    if (raw) {
                      // Para birimi sembolü zorunlu - CSS/URL'den gelen sayıları filtrele
                      const priceMatchWithCurrency = raw.match(/[\$£€]\s*([\d,]+(?:\.\d{1,2})?)/);
                      if (priceMatchWithCurrency) {
                        const parsedPrice = parseFloat(priceMatchWithCurrency[1].replace(/,/g, ''));
                        // Fiyat validasyonu: 0.01 - 9999 arası makul fiyat
                        if (parsedPrice > 0 && parsedPrice < 10000) {
                          price = parsedPrice;
                          priceText = raw;
                          console.log(`✅ [Playwright] Offer ${index} price offer element'inden (${sel}): ${price}`);
                          break;
                        }
                      }
                    }
                  }
                } catch (e) { /* next selector */ }
              }
              
              // Eğer hala bulunamadıysa, index'li selector dene
              if (!price) {
                const rowPriceEl = await page.$(`#aod-price-${index} span[aria-hidden="true"], #aod-price-${index} .a-offscreen`).catch(() => null);
                if (rowPriceEl) {
                  const raw = await rowPriceEl.textContent().then(t => t.trim()).catch(() => null);
                  if (raw) {
                    const priceMatchWithCurrency = raw.match(/[\$£€]\s*([\d,]+(?:\.\d{1,2})?)/);
                    if (priceMatchWithCurrency) {
                      const parsedPrice = parseFloat(priceMatchWithCurrency[1].replace(/,/g, ''));
                      if (parsedPrice > 0 && parsedPrice < 10000) {
                        price = parsedPrice;
                        priceText = raw;
                        console.log(`✅ [Playwright] Offer ${index} price #aod-price-${index} 'den çekildi: ${price}`);
                      }
                    }
                  }
                }
              }
            } catch (e) { /* row price skip */ }
          } else {
            // Pinned offer için sadece #aod-price-0 kullan
            try {
              const priceElement = await page.$('#aod-price-0 span[aria-hidden="true"], #aod-price-0 .a-offscreen').catch(() => null);
              if (priceElement) {
                priceText = await priceElement.textContent().then(t => t.trim()).catch(() => null);
                if (priceText) {
                  const priceMatchWithCurrency = priceText.match(/[\$£€]\s*([\d,]+(?:\.\d{1,2})?)/);
                  if (priceMatchWithCurrency) {
                    const parsedPrice = parseFloat(priceMatchWithCurrency[1].replace(/,/g, ''));
                    if (parsedPrice > 0 && parsedPrice < 10000) {
                      price = parsedPrice;
                      console.log(`✅ [Playwright] Offer ${index} price sidebar (#aod-price-0): ${price}`);
                    }
                  }
                }
              }
            } catch (e) { /* sidebar price skip */ }
          }
          if (!price && !priceText) {
            console.warn(`⚠️ [Playwright] Offer ${index} price sidebar'dan çekilemedi, offer element'e fallback`);
          }
        }
        
        // KRİTİK: Fiyat validasyonu - 10000'den büyük fiyatlar muhtemelen CSS/URL'den geliyor
        if (price && price >= 10000) {
          console.warn(`⚠️ [Playwright] Offer ${index} price çok yüksek (${price}), muhtemelen hatalı - sıfırlanıyor`);
          price = null;
          priceText = null;
        }
        
        // Eğer hala bulunamadıysa, normal yöntemi kullan
        if (!price && !priceText) {
          // Price selector'ları
          const priceSelectors = [
            'span.a-price .a-offscreen',
            'span.a-price-whole',
            'span.a-price span[aria-hidden="true"]',
            '.a-price'
          ];
          
          for (const selector of priceSelectors) {
            try {
              priceText = await offerElement.$eval(selector, (el) => {
                // .a-offscreen içindeki text'i al
                if (el.classList.contains('a-offscreen')) {
                  return el.textContent.trim();
                }
                // Veya parent'tan al
                const parent = el.closest('.a-price');
                if (parent) {
                  const offscreen = parent.querySelector('.a-offscreen');
                  if (offscreen) return offscreen.textContent.trim();
                  return parent.textContent.trim();
                }
                return el.textContent.trim();
              }).catch(() => null);
              
              if (priceText) {
                // Fiyatı parse et - "$134.99" -> 134.99
                const priceMatch = priceText.match(/[\$£€]?\s*([\d,]+\.?\d*)/);
                if (priceMatch) {
                  price = parseFloat(priceMatch[1].replace(/,/g, ''));
                }
                break;
              }
            } catch (e) {
              continue;
            }
          }
          
          // Eğer hala bulunamadıysa, tüm text'ten çıkar
          if (!price && !priceText) {
            const allText = await offerElement.textContent();
            const priceMatch = allText.match(/[\$£€]?\s*([\d,]+\.?\d*)/);
            if (priceMatch) {
              price = parseFloat(priceMatch[1].replace(/,/g, ''));
              priceText = priceMatch[0];
            }
          }
        }
      } catch (e) {
        console.warn(`⚠️ [Playwright] Price çekilemedi: ${e.message}`);
      }
      
      // Ships from
      let shipsFrom = null;
      try {
        // KRİTİK: Önce offer element içinden shipsFrom'u bul
        // "Ships from Amazon.com" formatından "Amazon.com" çıkar
        const shipsFromMatch = offerText.match(/Ships from\s+([^\n\r]+)/i);
        if (shipsFromMatch) {
          shipsFrom = shipsFromMatch[1].trim();
          console.log(`✅ [Playwright] Offer ${index} shipsFrom offer element'inden çekildi: ${shipsFrom}`);
        }
        
        // Eğer bulunamadıysa, sidebar veya offer içinden shipsFrom çek (DOM: .a-col-right = değer sütunu)
        if (!shipsFrom) {
          const getShipsFromValue = async (container) => {
            if (!container) return null;
            const colRight = await container.$('.a-col-right .a-size-small.a-color-base, .a-fixed-left-grid-col.a-col-right span').catch(() => null);
            if (colRight) {
              const t = await colRight.textContent().then(x => x && x.trim()).catch(() => null);
              if (t && !/^Ships from$/i.test(t)) return t;
            }
            const full = await container.textContent().then(t => t.trim()).catch(() => null);
            if (full) {
              const m = full.match(/Ships from\s+(.+?)(?:\s+Sold by|\s*$)/is);
              if (m) return m[1].trim();
            }
            return null;
          };
          if (isPinnedOffer) {
            try {
              const block = await page.$('#aod-offer-shipsFrom').catch(() => null);
              shipsFrom = await getShipsFromValue(block);
              if (shipsFrom) console.log(`✅ [Playwright] Offer ${index} shipsFrom (.a-col-right) çekildi: ${shipsFrom}`);
            } catch (e) {
              console.warn(`⚠️ [Playwright] Offer ${index} shipsFrom sidebar'dan çekilemedi: ${e.message}`);
            }
          } else {
            try {
              const block = await offerElement.$('#aod-offer-shipsFrom, [id*="shipsFrom"]').catch(() => null);
              shipsFrom = await getShipsFromValue(block);
              if (shipsFrom) console.log(`✅ [Playwright] Offer ${index} shipsFrom (offer .a-col-right) çekildi: ${shipsFrom}`);
            } catch (e) { /* ships from bulunamadı */ }
          }
        }
      } catch (e) {
        console.warn(`⚠️ [Playwright] Offer ${index} shipsFrom çekilirken hata: ${e.message}`);
      }
      
      // Sold by
      let soldBy = null;
      let sellerName = null;
      let sellerRating = null;
      let sellerRatingCount = null;
      let positivePercentage = null;
      try {
        // KRİTİK: Önce offer element içinden soldBy'yi bul
        // "Sold by ..." metninden çıkar
        const soldByMatch = offerText.match(/Sold by\s+([^\n\r]+?)(?:\s+Seller rating|$)/i);
        if (soldByMatch) {
          soldBy = soldByMatch[1].trim();
          sellerName = soldBy;
          console.log(`✅ [Playwright] Offer ${index} soldBy offer element'inden çekildi: ${soldBy} -> sellerName: ${sellerName}`);
        }
        
        // Seller rating - "Seller rating is 5 out of 5 stars"
        const ratingMatch = offerText.match(/(\d+(?:\.\d+)?)\s+out of\s+5\s+stars/i);
        if (ratingMatch) {
          sellerRating = parseFloat(ratingMatch[1]);
          console.log(`✅ [Playwright] Offer ${index} sellerRating offer element'inden çekildi: ${sellerRating}`);
        }
        
        // KRİTİK: Seller rating count - "(77 ratings)" veya "(1,234 ratings)" formatından çıkar
        const ratingCountMatch = offerText.match(/\((\d{1,3}(?:,\d{3})*|\d+)\s*(?:ratings?|değerlendirme)\)/i);
        if (ratingCountMatch) {
          sellerRatingCount = ratingCountMatch[1].replace(/,/g, '');
          console.log(`✅ [Playwright] Offer ${index} sellerRatingCount offer element'inden çekildi: ${sellerRatingCount}`);
        }
        
        // KRİTİK: Positive percentage - "100% positive" veya "98% positive" formatından çıkar
        const positiveMatch = offerText.match(/(\d+(?:\.\d+)?)\s*%\s*positive/i);
        if (positiveMatch) {
          positivePercentage = parseFloat(positiveMatch[1]);
          console.log(`✅ [Playwright] Offer ${index} positivePercentage offer element'inden çekildi: ${positivePercentage}%`);
        }
        
        // Eğer bulunamadıysa, sidebar'dan soldBy çek
        if (!soldBy) {
          // KRİTİK: Sidebar'dan soldBy çek
          // Pinned offer için: #aod-offer-soldBy (global)
          // Diğer offer'lar için: offer içinde #aod-offer-soldBy veya text içinde
          if (isPinnedOffer) {
            try {
              const soldByBlock = await page.$('#aod-offer-soldBy').catch(() => null);
              if (soldByBlock) {
                const colRight = await soldByBlock.$('.a-col-right a, .a-col-right .a-size-small.a-color-base').catch(() => null);
                if (colRight) {
                  const t = await colRight.textContent().then(x => x && x.trim()).catch(() => null);
                  if (t) {
                    soldBy = t;
                    sellerName = soldBy;
                    console.log(`✅ [Playwright] Offer ${index} soldBy (pinned .a-col-right) çekildi: ${soldBy}`);
                  }
                }
                if (!soldBy) {
                  const soldByText = await soldByBlock.textContent().then(t => t.trim()).catch(() => null);
                  if (soldByText) {
                    const soldByMatch = soldByText.match(/Sold by\s+([^\n\r]+?)(?:\s+Seller rating|$)/i);
                    if (soldByMatch) {
                      soldBy = soldByMatch[1].trim();
                      sellerName = soldBy;
                    }
                    if (!sellerRating) {
                      const ratingMatch = soldByText.match(/(\d+(?:\.\d+)?)\s+out of\s+5\s+stars/i);
                      if (ratingMatch) sellerRating = parseFloat(ratingMatch[1]);
                    }
                    if (!sellerRatingCount) {
                      const ratingCountMatch = soldByText.match(/\((\d{1,3}(?:,\d{3})*|\d+)\s*(?:ratings?|değerlendirme)\)/i);
                      if (ratingCountMatch) sellerRatingCount = ratingCountMatch[1].replace(/,/g, '');
                    }
                    if (!positivePercentage) {
                      const positiveMatch = soldByText.match(/(\d+(?:\.\d+)?)\s*%\s*positive/i);
                      if (positiveMatch) positivePercentage = parseFloat(positiveMatch[1]);
                    }
                  }
                }
              }
              
              // KRİTİK: Pinned offer için #aod-offer-seller-rating elementinden rating bilgilerini çek
              if (!sellerRating || !sellerRatingCount || !positivePercentage) {
                try {
                  const ratingElement = await page.$('#aod-offer-seller-rating, span#seller-rating-count-0').catch(() => null);
                  if (ratingElement) {
                    const ratingText = await ratingElement.textContent().then(t => t.trim()).catch(() => null);
                    if (ratingText) {
                      console.log(`🔍 [Playwright] Pinned offer rating text: ${ratingText.substring(0, 200)}`);
                      
                      // Seller rating
                      if (!sellerRating) {
                        const ratingMatch = ratingText.match(/(?:Seller rating is\s+)?(\d+(?:\.\d+)?)\s+out of\s+5\s+stars/i);
                        if (ratingMatch) {
                          sellerRating = parseFloat(ratingMatch[1]);
                          console.log(`✅ [Playwright] Pinned offer sellerRating #aod-offer-seller-rating'den çekildi: ${sellerRating}`);
                        }
                      }
                      
                      // Seller rating count
                      if (!sellerRatingCount) {
                        const ratingCountMatch = ratingText.match(/\((\d{1,3}(?:,\d{3})*|\d+)\s*(?:ratings?|değerlendirme)\)/i);
                        if (ratingCountMatch) {
                          sellerRatingCount = ratingCountMatch[1].replace(/,/g, '');
                          console.log(`✅ [Playwright] Pinned offer sellerRatingCount #aod-offer-seller-rating'den çekildi: ${sellerRatingCount}`);
                        }
                      }
                      
                      // Positive percentage
                      if (!positivePercentage) {
                        const positiveMatch = ratingText.match(/(\d+(?:\.\d+)?)\s*%\s*positive/i);
                        if (positiveMatch) {
                          positivePercentage = parseFloat(positiveMatch[1]);
                          console.log(`✅ [Playwright] Pinned offer positivePercentage #aod-offer-seller-rating'den çekildi: ${positivePercentage}%`);
                        }
                      }
                    }
                  }
                } catch (ratingError) {
                  console.warn(`⚠️ [Playwright] Pinned offer rating bilgileri çekilirken hata: ${ratingError.message}`);
                }
              }
            } catch (e) {
              console.warn(`⚠️ [Playwright] Offer ${index} soldBy sidebar'dan çekilemedi: ${e.message}`);
            }
          } else {
            // Diğer offer'lar için: offer içinde soldBy — .a-col-right veya link metni
            try {
              const soldByBlock = await offerElement.$('#aod-offer-soldBy, [id*="soldBy"]').catch(() => null);
              if (soldByBlock) {
                const colRight = await soldByBlock.$('.a-col-right a.a-link-normal, .a-col-right .a-size-small.a-color-base').catch(() => null);
                if (colRight) {
                  const t = await colRight.textContent().then(x => x && x.trim()).catch(() => null);
                  if (t) {
                    soldBy = t;
                    sellerName = soldBy;
                    console.log(`✅ [Playwright] Offer ${index} soldBy (offer .a-col-right) çekildi: ${soldBy}`);
                  }
                }
                if (!soldBy) {
                  const soldByText = await soldByBlock.textContent().then(t => t.trim()).catch(() => null);
                  if (soldByText) {
                    const soldByMatch = soldByText.match(/Sold by\s+([^\n\r]+?)(?:\s+Seller rating|$)/i);
                    if (soldByMatch) {
                      soldBy = soldByMatch[1].trim();
                      sellerName = soldBy;
                    }
                    if (!sellerRating) {
                      const ratingMatch = soldByText.match(/(\d+(?:\.\d+)?)\s+out of\s+5\s+stars/i);
                      if (ratingMatch) sellerRating = parseFloat(ratingMatch[1]);
                    }
                    if (!sellerRatingCount) {
                      const ratingCountMatch = soldByText.match(/\((\d{1,3}(?:,\d{3})*|\d+)\s*(?:ratings?|değerlendirme)\)/i);
                      if (ratingCountMatch) sellerRatingCount = ratingCountMatch[1].replace(/,/g, '');
                    }
                    if (!positivePercentage) {
                      const positiveMatch = soldByText.match(/(\d+(?:\.\d+)?)\s*%\s*positive/i);
                      if (positiveMatch) positivePercentage = parseFloat(positiveMatch[1]);
                    }
                  }
                }
              }
            } catch (e) {
              // Sold by bulunamadı
            }
          }
          
          // Eğer hala bulunamadıysa, satıcı linki: a[href*="/sp?seller="]
          if (!soldBy) {
            const sellerLinkSelectors = [
              'a[href*="/sp?seller="]',
              'a#sellerProfileTriggerId',
              'a[href*="seller"]',
              '.aod-information-block a[href*="seller"]'
            ];
            
            for (const selector of sellerLinkSelectors) {
              try {
                const sellerLink = await offerElement.$(selector).catch(() => null);
                if (sellerLink) {
                  const t = await sellerLink.textContent().then(x => x && x.trim()).catch(() => null);
                  if (t) {
                    // "Sold by X" formatından sadece X'i çıkar
                    const soldByMatch = t.match(/Sold by\s+(.+?)(?:\s+Seller rating|\s*$)/i);
                    if (soldByMatch) {
                      soldBy = soldByMatch[1].trim();
                      sellerName = soldBy;
                    } else {
                      soldBy = t;
                      sellerName = soldBy;
                    }
                    
                    // Seller ID'yi link'ten çek
                    const href = await sellerLink.getAttribute('href').catch(() => '');
                    if (href) {
                      const sellerIdMatch = href.match(/seller=([A-Z0-9]+)/i);
                      if (sellerIdMatch) {
                        // sellerId field'ı yoksa eklenebilir
                      }
                    }
                    
                    if (soldBy) {
                      console.log(`✅ [Playwright] Offer ${index} soldBy link'ten çekildi: ${soldBy}`);
                      break;
                    }
                  }
                }
              } catch (e) {
                continue;
              }
            }
          }
          
          // Eğer hala bulunamadıysa, tüm offer text'inden ara
          if (!soldBy) {
            try {
              const fullText = await offerElement.textContent().catch(() => '');
              if (fullText) {
                const soldByMatch = fullText.match(/Sold by\s+([^\n\r]+?)(?:\s+Ships from|\s+Seller rating|\s*$)/i);
                if (soldByMatch) {
                  soldBy = soldByMatch[1].trim();
                  sellerName = soldBy;
                  console.log(`✅ [Playwright] Offer ${index} soldBy full text'ten çekildi: ${soldBy}`);
                }
              }
            } catch (e) {
              // Full text parse başarısız
            }
          }
          
          // Pinned değilse: tıklanan offer için sidebar #aod-offer-soldBy (getSellerInfo'da tıklama yapıldı)
          if (!soldBy && !isPinnedOffer) {
            const globalSoldBy = await page.$('#aod-offer-soldBy').catch(() => null);
            if (globalSoldBy) {
              const t = await globalSoldBy.textContent().then(x => x && x.trim()).catch(() => null);
              if (t) {
                const m = t.match(/Sold by\s+([^\n\r]+?)(?:\s+Seller rating|$)/i);
                if (m) { soldBy = m[1].trim(); sellerName = soldBy; }
                if (!sellerRating) {
                  const ratingMatch = t.match(/(\d+(?:\.\d+)?)\s+out of\s+5\s+stars/i);
                  if (ratingMatch) sellerRating = parseFloat(ratingMatch[1]);
                }
                // KRİTİK: Seller rating count
                if (!sellerRatingCount) {
                  const ratingCountMatch = t.match(/\((\d{1,3}(?:,\d{3})*|\d+)\s*(?:ratings?|değerlendirme)\)/i);
                  if (ratingCountMatch) sellerRatingCount = ratingCountMatch[1].replace(/,/g, '');
                }
                // KRİTİK: Positive percentage
                if (!positivePercentage) {
                  const positiveMatch = t.match(/(\d+(?:\.\d+)?)\s*%\s*positive/i);
                  if (positiveMatch) positivePercentage = parseFloat(positiveMatch[1]);
                }
              }
            }
          }
          
          // KRİTİK: Satıcı değerlendirmelerini #aod-offer-seller-rating elementinden çek
          // Pinned offer için: #aod-offer-seller-rating (global)
          // Diğer offer'lar için: offer içinde #aod-offer-seller-rating veya #seller-rating-count-{iter}
          if (!sellerRating || !sellerRatingCount || !positivePercentage) {
            try {
              let ratingElement = null;
              if (isPinnedOffer) {
                // Pinned offer için global selector
                ratingElement = await page.$('#aod-offer-seller-rating').catch(() => null);
              } else {
                // Diğer offer'lar için: offer içinde veya global
                ratingElement = await offerElement.$('#aod-offer-seller-rating, [id*="seller-rating"]').catch(() => null);
                if (!ratingElement) {
                  // Global selector'ı dene
                  ratingElement = await page.$(`#aod-offer-seller-rating, #seller-rating-count-${index}`).catch(() => null);
                }
              }
              
              if (ratingElement) {
                const ratingText = await ratingElement.textContent().then(t => t.trim()).catch(() => null);
                if (ratingText) {
                  console.log(`🔍 [Playwright] Offer ${index} rating text: ${ratingText.substring(0, 200)}`);
                  
                  // Seller rating - "Seller rating is 5 out of 5 stars" veya "5 out of 5 stars"
                  if (!sellerRating) {
                    const ratingMatch = ratingText.match(/(?:Seller rating is\s+)?(\d+(?:\.\d+)?)\s+out of\s+5\s+stars/i);
                    if (ratingMatch) {
                      sellerRating = parseFloat(ratingMatch[1]);
                      console.log(`✅ [Playwright] Offer ${index} sellerRating #aod-offer-seller-rating'den çekildi: ${sellerRating}`);
                    }
                  }
                  
                  // KRİTİK: Seller rating count - "(33 ratings)" veya "(1 rating)" formatından çıkar
                  if (!sellerRatingCount) {
                    const ratingCountMatch = ratingText.match(/\((\d{1,3}(?:,\d{3})*|\d+)\s*(?:ratings?|değerlendirme)\)/i);
                    if (ratingCountMatch) {
                      sellerRatingCount = ratingCountMatch[1].replace(/,/g, '');
                      console.log(`✅ [Playwright] Offer ${index} sellerRatingCount #aod-offer-seller-rating'den çekildi: ${sellerRatingCount}`);
                    }
                  }
                  
                  // KRİTİK: Positive percentage - "100% positive over last 12 months" formatından çıkar
                  if (!positivePercentage) {
                    const positiveMatch = ratingText.match(/(\d+(?:\.\d+)?)\s*%\s*positive/i);
                    if (positiveMatch) {
                      positivePercentage = parseFloat(positiveMatch[1]);
                      console.log(`✅ [Playwright] Offer ${index} positivePercentage #aod-offer-seller-rating'den çekildi: ${positivePercentage}%`);
                    }
                  }
                }
              }
            } catch (ratingError) {
              console.warn(`⚠️ [Playwright] Offer ${index} rating bilgileri çekilirken hata: ${ratingError.message}`);
            }
          }
        }
      } catch (e) {
        console.warn(`⚠️ [Playwright] Offer ${index} soldBy çekilirken hata: ${e.message}`);
      }
      
      // Delivery date, shipping price, "cannot be shipped" tespiti
      let deliveryDate = null;
      let shippingPrice = null;
      let expressDeliveryDate = null;
      let cannotShipToSelectedCountry = false;
      let deliveryMessage = null; // Modal'da: "Seçili ülkeye gönderilmiyor" veya teslimat metni
      try {
        // KRİTİK: "This item cannot be shipped to your selected delivery location" tespiti
        const cannotShipEl = isPinnedOffer
          ? await page.$('.a-color-error').catch(() => null)
          : await offerElement.$('.a-color-error').catch(() => null);
        if (cannotShipEl) {
          const errText = await cannotShipEl.textContent().then(t => (t || '').trim()).catch(() => '');
          if (/cannot be shipped to your selected|seçili.*gönderilmiyor/i.test(errText)) {
            cannotShipToSelectedCountry = true;
            deliveryMessage = 'Seçili ülkeye gönderilmiyor';
            console.log(`✅ [Playwright] Offer ${index} teslimat: seçili ülkeye gönderilmiyor`);
          }
        }
        if (!cannotShipToSelectedCountry) {
          // KRİTİK: "More" butonuna tıkla (eğer varsa) - shipping bilgilerini görmek için
          // DOM Path: div#aod-offer-price > div.a-fixed-left-grid > div.a-fixed-left-grid-inner > div.a-fixed-left-grid-col a-col-right > div.a-fixed-right-grid > div.a-fixed-right-grid-inner > div.a-fixed-right-grid-col aod-padding-right-10 a-col-left > div.a-row aod-delivery-promi.e > span.a-.ize-ba.e aod-delivery-more aod-unified-more-identifier > span#aod-delivery-more-action > a.a-link-normal aod-delivery-morelink
          if (!isPinnedOffer) {
            try {
              // "More" butonunu bul ve tıkla
              const moreButton = await offerElement.$('a.a-link-normal.aod-delivery-morelink, span#aod-delivery-more-action > a, a[aria-label*="More"][aria-label*="shipping"]').catch(() => null);
              if (moreButton) {
                const buttonText = await moreButton.textContent().then(t => t.trim()).catch(() => '');
                if (buttonText.toLowerCase().includes('more')) {
                  console.log(`🔗 [Playwright] Offer ${index} "More" butonu bulundu, tıklanıyor...`);
                  await moreButton.scrollIntoViewIfNeeded().catch(() => {});
                  await this.safeWait(page, 300);
                  await moreButton.click({ timeout: 10000 }).catch(() => {});
                  await this.safeWait(page, 1000); // Shipping bilgilerinin yüklenmesi için bekle
                  console.log(`✅ [Playwright] Offer ${index} "More" butonuna tıklandı`);
                }
              }
            } catch (moreError) {
              console.warn(`⚠️ [Playwright] Offer ${index} "More" butonu tıklanamadı: ${moreError.message}`);
            }
          }
          
          // data-csa-c-delivery-time / data-csa-c-delivery-price (pinned: sidebar; liste: satır içi)
          let deliverySpan = null;
          if (isPinnedOffer) {
            deliverySpan = await page.$('#unified-delivery-message span[data-csa-c-delivery-time], #mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE span[data-csa-c-delivery-time], [data-csa-c-delivery-time]').catch(() => null);
          } else {
            // KRİTİK: "More" butonuna tıkladıktan sonra shipping bilgilerini çek
            // DOM Path: div#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE > span
            deliverySpan = await offerElement.$('span[data-csa-c-delivery-time]').catch(() => null);
            if (!deliverySpan) {
              // Global selector'ı dene - "More" butonuna tıkladıktan sonra açılan element
              deliverySpan = await page.$(`#unified-delivery-message-${index - 1} span[data-csa-c-delivery-time], div#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE span[data-csa-c-delivery-time]`).catch(() => null);
            }
          }
          if (deliverySpan) {
            deliveryDate = await deliverySpan.getAttribute('data-csa-c-delivery-time').catch(() => null) || await deliverySpan.textContent().then(t => t.trim()).catch(() => null);
            const priceAttr = await deliverySpan.getAttribute('data-csa-c-delivery-price').catch(() => null);
            if (priceAttr) {
              const priceMatch = String(priceAttr).match(/[\$£€]?([\d,]+\.?\d*)/);
              if (priceMatch) shippingPrice = parseFloat(priceMatch[1].replace(/,/g, ''));
            }
          }
          
          // KRİTİK: Express delivery bilgisini çek (eğer varsa) - hem pinned offer hem diğer offer'lar için
          // DOM Path: div#mir-layout-DELIVERY_BLOCK-slot-SECONDARY_DELIVERY_MESSAGE_LARGE
          if (!expressDeliveryDate) {
            try {
              let expressDeliveryElement = null;
              if (isPinnedOffer) {
                // Pinned offer için global selector
                expressDeliveryElement = await page.$('div#mir-layout-DELIVERY_BLOCK-slot-SECONDARY_DELIVERY_MESSAGE_LARGE').catch(() => null);
              } else {
                // Diğer offer'lar için: offer içinde veya global
                expressDeliveryElement = await offerElement.$('div#mir-layout-DELIVERY_BLOCK-slot-SECONDARY_DELIVERY_MESSAGE_LARGE').catch(() => null);
                if (!expressDeliveryElement) {
                  expressDeliveryElement = await page.$(`div#mir-layout-DELIVERY_BLOCK-slot-SECONDARY_DELIVERY_MESSAGE_LARGE, #unified-delivery-message-${index - 1} div#mir-layout-DELIVERY_BLOCK-slot-SECONDARY_DELIVERY_MESSAGE_LARGE`).catch(() => null);
                }
              }
              
              if (expressDeliveryElement) {
                const expressText = await expressDeliveryElement.textContent().then(t => t.trim()).catch(() => null);
                if (expressText) {
                  // "Or fastest delivery February 19 - March 5" formatından tarihi çıkar
                  const expressDateMatch = expressText.match(/((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s*-\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2})|((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s*-\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2})/i);
                  if (expressDateMatch) {
                    expressDeliveryDate = expressDateMatch[0].trim();
                    console.log(`✅ [Playwright] Offer ${index} express delivery date çekildi: ${expressDeliveryDate}`);
                  } else {
                    // Eğer regex match olmazsa, tüm text'i al (zaten tarih formatında olabilir)
                    expressDeliveryDate = expressText.replace(/^Or fastest delivery\s+/i, '').trim();
                    if (expressDeliveryDate && expressDeliveryDate.length > 5) {
                      console.log(`✅ [Playwright] Offer ${index} express delivery date text'ten çekildi: ${expressDeliveryDate}`);
                    } else {
                      expressDeliveryDate = null;
                    }
                  }
                }
              }
            } catch (expressError) {
              console.warn(`⚠️ [Playwright] Offer ${index} express delivery çekilemedi: ${expressError.message}`);
            }
          }
          // Önce offer element içinden delivery bilgilerini çek
          const deliveryMatch = offerText.match(/[\$£€]?\s*([\d,]+\.?\d*)\s+delivery\s+((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2})/i);
          if (deliveryMatch) {
            if (shippingPrice == null) shippingPrice = parseFloat(deliveryMatch[1].replace(/,/g, ''));
            if (!deliveryDate) deliveryDate = deliveryMatch[2].trim();
          } else {
            const shippingMatch = offerText.match(/[\$£€]?\s*([\d,]+\.?\d*)\s+delivery/i);
            if (shippingMatch && shippingPrice == null) shippingPrice = parseFloat(shippingMatch[1].replace(/,/g, ''));
            const dateMatch = offerText.match(/((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2})|(?:February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s*-\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}/i);
            if (dateMatch && !deliveryDate) deliveryDate = dateMatch[0].trim();
          }
          const expressMatch = offerText.match(/fastest\s+delivery\s+((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2})/i);
          if (expressMatch) expressDeliveryDate = expressMatch[1].trim();
          if (deliveryDate || shippingPrice != null) deliveryMessage = [shippingPrice != null ? `$${shippingPrice}` : '', deliveryDate].filter(Boolean).join(' ');
          if (!deliveryDate && !shippingPrice && !expressDeliveryDate && isPinnedOffer) {
            try {
              const standardDeliveryElement = await page.$('#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE > span, #unified-delivery-message span').catch(() => null);
              if (standardDeliveryElement) {
                const standardDeliveryText = await standardDeliveryElement.textContent().then(t => t.trim()).catch(() => null);
                if (standardDeliveryText) {
                  const shippingMatch = standardDeliveryText.match(/[\$£€]?\s*([\d,]+\.?\d*)\s+delivery/i);
                  if (shippingMatch) shippingPrice = parseFloat(shippingMatch[1].replace(/,/g, ''));
                  const dateMatch = standardDeliveryText.match(/((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2})|(?:February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s*-\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}/i);
                  if (dateMatch) deliveryDate = dateMatch[0].trim();
                  deliveryMessage = standardDeliveryText;
                }
              }
              const expressDeliveryElement = await page.$('#mir-layout-DELIVERY_BLOCK-slot-SECONDARY_DELIVERY_MESSAGE_LARGE > span').catch(() => null);
              if (expressDeliveryElement && !expressDeliveryDate) {
                expressDeliveryDate = await expressDeliveryElement.textContent().then(t => t.trim()).catch(() => null);
              }
            } catch (e) {
              console.warn(`⚠️ [Playwright] Offer ${index} delivery sidebar: ${e.message}`);
            }
          }
        }
      } catch (e) {
        console.warn(`⚠️ [Playwright] Offer ${index} delivery bilgisi çekilirken hata: ${e.message}`);
      }
      
      // KRİTİK: Fulfillment Type hesapla (FBA/FBM/SBA)
      // Mantık:
      // - Amazon satıp Amazon gönderiyorsa → SBA
      // - 3. parti satıcı satıp Amazon kargo yapıyorsa → FBA
      // - 3. parti satıcı satıp 3. parti satıcı gönderiyorsa → FBM
      let fulfillmentType = 'FBM'; // Default
      let isFBA = false;
      let isFBM = true; // Default
      let isSBA = false;
      
      try {
        const soldByLower = (soldBy || sellerName || '').toLowerCase().trim();
        const shipsFromLower = (shipsFrom || '').toLowerCase().trim();
        
        const isAmazonSeller = soldByLower.includes('amazon') || soldByLower === 'amazon.com' || soldByLower === 'amazon' || soldByLower === '';
        const isAmazonShipping = shipsFromLower.includes('amazon') || shipsFromLower === 'amazon.com' || shipsFromLower === 'amazon' || shipsFromLower === '';
        
        if (isAmazonSeller && isAmazonShipping) {
          fulfillmentType = 'SBA';
          isSBA = true;
          isFBA = false;
          isFBM = false;
          console.log(`✅ [Playwright] Offer ${index} Fulfillment Type: SBA (Amazon satıyor, Amazon gönderiyor)`);
        } else if (!isAmazonSeller && isAmazonShipping) {
          fulfillmentType = 'FBA';
          isSBA = false;
          isFBA = true;
          isFBM = false;
          console.log(`✅ [Playwright] Offer ${index} Fulfillment Type: FBA (3. parti satıcı satıyor, Amazon gönderiyor)`);
        } else {
          fulfillmentType = 'FBM';
          isSBA = false;
          isFBA = false;
          isFBM = true;
          console.log(`✅ [Playwright] Offer ${index} Fulfillment Type: FBM (3. parti satıcı satıyor, 3. parti satıcı gönderiyor)`);
        }
      } catch (e) {
        console.warn(`⚠️ [Playwright] Offer ${index} Fulfillment type hesaplanamadı: ${e.message}`);
        // Default: FBM
        fulfillmentType = 'FBM';
        isFBM = true;
        isFBA = false;
        isSBA = false;
      }
      
      // KRİTİK: SBA (Amazon satıyor) ve seller bilgisi yoksa "Amazon" kullan — frontend merge eşleşebilsin
      const nameForMerge = (soldBy || sellerName || '').trim();
      const isNameEmpty = !nameForMerge || nameForMerge.toLowerCase() === 'n/a' || nameForMerge.toLowerCase() === 'n.a.';
      if (isSBA && isNameEmpty) {
        sellerName = 'Amazon';
        soldBy = 'Amazon';
        console.log(`✅ [Playwright] Offer ${index} SBA ama seller yok — "Amazon" set edildi (frontend merge için)`);
      }
      
      // KRİTİK: Amazon'un HTML/CSS/JavaScript kodlarını temizle
      const cleanPriceText = this.cleanAmazonHtml(priceText || '');
      const cleanSellerName = this.cleanAmazonHtml(sellerName || '');
      const cleanSoldBy = this.cleanAmazonHtml(soldBy || '');
      const cleanShipsFrom = this.cleanAmazonHtml(shipsFrom || '');
      const cleanDeliveryDate = this.cleanAmazonHtml(deliveryDate || '');
      const cleanExpressDeliveryDate = this.cleanAmazonHtml(expressDeliveryDate || '');
      const cleanDeliveryMessage = this.cleanAmazonHtml(deliveryMessage || '');
      
      // KRİTİK: Amazon'un kendi satıcılarında rating göstermemek için
      // amazon.com, amazon.es, amazon.fr, amazon.co.uk, amazon.co.jp gibi Amazon'un kendi satıcılarında rating yok
      const sellerNameLower = (cleanSellerName || '').toLowerCase().trim();
      const soldByLower = (cleanSoldBy || '').toLowerCase().trim();
      const isAmazonOwnSeller = sellerNameLower.includes('amazon') || 
                                soldByLower.includes('amazon') ||
                                sellerNameLower === 'amazon.com' ||
                                soldByLower === 'amazon.com' ||
                                sellerNameLower === 'amazon' ||
                                soldByLower === 'amazon';
      
      // Amazon'un kendi satıcıları için rating bilgilerini null yap
      let finalSellerRating = sellerRating;
      let finalSellerRatingCount = sellerRatingCount;
      let finalPositivePercentage = positivePercentage;
      if (isAmazonOwnSeller) {
        console.log(`🔍 [Playwright] Offer ${index} Amazon'un kendi satıcısı tespit edildi, rating bilgileri null yapılıyor: ${cleanSellerName || cleanSoldBy}`);
        finalSellerRating = null;
        finalSellerRatingCount = null;
        finalPositivePercentage = null;
      }
      
      return {
        index: index,
        condition: condition,
        isNew: isNew, // Modal'da gösterilecek: New mi?
        isUsed: isUsed, // Modal'da gösterilecek: Used mi?
        price: price,
        priceText: cleanPriceText,
        shipsFrom: cleanShipsFrom,
        soldBy: cleanSoldBy,
        sellerName: cleanSellerName,
        // KRİTİK: Fulfillment Type (FBA/FBM/SBA)
        fulfillmentType: fulfillmentType,
        isFBA: isFBA,
        isFBM: isFBM,
        isSBA: isSBA,
        // KRİTİK: Satıcı değerlendirme bilgileri - Frontend modalda gösterilecek
        // Amazon'un kendi satıcılarında rating gösterilmez (null)
        sellerRating: finalSellerRating, // Yıldız puanı (1-5) veya null (Amazon satıcıları için)
        sellerRatingCount: finalSellerRatingCount, // Değerlendirme sayısı (örn: "77" veya "1234") veya null (Amazon satıcıları için)
        positivePercentage: finalPositivePercentage, // Pozitif yüzde (örn: 100, 98) veya null (Amazon satıcıları için)
        // KRİTİK: Teslimat bilgileri - Ayrı field'lar olarak (hem text hem date formatı)
        deliveryDate: cleanDeliveryDate, // Standard delivery date (geriye dönük uyumluluk)
        standardDeliveryDate: cleanDeliveryDate, // Standard delivery date
        standardDeliveryDateText: cleanDeliveryDate, // Standard delivery date text (modal'da gösterilecek)
        expressDeliveryDate: cleanExpressDeliveryDate || null, // Express/Fast delivery date
        expressDeliveryDateText: cleanExpressDeliveryDate || null, // Express delivery date text (modal'da gösterilecek)
        // KRİTİK: Gönderim fiyatları - Ayrı field'lar olarak
        shippingPrice: shippingPrice, // Standard shipping price (geriye dönük uyumluluk)
        standardShippingPrice: shippingPrice, // Standard shipping price
        expressShippingPrice: null, // Express shipping price (henüz çekilmiyor, ileride eklenebilir)
        // KRİTİK: Seçili ülkeye gönderilmiyor (navbarda seçili ülkeye gönderim yok)
        cannotShipToSelectedCountry: !!cannotShipToSelectedCountry,
        deliveryMessage: cleanDeliveryMessage || null, // "Seçili ülkeye gönderilmiyor" veya teslimat metni
        isBuybox: !!isPinnedOffer // Pinned offer = Buybox (modal'da "Buybox" etiketi için)
      };
    } catch (e) {
      console.error(`❌ [Playwright] Seller data extraction hatası: ${e.message}`);
      return null;
    }
  }

  /**
   * Get seller information for a product using Playwright
   * @param {string} asin - Product ASIN
   * @param {string} sourceMarketplace - Source marketplace (amazon.com, amazon.co.uk, etc.)
   * @param {string} targetCountry - Target country code (optional)
   * @returns {Promise<{success: boolean, data: Object, error: string | null, status: number}>}
   */
  async getSellerInfo(asin, sourceMarketplace = 'amazon.com', targetCountry = null, opts = {}) {
    let page = null;
    const usePool = !opts.sharedPage;
    try {
      console.log(`🎭 [Seller Playwright] Seller: ${asin} from ${sourceMarketplace} target=${targetCountry || 'default'} (${usePool ? 'pool' : 'shared'})`);
      if (opts.sharedPage) {
        page = opts.sharedPage;
      } else {
        const key = this.getContextKey(sourceMarketplace, targetCountry);
        console.log(`📦 [Seller Playwright] Page pool alınıyor: ${key}`);
        const pool = await this.getPagePool(sourceMarketplace, targetCountry);
        page = this.getNextPage(pool, key);
        console.log(`📦 [Seller Playwright] Sayfa alındı, AOD'a gidiliyor`);
      }
      // Marketplace domain mapping (pool/shared sayfa kullanılıyor — browser/context pool’da)
      const marketplaceDomain = {
        'amazon.com': 'www.amazon.com',
        'amazon.co.uk': 'www.amazon.co.uk',
        'amazon.de': 'www.amazon.de',
        'amazon.es': 'www.amazon.es',
        'amazon.it': 'www.amazon.it',
        'amazon.fr': 'www.amazon.fr',
        'amazon.co.jp': 'www.amazon.co.jp'
      };
      
      const baseDomain = marketplaceDomain[sourceMarketplace] || 'www.amazon.com';
      const baseUrl = `https://${baseDomain}`;
      
      // KRİTİK: Ülke/para seçimi sonrası doğrudan AOD URL (olp-opf-redir) — scroll yok, sadece #aod-filter-offer-count-string kadar
      const productUrl = `${baseUrl}/dp/${asin}`;
      const directAodUrl = `${baseUrl}/dp/${asin}/ref=olp-opf-redir?aod=1&ie=UTF8&condition=NEW&th=1`;
      
      // İlk navigasyon: ülke seçimi gerekiyorsa baseUrl, değilse direkt AOD
      if (targetCountry && !usePool && !opts.sharedPage) {
        console.log(`🌐 [Playwright] Amazon ana sayfa açılıyor (ülke seçimi için): ${baseUrl}`);
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 18000 }); // 30s -> 18s (Railway proxy 504 önleme)
        await this.safeWait(page, 1500);
        console.log(`🌍 [Playwright] Ülke ve para birimi seçimi yapılıyor: ${targetCountry}`);
        const countrySelectionResult = await this.selectCountryAndCurrency(page, targetCountry, sourceMarketplace, productUrl);
        if (!countrySelectionResult.success) {
          console.warn(`⚠️ [Playwright] Ülke ve para birimi seçimi başarısız: ${countrySelectionResult.error}`);
        } else {
          console.log(`✅ [Playwright] Ülke ve para birimi seçimi tamamlandı`);
        }
      }
      
      // Direkt AOD URL — ülke seçimi sonrası veya pool'dan
      // KRİTİK: Timeout 35s (Railway/yavaş ağda 18s yetmiyordu — seller bilgisi çekilemiyordu)
      console.log(`🔗 [Playwright] AOD sayfasına gidiliyor: ${directAodUrl}`);
      let gotoOk = false;
      for (let attempt = 1; attempt <= 2 && !gotoOk; attempt++) {
        try {
          await page.goto(directAodUrl, { waitUntil: 'domcontentloaded', timeout: 18000 }); // 35s -> 18s (Railway proxy 504 önleme)
          gotoOk = true;
        } catch (gotoErr) {
          if (attempt < 2 && (gotoErr.message?.includes('Timeout') || gotoErr.message?.includes('timeout'))) {
            console.warn(`⚠️ [Playwright] AOD goto timeout (deneme ${attempt}/2), tekrar deneniyor...`);
            await this.safeWait(page, 2000);
          } else throw gotoErr;
        }
      }
      await this.safeWait(page, 2000);
      
      // Buybox AOD pinned offer'dan gelecek — PDP atlandı
      let buyboxData = null;
      let isOnAodPage = true;

      // Captcha sayfası kontrolü (AOD linkinde çıkabiliyor)
      try {
        const urlNow = page.url();
        const bodyText = await page.textContent('body').catch(() => '');
        const isCaptchaPage = urlNow.includes('/errors/validateCaptcha') || bodyText.includes('Click the button below to continue shopping');
        if (isCaptchaPage) {
          console.warn(`⚠️ [Playwright] Captcha sayfası tespit edildi (AOD), Continue shopping tıklanıyor...`);
          const btnSelectors = [
            'button[alt="Continue shopping"]',
            'form[action="/errors/validateCaptcha"] button[type="submit"]',
            'form[action="/errors/validateCaptcha"] button',
            'button:has-text("Continue shopping")',
            'button[type="submit"]'
          ];
          for (const sel of btnSelectors) {
            try {
              const btn = await page.$(sel).catch(() => null);
              if (btn) {
                await btn.click({ timeout: 30000 }).catch(() => btn.click({ force: true, timeout: 30000 }));
                await this.safeWait(page, 3000);
                break;
              }
            } catch (e) {
              continue;
            }
          }
        }
      } catch (e) {
        // Captcha kontrolü başarısız olsa bile akışa devam
      }
      
      // Sayfanın yüklenmesini bekle
      await this.safeWait(page, 3000);

      // KRİTİK: directAodUrl ile AOD sidebar bazen açılmıyor (Amazon değişikliği). Container yoksa PDP'den "New & Used" ile aç.
      try {
        await this.safeWait(page, 2000); // Sidebar'ın geç yüklenmesi için
        const aodContainer = await page.$('#aod-offer-list, #aod-pinned-offer, #aod-container, #all-offers-display').catch(() => null);
        if (!aodContainer) {
          console.warn(`⚠️ [Playwright] AOD container direct URL ile bulunamadı, PDP'den "New & Used" ile açılıyor...`);
          await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 18000 }); // 35s -> 18s (Railway proxy 504 önleme)
          await this.safeWait(page, 2500);
          let newAndUsedLink = await page.$('a#aod-ingress-link').catch(() => null);
          if (!newAndUsedLink) {
            newAndUsedLink = await page.$('#dynamic-aod-ingress-box a, a[href*="aod"], a[href*="olp"]').catch(() => null);
          }
          if (!newAndUsedLink) {
            const allLinks = await page.$$('a').catch(() => []);
            for (const link of allLinks.slice(0, 80)) {
              const text = await link.textContent().catch(() => '');
              const href = await link.getAttribute('href').catch(() => '');
              if ((text.includes('New & Used') || text.includes('Other sellers') || href.includes('aod') || href.includes('olp')) && href) {
                newAndUsedLink = link;
                break;
              }
            }
          }
          if (newAndUsedLink) {
            let href = await newAndUsedLink.getAttribute('href').catch(() => null);
            if (href) {
              if (!href.startsWith('http')) href = `${baseUrl}${href.startsWith('/') ? href : '/' + href}`;
              if (href.includes('#') && !href.includes('/gp/offer-listing/')) {
                const aodUrl = `${baseUrl}/gp/offer-listing/${asin}?condition=NEW&ie=UTF8`;
                console.log(`🔗 [Playwright] Hash link tespit edildi, offer-listing URL'ye gidiliyor: ${aodUrl}`);
                await page.goto(aodUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }); // 35s -> 60s (504 önleme)
              } else {
                console.log(`🔗 [Playwright] New & Used href ile gidiliyor: ${href.substring(0, 80)}...`);
                await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 18000 });
              }
              await this.safeWait(page, 3000);
            } else {
              await newAndUsedLink.click({ timeout: 15000 }).catch(() => newAndUsedLink.click({ force: true, timeout: 15000 }));
              await this.safeWait(page, 3000);
            }
          } else {
            const aodUrl = `${baseUrl}/gp/offer-listing/${asin}?condition=NEW&ie=UTF8`;
            console.log(`🔗 [Playwright] New & Used link bulunamadı, klasik offer-listing URL deneniyor: ${aodUrl}`);
            await page.goto(aodUrl, { waitUntil: 'domcontentloaded', timeout: 18000 });
            await this.safeWait(page, 3000);
          }
        }
      } catch (fallbackErr) {
        console.warn(`⚠️ [Playwright] AOD fallback hatası: ${fallbackErr.message}`);
      }

      if (!isOnAodPage) {
        console.log(`⏳ [Playwright] Sayfa yüklendi, "New & Used" linki aranıyor...`);
      
      // "New & Used" linkini bul ve tıkla
      // KRİTİK: "Other sellers" linki de kabul edilmeli (bazı ürünlerde "New & Used" yerine "Other sellers" görünüyor)
      const newAndUsedSelectors = [
        'a#aod-ingress-link',
        '#dynamic-aod-ingress-box a',
        '#olpLinkWidget_feature_div a',
        'div.a-section.a-spacing-none.daodi-content', // KRİTİK: Tam class selector
        'div.daodi-content', // Yeni: div element
        'div[class*="daodi-content"]', // Yeni: class içinde daodi-content geçen div
        'div#dynamic-aod-ingress-box div.daodi-content', // Yeni: tam path
        'div#dynamic-aod-ingress-box div.a-section.a-spacing-none.daodi-content', // KRİTİK: Tam path ile class
        'a[href*="aod"]', // "Other sellers" linki de bu selector'da bulunabilir
        'a[href*="olp"]',
        'span.a-color-base:has-text("New & Used")',
        'a[href*="aod"] span.a-color-base'
      ];
      
      let newAndUsedLink = null;
      console.log(`🔍 [Playwright] "New & Used" linki aranıyor (${newAndUsedSelectors.length} selector)...`);
      
      for (let i = 0; i < newAndUsedSelectors.length; i++) {
        const selector = newAndUsedSelectors[i];
        try {
          console.log(`🔍 [Playwright] Selector ${i + 1}/${newAndUsedSelectors.length} deneniyor: ${selector}`);
          // Hem link hem de div elementlerini kontrol et
          const elements = await page.$$(selector).catch(() => []);
          console.log(`🔍 [Playwright] ${selector} için ${elements.length} element bulundu`);
          
          for (let j = 0; j < elements.length; j++) {
            const element = elements[j];
            try {
              const text = await element.textContent().catch(() => '');
              const tagName = await element.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
              console.log(`🔍 [Playwright] Element ${j + 1} (${tagName}) text: "${text.trim().substring(0, 50)}"`);
              
              // Text içinde "New & Used", "Other sellers", "from" veya "offers" geçiyorsa
              // KRİTİK: "Other sellers" linki de kabul edilmeli
              if (text.includes('New & Used') || text.includes('Other sellers') || text.includes('from') || text.includes('offers') || (text.includes('New') && text.includes('Used'))) {
                // Eğer div ise, parent veya child link'i bul
                if (tagName === 'div') {
                  // Div'in parent'ında link var mı?
                  const parentLink = await element.evaluateHandle(el => {
                    let current = el.parentElement;
                    let depth = 0;
                    while (current && current.tagName !== 'A' && current !== document.body && depth < 10) {
                      current = current.parentElement;
                      depth++;
                    }
                    return current && current.tagName === 'A' ? current : null;
                  }).catch(() => null);
                  
                  if (parentLink && parentLink.asElement()) {
                    newAndUsedLink = parentLink.asElement();
                    console.log(`✅ [Playwright] "New & Used" link bulundu (div parent): ${selector}, text: "${text.trim().substring(0, 80)}"`);
                    break;
                  }
                  
                  // Div'in içinde link var mı?
                  const childLink = await element.$('a').catch(() => null);
                  if (childLink) {
                    newAndUsedLink = childLink;
                    console.log(`✅ [Playwright] "New & Used" link bulundu (div child): ${selector}, text: "${text.trim().substring(0, 80)}"`);
                    break;
                  }
                  
                  // Div'e direkt tıklanabilir mi? (data-cursor-element-id varsa tıklanabilir)
                  const isClickable = await element.evaluate(el => {
                    const style = window.getComputedStyle(el);
                    const hasCursorId = el.getAttribute('data-cursor-element-id');
                    const hasClickHandler = el.onclick || el.getAttribute('onclick');
                    return style.cursor === 'pointer' || hasCursorId || hasClickHandler || el.closest('a');
                  }).catch(() => false);
                  
                  // Eğer div tıklanabilir görünüyorsa veya "New & Used" text'i içeriyorsa, direkt kullan
                  if (isClickable || text.includes('New & Used')) {
                    newAndUsedLink = element;
                    console.log(`✅ [Playwright] "New & Used" div bulundu (tıklanabilir): ${selector}, text: "${text.trim().substring(0, 80)}"`);
                    break;
                  }
                } else {
                  // Direkt link
                  newAndUsedLink = element;
                  console.log(`✅ [Playwright] "New & Used" link bulundu: ${selector}, text: "${text.trim().substring(0, 80)}"`);
                  break;
                }
              }
            } catch (e) {
              console.warn(`⚠️ [Playwright] Element ${j + 1} kontrol hatası: ${e.message}`);
            }
          }
          if (newAndUsedLink) break;
        } catch (e) {
          console.warn(`⚠️ [Playwright] Selector ${selector} hatası: ${e.message}`);
          continue;
        }
      }
      
      if (!newAndUsedLink) {
        // Alternatif: Direkt a#aod-ingress-link selector'ını dene
        console.log(`🔍 [Playwright] Alternatif yöntem deneniyor: a#aod-ingress-link`);
        try {
          newAndUsedLink = await page.$('a#aod-ingress-link');
          if (newAndUsedLink) {
            const text = await newAndUsedLink.textContent().catch(() => '');
            console.log(`✅ [Playwright] "New & Used" link bulundu (alternatif): "${text.trim()}"`);
          } else {
            console.warn(`⚠️ [Playwright] a#aod-ingress-link bulunamadı`);
          }
        } catch (e) {
          console.warn(`⚠️ [Playwright] Alternatif yöntem hatası: ${e.message}`);
        }
      }
      
      // Daha geniş bir arama yap - hem link hem div
      if (!newAndUsedLink) {
        console.log(`🔍 [Playwright] Geniş arama yapılıyor: tüm elementler kontrol ediliyor...`);
        try {
          // Önce #dynamic-aod-ingress-box içindeki tüm elementleri kontrol et
          const aodBox = await page.$('#dynamic-aod-ingress-box').catch(() => null);
          if (aodBox) {
            console.log(`🔍 [Playwright] #dynamic-aod-ingress-box bulundu, içindeki elementler kontrol ediliyor...`);
            const boxElements = await aodBox.$$('*').catch(() => []);
            for (const elem of boxElements) {
              try {
                const text = await elem.textContent().catch(() => '');
                const tagName = await elem.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
                if (text.includes('New & Used') || text.includes('from')) {
                  // Parent link'i bul
                  const parentLink = await elem.evaluateHandle(el => {
                    let current = el;
                    for (let i = 0; i < 5; i++) {
                      if (current.tagName === 'A') return current;
                      current = current.parentElement;
                      if (!current || current === document.body) break;
                    }
                    return null;
                  }).catch(() => null);
                  
                  if (parentLink && parentLink.asElement()) {
                    newAndUsedLink = parentLink.asElement();
                    console.log(`✅ [Playwright] "New & Used" link bulundu (geniş arama - parent): "${text.trim().substring(0, 50)}"`);
                    break;
                  }
                }
              } catch (e) {
                // Devam et
              }
            }
          }
          
          // Hala bulunamadıysa, tüm linkleri kontrol et
          if (!newAndUsedLink) {
            const allLinks = await page.$$('a').catch(() => []);
            console.log(`🔍 [Playwright] Toplam ${allLinks.length} link bulundu, kontrol ediliyor...`);
            
            for (let i = 0; i < Math.min(allLinks.length, 100); i++) {
              const link = allLinks[i];
              try {
                const text = await link.textContent().catch(() => '');
                const href = await link.getAttribute('href').catch(() => '');
                // KRİTİK: "Other sellers" linki de kabul edilmeli
                if ((text.includes('New & Used') || text.includes('Other sellers') || text.includes('from') || text.includes('offers') || href.includes('aod') || href.includes('olp')) && !newAndUsedLink) {
                  newAndUsedLink = link;
                  console.log(`✅ [Playwright] "New & Used" / "Other sellers" link bulundu (geniş arama): "${text.trim().substring(0, 50)}"`);
                  break;
                }
              } catch (e) {
                // Devam et
              }
            }
          }
        } catch (e) {
          console.warn(`⚠️ [Playwright] Geniş arama hatası: ${e.message}`);
        }
      }
      
      let aodAlreadyOpen = false;
      if (!newAndUsedLink) {
        try {
          const aodCount = await page.locator('#aod-offer-list .aod-offer, #aod-container .aod-offer, .aod-offer').count();
          if (aodCount > 0) {
            aodAlreadyOpen = true;
            console.log(`✅ [Playwright] "New & Used" link bulunamadı ama AOD listesi açık (${aodCount} offer). Click atlanacak.`);
          }
        } catch (_) {
          aodAlreadyOpen = false;
        }
      }

      if (!newAndUsedLink && !aodAlreadyOpen) {
        console.warn(`⚠️ [Playwright] "New & Used" / "Other sellers" link bulunamadı - Sayfa URL: ${page.url()}`);
        console.log(`✅ [Playwright] Tek satıcılı ürün - Sadece buybox bilgileri döndürülüyor`);
        
        // KRİTİK: "New & Used" linki yoksa, bu ürün tek satıcılı demektir
        // Bu durumda sadece buybox bilgilerini döndür
        if (buyboxData) {
          return {
            success: true,
            data: {
              asin: asin,
              sourceMarketplace: sourceMarketplace,
              targetCountry: targetCountry,
              totalSellers: 1, // Tek satıcı (buybox)
              sellers: [buyboxData], // Sadece buybox satıcısı
              marketplace: 'source',
              buybox: buyboxData,
              singleSeller: true // Tek satıcı olduğunu belirt
            },
            error: null,
            status: 200
          };
        } else {
          // Buybox bilgisi de yoksa hata döndür
          return {
            success: false,
            data: null,
            error: 'New & Used / Other sellers link bulunamadı ve buybox bilgisi çekilemedi',
            status: 404
          };
        }
      }
      
      // "New & Used" linkine/div'ine tıkla (AOD zaten açıksa click atlanır)
      // KRİTİK: Element görünür olmayabilir, href'den URL'yi al ve direkt git (daha güvenilir)
      if (!aodAlreadyOpen) {
      console.log(`🖱️ [Playwright] "New & Used" elementine tıklanıyor...`);
      
      // Önce href'den URL'yi al (en güvenilir yöntem - element görünür olmasa bile çalışır)
      let href = null;
      try {
        // Önce getAttribute ile dene (daha güvenilir)
        href = await newAndUsedLink.getAttribute('href').catch(() => null);
        
        // Eğer yoksa, evaluate ile dene
        if (!href) {
          href = await newAndUsedLink.evaluate(el => {
            // Önce kendi href'ini kontrol et
            if (el.href) return el.href;
            // Sonra parent <a> tag'ini kontrol et
            const parentLink = el.closest('a');
            if (parentLink && parentLink.href) return parentLink.href;
            // Son olarak href attribute'unu kontrol et
            if (el.getAttribute('href')) return el.getAttribute('href');
            return null;
          }).catch(() => null);
        }
        
        // Hala yoksa, page context'inde querySelector ile dene
        if (!href) {
          const selector = await newAndUsedLink.evaluate(el => {
            // Element için unique selector oluştur
            if (el.id) return `#${el.id}`;
            if (el.className) return `.${el.className.split(' ')[0]}`;
            return null;
          }).catch(() => null);
          
          if (selector) {
            href = await page.$eval(selector, el => {
              if (el.href) return el.href;
              const parentLink = el.closest('a');
              if (parentLink && parentLink.href) return parentLink.href;
              return el.getAttribute('href');
            }).catch(() => null);
          }
        }
        
        if (href) {
          // Relative URL ise absolute URL'ye çevir
          if (!href.startsWith('http')) {
            href = `https://www.amazon.com${href.startsWith('/') ? href : '/' + href}`;
          }
          console.log(`🔗 [Playwright] href'den URL alındı: ${href}`);
          
          // KRİTİK: Hash URL (#dynamic-aod-ingress-box) ise, doğru AOD URL'yi oluştur
          if (href.includes('#dynamic-aod-ingress-box') || href.includes('ref=dp_product_quick_view')) {
            console.log(`🔗 [Playwright] Hash URL tespit edildi, doğru AOD URL oluşturuluyor...`);
            try {
              // Önce link'e JavaScript ile tıkla (sidebar'ı açmak için)
              await newAndUsedLink.evaluate(el => {
                // Event trigger et
                const clickEvent = new MouseEvent('click', {
                  bubbles: true,
                  cancelable: true,
                  view: window
                });
                el.dispatchEvent(clickEvent);
              });
              console.log(`✅ [Playwright] Hash URL için JavaScript event trigger edildi`);
              await this.safeWait(page, 2000); // Sidebar'ın açılması için bekle
              
              // Eğer sidebar hala açılmadıysa, doğru AOD URL'yi oluştur
              const currentUrl = page.url();
              // URL'den domain'i al (https://www.amazon.com veya https://www.amazon.co.uk gibi)
              const urlObj = new URL(currentUrl);
              const domain = `${urlObj.protocol}//${urlObj.host}`;
              // ASIN'den AOD URL'yi oluştur (domain + /gp/offer-listing/...)
              const aodUrl = `${domain}/gp/offer-listing/${asin}/ref=dp_olp_NEW_mbc?ie=UTF8&condition=NEW`;
              console.log(`🔗 [Playwright] AOD URL oluşturuldu: ${aodUrl}`);
              await page.goto(aodUrl, { waitUntil: 'domcontentloaded', timeout: 18000 });
              console.log(`✅ [Playwright] AOD sayfasına gidildi (hash URL fallback)`);
            } catch (jsError) {
              console.warn(`⚠️ [Playwright] Hash URL işleme başarısız, normal click deneniyor: ${jsError.message}`);
              // Fallback: Normal click
              await newAndUsedLink.click({ timeout: 30000 });
            }
          } else {
            // Normal URL ise direkt git
            await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 35000 });
            console.log(`✅ [Playwright] "New & Used" sayfasına direkt gidildi (href kullanılarak)`);
          }
        } else {
          throw new Error('href bulunamadı, normal click deneniyor');
        }
      } catch (hrefError) {
        console.warn(`⚠️ [Playwright] href bulunamadı veya git başarısız, normal click deneniyor: ${hrefError.message}`);
        
        // href başarısız, normal click dene
        try {
          // Element tipini kontrol et
          const tagName = await newAndUsedLink.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
          console.log(`🔍 [Playwright] Element tipi: ${tagName}`);
          
          await newAndUsedLink.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
          await this.safeWait(page, 1000);
          
          // Eğer div ise, önce parent link'i dene
          if (tagName === 'div') {
            try {
              // Div'in parent'ında link var mı kontrol et
              const parentLink = await newAndUsedLink.evaluateHandle(el => {
                let current = el.parentElement;
                let depth = 0;
                while (current && current.tagName !== 'A' && current !== document.body && depth < 10) {
                  current = current.parentElement;
                  depth++;
                }
                return current && current.tagName === 'A' ? current : null;
              }).catch(() => null);
              
              if (parentLink && parentLink.asElement()) {
                console.log(`🔍 [Playwright] Div'in parent link'i bulundu, ona tıklanıyor...`);
                await parentLink.asElement().click({ timeout: 30000 });
                console.log(`✅ [Playwright] Parent link'e tıklandı`);
              } else {
                // Div'e JavaScript ile tıkla
                await newAndUsedLink.evaluate(el => el.click());
                console.log(`✅ [Playwright] Div'e JavaScript ile tıklandı`);
              }
            } catch (divClickError) {
              console.warn(`⚠️ [Playwright] Div click başarısız, force click deneniyor: ${divClickError.message}`);
              await newAndUsedLink.click({ force: true, timeout: 30000 });
              console.log(`✅ [Playwright] Div'e force click ile tıklandı`);
            }
          } else {
            // Normal link
            await newAndUsedLink.click({ timeout: 30000 });
            console.log(`✅ [Playwright] "New & Used" linkine tıklandı`);
          }
        } catch (clickError) {
          console.warn(`⚠️ [Playwright] Normal click başarısız, force click deneniyor: ${clickError.message}`);
          try {
            await newAndUsedLink.click({ force: true, timeout: 30000 });
            console.log(`✅ [Playwright] "New & Used" elementine force click ile tıklandı`);
          } catch (forceClickError) {
            console.error(`❌ [Playwright] Force click de başarısız: ${forceClickError.message}`);
            // Son çare: AOD URL'yi manuel oluştur
            const currentUrl = page.url();
            const baseUrl = currentUrl.split('?')[0];
            const aodUrl = `${baseUrl}?showAllOffers=1`;
            console.log(`🔗 [Playwright] Son çare: AOD URL'ye gidiliyor: ${aodUrl}`);
            await page.goto(aodUrl, { waitUntil: 'domcontentloaded', timeout: 18000 });
            console.log(`✅ [Playwright] AOD sayfasına gidildi (son çare)`);
          }
        }
      }
      
      // 3 saniye bekle (modal/sayfa açılması için)
      console.log(`⏳ [Playwright] Modal/sayfa açılması bekleniyor (3 saniye)...`);
      await this.safeWait(page, 3000);
      }
      // if (!isOnAodPage) block end
      }
      
      // AOD (All Offers Display) container'ını bekle - KRİTİK: Sidebar açılması için bekle
      console.log(`🛒 [Playwright] Seller listesi container'ı bekleniyor (sidebar açılması için)...`);
      try {
        // Önce sidebar container'ını bekle (timeout 10s — Railway proxy 504 önleme)
        await page.waitForSelector('#all-offers-display, #aod-container, #aod-offer-list, #aod-offer, #aod-pinned-offer', { timeout: 10000, state: 'visible' });
        console.log(`✅ [Playwright] Seller listesi container bulundu`);
        
        // KRİTİK: Sidebar'ın tamamen yüklenmesi için ek bekleme
        await this.safeWait(page, 2000);
        
        // Sidebar içeriğinin yüklenmesini kontrol et
        const sidebarLoaded = await page.evaluate(() => {
          const pinnedOffer = document.querySelector('#aod-pinned-offer');
          const offerList = document.querySelector('#aod-offer-list');
          return !!(pinnedOffer || offerList);
        }).catch(() => false);
        
        if (sidebarLoaded) {
          console.log(`✅ [Playwright] Sidebar içeriği yüklendi`);
        } else {
          console.warn(`⚠️ [Playwright] Sidebar içeriği henüz yüklenmedi, ek bekleme...`);
          await this.safeWait(page, 2000);
        }
      } catch (e) {
        console.warn(`⚠️ [Playwright] Seller listesi container bulunamadı, devam ediliyor: ${e.message}`);
      }
      await this.safeWait(page, 1000);
      
      // Toplam satıcı sayısını bul
      let totalSellers = 0;
      try {
        // Önce "#aod-filter-offer-count-string" elementinden sayıyı çıkar
        // "2 other options" formatından sayıyı çıkar
        const offerCountElement = await page.$('#aod-filter-offer-count-string').catch(() => null);
        if (offerCountElement) {
          const offerCountText = await offerCountElement.textContent().then(t => t.trim()).catch(() => '');
          if (offerCountText) {
            // "2 other options" veya "5 other options" formatından sayıyı çıkar
            const match = offerCountText.match(/(\d+)\s+other\s+options?/i);
            if (match) {
              const otherOptions = parseInt(match[1], 10);
              totalSellers = otherOptions + 1; // +1 for pinned offer
              console.log(`✅ [Playwright] Toplam satıcı sayısı (#aod-filter-offer-count-string): ${totalSellers} (${otherOptions} other + 1 pinned)`);
            }
          }
        }
        
        // Eğer bulunamadıysa, "New & Used (6) from" formatından sayıyı çıkar
        if (!totalSellers || totalSellers === 0) {
          const newAndUsedText = await page.$eval('a#aod-ingress-link span.a-color-base', (el) => el.textContent.trim()).catch(() => '');
          const match = newAndUsedText.match(/\((\d+)\)/);
          if (match) {
            totalSellers = parseInt(match[1], 10);
            console.log(`✅ [Playwright] Toplam satıcı sayısı (aod-ingress-link): ${totalSellers}`);
          }
        }
      } catch (e) {
        console.warn(`⚠️ [Playwright] Toplam satıcı sayısı bulunamadı: ${e.message}`);
      }
      
      // KRİTİK: Pinned offer için "See more" linkine tıkla (eğer varsa)
      try {
        const seeMoreLink = await page.$('#aod-pinned-offer-show-more-link').catch(() => null);
        if (seeMoreLink) {
          console.log(`🔗 [Playwright] Pinned offer "See more" linki bulundu, tıklanıyor...`);
          try {
            await seeMoreLink.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
            await this.safeWait(page, 500);
            await seeMoreLink.click({ timeout: 10000 });
            console.log(`✅ [Playwright] Pinned offer "See more" linkine tıklandı`);
            await this.safeWait(page, 2000); // Sidebar içeriğinin yüklenmesi için bekle
          } catch (clickError) {
            console.warn(`⚠️ [Playwright] Pinned offer "See more" linkine tıklanamadı: ${clickError.message}`);
          }
        }
      } catch (e) {
        console.warn(`⚠️ [Playwright] Pinned offer "See more" linki kontrol edilemedi: ${e.message}`);
      }

      // KRİTİK: Tüm satıcıları görmek için "See more buying choices" butonuna tıkla
      try {
        // Farklı selector'lar ile ara
        const seeMoreBuyingChoices = await page.$(
          'a.a-link-normal[href*="buyingChoices"], ' +
          'span.a-size-base.a-color-base[role="button"]:has-text("See more buying choices"), ' +
          'div.a-section > a:has-text("See more buying choices"), ' +
          '#aod-see-more-offers, ' +
          '[data-cy="see-more-buying-choices"], ' +
          'a[href*="all-offers-display"]'
        ).catch(() => null);

        if (seeMoreBuyingChoices) {
          console.log(`🔗 [Playwright] "See more buying choices" butonu bulundu, tıklanıyor...`);
          try {
            await seeMoreBuyingChoices.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
            await this.safeWait(page, 500);
            await seeMoreBuyingChoices.click({ timeout: 15000 });
            console.log(`✅ [Playwright] "See more buying choices" butonuna tıklandı`);
            await this.safeWait(page, 3000); // Tüm satıcıların yüklenmesi için bekle

            // Sayfa URL'si değişmiş olabilir, tekrar yükle
            const currentUrl = page.url();
            if (!currentUrl.includes('#all-offers-display')) {
              console.log(`🔄 [Playwright] Sayfa URL'si değişti, tekrar yükleniyor...`);
              await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
              await this.safeWait(page, 2000);
            }
          } catch (clickError) {
            console.warn(`⚠️ [Playwright] "See more buying choices" butonuna tıklanamadı: ${clickError.message}`);
          }
        } else {
          console.log(`ℹ️ [Playwright] "See more buying choices" butonu bulunamadı - zaten tüm satıcılar görünüyor olabilir`);
        }
      } catch (e) {
        console.warn(`⚠️ [Playwright] "See more buying choices" butonu kontrol edilemedi: ${e.message}`);
      }

      // OPTİMİZE: Daha hızlı ve akıllı scroll - 25+20+12=57 adım yerine 8-12 adım kullan
      // Hedef: totalSellers kadar satıcı yükle, max 30 saniye bekleme
      const targetOther = totalSellers > 0 ? Math.max(totalSellers - 1, 1) : 25;
      const maxTarget = Math.min(targetOther, 50); // Max 50 satıcı sınırla

      const getOfferCount = async () => {
        const bySection = await page.$$('#aod-offer-list > div.a-section').then(els => els.length).catch(() => 0);
        if (bySection > 0) return bySection;
        const byDiv = await page.$$('#aod-offer-list > div').then(els => els.length).catch(() => 0);
        if (byDiv > 0) return byDiv;
        const byId = await page.$$('#aod-offer-list [id^="aod-offer-"]').then(els => els.length).catch(() => 0);
        if (byId > 0) return byId;
        const byAny = await page.$$('#aod-offer-list > div[id^="aod-offer"], #aod-offer-list > *').then(els => els.length).catch(() => 0);
        return byAny;
      };

      // OPTİMİZE: Tek döngü ile daha akıllı scroll - max 12 adım, erken çıkış
      let prevCount = 0;
      let noIncreaseRounds = 0;
      const maxScrollRounds = 12; // Önceden 25+20+12=57, şimdi 12

      for (let round = 0; round < maxScrollRounds && noIncreaseRounds < 4; round++) {
        const currentCount = await getOfferCount();

        // Erken çıkış koşulları
        if (currentCount >= maxTarget) break;
        if (currentCount >= 30 && targetOther <= 30) break; // Yeterli sayıda satıcı varsa çık

        if (currentCount <= prevCount) {
          noIncreaseRounds++;
        } else {
          noIncreaseRounds = 0;
        }
        prevCount = currentCount;

        try {
          // Daha hızlı scroll: büyük adım + scrollIntoView
          await page.evaluate(() => {
            const list = document.querySelector('#aod-offer-list');
            const container = document.querySelector('#aod-container, #all-offers-display');

            // Büyük adımda scroll
            [list, container].filter(Boolean).forEach(el => {
              if (el.scrollHeight > el.clientHeight) {
                el.scrollTop = Math.min(el.scrollTop + 800, el.scrollHeight); // 400'den 800'e
              }
            });

            // Son element görünür yap
            const lastChild = list ? list.lastElementChild : null;
            if (lastChild) lastChild.scrollIntoView({ block: 'end', behavior: 'auto' });
          });

          // OPTİMİZE: Bekleme süresini kısalt - 2500ms'den 1000ms'ye
          await this.safeWait(page, 1000);
        } catch (e) {
          console.warn(`⚠️ [Playwright] Scroll hatası (round ${round}): ${e.message}`);
          break;
        }
      }

      // Son scroll ve kısa bekleme
      await this.safeWait(page, 500);

      // Tüm seller offer'larını çek - KRİTİK: Sidebar'dan tüm bilgileri çek (ilk 2 değil, hedef sayısına kadar)
      const sellers = [];
      let uniqueSellers = [];
      try {
        // Önce pinned offer'ı çek (eğer varsa) - Sidebar'dan
        try {
          const pinnedOffer = await page.$('#aod-pinned-offer').catch(() => null);
          if (pinnedOffer) {
            console.log(`🔍 [Playwright] Pinned offer bulundu, sidebar'dan bilgiler çekiliyor...`);
            const pinnedSellerData = await this.extractSellerDataFromOffer(page, pinnedOffer, 0, true);
            if (pinnedSellerData) {
              sellers.push(pinnedSellerData);
              console.log(`✅ [Playwright] Pinned offer sidebar'dan çekildi: ${pinnedSellerData.sellerName || pinnedSellerData.soldBy || 'N/A'}`);
            }
          }
        } catch (e) {
          console.warn(`⚠️ [Playwright] Pinned offer çekilemedi: ${e.message}`);
        }
        
        // Diğer offer'ları bul — hem doğrudan çocuk hem liste içi .a-section; hedef sayıya kadar scroll + tekrar dene
        let offerElements = await page.$$('#aod-offer-list > div.a-section').catch(() => []);
        if (offerElements.length === 0) offerElements = await page.$$('#aod-offer-list > div').catch(() => []);
        if (offerElements.length < targetOther) {
          const alt = await page.$$('#aod-offer-list div.a-section').catch(() => []);
          if (alt.length > offerElements.length) offerElements = alt;
        }
        if (offerElements.length === 0) offerElements = await page.$$('#aod-offer-list > div[id^="aod-offer"], #aod-offer-list > *').catch(() => []);
        // OPTİMİZE: Retry döngüsünü kısalt - max 3 retry, daha kısa bekleme
        for (let retry = 0; offerElements.length < Math.min(targetOther, 30) && retry < 3; retry++) {
          await page.evaluate(() => {
            const list = document.querySelector('#aod-offer-list');
            const container = document.querySelector('#aod-container, #all-offers-display');
            [list, container].filter(Boolean).forEach(el => { el.scrollTop = el.scrollHeight; });
          });
          // OPTİMİZE: 2000ms'den 800ms'ye bekleme
          await this.safeWait(page, 800);
          offerElements = await page.$$('#aod-offer-list > div.a-section').catch(() => []);
          if (offerElements.length === 0) offerElements = await page.$$('#aod-offer-list > div').catch(() => []);
          if (offerElements.length < Math.min(targetOther, 30)) {
            const alt = await page.$$('#aod-offer-list div.a-section').catch(() => []);
            if (alt.length > offerElements.length) offerElements = alt;
          }
          if (offerElements.length === 0) offerElements = await page.$$('#aod-offer-list > *').catch(() => []);
        }
        // KRİTİK: Tüm bulunan liste satırlarını işle (totalSellers kadar çek - eğer totalSellers 8 ise 8 satıcı çekilmeli)
        // Eğer totalSellers bilinmiyorsa veya 0 ise, DOM'da görünen tüm satırları çek (max 50)
        const maxOther = totalSellers > 0 ? totalSellers : 50;
        console.log(`📊 [Playwright] ASIN ${asin} liste satır sayısı (DOM): ${offerElements.length}, totalSellers (okunan): ${totalSellers}, işlenecek max: ${maxOther}`);
        let processedCount = 0;
        let offerIndex = 0;
        let noProgressCount = 0;
        const scrollAndWait = async () => {
          await page.evaluate(() => {
            const list = document.querySelector('#aod-offer-list');
            const container = document.querySelector('#aod-container, #all-offers-display');
            [list, container].filter(Boolean).forEach(el => { el.scrollTop = el.scrollHeight; });
          });
          // OPTİMİZE: 2000ms'den 800ms'ye
          await this.safeWait(page, 800);
        };
        const getOfferList = async () => {
          let list = await page.$$('#aod-offer-list > div.a-section').catch(() => []);
          if (list.length === 0) list = await page.$$('#aod-offer-list > div').catch(() => []);
          if (list.length === 0) list = await page.$$('#aod-offer-list div.a-section').catch(() => []);
          if (list.length < maxOther) {
            const byId = await page.$$('#aod-offer-list [id^="aod-offer-"]').catch(() => []);
            if (byId.length > list.length) list = byId;
          }
          if (list.length === 0) list = await page.$$('#aod-offer-list > div[id^="aod-offer"], #aod-offer-list > *').catch(() => []);
          return list;
        };
        while (processedCount < maxOther) {
          const listNow = await getOfferList();
          const toProcess = listNow.slice(processedCount, maxOther);
          if (toProcess.length === 0) {
            noProgressCount++;
            if (noProgressCount > 8 || processedCount === 0) break;
            await scrollAndWait();
            await page.evaluate(() => {
              const list = document.querySelector('#aod-offer-list');
              const last = list ? list.lastElementChild : null;
              if (last) last.scrollIntoView({ block: 'end', behavior: 'auto' });
            }).catch(() => {});
            await this.safeWait(page, 2500);
            continue;
          }
          noProgressCount = 0;
          for (let j = 0; j < toProcess.length; j++) {
            const i = offerIndex;
            const offer = toProcess[j];
            try {
              // KRİTİK: Satır içinden veri oku (tıklamaya gerek yok — #aod-price-{i+1}, ships from/sold by/delivery satırda)
              const sellerData = await this.extractSellerDataFromOffer(page, offer, i + 1, false);
              if (sellerData) {
                sellers.push(sellerData);
                console.log(`✅ [Playwright] Seller ${i + 2} satırdan çekildi: ${sellerData.sellerName || sellerData.soldBy || 'N/A'}`);
              }
            } catch (e) {
              console.warn(`⚠️ [Playwright] Seller ${i + 2} satırdan çekilirken hata: ${e.message}`);
            }
            processedCount++;
            offerIndex++;
            await this.safeWait(page, 200);
          }
          if (processedCount >= maxOther) break;
          await scrollAndWait();
        }
        
        console.log(`✅ [Playwright] Toplam ${sellers.length} seller offer çekildi`);
        
        // KRİTİK: Unique seller'ları bul (aynı sellerName veya soldBy'ye sahip offer'ları grupla)
        // Amazon'da bir satıcının birden fazla offer'ı olabilir (New, Used - Like New, vb.)
        const sellerMap = new Map(); // sellerName veya soldBy -> seller data
        
        for (const seller of sellers) {
          // Seller key'i oluştur: sellerName varsa onu kullan, yoksa soldBy, yoksa index
          // KRİTİK: sellerName ve soldBy'yi normalize et (boşlukları temizle, lowercase yap)
          const sellerNameNormalized = seller.sellerName ? seller.sellerName.toLowerCase().trim().replace(/\s+/g, ' ') : null;
          const soldByNormalized = seller.soldBy ? seller.soldBy.toLowerCase().trim().replace(/\s+/g, ' ') : null;
          const sellerKey = (sellerNameNormalized || soldByNormalized || `seller-${seller.index}`).toLowerCase().trim();
          
          // KRİTİK: "N/A", "na", boş veya geçersiz seller name'leri filtrele (unique seller olarak sayma)
          // Bu seller'lar genellikle Amazon tarafından gizlenmiş veya geçersiz seller'lar
          if (!sellerKey || sellerKey === 'n/a' || sellerKey === 'na' || sellerKey.startsWith('seller-') || sellerKey.length < 2) {
            // Seller name bulunamadı veya geçersiz, bu seller'ı atla (unique seller olarak sayma)
            console.log(`⚠️ [Playwright] Geçersiz seller atlandı (unique seller olarak sayılmadı): ${seller.sellerName || seller.soldBy || 'N/A'}`);
            continue; // Bu seller'ı unique seller listesine ekleme
          }
          
          if (!sellerMap.has(sellerKey)) {
            // İlk kez görülen seller, ekle
            sellerMap.set(sellerKey, seller);
            uniqueSellers.push(seller);
          } else {
            // Aynı seller'ın başka bir offer'ı — buybox'ı koru, yoksa en iyi fiyatlı olanı tut
            const existingSeller = sellerMap.get(sellerKey);
            const preferNew = (seller.price && existingSeller.price && seller.price < existingSeller.price) || (seller.isBuybox && !existingSeller.isBuybox);
            if (preferNew) {
              // Yeni satırı kullanırken mevcut buybox bilgisini koru (aynı satıcı 2 kez görünmesin)
              if (existingSeller.isBuybox && !seller.isBuybox) seller.isBuybox = true;
              sellerMap.set(sellerKey, seller);
              const index = uniqueSellers.findIndex(s => {
                const sName = s.sellerName ? s.sellerName.toLowerCase().trim().replace(/\s+/g, ' ') : null;
                const sSoldBy = s.soldBy ? s.soldBy.toLowerCase().trim().replace(/\s+/g, ' ') : null;
                const sKey = (sName || sSoldBy || `seller-${s.index}`).toLowerCase().trim();
                return sKey === sellerKey;
              });
              if (index !== -1) uniqueSellers[index] = seller;
            }
          }
        }
        
        console.log(`🔍 [Playwright] Unique seller sayısı: ${uniqueSellers.length} (toplam offer: ${sellers.length})`);
        
      } catch (e) {
        console.error(`❌ [Playwright] Seller bilgileri çekilirken hata: ${e.message}`);
        uniqueSellers = []; // Hata durumunda boş array
      }
      
      // KRİTİK: Helper fonksiyonlar - buybox kontrolü için gerekli
      const canonicalSellerName = (name) => {
        const raw = (name || '').normalize('NFD').replace(/\u0300-\u036f/g, ''); // diakritik kaldır (à -> a)
        const n = raw.toLowerCase().trim().replace(/\s+/g, ' ');
        if (!n || n.length < 2) return n;
        if (n.includes('amazon')) return 'amazon'; // Amazon, Amazon.com, Amazon EU S.à r.L. vb. tek satıcı
        return n;
      };
      const priceValFor = (s) => (s.price != null && !Number.isNaN(Number(s.price)) ? Number(s.price).toFixed(2) : 'noprice');
      
      // KRİTİK: Buybox satıcısını tekrar göstermemek için - sidebar'daki diğer satıcılardan buybox satıcısını çıkar
      // Buybox satıcısı zaten birinci satıcı olarak gösteriliyor, sidebar'daki listede buybox satıcısı tekrar gösterilmemeli
      // NOT: Normalize etmeden tam eşleşme kullan - çünkü canonicalSellerName tüm Amazon satıcılarını "amazon" yapıyor
      let sellersWithoutDuplicateBuybox = sellers;
      if (buyboxData && sellers.length > 0) {
        const buyboxSellerName = (buyboxData.sellerName || buyboxData.soldBy || '').toLowerCase().trim();
        const buyboxSoldBy = (buyboxData.soldBy || buyboxData.sellerName || '').toLowerCase().trim();
        
        // Sadece pinned offer'ı (ilk satıcı) kontrol et - eğer buybox satıcısı ile tam olarak aynıysa çıkar
        // Diğer satıcıları çıkarma - çünkü farklı condition'larda aynı satıcı olabilir
        sellersWithoutDuplicateBuybox = sellers.filter((seller, idx) => {
          // Sadece ilk satıcıyı (pinned offer) kontrol et
          if (idx === 0 && seller.isBuybox) {
            const sellerName = (seller.sellerName || '').toLowerCase().trim();
            const sellerSoldBy = (seller.soldBy || '').toLowerCase().trim();
            // Tam eşleşme kontrolü (normalize etmeden)
            const isSameAsBuybox = (buyboxSellerName && (sellerName === buyboxSellerName || sellerSoldBy === buyboxSellerName)) ||
                                   (buyboxSoldBy && (sellerName === buyboxSoldBy || sellerSoldBy === buyboxSoldBy));
            if (isSameAsBuybox) {
              console.log(`🔍 [Playwright] Pinned offer buybox satıcısı ile aynı, listeden çıkarılıyor: ${seller.sellerName || seller.soldBy}`);
              return false; // Pinned offer buybox satıcısı ise listeden çıkar
            }
          }
          return true; // Diğer tüm satıcıları göster
        });
      }
      
      // KRİTİK: uniqueSellers KULLANMA - aynı satıcı adına sahip tüm offer'ları tek satıcıda birleştiriyor
      // Örn: 9 offer (New, Used - Very Good, vb.) hepsi "Amazon" -> uniqueSellers sadece 1 satıcı döndürüyor
      // Tüm offer'ları göster (sellersWithoutDuplicateBuybox), sadece tam duplicate'leri filtrele
      let finalSellers = sellersWithoutDuplicateBuybox;
      const seenOfferKey = new Set();
      const nameKeyFor = (s, fallback) => {
        // Normalize et ama canonicalSellerName kullanma - sadece lowercase ve trim yap
        const a = (s.sellerName || '').toLowerCase().trim().replace(/\s+/g, ' ');
        const b = (s.soldBy || '').toLowerCase().trim().replace(/\s+/g, ' ');
        const nameNorm = a || b || '';
        return nameNorm && nameNorm.length >= 2 ? nameNorm : (fallback != null ? fallback : `idx-${s.index ?? seenOfferKey.size}`);
      };
      finalSellers = finalSellers.filter((s, idx) => {
        const nameKey = nameKeyFor(s, null);
        const priceVal = priceValFor(s);
        const conditionVal = (s.condition || '').trim().toLowerCase();
        // KRİTİK: Condition'ı da dahil et - aynı satıcı + aynı fiyat + aynı condition = duplicate
        // Farklı condition'lardaki offer'ları göster (New vs Used - Very Good farklı satırlar)
        const key = `${nameKey}|${priceVal}|${conditionVal}`;
        if (seenOfferKey.has(key)) {
          console.log(`🔍 [Playwright] Çift teklif atlandı (aynı satıcı + aynı fiyat + aynı condition): ${s.sellerName || s.soldBy} @ ${priceVal} (${conditionVal})`);
          return false;
        }
        seenOfferKey.add(key);
        return true;
      });
      // KRİTİK: "Fiyatsız kopya atlandı" kaldırıldı — sayfada 4 teklif varsa 4 satır döndür (fiyat okunamasa bile modalda hepsi görünsün)
      let finalTotalSellers = finalSellers.length;
      
      // KRİTİK: Total seller sayısını, döndürülen listenin uzunluğuna göre düzelt
      if (!finalTotalSellers || finalTotalSellers < finalSellers.length) {
        finalTotalSellers = finalSellers.length;
      }
      
      // KRİTİK: Import charge hesaplama - buyboxShippingWithImport parametresi varsa
      // Bu değer ana sayfadaki buybox'tan çekilen shipping+import toplam fiyatı
      // Pinned offer'ın sidebar'daki shipping fiyatı ile karşılaştırılarak import charge hesaplanır
      const buyboxShippingWithImport = opts.buyboxShippingWithImport;
      let calculatedImportCharge = null;
      
      if (buyboxShippingWithImport != null && !isNaN(buyboxShippingWithImport) && buyboxShippingWithImport > 0) {
        // Pinned offer'ın (buybox satıcısı) sidebar'daki shipping fiyatını bul
        const pinnedOffer = finalSellers.find(s => s.isBuybox === true);
        const pinnedShipping = pinnedOffer?.standardShippingPrice || pinnedOffer?.shippingPrice || 0;
        
        if (pinnedShipping > 0 && buyboxShippingWithImport > pinnedShipping) {
          // Import charge = Buybox'taki toplam - Sidebar'daki shipping
          calculatedImportCharge = parseFloat((buyboxShippingWithImport - pinnedShipping).toFixed(2));
          console.log(`💰 [Playwright] Import charge hesaplandı: $${calculatedImportCharge} (Buybox: $${buyboxShippingWithImport} - Sidebar: $${pinnedShipping})`);
          
          // KRİTİK: FBA ve SBA satıcılara import charge ekle, FBM satıcılara EKLEME
          finalSellers = finalSellers.map(seller => {
            // FBM satıcılara import charge ekleme - kendi shipping'lerini göster
            if (seller.isFBM === true || seller.fulfillmentType === 'FBM') {
              console.log(`📦 [Playwright] FBM satıcı, import charge eklenmedi: ${seller.sellerName || seller.soldBy}`);
              return seller;
            }
            
            // FBA veya SBA satıcılara import charge ekle
            if (seller.isFBA === true || seller.isSBA === true || seller.fulfillmentType === 'FBA' || seller.fulfillmentType === 'SBA') {
              const originalShipping = seller.standardShippingPrice || seller.shippingPrice || 0;
              const totalShipping = parseFloat((originalShipping + calculatedImportCharge).toFixed(2));
              
              console.log(`📦 [Playwright] ${seller.fulfillmentType || 'FBA/SBA'} satıcıya import charge eklendi: ${seller.sellerName || seller.soldBy} - Shipping: $${originalShipping} + Import: $${calculatedImportCharge} = $${totalShipping}`);
              
              return {
                ...seller,
                // Original shipping değerlerini sakla
                originalShippingPrice: originalShipping,
                // Import charge eklenmiş toplam shipping
                shippingPrice: totalShipping,
                standardShippingPrice: totalShipping,
                // Import charge bilgisi (frontend'de gösterilebilir)
                importCharge: calculatedImportCharge,
                shippingWithImport: totalShipping
              };
            }
            
            // Fulfillment type belirlenememiş satıcılar için shipping olduğu gibi bırak
            console.log(`⚠️ [Playwright] Fulfillment type belirlenemedi, import charge eklenmedi: ${seller.sellerName || seller.soldBy}`);
            return seller;
          });
        } else if (pinnedShipping <= 0) {
          console.warn(`⚠️ [Playwright] Pinned offer shipping bulunamadı, import charge hesaplanamadı`);
        } else {
          console.log(`ℹ️ [Playwright] Import charge yok veya negatif (Buybox: $${buyboxShippingWithImport}, Sidebar: $${pinnedShipping})`);
        }
      } else if (buyboxShippingWithImport != null) {
        console.log(`ℹ️ [Playwright] buyboxShippingWithImport geçersiz veya 0: ${buyboxShippingWithImport}`);
      }

      // Log: ASIN başına kaç satıcı bulundu (Railway loglarında "ASIN B000WJIC3G" vb. aranabilir)
      console.log(`📊 [Playwright] ASIN ${asin} için ${finalSellers.length} satıcı bulundu (totalSellers: ${finalTotalSellers})`);
      if (calculatedImportCharge != null) {
        console.log(`💰 [Playwright] Import charge uygulandı: $${calculatedImportCharge} (FBA/SBA satıcılara)`);
      }
      
      // KRİTİK: Seller'ların detaylarını logla
      if (finalSellers.length > 0) {
        console.log(`✅ [Playwright] ASIN ${asin} için seller örnekleri:`, finalSellers.slice(0, 3).map(s => ({
          sellerName: s.sellerName,
          soldBy: s.soldBy,
          price: s.price,
          condition: s.condition,
          isBuybox: s.isBuybox,
          index: s.index
        })));
      } else {
        console.warn(`⚠️ [Playwright] ASIN ${asin} için HİÇ SATICI BULUNAMADI!`);
        console.warn(`⚠️ [Playwright] Debug bilgileri:`, {
          uniqueSellersLength: uniqueSellers.length,
          sellersLength: sellers.length,
          finalSellersLength: finalSellers.length,
          finalTotalSellers: finalTotalSellers
        });
      }
      
      // KRİTİK: Buybox data'yı direkt kullan - finalSellers içinde arama (çünkü buybox satıcısı listeden çıkarılmış olabilir)
      // Buybox data zaten extractBuyboxData'dan geliyor ve condition bilgisi dahil
      const buyboxSeller = buyboxData || finalSellers.find(s => s.isBuybox) || null;
      const responseData = {
        asin: asin,
        sourceMarketplace: sourceMarketplace,
        targetCountry: targetCountry,
        totalSellers: finalTotalSellers,
        sellers: finalSellers,
        marketplace: 'source',
        buybox: buyboxSeller,
        // KRİTİK: Import charge bilgisi - FBA/SBA satıcılara uygulandı
        importCharge: calculatedImportCharge,
        buyboxShippingWithImport: buyboxShippingWithImport || null
      };
      
      console.log(`📤 [Playwright] ASIN ${asin} için response data hazırlanıyor:`, {
        sellersCount: responseData.sellers.length,
        hasBuybox: !!responseData.buybox,
        totalSellers: responseData.totalSellers,
        responseDataKeys: Object.keys(responseData)
      });
      
      return {
        success: true,
        data: responseData,
        error: null,
        status: 200
      };

    } catch (error) {
      console.error(`❌ [Playwright] Seller bilgileri çekilirken hata:`, error.message);
      console.error(`❌ Error stack:`, error.stack);
      return {
        success: false,
        data: null,
        error: error.message,
        status: 500
      };
    } finally {
      // Pool/shared kullanıldığında sayfa ve browser kapatılmaz — tekrar kullanılır
    }
  }

  /**
   * Get seller information for multiple ASINs in a single browser session (10 sekme paralel — vixify-playwright-service-batch mantığı).
   * Ülke + para birimi seçimi 1 kez yapılır, sonra ASIN değiştirerek AOD sayfaları gezilir.
   * @param {string[]} asins
   * @param {string} sourceMarketplace
   * @param {string|null} targetCountry
   * @returns {Promise<{success: boolean, data: Object|null, error: string|null, status: number}>}
   */
  async getSellerInfoBatch(asins, sourceMarketplace = 'amazon.com', targetCountry = null) {
    try {
      const asinList = Array.isArray(asins)
        ? asins.map(a => String(a || '').trim()).filter(Boolean)
        : [];

      if (asinList.length === 0) {
        return { success: false, data: null, error: 'ASIN list is required', status: 400 };
      }

      console.log(`🎭 [Seller Playwright] Batch: ${asinList.length} ASIN, 20 sekme paralel (browser bir kere)`);

      // 1) Browser bir kere, 2) Context + ülke bir kere, 3) 20 sekme pool
      await this.getBrowser();
      await this.getOrCreateContext(sourceMarketplace, targetCountry);
      const pages = await this.getPagePool(sourceMarketplace, targetCountry);
      const key = this.getContextKey(sourceMarketplace, targetCountry);

      const items = [];
      const batchSize = 20;

      for (let i = 0; i < asinList.length; i += batchSize) {
        const batch = asinList.slice(i, i + batchSize);
        const assignedPages = [];
        for (let j = 0; j < batch.length; j++) {
          assignedPages.push(this.getNextPage(pages, key));
        }
        console.log(`📦 [Seller Playwright] Batch ${Math.floor(i / batchSize) + 1}: ${batch.length} ASIN paralel işleniyor (${i + 1}-${i + batch.length}/${asinList.length})`);
        const results = await Promise.all(
          batch.map((asin, j) =>
            this.getSellerInfo(asin, sourceMarketplace, targetCountry, { sharedPage: assignedPages[j] })
          )
        );
        for (let j = 0; j < results.length; j++) {
          const r = results[j];
          const asin = batch[j];
          if (r.success && r.data) {
            items.push({
              asin: r.data.asin || asin,
              sourceMarketplace: r.data.sourceMarketplace || sourceMarketplace,
              targetCountry: r.data.targetCountry != null ? r.data.targetCountry : targetCountry,
              totalSellers: r.data.totalSellers != null ? r.data.totalSellers : (r.data.sellers ? r.data.sellers.length : 0),
              sellers: r.data.sellers || [],
              buybox: r.data.buybox || null
            });
          } else {
            items.push({ asin, sourceMarketplace, targetCountry, totalSellers: 0, sellers: [], buybox: null });
          }
        }
        if (i + batchSize < asinList.length) {
          await new Promise(r => setTimeout(r, 800));
        }
      }

      console.log(`✅ [Seller Playwright] Batch tamamlandı: ${items.length} ürün`);
      return {
        success: true,
        data: { sourceMarketplace, targetCountry, totalItems: items.length, items },
        error: null,
        status: 200
      };
    } catch (error) {
      console.error(`❌ [Seller Playwright] Batch hata:`, error.message);
      return { success: false, data: null, error: error.message, status: 500 };
    } finally {
      await this.closeBrowserAfterBatch();
    }
  }

  /**
   * Envanter güncellemesi bitince tarayıcıyı kapat (ekonomik)
   */
  async closeBrowserAfterBatch() {
    console.log('🔄 [Seller Playwright] Batch tamamlandı — tarayıcı kapatılıyor...');
    try {
      await this.closeBrowserForRecycle();
      console.log('✅ [Seller Playwright] Tarayıcı kapatıldı (yeni istek geldiğinde yeniden açılacak)');
    } catch (e) {
      console.error(`❌ [Seller Playwright] closeBrowserAfterBatch: ${e.message}`);
    }
  }

  /**
   * PDP sayfasından shipping + seller bilgilerini çek (batch-shipping-results formatında)
   * vixify-playwright-service-batch getSellerInfoFromPage mantığı
   */
  async getSellerInfoFromPage(page, asin, sourceMarketplace, targetCountryCode) {
    try {
      if (!page || page.isClosed()) {
        return { success: false, shippingData: null, sellersData: null, error: 'Sayfa kapalı' };
      }
      let buyboxData = await this.extractBuyboxData(page);
      const hasShipping = buyboxData && (buyboxData.rawShippingText || buyboxData.shippingText || (buyboxData.standardShippingPrice != null) || buyboxData.standardDeliveryDate || buyboxData.standardDeliveryDateText);
      if (buyboxData && !hasShipping) {
        await this.safeWait(page, 3000);
        const retryBuybox = await this.extractBuyboxData(page);
        if (retryBuybox && (retryBuybox.rawShippingText || retryBuybox.shippingText || (retryBuybox.standardShippingPrice != null) || retryBuybox.standardDeliveryDate)) {
          buyboxData = retryBuybox;
        }
      }
      if (!buyboxData || (!buyboxData.price && !buyboxData.sellerName && !buyboxData.standardShippingPrice)) {
        return { success: false, shippingData: null, sellersData: null, error: 'Buybox bilgisi çekilemedi' };
      }
      const shippingData = {
        standardShippingPrice: buyboxData.standardShippingPrice || buyboxData.shippingPrice || null,
        expressShippingPrice: buyboxData.expressShippingPrice || null,
        standardDeliveryDate: buyboxData.standardDeliveryDate || buyboxData.standardDeliveryDateText || null,
        expressDeliveryDate: buyboxData.expressDeliveryDate || buyboxData.expressDeliveryDateText || null,
        standardDeliveryDateText: buyboxData.standardDeliveryDateText || buyboxData.standardDeliveryDate || null,
        expressDeliveryDateText: buyboxData.expressDeliveryDateText || buyboxData.expressDeliveryDate || null,
        shippingPriceText: buyboxData.shippingPriceText || buyboxData.shippingText || null,
        rawShippingText: buyboxData.rawShippingText || buyboxData.shippingText || null,
        productPrice: (typeof buyboxData.price === 'number' && buyboxData.price > 0) ? buyboxData.price : null
      };
      // KRİTİK: Amazon'un HTML/CSS/JavaScript kodlarını temizle
      const cleanBuyboxPriceText = this.cleanAmazonHtml(buyboxData.priceText || '');
      const cleanBuyboxSellerName = this.cleanAmazonHtml(buyboxData.sellerName || '');
      const cleanBuyboxSoldBy = this.cleanAmazonHtml(buyboxData.soldBy || buyboxData.sellerName || '');
      const cleanBuyboxShipsFrom = this.cleanAmazonHtml(buyboxData.shipsFrom || '');
      const cleanBuyboxDeliveryDate = this.cleanAmazonHtml(buyboxData.standardDeliveryDate || '');
      const cleanBuyboxExpressDeliveryDate = this.cleanAmazonHtml(buyboxData.expressDeliveryDate || '');
      
      // Diğer satıcıları da çıkar (AOD offer list)
      let otherSellers = [];
      try {
        otherSellers = await this.extractOtherSellersFromAOD(page);
        console.log(`📊 [Seller Playwright] AOD'dan çıkarılan toplam satıcı sayısı: ${1 + otherSellers.length} (${1} buybox + ${otherSellers.length} diğer)`);
      } catch (error) {
        console.warn(`⚠️ [Seller Playwright] Diğer satıcılar çıkarılamadı:`, error.message);
      }

      const sellersData = {
        sellers: [{
          index: 0,
          isBuybox: true,
          condition: buyboxData.condition || 'New',
          isNew: buyboxData.isNew !== false,
          isUsed: buyboxData.isUsed === true,
          price: buyboxData.price,
          priceText: cleanBuyboxPriceText,
          shipsFrom: cleanBuyboxShipsFrom,
          soldBy: cleanBuyboxSoldBy,
          sellerName: cleanBuyboxSellerName,
          fulfillmentType: buyboxData.fulfillmentType || 'FBM',
          isFBA: buyboxData.isFBA || false,
          isFBM: buyboxData.isFBM !== false,
          isSBA: buyboxData.isSBA || false,
          deliveryDate: cleanBuyboxDeliveryDate,
          standardDeliveryDate: cleanBuyboxDeliveryDate,
          expressDeliveryDate: cleanBuyboxExpressDeliveryDate,
          shippingPrice: buyboxData.standardShippingPrice || buyboxData.shippingPrice,
          standardShippingPrice: buyboxData.standardShippingPrice || buyboxData.shippingPrice,
          expressShippingPrice: buyboxData.expressShippingPrice
        }, ...otherSellers],
        marketplace: sourceMarketplace,
        updatedAt: new Date().toISOString()
      };
      return { success: true, shippingData, sellersData, error: null };
    } catch (error) {
      console.error(`❌ [Seller Playwright] getSellerInfoFromPage hatası:`, error.message);
      return { success: false, shippingData: null, sellersData: null, error: error.message };
    }
  }

  /**
   * AOD sayfasından diğer satıcıları çıkar
   */
  async extractOtherSellersFromAOD(page) {
    console.log('🔍 [Seller Playwright] extractOtherSellersFromAOD başladı - FULL MODE');
    try {
      const otherSellers = [];

      // AOD offer list'ini bekle
      console.log('⏳ [Seller Playwright] AOD offer list bekleniyor...');
      const selectorExists = await page
        .locator('#aod-offer-list .aod-offer, #aod-container .aod-offer, .aod-offer')
        .count()
        .then(count => count > 0);
      if (!selectorExists) {
        try {
          await page.waitForSelector('#aod-offer-list .aod-offer, #aod-container .aod-offer, .aod-offer', { timeout: 12000, state: 'attached' });
        } catch (_) {
          console.log('⚠️ [Seller Playwright] AOD offer list bulunamadı, sadece buybox satıcısı var');
          return otherSellers;
        }
      }
      console.log('✅ [Seller Playwright] AOD offer list bulundu');

      // Lazy-load olabilecek satıcılar için scroll dene (sayfa veya container)
      try {
        let lastCount = 0;
        for (let i = 0; i < 8; i++) {
          const countNow = await page.locator('#aod-offer-list .aod-offer, #aod-container .aod-offer, .aod-offer').count();
          if (countNow > lastCount) {
            lastCount = countNow;
          } else if (i >= 2) {
            break;
          }
          await page.evaluate(() => {
            const container = document.querySelector('#aod-offer-list') ||
              document.querySelector('#aod-container') ||
              document.querySelector('#all-offers-display');
            if (container) {
              container.scrollTop = container.scrollHeight;
            } else {
              window.scrollTo(0, document.body.scrollHeight);
            }
          }).catch(() => {});
          await new Promise(r => setTimeout(r, 1200));
        }
      } catch (_) {
        // Scroll hatası önemli değil, devam
      }

      // Diğer satıcıları çıkar - tüm satıcılar
      const offers = await page.$$eval('#aod-offer-list .aod-offer, #aod-container .aod-offer, .aod-offer', (elements) => {
        console.log(`Found ${elements.length} seller elements on AOD page`);
        return elements.map((el, index) => {
          try {
            // Fiyat
            const priceEl = el.querySelector('.a-price .a-offscreen') || el.querySelector('.a-color-price');
            const priceText = priceEl?.textContent?.trim() || '';
            const price = priceText ? parseFloat(priceText.replace(/[^0-9.]/g, '')) : null;

            // Satıcı adı
            const sellerEl = el.querySelector('.a-size-small.a-link-normal, [data-cy="seller-name"]') ||
                           el.querySelector('.a-link-normal[aria-label*="sold by"]') ||
                           el.querySelector('.a-link-normal');
            const sellerName = sellerEl?.textContent?.trim() || '';
            const soldBy = sellerName;

            // Koşul
            const conditionEl = el.querySelector('.a-size-small.a-color-secondary') ||
                              el.querySelector('.a-text-bold + .a-size-small');
            const condition = conditionEl?.textContent?.trim() || 'New';

            // Gönderim
            const shippingEl = el.querySelector('.a-size-small.a-color-secondary:not(.a-text-bold)') ||
                             el.querySelector('.a-row .a-size-small:not(.a-link-normal)');
            const shippingText = shippingEl?.textContent?.trim() || '';

            // FBA/FBM kontrolü
            const isFBA = el.textContent?.includes('FREE Shipping') ||
                         el.textContent?.includes('Fulfilled by Amazon') ||
                         el.querySelector('[aria-label*="FREE Shipping"]') !== null;
            const isSBA = el.textContent?.includes('Ships from') ||
                         el.textContent?.includes('Sold by') ||
                         !isFBA;

            return {
              index: index + 1, // Buybox 0, diğerleri 1'den başlar
              isBuybox: false,
              condition: condition,
              isNew: condition.toLowerCase().includes('new'),
              isUsed: condition.toLowerCase().includes('used'),
              price: price,
              priceText: priceText,
              shipsFrom: '',
              soldBy: soldBy,
              sellerName: sellerName,
              fulfillmentType: isFBA ? 'FBA' : 'FBM',
              isFBA: isFBA,
              isFBM: !isFBA,
              isSBA: isSBA,
              deliveryDate: shippingText,
              standardDeliveryDate: shippingText,
              expressDeliveryDate: '',
              shippingPrice: null,
              standardShippingPrice: null,
              expressShippingPrice: null
            };
          } catch (e) {
            return null;
          }
        }).filter(Boolean);
      });

      otherSellers.push(...offers);
      console.log(`📦 [Seller Playwright] AOD'dan ${otherSellers.length} diğer satıcı çıkarıldı`);
      console.log(`📦 [Seller Playwright] İlk satıcı örneği:`, otherSellers[0] ? {
        sellerName: otherSellers[0].sellerName,
        price: otherSellers[0].price,
        condition: otherSellers[0].condition
      } : 'Hiç satıcı bulunamadı');

      return otherSellers;
    } catch (error) {
      console.warn(`⚠️ [Seller Playwright] Diğer satıcılar çıkarılamadı:`, error.message);
      return [];
    }
  }

  /**
   * Tek ASIN işle — AOD sayfasından shipping + seller (rating dahil) çek.
   * KRİTİK: PDP yerine AOD kullanılıyor — satıcı değerlendirmesi (rating) AOD'da mevcut.
   */
  async processASINWithPage(asin, sourceMarketplace, targetCountryCode, productId, authToken, assignedPage) {
    try {
      let page = assignedPage;
      if (!page || page.isClosed()) {
        const pages = await this.getPagePool(sourceMarketplace, targetCountryCode);
        const key = this.getContextKey(sourceMarketplace, targetCountryCode);
        page = this.getNextPage(pages, key);
      }
      // KRİTİK: getSellerInfo AOD'a gider ve rating'li tam satıcı listesini çeker (PDP buybox'ta rating yok)
      const result = await this.getSellerInfo(asin, sourceMarketplace, targetCountryCode, { sharedPage: page });
      if (!result.success || !result.data) {
        return {
          asin,
          productId: productId || null,
          success: false,
          shippingData: null,
          sellersData: null,
          error: result.error || 'Seller bilgisi çekilemedi'
        };
      }
      const sellers = result.data.sellers || [];
      const buybox = result.data.buybox || sellers[0] || null;
      const shippingData = buybox ? {
        standardShippingPrice: buybox.standardShippingPrice ?? buybox.shippingPrice ?? null,
        expressShippingPrice: buybox.expressShippingPrice ?? null,
        standardDeliveryDateText: buybox.standardDeliveryDateText ?? buybox.standardDeliveryDate ?? buybox.deliveryDate ?? null,
        expressDeliveryDateText: buybox.expressDeliveryDateText ?? buybox.expressDeliveryDate ?? null,
        productPrice: (typeof buybox.price === 'number' && buybox.price > 0) ? buybox.price : null
      } : null;
      const sellersData = sellers.length > 0 ? {
        sellers,
        marketplace: sourceMarketplace,
        updatedAt: new Date().toISOString()
      } : null;
      return {
        asin,
        productId: productId || null,
        success: true,
        shippingData,
        sellersData,
        error: null
      };
    } catch (error) {
      console.error(`❌ [Seller Playwright] ${asin} işlenirken hata:`, error.message);
      return { asin, productId: productId || null, success: false, shippingData: null, sellersData: null, error: error.message };
    }
  }

  /**
   * Envanter güncellemesi batch: Tarayıcı bir kere, ülke seçimi, 20 sekme, ASIN'ler paralel
   * vixify-playwright-service-batch mantığı — maliyet düşürme
   */
  async processBatchInventoryUpdate(asins, sourceMarketplace, targetCountryCode, productIds, authToken) {
    const key = this.getContextKey(sourceMarketplace, targetCountryCode);
    console.log(`📦 [Seller Playwright] processBatchInventoryUpdate: ${asins.length} ASIN | ${sourceMarketplace} | ${targetCountryCode}`);
    try {
      await this.getBrowser();
      await this.getOrCreateContext(sourceMarketplace, targetCountryCode);
      const pages = await this.getPagePool(sourceMarketplace, targetCountryCode);
      if (!pages || pages.length === 0) throw new Error('Page pool oluşturulamadı');
      console.log(`✅ [Seller Playwright] ${pages.length} sekme hazır`);

      const results = [];
      const batchSize = 20;
      for (let i = 0; i < asins.length; i += batchSize) {
        const batch = asins.slice(i, i + batchSize);
        const batchProductIds = productIds ? productIds.slice(i, i + batchSize) : null;
        const validPages = pages.filter(p => p && !p.isClosed());
        const assignedPages = batch.map((_, j) => validPages[j % validPages.length] || pages[j % pages.length]);
        const batchPromises = batch.map((asin, j) => {
          const productId = batchProductIds ? batchProductIds[j] : null;
          return this.processASINWithPage(asin, sourceMarketplace, targetCountryCode, productId, authToken, assignedPages[j]);
        });
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        console.log(`✅ [Seller Playwright] Batch ${Math.floor(i / batchSize) + 1}: ${batchResults.filter(r => r.success).length} başarılı`);
        if (i + batchSize < asins.length) await new Promise(r => setTimeout(r, 1000));
      }

      return results;
    } catch (error) {
      console.error(`❌ [Seller Playwright] processBatchInventoryUpdate hatası:`, error.message);
      throw error;
    } finally {
      await this.closeBrowserAfterBatch();
    }
  }
}

module.exports = new PlaywrightService();
