// server/scraper/geoScraper.js - Geographic grid-based scraping
import { generateSearchLocations, parseLocationQuery } from '../geo/regions.js';

/**
 * Geo-based scraper that divides regions into grid cells
 * and scrapes each cell separately to bypass the ~120 result limit
 */
export class GeoScraper {
    constructor(scraper, options = {}) {
        this.scraper = scraper;
        this.options = {
            delayBetweenCells: 3000, // Delay between grid cell searches
            maxResultsPerCell: 60,   // Max results to scrape per cell
            deduplicateResults: true,
            ...options,
        };
        this.seenPlaceIds = new Set();
        this.seenNames = new Set();
    }

    /**
     * Check if a result is a duplicate
     */
    isDuplicate(place) {
        if (place.placeId && this.seenPlaceIds.has(place.placeId)) {
            return true;
        }

        // Fuzzy name+address matching
        const key = `${(place.name || '').toLowerCase().trim()}-${(place.address || '').toLowerCase().split(',')[0].trim()}`;
        if (this.seenNames.has(key)) {
            return true;
        }

        return false;
    }

    /**
     * Mark a result as seen
     */
    markSeen(place) {
        if (place.placeId) {
            this.seenPlaceIds.add(place.placeId);
        }
        const key = `${(place.name || '').toLowerCase().trim()}-${(place.address || '').toLowerCase().split(',')[0].trim()}`;
        this.seenNames.add(key);
    }

    /**
     * Scrape with geographic grid expansion
     * This divides a state/region into multiple cities and grid cells
     */
    async scrapeWithGeoExpansion(query, onData, onProgress, signal) {
        const searchLocations = generateSearchLocations(query);
        const locationInfo = parseLocationQuery(query);

        console.log(`[GeoScraper] Query: "${query}"`);
        console.log(`[GeoScraper] Generated ${searchLocations.length} search locations`);

        if (searchLocations.length <= 1 && !searchLocations[0].lat) {
            // No geographic expansion possible, use regular scraping
            console.log('[GeoScraper] No geo expansion - using regular scraping');
            return null; // Signal to use regular scraping
        }

        const allResults = [];
        let totalScraped = 0;
        let currentLocation = 0;

        for (const location of searchLocations) {
            if (signal?.aborted) {
                console.log('[GeoScraper] Scraping aborted by user');
                break;
            }

            currentLocation++;
            const locationLabel = location.city
                ? `${location.city} (cell ${location.cellId || 'center'})`
                : 'Unknown';

            console.log(`[GeoScraper] Searching ${currentLocation}/${searchLocations.length}: ${locationLabel}`);

            // Report progress
            if (onProgress) {
                onProgress({
                    type: 'geo_progress',
                    current: currentLocation,
                    total: searchLocations.length,
                    city: location.city,
                    cellId: location.cellId,
                    resultsFound: allResults.length,
                });
            }

            try {
                // Build the search URL with coordinates
                let searchUrl;
                if (location.lat && location.lon) {
                    // Search at specific coordinates
                    const encodedQuery = encodeURIComponent(location.keyword || location.searchQuery);
                    searchUrl = `https://www.google.com/maps/search/${encodedQuery}/@${location.lat},${location.lon},14z`;
                } else {
                    // Regular search
                    searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(location.searchQuery)}`;
                }

                // Scrape this location
                const cellResults = await this.scrapeSingleLocation(
                    searchUrl,
                    location,
                    (place) => {
                        // Check for duplicate
                        if (this.options.deduplicateResults && this.isDuplicate(place)) {
                            return; // Skip duplicate
                        }

                        // Mark as seen
                        this.markSeen(place);

                        // Add location info
                        place.scrapedCity = location.city;
                        place.scrapedState = location.state;
                        place.cellId = location.cellId;

                        allResults.push(place);
                        totalScraped++;

                        // Stream the result
                        if (onData) {
                            onData(place);
                        }
                    },
                    signal
                );

                console.log(`[GeoScraper] Found ${cellResults} results in ${locationLabel} (total: ${allResults.length})`);

            } catch (error) {
                console.error(`[GeoScraper] Error scraping ${locationLabel}:`, error.message);
            }

            // Delay between locations to avoid rate limiting
            if (currentLocation < searchLocations.length) {
                await this.delay(this.options.delayBetweenCells);
            }
        }

        console.log(`[GeoScraper] Completed. Total unique results: ${allResults.length}`);

        return {
            totalResults: allResults.length,
            results: allResults,
            locationsSearched: currentLocation,
            totalLocations: searchLocations.length,
        };
    }

    /**
     * Scrape a single location/cell
     */
    async scrapeSingleLocation(searchUrl, location, onResult, signal) {
        const page = this.scraper.page;
        if (!page) {
            throw new Error('Browser page not initialized');
        }

        let resultsCount = 0;

        try {
            // Navigate to search URL
            await page.goto(searchUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });

            // Wait for results
            await page.waitForSelector('[role="feed"], [role="main"]', { timeout: 10000 }).catch(() => null);
            await this.delay(2000);

            // Scroll and extract results (limited scrolls per cell)
            const maxScrolls = 5;
            let lastCount = 0;
            let noNewResultsCount = 0;

            for (let scroll = 0; scroll < maxScrolls; scroll++) {
                if (signal?.aborted) break;
                if (resultsCount >= this.options.maxResultsPerCell) break;

                // Extract visible results
                const places = await this.extractVisiblePlaces(page);

                for (const place of places) {
                    if (resultsCount >= this.options.maxResultsPerCell) break;

                    onResult(place);
                    resultsCount++;
                }

                // Check if we're getting new results
                if (places.length === lastCount) {
                    noNewResultsCount++;
                    if (noNewResultsCount >= 2) break;
                } else {
                    noNewResultsCount = 0;
                }
                lastCount = places.length;

                // Scroll for more results
                await this.scrollResults(page);
                await this.delay(1500);
            }

        } catch (error) {
            console.error(`[GeoScraper] Error in scrapeSingleLocation:`, error.message);
        }

        return resultsCount;
    }

    /**
     * Extract visible places from the page
     */
    async extractVisiblePlaces(page) {
        return page.evaluate(() => {
            const results = [];
            const seenInPage = new Set();

            // Find all place cards
            const selectors = [
                '[role="article"]',
                'div[jsaction*="mouseover:pane"]',
                'a[href*="/maps/place/"]',
            ];

            for (const selector of selectors) {
                const elements = document.querySelectorAll(selector);

                elements.forEach((el) => {
                    try {
                        // Extract name
                        const nameEl = el.querySelector('div.fontHeadlineSmall, h3, [class*="fontHeadline"]');
                        const name = nameEl?.textContent?.trim();

                        if (!name || seenInPage.has(name)) return;
                        seenInPage.add(name);

                        // Extract other data
                        const ratingEl = el.querySelector('[role="img"][aria-label*="star"], span[aria-label*="star"]');
                        const rating = ratingEl?.getAttribute('aria-label')?.match(/[\d.]+/)?.[0] || '';

                        const reviewsEl = el.querySelector('span[aria-label*="review"], span:has(> span[aria-label*="star"])');
                        const reviewsMatch = reviewsEl?.textContent?.match(/\(?([\d,]+)\)?/);
                        const reviews = reviewsMatch ? reviewsMatch[1].replace(',', '') : '';

                        // Category/type
                        const categoryEl = el.querySelector('[class*="fontBodyMedium"]:not([aria-label])');
                        const category = categoryEl?.textContent?.split('·')[0]?.trim() || '';

                        // Status (open/closed)
                        const statusText = el.textContent || '';
                        let status = 'Unknown';
                        if (statusText.includes('Open')) status = 'Open';
                        else if (statusText.includes('Closed')) status = 'Closed';

                        // Address
                        const addressEl = el.querySelector('[class*="fontBodyMedium"]');
                        const addressText = addressEl?.textContent || '';
                        const addressParts = addressText.split('·');
                        const address = addressParts.length > 1 ? addressParts.slice(1).join('·').trim() : '';

                        // Place URL
                        const linkEl = el.querySelector('a[href*="/maps/place/"]') || el.closest('a[href*="/maps/place/"]');
                        const profileUrl = linkEl?.href || '';

                        // Extract placeId from URL
                        let placeId = '';
                        if (profileUrl) {
                            const match = profileUrl.match(/place\/([^/]+)/);
                            if (match) placeId = match[1];
                        }

                        results.push({
                            id: Math.random().toString(36).substr(2, 9),
                            placeId,
                            name,
                            category,
                            status,
                            rating,
                            reviews,
                            address,
                            profileUrl,
                            phoneNumber: '', // Will be extracted later if needed
                            website: '',
                            source: 'Google Maps (Geo)',
                            scrapedAt: new Date().toISOString(),
                        });
                    } catch (e) {
                        // Skip this element
                    }
                });
            }

            return results;
        });
    }

    /**
     * Scroll the results panel
     */
    async scrollResults(page) {
        await page.evaluate(() => {
            const containers = [
                document.querySelector('[role="feed"]'),
                document.querySelector('[role="main"] > div > div'),
                document.querySelector('div[aria-label*="Results"]'),
            ];

            for (const container of containers) {
                if (container) {
                    container.scrollBy({ top: 500, behavior: 'smooth' });
                    break;
                }
            }
        });
    }

    /**
     * Delay helper
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Reset state for new scrape
     */
    reset() {
        this.seenPlaceIds.clear();
        this.seenNames.clear();
    }
}

export default GeoScraper;
