#!/usr/bin/env node

/**
 * Google Maps Region Scraper - CLI Entry Point
 * 
 * Command-line interface for running region-based scraping.
 * 
 * Usage:
 *   node scrapeRegion.js "restaurants in Gujarat"
 *   node scrapeRegion.js "hotels in Maharashtra" --headless=false
 *   node scrapeRegion.js "cafes in Delhi" --tiers=metro,major --grid=2
 * 
 * Options:
 *   --headless      Run in headless mode (default: true)
 *   --grid          Grid size in km (default: 3)
 *   --tiers         City tiers to include (default: metro,major,tier2,tier3)
 *   --output        Output directory (default: ./output)
 *   --format        Export format: json, csv, ndjson, all (default: all)
 *   --radius        City radius in km (default: 15)
 *   --concurrency   Max concurrent processing (default: 1)
 */

import { RegionScraper } from './orchestrator/regionScraper.js';
import { getAvailableRegions } from './geo/regionData.js';

/**
 * Parse command line arguments
 * @returns {Object} Parsed arguments
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const result = {
        query: null,
        options: {},
    };

    for (const arg of args) {
        if (arg.startsWith('--')) {
            const [key, value] = arg.slice(2).split('=');

            switch (key) {
                case 'headless':
                    result.options.headless = value !== 'false';
                    break;
                case 'grid':
                    result.options.gridSizeKm = parseFloat(value);
                    break;
                case 'tiers':
                    result.options.cityTiers = value.split(',');
                    break;
                case 'output':
                    result.options.outputDir = value;
                    break;
                case 'format':
                    result.options.exportFormat = value;
                    break;
                case 'radius':
                    result.options.cityRadiusKm = parseFloat(value);
                    break;
                case 'concurrency':
                    result.options.concurrency = parseInt(value, 10);
                    break;
                case 'scroll-idle':
                    result.options.maxScrollIdleCount = parseInt(value, 10);
                    break;
                case 'help':
                    printHelp();
                    process.exit(0);
                    break;
                case 'list-regions':
                    printRegions();
                    process.exit(0);
                    break;
                default:
                    console.warn(`Unknown option: --${key}`);
            }
        } else if (!result.query) {
            result.query = arg;
        }
    }

    return result;
}

/**
 * Print help message
 */
function printHelp() {
    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║          GOOGLE MAPS REGION SCRAPER - Help                       ║
╚══════════════════════════════════════════════════════════════════╝

USAGE:
  node scrapeRegion.js "<query>" [options]

EXAMPLES:
  node scrapeRegion.js "restaurants in Gujarat"
  node scrapeRegion.js "hotels in Maharashtra" --headless=false
  node scrapeRegion.js "cafes in Delhi" --tiers=metro,major --grid=2
  node scrapeRegion.js "dentists in Karnataka" --output=./data --format=csv

OPTIONS:
  --headless=<bool>     Run browser in headless mode (default: true)
  --grid=<number>       Grid tile size in km (default: 3)
  --tiers=<list>        City tiers: metro,major,tier2,tier3 (default: all)
  --output=<path>       Output directory (default: ./output)
  --format=<type>       Export format: json, csv, ndjson, all (default: all)
  --radius=<number>     City radius coverage in km (default: 15)
  --concurrency=<num>   Concurrent tile processing (default: 1)
  --scroll-idle=<num>   Scroll idle count before stop (default: 15)
  --list-regions        List available regions
  --help                Show this help message

QUERY FORMAT:
  "<keyword> in <region>"
  
  Examples:
    - "restaurants in Gujarat"
    - "hotels in Maharashtra"
    - "hospitals in Delhi"
    - "schools in Tamil Nadu"

SUPPORTED REGIONS:
  Run --list-regions to see all supported regions.
`);
}

/**
 * Print available regions
 */
function printRegions() {
    const regions = getAvailableRegions();

    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║          AVAILABLE REGIONS                                       ║
╚══════════════════════════════════════════════════════════════════╝

The following Indian states/regions are supported:

`);

    regions.forEach((region, index) => {
        console.log(`  ${(index + 1).toString().padStart(2)}. ${region}`);
    });

    console.log(`
To add more regions, edit: server/geo/regionData.js
`);
}

/**
 * Main execution
 */
async function main() {
    const { query, options } = parseArgs();

    if (!query) {
        console.error('❌ Error: No query provided');
        console.log('\nUsage: node scrapeRegion.js "restaurants in Gujarat"');
        console.log('Run with --help for more options');
        process.exit(1);
    }

    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║          GOOGLE MAPS REGION SCRAPER                              ║
╚══════════════════════════════════════════════════════════════════╝
    `);

    console.log(`Query: "${query}"`);
    console.log(`Options:`, JSON.stringify(options, null, 2));

    // Create scraper instance
    const scraper = new RegionScraper({
        ...options,
        onProgress: (progress) => {
            // Update progress display
            const eta = progress.estimatedTimeRemaining
                ? `ETA: ${Math.floor(progress.estimatedTimeRemaining / 60)}m ${progress.estimatedTimeRemaining % 60}s`
                : '';

            process.stdout.write(`\r   Progress: ${progress.processedTiles}/${progress.totalTiles} tiles | ${progress.totalPlaces} places | ${eta}    `);
        },
    });

    // Handle interruption
    process.on('SIGINT', () => {
        console.log('\n\n⚠️ Received interrupt signal. Shutting down gracefully...');
        scraper.abort();
    });

    try {
        const startTime = Date.now();
        const results = await scraper.scrape(query);
        const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

        console.log(`\n✅ Scraping completed successfully!`);
        console.log(`   Total time: ${duration} minutes`);
        console.log(`   Total places: ${results.totalResults}`);
        console.log(`   Files saved to: ${options.outputDir || './output'}`);

    } catch (error) {
        console.error(`\n❌ Scraping failed: ${error.message}`);
        process.exit(1);
    }
}

// Run main
main().catch(console.error);
