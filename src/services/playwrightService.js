// Playwright Service - Seller Information Extraction
const { chromium } = require('playwright');

class PlaywrightService {
  constructor() {
    console.log('✅ [Playwright Service] Initializing...');
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
   */
  convertToAmazonCountryCode(countryCode) {
    const map = {
      'usa': 'US',
      'us': 'US',
      'uk': 'GB',
      'germany': 'DE',
      'de': 'DE',
      'france': 'FR',
      'fr': 'FR',
      'italy': 'IT',
      'it': 'IT',
      'spain': 'ES',
      'es': 'ES',
      'japan': 'JP',
      'jp': 'JP',
      'canada': 'CA',
      'ca': 'CA',
      'australia': 'AU',
      'au': 'AU'
    };
    return map[countryCode?.toLowerCase()] || countryCode?.toUpperCase() || 'US';
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

      // KRİTİK: Sayfa yüklendikten sonra ekstra bekleme (seller-playwright-service'teki gibi)
      // Sayfa tam yüklenmesi için bekle
      await this.safeWait(page, 5000);
      console.log(`⏳ [Playwright] Sayfa yükleme sonrası bekleme tamamlandı, "Deliver to" butonu aranıyor...`);

      // "Deliver to" butonunu bul ve tıkla - DOM Path: #nav-global-location-popover-link
      // KRİTİK: Sayfa yüklendikten sonra ekstra bekleme
      await this.safeWait(page, 5000);
      console.log(`⏳ [Playwright] Sayfa yükleme sonrası ekstra bekleme tamamlandı, "Deliver to" butonu aranıyor...`);
      
      // Network idle olmasını bekle (sayfa tam yüklensin) - timeout'u kısalt
      try {
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
          console.warn(`⚠️ [Playwright] Network idle bekleme timeout, devam ediliyor...`);
        });
      } catch (e) {
        console.warn(`⚠️ [Playwright] Network idle hatası: ${e.message}`);
      }
      await this.safeWait(page, 3000);
      
      // KRİTİK: Sayfa title'ını kontrol et - eğer "Amazon.com" ise sayfa tam yüklenmemiş olabilir
      let pageTitle = await page.title().catch(() => '');
      let retryCount = 0;
      const maxTitleRetries = 3;
      
      while ((pageTitle === 'Amazon.com' || pageTitle === 'Amazon' || !pageTitle) && retryCount < maxTitleRetries) {
        console.warn(`⚠️ [Playwright] Sayfa title sadece "Amazon.com" (retry ${retryCount + 1}/${maxTitleRetries}) - sayfa tam yüklenmemiş olabilir, ekstra bekleme...`);
        await this.safeWait(page, 5000);
        
        // Sayfayı yeniden yükle
        try {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
          await this.safeWait(page, 5000);
          console.log(`✅ [Playwright] Sayfa yeniden yüklendi (retry ${retryCount + 1})`);
          
          // Title'ı tekrar kontrol et
          pageTitle = await page.title().catch(() => '');
          if (pageTitle !== 'Amazon.com' && pageTitle !== 'Amazon' && pageTitle) {
            console.log(`✅ [Playwright] Sayfa title düzeldi: "${pageTitle}"`);
            break;
          }
        } catch (reloadError) {
          console.warn(`⚠️ [Playwright] Sayfa reload hatası: ${reloadError.message}`);
        }
        
        retryCount++;
      }
      
      // KRİTİK: Eğer hala title "Amazon.com" ise, sayfanın tam yüklenmesi için ekstra bekleme
      if (pageTitle === 'Amazon.com' || pageTitle === 'Amazon' || !pageTitle) {
        console.warn(`⚠️ [Playwright] Sayfa title hala "Amazon.com" - sayfa tam yüklenmemiş olabilir, ekstra bekleme ve scroll...`);
        await this.safeWait(page, 10000);
        
        // Sayfayı scroll et - navbar'ın yüklenmesi için
        try {
          await page.evaluate(() => {
            window.scrollTo(0, 0);
          });
          await this.safeWait(page, 2000);
          await page.evaluate(() => {
            window.scrollTo(0, 100);
          });
          await this.safeWait(page, 2000);
          console.log(`✅ [Playwright] Sayfa scroll edildi (navbar yüklenmesi için)`);
        } catch (scrollError) {
          console.warn(`⚠️ [Playwright] Scroll hatası: ${scrollError.message}`);
        }
      }
      
      console.log(`🎭 [Playwright] "Deliver to" butonu aranıyor...`);
      const deliverToSelectors = [
        '#nav-global-location-popover-link', // Öncelikli selector
        'a#nav-global-location-popover-link',
        'span#nav-global-location-popover-link',
        'a[data-csa-c-type="button"][id*="nav-global-location"]',
        'a[id*="nav-global-location"]',
        'span[id*="nav-global-location"]',
        'a[aria-label*="Deliver to"]',
        'span[aria-label*="Deliver to"]',
        'a:has-text("Deliver to")',
        'span:has-text("Deliver to")',
        '#nav-global-location-slot',
        '[data-csa-c-slot-id="nav-global-location"]',
        'a[href*="glow=change-country"]',
        'span[data-action="a-popover-trigger"]'
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
        await this.safeWait(page, 10000);
        
        // Sayfayı scroll et ve tekrar ara
        try {
          await page.evaluate(() => {
            window.scrollTo(0, 0);
            // Navbar'ın yüklenmesi için biraz bekle
            return new Promise(resolve => setTimeout(resolve, 2000));
          });
          await this.safeWait(page, 3000);
          
          // Tüm selector'ları tekrar dene
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
      
      // Son çare: Sayfa içeriğinde "Deliver to" text'ini ara
      if (!deliverToButton) {
        console.log(`🔍 [Playwright] "Deliver to" butonu selector'larla bulunamadı, sayfa içeriğinde aranıyor...`);
        try {
          const allLinks = await page.$$('a, span, button');
          for (const link of allLinks) {
            try {
              const text = await link.textContent();
              const ariaLabel = await link.getAttribute('aria-label');
              if ((text && text.includes('Deliver to')) || (ariaLabel && ariaLabel.includes('Deliver to'))) {
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
      await page.waitForSelector('#a-popover-3, .a-popover-wrapper, #GLUX_Popover', { timeout: 15000 }).catch(() => {
        console.warn(`⚠️ [Playwright] Popover selector bulunamadı, devam ediliyor...`);
      });
      await this.safeWait(page, 2000);
      
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
          countryDropdown = await page.waitForSelector(selector, { timeout: 15000, state: 'visible' });
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
      
      // Dropdown'u aç (tıkla)
      try {
        await countryDropdown.click({ timeout: 30000 });
        await this.safeWait(page, 2000);
        console.log(`✅ [Playwright] Dropdown açıldı`);
      } catch (clickError) {
        console.warn(`⚠️ [Playwright] Dropdown click başarısız, force click deneniyor: ${clickError.message}`);
        await countryDropdown.click({ force: true, timeout: 30000 });
        await this.safeWait(page, 2000);
      }
      
      // Ülke seçeneğini bul ve tıkla
      console.log(`🎭 [Playwright] Ülke seçeneği aranıyor: ${amazonCountryCode} (${targetCountryName})...`);
      
      const allOptions = await page.$$eval('a[data-value]', (options) => {
        return options.map(opt => ({
          text: opt.textContent.trim(),
          value: opt.getAttribute('data-value'),
          id: opt.id
        }));
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
      
      // Ülke seçeneğini bul ve tıkla
      const countryOptionSelectors = [
        foundOption.id ? `a#${foundOption.id}` : null,
        `a[data-value="${foundOption.value}"]`,
        `a:has-text("${foundOption.text}")`
      ].filter(Boolean);
      
      let countryOption = null;
      for (const selector of countryOptionSelectors) {
        try {
          countryOption = await page.waitForSelector(selector, { timeout: 10000, state: 'visible' });
          if (countryOption) {
            console.log(`✅ [Playwright] Ülke seçeneği elementi bulundu: ${selector}`);
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
      const doneButtonSelectors = [
        'button[name="glowDoneButton"]',
        'button.a-button-text[name="glowDoneButton"]',
        'span.a-button-inner button[name="glowDoneButton"]',
        'input[name="glowDoneButton"]'
      ];
      
      let doneButton = null;
      for (const selector of doneButtonSelectors) {
        try {
          doneButton = await page.waitForSelector(selector, { timeout: 15000, state: 'visible' });
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
      } catch (clickError) {
        console.log(`⚠️ [Playwright] Normal click başarısız, JS click deneniyor: ${clickError.message}`);
        await page.evaluate(() => {
          const btn = document.querySelector('button[name="glowDoneButton"]');
          if (btn) btn.click();
        });
      }
      await this.safeWait(page, 3000);
      console.log(`✅ [Playwright] "Done" butonuna tıklandı, ülke seçimi tamamlandı`);
      
      // Para birimi seçimi - customer-preferences sayfasına git
      const preferencesUrl = asinUrl 
        ? `${baseUrl}/customer-preferences/edit?ref_=icp_cop_flyout_change&preferencesReturnUrl=${encodeURIComponent(asinUrl)}`
        : `${baseUrl}/customer-preferences/edit?ref_=icp_cop_flyout_change`;
      
      console.log(`🔗 [Playwright] Customer preferences sayfasına gidiliyor: ${preferencesUrl}`);
      await page.goto(preferencesUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.safeWait(page, 3000);
      
      try {
        // Para birimi dropdown butonunu bul ve tıkla
        console.log(`💵 [Playwright] Para birimi dropdown butonu aranıyor...`);
        const currencyDropdownButtonSelectors = [
          'span#icp-currency-dropdown-selected-item-prompt span.a-button-text.a-declarative',
          'span#icp-currency-dropdown-selected-item-prompt span.a-button-text',
          'span#icp-currency-dropdown-selected-item-prompt',
          'span.a-button-text[data-action="a-dropdown-button"]'
        ];
        
        let currencyDropdownButton = null;
        for (const selector of currencyDropdownButtonSelectors) {
          try {
            await page.waitForSelector(selector, { timeout: 15000, state: 'visible' });
            currencyDropdownButton = await page.$(selector);
            if (currencyDropdownButton) {
              console.log(`✅ [Playwright] Currency dropdown butonu bulundu: ${selector}`);
              break;
            }
          } catch (e) {
            continue;
          }
        }
        
        if (!currencyDropdownButton) {
          throw new Error('Currency dropdown butonu bulunamadı');
        }
        
        // Dropdown'u aç
        try {
          await currencyDropdownButton.scrollIntoViewIfNeeded();
          await this.safeWait(page, 500);
          await currencyDropdownButton.click({ timeout: 30000 });
          await this.safeWait(page, 2000);
          console.log(`✅ [Playwright] Para birimi dropdown açıldı`);
        } catch (clickError) {
          console.warn(`⚠️ [Playwright] Dropdown click başarısız, force click deneniyor: ${clickError.message}`);
          await currencyDropdownButton.click({ force: true, timeout: 30000 });
          await this.safeWait(page, 2000);
        }
        
        // Popover açılmasını bekle
        await page.waitForSelector('#a-popover-1, .a-popover-wrapper', { timeout: 10000 }).catch(() => {
          console.warn(`⚠️ [Playwright] Popover selector bulunamadı, devam ediliyor...`);
        });
        await this.safeWait(page, 1000);
        
        // Para birimi seçeneğini bul ve tıkla
        console.log(`💵 [Playwright] Para birimi seçeneği aranıyor: ${targetCurrency}...`);
        
        const allCurrencyOptions = await page.$$eval('a[data-value]', (options) => {
          return options.map(opt => ({
            text: opt.textContent.trim(),
            value: opt.getAttribute('data-value'),
            id: opt.id
          }));
        });
        console.log(`🔍 [Playwright] Para birimi seçenekleri bulundu: ${allCurrencyOptions.length} adet`);
        
        let foundCurrencyOption = null;
        for (const opt of allCurrencyOptions) {
          try {
            const valueObj = JSON.parse(opt.value);
            if (valueObj.stringVal === targetCurrency || opt.text.includes(targetCurrency)) {
              foundCurrencyOption = opt;
              console.log(`✅ [Playwright] Para birimi seçeneği bulundu: ${opt.text} (${opt.value})`);
              break;
            }
          } catch (e) {
            // JSON parse başarısız, string içinde ara
            if (opt.value && (opt.value.includes(targetCurrency) || opt.text.includes(targetCurrency))) {
              foundCurrencyOption = opt;
              console.log(`✅ [Playwright] Para birimi seçeneği bulundu (string match): ${opt.text}`);
              break;
            }
          }
        }
        
        if (!foundCurrencyOption) {
          const sampleOptions = allCurrencyOptions.slice(0, 3).map(opt => opt.text);
          throw new Error(`Para birimi seçeneği bulunamadı: ${targetCurrency}. Toplam ${allCurrencyOptions.length} seçenek var (örnek: ${sampleOptions.join(', ')})`);
        }
        
        // Para birimi seçeneğini bul ve tıkla
        const currencyOptionSelectors = [
          foundCurrencyOption.id ? `a#${foundCurrencyOption.id}` : null,
          `a[data-value="${foundCurrencyOption.value}"]`,
          `li#${targetCurrency} a`,
          `a:has-text("${targetCurrency}")`
        ].filter(Boolean);
        
        let currencyOption = null;
        for (const selector of currencyOptionSelectors) {
          try {
            currencyOption = await page.waitForSelector(selector, { timeout: 10000, state: 'visible' });
            if (currencyOption) {
              console.log(`✅ [Playwright] Para birimi seçeneği elementi bulundu: ${selector}`);
              break;
            }
          } catch (e) {
            continue;
          }
        }
        
        if (!currencyOption) {
          throw new Error(`Para birimi seçeneği elementi bulunamadı: ${foundCurrencyOption.text}`);
        }
        
        // Para birimi seçeneğine tıkla
        try {
          await currencyOption.scrollIntoViewIfNeeded();
          await this.safeWait(page, 500);
          await currencyOption.click({ timeout: 30000 });
          await this.safeWait(page, 2000);
          console.log(`✅ [Playwright] ${targetCurrency} para birimi seçildi`);
        } catch (clickError) {
          console.warn(`⚠️ [Playwright] Para birimi seçimi click başarısız, force click deneniyor: ${clickError.message}`);
          await currencyOption.click({ force: true, timeout: 30000 });
          await this.safeWait(page, 2000);
        }
        
        // Save butonunu bul ve tıkla
        console.log(`💾 [Playwright] Save butonu aranıyor...`);
        const saveSelectors = [
          'span#icp-save-button input.a-button-input[type="submit"]',
          'input.a-button-input[type="submit"]',
          'input#icp-save-button',
          'span#icp-save-button input',
          'input[type="submit"][id*="save"]'
        ];
        
        let saveButton = null;
        for (const selector of saveSelectors) {
          try {
            saveButton = await page.waitForSelector(selector, { timeout: 15000, state: 'visible' });
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
        
        // Save butonuna tıkla
        try {
          await saveButton.scrollIntoViewIfNeeded();
          await this.safeWait(page, 500);
          await saveButton.click({ timeout: 30000 });
          await this.safeWait(page, 3000);
          console.log(`✅ [Playwright] Para birimi kaydedildi`);
        } catch (clickError) {
          console.warn(`⚠️ [Playwright] Save click başarısız, force click deneniyor: ${clickError.message}`);
          await saveButton.click({ force: true, timeout: 30000 });
          await this.safeWait(page, 3000);
        }
      } catch (currencyError) {
        console.warn(`⚠️ [Playwright] Para birimi seçimi hatası: ${currencyError.message}`);
        // Para birimi seçimi başarısız olsa bile devam et
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
            timeout: 20000, 
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
        // Standard delivery: div#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE > span > span.a-text-bold
        console.log(`🔍 [Playwright] Standart gönderim tarihi aranıyor...`);
        const standardDeliverySelectors = [
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
              const isVisible = await element.isVisible().catch(() => false);
              const dateText = await element.textContent().then(t => t.trim()).catch(() => null);
              if (dateText) {
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
        console.log(`🔍 [Playwright] Express delivery bilgisi aranıyor...`);
        const expressDeliverySelectors = [
          'span[data-csa-c-delivery-time]', // Öncelikli - attribute'dan direkt çek
          '#mir-layout-DELIVERY_BLOCK-slot-SECONDARY_DELIVERY_MESSAGE_LARGE',
          '#mir-layout-DELIVERY_BLOCK-slot-SECONDARY_DELIVERY_MESSAGE_LARGE span',
          'span[data-csa-c-delivery-type="delivery"]',
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
              // KRİTİK: Önce data-csa-c-delivery-time attribute'undan tarihi çek
              const deliveryTimeAttr = await element.getAttribute('data-csa-c-delivery-time');
              if (deliveryTimeAttr) {
                expressDeliveryDate = deliveryTimeAttr.trim();
                console.log(`✅ [Playwright] Express delivery tarihi (attribute): ${expressDeliveryDate}`);
              }
              
              // Text içeriğini de al
              const dateText = await element.textContent().then(t => t.trim()).catch(() => null);
              if (dateText) {
                fastestDeliveryText = dateText;
                console.log(`✅ [Playwright] Fastest delivery text bulundu: ${fastestDeliveryText}`);
                
                // Eğer attribute'dan tarih gelmediyse, text'ten çıkar
                if (!expressDeliveryDate) {
                  // "Or fastest delivery Friday, January 23" formatından tarih çıkar
                  const dateMatch = dateText.match(/((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2})/i);
                  if (dateMatch) {
                    expressDeliveryDate = dateMatch[1].trim();
                    console.log(`✅ [Playwright] Hızlı gönderim tarihi (text): ${expressDeliveryDate}`);
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
                      
                      // Tarih çıkar
                      const dateMatch = fastestDeliveryText.match(/((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2})/i);
                      if (dateMatch) {
                        expressDeliveryDate = dateMatch[1].trim();
                        console.log(`✅ [Playwright] Express delivery tarihi bulundu (delivery block): ${expressDeliveryDate}`);
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
                    const dateMatch = containerText.match(/((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2})/i);
                    if (dateMatch) {
                      standardDeliveryDate = dateMatch[1].trim();
                      console.log(`✅ [Playwright] Delivery date buybox container'dan bulundu: ${standardDeliveryDate}`);
                    }
                  }
                  
                  // Express delivery ara
                  if (!expressDeliveryDate) {
                    const expressMatch = containerText.match(/(?:fastest|Or fastest).*?((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2})/i);
                    if (expressMatch) {
                      expressDeliveryDate = expressMatch[1].trim();
                      console.log(`✅ [Playwright] Express delivery date buybox container'dan bulundu: ${expressDeliveryDate}`);
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
        return {
          sellerName: sellerName || null,
          soldBy: soldBy || sellerName || null,
          shipsFrom: shipsFrom || null,
          condition: condition,
          isNew: isNew,
          isUsed: isUsed,
          price: price,
          priceText: priceText || (price ? `$${price.toFixed(2)}` : null),
          // KRİTİK: Fulfillment Type (FBA/FBM/SBA)
          fulfillmentType: fulfillmentType,
          isFBA: isFBA,
          isFBM: isFBM,
          isSBA: isSBA,
          // KRİTİK: Gönderim fiyatları - Ayrı field'lar olarak
          shippingPrice: shippingPrice,
          standardShippingPrice: shippingPrice, // Standard shipping price
          expressShippingPrice: null, // Express shipping price (buybox için genellikle yok)
          shippingText: shippingText || null,
          // KRİTİK: Teslimat tarihleri
          deliveryDate: standardDeliveryDate, // Geriye dönük uyumluluk
          standardDeliveryDate: standardDeliveryDate,
          expressDeliveryDate: expressDeliveryDate,
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
          condition = conditionMatch[1].trim();
          console.log(`✅ [Playwright] Offer ${index} condition offer element'inden çekildi: ${condition}`);
        }
        
        // Eğer bulunamadıysa, sidebar'dan condition çek
        if (!condition) {
          if (isPinnedOffer) {
            try {
              const conditionElement = await page.$('#aod-offer-heading > span.a-size-base.a-text-bold').catch(() => null);
              if (conditionElement) {
                condition = await conditionElement.textContent().then(t => t.trim()).catch(() => null);
                if (condition) {
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
                condition = await conditionElement.textContent().then(t => t.trim()).catch(() => null);
                if (condition) {
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
        const priceMatch = offerText.match(/[\$£€]\s*([\d,]+\.?\d*)/);
        if (priceMatch) {
          price = parseFloat(priceMatch[1].replace(/,/g, ''));
          priceText = priceMatch[0].trim();
          console.log(`✅ [Playwright] Offer ${index} price offer element'inden çekildi: ${priceText} -> ${price}`);
        }
        
        // Eğer bulunamadıysa, sidebar'dan price çek
        if (!price && !priceText) {
          // KRİTİK: Sidebar'dan price çek
          // Pinned offer için: #aod-price-0
          // Diğer offer'lar için: #aod-price-${index}
          if (isPinnedOffer) {
            try {
              const priceElement = await page.$('#aod-price-0 span[aria-hidden="true"], #aod-price-0 .a-offscreen').catch(() => null);
              if (priceElement) {
                priceText = await priceElement.textContent().then(t => t.trim()).catch(() => null);
                if (priceText) {
                  // Fiyatı parse et - "$132 . 99" -> 132.99 (boşlukları temizle)
                  const cleanedPriceText = priceText.replace(/\s+/g, '');
                  const priceMatch = cleanedPriceText.match(/[\$£€]?([\d,]+\.?\d*)/);
                  if (priceMatch) {
                    price = parseFloat(priceMatch[1].replace(/,/g, ''));
                    console.log(`✅ [Playwright] Offer ${index} price sidebar'dan çekildi: ${priceText} -> ${price}`);
                  }
                }
              }
            } catch (e) {
              console.warn(`⚠️ [Playwright] Offer ${index} price sidebar'dan çekilemedi: ${e.message}`);
            }
          } else {
            // Diğer offer'lar için: #aod-price-${index}
            try {
              const priceElement = await page.$(`#aod-price-${index} span[aria-hidden="true"], #aod-price-${index} .a-offscreen`).catch(() => null);
              if (priceElement) {
                priceText = await priceElement.textContent().then(t => t.trim()).catch(() => null);
                if (priceText) {
                  // Fiyatı parse et - "$132 . 99" -> 132.99 (boşlukları temizle)
                  const cleanedPriceText = priceText.replace(/\s+/g, '');
                  const priceMatch = cleanedPriceText.match(/[\$£€]?([\d,]+\.?\d*)/);
                  if (priceMatch) {
                    price = parseFloat(priceMatch[1].replace(/,/g, ''));
                    console.log(`✅ [Playwright] Offer ${index} price sidebar'dan çekildi: ${priceText} -> ${price}`);
                  }
                }
              }
            } catch (e) {
              console.warn(`⚠️ [Playwright] Offer ${index} price sidebar'dan çekilemedi: ${e.message}`);
            }
          }
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
        
        // Eğer bulunamadıysa, sidebar'dan shipsFrom çek
        if (!shipsFrom) {
          // KRİTİK: Sidebar'dan shipsFrom çek
          // Pinned offer için: #aod-offer-shipsFrom (global)
          // Diğer offer'lar için: offer içinde #aod-offer-shipsFrom veya text içinde
          if (isPinnedOffer) {
            try {
              const shipsFromElement = await page.$('#aod-offer-shipsFrom').catch(() => null);
              if (shipsFromElement) {
                const shipsFromText = await shipsFromElement.textContent().then(t => t.trim()).catch(() => null);
                if (shipsFromText) {
                  // "Ships from Amazon.com" formatından "Amazon.com" çıkar
                  const shipsFromMatch = shipsFromText.match(/Ships from\s+(.+)/i);
                  if (shipsFromMatch) {
                    shipsFrom = shipsFromMatch[1].trim();
                    console.log(`✅ [Playwright] Offer ${index} shipsFrom sidebar'dan çekildi: ${shipsFrom}`);
                  } else {
                    shipsFrom = shipsFromText.replace(/Ships from\s*/i, '').trim();
                  }
                }
              }
            } catch (e) {
              console.warn(`⚠️ [Playwright] Offer ${index} shipsFrom sidebar'dan çekilemedi: ${e.message}`);
            }
          } else {
            // Diğer offer'lar için: offer içinde shipsFrom bul
            try {
              const shipsFromElement = await offerElement.$('#aod-offer-shipsFrom, [id*="shipsFrom"]').catch(() => null);
              if (shipsFromElement) {
                const shipsFromText = await shipsFromElement.textContent().then(t => t.trim()).catch(() => null);
                if (shipsFromText) {
                  const shipsFromMatch = shipsFromText.match(/Ships from\s+(.+)/i);
                  if (shipsFromMatch) {
                    shipsFrom = shipsFromMatch[1].trim();
                    console.log(`✅ [Playwright] Offer ${index} shipsFrom sidebar'dan çekildi: ${shipsFrom}`);
                  } else {
                    shipsFrom = shipsFromText.replace(/Ships from\s*/i, '').trim();
                  }
                }
              }
            } catch (e) {
              // Ships from bulunamadı
            }
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
              const soldByElement = await page.$('#aod-offer-soldBy').catch(() => null);
              if (soldByElement) {
                const soldByText = await soldByElement.textContent().then(t => t.trim()).catch(() => null);
                if (soldByText) {
                  // "Sold by vancasso Reactive Art Seller rating is 5 out of 5 stars..." formatından çıkar
                  const soldByMatch = soldByText.match(/Sold by\s+([^\n\r]+?)(?:\s+Seller rating|$)/i);
                  if (soldByMatch) {
                    soldBy = soldByMatch[1].trim();
                    sellerName = soldBy;
                    console.log(`✅ [Playwright] Offer ${index} soldBy sidebar'dan çekildi: ${soldBy} -> sellerName: ${sellerName}`);
                  }
                  
                  // Seller rating - "Seller rating is 5 out of 5 stars (77 ratings)"
                  if (!sellerRating) {
                    const ratingMatch = soldByText.match(/(\d+(?:\.\d+)?)\s+out of\s+5\s+stars/i);
                    if (ratingMatch) {
                      sellerRating = parseFloat(ratingMatch[1]);
                      console.log(`✅ [Playwright] Offer ${index} sellerRating sidebar'dan çekildi: ${sellerRating}`);
                    }
                  }
                  
                  // KRİTİK: Seller rating count - "(77 ratings)" formatından çıkar
                  if (!sellerRatingCount) {
                    const ratingCountMatch = soldByText.match(/\((\d{1,3}(?:,\d{3})*|\d+)\s*(?:ratings?|değerlendirme)\)/i);
                    if (ratingCountMatch) {
                      sellerRatingCount = ratingCountMatch[1].replace(/,/g, '');
                      console.log(`✅ [Playwright] Offer ${index} sellerRatingCount sidebar'dan çekildi: ${sellerRatingCount}`);
                    }
                  }
                  
                  // KRİTİK: Positive percentage - "100% positive" formatından çıkar
                  if (!positivePercentage) {
                    const positiveMatch = soldByText.match(/(\d+(?:\.\d+)?)\s*%\s*positive/i);
                    if (positiveMatch) {
                      positivePercentage = parseFloat(positiveMatch[1]);
                      console.log(`✅ [Playwright] Offer ${index} positivePercentage sidebar'dan çekildi: ${positivePercentage}%`);
                    }
                  }
                }
              }
            } catch (e) {
              console.warn(`⚠️ [Playwright] Offer ${index} soldBy sidebar'dan çekilemedi: ${e.message}`);
            }
          } else {
            // Diğer offer'lar için: offer içinde soldBy bul
            try {
              const soldByElement = await offerElement.$('#aod-offer-soldBy, [id*="soldBy"]').catch(() => null);
              if (soldByElement) {
                const soldByText = await soldByElement.textContent().then(t => t.trim()).catch(() => null);
                if (soldByText) {
                  const soldByMatch = soldByText.match(/Sold by\s+([^\n\r]+?)(?:\s+Seller rating|$)/i);
                  if (soldByMatch) {
                    soldBy = soldByMatch[1].trim();
                    sellerName = soldBy;
                    console.log(`✅ [Playwright] Offer ${index} soldBy sidebar'dan çekildi: ${soldBy} -> sellerName: ${sellerName}`);
                  }
                  
                  // Seller rating
                  if (!sellerRating) {
                    const ratingMatch = soldByText.match(/(\d+(?:\.\d+)?)\s+out of\s+5\s+stars/i);
                    if (ratingMatch) {
                      sellerRating = parseFloat(ratingMatch[1]);
                      console.log(`✅ [Playwright] Offer ${index} sellerRating sidebar'dan çekildi: ${sellerRating}`);
                    }
                  }
                  
                  // KRİTİK: Seller rating count - "(77 ratings)" formatından çıkar
                  if (!sellerRatingCount) {
                    const ratingCountMatch = soldByText.match(/\((\d{1,3}(?:,\d{3})*|\d+)\s*(?:ratings?|değerlendirme)\)/i);
                    if (ratingCountMatch) {
                      sellerRatingCount = ratingCountMatch[1].replace(/,/g, '');
                      console.log(`✅ [Playwright] Offer ${index} sellerRatingCount sidebar'dan çekildi: ${sellerRatingCount}`);
                    }
                  }
                  
                  // KRİTİK: Positive percentage - "100% positive" formatından çıkar
                  if (!positivePercentage) {
                    const positiveMatch = soldByText.match(/(\d+(?:\.\d+)?)\s*%\s*positive/i);
                    if (positiveMatch) {
                      positivePercentage = parseFloat(positiveMatch[1]);
                      console.log(`✅ [Playwright] Offer ${index} positivePercentage sidebar'dan çekildi: ${positivePercentage}%`);
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
        }
      } catch (e) {
        console.warn(`⚠️ [Playwright] Offer ${index} soldBy çekilirken hata: ${e.message}`);
      }
      
      // Delivery date ve shipping price
      let deliveryDate = null;
      let shippingPrice = null;
      let expressDeliveryDate = null;
      try {
        // KRİTİK: Önce offer element içinden delivery bilgilerini çek
        // "$30.96 delivery Tuesday, January 27" formatından çıkar
        const deliveryMatch = offerText.match(/[\$£€]?\s*([\d,]+\.?\d*)\s+delivery\s+((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2})/i);
        if (deliveryMatch) {
          shippingPrice = parseFloat(deliveryMatch[1].replace(/,/g, ''));
          deliveryDate = deliveryMatch[2].trim();
          console.log(`✅ [Playwright] Offer ${index} delivery offer element'inden çekildi: shippingPrice: ${shippingPrice}, deliveryDate: ${deliveryDate}`);
        } else {
          // Sadece shipping price
          const shippingMatch = offerText.match(/[\$£€]?\s*([\d,]+\.?\d*)\s+delivery/i);
          if (shippingMatch) {
            shippingPrice = parseFloat(shippingMatch[1].replace(/,/g, ''));
            console.log(`✅ [Playwright] Offer ${index} shippingPrice offer element'inden çekildi: ${shippingPrice}`);
          }
          
          // Sadece delivery date
          const dateMatch = offerText.match(/((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2})/i);
          if (dateMatch) {
            deliveryDate = dateMatch[1].trim();
            console.log(`✅ [Playwright] Offer ${index} deliveryDate offer element'inden çekildi: ${deliveryDate}`);
          }
        }
        
        // Express delivery - "Or fastest delivery Friday, January 23"
        const expressMatch = offerText.match(/fastest\s+delivery\s+((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2})/i);
        if (expressMatch) {
          expressDeliveryDate = expressMatch[1].trim();
          console.log(`✅ [Playwright] Offer ${index} expressDeliveryDate offer element'inden çekildi: ${expressDeliveryDate}`);
        }
        
        // Eğer bulunamadıysa, sidebar'dan delivery bilgilerini çek
        if (!deliveryDate && !shippingPrice && !expressDeliveryDate) {
          // KRİTİK: Sidebar'dan delivery bilgilerini çek
          // Pinned offer için: #mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE (global)
          // Diğer offer'lar için: offer içinde delivery bilgileri
          if (isPinnedOffer) {
            try {
              // Standard delivery: #mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE > span
              const standardDeliveryElement = await page.$('#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE > span').catch(() => null);
              if (standardDeliveryElement) {
                const standardDeliveryText = await standardDeliveryElement.textContent().then(t => t.trim()).catch(() => null);
                if (standardDeliveryText) {
                  // "$58.34 delivery Monday, January 26" formatından çıkar
                  const shippingMatch = standardDeliveryText.match(/[\$£€]?\s*([\d,]+\.?\d*)\s+delivery/i);
                  if (shippingMatch) {
                    shippingPrice = parseFloat(shippingMatch[1].replace(/,/g, ''));
                  }
                  
                  // Delivery date çıkar
                  const dateMatch = standardDeliveryText.match(/((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2})/i);
                  if (dateMatch) {
                    deliveryDate = dateMatch[1].trim();
                  }
                  
                  console.log(`✅ [Playwright] Offer ${index} standard delivery sidebar'dan çekildi: ${standardDeliveryText} -> shippingPrice: ${shippingPrice}, deliveryDate: ${deliveryDate}`);
                }
              }
              
              // Express delivery: #mir-layout-DELIVERY_BLOCK-slot-SECONDARY_DELIVERY_MESSAGE_LARGE > span
              const expressDeliveryElement = await page.$('#mir-layout-DELIVERY_BLOCK-slot-SECONDARY_DELIVERY_MESSAGE_LARGE > span').catch(() => null);
              if (expressDeliveryElement) {
                const expressDeliveryText = await expressDeliveryElement.textContent().then(t => t.trim()).catch(() => null);
                if (expressDeliveryText) {
                  // "Or fastest delivery Friday, January 23" formatından çıkar
                  const dateMatch = expressDeliveryText.match(/((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2})/i);
                  if (dateMatch) {
                    expressDeliveryDate = dateMatch[1].trim();
                    console.log(`✅ [Playwright] Offer ${index} express delivery sidebar'dan çekildi: ${expressDeliveryText} -> expressDeliveryDate: ${expressDeliveryDate}`);
                  }
                }
              }
            } catch (e) {
              console.warn(`⚠️ [Playwright] Offer ${index} delivery sidebar'dan çekilemedi: ${e.message}`);
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
      
      return {
        index: index,
        condition: condition,
        isNew: isNew, // Modal'da gösterilecek: New mi?
        isUsed: isUsed, // Modal'da gösterilecek: Used mi?
        price: price,
        priceText: priceText,
        shipsFrom: shipsFrom,
        soldBy: soldBy,
        sellerName: sellerName,
        // KRİTİK: Fulfillment Type (FBA/FBM/SBA)
        fulfillmentType: fulfillmentType,
        isFBA: isFBA,
        isFBM: isFBM,
        isSBA: isSBA,
        // KRİTİK: Satıcı değerlendirme bilgileri - Frontend modalda gösterilecek
        sellerRating: sellerRating, // Yıldız puanı (1-5)
        sellerRatingCount: sellerRatingCount, // Değerlendirme sayısı (örn: "77" veya "1234")
        positivePercentage: positivePercentage, // Pozitif yüzde (örn: 100, 98)
        // KRİTİK: Teslimat bilgileri - Ayrı field'lar olarak
        deliveryDate: deliveryDate, // Standard delivery date (geriye dönük uyumluluk)
        standardDeliveryDate: deliveryDate, // Standard delivery date
        expressDeliveryDate: expressDeliveryDate || null, // Express/Fast delivery date
        // KRİTİK: Gönderim fiyatları - Ayrı field'lar olarak
        shippingPrice: shippingPrice, // Standard shipping price (geriye dönük uyumluluk)
        standardShippingPrice: shippingPrice, // Standard shipping price
        expressShippingPrice: null // Express shipping price (henüz çekilmiyor, ileride eklenebilir)
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
  async getSellerInfo(asin, sourceMarketplace = 'amazon.com', targetCountry = null) {
    let browser = null;
    let page = null;
    
    try {
      console.log(`🎭 [Playwright] Seller bilgileri çekiliyor: ${asin} from ${sourceMarketplace}`);
      
      // Browser başlatmadan önce, eğer Railway'de browser yükleniyorsa bekle
      if (process.env.RAILWAY_ENVIRONMENT) {
        const fs = require('fs');
        const path = require('path');
        const browserPaths = [
          path.join(process.env.HOME || '/root', '.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell'),
          path.join(process.cwd(), 'node_modules/.cache/playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell')
        ];
        
        let browserFound = false;
        let foundBrowserPath = null;
        for (const browserPath of browserPaths) {
          try {
            if (fs.existsSync(browserPath)) {
              browserFound = true;
              foundBrowserPath = browserPath;
              console.log(`✅ [Playwright] Browser bulundu: ${browserPath}`);
              break;
            }
          } catch (e) {
            // Devam et
          }
        }
        
        // Browser yoksa ve yükleniyorsa, kısa bir süre bekle
        if (!browserFound) {
          console.log('⏳ [Playwright] Browser bulunamadı, yükleniyor...');
          const { execSync } = require('child_process');
          try {
            execSync('npx playwright install chromium --with-deps', { 
              stdio: 'pipe',
              timeout: 120000 // 2 dakika timeout
            });
            console.log('✅ [Playwright] Browser yüklendi');
          } catch (e) {
            console.warn('⚠️ [Playwright] Browser yükleme hatası (devam ediliyor):', e.message);
            // Browser yükleme başarısız olsa bile devam et, belki build'de yüklenmiştir
          }
        }
      }
      
      // Browser başlat
      console.log('🌐 [Playwright] Browser başlatılıyor...');
      try {
        browser = await chromium.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled',
            '--single-process', // Railway için önemli
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding'
          ],
          timeout: 30000
        });
        console.log('✅ [Playwright] Browser başlatıldı');
      } catch (launchError) {
        console.error('❌ [Playwright] Browser başlatma hatası:', launchError.message);
        console.error('❌ [Playwright] Error stack:', launchError.stack);
        throw new Error(`Browser başlatılamadı: ${launchError.message}`);
      }

      const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'en-US',
        timezoneId: 'America/New_York'
      });

      page = await context.newPage();

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
      
      // Product URL oluştur
      const productUrl = `${baseUrl}/dp/${asin}`;
      console.log(`🌐 [Playwright] Sayfa açılıyor: ${productUrl}`);

      // Sayfayı yükle
      await page.goto(productUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 60000 
      });
      await this.safeWait(page, 5000);

      // KRİTİK: Önce ülke ve para birimi seçimi yap
      if (targetCountry) {
        console.log(`🌍 [Playwright] Ülke ve para birimi seçimi yapılıyor: ${targetCountry}`);
        const countrySelectionResult = await this.selectCountryAndCurrency(page, targetCountry, sourceMarketplace, productUrl);
        
        if (!countrySelectionResult.success) {
          console.warn(`⚠️ [Playwright] Ülke ve para birimi seçimi başarısız: ${countrySelectionResult.error}`);
          // Devam et, seller bilgilerini çekmeyi dene
        } else {
          console.log(`✅ [Playwright] Ülke ve para birimi seçimi tamamlandı`);
          
          // ASIN sayfasına geri dön (eğer preferences sayfasındaysak veya sayfa yüklenmemişse)
          const currentUrl = page.url();
          const isOnAsinPage = currentUrl.includes('/dp/');
          const needsNavigation = !isOnAsinPage;
          
          if (needsNavigation) {
            console.log(`🔗 [Playwright] ASIN sayfasına geri dönülüyor: ${productUrl}`);
            try {
              // KRİTİK: domcontentloaded kullan - daha hızlı ve güvenilir
              await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
              console.log(`✅ [Playwright] ASIN sayfası DOM yüklendi`);
              
              // Ekstra bekleme - buybox'ın render olması için
              await this.safeWait(page, 5000);
              
              // Buybox container'ının yüklenmesini bekle - daha esnek selector'lar
              console.log(`⏳ [Playwright] Buybox container'ının yüklenmesi bekleniyor...`);
              try {
                await page.waitForSelector('#desktop_buybox, #buybox, #qualifiedBuybox, #apex_offerDisplay_single_desktop, #apex_offerDisplay_desktop', { 
                  timeout: 45000, 
                  state: 'attached' 
                });
                console.log(`✅ [Playwright] Buybox container bulundu`);
              } catch (selectorError) {
                console.warn(`⚠️ [Playwright] Buybox container selector bulunamadı, devam ediliyor...`);
                // Ekstra bekleme - belki yükleniyor
                await this.safeWait(page, 5000);
              }
              
              // Ekstra bekleme - shipping bilgilerinin render olması için
              await this.safeWait(page, 3000);
              
              // KRİTİK: Network idle bekleme - timeout'u kısalt (çok katı olabilir)
              // Amazon sayfaları bazen network idle olmuyor, bu yüzden timeout'u kısalt
              try {
                await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
                  console.warn(`⚠️ [Playwright] Network idle bekleme timeout, devam ediliyor...`);
                });
              } catch (networkError) {
                // Network idle bekleme başarısız olsa bile devam et
                console.warn(`⚠️ [Playwright] Network idle bekleme hatası: ${networkError.message}`);
              }
              
              // KRİTİK: Sayfa title'ını kontrol et - eğer sadece "Amazon.com" ise sayfa tam yüklenmemiş olabilir
              const pageTitle = await page.title().catch(() => '');
              if (pageTitle === 'Amazon.com' || pageTitle === 'Amazon' || !pageTitle) {
                console.warn(`⚠️ [Playwright] Sayfa title sadece "Amazon.com" - sayfa tam yüklenmemiş olabilir, ekstra bekleme...`);
                await this.safeWait(page, 5000);
              }
            } catch (gotoError) {
              console.error(`❌ [Playwright] ASIN sayfasına dönüş hatası: ${gotoError.message}`);
              // Hata olsa bile devam et - belki sayfa zaten yüklü
              // Sayfanın mevcut durumunu kontrol et
              try {
                const currentUrl = page.url();
                if (currentUrl.includes('/dp/')) {
                  console.log(`✅ [Playwright] Sayfa zaten ASIN sayfasında: ${currentUrl}`);
                  await this.safeWait(page, 5000);
                } else {
                  // Sayfa yüklenmemiş, tekrar dene
                  console.log(`🔄 [Playwright] Sayfa yüklenmemiş, tekrar deneniyor...`);
                  await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {
                    console.warn(`⚠️ [Playwright] İkinci deneme de başarısız, mevcut sayfayla devam ediliyor...`);
                  });
                  await this.safeWait(page, 5000);
                }
              } catch (retryError) {
                console.warn(`⚠️ [Playwright] Retry hatası: ${retryError.message}, mevcut sayfayla devam ediliyor...`);
                await this.safeWait(page, 5000);
              }
            }
          } else {
            console.log(`✅ [Playwright] Sayfa zaten ASIN sayfasında: ${currentUrl}`);
            // Sayfa zaten ASIN sayfasında, buybox'ın yüklenmesini bekle
            await this.safeWait(page, 3000);
          }
          
          // Buybox container'ını bekle (her durumda) - daha esnek selector'lar
          console.log(`⏳ [Playwright] Buybox container'ının varlığı kontrol ediliyor...`);
          try {
            await page.waitForSelector('#desktop_buybox, #buybox, #qualifiedBuybox, #apex_offerDisplay_single_desktop, #apex_offerDisplay_desktop, #corePrice_feature_div', { 
              timeout: 30000,
              state: 'attached'
            });
            console.log(`✅ [Playwright] Buybox container doğrulandı`);
          } catch (selectorError) {
            console.warn(`⚠️ [Playwright] Buybox container bulunamadı, shipping bilgileri çekilmeye devam ediliyor...`);
            // Ekstra bekleme - belki yükleniyor
            await this.safeWait(page, 3000);
          }
        }
      }
      
      // KRİTİK: Buybox bilgilerini çek (PDP sayfasından) - AOD'ye gitmeden önce
      // KRİTİK: Shipping bilgileri çekilemediğinde retry mekanizması
      console.log(`🛒 [Playwright] Buybox bilgileri çekiliyor (PDP sayfasından)...`);
      let buyboxData = await this.extractBuyboxData(page);
      
      // Eğer shipping bilgileri eksikse, sayfayı yeniden yükle ve tekrar dene
      if (!buyboxData || (!buyboxData.standardShippingPrice && !buyboxData.standardDeliveryDate && !buyboxData.sellerName)) {
        console.warn(`⚠️ [Playwright] Buybox bilgileri eksik veya null, sayfa yeniden yükleniyor ve tekrar deneniyor...`);
        try {
          // Sayfayı yeniden yükle
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
          await this.safeWait(page, 5000);
          
          // Buybox container'ını bekle
          try {
            await page.waitForSelector('#desktop_buybox, #buybox, #qualifiedBuybox, #apex_offerDisplay_single_desktop, #apex_offerDisplay_desktop', { 
              timeout: 30000, 
              state: 'attached' 
            });
          } catch (e) {
            console.warn(`⚠️ [Playwright] Buybox container retry'de bulunamadı`);
          }
          
          await this.safeWait(page, 3000);
          
          // Tekrar dene
          buyboxData = await this.extractBuyboxData(page);
        } catch (retryError) {
          console.warn(`⚠️ [Playwright] Buybox bilgileri retry hatası: ${retryError.message}`);
        }
      }
      
      if (buyboxData) {
        console.log(`✅ [Playwright] Buybox bilgileri çekildi: ${buyboxData.sellerName || 'N/A'}, $${buyboxData.price || 'N/A'}, Shipping: $${buyboxData.standardShippingPrice || 'N/A'}, Date: ${buyboxData.standardDeliveryDate || 'N/A'}`);
      } else {
        console.warn(`⚠️ [Playwright] Buybox bilgileri çekilemedi`);
      }

      // Seller bilgilerini çekme mantığı
      console.log(`🛒 [Playwright] Seller bilgileri çekiliyor...`);
      
      // Sayfanın yüklenmesini bekle
      await this.safeWait(page, 3000);
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
      
      if (!newAndUsedLink) {
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
      
      // "New & Used" linkine/div'ine tıkla
      // KRİTİK: Element görünür olmayabilir, href'den URL'yi al ve direkt git (daha güvenilir)
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
              await page.goto(aodUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
              console.log(`✅ [Playwright] AOD sayfasına gidildi (hash URL fallback)`);
            } catch (jsError) {
              console.warn(`⚠️ [Playwright] Hash URL işleme başarısız, normal click deneniyor: ${jsError.message}`);
              // Fallback: Normal click
              await newAndUsedLink.click({ timeout: 30000 });
            }
          } else {
            // Normal URL ise direkt git
            await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 60000 });
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
            await page.goto(aodUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            console.log(`✅ [Playwright] AOD sayfasına gidildi (son çare)`);
          }
        }
      }
      
      // 3 saniye bekle (modal/sayfa açılması için)
      console.log(`⏳ [Playwright] Modal/sayfa açılması bekleniyor (3 saniye)...`);
      await this.safeWait(page, 3000);
      
      // AOD (All Offers Display) container'ını bekle - KRİTİK: Sidebar açılması için bekle
      console.log(`🛒 [Playwright] Seller listesi container'ı bekleniyor (sidebar açılması için)...`);
      try {
        // Önce sidebar container'ını bekle
        await page.waitForSelector('#all-offers-display, #aod-container, #aod-offer-list, #aod-offer, #aod-pinned-offer', { timeout: 20000, state: 'visible' });
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
        // "New & Used (6) from" formatından sayıyı çıkar
        const newAndUsedText = await page.$eval('a#aod-ingress-link span.a-color-base', (el) => el.textContent.trim()).catch(() => '');
        const match = newAndUsedText.match(/\((\d+)\)/);
        if (match) {
          totalSellers = parseInt(match[1], 10);
          console.log(`✅ [Playwright] Toplam satıcı sayısı: ${totalSellers}`);
        }
      } catch (e) {
        console.warn(`⚠️ [Playwright] Toplam satıcı sayısı bulunamadı: ${e.message}`);
      }
      
      // KRİTİK: Pinned offer için "See more" linkine tıkla (eğer varsa)
      try {
        const seeMoreLink = await page.$('#aod-pinned-offer-show-more-link').catch(() => null);
        if (seeMoreLink) {
          console.log(`🔗 [Playwright] "See more" linki bulundu, tıklanıyor...`);
          try {
            await seeMoreLink.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
            await this.safeWait(page, 500);
            await seeMoreLink.click({ timeout: 10000 });
            console.log(`✅ [Playwright] "See more" linkine tıklandı`);
            await this.safeWait(page, 2000); // Sidebar içeriğinin yüklenmesi için bekle
          } catch (clickError) {
            console.warn(`⚠️ [Playwright] "See more" linkine tıklanamadı: ${clickError.message}`);
          }
        }
      } catch (e) {
        console.warn(`⚠️ [Playwright] "See more" linki kontrol edilemedi: ${e.message}`);
      }
      
      // Tüm seller offer'larını çek - KRİTİK: Sidebar'dan tüm bilgileri çek
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
        
        // Tüm #aod-offer elementlerini bul (pinned offer hariç) - Sidebar'dan çek
        // Her offer için: #aod-offer-0, #aod-offer-1, vb.
        const offerElements = await page.$$('#aod-offer, div[id^="aod-offer-"]');
        console.log(`🔍 [Playwright] ${offerElements.length} seller offer bulundu (sidebar'dan çekilecek)`);
        
        for (let i = 0; i < offerElements.length; i++) {
          const offer = offerElements[i];
          try {
            // Her offer için sidebar'dan bilgileri çek (index'e göre selector'lar kullanılacak)
            await offer.click().catch(() => {});
            await this.safeWait(page, 500);
            const sellerData = await this.extractSellerDataFromOffer(page, offer, i + 1, false);
            if (sellerData) {
              sellers.push(sellerData);
              console.log(`✅ [Playwright] Seller ${i + 2}/${offerElements.length + 1} sidebar'dan çekildi: ${sellerData.sellerName || sellerData.soldBy || 'N/A'}`);
            }
          } catch (e) {
            console.warn(`⚠️ [Playwright] Seller ${i + 2} sidebar'dan çekilirken hata: ${e.message}`);
          }
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
            // Aynı seller'ın başka bir offer'ı, en iyi fiyatlı olanı tut (veya ilkini)
            const existingSeller = sellerMap.get(sellerKey);
            // Eğer yeni offer daha düşük fiyatlıysa, onu kullan
            if (seller.price && existingSeller.price && seller.price < existingSeller.price) {
              sellerMap.set(sellerKey, seller);
              const index = uniqueSellers.findIndex(s => {
                const sName = s.sellerName ? s.sellerName.toLowerCase().trim().replace(/\s+/g, ' ') : null;
                const sSoldBy = s.soldBy ? s.soldBy.toLowerCase().trim().replace(/\s+/g, ' ') : null;
                const sKey = (sName || sSoldBy || `seller-${s.index}`).toLowerCase().trim();
                return sKey === sellerKey;
              });
              if (index !== -1) {
                uniqueSellers[index] = seller;
              }
            }
          }
        }
        
        console.log(`🔍 [Playwright] Unique seller sayısı: ${uniqueSellers.length} (toplam offer: ${sellers.length})`);
        
      } catch (e) {
        console.error(`❌ [Playwright] Seller bilgileri çekilirken hata: ${e.message}`);
        uniqueSellers = []; // Hata durumunda boş array
      }
      
      // uniqueSellers varsa onu kullan, yoksa sellers'ı kullan
      const finalSellers = uniqueSellers.length > 0 ? uniqueSellers : sellers;
      const finalTotalSellers = uniqueSellers.length > 0 ? uniqueSellers.length : (totalSellers || sellers.length);
      
      // KRİTİK: Buybox'ı seller listesinin başına ekle (eğer varsa ve listede yoksa)
      if (buyboxData) {
        // Buybox'ın listede olup olmadığını kontrol et
        const buyboxExists = finalSellers.some(s => {
          const sName = (s.sellerName || s.soldBy || '').toLowerCase().trim();
          const bName = (buyboxData.sellerName || buyboxData.soldBy || '').toLowerCase().trim();
          return sName === bName && s.isBuybox === true;
        });
        
        if (!buyboxExists) {
          // Buybox'ı listenin başına ekle
          finalSellers.unshift(buyboxData);
          console.log(`✅ [Playwright] Buybox seller listesinin başına eklendi`);
        } else {
          console.log(`ℹ️ [Playwright] Buybox zaten listede mevcut`);
        }
      }
      
      return {
        success: true,
        data: {
          asin: asin,
          sourceMarketplace: sourceMarketplace,
          targetCountry: targetCountry,
          totalSellers: finalTotalSellers, // Unique seller sayısı
          sellers: finalSellers, // Unique seller'lar (buybox dahil)
          marketplace: 'source', // Kaynak mağaza
          buybox: buyboxData || null // Buybox bilgileri (ayrıca döndür)
        },
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
      // Cleanup
      try {
        if (page && !page.isClosed()) {
          await page.close();
        }
      } catch (e) {
        console.warn(`⚠️ [Playwright] Page close error: ${e.message}`);
      }
      
      try {
        if (browser) {
          await browser.close();
        }
      } catch (e) {
        console.warn(`⚠️ [Playwright] Browser close error: ${e.message}`);
      }
    }
  }
}

module.exports = new PlaywrightService();
