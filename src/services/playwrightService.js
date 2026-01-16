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

      // "Deliver to" butonunu bul ve tıkla
      console.log(`🎭 [Playwright] "Deliver to" butonu aranıyor...`);
      const deliverToSelectors = [
        '#nav-global-location-popover-link',
        'a#nav-global-location-popover-link',
        'a[data-csa-c-type="button"][id*="nav-global-location"]',
        'a[id*="nav-global-location"]',
        'a:has-text("Deliver to")'
      ];
      
      let deliverToButton = null;
      for (const selector of deliverToSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 20000, state: 'visible' });
          deliverToButton = await page.$(selector);
          if (deliverToButton) {
            console.log(`✅ [Playwright] "Deliver to" butonu bulundu: ${selector}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!deliverToButton) {
        throw new Error('Deliver to button not found after exhaustive search');
      }
      
      // "Deliver to" butonuna tıkla
      try {
        await deliverToButton.scrollIntoViewIfNeeded();
        await this.safeWait(page, 1000);
        await deliverToButton.click({ timeout: 30000 });
        await this.safeWait(page, 3000);
        console.log(`✅ [Playwright] "Deliver to" butonuna tıklandı`);
      } catch (clickError) {
        console.warn(`⚠️ [Playwright] Normal click başarısız, force click deneniyor: ${clickError.message}`);
        await deliverToButton.click({ force: true, timeout: 30000 });
        await this.safeWait(page, 3000);
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
   * Extract seller data from a single offer element
   * @param {Object} page - Playwright page object
   * @param {Object} offerElement - Playwright element handle for #aod-offer
   * @param {number} index - Offer index
   * @returns {Promise<Object | null>}
   */
  async extractSellerDataFromOffer(page, offerElement, index) {
    try {
      // Condition (New, Used - Like New, Used - Very Good, vb.)
      let condition = null;
      let isNew = false;
      let isUsed = false;
      
      try {
        // Önce condition text'i bul
        const conditionText = await offerElement.$eval('span#aod-condition-text, span.a-color-state', (el) => el.textContent.trim()).catch(() => null);
        if (conditionText) {
          condition = conditionText;
        }
      } catch (e) {
        // Condition bulunamadı
      }
      
      // Eğer condition bulunamadıysa, tüm text'ten çıkarmayı dene
      if (!condition) {
        try {
          const allText = await offerElement.textContent();
          const conditionMatch = allText.match(/(New|Used\s*-\s*(?:Like\s+New|Very\s+Good|Good|Acceptable))/i);
          if (conditionMatch) {
            condition = conditionMatch[1];
          }
        } catch (e2) {
          // Condition bulunamadı
        }
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
      } catch (e) {
        console.warn(`⚠️ [Playwright] Price çekilemedi: ${e.message}`);
      }
      
      // Ships from
      let shipsFrom = null;
      try {
        // "Ships from Amazon.com" formatından "Amazon.com" çıkar
        const allText = await offerElement.textContent();
        const shipsFromMatch = allText.match(/Ships from\s+([^\n\r]+)/i);
        if (shipsFromMatch) {
          shipsFrom = shipsFromMatch[1].trim();
        }
      } catch (e) {
        // Ships from bulunamadı
      }
      
      // Sold by
      let soldBy = null;
      let sellerName = null;
      let sellerRating = null;
      try {
        // "Sold by vancasso Ceramic Art" formatından seller name çıkar
        const allText = await offerElement.textContent();
        const soldByMatch = allText.match(/Sold by\s+([^\n\r]+?)(?:\s+Seller rating|$)/i);
        if (soldByMatch) {
          soldBy = soldByMatch[1].trim();
          // Seller name'i temizle (eğer "vancasso Ceramic Art" gibi uzunsa sadece ilk kelimeyi al)
          sellerName = soldBy.split(' ')[0]; // İlk kelime
        }
      } catch (e) {
        // Sold by bulunamadı
      }
      
      // Seller rating - "Seller rating is 5 out of 5 stars (6"
      try {
        const allText = await offerElement.textContent();
        const ratingMatch = allText.match(/(\d+(?:\.\d+)?)\s+out of\s+5\s+stars/i);
        if (ratingMatch) {
          sellerRating = parseFloat(ratingMatch[1]);
        }
      } catch (e) {
        // Rating bulunamadı
      }
      
      // Delivery date ve shipping price
      let deliveryDate = null;
      let shippingPrice = null;
      try {
        // Delivery text'i bul - "Wednesday, January 21" veya "$105.69 delivery Wednesday, January 21"
        const allText = await offerElement.textContent();
        
        // Delivery date çıkar
        const dateMatch = allText.match(/((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2})/i);
        if (dateMatch) {
          deliveryDate = dateMatch[1].trim();
        }
        
        // Shipping price çıkar - "$105.69 delivery" veya "$105.69 delivery Wednesday"
        const shippingMatch = allText.match(/[\$£€]?\s*([\d,]+\.?\d*)\s+delivery/i);
        if (shippingMatch) {
          shippingPrice = parseFloat(shippingMatch[1].replace(/,/g, ''));
        }
      } catch (e) {
        // Delivery bilgisi bulunamadı
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
        sellerRating: sellerRating,
        deliveryDate: deliveryDate,
        shippingPrice: shippingPrice
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
          
          // ASIN sayfasına geri dön (eğer preferences sayfasındaysak)
          if (!page.url().includes('/dp/')) {
            console.log(`🔗 [Playwright] ASIN sayfasına geri dönülüyor: ${productUrl}`);
            await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await this.safeWait(page, 5000);
          }
        }
      }

      // Seller bilgilerini çekme mantığı
      console.log(`🛒 [Playwright] Seller bilgileri çekiliyor...`);
      
      // Sayfanın yüklenmesini bekle
      await this.safeWait(page, 3000);
      console.log(`⏳ [Playwright] Sayfa yüklendi, "New & Used" linki aranıyor...`);
      
      // "New & Used" linkini bul ve tıkla
      const newAndUsedSelectors = [
        'a#aod-ingress-link',
        '#dynamic-aod-ingress-box a',
        '#olpLinkWidget_feature_div a',
        'div.daodi-content', // Yeni: div element
        'div[class*="daodi-content"]', // Yeni: class içinde daodi-content geçen div
        'div#dynamic-aod-ingress-box div.daodi-content', // Yeni: tam path
        'a[href*="aod"]',
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
              
              // Text içinde "New & Used" veya "from" geçiyorsa
              if (text.includes('New & Used') || text.includes('from') || text.includes('offers')) {
                // Eğer div ise, parent veya child link'i bul
                if (tagName === 'div') {
                  // Div'in parent'ında link var mı?
                  const parentLink = await element.evaluateHandle(el => {
                    let current = el.parentElement;
                    while (current && current.tagName !== 'A' && current !== document.body) {
                      current = current.parentElement;
                    }
                    return current && current.tagName === 'A' ? current : null;
                  }).catch(() => null);
                  
                  if (parentLink && parentLink.asElement()) {
                    newAndUsedLink = parentLink.asElement();
                    console.log(`✅ [Playwright] "New & Used" link bulundu (div parent): ${selector}, text: "${text.trim()}"`);
                    break;
                  }
                  
                  // Div'in içinde link var mı?
                  const childLink = await element.$('a').catch(() => null);
                  if (childLink) {
                    newAndUsedLink = childLink;
                    console.log(`✅ [Playwright] "New & Used" link bulundu (div child): ${selector}, text: "${text.trim()}"`);
                    break;
                  }
                  
                  // Div'e direkt tıklanabilir mi?
                  const isClickable = await element.evaluate(el => {
                    const style = window.getComputedStyle(el);
                    return style.cursor === 'pointer' || el.onclick || el.getAttribute('data-cursor-element-id');
                  }).catch(() => false);
                  
                  if (isClickable) {
                    newAndUsedLink = element;
                    console.log(`✅ [Playwright] "New & Used" div bulundu (tıklanabilir): ${selector}, text: "${text.trim()}"`);
                    break;
                  }
                } else {
                  // Direkt link
                  newAndUsedLink = element;
                  console.log(`✅ [Playwright] "New & Used" link bulundu: ${selector}, text: "${text.trim()}"`);
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
                if ((text.includes('New & Used') || text.includes('from') || text.includes('offers') || href.includes('aod') || href.includes('olp')) && !newAndUsedLink) {
                  newAndUsedLink = link;
                  console.log(`✅ [Playwright] "New & Used" link bulundu (geniş arama): "${text.trim().substring(0, 50)}"`);
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
        console.error(`❌ [Playwright] "New & Used" link bulunamadı - Sayfa URL: ${page.url()}`);
        return {
          success: false,
          data: null,
          error: 'New & Used link bulunamadı - Bu ürün için seller bilgisi yok olabilir',
          status: 404
        };
      }
      
      // "New & Used" linkine/div'ine tıkla
      console.log(`🖱️ [Playwright] "New & Used" elementine tıklanıyor...`);
      try {
        // Element tipini kontrol et
        const tagName = await newAndUsedLink.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
        console.log(`🔍 [Playwright] Element tipi: ${tagName}`);
        
        await newAndUsedLink.scrollIntoViewIfNeeded();
        await this.safeWait(page, 500);
        
        // Eğer div ise, önce parent link'i dene
        if (tagName === 'div') {
          try {
            // Div'in parent'ında link var mı kontrol et
            const parentLink = await newAndUsedLink.evaluateHandle(el => {
              let current = el.parentElement;
              let depth = 0;
              while (current && current.tagName !== 'A' && current !== document.body && depth < 5) {
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
              // Div'e direkt tıkla
              await newAndUsedLink.click({ timeout: 30000 });
              console.log(`✅ [Playwright] Div'e tıklandı`);
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
          throw forceClickError;
        }
      }
      
      // 3 saniye bekle (modal/sayfa açılması için)
      console.log(`⏳ [Playwright] Modal/sayfa açılması bekleniyor (3 saniye)...`);
      await this.safeWait(page, 3000);
      
      // AOD (All Offers Display) container'ını bekle
      console.log(`🛒 [Playwright] Seller listesi container'ı bekleniyor...`);
      try {
        await page.waitForSelector('#all-offers-display, #aod-container, #aod-offer-list, #aod-offer', { timeout: 20000, state: 'visible' });
        console.log(`✅ [Playwright] Seller listesi container bulundu`);
      } catch (e) {
        console.warn(`⚠️ [Playwright] Seller listesi container bulunamadı, devam ediliyor: ${e.message}`);
      }
      await this.safeWait(page, 2000);
      
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
      
      // Tüm seller offer'larını çek
      const sellers = [];
      try {
        // Tüm #aod-offer elementlerini bul
        const offerElements = await page.$$('#aod-offer, div[id^="aod-offer"]');
        console.log(`🔍 [Playwright] ${offerElements.length} seller offer bulundu`);
        
        for (let i = 0; i < offerElements.length; i++) {
          const offer = offerElements[i];
          try {
            const sellerData = await this.extractSellerDataFromOffer(page, offer, i);
            if (sellerData) {
              sellers.push(sellerData);
              console.log(`✅ [Playwright] Seller ${i + 1}/${offerElements.length} çekildi: ${sellerData.sellerName || 'N/A'}`);
            }
          } catch (e) {
            console.warn(`⚠️ [Playwright] Seller ${i + 1} çekilirken hata: ${e.message}`);
          }
        }
        
        console.log(`✅ [Playwright] Toplam ${sellers.length} seller bilgisi çekildi`);
      } catch (e) {
        console.error(`❌ [Playwright] Seller bilgileri çekilirken hata: ${e.message}`);
      }
      
      return {
        success: true,
        data: {
          asin: asin,
          sourceMarketplace: sourceMarketplace,
          targetCountry: targetCountry,
          totalSellers: totalSellers || sellers.length,
          sellers: sellers,
          marketplace: 'source' // Kaynak mağaza
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
