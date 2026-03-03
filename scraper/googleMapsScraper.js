/**
 * Google Maps Scraper Module
 * 
 * Production-grade Puppeteer-based scraper with:
 * - Stealth mode for anti-blocking
 * - Infinite scroll handling
 * - Progressive result streaming
 * - Retry logic and error handling
 * - Deep phone number extraction from detail pages
 * 
 * LEGAL DISCLAIMER:
 * This scraper extracts only publicly visible business data.
 * It does NOT bypass login walls or automate Google accounts.
 * Users must comply with applicable laws and terms of service.
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import config from '../config/index.js';
import {
    getRandomUserAgent,
    getRandomDelay,
    sleep,
    randomSleep,
    cleanText,
    extractCoordinates,
    extractPlaceId,
    generateBusinessId,
    formatPhone,
    cleanUrl,
    retryWithBackoff,
} from '../utils/helpers.js';
import AsyncQueue from '../utils/asyncQueue.js';
import { extractPlaceDetails } from './detailScraper.js';
import { generateSearchLocations, parseLocationQuery, extractKeywordFromQuery } from '../geo/regions.js';

if (config.scraper.enableStealth) {
    puppeteer.use(StealthPlugin());
}

/**
 * Main Google Maps Scraper Class
 */
export class GoogleMapsScraper {
    constructor(options = {}) {
        this.browser = null;
        this.page = null;
        this.seenIds = new Set();
        this.aborted = false;
        this.pendingDetailExtractions = [];
        this.options = {
            onData: options.onData || (() => { }),
            onProgress: options.onProgress || (() => { }),
            onError: options.onError || (() => { }),
            onComplete: options.onComplete || (() => { }),
            extractPhoneDetails: options.extractPhoneDetails !== false, // Enable by default
            detailExtractionBatchSize: options.detailExtractionBatchSize || 10,
        };
        this.stats = {
            totalFound: 0,
            totalStreamed: 0,
            scrollCount: 0,
            phonesExtracted: 0,
            startTime: null,
            endTime: null,
        };
    }

    /**
     * Initialize the browser instance
     */
    async initialize() {
        const launchOptions = {
            headless: config.puppeteer.headless ? 'new' : false,
            args: config.puppeteer.args,
            defaultViewport: config.puppeteer.defaultViewport,
        };

        // Add executable path if specified in config
        if (config.puppeteer.executablePath) {
            launchOptions.executablePath = config.puppeteer.executablePath;
        }

        this.browser = await puppeteer.launch(launchOptions);
        this.page = await this.browser.newPage();

        await this.page.setUserAgent(getRandomUserAgent());

        await this.page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        });

        // Only block images and media to speed up, but keep fonts/styles for proper rendering
        await this.page.setRequestInterception(true);
        this.page.on('request', (req) => {
            const resourceType = req.resourceType();
            const url = req.url();

            // Only block large media files, keep everything else
            const blockedTypes = ['media'];
            const blockedPatterns = [
                /\.mp4/i,
                /\.webm/i,
                /\.avi/i,
            ];

            const isBlocked = blockedTypes.includes(resourceType) ||
                blockedPatterns.some(p => p.test(url));

            if (isBlocked) {
                req.abort();
            } else {
                req.continue();
            }
        });

        this.page.on('console', msg => {
            if (config.server.nodeEnv === 'development') {
                console.log('Browser console:', msg.text());
            }
        });
    }

    /**
     * Navigate to Google Maps search results
     * @param {string} query - Search query
     */
    async navigateToSearch(query) {
        const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;

        await this.page.goto(searchUrl, {
            waitUntil: 'domcontentloaded',
            timeout: config.puppeteer.timeout,
        });

        await randomSleep(1500, 2500);

        try {
            await this.page.waitForSelector('div[role="feed"]', { timeout: 15000 });
        } catch {
            const singleResult = await this.page.$('div[role="main"]');
            if (singleResult) {
                console.log('Single result or different layout detected');
            }
        }
    }

    /**
     * Extract phone number by finding and clicking a listing by its name
     * @param {string} name - Name of the listing to find
     * @returns {Promise<object|null>} Phone data or null
     */
    async extractPhoneByName(name) {
        try {
            // Find and click the listing by its aria-label (name)
            const clicked = await this.page.evaluate((targetName) => {
                const articles = document.querySelectorAll('div[role="article"]');
                for (const article of articles) {
                    const ariaLabel = article.getAttribute('aria-label') || '';
                    if (ariaLabel === targetName || ariaLabel.includes(targetName.substring(0, 20))) {
                        article.click();
                        return true;
                    }
                }
                return false;
            }, name);

            if (!clicked) {
                console.log(`Could not find listing: ${name}`);
                return null;
            }

            // Wait for detail panel to load
            await randomSleep(2000, 3000);

            // Extract phone from the detail panel
            const phoneData = await this.page.evaluate(() => {
                const result = { phoneNumber: 'N/A', phoneNumbers: [], website: 'N/A' };

                // Method 1: Look for phone button/link with data-item-id containing "phone"
                const allButtons = document.querySelectorAll('button[data-item-id], a[data-item-id]');
                allButtons.forEach(btn => {
                    const itemId = btn.getAttribute('data-item-id') || '';
                    if (itemId.includes('phone')) {
                        const phone = itemId.replace('phone:tel:', '').replace('phone:', '').replace('tel:', '');
                        if (phone && phone.replace(/\D/g, '').length >= 10) {
                            result.phoneNumbers.push(phone);
                        }
                    }
                });

                // Method 2: Look for tel: links
                document.querySelectorAll('a[href^="tel:"]').forEach(link => {
                    const phone = link.href.replace('tel:', '');
                    if (phone && !result.phoneNumbers.includes(phone)) {
                        result.phoneNumbers.push(phone);
                    }
                });

                // Method 3: Search the detail panel for phone patterns
                const mainPanel = document.querySelector('div[role="main"]');
                if (mainPanel) {
                    const allText = mainPanel.innerText;

                    // Match phone patterns - Indian format
                    const patterns = [
                        /0\d{4}\s?\d{5,6}/g,      // 0XXXX XXXXX (landline like 08000 26260)
                        /0\d{2,3}[\s\-]?\d{7,8}/g, // Landline with STD
                        /\+91[\s\-]?\d{5}[\s\-]?\d{5}/g,
                        /\+91[\s\-]?\d{10}/g,
                        /[6-9]\d{4}[\s\-]?\d{5}/g,
                        /[6-9]\d{9}/g,
                    ];

                    for (const pattern of patterns) {
                        const matches = allText.match(pattern);
                        if (matches) {
                            matches.forEach(m => {
                                const cleaned = m.replace(/[\s\-]/g, '');
                                if (cleaned.length >= 10 && cleaned.length <= 13 && !result.phoneNumbers.includes(cleaned)) {
                                    result.phoneNumbers.push(cleaned);
                                }
                            });
                        }
                    }
                }

                // Method 4: Website
                const websiteBtn = document.querySelector('a[data-item-id^="authority"]');
                if (websiteBtn && websiteBtn.href && !websiteBtn.href.includes('google.com')) {
                    result.website = websiteBtn.href;
                }

                if (result.phoneNumbers.length > 0) {
                    result.phoneNumber = result.phoneNumbers[0];
                }

                return result;
            });

            // Close the detail panel
            await this.page.keyboard.press('Escape');
            await sleep(800);

            return phoneData;

        } catch (error) {
            console.error(`Error extracting phone for ${name}:`, error.message);
            await this.page.keyboard.press('Escape').catch(() => { });
            await sleep(500);
            return null;
        }
    }

    /**
     * Click on a listing by index and extract phone number
     * @param {number} index - Index of the listing in the current view
     * @returns {Promise<object|null>} Phone data or null
     */
    async clickAndExtractPhone(index) {
        try {
            // Get the profile URL from the listing
            const profileUrl = await this.page.evaluate((idx) => {
                const articles = document.querySelectorAll('div[role="article"]');
                if (idx >= articles.length) return null;

                const article = articles[idx];
                // Find the link to the place
                const link = article.querySelector('a[href*="/maps/place/"]');
                return link ? link.href : null;
            }, index);

            if (!profileUrl) {
                console.log(`  No profile URL found for index ${index}`);
                return null;
            }

            // Navigate to the profile page
            await this.page.goto(profileUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 15000,
            });

            // Wait for the detail page to load
            await sleep(3000);

            // Extract phone from detail page
            const phoneData = await this.page.evaluate(() => {
                const result = { phoneNumber: 'N/A', website: 'N/A', address: 'N/A' };

                // Method 1: Look for data-item-id with phone
                document.querySelectorAll('[data-item-id]').forEach(el => {
                    const itemId = el.getAttribute('data-item-id') || '';
                    if (itemId.toLowerCase().includes('phone')) {
                        let phone = itemId.replace('phone:tel:', '').replace('phone:', '').replace('tel:', '');
                        if (phone && phone.replace(/\D/g, '').length >= 10) {
                            result.phoneNumber = phone;
                        }
                    }
                    if (itemId.includes('authority')) {
                        const href = el.getAttribute('href') || el.querySelector('a')?.href;
                        if (href && !href.includes('google.com')) {
                            result.website = href;
                        }
                    }
                    if (itemId.includes('address')) {
                        const ariaLabel = el.getAttribute('aria-label') || '';
                        result.address = ariaLabel.replace(/^Address:\s*/i, '').trim();
                    }
                });

                // Method 2: tel: links
                if (result.phoneNumber === 'N/A') {
                    const telLink = document.querySelector('a[href^="tel:"]');
                    if (telLink) {
                        result.phoneNumber = telLink.href.replace('tel:', '');
                    }
                }

                // Method 3: Search text for phone patterns
                if (result.phoneNumber === 'N/A') {
                    const mainPanel = document.querySelector('div[role="main"]');
                    if (mainPanel) {
                        const text = mainPanel.innerText;
                        const patterns = [
                            /0\d{4}\s?\d{5,6}/,
                            /0\d{2,4}[\s\-]?\d{6,8}/,
                            /\+91[\s\-]?\d{5}[\s\-]?\d{5}/,
                            /[6-9]\d{4}[\s\-]?\d{5}/,
                            /[6-9]\d{9}/,
                        ];
                        for (const pattern of patterns) {
                            const match = text.match(pattern);
                            if (match) {
                                result.phoneNumber = match[0].replace(/[\s\-]/g, '');
                                break;
                            }
                        }
                    }
                }

                return result;
            });

            // Go back to the search results
            await this.page.goBack({ waitUntil: 'domcontentloaded' });
            await sleep(1500);

            return phoneData;

        } catch (error) {
            console.log(`  Error: ${error.message}`);
            // Try to go back
            await this.page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => { });
            await sleep(1000);
            return null;
        }
    }

    /**
     * Extract phone number by clicking on a listing (inline extraction)
     * @param {number} index - Index of the listing to click
     * @returns {Promise<object|null>} Phone data or null
     */
    async extractPhoneFromListing(index) {
        try {
            // Get the listing element
            const articles = await this.page.$$('div[role="article"]');
            if (index >= articles.length) return null;

            const article = articles[index];

            // Click on the listing to open detail panel
            await article.click();
            await randomSleep(1200, 2000);

            // Extract phone from the detail panel
            const phoneData = await this.page.evaluate(() => {
                const result = { phoneNumber: 'N/A', phoneNumbers: [], website: 'N/A' };

                // Method 1: Look for phone button/link with data-item-id containing "phone"
                const allButtons = document.querySelectorAll('button[data-item-id], a[data-item-id]');
                allButtons.forEach(btn => {
                    const itemId = btn.getAttribute('data-item-id') || '';
                    if (itemId.includes('phone')) {
                        // Extract phone from data-item-id
                        const phone = itemId.replace('phone:tel:', '').replace('phone:', '').replace('tel:', '');
                        if (phone && phone.replace(/\D/g, '').length >= 10) {
                            result.phoneNumbers.push(phone);
                        }
                    }
                    // Also check aria-label for phone
                    const ariaLabel = btn.getAttribute('aria-label') || '';
                    if (ariaLabel.toLowerCase().includes('phone') || ariaLabel.match(/\d{5}\s?\d{5}/)) {
                        const phoneMatch = ariaLabel.match(/[\d\s\-\+\(\)]{10,}/);
                        if (phoneMatch) {
                            const cleaned = phoneMatch[0].replace(/[\s\-\(\)]/g, '');
                            if (cleaned.length >= 10 && !result.phoneNumbers.includes(cleaned)) {
                                result.phoneNumbers.push(cleaned);
                            }
                        }
                    }
                });

                // Method 2: Look for tel: links
                const telLinks = document.querySelectorAll('a[href^="tel:"]');
                telLinks.forEach(link => {
                    const phone = link.href.replace('tel:', '');
                    if (phone && !result.phoneNumbers.includes(phone)) {
                        result.phoneNumbers.push(phone);
                    }
                });

                // Method 3: Look for elements with phone icon and nearby text
                const phoneIconContainers = document.querySelectorAll('[data-tooltip*="phone"], [aria-label*="Phone"], [aria-label*="Call"]');
                phoneIconContainers.forEach(container => {
                    const text = container.textContent || container.getAttribute('aria-label') || '';
                    const phoneMatch = text.match(/0\d{4,5}[\s]?\d{5,6}|[6-9]\d{9}|\+91[\s]?\d{10}/);
                    if (phoneMatch && !result.phoneNumbers.includes(phoneMatch[0])) {
                        result.phoneNumbers.push(phoneMatch[0].replace(/\s/g, ''));
                    }
                });

                // Method 4: Search all text in the detail panel for phone patterns
                const mainPanel = document.querySelector('div[role="main"]');
                if (mainPanel) {
                    const allText = mainPanel.innerText;

                    // Comprehensive Indian phone patterns
                    const patterns = [
                        /0\d{4}\s?\d{5,6}/g,      // 0XXXX XXXXX or 0XXXX XXXXXX (like 08000 26260)
                        /0\d{2,3}[\s\-]?\d{7,8}/g, // 0XX-XXXXXXX landline
                        /\+91[\s\-]?\d{5}[\s\-]?\d{5}/g, // +91 format
                        /\+91[\s\-]?\d{10}/g,      // +91XXXXXXXXXX
                        /[6-9]\d{4}[\s\-]?\d{5}/g, // Mobile 6-9XXXX XXXXX
                        /[6-9]\d{9}/g,             // Mobile 10 digit
                    ];

                    for (const pattern of patterns) {
                        const matches = allText.match(pattern);
                        if (matches) {
                            matches.forEach(m => {
                                const cleaned = m.replace(/[\s\-]/g, '');
                                if (cleaned.length >= 10 && cleaned.length <= 13 && !result.phoneNumbers.includes(cleaned)) {
                                    result.phoneNumbers.push(cleaned);
                                }
                            });
                        }
                    }
                }

                // Method 5: Look for website
                const websiteBtn = document.querySelector('a[data-item-id^="authority"], a[aria-label*="website"]');
                if (websiteBtn && websiteBtn.href && !websiteBtn.href.includes('google.com')) {
                    result.website = websiteBtn.href;
                }

                if (result.phoneNumbers.length > 0) {
                    result.phoneNumber = result.phoneNumbers[0];
                }

                return result;
            });

            // Press Escape to close the detail panel and go back to list
            await this.page.keyboard.press('Escape');
            await sleep(500);

            return phoneData;

        } catch (error) {
            console.error(`Error extracting phone for listing ${index}:`, error.message);
            // Try to close any open panel
            await this.page.keyboard.press('Escape').catch(() => { });
            await sleep(300);
            return null;
        }
    }

    /**
     * Extract business data from visible listings
     * @returns {Promise<Array>} Array of business objects
     */
    async extractVisibleListings() {
        return await this.page.evaluate(() => {
            const results = [];
            const articles = document.querySelectorAll('div[role="article"]');

            articles.forEach(article => {
                try {
                    const text = article.innerText || '';
                    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

                    const name = article.getAttribute('aria-label') || lines[0] || '';
                    if (!name || name === 'Unknown') return;

                    let rating = 'N/A';
                    let reviews = '0';
                    const ratingMatch = text.match(/(\d\.\d)\s*\(([0-9,]+)\)/);
                    if (ratingMatch) {
                        rating = ratingMatch[1];
                        reviews = ratingMatch[2].replace(/,/g, '');
                    } else {
                        const altRatingMatch = text.match(/(\d\.\d)/);
                        if (altRatingMatch) {
                            rating = altRatingMatch[1];
                        }
                    }

                    const excludePatterns = [
                        /Open|Closed|Opens|Closes/i,
                        /^\d+$/,
                        /^\(.*\)$/,
                        /^Rating/i,
                    ];

                    const categoryLine = lines.find(line => {
                        if (line === name) return false;
                        if (line.match(/(\d\.\d)/)) return false;
                        if (excludePatterns.some(p => p.test(line))) return false;
                        if (line.includes(',') && line.match(/\d/)) return false;
                        return line.length < 50;
                    });
                    const category = categoryLine || 'N/A';

                    const statusMatch = text.match(/(Open|Closed|Opens\s+\d+|Closes\s+\d+[ap]m|Open\s*⋅|Closed\s*⋅)[^\\n]*/i);
                    const status = statusMatch ? statusMatch[0].trim() : 'Unknown';

                    const addressLine = lines.find(line => {
                        if (line === name || line === category) return false;
                        const hasAddressIndicators =
                            line.match(/\d+\s+\w+/) ||
                            line.includes(',') ||
                            /St|Rd|Ave|Blvd|Dr|Lane|Way|Street|Road|Avenue|Boulevard|Drive|Highway|Hwy/i.test(line);
                        return hasAddressIndicators && line.length > 10;
                    });
                    const address = addressLine || 'N/A';

                    // Enhanced phone patterns for Indian numbers
                    const phonePatterns = [
                        /\+91[\s\-]?\d{5}[\s\-]?\d{5}/,           // +91 XXXXX XXXXX
                        /\+91[\s\-]?\d{10}/,                       // +91XXXXXXXXXX
                        /0\d{2,4}[\s\-]?\d{6,8}/,                  // Landline with STD code
                        /\d{5}[\s\-]?\d{5}/,                       // 10 digit mobile XXXXX XXXXX
                        /[6-9]\d{9}/,                               // 10 digit starting with 6-9
                        /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/, // International
                        /(\+?\d{1,3}[-.\s]?)?\d{2,5}[-.\s]?\d{3,5}[-.\s]?\d{3,5}/, // General
                    ];
                    let phoneNumber = 'N/A';
                    for (const pattern of phonePatterns) {
                        const phoneMatch = text.match(pattern);
                        if (phoneMatch) {
                            const potentialPhone = phoneMatch[0].trim();
                            // Validate: should have at least 10 digits
                            const digitsOnly = potentialPhone.replace(/\D/g, '');
                            if (digitsOnly.length >= 10) {
                                phoneNumber = potentialPhone;
                                break;
                            }
                        }
                    }

                    const links = article.querySelectorAll('a[href]');
                    let profileUrl = '';
                    let website = 'N/A';

                    links.forEach(link => {
                        const href = link.href;
                        if (href.includes('/maps/place/')) {
                            profileUrl = href;
                        } else if (
                            href &&
                            !href.includes('google.com/maps') &&
                            !href.includes('google.com/search') &&
                            !href.includes('accounts.google.com') &&
                            (href.startsWith('http://') || href.startsWith('https://'))
                        ) {
                            if (website === 'N/A') {
                                website = href;
                            }
                        }
                    });

                    let placeId = '';
                    if (profileUrl) {
                        const cidMatch = profileUrl.match(/[?&]cid=(\d+)/);
                        const dataMatch = profileUrl.match(/!1s(0x[a-f0-9]+:[a-f0-9x]+)/i);
                        const placeMatch = profileUrl.match(/place\/([^/]+)/);

                        if (cidMatch) placeId = `cid:${cidMatch[1]}`;
                        else if (dataMatch) placeId = dataMatch[1];
                        else if (placeMatch) placeId = placeMatch[1];
                    }

                    let latitude = null;
                    let longitude = null;
                    if (profileUrl) {
                        const coordMatch = profileUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
                        if (coordMatch) {
                            latitude = parseFloat(coordMatch[1]);
                            longitude = parseFloat(coordMatch[2]);
                        }
                    }

                    const uniqueId = placeId || `${name}_${address}_${phoneNumber}`.toLowerCase().replace(/[^a-z0-9]/g, '_');

                    results.push({
                        id: uniqueId,
                        placeId: placeId || 'N/A',
                        name,
                        category,
                        status,
                        rating,
                        reviews,
                        phoneNumber,
                        address,
                        website,
                        profileUrl: profileUrl || 'N/A',
                        latitude,
                        longitude,
                        source: 'Google Maps',
                        scrapedAt: new Date().toISOString(),
                    });
                } catch (err) {
                    console.error('Error extracting listing:', err);
                }
            });

            return results;
        });
    }

    /**
     * Find the correct scrollable container (Google Maps changes this)
     * @returns {Promise<string|null>} CSS selector for scrollable container
     */
    async findScrollableContainer() {
        return await this.page.evaluate(() => {
            // Try multiple possible selectors for the scrollable container
            const selectors = [
                'div[role="feed"]',
                'div.m6QErb[aria-label]',
                'div.m6QErb.DxyBCb',
                'div[aria-label*="Results"]',
                'div.section-layout.section-scrollbox',
            ];

            for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (el && el.scrollHeight > el.clientHeight) {
                    return selector;
                }
            }

            // Fallback: find any scrollable div with substantial content
            const divs = document.querySelectorAll('div');
            for (const div of divs) {
                if (div.scrollHeight > 1000 &&
                    div.scrollHeight > div.clientHeight &&
                    div.querySelectorAll('a[href*="/maps/place/"]').length > 5) {
                    // Return a unique identifier
                    div.setAttribute('data-scroll-target', 'true');
                    return 'div[data-scroll-target="true"]';
                }
            }

            return 'div[role="feed"]';
        });
    }

    /**
     * Aggressive scroll with multiple methods
     * @param {string} containerSelector - Selector for scrollable container
     */
    async performScroll(containerSelector) {
        // Method 1: Direct scrollTop manipulation (most reliable)
        await this.page.evaluate((selector) => {
            const container = document.querySelector(selector);
            if (container) {
                // Scroll to bottom
                container.scrollTop = container.scrollHeight;
            }
        }, containerSelector);

        await sleep(300);

        // Method 2: scrollBy for additional push
        await this.page.evaluate((selector) => {
            const container = document.querySelector(selector);
            if (container) {
                container.scrollBy({ top: 2000, behavior: 'smooth' });
            }
        }, containerSelector);

        await sleep(300);

        // Method 3: Focus container and use keyboard
        await this.page.evaluate((selector) => {
            const container = document.querySelector(selector);
            if (container) {
                container.focus();
            }
        }, containerSelector);

        await this.page.keyboard.press('End');
        await this.page.keyboard.press('PageDown');
        await this.page.keyboard.press('PageDown');

        // Method 4: Mouse wheel simulation
        const containerBox = await this.page.evaluate((selector) => {
            const el = document.querySelector(selector);
            if (el) {
                const rect = el.getBoundingClientRect();
                return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
            }
            return null;
        }, containerSelector);

        if (containerBox) {
            await this.page.mouse.move(containerBox.x, containerBox.y);
            await this.page.mouse.wheel({ deltaY: 1500 });
        }
    }

    /**
     * Scroll the results feed and detect end of list
     * @returns {Promise<object>} Scroll result with height and end state
     */
    async scrollAndCheck() {
        // Find the correct scrollable container
        const containerSelector = await this.findScrollableContainer();

        if (!containerSelector) {
            return { height: 0, endReached: true, error: 'Scrollable container not found' };
        }

        // Get current state before scroll
        const beforeState = await this.page.evaluate((selector) => {
            const container = document.querySelector(selector);
            const articles = document.querySelectorAll('div[role="article"], a[href*="/maps/place/"]');
            return {
                height: container ? container.scrollHeight : 0,
                scrollTop: container ? container.scrollTop : 0,
                articleCount: articles.length,
            };
        }, containerSelector);

        // Perform aggressive scroll
        await this.performScroll(containerSelector);

        // Wait for content to load - reduced delay for speed
        await sleep(800);

        // Quick network idle check
        try {
            await this.page.waitForNetworkIdle({ idleTime: 300, timeout: 1500 });
        } catch {
            // Timeout is ok, just continue
        }

        // Check for end indicators and get new state
        const result = await this.page.evaluate((selector) => {
            const container = document.querySelector(selector);
            const articles = document.querySelectorAll('div[role="article"], a[href*="/maps/place/"]');

            if (!container) {
                return { height: 0, endReached: true, error: 'Container not found' };
            }

            // Check for end-of-list indicators - expanded list
            const endIndicators = [
                "You've reached the end of the list",
                "No more results",
                "End of results",
                "Keine weiteren Ergebnisse",
                "Вы достигли конца списка",
            ];

            // Also check in the container specifically
            const containerText = container.innerText || '';
            const bodyText = document.body.innerText || '';

            const hasEndIndicator = endIndicators.some(indicator =>
                bodyText.toLowerCase().includes(indicator.toLowerCase()) ||
                containerText.toLowerCase().includes(indicator.toLowerCase())
            );

            // Check if we're at the bottom
            const isAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 50;

            return {
                height: container.scrollHeight,
                scrollTop: container.scrollTop,
                clientHeight: container.clientHeight,
                articleCount: articles.length,
                endReached: hasEndIndicator,
                isAtBottom,
            };
        }, containerSelector);

        return {
            ...result,
            previousHeight: beforeState.height,
            previousArticleCount: beforeState.articleCount,
            scrolled: result.scrollTop !== beforeState.scrollTop,
            newArticlesLoaded: result.articleCount > beforeState.articleCount,
        };
    }

    /**
     * Scrape one listing at a time with phone extraction
     * Click each listing, extract phone, then move to next
     * @param {string} query - Search query
     */
    async scrapeOneByOne(query) {
        this.stats.startTime = Date.now();
        console.log(`Starting one-by-one scrape for: "${query}"`);

        try {
            await this.initialize();
            await this.navigateToSearch(query);
            await randomSleep(2000, 3000);

            let processedCount = 0;
            let stuckCount = 0;
            const maxStuck = 10;

            while (!this.aborted && stuckCount < maxStuck) {
                // Get all visible articles
                const articles = await this.page.$$('div[role="article"]');
                let foundNew = false;

                for (let i = 0; i < articles.length; i++) {
                    if (this.aborted) break;

                    try {
                        // Get basic info from the listing
                        const basicInfo = await this.page.evaluate((idx) => {
                            const articles = document.querySelectorAll('div[role="article"]');
                            if (idx >= articles.length) return null;

                            const article = articles[idx];
                            const name = article.getAttribute('aria-label') || '';
                            const text = article.innerText || '';

                            // Generate a simple ID
                            const id = name.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 30);

                            return { name, text, id, index: idx };
                        }, i);

                        if (!basicInfo || !basicInfo.name || this.seenIds.has(basicInfo.id)) {
                            continue;
                        }

                        // Mark as seen
                        this.seenIds.add(basicInfo.id);
                        foundNew = true;

                        // Click on the listing
                        console.log(`[${processedCount + 1}] Processing: ${basicInfo.name}`);

                        await this.page.evaluate((idx) => {
                            const articles = document.querySelectorAll('div[role="article"]');
                            if (articles[idx]) articles[idx].click();
                        }, i);

                        // Wait for detail panel to load - wait for h1 element
                        try {
                            await this.page.waitForSelector('h1', { timeout: 5000 });
                            await sleep(2000); // Additional wait for phone to load
                        } catch (e) {
                            console.log('  Warning: Detail panel may not have loaded fully');
                        }

                        // Extract all details from the detail panel
                        const details = await this.page.evaluate(() => {
                            const result = {
                                name: '',
                                phoneNumber: 'N/A',
                                website: 'N/A',
                                address: 'N/A',
                                rating: 'N/A',
                                reviews: '0',
                                category: 'N/A',
                                debug: [],
                            };

                            // Get name from header
                            const nameEl = document.querySelector('h1');
                            if (nameEl) result.name = nameEl.textContent.trim();

                            // Get rating
                            const ratingEl = document.querySelector('span[role="img"]');
                            if (ratingEl) {
                                const ariaLabel = ratingEl.getAttribute('aria-label') || '';
                                const match = ariaLabel.match(/([\d.]+)\s*star/i);
                                if (match) result.rating = match[1];
                            }

                            // Get reviews count
                            const reviewsMatch = document.body.innerText.match(/\(([\d,]+)\s*reviews?\)/i);
                            if (reviewsMatch) result.reviews = reviewsMatch[1].replace(/,/g, '');

                            // Get category
                            const categoryEl = document.querySelector('button[jsaction*="category"]');
                            if (categoryEl) result.category = categoryEl.textContent.trim();

                            // METHOD 1: Look for ALL elements with data-item-id and find phone
                            const allDataItems = document.querySelectorAll('[data-item-id]');
                            allDataItems.forEach(el => {
                                const itemId = el.getAttribute('data-item-id') || '';
                                result.debug.push(itemId);

                                if (itemId.toLowerCase().includes('phone') || itemId.startsWith('tel:')) {
                                    // Extract phone from the data-item-id
                                    let phone = itemId
                                        .replace('phone:tel:', '')
                                        .replace('phone:', '')
                                        .replace('tel:', '')
                                        .trim();
                                    if (phone && phone.replace(/\D/g, '').length >= 10) {
                                        result.phoneNumber = phone;
                                    }
                                }

                                // Also check aria-label for phone number
                                const ariaLabel = el.getAttribute('aria-label') || '';
                                if (ariaLabel.toLowerCase().includes('phone') || ariaLabel.toLowerCase().includes('call')) {
                                    const phoneMatch = ariaLabel.match(/[\d\s\+\-]{10,}/);
                                    if (phoneMatch && result.phoneNumber === 'N/A') {
                                        result.phoneNumber = phoneMatch[0].replace(/[\s\-]/g, '');
                                    }
                                }

                                // Address
                                if (itemId.includes('address')) {
                                    const ariaLabel = el.getAttribute('aria-label') || '';
                                    result.address = ariaLabel.replace(/^Address:\s*/i, '').trim() || el.textContent?.trim() || '';
                                }

                                // Website
                                if (itemId.includes('authority')) {
                                    const href = el.getAttribute('href') || el.querySelector('a')?.href;
                                    if (href && !href.includes('google.com')) {
                                        result.website = href;
                                    }
                                }
                            });

                            // METHOD 2: Check for tel: links directly
                            if (result.phoneNumber === 'N/A') {
                                const telLinks = document.querySelectorAll('a[href^="tel:"]');
                                telLinks.forEach(link => {
                                    const phone = link.href.replace('tel:', '');
                                    if (phone && result.phoneNumber === 'N/A') {
                                        result.phoneNumber = phone;
                                    }
                                });
                            }

                            // METHOD 3: Look for the phone icon row
                            if (result.phoneNumber === 'N/A') {
                                // Google Maps shows phone with a specific icon, look for it
                                const allButtons = document.querySelectorAll('button');
                                allButtons.forEach(btn => {
                                    const text = btn.textContent || '';
                                    const ariaLabel = btn.getAttribute('aria-label') || '';

                                    // Check if this looks like a phone number
                                    const phonePattern = /0\d{4,5}\s?\d{5,6}|[6-9]\d{9}|\+91\s?\d{10}/;
                                    if (phonePattern.test(text)) {
                                        result.phoneNumber = text.match(phonePattern)[0].replace(/\s/g, '');
                                    }
                                    if (phonePattern.test(ariaLabel)) {
                                        result.phoneNumber = ariaLabel.match(phonePattern)[0].replace(/\s/g, '');
                                    }
                                });
                            }

                            // METHOD 4: Search all visible text for phone patterns
                            if (result.phoneNumber === 'N/A') {
                                const mainPanel = document.querySelector('div[role="main"]');
                                if (mainPanel) {
                                    const allText = mainPanel.innerText;

                                    // Look for phone number patterns
                                    const patterns = [
                                        /0\d{4}\s?\d{5,6}/g,           // 08000 26260
                                        /0\d{2,4}[\s\-]?\d{6,8}/g,     // Landline
                                        /\+91[\s\-]?\d{5}[\s\-]?\d{5}/g, // +91
                                        /\+91[\s\-]?\d{10}/g,          // +91XXXXXXXXXX  
                                        /[6-9]\d{4}[\s\-]?\d{5}/g,     // Mobile with space
                                        /[6-9]\d{9}/g,                  // Mobile 10 digit
                                    ];

                                    for (const pattern of patterns) {
                                        const matches = allText.match(pattern);
                                        if (matches && matches.length > 0) {
                                            result.phoneNumber = matches[0].replace(/[\s\-]/g, '');
                                            break;
                                        }
                                    }
                                }
                            }

                            // Get profile URL
                            result.profileUrl = window.location.href;

                            return result;
                        });

                        // Debug output
                        if (details.debug && details.debug.length > 0) {
                            console.log(`  Data items found: ${details.debug.filter(d => d.includes('phone')).join(', ') || 'none with phone'}`);
                        }

                        // Close detail panel
                        await this.page.keyboard.press('Escape');
                        await sleep(800);

                        // Create the final listing object
                        const listing = {
                            id: basicInfo.id,
                            name: details.name || basicInfo.name,
                            phoneNumber: formatPhone(details.phoneNumber),
                            website: cleanUrl(details.website),
                            address: details.address,
                            rating: details.rating,
                            reviews: details.reviews,
                            category: details.category,
                            profileUrl: details.profileUrl,
                            scrapedAt: new Date().toISOString(),
                        };

                        processedCount++;
                        if (details.phoneNumber !== 'N/A') {
                            this.stats.phonesExtracted++;
                            console.log(`  ✓ Phone: ${details.phoneNumber}`);
                        }

                        this.options.onData(listing);
                        this.options.onProgress({
                            totalFound: processedCount,
                            phonesExtracted: this.stats.phonesExtracted,
                        });

                    } catch (err) {
                        console.error(`Error processing listing:`, err.message);
                        await this.page.keyboard.press('Escape').catch(() => { });
                        await sleep(500);
                    }
                }

                if (!foundNew) {
                    // Scroll to load more
                    const scrolled = await this.scrollAndCheck();
                    if (scrolled.endReached) {
                        console.log('End of results reached');
                        break;
                    }
                    stuckCount++;
                    await sleep(2000);
                } else {
                    stuckCount = 0;
                }
            }

            const duration = Date.now() - this.stats.startTime;
            console.log(`Scrape complete: ${processedCount} listings, ${this.stats.phonesExtracted} phones in ${Math.round(duration / 1000)}s`);

            this.options.onComplete({
                totalFound: processedCount,
                phonesExtracted: this.stats.phonesExtracted,
                duration,
            });

        } catch (error) {
            console.error('Scraping error:', error);
            this.options.onError(error.message);
        } finally {
            await this.cleanup();
        }
    }

    /**
     * Main scraping loop with infinite scroll handling
     * @param {string} query - Search query
     */
    async scrape(query) {
        // Use one-by-one scraping for reliable phone extraction
        return this.scrapeOneByOne(query);
    }

    /**
     * Original fast scrape (without phone extraction)
     * @param {string} query - Search query
     */
    async scrapeFast(query) {
        this.stats.startTime = Date.now();
        console.log(`Starting fast scrape for: "${query}"`);

        try {
            await this.initialize();
            await this.navigateToSearch(query);

            // Initial wait for content to fully load
            await randomSleep(2000, 3000);

            let previousHeight = 0;
            let previousCount = 0;
            let previousArticleCount = 0;
            let stuckCount = 0;
            let noNewDataCount = 0;
            const maxStuckIterations = 30;  // Increased from 20
            const maxNoNewDataIterations = 15;
            let lastExtractTime = Date.now();

            for (let i = 0; i < config.scraper.maxScrollIterations; i++) {
                if (this.aborted) {
                    console.log('Scrape aborted by user');
                    break;
                }

                // Extract visible listings
                const listings = await this.extractVisibleListings();
                const newListings = listings.filter(l => !this.seenIds.has(l.id));
                const newListingsFound = newListings.length;

                // Process new listings - extract phone by clicking each one
                for (let j = 0; j < newListings.length; j++) {
                    const listing = newListings[j];

                    if (!this.seenIds.has(listing.id)) {
                        this.seenIds.add(listing.id);
                        this.stats.totalStreamed++;

                        // Extract phone by clicking on the listing using its name
                        let phoneNumber = listing.phoneNumber;
                        let website = listing.website;

                        if (phoneNumber === 'N/A') {
                            try {
                                // Find the actual index of this listing in the current DOM
                                const phoneData = await this.extractPhoneByName(listing.name);
                                if (phoneData && phoneData.phoneNumber && phoneData.phoneNumber !== 'N/A') {
                                    phoneNumber = phoneData.phoneNumber;
                                    this.stats.phonesExtracted++;
                                    console.log(`Extracted phone for ${listing.name}: ${phoneNumber}`);
                                }
                                if (phoneData && phoneData.website && phoneData.website !== 'N/A') {
                                    website = phoneData.website;
                                }
                            } catch (err) {
                                console.error(`Phone extraction failed for ${listing.name}:`, err.message);
                            }
                        }

                        const finalListing = {
                            ...listing,
                            phoneNumber: formatPhone(phoneNumber),
                            website: cleanUrl(website),
                        };

                        this.options.onData(finalListing);
                    }
                }

                // Track extraction success
                if (newListingsFound > 0) {
                    lastExtractTime = Date.now();
                    noNewDataCount = 0;
                } else {
                    noNewDataCount++;
                }

                this.stats.scrollCount++;

                this.options.onProgress({
                    scrollCount: this.stats.scrollCount,
                    totalFound: this.seenIds.size,
                    iteration: i + 1,
                    newListingsThisScroll: newListingsFound,
                });

                // Scroll and check for end
                const scrollResult = await this.scrollAndCheck();

                console.log(`Scroll ${i + 1}: height=${scrollResult.height}, articles=${scrollResult.articleCount}, items=${this.seenIds.size}, endReached=${scrollResult.endReached}, newLoaded=${scrollResult.newArticlesLoaded}`);

                // Check for explicit end indicator
                if (scrollResult.endReached) {
                    console.log('End of results indicator detected');
                    // Do a few more scrolls to make sure we got everything
                    for (let j = 0; j < 3; j++) {
                        await this.performScroll(await this.findScrollableContainer());
                        await sleep(1500);
                        const finalListings = await this.extractVisibleListings();
                        let idx = 0;
                        for (const listing of finalListings) {
                            if (!this.seenIds.has(listing.id)) {
                                this.seenIds.add(listing.id);
                                this.stats.totalStreamed++;

                                // Extract phone for new listings
                                let phoneNumber = listing.phoneNumber;
                                let website = listing.website;
                                if (phoneNumber === 'N/A' && listing.profileUrl) {
                                    try {
                                        const phoneData = await this.extractPhoneFromListing(idx);
                                        if (phoneData && phoneData.phoneNumber !== 'N/A') {
                                            phoneNumber = phoneData.phoneNumber;
                                            this.stats.phonesExtracted++;
                                        }
                                        if (phoneData && phoneData.website !== 'N/A') {
                                            website = phoneData.website;
                                        }
                                    } catch (err) { }
                                }

                                this.options.onData({
                                    ...listing,
                                    phoneNumber: formatPhone(phoneNumber),
                                    website: cleanUrl(website),
                                });
                            }
                            idx++;
                        }
                    }
                    break;
                }

                // Multi-factor stuck detection
                const currentCount = this.seenIds.size;
                const heightStuck = scrollResult.height === previousHeight;
                const countStuck = currentCount === previousCount;
                const articlesStuck = scrollResult.articleCount === previousArticleCount;

                if (heightStuck && countStuck && articlesStuck) {
                    stuckCount++;
                    console.log(`Stuck count: ${stuckCount}/${maxStuckIterations} (height: ${heightStuck}, count: ${countStuck}, articles: ${articlesStuck})`);

                    if (stuckCount >= maxStuckIterations) {
                        console.log('Scroll stuck - no new content after multiple attempts');
                        break;
                    }

                    // Aggressive recovery: try clicking outside and back
                    if (stuckCount > 5 && stuckCount % 5 === 0) {
                        console.log('Attempting scroll recovery...');
                        try {
                            // Click somewhere safe to reset focus
                            await this.page.mouse.click(500, 300);
                            await sleep(500);
                            // Click back on the list area
                            await this.page.mouse.click(200, 400);
                            await sleep(500);
                        } catch {
                            // Ignore click errors
                        }
                    }

                    // Wait longer when stuck to allow content to load
                    await randomSleep(
                        config.scraper.scrollDelayMax * 1.5,
                        config.scraper.scrollDelayMax * 2.5
                    );
                } else {
                    // Reset stuck count if we got new content
                    stuckCount = 0;
                }

                // Check if we've been getting no new data for too long
                const timeSinceLastData = Date.now() - lastExtractTime;
                if (noNewDataCount >= maxNoNewDataIterations && timeSinceLastData > 30000) {
                    console.log(`No new data for ${noNewDataCount} scrolls and ${Math.round(timeSinceLastData / 1000)}s - stopping`);
                    break;
                }

                previousHeight = scrollResult.height;
                previousCount = currentCount;
                previousArticleCount = scrollResult.articleCount;

                // Normal delay between scrolls
                await randomSleep(
                    config.scraper.scrollDelayMin,
                    config.scraper.scrollDelayMax
                );
            }

            this.stats.endTime = Date.now();
            const duration = (this.stats.endTime - this.stats.startTime) / 1000;

            console.log(`Scrape completed: ${this.seenIds.size} unique listings in ${duration.toFixed(1)}s`);

            this.options.onComplete({
                totalFound: this.seenIds.size,
                duration,
                scrollCount: this.stats.scrollCount,
                phonesExtracted: this.stats.phonesExtracted,
            });

        } catch (error) {
            console.error('Scraping error:', error);
            this.options.onError(error.message || 'Unknown scraping error');
        } finally {
            await this.cleanup();
        }
    }

    /**
     * Extract phone numbers using multiple parallel tabs for speed
     * @param {Array} listings - Array of listings to process
     * @param {number} numTabs - Number of parallel tabs to use (default: 5)
     * @returns {Promise<Array>} Enriched listings with phone numbers
     */
    async extractPhonesParallel(listings, numTabs = 5) {
        const needsPhone = listings.filter(l =>
            (!l.phoneNumber || l.phoneNumber === 'N/A') &&
            l.profileUrl && l.profileUrl !== 'N/A'
        );

        if (needsPhone.length === 0) {
            console.log('All listings already have phone numbers');
            return listings;
        }

        console.log(`Extracting phones for ${needsPhone.length} listings using ${numTabs} parallel tabs...`);

        // Create multiple tabs
        const tabs = [];
        for (let i = 0; i < numTabs; i++) {
            const tab = await this.browser.newPage();
            await tab.setUserAgent(getRandomUserAgent());
            await tab.setExtraHTTPHeaders({
                'Accept-Language': 'en-US,en;q=0.9',
            });
            // Block images for speed
            await tab.setRequestInterception(true);
            tab.on('request', (req) => {
                if (['image', 'media', 'font'].includes(req.resourceType())) {
                    req.abort();
                } else {
                    req.continue();
                }
            });
            tabs.push(tab);
        }

        // Process listings in parallel batches
        const results = new Map();
        let processed = 0;

        for (let i = 0; i < needsPhone.length; i += numTabs) {
            if (this.aborted) break;

            const batch = needsPhone.slice(i, i + numTabs);

            // Process batch in parallel
            const promises = batch.map(async (listing, idx) => {
                const tab = tabs[idx % tabs.length];
                try {
                    const details = await this.extractPhoneFromTab(tab, listing.profileUrl);
                    return { id: listing.id, details };
                } catch (error) {
                    console.error(`Error extracting phone for ${listing.name}:`, error.message);
                    return { id: listing.id, details: null };
                }
            });

            const batchResults = await Promise.all(promises);

            for (const { id, details } of batchResults) {
                if (details) {
                    results.set(id, details);
                    if (details.phoneNumber && details.phoneNumber !== 'N/A') {
                        this.stats.phonesExtracted++;
                    }
                }
            }

            processed += batch.length;
            console.log(`Phone extraction progress: ${processed}/${needsPhone.length} (${this.stats.phonesExtracted} phones found)`);

            this.options.onProgress({
                phase: 'phone_extraction',
                processed,
                total: needsPhone.length,
                phonesFound: this.stats.phonesExtracted,
            });

            // Small delay between batches to avoid rate limiting
            await sleep(300);
        }

        // Close all tabs
        for (const tab of tabs) {
            await tab.close().catch(() => { });
        }

        // Merge results back into listings
        return listings.map(listing => {
            const details = results.get(listing.id);
            if (details) {
                return {
                    ...listing,
                    phoneNumber: details.phoneNumber !== 'N/A' ? details.phoneNumber : listing.phoneNumber,
                    phoneNumbers: details.phoneNumbers || [],
                    website: details.website !== 'N/A' ? details.website : listing.website,
                    fullAddress: details.fullAddress || listing.address,
                    hours: details.hours,
                    detailsScraped: true,
                };
            }
            return listing;
        });
    }

    /**
     * Extract phone number from a single tab
     * @param {Page} tab - Puppeteer page/tab
     * @param {string} profileUrl - URL to visit
     * @returns {Promise<object>} Extracted details
     */
    async extractPhoneFromTab(tab, profileUrl) {
        const details = {
            phoneNumber: 'N/A',
            phoneNumbers: [],
            website: 'N/A',
            fullAddress: '',
            hours: null,
        };

        try {
            await tab.goto(profileUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 15000,
            });

            await sleep(1500);

            // Wait for info buttons
            await tab.waitForSelector('button[data-item-id], a[data-item-id]', { timeout: 8000 }).catch(() => { });

            const extracted = await tab.evaluate(() => {
                const result = {
                    phoneNumbers: [],
                    website: null,
                    address: null,
                };

                // Method 1: Phone buttons with data-item-id
                document.querySelectorAll('button[data-item-id^="phone:"], a[data-item-id^="phone:"]').forEach(btn => {
                    const itemId = btn.getAttribute('data-item-id');
                    if (itemId) {
                        const phone = itemId.replace('phone:tel:', '').replace('phone:', '');
                        if (phone && phone.length >= 10) {
                            result.phoneNumbers.push(phone);
                        }
                    }
                });

                // Method 2: tel: links
                document.querySelectorAll('a[href^="tel:"]').forEach(link => {
                    const phone = link.href.replace('tel:', '');
                    if (phone && !result.phoneNumbers.includes(phone)) {
                        result.phoneNumbers.push(phone);
                    }
                });

                // Method 3: Parse text for Indian phone patterns
                if (result.phoneNumbers.length === 0) {
                    const mainContent = document.querySelector('div[role="main"]');
                    if (mainContent) {
                        const text = mainContent.innerText;
                        const patterns = [
                            /\+91[\s\-]?\d{5}[\s\-]?\d{5}/g,
                            /0\d{2,4}[\s\-]?\d{6,8}/g,
                            /\d{5}[\s\-]?\d{5}/g,
                            /[6-9]\d{9}/g,
                        ];
                        for (const pattern of patterns) {
                            const matches = text.match(pattern);
                            if (matches) {
                                matches.forEach(m => {
                                    const cleaned = m.replace(/[\s\-]/g, '');
                                    if (cleaned.length >= 10 && !result.phoneNumbers.includes(cleaned)) {
                                        result.phoneNumbers.push(cleaned);
                                    }
                                });
                            }
                        }
                    }
                }

                // Website
                const websiteBtn = document.querySelector('a[data-item-id^="authority"]');
                if (websiteBtn && websiteBtn.href && !websiteBtn.href.includes('google.com')) {
                    result.website = websiteBtn.href;
                }

                // Address
                const addressBtn = document.querySelector('button[data-item-id^="address"]');
                if (addressBtn) {
                    result.address = addressBtn.getAttribute('aria-label')?.replace('Address: ', '') || '';
                }

                return result;
            });

            details.phoneNumbers = extracted.phoneNumbers;
            details.phoneNumber = extracted.phoneNumbers[0] || 'N/A';
            details.website = extracted.website || 'N/A';
            details.fullAddress = extracted.address || '';

        } catch (error) {
            // Silently fail for individual extractions
        }

        return details;
    }

    /**
     * Extract phone numbers from detail pages for listings without phones
     * @param {Array} listings - Array of listings to enrich
     * @returns {Promise<Array>} Enriched listings with phone numbers
     */
    async extractPhoneFromDetails(listings) {
        const enrichedListings = [];

        for (const listing of listings) {
            // Skip if already has phone
            if (listing.phoneNumber && listing.phoneNumber !== 'N/A') {
                enrichedListings.push(listing);
                continue;
            }

            // Skip if no profile URL
            if (!listing.profileUrl || listing.profileUrl === 'N/A') {
                enrichedListings.push(listing);
                continue;
            }

            try {
                console.log(`Extracting phone for: ${listing.name}`);
                const details = await extractPlaceDetails(this.page, listing.profileUrl);

                const enrichedListing = {
                    ...listing,
                    phoneNumber: details.phoneNumber !== 'N/A' ? details.phoneNumber : listing.phoneNumber,
                    phoneNumbers: details.phoneNumbers || [],
                    website: details.website !== 'N/A' ? details.website : listing.website,
                    fullAddress: details.fullAddress || listing.address,
                    hours: details.hours,
                    priceLevel: details.priceLevel,
                    detailsScraped: true,
                };

                if (details.phoneNumber && details.phoneNumber !== 'N/A') {
                    this.stats.phonesExtracted++;
                }

                enrichedListings.push(enrichedListing);

                // Small delay between detail page visits
                await randomSleep(800, 1500);

            } catch (error) {
                console.error(`Failed to extract details for ${listing.name}:`, error.message);
                enrichedListings.push(listing);
            }
        }

        return enrichedListings;
    }

    /**
     * Scrape with deep phone extraction enabled using parallel tabs
     * @param {string} query - Search query
     * @param {object} options - Additional options
     */
    async scrapeWithPhoneExtraction(query, options = {}) {
        const collectedListings = [];
        const originalOnData = this.options.onData;
        const numTabs = options.parallelTabs || 5;

        // Override onData to collect listings first, then stream them
        this.options.onData = (listing) => {
            collectedListings.push(listing);
            // Stream immediately without phone (will update later)
            originalOnData({
                ...listing,
                phoneExtractionPending: true,
            });
        };

        // Run initial scrape to get all listings
        await this.scrape(query);

        console.log(`Phase 1 complete: Found ${collectedListings.length} listings`);
        console.log(`Phase 2: Extracting phones using ${numTabs} parallel tabs...`);

        // Re-initialize browser for detail extraction
        await this.initialize();

        // Use parallel extraction with multiple tabs
        const enrichedListings = await this.extractPhonesParallel(collectedListings, numTabs);

        // Emit the enriched listings with phones
        this.options.onProgress({
            phase: 'phone_extraction_complete',
            total: enrichedListings.length,
            phonesFound: this.stats.phonesExtracted,
        });

        // Stream updated listings with phone numbers
        for (const listing of enrichedListings) {
            if (listing.phoneNumber && listing.phoneNumber !== 'N/A') {
                originalOnData({
                    ...listing,
                    phoneExtractionPending: false,
                    type: 'phone_update',
                });
            }
        }

        await this.cleanup();

        // Complete stats
        this.options.onComplete({
            totalFound: this.seenIds.size,
            phonesExtracted: this.stats.phonesExtracted,
            duration: Date.now() - this.stats.startTime,
        });
    }

    /**
     * Abort the current scraping operation
     */
    abort() {
        this.aborted = true;
    }

    /**
     * Scrape with geographic expansion for states/regions
     * This method divides the area into grid cells and searches each separately
     * to bypass Google Maps' ~120 result limit
     * @param {string} query - Search query (e.g., "Restaurants in Gujarat")
     * @param {object} options - Additional options
     */
    async scrapeWithGeoExpansion(query, options = {}) {
        const searchLocations = generateSearchLocations(query);
        const locationInfo = parseLocationQuery(query);
        const keyword = extractKeywordFromQuery(query);

        console.log(`[GeoExpansion] Query: "${query}"`);
        console.log(`[GeoExpansion] Keyword: "${keyword}"`);
        console.log(`[GeoExpansion] Generated ${searchLocations.length} search locations`);

        // If no geographic expansion possible (single search without coords), use regular scraping
        if (searchLocations.length <= 1 && !searchLocations[0]?.lat) {
            console.log('[GeoExpansion] No geo expansion possible - using regular scraping');
            return await this.scrape(query);
        }

        this.stats.startTime = Date.now();
        const allResults = [];
        let currentLocation = 0;
        const delayBetweenLocations = options.delayBetweenLocations || 1500; // Reduced from 3000
        const maxResultsPerLocation = options.maxResultsPerLocation || 60; // Reduced for speed

        try {
            await this.initialize();

            for (const location of searchLocations) {
                if (this.aborted) {
                    console.log('[GeoExpansion] Scraping aborted by user');
                    break;
                }

                currentLocation++;
                const locationLabel = location.city
                    ? `${location.city} (cell ${location.cellId || 'center'})`
                    : 'Unknown';

                console.log(`[GeoExpansion] Searching ${currentLocation}/${searchLocations.length}: ${locationLabel}`);

                // Report geo progress
                this.options.onProgress({
                    type: 'geo',
                    currentLocation,
                    totalLocations: searchLocations.length,
                    city: location.city,
                    state: location.state,
                    cellId: location.cellId,
                    totalFound: this.seenIds.size,
                    scrollCount: this.stats.scrollCount,
                });

                try {
                    // Build search URL with coordinates
                    let searchUrl;
                    if (location.lat && location.lon) {
                        const encodedQuery = encodeURIComponent(keyword);
                        searchUrl = `https://www.google.com/maps/search/${encodedQuery}/@${location.lat},${location.lon},14z`;
                    } else {
                        searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(location.searchQuery)}`;
                    }

                    // Navigate to search
                    await this.page.goto(searchUrl, {
                        waitUntil: 'domcontentloaded',
                        timeout: 30000,
                    });

                    await randomSleep(1000, 1500);

                    // Wait for results
                    await this.page.waitForSelector('div[role="feed"]', { timeout: 8000 }).catch(() => null);

                    // Scrape this location with limited scrolls
                    let locationResults = 0;
                    let previousCount = this.seenIds.size;
                    let stuckCount = 0;
                    const maxScrolls = 6; // Limited scrolls per location for speed

                    for (let scroll = 0; scroll < maxScrolls; scroll++) {
                        if (this.aborted) break;
                        if (locationResults >= maxResultsPerLocation) break;

                        // Extract listings
                        const listings = await this.extractVisibleListings();
                        const newListings = listings.filter(l => !this.seenIds.has(l.id));

                        for (let idx = 0; idx < newListings.length; idx++) {
                            const listing = newListings[idx];
                            if (locationResults >= maxResultsPerLocation) break;

                            if (!this.seenIds.has(listing.id)) {
                                this.seenIds.add(listing.id);
                                this.stats.totalStreamed++;
                                locationResults++;

                                // Click on listing to extract phone number
                                let phoneNumber = listing.phoneNumber;
                                let website = listing.website;

                                if (phoneNumber === 'N/A') {
                                    try {
                                        console.log(`  Extracting phone for: ${listing.name}`);
                                        const phoneData = await this.clickAndExtractPhone(idx);
                                        if (phoneData && phoneData.phoneNumber !== 'N/A') {
                                            phoneNumber = phoneData.phoneNumber;
                                            this.stats.phonesExtracted++;
                                            console.log(`  ✓ Phone: ${phoneNumber}`);
                                        }
                                        if (phoneData && phoneData.website !== 'N/A') {
                                            website = phoneData.website;
                                        }
                                    } catch (err) {
                                        console.log(`  ✗ Phone extraction failed`);
                                    }
                                }

                                const enrichedListing = {
                                    ...listing,
                                    scrapedCity: location.city,
                                    scrapedState: location.state,
                                    cellId: location.cellId,
                                    phoneNumber: formatPhone(phoneNumber),
                                    website: cleanUrl(website),
                                };

                                this.options.onData(enrichedListing);
                                allResults.push(enrichedListing);
                            }
                        }

                        // Check if stuck
                        const currentCount = this.seenIds.size;
                        if (currentCount === previousCount) {
                            stuckCount++;
                            if (stuckCount >= 2) break; // Move to next location faster
                        } else {
                            stuckCount = 0;
                        }
                        previousCount = currentCount;

                        // Scroll for more
                        this.stats.scrollCount++;
                        const scrollResult = await this.scrollAndCheck();

                        if (scrollResult.endReached) {
                            console.log(`[GeoExpansion] End reached in ${locationLabel}`);
                            break;
                        }

                        await randomSleep(500, 800);
                    }

                    console.log(`[GeoExpansion] Found ${locationResults} in ${locationLabel} (total: ${this.seenIds.size})`);

                } catch (error) {
                    console.error(`[GeoExpansion] Error scraping ${locationLabel}:`, error.message);
                }

                // Delay between locations - reduced for speed
                if (currentLocation < searchLocations.length) {
                    await randomSleep(delayBetweenLocations, delayBetweenLocations + 500);
                }
            }

            this.stats.endTime = Date.now();
            const duration = (this.stats.endTime - this.stats.startTime) / 1000;

            console.log(`[GeoExpansion] Completed: ${this.seenIds.size} unique results from ${currentLocation} locations in ${duration.toFixed(1)}s`);

            this.options.onComplete({
                totalFound: this.seenIds.size,
                duration,
                scrollCount: this.stats.scrollCount,
                locationsSearched: currentLocation,
                totalLocations: searchLocations.length,
                phonesExtracted: this.stats.phonesExtracted,
            });

        } catch (error) {
            console.error('[GeoExpansion] Error:', error);
            this.options.onError(error.message || 'Geo expansion error');
        } finally {
            await this.cleanup();
        }
    }

    /**
     * Clean up browser resources
     */
    async cleanup() {
        try {
            if (this.page) {
                await this.page.close().catch(() => { });
            }
            if (this.browser) {
                await this.browser.close().catch(() => { });
            }
        } catch (error) {
            console.error('Cleanup error:', error);
        }
        this.page = null;
        this.browser = null;
    }

    /**
     * Get current statistics
     * @returns {object} Scraping statistics
     */
    getStats() {
        return { ...this.stats, uniqueListings: this.seenIds.size };
    }
}

/**
 * Create and run a scraper instance
 * @param {string} query - Search query
 * @param {object} callbacks - Callback functions
 * @returns {object} Controller object with abort method
 */
export const createScraper = (query, callbacks = {}) => {
    const scraper = new GoogleMapsScraper(callbacks);

    const scrapePromise = scraper.scrape(query);

    return {
        promise: scrapePromise,
        abort: () => scraper.abort(),
        getStats: () => scraper.getStats(),
    };
};

export default GoogleMapsScraper;
