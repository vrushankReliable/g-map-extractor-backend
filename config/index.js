/**
 * Configuration module for Google Maps Scraper
 * 
 * LEGAL DISCLAIMER:
 * This tool is designed to scrape only publicly visible data from Google Maps.
 * It does NOT bypass any login walls or authentication mechanisms.
 * It does NOT automate Google account sessions.
 * Users are responsible for compliance with Google's Terms of Service.
 * Use reasonable delays and respect rate limits.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const config = {
    server: {
        port: parseInt(process.env.PORT || '3001', 10),
        nodeEnv: process.env.NODE_ENV || 'development',
    },

    puppeteer: {
        headless: true, // Run in headless mode (no browser window)
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
        defaultViewport: {
            width: 1920,
            height: 1080,
        },
        timeout: parseInt(process.env.REQUEST_TIMEOUT || '60000', 10),
    },

    scraper: {
        maxScrollIterations: parseInt(process.env.MAX_SCROLL_ITERATIONS || '2000', 10),
        scrollDelayMin: parseInt(process.env.SCROLL_DELAY_MIN || '400', 10),
        scrollDelayMax: parseInt(process.env.SCROLL_DELAY_MAX || '800', 10),
        profileScrapeLimit: parseInt(process.env.PROFILE_SCRAPE_CONCURRENCY || '3', 10),
        enableStealth: process.env.ENABLE_STEALTH !== 'false',
        blockResources: process.env.BLOCK_RESOURCES !== 'false',
        minRequestDelay: parseInt(process.env.MIN_DELAY_BETWEEN_REQUESTS || '300', 10),
        maxRequestDelay: parseInt(process.env.MAX_DELAY_BETWEEN_REQUESTS || '600', 10),
    },

    // Geographic chunking configuration for region-based scraping
    geoChunking: {
        // Size of each grid tile in kilometers
        gridSizeKm: parseFloat(process.env.GRID_SIZE_KM || '3'),

        // Overlap percentage between adjacent tiles (0-50)
        overlapPercent: parseInt(process.env.TILE_OVERLAP_PERCENT || '10', 10),

        // City tiers to include: metro, major, tier2, tier3
        cityTiers: (process.env.CITY_TIERS || 'metro,major,tier2,tier3').split(','),

        // Base radius around city centers in km
        cityRadiusKm: parseFloat(process.env.CITY_RADIUS_KM || '15'),

        // Whether to include rural grid tiles
        includeRuralAreas: process.env.INCLUDE_RURAL === 'true',

        // Number of scroll idle iterations before stopping
        maxScrollIdleCount: parseInt(process.env.MAX_SCROLL_IDLE_COUNT || '15', 10),

        // Maximum retries per tile on failure
        maxTileRetries: parseInt(process.env.MAX_TILE_RETRIES || '3', 10),
    },

    // Queue and concurrency settings
    queue: {
        // Maximum concurrent tile processing
        concurrency: parseInt(process.env.CONCURRENCY || '1', 10),

        // Delay between processing tiles (ms)
        tileDelayMin: parseInt(process.env.TILE_DELAY_MIN || '2000', 10),
        tileDelayMax: parseInt(process.env.TILE_DELAY_MAX || '5000', 10),

        // Batch size for auto-flush to disk
        batchFlushSize: parseInt(process.env.BATCH_FLUSH_SIZE || '100', 10),
    },

    // Export configuration
    export: {
        // Output directory for exports
        outputDir: process.env.OUTPUT_DIR || './output',

        // Export format: json, csv, ndjson, all
        format: process.env.EXPORT_FORMAT || 'all',

        // Include metadata in exports
        includeMetadata: process.env.INCLUDE_METADATA !== 'false',

        // Pretty print JSON output
        prettyPrint: process.env.PRETTY_PRINT !== 'false',

        // Filename prefix
        filenamePrefix: process.env.FILENAME_PREFIX || 'gmap_scrape',
    },

    // Deduplication settings
    deduplication: {
        // Enable phone-based deduplication
        enablePhoneDedup: process.env.PHONE_DEDUP !== 'false',

        // Enable coordinates-based deduplication
        enableCoordsDedup: process.env.COORDS_DEDUP !== 'false',

        // Coordinate precision for matching (decimal places)
        coordsPrecision: parseInt(process.env.COORDS_PRECISION || '4', 10),
    },

    userAgents: [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    ],
};

export default config;
