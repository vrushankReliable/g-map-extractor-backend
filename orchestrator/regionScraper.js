/**
 * Region Scraper Orchestrator
 * 
 * Main orchestration module that coordinates all components for
 * comprehensive region-based Google Maps scraping.
 * 
 * Features:
 * - Query parsing and validation
 * - Geographic chunk generation
 * - Queue-based tile processing
 * - Result aggregation and deduplication
 * - Progress tracking and reporting
 * - Auto-export with configurable formats
 * - Error recovery and retry logic
 * 
 * Usage:
 *   const orchestrator = new RegionScraper({ ...options });
 *   const results = await orchestrator.scrape("restaurants in Gujarat");
 */

import config from '../config/index.js';
import { parseQuery, validateQueryForRegionScraping } from '../geo/queryParser.js';
import {
    generateRegionChunks,
    flattenRegionTiles,
    getTileStatistics
} from '../geo/chunkGenerator.js';
import { getRegionData, getAvailableRegions } from '../geo/regionData.js';
import { TileScraper } from '../scraper/tileScraper.js';
import { ResultAggregator } from '../aggregator/resultAggregator.js';
import { ExportUtility } from '../export/exportUtility.js';
import { AsyncQueue } from '../utils/asyncQueue.js';
import { sleep, randomSleep } from '../utils/helpers.js';

/**
 * @typedef {Object} RegionScraperOptions
 * @property {boolean} headless - Run browser in headless mode
 * @property {number} concurrency - Max concurrent tile processing
 * @property {number} gridSizeKm - Grid tile size in km
 * @property {number} maxScrollIdleCount - Scrolls before considering list complete
 * @property {string[]} cityTiers - City tiers to include
 * @property {string} outputDir - Output directory for exports
 * @property {string} exportFormat - Export format: json, csv, ndjson, all
 * @property {boolean} autoExport - Automatically export on completion
 * @property {Function} onProgress - Progress callback
 * @property {Function} onData - New data callback
 * @property {Function} onError - Error callback
 * @property {Function} onTileComplete - Tile completion callback
 * @property {Function} onComplete - Overall completion callback
 */

const DEFAULT_OPTIONS = {
    headless: true,
    concurrency: 1,
    gridSizeKm: 3,
    overlapPercent: 10,
    maxScrollIdleCount: 15,
    cityTiers: ['metro', 'major', 'tier2', 'tier3'],
    cityRadiusKm: 15,
    outputDir: './output',
    exportFormat: 'all',
    autoExport: true,
    scrollDelayMin: 800,
    scrollDelayMax: 1500,
    tileDelayMin: 2000,
    tileDelayMax: 5000,
    maxTileRetries: 3,
    batchFlushSize: 100,
    onProgress: null,
    onData: null,
    onError: null,
    onTileComplete: null,
    onComplete: null,
};

/**
 * Region Scraper Orchestrator Class
 */
export class RegionScraper {
    constructor(options = {}) {
        // Merge options with config defaults
        this.options = {
            ...DEFAULT_OPTIONS,
            headless: config.puppeteer?.headless ?? DEFAULT_OPTIONS.headless,
            gridSizeKm: config.geoChunking?.gridSizeKm ?? DEFAULT_OPTIONS.gridSizeKm,
            overlapPercent: config.geoChunking?.overlapPercent ?? DEFAULT_OPTIONS.overlapPercent,
            maxScrollIdleCount: config.geoChunking?.maxScrollIdleCount ?? DEFAULT_OPTIONS.maxScrollIdleCount,
            cityTiers: config.geoChunking?.cityTiers ?? DEFAULT_OPTIONS.cityTiers,
            cityRadiusKm: config.geoChunking?.cityRadiusKm ?? DEFAULT_OPTIONS.cityRadiusKm,
            concurrency: config.queue?.concurrency ?? DEFAULT_OPTIONS.concurrency,
            tileDelayMin: config.queue?.tileDelayMin ?? DEFAULT_OPTIONS.tileDelayMin,
            tileDelayMax: config.queue?.tileDelayMax ?? DEFAULT_OPTIONS.tileDelayMax,
            batchFlushSize: config.queue?.batchFlushSize ?? DEFAULT_OPTIONS.batchFlushSize,
            outputDir: config.export?.outputDir ?? DEFAULT_OPTIONS.outputDir,
            exportFormat: config.export?.format ?? DEFAULT_OPTIONS.exportFormat,
            scrollDelayMin: config.scraper?.scrollDelayMin ?? DEFAULT_OPTIONS.scrollDelayMin,
            scrollDelayMax: config.scraper?.scrollDelayMax ?? DEFAULT_OPTIONS.scrollDelayMax,
            ...options,
        };

        this.scraper = null;
        this.aggregator = null;
        this.exporter = null;
        this.queue = null;
        this.aborted = false;

        this.status = {
            state: 'idle',
            region: null,
            keyword: null,
            totalTiles: 0,
            processedTiles: 0,
            failedTiles: 0,
            totalPlaces: 0,
            currentCity: null,
            currentTile: null,
            startTime: null,
            estimatedTimeRemaining: null,
        };
    }

    /**
     * Main scraping method
     * @param {string} query - Search query (e.g., "restaurants in Gujarat")
     * @returns {Object} Complete scraping results
     */
    async scrape(query) {
        this.status.startTime = Date.now();
        this.status.state = 'initializing';

        try {
            // Step 1: Parse and validate query
            console.log('\n╔══════════════════════════════════════════════════════════╗');
            console.log('║       GOOGLE MAPS REGION SCRAPER - Starting...           ║');
            console.log('╚══════════════════════════════════════════════════════════╝\n');

            const parsedQuery = parseQuery(query);
            console.log(`📝 Parsed Query:`);
            console.log(`   Keyword: "${parsedQuery.keyword}"`);
            console.log(`   Region:  "${parsedQuery.region}"`);
            console.log(`   Type:    "${parsedQuery.regionType}"`);

            // Validate for region scraping
            const validation = validateQueryForRegionScraping(parsedQuery);
            if (!validation.isValid) {
                throw new Error(`Invalid query: ${validation.errors.join(', ')}`);
            }

            // Check if region exists in our data
            const regionData = getRegionData(parsedQuery.region);
            if (!regionData) {
                const available = getAvailableRegions().join(', ');
                throw new Error(
                    `Unknown region: "${parsedQuery.region}". ` +
                    `Available regions: ${available}`
                );
            }

            this.status.region = parsedQuery.region;
            this.status.keyword = parsedQuery.keyword;

            // Step 2: Generate geographic chunks
            console.log('\n📍 Generating geographic chunks...');
            this.status.state = 'generating_chunks';

            const chunkingConfig = {
                gridSizeKm: this.options.gridSizeKm,
                overlapPercent: this.options.overlapPercent,
                cityTiers: this.options.cityTiers,
                cityRadiusKm: this.options.cityRadiusKm,
            };

            const regionChunks = generateRegionChunks(parsedQuery.region, chunkingConfig);
            const tiles = flattenRegionTiles(regionChunks);
            const stats = getTileStatistics(regionChunks);

            console.log(`\n📊 Chunk Statistics:`);
            console.log(`   Total Cities: ${stats.totalCities}`);
            console.log(`   Total Tiles:  ${stats.totalTiles}`);
            console.log(`   Est. Coverage: ${stats.estimatedCoverage} km²`);
            console.log(`   By Tier:`);
            for (const [tier, data] of Object.entries(stats.byTier)) {
                console.log(`     - ${tier}: ${data.cities} cities, ${data.tiles} tiles`);
            }

            this.status.totalTiles = tiles.length;

            // Step 3: Initialize components
            console.log('\n🔧 Initializing scraper components...');
            this.status.state = 'initializing_scraper';

            // Initialize aggregator
            this.aggregator = new ResultAggregator({
                coordsPrecision: config.deduplication?.coordsPrecision ?? 4,
                enablePhoneDedup: config.deduplication?.enablePhoneDedup ?? true,
                enableCoordsDedup: config.deduplication?.enableCoordsDedup ?? true,
                batchFlushSize: this.options.batchFlushSize,
            });
            this.aggregator.setContext(parsedQuery.region, parsedQuery.keyword);

            // Initialize exporter
            this.exporter = new ExportUtility({
                outputDir: this.options.outputDir,
                format: this.options.exportFormat,
                includeMetadata: true,
                prettyPrint: true,
                filenamePrefix: config.export?.filenamePrefix || 'gmap_scrape',
            });

            // Initialize streaming export
            await this.exporter.initStreamingExport(parsedQuery.region, parsedQuery.keyword);

            // Initialize scraper
            this.scraper = new TileScraper({
                headless: this.options.headless,
                maxScrollIdleCount: this.options.maxScrollIdleCount,
                scrollDelayMin: this.options.scrollDelayMin,
                scrollDelayMax: this.options.scrollDelayMax,
                onData: (place) => this.handleNewPlace(place),
                onProgress: (progress) => this.handleProgress(progress),
                onError: (error) => this.handleError(error),
                onTileComplete: (result) => this.handleTileComplete(result),
            });

            await this.scraper.initialize();
            console.log('   ✓ Browser initialized');

            // Step 4: Process tiles
            console.log('\n🚀 Starting tile processing...\n');
            this.status.state = 'scraping';

            let lastFlushCount = 0;

            // Process tiles sequentially (or with controlled concurrency)
            for (let i = 0; i < tiles.length; i++) {
                if (this.aborted) {
                    console.log('\n⚠️ Scraping aborted by user');
                    break;
                }

                const tile = tiles[i];
                this.status.currentTile = tile.id;
                this.status.currentCity = tile.cityName;
                this.status.processedTiles = i;

                // Calculate ETA
                this.updateETA(i, tiles.length);

                console.log(`\n[${i + 1}/${tiles.length}] Processing tile: ${tile.cityName} - ${tile.id}`);

                try {
                    // Check for CAPTCHA
                    if (await this.scraper.checkForCaptcha()) {
                        const resolved = await this.scraper.handleCaptcha();
                        if (!resolved) {
                            throw new Error('CAPTCHA not resolved');
                        }
                    }

                    // Scrape the tile
                    const result = await this.scraper.scrapeTile(
                        tile,
                        parsedQuery.keyword,
                        this.options.maxTileRetries
                    );

                    if (result.success) {
                        console.log(`   ✓ Found ${result.placesCount} places`);
                    } else {
                        console.log(`   ✗ Tile failed: ${result.error}`);
                        this.status.failedTiles++;
                    }

                } catch (error) {
                    console.error(`   ✗ Error: ${error.message}`);
                    this.status.failedTiles++;
                }

                // Periodic flush to disk
                if (this.aggregator.count - lastFlushCount >= this.options.batchFlushSize) {
                    const newPlaces = this.aggregator.places.slice(lastFlushCount);
                    await this.exporter.appendToStream(newPlaces);
                    lastFlushCount = this.aggregator.count;
                    console.log(`   📁 Flushed ${newPlaces.length} places to disk`);
                }

                // Delay between tiles
                if (i < tiles.length - 1) {
                    await randomSleep(this.options.tileDelayMin, this.options.tileDelayMax);
                }
            }

            // Step 5: Finalize and export
            console.log('\n📦 Finalizing results...');
            this.status.state = 'finalizing';

            // Flush remaining places
            const remainingPlaces = this.aggregator.places.slice(lastFlushCount);
            if (remainingPlaces.length > 0) {
                await this.exporter.appendToStream(remainingPlaces);
            }

            // Get final results
            const results = this.aggregator.getResults();

            // Finalize streaming export
            await this.exporter.finalizeStreamingExport({
                region: results.region,
                baseQuery: results.baseQuery,
                totalAreasScanned: results.totalAreasScanned,
                totalResults: results.totalResults,
                duplicatesRemoved: results.duplicatesRemoved,
                statistics: results.statistics,
            });

            // Save summary report
            await this.exporter.saveSummaryReport(results);

            // Print summary
            const report = this.exporter.generateSummaryReport(results);
            console.log('\n' + report);

            this.status.state = 'completed';
            this.status.totalPlaces = results.totalResults;

            // Call completion callback
            if (this.options.onComplete) {
                this.options.onComplete(results);
            }

            return results;

        } catch (error) {
            this.status.state = 'error';
            console.error('\n❌ Scraping failed:', error.message);

            if (this.options.onError) {
                this.options.onError({ fatal: true, error: error.message });
            }

            throw error;

        } finally {
            // Cleanup
            await this.cleanup();
        }
    }

    /**
     * Handle new place data
     * @param {Object} place - Scraped place
     */
    handleNewPlace(place) {
        const result = this.aggregator.add(place);

        if (result.added) {
            this.status.totalPlaces = this.aggregator.count;

            if (this.options.onData) {
                this.options.onData(place);
            }
        }
    }

    /**
     * Handle progress updates
     * @param {Object} progress - Progress data
     */
    handleProgress(progress) {
        if (this.options.onProgress) {
            this.options.onProgress({
                ...this.status,
                tileProgress: progress,
            });
        }
    }

    /**
     * Handle errors
     * @param {Object} error - Error data
     */
    handleError(error) {
        if (this.options.onError) {
            this.options.onError(error);
        }
    }

    /**
     * Handle tile completion
     * @param {Object} result - Tile result
     */
    handleTileComplete(result) {
        this.aggregator.markTileProcessed(result.tileId);

        if (this.options.onTileComplete) {
            this.options.onTileComplete(result);
        }
    }

    /**
     * Update estimated time remaining
     * @param {number} processed - Processed tile count
     * @param {number} total - Total tile count
     */
    updateETA(processed, total) {
        if (processed === 0) {
            this.status.estimatedTimeRemaining = null;
            return;
        }

        const elapsed = Date.now() - this.status.startTime;
        const avgPerTile = elapsed / processed;
        const remaining = (total - processed) * avgPerTile;

        this.status.estimatedTimeRemaining = Math.round(remaining / 1000);
    }

    /**
     * Abort the current operation
     */
    abort() {
        this.aborted = true;
        if (this.scraper) {
            this.scraper.abort();
        }
    }

    /**
     * Get current status
     * @returns {Object} Status object
     */
    getStatus() {
        return { ...this.status };
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        if (this.scraper) {
            await this.scraper.cleanup();
            this.scraper = null;
        }
    }
}

/**
 * Quick scrape function for simple usage
 * @param {string} query - Search query
 * @param {Object} options - Scraper options
 * @returns {Object} Scraping results
 */
export async function scrapeRegion(query, options = {}) {
    const scraper = new RegionScraper(options);
    return scraper.scrape(query);
}

/**
 * Create a region scraper instance
 * @param {Object} options - Scraper options
 * @returns {RegionScraper} Scraper instance
 */
export function createRegionScraper(options = {}) {
    return new RegionScraper(options);
}

export default RegionScraper;
