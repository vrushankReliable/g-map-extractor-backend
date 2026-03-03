/**
 * Export Utility Module
 * 
 * Handles exporting scraping results to various formats:
 * - JSON (structured data)
 * - CSV (spreadsheet compatible)
 * - NDJSON (newline-delimited JSON for streaming)
 * 
 * Features:
 * - Memory-efficient streaming writes
 * - Automatic file naming
 * - Incremental batch exports
 * - Excel-compatible CSV encoding
 */

import { promises as fs } from 'fs';
import path from 'path';

/**
 * @typedef {Object} ExportConfig
 * @property {string} outputDir - Output directory path
 * @property {string} format - Export format: 'json', 'csv', 'ndjson', 'all'
 * @property {boolean} includeMetadata - Include scraping metadata
 * @property {boolean} prettyPrint - Pretty print JSON output
 * @property {string} filenamePrefix - Prefix for output files
 */

const DEFAULT_CONFIG = {
    outputDir: './output',
    format: 'all',
    includeMetadata: true,
    prettyPrint: true,
    filenamePrefix: 'scrape',
};

// CSV field order and headers
const CSV_FIELDS = [
    { key: 'name', header: 'Business Name' },
    { key: 'category', header: 'Category' },
    { key: 'rating', header: 'Rating' },
    { key: 'reviews', header: 'Review Count' },
    { key: 'address', header: 'Address' },
    { key: 'phoneNumber', header: 'Phone Number' },
    { key: 'website', header: 'Website' },
    { key: 'latitude', header: 'Latitude' },
    { key: 'longitude', header: 'Longitude' },
    { key: 'profileUrl', header: 'Google Maps URL' },
    { key: 'placeId', header: 'Place ID' },
    { key: 'tileId', header: 'Source Tile' },
    { key: 'scrapedAt', header: 'Scraped At' },
];

/**
 * Escape a value for CSV format
 * @param {any} value - Value to escape
 * @returns {string} CSV-safe string
 */
function escapeCSV(value) {
    if (value === null || value === undefined) {
        return '';
    }

    const str = String(value);

    // If contains special characters, wrap in quotes and escape internal quotes
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
    }

    return str;
}

/**
 * Convert a place object to CSV row
 * @param {Object} place - Place object
 * @returns {string} CSV row
 */
function placeToCSVRow(place) {
    return CSV_FIELDS
        .map(field => escapeCSV(place[field.key]))
        .join(',');
}

/**
 * Get CSV header row
 * @returns {string} Header row
 */
function getCSVHeader() {
    return CSV_FIELDS.map(field => field.header).join(',');
}

/**
 * Generate filename with timestamp
 * @param {string} prefix - Filename prefix
 * @param {string} region - Region name
 * @param {string} query - Search query
 * @param {string} extension - File extension
 * @returns {string} Generated filename
 */
function generateFilename(prefix, region, query, extension) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeRegion = (region || 'unknown').replace(/[^a-zA-Z0-9]/g, '_');
    const safeQuery = (query || 'search').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20);

    return `${prefix}_${safeRegion}_${safeQuery}_${timestamp}.${extension}`;
}

/**
 * Ensure output directory exists
 * @param {string} dirPath - Directory path
 */
async function ensureDir(dirPath) {
    try {
        await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
        if (error.code !== 'EEXIST') {
            throw error;
        }
    }
}

/**
 * Export Utility Class
 */
export class ExportUtility {
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.pendingWrites = [];
        this.csvStream = null;
        this.ndjsonStream = null;
        this.exportedCount = 0;
    }

    /**
     * Export complete results to files
     * @param {Object} results - Aggregated results object
     * @returns {Object} Export results with file paths
     */
    async exportResults(results) {
        await ensureDir(this.config.outputDir);

        const exportedFiles = [];
        const { format } = this.config;

        if (format === 'json' || format === 'all') {
            const jsonPath = await this.exportToJSON(results);
            exportedFiles.push({ format: 'json', path: jsonPath });
        }

        if (format === 'csv' || format === 'all') {
            const csvPath = await this.exportToCSV(results);
            exportedFiles.push({ format: 'csv', path: csvPath });
        }

        if (format === 'ndjson' || format === 'all') {
            const ndjsonPath = await this.exportToNDJSON(results);
            exportedFiles.push({ format: 'ndjson', path: ndjsonPath });
        }

        return {
            success: true,
            files: exportedFiles,
            totalExported: results.places?.length || 0,
        };
    }

    /**
     * Export to JSON format
     * @param {Object} results - Results object
     * @returns {string} Output file path
     */
    async exportToJSON(results) {
        const filename = generateFilename(
            this.config.filenamePrefix,
            results.region,
            results.baseQuery,
            'json'
        );

        const filePath = path.join(this.config.outputDir, filename);

        const output = this.config.includeMetadata
            ? results
            : { places: results.places };

        const content = this.config.prettyPrint
            ? JSON.stringify(output, null, 2)
            : JSON.stringify(output);

        await fs.writeFile(filePath, content, 'utf-8');

        console.log(`✓ Exported JSON: ${filePath}`);
        return filePath;
    }

    /**
     * Export to CSV format
     * @param {Object} results - Results object
     * @returns {string} Output file path
     */
    async exportToCSV(results) {
        const filename = generateFilename(
            this.config.filenamePrefix,
            results.region,
            results.baseQuery,
            'csv'
        );

        const filePath = path.join(this.config.outputDir, filename);

        // Build CSV content with BOM for Excel compatibility
        const BOM = '\ufeff';
        const rows = [getCSVHeader()];

        for (const place of results.places || []) {
            rows.push(placeToCSVRow(place));
        }

        await fs.writeFile(filePath, BOM + rows.join('\n'), 'utf-8');

        console.log(`✓ Exported CSV: ${filePath}`);
        return filePath;
    }

    /**
     * Export to NDJSON format (newline-delimited JSON)
     * @param {Object} results - Results object
     * @returns {string} Output file path
     */
    async exportToNDJSON(results) {
        const filename = generateFilename(
            this.config.filenamePrefix,
            results.region,
            results.baseQuery,
            'ndjson'
        );

        const filePath = path.join(this.config.outputDir, filename);

        const lines = (results.places || [])
            .map(place => JSON.stringify(place))
            .join('\n');

        await fs.writeFile(filePath, lines, 'utf-8');

        console.log(`✓ Exported NDJSON: ${filePath}`);
        return filePath;
    }

    /**
     * Initialize streaming export (for incremental writes)
     * @param {string} region - Region name
     * @param {string} query - Search query
     */
    async initStreamingExport(region, query) {
        await ensureDir(this.config.outputDir);

        // Prepare file paths
        this.streamFiles = {
            csv: path.join(
                this.config.outputDir,
                generateFilename(this.config.filenamePrefix, region, query, 'csv')
            ),
            ndjson: path.join(
                this.config.outputDir,
                generateFilename(this.config.filenamePrefix, region, query, 'ndjson')
            ),
        };

        // Write CSV header with BOM
        await fs.writeFile(this.streamFiles.csv, '\ufeff' + getCSVHeader() + '\n', 'utf-8');

        // Initialize NDJSON file
        await fs.writeFile(this.streamFiles.ndjson, '', 'utf-8');

        this.exportedCount = 0;

        return this.streamFiles;
    }

    /**
     * Append places to streaming export
     * @param {Array} places - Places to append
     */
    async appendToStream(places) {
        if (!this.streamFiles) {
            throw new Error('Streaming export not initialized. Call initStreamingExport first.');
        }

        if (!places || places.length === 0) return;

        // Append to CSV
        const csvRows = places.map(place => placeToCSVRow(place)).join('\n') + '\n';
        await fs.appendFile(this.streamFiles.csv, csvRows, 'utf-8');

        // Append to NDJSON
        const ndjsonLines = places.map(place => JSON.stringify(place)).join('\n') + '\n';
        await fs.appendFile(this.streamFiles.ndjson, ndjsonLines, 'utf-8');

        this.exportedCount += places.length;
    }

    /**
     * Finalize streaming export and write JSON summary
     * @param {Object} metadata - Final metadata
     * @returns {Object} Export summary
     */
    async finalizeStreamingExport(metadata) {
        if (!this.streamFiles) {
            throw new Error('Streaming export not initialized');
        }

        // Write complete JSON file with metadata
        const jsonPath = path.join(
            this.config.outputDir,
            generateFilename(
                this.config.filenamePrefix,
                metadata.region,
                metadata.baseQuery,
                'json'
            )
        );

        const jsonContent = JSON.stringify({
            ...metadata,
            exportedAt: new Date().toISOString(),
            files: this.streamFiles,
        }, null, 2);

        await fs.writeFile(jsonPath, jsonContent, 'utf-8');

        const summary = {
            success: true,
            totalExported: this.exportedCount,
            files: {
                json: jsonPath,
                csv: this.streamFiles.csv,
                ndjson: this.streamFiles.ndjson,
            },
        };

        console.log(`✓ Streaming export finalized: ${this.exportedCount} places`);

        // Cleanup
        this.streamFiles = null;

        return summary;
    }

    /**
     * Quick export a single batch (useful for auto-flush)
     * @param {Array} places - Places to export
     * @param {string} batchId - Batch identifier
     */
    async exportBatch(places, batchId) {
        await ensureDir(this.config.outputDir);

        const filename = `batch_${batchId}_${Date.now()}.json`;
        const filePath = path.join(this.config.outputDir, filename);

        await fs.writeFile(filePath, JSON.stringify(places), 'utf-8');

        return filePath;
    }

    /**
     * Generate an export summary report
     * @param {Object} results - Results object
     * @returns {string} Summary text
     */
    generateSummaryReport(results) {
        const stats = results.statistics || {};

        const lines = [
            '═══════════════════════════════════════════════════════',
            '           GOOGLE MAPS SCRAPING REPORT',
            '═══════════════════════════════════════════════════════',
            '',
            `Region:          ${results.region || 'N/A'}`,
            `Search Query:    ${results.baseQuery || 'N/A'}`,
            `Total Results:   ${results.totalResults || 0}`,
            `Areas Scanned:   ${results.totalAreasScanned || 0}`,
            `Duplicates:      ${results.duplicatesRemoved || 0}`,
            '',
            '─────────────────────────────────────────────────────────',
            '                    STATISTICS',
            '─────────────────────────────────────────────────────────',
            '',
            `Duration:        ${stats.durationSeconds?.toFixed(1) || 0} seconds`,
            `Places/Second:   ${stats.placesPerSecond || 0}`,
            `Duplicate Rate:  ${stats.duplicateRate || '0%'}`,
            '',
        ];

        if (stats.byCity && Object.keys(stats.byCity).length > 0) {
            lines.push('─────────────────────────────────────────────────────────');
            lines.push('                  RESULTS BY CITY');
            lines.push('─────────────────────────────────────────────────────────');
            lines.push('');

            const sortedCities = Object.entries(stats.byCity)
                .sort((a, b) => b[1] - a[1]);

            for (const [city, count] of sortedCities) {
                lines.push(`  ${city.padEnd(25)} ${count}`);
            }
            lines.push('');
        }

        lines.push('═══════════════════════════════════════════════════════');

        return lines.join('\n');
    }

    /**
     * Save summary report to file
     * @param {Object} results - Results object
     * @returns {string} Report file path
     */
    async saveSummaryReport(results) {
        await ensureDir(this.config.outputDir);

        const filename = generateFilename(
            this.config.filenamePrefix,
            results.region,
            results.baseQuery,
            'txt'
        );

        const filePath = path.join(this.config.outputDir, filename);
        const report = this.generateSummaryReport(results);

        await fs.writeFile(filePath, report, 'utf-8');

        console.log(`✓ Saved summary report: ${filePath}`);
        return filePath;
    }
}

/**
 * Create an export utility instance
 * @param {ExportConfig} config - Configuration
 * @returns {ExportUtility} Utility instance
 */
export function createExportUtility(config = {}) {
    return new ExportUtility(config);
}

/**
 * Quick export helper function
 * @param {Object} results - Results to export
 * @param {ExportConfig} config - Export configuration
 * @returns {Object} Export results
 */
export async function quickExport(results, config = {}) {
    const exporter = new ExportUtility(config);
    return exporter.exportResults(results);
}

export default ExportUtility;
