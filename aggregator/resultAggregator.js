/**
 * Result Aggregator & Deduplication Module
 * 
 * Handles aggregation of scraping results from multiple tiles with:
 * - Multi-strategy deduplication (URL, name+coords, phone)
 * - Memory-efficient batching
 * - Statistics tracking
 * - Result validation
 */

import crypto from 'crypto';

/**
 * @typedef {Object} AggregatedResults
 * @property {string} region - Region name
 * @property {string} baseQuery - Original search query
 * @property {number} totalAreasScanned - Number of tiles processed
 * @property {number} totalResults - Total unique results
 * @property {number} duplicatesRemoved - Number of duplicates filtered
 * @property {Array} places - Array of unique places
 * @property {Object} statistics - Processing statistics
 */

/**
 * Result Aggregator Class
 * Collects and deduplicates results from multiple tiles
 */
export class ResultAggregator {
    constructor(options = {}) {
        // Deduplication indexes
        this.urlIndex = new Map();          // profileUrl -> place
        this.coordsIndex = new Map();       // normalized name+coords hash -> place
        this.phoneIndex = new Map();        // phone number -> place
        this.placeIdIndex = new Map();      // Google place ID -> place

        // Results storage
        this.places = [];

        // Statistics
        this.stats = {
            totalReceived: 0,
            totalUnique: 0,
            duplicatesRemoved: 0,
            tilesProcessed: 0,
            byCity: {},
            startTime: Date.now(),
        };

        // Configuration
        this.options = {
            coordsPrecision: options.coordsPrecision || 4,  // Decimal places for coord matching
            enablePhoneDedup: options.enablePhoneDedup ?? true,
            enableCoordsDedup: options.enableCoordsDedup ?? true,
            batchFlushSize: options.batchFlushSize || 500,
            onBatchFlush: options.onBatchFlush || null,
        };

        // Region info
        this.region = null;
        this.baseQuery = null;
    }

    /**
     * Set region and query information
     * @param {string} region - Region name
     * @param {string} baseQuery - Search query
     */
    setContext(region, baseQuery) {
        this.region = region;
        this.baseQuery = baseQuery;
    }

    /**
     * Generate normalized hash for coordinates-based deduplication
     * @param {Object} place - Place object
     * @returns {string|null} Hash or null if coords not available
     */
    generateCoordsHash(place) {
        if (!place.latitude || !place.longitude) return null;

        const normalizedName = place.name
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '')
            .substring(0, 30);

        const lat = place.latitude.toFixed(this.options.coordsPrecision);
        const lng = place.longitude.toFixed(this.options.coordsPrecision);

        return crypto
            .createHash('md5')
            .update(`${normalizedName}_${lat}_${lng}`)
            .digest('hex');
    }

    /**
     * Normalize phone number for comparison
     * @param {string} phone - Phone number
     * @returns {string|null} Normalized phone or null
     */
    normalizePhone(phone) {
        if (!phone || phone === 'N/A') return null;

        // Remove all non-digits
        const digits = phone.replace(/\D/g, '');

        // Need at least 7 digits to be a valid phone
        if (digits.length < 7) return null;

        // Take last 10 digits (handles country codes)
        return digits.slice(-10);
    }

    /**
     * Check if a place is a duplicate
     * @param {Object} place - Place to check
     * @returns {Object} Duplicate check result
     */
    isDuplicate(place) {
        // Check by place ID (most reliable)
        if (place.placeId && place.placeId !== 'N/A') {
            if (this.placeIdIndex.has(place.placeId)) {
                return { isDupe: true, reason: 'placeId', existing: this.placeIdIndex.get(place.placeId) };
            }
        }

        // Check by profile URL
        if (place.profileUrl && place.profileUrl !== 'N/A') {
            // Normalize URL for comparison
            const normalizedUrl = place.profileUrl.split('?')[0];
            if (this.urlIndex.has(normalizedUrl)) {
                return { isDupe: true, reason: 'url', existing: this.urlIndex.get(normalizedUrl) };
            }
        }

        // Check by coordinates + name
        if (this.options.enableCoordsDedup) {
            const coordsHash = this.generateCoordsHash(place);
            if (coordsHash && this.coordsIndex.has(coordsHash)) {
                return { isDupe: true, reason: 'coords', existing: this.coordsIndex.get(coordsHash) };
            }
        }

        // Check by phone number
        if (this.options.enablePhoneDedup) {
            const normalizedPhone = this.normalizePhone(place.phoneNumber);
            if (normalizedPhone && this.phoneIndex.has(normalizedPhone)) {
                const existing = this.phoneIndex.get(normalizedPhone);
                // Only consider it a dupe if names are similar too
                if (this.areSimilarNames(place.name, existing.name)) {
                    return { isDupe: true, reason: 'phone', existing };
                }
            }
        }

        return { isDupe: false };
    }

    /**
     * Check if two business names are similar
     * @param {string} name1 - First name
     * @param {string} name2 - Second name
     * @returns {boolean} Whether names are similar
     */
    areSimilarNames(name1, name2) {
        const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const n1 = normalize(name1);
        const n2 = normalize(name2);

        // Exact match after normalization
        if (n1 === n2) return true;

        // One contains the other
        if (n1.includes(n2) || n2.includes(n1)) return true;

        // Calculate simple similarity ratio
        const longer = n1.length > n2.length ? n1 : n2;
        const shorter = n1.length > n2.length ? n2 : n1;

        if (longer.length === 0) return true;

        let matches = 0;
        for (let i = 0; i < shorter.length; i++) {
            if (longer.includes(shorter[i])) matches++;
        }

        return matches / shorter.length > 0.8;
    }

    /**
     * Add a place to the aggregator
     * @param {Object} place - Place to add
     * @returns {Object} Result with added status
     */
    add(place) {
        this.stats.totalReceived++;

        // Check for duplicate
        const dupeCheck = this.isDuplicate(place);

        if (dupeCheck.isDupe) {
            this.stats.duplicatesRemoved++;
            return {
                added: false,
                reason: dupeCheck.reason,
                existingId: dupeCheck.existing?.id,
            };
        }

        // Add to indexes
        if (place.placeId && place.placeId !== 'N/A') {
            this.placeIdIndex.set(place.placeId, place);
        }

        if (place.profileUrl && place.profileUrl !== 'N/A') {
            const normalizedUrl = place.profileUrl.split('?')[0];
            this.urlIndex.set(normalizedUrl, place);
        }

        const coordsHash = this.generateCoordsHash(place);
        if (coordsHash) {
            this.coordsIndex.set(coordsHash, place);
        }

        const normalizedPhone = this.normalizePhone(place.phoneNumber);
        if (normalizedPhone) {
            this.phoneIndex.set(normalizedPhone, place);
        }

        // Track by city
        if (place.cityName || place.tileId) {
            const city = place.cityName || place.tileId.split('_')[0];
            this.stats.byCity[city] = (this.stats.byCity[city] || 0) + 1;
        }

        // Add to results
        this.places.push(place);
        this.stats.totalUnique++;

        // Check if we should flush batch
        if (this.options.onBatchFlush &&
            this.places.length % this.options.batchFlushSize === 0) {
            this.options.onBatchFlush(this.places.slice(-this.options.batchFlushSize));
        }

        return { added: true };
    }

    /**
     * Add multiple places at once
     * @param {Array} places - Array of places
     * @returns {Object} Batch add results
     */
    addBatch(places) {
        const results = {
            added: 0,
            duplicates: 0,
            byReason: {},
        };

        for (const place of places) {
            const result = this.add(place);

            if (result.added) {
                results.added++;
            } else {
                results.duplicates++;
                results.byReason[result.reason] = (results.byReason[result.reason] || 0) + 1;
            }
        }

        return results;
    }

    /**
     * Mark a tile as processed
     * @param {string} tileId - Tile identifier
     */
    markTileProcessed(tileId) {
        this.stats.tilesProcessed++;
    }

    /**
     * Get aggregated results
     * @returns {AggregatedResults} Complete results object
     */
    getResults() {
        return {
            region: this.region,
            baseQuery: this.baseQuery,
            totalAreasScanned: this.stats.tilesProcessed,
            totalResults: this.places.length,
            duplicatesRemoved: this.stats.duplicatesRemoved,
            places: this.places,
            statistics: this.getStatistics(),
        };
    }

    /**
     * Get processing statistics
     * @returns {Object} Statistics object
     */
    getStatistics() {
        const duration = (Date.now() - this.stats.startTime) / 1000;

        return {
            totalReceived: this.stats.totalReceived,
            totalUnique: this.stats.totalUnique,
            duplicatesRemoved: this.stats.duplicatesRemoved,
            duplicateRate: this.stats.totalReceived > 0
                ? ((this.stats.duplicatesRemoved / this.stats.totalReceived) * 100).toFixed(2) + '%'
                : '0%',
            tilesProcessed: this.stats.tilesProcessed,
            byCity: this.stats.byCity,
            durationSeconds: duration,
            placesPerSecond: duration > 0
                ? (this.stats.totalUnique / duration).toFixed(2)
                : 0,
        };
    }

    /**
     * Get places for a specific city
     * @param {string} cityName - City name
     * @returns {Array} Places in that city
     */
    getPlacesByCity(cityName) {
        return this.places.filter(p => {
            const placeCity = p.cityName || p.tileId?.split('_')[0];
            return placeCity?.toLowerCase() === cityName.toLowerCase();
        });
    }

    /**
     * Get places count
     * @returns {number} Number of unique places
     */
    get count() {
        return this.places.length;
    }

    /**
     * Clear all data
     */
    clear() {
        this.urlIndex.clear();
        this.coordsIndex.clear();
        this.phoneIndex.clear();
        this.placeIdIndex.clear();
        this.places = [];
        this.stats = {
            totalReceived: 0,
            totalUnique: 0,
            duplicatesRemoved: 0,
            tilesProcessed: 0,
            byCity: {},
            startTime: Date.now(),
        };
    }

    /**
     * Export for serialization (without Maps)
     * @returns {Object} Serializable object
     */
    toJSON() {
        return {
            region: this.region,
            baseQuery: this.baseQuery,
            placesCount: this.places.length,
            places: this.places,
            statistics: this.getStatistics(),
        };
    }
}

/**
 * Create a result aggregator instance
 * @param {Object} options - Configuration options
 * @returns {ResultAggregator} Aggregator instance
 */
export function createAggregator(options = {}) {
    return new ResultAggregator(options);
}

/**
 * Validate a place object has required fields
 * @param {Object} place - Place to validate
 * @returns {Object} Validation result
 */
export function validatePlace(place) {
    const errors = [];

    if (!place.name || place.name.length < 2) {
        errors.push('Invalid or missing name');
    }

    if (!place.id) {
        errors.push('Missing unique ID');
    }

    return {
        isValid: errors.length === 0,
        errors,
    };
}

export default ResultAggregator;
