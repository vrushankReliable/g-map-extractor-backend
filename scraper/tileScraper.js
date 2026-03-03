/**
 * Enhanced Tile Scraper Module
 * 
 * Production-grade Puppeteer-based scraper optimized for geographic tile-based scraping.
 * Uses viewport manipulation instead of text-only searches for comprehensive coverage.
 * 
 * Features:
 * - Coordinate-based viewport positioning
 * - Human-like scrolling with randomization
 * - Dynamic end-of-list detection
 * - Robust error handling with retries
 * - Detail panel extraction for phone/website
 * 
 * LEGAL DISCLAIMER:
 * This scraper extracts only publicly visible business data.
 * Users must comply with applicable laws and terms of service.
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import config from '../config/index.js';
import {
    getRandomUserAgent,
    sleep,
    randomSleep,
    formatPhone,
    cleanUrl,
} from '../utils/helpers.js';

// Apply stealth plugin
if (config.scraper?.enableStealth !== false) {
    puppeteer.use(StealthPlugin());
}

/**
 * @typedef {Object} ScrapedPlace
 * @property {string} id - Unique identifier
 * @property {string} placeId - Google Place ID
 * @property {string} name - Business name
 * @property {string} category - Business category
 * @property {string} rating - Star rating
 * @property {string} reviews - Review count
 * @property {string} address - Full address
 * @property {string} phoneNumber - Phone number
 * @property {string} website - Website URL
 * @property {number|null} latitude - Latitude
 * @property {number|null} longitude - Longitude
 * @property {string} profileUrl - Google Maps URL
 * @property {string} tileId - Source tile identifier
 * @property {string} scrapedAt - Timestamp
 */

/**
 * Enhanced Tile Scraper Class
 * Optimized for coordinate-based geographic scraping
 */
export class TileScraper {
    constructor(options = {}) {
        this.browser = null;
        this.page = null;
        this.seenIds = new Set();
        this.aborted = false;

        this.options = {
            onData: options.onData || (() => { }),
            onProgress: options.onProgress || (() => { }),
            onError: options.onError || (() => { }),
            onTileComplete: options.onTileComplete || (() => { }),
            headless: options.headless ?? (config.puppeteer?.headless ?? true),
            maxScrollIdleCount: options.maxScrollIdleCount || 15,
            scrollDelayMin: options.scrollDelayMin || 800,
            scrollDelayMax: options.scrollDelayMax || 1500,
            extractDetails: options.extractDetails ?? false,
        };

        this.stats = {
            tilesProcessed: 0,
            totalPlaces: 0,
            failedTiles: 0,
            startTime: null,
            currentTile: null,
        };
    }

    /**
     * Initialize browser instance
     */
    async initialize() {
        if (this.browser) return;

        const launchOptions = {
            headless: this.options.headless ? 'new' : false,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920,1080',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
            ],
            defaultViewport: { width: 1920, height: 1080 },
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

        // Block heavy resources
        await this.page.setRequestInterception(true);
        this.page.on('request', (req) => {
            const resourceType = req.resourceType();
            const url = req.url();

            const blockedTypes = ['media'];
            const blockedPatterns = [/\.mp4/i, /\.webm/i, /\.avi/i];

            const isBlocked = blockedTypes.includes(resourceType) ||
                blockedPatterns.some(p => p.test(url));

            if (isBlocked) {
                req.abort();
            } else {
                req.continue();
            }
        });

        this.stats.startTime = Date.now();
    }

    /**
     * Navigate to a specific tile using coordinates
     * @param {Object} tile - Tile object with coordinates
     * @param {string} keyword - Search keyword
     */
    async navigateToTile(tile, keyword) {
        const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(keyword)}/@${tile.centerLat},${tile.centerLng},${tile.zoomLevel}z`;

        console.log(`Navigating to tile: ${tile.id} at [${tile.centerLat.toFixed(4)}, ${tile.centerLng.toFixed(4)}]`);

        await this.page.goto(searchUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
        });

        // Wait for initial load
        await randomSleep(2000, 3500);

        // Try to wait for the feed to appear
        try {
            await this.page.waitForSelector('div[role="feed"]', { timeout: 15000 });
        } catch {
            // Check if it's a single result or no results
            const noResults = await this.page.evaluate(() => {
                const text = document.body.innerText;
                return text.includes("can't find") ||
                    text.includes("No results") ||
                    text.includes("didn't match any");
            });

            if (noResults) {
                console.log(`No results found for tile: ${tile.id}`);
                return false;
            }

            // Might be a single result page
            console.log('Non-standard layout detected for tile');
        }

        return true;
    }

    /**
     * Find the scrollable container - Google Maps changes its selectors frequently
     */
    async findScrollableContainer() {
        return await this.page.evaluate(() => {
            // Priority list of selectors for the scrollable results panel
            const selectors = [
                'div[role="feed"]',
                'div.m6QErb[aria-label]',
                'div.m6QErb.DxyBCb',
                'div.m6QErb',
                'div[aria-label*="Results"]',
                'div.DxyBCb.kA9KIf',
                '.section-layout.section-scrollbox',
            ];

            for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (el && el.scrollHeight > el.clientHeight) {
                    return selector;
                }
            }

            // Fallback: find any scrollable container in the results area
            const allScrollable = document.querySelectorAll('div[class*="m6QErb"]');
            for (const el of allScrollable) {
                if (el.scrollHeight > el.clientHeight && el.scrollHeight > 500) {
                    return `div.${el.className.split(' ').join('.')}`;
                }
            }

            return 'div[role="feed"]';
        });
    }

    /**
     * Perform aggressive scroll using multiple techniques
     * @param {string} containerSelector - Selector for the scrollable container
     * @param {number} method - Scroll method to use (0-3)
     */
    async performScroll(containerSelector, method = 0) {
        try {
            switch (method) {
                case 0: // scrollTop manipulation
                    await this.page.evaluate((selector) => {
                        const container = document.querySelector(selector);
                        if (container) {
                            container.scrollTop = container.scrollHeight;
                        }
                    }, containerSelector);
                    break;

                case 1: // scrollBy with large amount
                    await this.page.evaluate((selector) => {
                        const container = document.querySelector(selector);
                        if (container) {
                            container.scrollBy({ top: 2000, behavior: 'instant' });
                        }
                    }, containerSelector);
                    break;

                case 2: // Keyboard navigation
                    await this.page.keyboard.press('End');
                    await sleep(100);
                    await this.page.keyboard.press('PageDown');
                    await sleep(100);
                    await this.page.keyboard.press('PageDown');
                    break;

                case 3: // Mouse wheel
                    await this.page.evaluate((selector) => {
                        const container = document.querySelector(selector);
                        if (container) {
                            container.dispatchEvent(new WheelEvent('wheel', {
                                deltaY: 1000,
                                bubbles: true,
                            }));
                        }
                    }, containerSelector);
                    break;
            }
        } catch (err) {
            console.log(`Scroll method ${method} failed:`, err.message);
        }
    }

    /**
     * Simulate human-like scrolling in the results feed with multiple techniques
     */
    async humanScroll() {
        const containerSelector = await this.findScrollableContainer();

        // Random scroll amount
        const scrollAmount = 800 + Math.floor(Math.random() * 600);

        // Try primary scroll method
        await this.page.evaluate((selector, amount) => {
            const feed = document.querySelector(selector);
            if (feed) {
                // Scroll to very bottom
                feed.scrollTop = feed.scrollHeight;
                // Then add smooth scroll
                setTimeout(() => {
                    feed.scrollBy({
                        top: amount,
                        behavior: 'smooth'
                    });
                }, 100);
            }
        }, containerSelector, scrollAmount);

        // Random short pause during scroll
        await sleep(150 + Math.random() * 200);

        // More aggressive keyboard navigation
        if (Math.random() > 0.5) {
            await this.page.keyboard.press('End');
            await sleep(50);
        }

        if (Math.random() > 0.6) {
            await this.page.keyboard.press('PageDown');
            await sleep(50);
        }

        // Wait for content to load - wait for network idle
        try {
            await this.page.waitForNetworkIdle({
                idleTime: 500,
                timeout: this.options.scrollDelayMax
            });
        } catch {
            // Fallback to simple sleep
            await randomSleep(this.options.scrollDelayMin, this.options.scrollDelayMax);
        }
    }

    /**
     * Extract visible listings from the feed
     * @param {string} tileId - Current tile identifier
     * @returns {ScrapedPlace[]} Array of scraped places
     */
    async extractVisibleListings(tileId) {
        return await this.page.evaluate((tileId) => {
            const results = [];
            const articles = document.querySelectorAll('div[role="article"]');

            articles.forEach(article => {
                try {
                    const text = article.innerText || '';
                    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

                    // Extract name from aria-label or first line
                    const name = article.getAttribute('aria-label') || lines[0] || '';
                    if (!name || name === 'Unknown') return;

                    // Extract rating and review count
                    let rating = 'N/A';
                    let reviews = '0';
                    const ratingMatch = text.match(/(\d\.\d)\s*\(([0-9,]+)\)/);
                    if (ratingMatch) {
                        rating = ratingMatch[1];
                        reviews = ratingMatch[2].replace(/,/g, '');
                    }

                    // Extract category
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

                    // Extract address
                    const addressLine = lines.find(line => {
                        if (line === name || line === category) return false;
                        const hasAddressIndicators =
                            line.match(/\d+\s+\w+/) ||
                            line.includes(',') ||
                            /St|Rd|Ave|Blvd|Dr|Lane|Way|Street|Road|Avenue|Highway/i.test(line);
                        return hasAddressIndicators && line.length > 10;
                    });
                    const address = addressLine || 'N/A';

                    // Extract phone number
                    const phonePatterns = [
                        /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
                        /(\+?\d{1,3}[-.\s]?)?\d{2,5}[-.\s]?\d{3,5}[-.\s]?\d{3,5}/,
                    ];
                    let phoneNumber = 'N/A';
                    for (const pattern of phonePatterns) {
                        const phoneMatch = text.match(pattern);
                        if (phoneMatch) {
                            phoneNumber = phoneMatch[0].trim();
                            break;
                        }
                    }

                    // Extract URLs
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

                    // Extract place ID
                    let placeId = '';
                    if (profileUrl) {
                        const cidMatch = profileUrl.match(/[?&]cid=(\d+)/);
                        const dataMatch = profileUrl.match(/!1s(0x[a-f0-9]+:[a-f0-9x]+)/i);
                        const placeMatch = profileUrl.match(/place\/([^/]+)/);

                        if (cidMatch) placeId = `cid:${cidMatch[1]}`;
                        else if (dataMatch) placeId = dataMatch[1];
                        else if (placeMatch) placeId = placeMatch[1];
                    }

                    // Extract coordinates
                    let latitude = null;
                    let longitude = null;
                    if (profileUrl) {
                        const coordMatch = profileUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
                        if (coordMatch) {
                            latitude = parseFloat(coordMatch[1]);
                            longitude = parseFloat(coordMatch[2]);
                        }
                    }

                    // Generate unique ID
                    const uniqueId = placeId ||
                        `${name}_${address}_${phoneNumber}`.toLowerCase().replace(/[^a-z0-9]/g, '_');

                    results.push({
                        id: uniqueId,
                        placeId: placeId || 'N/A',
                        name,
                        category,
                        rating,
                        reviews,
                        phoneNumber,
                        address,
                        website,
                        profileUrl: profileUrl || 'N/A',
                        latitude,
                        longitude,
                        tileId: tileId,
                        source: 'Google Maps',
                        scrapedAt: new Date().toISOString(),
                    });
                } catch (err) {
                    console.error('Error extracting listing:', err);
                }
            });

            return results;
        }, tileId);
    }

    /**
     * Get scroll state for detecting end of results
     */
    async getScrollState() {
        const containerSelector = await this.findScrollableContainer();

        return await this.page.evaluate((selector) => {
            const feed = document.querySelector(selector);
            const articles = document.querySelectorAll('div[role="article"]');
            const bodyText = document.body.innerText.toLowerCase();

            // Expanded end indicators - Google Maps uses various phrases
            const endIndicators = [
                "you've reached the end",
                "end of the list",
                "no more results",
                "end of results",
                "that's all",
                "no results found",
                "we didn't find",
            ];

            const hasEndIndicator = endIndicators.some(indicator =>
                bodyText.includes(indicator)
            );

            // Also check for visual end indicator elements
            const endElement = document.querySelector('.HlvSq, .m6QErb[aria-label] + div:empty');
            const visualEndIndicator = endElement !== null;

            return {
                feedHeight: feed ? feed.scrollHeight : 0,
                scrollTop: feed ? feed.scrollTop : 0,
                clientHeight: feed ? feed.clientHeight : 0,
                articleCount: articles.length,
                endReached: hasEndIndicator || visualEndIndicator,
                isNearBottom: feed ? (feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 100) : false,
            };
        }, containerSelector);
    }

    /**
     * Scrape a single tile completely
     * @param {Object} tile - Tile to scrape
     * @param {string} keyword - Search keyword
     * @param {number} maxRetries - Maximum retry attempts
     * @returns {Object} Tile scraping result
     */
    async scrapeTile(tile, keyword, maxRetries = 3) {
        this.stats.currentTile = tile.id;
        let attempts = 0;

        while (attempts < maxRetries) {
            try {
                const hasResults = await this.navigateToTile(tile, keyword);

                if (!hasResults) {
                    return {
                        tileId: tile.id,
                        success: true,
                        places: [],
                        message: 'No results in this area',
                    };
                }

                let previousHeight = 0;
                let previousCount = 0;
                let previousArticleCount = 0;
                let stuckCount = 0;
                let noNewDataCount = 0;
                let lastNewDataTime = Date.now();
                const placesInTile = [];
                const maxStuckIterations = 30;
                const maxNoNewDataTime = 15000; // 15 seconds without new data

                // Scroll loop with dynamic end detection
                for (let scroll = 0; scroll < 300; scroll++) {
                    if (this.aborted) {
                        console.log('Scrape aborted');
                        break;
                    }

                    // Extract current listings
                    const listings = await this.extractVisibleListings(tile.id);
                    let newListingsThisScroll = 0;

                    // Process new listings
                    for (const listing of listings) {
                        if (!this.seenIds.has(listing.id)) {
                            this.seenIds.add(listing.id);
                            this.stats.totalPlaces++;
                            newListingsThisScroll++;

                            const cleanedListing = {
                                ...listing,
                                phoneNumber: formatPhone(listing.phoneNumber),
                                website: cleanUrl(listing.website),
                            };

                            placesInTile.push(cleanedListing);
                            this.options.onData(cleanedListing);
                        }
                    }

                    // Update timing for new data detection
                    if (newListingsThisScroll > 0) {
                        lastNewDataTime = Date.now();
                        noNewDataCount = 0;
                    } else {
                        noNewDataCount++;
                    }

                    // Check scroll state
                    const state = await this.getScrollState();

                    // End detection: explicit end indicator
                    if (state.endReached) {
                        console.log(`End indicator found at scroll ${scroll}, doing final extraction...`);
                        // Do a few more scroll attempts to catch any remaining items
                        for (let final = 0; final < 3; final++) {
                            await this.humanScroll();
                            const finalListings = await this.extractVisibleListings(tile.id);
                            for (const listing of finalListings) {
                                if (!this.seenIds.has(listing.id)) {
                                    this.seenIds.add(listing.id);
                                    this.stats.totalPlaces++;
                                    const cleanedListing = {
                                        ...listing,
                                        phoneNumber: formatPhone(listing.phoneNumber),
                                        website: cleanUrl(listing.website),
                                    };
                                    placesInTile.push(cleanedListing);
                                    this.options.onData(cleanedListing);
                                }
                            }
                        }
                        break;
                    }

                    // Multi-factor stuck detection
                    const isStuck = state.feedHeight === previousHeight &&
                        state.articleCount === previousCount &&
                        state.articleCount === previousArticleCount;

                    if (isStuck) {
                        stuckCount++;

                        // Try different scroll methods when stuck
                        const scrollMethod = stuckCount % 4;
                        await this.performScroll(await this.findScrollableContainer(), scrollMethod);

                        // If stuck too long, try scroll recovery
                        if (stuckCount % 5 === 0 && stuckCount < maxStuckIterations) {
                            console.log(`Attempting scroll recovery at iteration ${scroll}...`);
                            try {
                                // Click somewhere else to reset scroll focus
                                await this.page.click('body', { offset: { x: 100, y: 100 } });
                                await sleep(300);
                                // Click back to results
                                await this.page.keyboard.press('Escape');
                                await sleep(200);
                            } catch (e) {
                                // Ignore recovery errors
                            }
                        }

                        if (stuckCount >= maxStuckIterations) {
                            console.log(`Scroll stabilized after ${scroll} scrolls, ${placesInTile.length} places found`);
                            break;
                        }

                        // Check if we haven't received new data for too long
                        if (Date.now() - lastNewDataTime > maxNoNewDataTime && placesInTile.length > 0) {
                            console.log(`No new data for ${maxNoNewDataTime / 1000}s, ending scroll`);
                            break;
                        }

                        // Wait longer when stuck
                        await randomSleep(
                            this.options.scrollDelayMax,
                            this.options.scrollDelayMax * 1.5
                        );
                    } else {
                        stuckCount = 0;
                    }

                    previousHeight = state.feedHeight;
                    previousCount = state.articleCount;
                    previousArticleCount = state.articleCount;

                    // Progress callback
                    if (scroll % 5 === 0 || newListingsThisScroll > 0) {
                        this.options.onProgress({
                            tileId: tile.id,
                            scrollCount: scroll + 1,
                            currentCount: placesInTile.length,
                            totalUnique: this.seenIds.size,
                            newThisScroll: newListingsThisScroll,
                        });
                    }

                    // Human-like scroll
                    await this.humanScroll();
                }

                this.stats.tilesProcessed++;

                const result = {
                    tileId: tile.id,
                    success: true,
                    places: placesInTile,
                    placesCount: placesInTile.length,
                };

                this.options.onTileComplete(result);

                return result;

            } catch (error) {
                attempts++;
                console.error(`Tile ${tile.id} attempt ${attempts} failed:`, error.message);

                if (attempts >= maxRetries) {
                    this.stats.failedTiles++;

                    const result = {
                        tileId: tile.id,
                        success: false,
                        error: error.message,
                        places: [],
                    };

                    this.options.onError({
                        tileId: tile.id,
                        error: error.message,
                        attempts,
                    });

                    return result;
                }

                // Wait before retry
                await sleep(3000 * attempts);
            }
        }
    }

    /**
     * Check for CAPTCHA
     */
    async checkForCaptcha() {
        const hasCaptcha = await this.page.evaluate(() => {
            const text = document.body.innerText.toLowerCase();
            return text.includes('captcha') ||
                text.includes('unusual traffic') ||
                text.includes('automated queries') ||
                document.querySelector('iframe[src*="recaptcha"]') !== null;
        });

        return hasCaptcha;
    }

    /**
     * Handle CAPTCHA if detected
     */
    async handleCaptcha() {
        console.log('⚠️ CAPTCHA detected! Waiting for manual resolution...');

        // Wait up to 5 minutes for manual resolution
        const maxWait = 300000;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWait) {
            const stillHasCaptcha = await this.checkForCaptcha();
            if (!stillHasCaptcha) {
                console.log('✓ CAPTCHA resolved');
                return true;
            }
            await sleep(5000);
        }

        console.log('✗ CAPTCHA timeout');
        return false;
    }

    /**
     * Abort the current operation
     */
    abort() {
        this.aborted = true;
    }

    /**
     * Reset for new session
     */
    reset() {
        this.seenIds.clear();
        this.aborted = false;
        this.stats = {
            tilesProcessed: 0,
            totalPlaces: 0,
            failedTiles: 0,
            startTime: Date.now(),
            currentTile: null,
        };
    }

    /**
     * Get current statistics
     */
    getStats() {
        return {
            ...this.stats,
            uniquePlaces: this.seenIds.size,
            durationSeconds: this.stats.startTime
                ? (Date.now() - this.stats.startTime) / 1000
                : 0,
        };
    }

    /**
     * Cleanup browser resources
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
}

/**
 * Create a tile scraper instance
 * @param {Object} options - Scraper options
 * @returns {TileScraper} Scraper instance
 */
export function createTileScraper(options = {}) {
    return new TileScraper(options);
}

export default TileScraper;
